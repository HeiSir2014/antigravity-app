package com.google.antigravity.remoteapp

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Message
import android.util.Log
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference

/**
 * Dual-WebView Native Container modeled after Claude Android (`com.anthropic.claude`)
 * - Keeps both `https://gemini.google.com/app` (Home/Chat) and `https://antigravity.google.com/remote` (Code)
 *   alive in memory inside a shared FrameLayout.
 * - Shares `android.webkit.CookieManager.getInstance()` so Google SSO login is unified.
 * - Strips `; wv` from User-Agent to prevent Google OAuth `403 disallowed_useragent`.
 * - Bridges Android Notification inline actions (`AGYPermissionActionReceiver`) directly into WebView.
 */
class MainActivity : TauriActivity() {

  private lateinit var rootContainer: FrameLayout
  private lateinit var geminiWebView: WebView
  private lateinit var antigravityWebView: WebView
  private var activeEngine: String = "antigravity"
  @Volatile private var unifiedStateJson: String = ""
  @Volatile private var pendingTeleportPrompt: String = ""

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    activeInstanceRef = WeakReference(this)
    WindowCompat.setDecorFitsSystemWindows(window, true)

    val isNightMode = (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
    updateThemeAppearance(isNightMode)

    val agyScript = loadAssetScript("agy-bridge.iife.js")
    val geminiScript = loadAssetScript("gemini-bridge.iife.js")
    initializeDualEngineContainer(agyScript, geminiScript)
    handleDeepLinkIntent(intent)
  }

  fun updateThemeAppearance(isDark: Boolean) {
    runOnUiThread {
      try {
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = !isDark
        insetsController.isAppearanceLightNavigationBars = !isDark
        val barColor = if (isDark) android.graphics.Color.parseColor("#0d0f14") else android.graphics.Color.parseColor("#ffffff")
        window.statusBarColor = barColor
        window.navigationBarColor = barColor
      } catch (_: Exception) {
      }
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDeepLinkIntent(intent)
  }

  private fun loadAssetScript(fileName: String): String {
    return try {
      assets.open(fileName).bufferedReader().use { it.readText() }
    } catch (_: Exception) {
      ""
    }
  }

  private fun handleDeepLinkIntent(intent: Intent?) {
    val dataUrl = intent?.dataString ?: return
    if (dataUrl.startsWith("https://gemini.google.com/")) {
      switchEngine("gemini")
      if (::geminiWebView.isInitialized) {
        geminiWebView.loadUrl(dataUrl)
      }
    } else if (dataUrl.startsWith("https://antigravity.google.com/")) {
      switchEngine("antigravity")
      if (::antigravityWebView.isInitialized) {
        antigravityWebView.loadUrl(dataUrl)
      }
    }
  }

  override fun onDestroy() {
    if (activeInstanceRef?.get() === this) {
      activeInstanceRef = null
    }
    super.onDestroy()
  }

  @SuppressLint("SetJavaScriptEnabled")
  fun initializeDualEngineContainer(agyScript: String, geminiScript: String) {
    WebView.setWebContentsDebuggingEnabled(true)
    val cookieManager = CookieManager.getInstance()
    cookieManager.setAcceptCookie(true)

    rootContainer = FrameLayout(this).apply {
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS
    }

    ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { _, windowInsets ->
      // With adjustResize and decorFitsSystemWindows=true, Android window manager handles resizing automatically
      windowInsets
    }

    geminiWebView = createConfiguredWebView(cookieManager, geminiScript)
    antigravityWebView = createConfiguredWebView(cookieManager, agyScript)

    geminiWebView.visibility = View.INVISIBLE
    antigravityWebView.visibility = View.VISIBLE

    rootContainer.addView(geminiWebView)
    rootContainer.addView(antigravityWebView)
    antigravityWebView.bringToFront()
    setContentView(rootContainer)

    geminiWebView.loadUrl("https://gemini.google.com/app")
    antigravityWebView.loadUrl("https://antigravity.google.com/remote")

    var lastBackPressTime = 0L

    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val currentView = if (activeEngine == "gemini") geminiWebView else antigravityWebView
        currentView.evaluateJavascript(
          "(function() { const d = document.querySelector('dialog[open]'); if (d) { d.close(); return 'closed_dialog'; } return 'none'; })()"
        ) { action ->
          val res = action?.trim('"') ?: "none"
          if (res == "closed_dialog") {
            // Dismissed any open BottomSheet or Navigation Drawer
            return@evaluateJavascript
          }

          // If current WebView has browsing history, navigate back
          if (currentView.canGoBack()) {
            currentView.goBack()
            return@evaluateJavascript
          }

          // In Code view with no history, switch back to Home (Gemini)
          if (activeEngine == "antigravity") {
            switchEngine("gemini")
            return@evaluateJavascript
          }

          // On Home (Gemini) root, confirm double-back to return to phone desktop
          val currentTime = System.currentTimeMillis()
          if (currentTime - lastBackPressTime < 2000L) {
            moveTaskToBack(true)
          } else {
            lastBackPressTime = currentTime
            Toast.makeText(this@MainActivity, "再按一次返回桌面", Toast.LENGTH_SHORT).show()
          }
        }
      }
    })
  }

  private fun isAllowedInAppUri(uri: Uri?): Boolean {
    if (uri == null) return false
    val scheme = uri.scheme?.lowercase() ?: return false
    if (scheme == "about" || scheme == "blob" || scheme == "data") return true
    if (scheme != "https") return false
    val host = uri.host?.lowercase() ?: return false
    val path = uri.path ?: ""

    if (host == "antigravity.static.usercontent.goog" || host.endsWith(".usercontent.goog")) return true
    if (host == "accounts.google.com" || host == "apis.google.com") return true
    if (host == "antigravity.google.com") {
      return path.isEmpty() || path == "/" || path.startsWith("/remote") || path.startsWith("/r/") || path.startsWith("/_")
    }
    if (host == "gemini.google.com") {
      return path.isEmpty() || path == "/" || path.startsWith("/app") || path.startsWith("/u/") || path.startsWith("/_")
    }
    return false
  }

  fun openInSystemBrowser(uri: Uri?) {
    if (uri == null) return
    runOnUiThread {
      try {
        val intent = Intent(Intent.ACTION_VIEW, uri).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
      } catch (_: Exception) {
      }
    }
  }

  @SuppressLint("SetJavaScriptEnabled")
  private fun createConfiguredWebView(cookieManager: CookieManager, bridgeScript: String): WebView {
    return WebView(this).apply {
      layoutParams = FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT
      )
      isFocusable = true
      isFocusableInTouchMode = true
      overScrollMode = View.OVER_SCROLL_NEVER
      isVerticalScrollBarEnabled = false
      isHorizontalScrollBarEnabled = false
      settings.javaScriptEnabled = true
      settings.domStorageEnabled = true
      settings.databaseEnabled = true
      settings.useWideViewPort = true
      settings.loadWithOverviewMode = true
      settings.mediaPlaybackRequiresUserGesture = false
      settings.setSupportMultipleWindows(true)
      settings.javaScriptCanOpenWindowsAutomatically = false
      // Sanitize WebView User-Agent to clean Chrome Mobile so accounts.google.com never blocks OAuth with disallowed_useragent
      settings.userAgentString =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36"

      cookieManager.setAcceptThirdPartyCookies(this, true)

      val bridge = AndroidBridge()
      addJavascriptInterface(bridge, "AndroidBridge")
      addJavascriptInterface(bridge, "AgyAndroidBridge")

      // Inject bridge script at document_start across ALL frames (both top frame and #hubFrame guest iframe)
      val hasDocStartScript =
        bridgeScript.isNotEmpty() &&
          WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
      if (hasDocStartScript) {
        WebViewCompat.addDocumentStartJavaScript(
          this,
          bridgeScript,
          setOf(
            "https://antigravity.google.com",
            "https://antigravity.static.usercontent.goog",
            "https://gemini.google.com"
          )
        )
      }

      webChromeClient = object : WebChromeClient() {
        override fun onCreateWindow(
          view: WebView?,
          isDialog: Boolean,
          isUserGesture: Boolean,
          resultMsg: Message?
        ): Boolean {
          val hitTestResult = view?.hitTestResult
          val data = hitTestResult?.extra
          if (!data.isNullOrEmpty()) {
            val uri = Uri.parse(data)
            if (isAllowedInAppUri(uri)) {
              view.loadUrl(data)
            } else {
              openInSystemBrowser(uri)
            }
            return false
          }
          // Fallback: capture URL via temporary WebView and open in system browser
          val tempWebView = WebView(this@MainActivity)
          tempWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView?, req: WebResourceRequest?): Boolean {
              val targetUri = req?.url
              if (isAllowedInAppUri(targetUri)) {
                view?.loadUrl(targetUri.toString())
              } else {
                openInSystemBrowser(targetUri)
              }
              v?.destroy()
              return true
            }
          }
          val transport = resultMsg?.obj as? WebView.WebViewTransport
          transport?.webView = tempWebView
          resultMsg?.sendToTarget()
          return true
        }
      }
      webViewClient = object : WebViewClient() {
        override fun onPageFinished(view: WebView?, url: String?) {
          super.onPageFinished(view, url)
          cookieManager.flush()
          if (!hasDocStartScript && bridgeScript.isNotEmpty()) {
            view?.evaluateJavascript(bridgeScript, null)
          }
        }

        override fun shouldOverrideUrlLoading(
          view: WebView?,
          request: WebResourceRequest?
        ): Boolean {
          val reqUri = request?.url ?: return false
          // Only intercept top-level main frame navigations
          if (request.isForMainFrame && !isAllowedInAppUri(reqUri)) {
            openInSystemBrowser(reqUri)
            return true
          }
          return false
        }

        override fun onRenderProcessGone(
          view: WebView?,
          detail: RenderProcessGoneDetail?
        ): Boolean {
          Log.w("AntigravityApp", "Render process gone: didCrash=${detail?.didCrash()}")
          // Never allow render process crash to kill the host application
          view?.post {
            try {
              view.reload()
            } catch (_: Exception) {}
          }
          return true
        }
      }
    }
  }

  fun switchEngine(target: String) {
    runOnUiThread {
      activeEngine = if (target == "gemini") "gemini" else "antigravity"
      if (activeEngine == "gemini") {
        antigravityWebView.visibility = View.INVISIBLE
        geminiWebView.visibility = View.VISIBLE
        geminiWebView.bringToFront()
        geminiWebView.requestFocus()
        geminiWebView.evaluateJavascript(
          "window.__AGY_PULL_UNIFIED_STATE__ && window.__AGY_PULL_UNIFIED_STATE__();",
          null
        )
      } else {
        geminiWebView.visibility = View.INVISIBLE
        antigravityWebView.visibility = View.VISIBLE
        antigravityWebView.bringToFront()
        antigravityWebView.requestFocus()
        antigravityWebView.evaluateJavascript(
          "window.__AGY_PULL_UNIFIED_STATE__ && window.__AGY_PULL_UNIFIED_STATE__();",
          null
        )
      }
    }
  }

  fun forwardEventToWebView(payloadJson: String) {
    runOnUiThread {
      if (::antigravityWebView.isInitialized) {
        val escaped = JSONObject.quote(payloadJson)
        antigravityWebView.evaluateJavascript(
          "window.__AGY_RECEIVE_NATIVE_EVENT__ && window.__AGY_RECEIVE_NATIVE_EVENT__($escaped);",
          null
        )
      }
    }
  }

  inner class AndroidBridge {
    @JavascriptInterface
    fun updateTheme(isDark: Boolean) {
      this@MainActivity.updateThemeAppearance(isDark)
    }

    @JavascriptInterface
    fun switchEngine(engine: String) {
      this@MainActivity.switchEngine(engine)
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
      if (url.isBlank()) return
      this@MainActivity.openInSystemBrowser(Uri.parse(url))
    }

    @JavascriptInterface
    fun navigateToRemoteSession(targetUrl: String) {
      val isAgy = targetUrl.startsWith("https://antigravity.google.com/")
      val isGem = targetUrl.startsWith("https://gemini.google.com/")
      if (!isAgy && !isGem) return
      runOnUiThread {
        if (isGem) {
          this@MainActivity.switchEngine("gemini")
          if (::geminiWebView.isInitialized) {
            geminiWebView.loadUrl(targetUrl)
          }
        } else {
          this@MainActivity.switchEngine("antigravity")
          if (::antigravityWebView.isInitialized) {
            antigravityWebView.loadUrl(targetUrl)
          }
        }
      }
    }

    @JavascriptInterface
    fun teleportToCode(prompt: String) {
      pendingTeleportPrompt = prompt
      this@MainActivity.switchEngine("antigravity")
    }

    @JavascriptInterface
    fun consumeTeleport(): String {
      val p = pendingTeleportPrompt
      pendingTeleportPrompt = ""
      return p
    }

    @JavascriptInterface
    fun notifyPermissionPrompt(toolName: String, commandText: String, requestId: String) {
      AGYPermissionActionReceiver.showPermissionNotification(
        this@MainActivity,
        toolName,
        commandText,
        requestId
      )
    }

    @JavascriptInterface
    fun hapticTick() {
      runOnUiThread {
        window?.decorView?.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
      }
    }

    @JavascriptInterface
    fun importGoogleCookies(cookieString: String): Boolean {
      if (cookieString.isBlank()) return false
      return try {
        val cookieManager = CookieManager.getInstance()
        val pairs = mutableListOf<Pair<String, String>>()
        val trimmed = cookieString.trim()
        if (trimmed.startsWith("[")) {
          val arr = JSONArray(trimmed)
          for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i)
            if (item != null) {
              val n = item.optString("name")
              val v = item.optString("value")
              if (n.isNotEmpty()) pairs.add(Pair(n, v))
            }
          }
        } else {
          val clean = if (trimmed.startsWith("Cookie:", ignoreCase = true)) {
            trimmed.substringAfter(":").trim()
          } else trimmed
          for (p in clean.split(";")) {
            val s = p.trim()
            if (s.isNotEmpty() && s.contains("=")) {
              val n = s.substringBefore("=").trim()
              val v = s.substringAfter("=").trim()
              if (n.isNotEmpty()) pairs.add(Pair(n, v))
            }
          }
        }

        for ((name, value) in pairs) {
          val cookieStr = "$name=$value; Domain=.google.com; Path=/; Secure; SameSite=None"
          cookieManager.setCookie("https://.google.com", cookieStr)
          cookieManager.setCookie("https://gemini.google.com", cookieStr)
          cookieManager.setCookie("https://antigravity.google.com", cookieStr)
        }
        cookieManager.flush()
        runOnUiThread {
          if (::geminiWebView.isInitialized) geminiWebView.loadUrl("https://gemini.google.com/app")
          if (::antigravityWebView.isInitialized) antigravityWebView.loadUrl("https://antigravity.google.com/remote")
        }
        true
      } catch (e: Exception) {
        Log.e("AntigravityApp", "Failed to import Google cookies", e)
        false
      }
    }

    @JavascriptInterface
    fun postMessage(json: String) {
      try {
        val obj = JSONObject(json)
        when (obj.optString("type")) {
          "SWITCH_ENGINE" -> switchEngine(obj.optString("engine", "antigravity"))
          "UPDATE_THEME" -> updateThemeAppearance(obj.optBoolean("isDark", false))
          "TELEPORT_TO_CODE" -> teleportToCode(obj.optString("prompt", ""))
          "HAPTIC_TICK" -> hapticTick()
        }
      } catch (_: Exception) {
      }
    }

    @JavascriptInterface
    fun syncUnifiedState(stateJson: String) {
      if (unifiedStateJson.isNotEmpty()) {
        try {
          val prev = JSONObject(unifiedStateJson)
          val next = JSONObject(stateJson)
          for (key in listOf("devices", "sessions", "geminiChats")) {
            val nextArr = next.optJSONArray(key)
            if ((nextArr == null || nextArr.length() == 0) && prev.has(key)) {
              next.put(key, prev.get(key))
            }
          }
          if (!next.has("theme") && prev.has("theme")) {
            next.put("theme", prev.get("theme"))
          }
          unifiedStateJson = next.toString()
          return
        } catch (_: Exception) {
        }
      }
      unifiedStateJson = stateJson
    }

    @JavascriptInterface
    fun getUnifiedState(): String {
      return unifiedStateJson
    }
  }

  companion object {
    private var activeInstanceRef: WeakReference<MainActivity>? = null

    fun dispatchNativeEventToWebView(payloadJson: String) {
      activeInstanceRef?.get()?.forwardEventToWebView(payloadJson)
    }
  }
}
