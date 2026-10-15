package io.github.mikotolover.dualimage

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Base64InputStream
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val exporting = AtomicBoolean(false)
    private val io = Executors.newSingleThreadExecutor()
    private val picker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        fileCallback?.onReceiveValue(uri?.let { arrayOf(it) })
        fileCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }
        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(244, 245, 250))
        setContentView(webView)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(webView.settings, false)
        }
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                return assets.shouldInterceptRequest(request.url)
                    ?: WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(byteArrayOf()))
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                try {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                } catch (_: Exception) {
                    fileCallback?.onReceiveValue(null)
                    fileCallback = null
                    notifyExport(false, "사진 선택기를 열지 못했어. 다시 시도해 줘.")
                }
                return true
            }
        }
        webView.addJavascriptInterface(ExportBridge(), "AndroidBridge")
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { finish() }
        })
        webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    private inner class ExportBridge {
        @JavascriptInterface
        fun exportPng(dataUrl: String, filename: String, share: Boolean) {
            if (!exporting.compareAndSet(false, true)) return
            io.execute {
                var inserted: Uri? = null
                var committed = false
                try {
                    require(dataUrl.startsWith("data:image/png;base64,"))
                    require(filename.matches(Regex("dual_image_[0-9]{8}_[0-9]{6}\\.png")))
                    val values = ContentValues().apply {
                        put(MediaStore.Images.Media.DISPLAY_NAME, filename)
                        put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/DualImageMaker")
                        put(MediaStore.Images.Media.IS_PENDING, 1)
                    }
                    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                        ?: error("저장 위치를 만들지 못했어.")
                    inserted = uri
                    Base64InputStream(ByteArrayInputStream(dataUrl.substringAfter(',').toByteArray(Charsets.US_ASCII)), Base64.DEFAULT).use { input ->
                        val magic = ByteArray(8)
                        var offset = 0
                        while (offset < magic.size) {
                            val count = input.read(magic, offset, magic.size - offset)
                            require(count > 0)
                            offset += count
                        }
                        require(magic.contentEquals(byteArrayOf(137.toByte(), 80, 78, 71, 13, 10, 26, 10)))
                        contentResolver.openOutputStream(uri, "w")?.use { output ->
                            output.write(magic)
                            input.copyTo(output)
                        } ?: error("저장 파일을 열지 못했어.")
                    }
                    contentResolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
                    committed = true
                    runOnUiThread {
                        if (!isFinishing && !isDestroyed) {
                            notifyExport(true, "갤러리의 DualImageMaker 폴더에 저장했어.")
                            if (share) {
                                try {
                                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                                        type = "image/png"
                                        putExtra(Intent.EXTRA_STREAM, uri)
                                        clipData = ClipData.newUri(contentResolver, "이중 이미지", uri)
                                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                                    }, "이미지 공유"))
                                } catch (_: Exception) {
                                    notifyExport(false, "이미지는 저장했지만 공유 앱을 열지 못했어.")
                                }
                            }
                        }
                    }
                } catch (_: Exception) {
                    if (!committed) inserted?.let { runCatching { contentResolver.delete(it, null, null) } }
                    notifyExport(false, "저장하지 못했어. 남은 저장 공간을 확인하고 다시 시도해 줘.")
                } finally {
                    exporting.set(false)
                }
            }
        }
    }

    private fun notifyExport(success: Boolean, message: String) {
        runOnUiThread {
            if (!isFinishing && !isDestroyed) {
                webView.evaluateJavascript("window.onNativeExportResult($success, ${JSONObject.quote(message)})", null)
            }
        }
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(null)
        fileCallback = null
        webView.removeJavascriptInterface("AndroidBridge")
        webView.destroy()
        io.shutdown()
        super.onDestroy()
    }
}
