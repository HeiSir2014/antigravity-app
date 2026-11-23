package com.google.antigravity.remoteapp

import android.app.ActivityManager
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject
import java.io.File

/**
 * Pure-Native Antigravity v2 Android Activity.
 * - Delegates UI rendering to TauriActivity's local WebView (React 19 + Tailwind v4)
 * - Handles Android 15/16 edge-to-edge status bar + display cutout + IME soft-keyboard insets
 *   and consumes them so CSS `env(safe-area-inset-*)` never double-pads the top bar
 * - Intercepts system Back gestures to dismiss JS overlays/sheets/drawer layer-by-layer and
 *   backgrounds via `moveTaskToBack(true)` so the app stays visible in Android Recents
 * - Exposes window.AgyAndroidBridge for native browser launch, theme sync & APK installation
 * - Forwards antigravity://auth/callback deep links directly to the WebView
 */
class MainActivity : TauriActivity() {
  private var tauriWebView: WebView? = null
  private var pendingOAuthCallbackUrl: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)

    val nightMode =
      (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
    applySystemBarAppearance(nightMode)
    updateRecentsTaskDescription(nightMode)

    // Smooth native edge-to-edge status bar, cutout, navigation bar & IME soft-keyboard inset handling.
    // Consume the insets after applying native padding so Android WebView doesn't add a second
    // `env(safe-area-inset-top)` gap above the top bar.
    val contentView = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->
      val statusTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val cutoutTop = insets.getInsets(WindowInsetsCompat.Type.displayCutout()).top
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val navBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      view.setPadding(0, maxOf(statusTop, cutoutTop), 0, maxOf(imeBottom, navBottom))
      WindowInsetsCompat.CONSUMED
    }

    // Intercept system Back gesture/button: ask JS to close the topmost popup/sheet/drawer first;
    // when nothing is open on the root screen, background the task instead of finishing it so the
    // app remains visible in Android Recents.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = tauriWebView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript("window.__agyHandleBack ? window.__agyHandleBack() : false") { result ->
          if (result != "true") {
            moveTaskToBack(true)
          }
        }
      }
    })

    handleDeepLinkIntent(intent)
  }

  private fun applySystemBarAppearance(isDark: Boolean) {
    val bgColor = if (isDark) Color.parseColor("#181817") else Color.parseColor("#FAF9F5")
    window.decorView.setBackgroundColor(bgColor)
    @Suppress("DEPRECATION")
    window.statusBarColor = Color.TRANSPARENT
    @Suppress("DEPRECATION")
    window.navigationBarColor = Color.TRANSPARENT
    val controller = WindowInsetsControllerCompat(window, window.decorView)
    controller.isAppearanceLightStatusBars = !isDark
    controller.isAppearanceLightNavigationBars = !isDark
  }

  private fun updateRecentsTaskDescription(isDark: Boolean) {
    val label = getString(R.string.app_name)
    val bgColor = if (isDark) Color.parseColor("#181817") else Color.parseColor("#FAF9F5")
    val desc = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ActivityManager.TaskDescription.Builder()
        .setLabel(label)
        .setPrimaryColor(bgColor)
        .build()
    } else {
      @Suppress("DEPRECATION")
      ActivityManager.TaskDescription(label, null as android.graphics.Bitmap?, bgColor)
    }
    setTaskDescription(desc)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    tauriWebView = webView
    currentWebView = webView
    webView.addJavascriptInterface(AgyAndroidBridge(), "AgyAndroidBridge")

    pendingOAuthCallbackUrl?.let { url ->
      pendingOAuthCallbackUrl = null
      webView.postDelayed({ dispatchOAuthCallbackToWebView(url) }, 400)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDeepLinkIntent(intent)
  }

  private fun handleDeepLinkIntent(intent: Intent?) {
    val data = intent?.data ?: return
    if (data.scheme == "antigravity" && data.host == "auth") {
      val callbackUrl = data.toString()
      val wv = tauriWebView
      if (wv != null) {
        dispatchOAuthCallbackToWebView(callbackUrl)
      } else {
        pendingOAuthCallbackUrl = callbackUrl
      }
    }
  }

  private fun dispatchOAuthCallbackToWebView(callbackUrl: String) {
    val wv = tauriWebView ?: return
    val quoted = JSONObject.quote(callbackUrl)
    wv.post {
      wv.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('agy:oauth-callback', { detail: $quoted }));",
        null
      )
    }
  }

  inner class AgyAndroidBridge {
    @JavascriptInterface
    fun openExternalUrl(url: String): Boolean {
      return try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(intent)
        true
      } catch (_: Exception) {
        false
      }
    }

    @JavascriptInterface
    fun installVerifiedApk(apkPath: String): Boolean {
      return this@MainActivity.installVerifiedApk(apkPath)
    }

    @JavascriptInterface
    fun setSystemBarTheme(isDark: Boolean): Boolean {
      runOnUiThread {
        applySystemBarAppearance(isDark)
        updateRecentsTaskDescription(isDark)
      }
      return true
    }

    @JavascriptInterface
    fun showPermissionNotification(toolName: String, commandText: String, requestId: String): Boolean {
      return try {
        AGYPermissionActionReceiver.showPermissionNotification(
          this@MainActivity,
          toolName,
          commandText,
          requestId
        )
        true
      } catch (_: Exception) {
        false
      }
    }
  }

  /**
   * Launches Android's system package installer for a SHA-256 verified APK downloaded into cacheDir/updates/.
   */
  fun installVerifiedApk(apkPath: String): Boolean {
    return try {
      val apkFile = File(apkPath)
      if (!apkFile.exists()) return false
      val uri = FileProvider.getUriForFile(
        this,
        "${applicationContext.packageName}.fileprovider",
        apkFile
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startActivity(intent)
      true
    } catch (_: Exception) {
      false
    }
  }

  override fun onDestroy() {
    if (currentWebView === tauriWebView) currentWebView = null
    super.onDestroy()
  }

  companion object {
    @Volatile
    private var currentWebView: WebView? = null

    @JvmStatic
    @JvmOverloads
    fun dispatchNativeEventToWebView(eventName: String, payloadJson: String = "") {
      val webView = currentWebView ?: return
      val detail = JSONObject().apply {
        put("event", eventName)
        put("payload", runCatching { JSONObject(payloadJson) }.getOrElse { JSONObject() })
      }
      webView.post {
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('agy:native-event', { detail: $detail }));",
          null
        )
      }
    }
  }
}
