const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const originalHtml = fs.readFileSync('index.html', 'utf8');
const appHtml = fs.readFileSync('android/app/src/main/assets/index.html', 'utf8');
let browser, original, app;
before(async () => {
    browser = await chromium.launch({ headless: true });
    original = await browser.newPage();
    app = await browser.newPage({ viewport: { width: 390, height: 844 } });
});
after(async () => { if (browser) await browser.close(); });
async function reset() { await original.setContent(originalHtml); await app.goto('about:blank'); await app.setContent(appHtml); }
async function fixture(width, height, seed, transparent = false) {
    const png = await original.evaluate(({width, height, seed, transparent}) => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d'), pixels = ctx.createImageData(width, height);
        for (let i = 0; i < pixels.data.length; i += 4) {
            const n = i / 4;
            pixels.data.set([(n*17+seed)%256, (n*31+seed*2)%256, (n*7+seed*3)%256, transparent ? (n*19+seed)%256 : 255], i);
        }
        ctx.putImageData(pixels, 0, 0); return canvas.toDataURL().split(',')[1];
    }, {width, height, seed, transparent});
    return {name:`fixture-${seed}.png`, mimeType:'image/png', buffer:Buffer.from(png,'base64')};
}
async function inputs(page, dark, light) {
    await page.locator('#darkInput').setInputFiles(dark); await page.locator('#lightInput').setInputFiles(light);
}
async function output(page) {
    return page.evaluate(() => {
        const c=document.getElementById('resultCanvas');
        return {width:c.width,height:c.height,png:c.toDataURL()};
    });
}
test('the original pixel calculation and dimension expressions remain unchanged', () => {
    const core = text => text.slice(text.indexOf('    const output = ctx.createImageData'), text.indexOf('\n    const now = new Date();'));
    assert.equal(core(appHtml), core(originalHtml));
    assert(appHtml.includes('const width = Math.min(imgD.width, imgL.width);'));
    assert(appHtml.includes('const height = Math.min(imgD.height, imgL.height);'));
});
test('default mode produces exactly the original PNG, including transparent inputs and widths above 2048', async () => {
    for (const [dw,dh,lw,lh,alpha] of [[37,23,23,37,false],[11,13,17,7,true],[1,1,1,1,false],[256,256,256,256,true],[2101,1,2200,1,false]]) {
        await reset();
        const d=await fixture(dw,dh,53,alpha), l=await fixture(lw,lh,128,alpha);
        await inputs(original,d,l); await inputs(app,d,l);
        await original.evaluate(() => processImages()); await app.evaluate(() => processImages());
        assert.deepEqual(await output(app),await output(original));
        assert.equal(await app.locator('#fitMode').inputValue(),'stretch');
    }
});
test('padding preserves aspect and uses the specified background; crop selects the center', async () => {
    await reset();
    const result=await app.evaluate(() => {
        const source=document.createElement('canvas'); source.width=8; source.height=4;
        const s=source.getContext('2d'); s.fillStyle='#f00';s.fillRect(0,0,8,4);s.fillStyle='#00f';s.fillRect(2,0,4,4);
        const target=document.createElement('canvas');target.width=4;target.height=4;const c=target.getContext('2d');
        const pixel=(x,y)=>Array.from(c.getImageData(x,y,1,1).data);
        drawFitted(c,source,4,4,'pad','#fff');const white=pixel(0,0), content=pixel(1,1);
        c.clearRect(0,0,4,4);drawFitted(c,source,4,4,'pad','#000');const black=pixel(0,0);
        c.clearRect(0,0,4,4);drawFitted(c,source,4,4,'crop','#000');const crop=Array.from(c.getImageData(0,0,4,4).data);
        return {white,content,black,crop};
    });
    assert.deepEqual(result.white,[255,255,255,255]);assert.deepEqual(result.black,[0,0,0,255]);
    assert.deepEqual(result.content,[0,0,255,255]);
    for(let i=0;i<result.crop.length;i+=4) assert.deepEqual(result.crop.slice(i,i+4),[0,0,255,255]);
    await inputs(app,await fixture(80,40,5),await fixture(40,80,6));
    for(const mode of ['pad','crop']) {
        await app.locator('#fitMode').selectOption(mode);await app.evaluate(()=>processImages());
        const out=await output(app);assert.equal(out.width,40);assert.equal(out.height,40);
    }
});
test('decode errors finish, report the failure, and permit a successful retry', async () => {
    await reset();const good=await fixture(3,4,15);
    await inputs(app,good,{name:'broken.png',mimeType:'image/png',buffer:Buffer.from('broken')});
    await app.evaluate(()=>processImages());
    assert.match(await app.locator('#status').innerText(),/読|읽지 못/);
    assert.equal(await app.locator('#generateBtn').isEnabled(),true);
    assert.equal(await app.locator('#result').isVisible(),false);
    await app.locator('#lightInput').setInputFiles(good);await app.evaluate(()=>processImages());
    assert.equal(await app.locator('#result').isVisible(),true);
});
test('input changes invalidate old results and concurrent generation does not overwrite results', async () => {
    await reset();const d=await fixture(25,19,31),l=await fixture(19,25,62);await inputs(app,d,l);
    const count=await app.evaluate(async()=>{
        const canvas=document.getElementById('resultCanvas'),ctx=canvas.getContext('2d');
        let count=0;const put=ctx.putImageData.bind(ctx);ctx.putImageData=(...args)=>{count++;return put(...args)};
        await Promise.all([processImages(),processImages()]);return count;
    });
    assert.equal(count,1);
    await app.locator('#swapBtn').click();assert.equal(await app.locator('#result').isVisible(),false);
    assert.equal(await app.locator('#downloadBtn').getAttribute('href'),null);
    await app.evaluate(()=>processImages());await inputs(original,l,d);await original.evaluate(()=>processImages());
    assert.deepEqual(await output(app),await output(original));
    await app.locator('#lightInput').setInputFiles(l);assert.equal(await app.locator('#result').isVisible(),false);
});
test('preview backgrounds never alter the exported PNG and save/share bridge receives the original PNG', async () => {
    await reset();await inputs(app,await fixture(23,17,44),await fixture(17,23,87));await app.evaluate(()=>processImages());
    const before=await output(app);await app.locator('#blackBg').click();assert.deepEqual(await output(app),before);
    await app.evaluate(()=>{window.calls=[];window.AndroidBridge={exportPng:(...args)=>window.calls.push(args)}});
    await app.locator('#downloadBtn').click();
    let calls=await app.evaluate(()=>window.calls);assert.equal(calls.length,1);assert.equal(calls[0][0],before.png);assert.equal(calls[0][2],false);
    assert.equal(await app.locator('#generateBtn').isEnabled(),false);
    await app.evaluate(()=>window.onNativeExportResult(true,'saved'));await app.locator('#shareBtn').click();
    calls=await app.evaluate(()=>window.calls);assert.equal(calls[1][2],true);
    await app.evaluate(()=>window.onNativeExportResult(true,'shared'));
    fs.mkdirSync('test-results',{recursive:true});await app.screenshot({path:'test-results/app-preview.png',fullPage:true});
});

test('save as sends the unchanged PNG and cancellation or errors allow another save', async () => {
    await reset();await inputs(app,await fixture(23,17,44),await fixture(17,23,87));await app.evaluate(()=>processImages());
    const before=await output(app);
    await app.evaluate(()=>{window.calls=[];window.AndroidBridge={savePngAs:(...args)=>window.calls.push(args)}});
    await app.locator('#saveAsBtn').click();
    const calls=await app.evaluate(()=>window.calls);
    assert.equal(calls.length,1);assert.equal(calls[0][0],before.png);
    assert.match(calls[0][1],/^dual_image_[0-9]{8}_[0-9]{6}\.png$/);
    assert.equal(await app.locator('#saveAsBtn').isEnabled(),false);
    assert.equal(await app.locator('#shareBtn').isEnabled(),false);
    await app.evaluate(()=>window.onNativeExportResult(true,'저장을 취소했어.'));
    assert.deepEqual(await output(app),before);assert.equal(await app.locator('#saveAsBtn').isEnabled(),true);
    await app.locator('#saveAsBtn').click();
    await app.evaluate(()=>window.onNativeExportResult(false,'저장 실패'));
    assert.equal(await app.locator('#saveAsBtn').isEnabled(),true);
    assert.equal(await app.locator('#result').isVisible(),true);
});
