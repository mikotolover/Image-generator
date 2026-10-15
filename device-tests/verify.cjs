// Exercise the exact APK already delivered to the user; do not rebuild/modify it.
const {_android} = require('playwright');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const pkg='io.github.mikotolover.dualimage';
const out='device-results';fs.mkdirSync(out,{recursive:true});
const results=[];let device,page;
const adb=(...args)=>execFileSync('adb',args,{encoding:'utf8',timeout:30000,maxBuffer:16*1024*1024}).trim();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function record(name,detail){results.push({name,status:'passed',detail});console.log('PASS',name,detail||'');}
async function until(check,message,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await pause(400);}throw Error(message);}
function dump(name){adb('shell','uiautomator','dump','/sdcard/window.xml');const xml=adb('shell','cat','/sdcard/window.xml');fs.writeFileSync(`${out}/${name}.xml`,xml);return xml;}
function screenshot(name){fs.writeFileSync(`${out}/${name}.png`,execFileSync('adb',['exec-out','screencap','-p'],{timeout:20000}));}
function nodes(xml){return (xml.match(/<node\b[^>]*>/g)||[]).map(tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]])));}
function tap(node){const n=node.bounds.match(/\d+/g).map(Number);adb('shell','input','tap',String(Math.round((n[0]+n[2])/2)),String(Math.round((n[1]+n[3])/2)));}
async function choose(id,index){
    await page.evaluate(id=>{
        window.pickerChangeReceived=false;
        document.getElementById(id).addEventListener('change',()=>window.pickerChangeReceived=true,{once:true});
    },id);
    await page.locator('#'+id).click();
    let images=[];
    await until(()=>{
        const current=nodes(dump('picker-'+id));
        // A cold CI emulator can show a launcher ANR over the picker. Dismiss
        // only that unrelated process; an ANR in our app must still fail.
        if(current.some(n=>n.text==="Pixel Launcher isn't responding")){
            const close=current.find(n=>n['resource-id']==='android:id/aerr_close');
            if(close){console.log('ENV: closing unrelated Pixel Launcher ANR');tap(close);return false;}
        }
        images=current.filter(n=>/thumbnail|icon_image/.test(n['resource-id']||'') && n.bounds !== '[0,0][0,0]');
        return images.length>=2;
    },'Photo picker did not expose the two seeded images',30000);
    screenshot('picker-'+id);tap(images[index]);
    await until(()=>page.evaluate(id=>window.pickerChangeReceived&&document.getElementById(id).files.length===1,id),'Photo picker selection did not reach WebView');
}
async function generate(){await page.evaluate(()=>void processImages());await page.waitForFunction(()=>!busy,{},{timeout:30000});assert.equal(await page.locator('#result').isVisible(),true);}
async function png(){return page.evaluate(()=>document.getElementById('resultCanvas').toDataURL());}
(async()=>{
 try {
    const apk='device-apk/dual-image-maker-1.0.0-debug.apk';
    const sha=crypto.createHash('sha256').update(fs.readFileSync(apk)).digest('hex');
    assert.equal(sha,'22ec42079d23ca8b83c32c8cf2fb100035f6a33e06f45a19cc0264bbdee85f07');
    record('Exact delivered APK SHA-256',sha);
    adb('install','-r',apk);adb('logcat','-c');
    adb('shell','am','start','-W','-n',pkg+'/.MainActivity');
    [device]=await _android.devices({omitDriverInstall:true});assert(device);
    device.setDefaultTimeout(30000);const web=await device.webView({pkg});page=await web.page();page.setDefaultTimeout(20000);
    await page.waitForFunction(()=>typeof processImages==='function');
    page.on('console',msg=>console.log('WEB:',msg.type(),msg.text()));
    page.on('requestfailed',request=>console.log('WEB request failed:',request.url(),request.failure()));
    assert.equal(await page.title(),'이중 이미지 메이커');
    const environment={android:adb('shell','getprop','ro.build.version.release'),api:adb('shell','getprop','ro.build.version.sdk'),webview:adb('shell','dumpsys','webviewupdate')};
    fs.writeFileSync(`${out}/environment.json`,JSON.stringify(environment,null,2));record('Install and launch',environment.android);
    const fixtures=await page.evaluate(()=>[ [96,64,30], [64,96,180] ].map(([w,h,offset])=>{
        const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d'),d=x.createImageData(w,h);
        for(let i=0;i<d.data.length;i+=4)d.data.set([(i+offset)%256,(i/4+offset)%256,offset,255],i);
        x.putImageData(d,0,0);return c.toDataURL().split(',')[1];
    }));
    for(let i=0;i<fixtures.length;i++){
        fs.writeFileSync(`${out}/fixture-${i}.png`,Buffer.from(fixtures[i],'base64'));
        await page.evaluate(({png,name})=>{
            exporting=true;
            AndroidBridge.exportPng('data:image/png;base64,'+png,name,false);
        },{png:fixtures[i],name:`dual_image_20000101_00000${i}.png`});
        await page.waitForFunction(()=>!exporting,{},{timeout:30000});
        assert.match(await page.locator('#status').innerText(),/갤러리.*저장/);
    }
    record('Native MediaStore bridge registers the two fixture images');
    fs.writeFileSync(`${out}/seed-media.txt`,adb('shell','content','query','--uri','content://media/external/images/media','--projection','_display_name:mime_type:relative_path:is_pending'));
    await choose('darkInput',0);await choose('lightInput',1);
    record('Native photo picker selects two content URIs into WebView',await page.evaluate(()=>[darkInput.files[0].name,lightInput.files[0].name]));
    await page.evaluate(()=>{
        window.pickerCancelReceived=false;
        for(const name of ['change','cancel'])lightInput.addEventListener(name,()=>window.pickerCancelReceived=true,{once:true});
    });
    await page.locator('#lightInput').click();
    await until(()=>nodes(dump('cancel-picker')).some(n=>(n.package||'').includes('providers.media')),'Picker did not open for cancellation');
    adb('shell','input','keyevent','4');
    await until(()=>adb('shell','dumpsys','activity','activities').split('\n').some(l=>/mResumedActivity|topResumedActivity/.test(l)&&l.includes(pkg)),'Did not return from picker cancellation');
    await page.waitForFunction(()=>window.pickerCancelReceived);
    record('Native picker cancel returns to app');
    // Cancellation can clear a browser file input; explicitly select again if necessary.
    if(!await page.evaluate(()=>lightInput.files.length))await choose('lightInput',1);
    await generate();const original=await png();
    assert.deepEqual(await page.evaluate(()=>[resultCanvas.width,resultCanvas.height]),[64,64]);
    record('Default generation keeps original min-dimension rule','64 x 64');
    await page.locator('#blackBg').click();assert.equal(await png(),original);await page.locator('#whiteBg').click();assert.equal(await png(),original);
    record('Preview background does not change output');
    await page.locator('#downloadBtn').click();await page.waitForFunction(()=>!exporting,{},{timeout:30000});
    assert.match(await page.locator('#status').innerText(),/갤러리.*저장/);
    const names=adb('shell','ls','/sdcard/Pictures/DualImageMaker').split('\n').filter(x=>x.endsWith('.png')&&!x.startsWith('dual_image_20000101_'));assert.equal(names.length,1);
    adb('pull','/sdcard/Pictures/DualImageMaker/'+names[0],`${out}/saved.png`);
    assert.deepEqual(fs.readFileSync(`${out}/saved.png`),Buffer.from(original.split(',')[1],'base64'));
    record('MediaStore saves byte-identical transparent PNG',names[0]);
    const media=adb('shell','content','query','--uri','content://media/external/images/media','--projection','_display_name:mime_type:relative_path:is_pending');
    fs.writeFileSync(`${out}/media-store.txt`,media);assert(media.includes(names[0]));assert(media.includes('image/png'));
    record('Saved result is indexed in MediaStore');
    await page.locator('#shareBtn').click();
    await until(()=>/ChooserActivity|ResolverActivity/.test(adb('shell','dumpsys','activity','activities')),'Android share sheet did not open');
    screenshot('share-sheet');dump('share-sheet');record('Native Android share sheet opens');adb('shell','input','keyevent','4');
    await until(()=>page.evaluate(()=>!exporting),'Export state did not recover after sharing');
    const beforeRotation=await png();adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');
    await pause(1500);assert.equal(await png(),beforeRotation);assert.equal(await page.locator('#result').isVisible(),true);screenshot('landscape');
    adb('shell','settings','put','system','user_rotation','0');await pause(800);record('Rotation preserves inputs and generated PNG');
    for(const mode of ['pad','crop']){
        await page.locator('#fitMode').selectOption(mode);assert.equal(await page.locator('#result').isVisible(),false);await generate();
        assert.deepEqual(await page.evaluate(()=>[resultCanvas.width,resultCanvas.height]),[64,64]);record('On-device '+mode+' mode');
    }
    await page.locator('#swapBtn').click();assert.equal(await page.locator('#result').isVisible(),false);await generate();record('Swap clears stale output and regenerates');
    // Use a synthetic File only for failure injection, retaining real picker coverage above.
    await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['broken'],'broken.png',{type:'image/png'}));lightInput.files=dt.files;lightInput.dispatchEvent(new Event('change'));});
    await page.evaluate(()=>void processImages());await page.waitForFunction(()=>!busy);assert.match(await page.locator('#status').innerText(),/읽지 못/);assert.equal(await page.locator('#generateBtn').isEnabled(),true);
    record('Decode failure reports an error and unlocks controls');
    await choose('lightInput',1);await generate();record('Recovery after decode failure');
    screenshot('final-app');
    const log=adb('logcat','-d','-s','AndroidRuntime:E');fs.writeFileSync(`${out}/android-runtime.txt`,log);assert(!log.includes('FATAL EXCEPTION'));
    record('No Android runtime crash');
 }catch(error){
    results.push({name:'failure',status:'failed',detail:error.stack});console.error(error);
    try{fs.writeFileSync(`${out}/file-state.json`,JSON.stringify(await page.evaluate(async()=>({
        status:document.getElementById('status').textContent,busy,exporting,generation,
        files:await Promise.all(['darkInput','lightInput'].map(async id=>{
            const f=document.getElementById(id).files[0];if(!f)return {id,empty:true};
            try{const b=new Uint8Array(await f.arrayBuffer());return {id,name:f.name,size:f.size,modified:f.lastModified,length:b.length,magic:Array.from(b.slice(0,16))};}
            catch(e){return {id,name:f.name,size:f.size,error:String(e)};}
        }))
    })),null,2));}catch(_){}
    try{screenshot('failure');dump('failure');fs.writeFileSync(`${out}/logcat.txt`,adb('logcat','-d'));}catch(_){}
    process.exitCode=1;
 }finally{
    fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));
    if(device)await device.close();
 }
})();
