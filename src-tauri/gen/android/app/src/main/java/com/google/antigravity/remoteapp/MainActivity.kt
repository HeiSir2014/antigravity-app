package com.google.antigravity.remoteapp

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.io.File

/**
 * Pure-Native Antigravity v2 Android Activity.
 * - Delegates UI rendering to TauriActivity's local WebView (React 19 + Tailwind v4)
 * - Handles Android 15/16 edge-to-edge status bar + display cutout + IME soft-keyboard insets
 * - Exposes window.AgyAndroidBridge for native browser launch (Google OAuth SSO) & APK installation
 * - Forwards antigravity://auth/callback deep links directly to the WebView
 */
class MainActivity : TauriActivity() {
  private var tauriWebView: WebView? = null
  private var pendingOAuthCallbackUrl: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    WindowCompat.setDecorFitsSystemWindows(window, false)

    // Smooth native edge-to-edge status bar, cutout, navigation bar & IME soft-keyboard inset handling
    val contentView = findViewById<android.view.View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(contentView) { view, insets ->
      val statusTop = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
      val cutoutTop = insets.getInsets(WindowInsetsCompat.Type.displayCutout()).top
      val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val navBottom = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
      view.setPadding(0, maxOf(statusTop, cutoutTop), 0, maxOf(imeBottom, navBottom))
      insets
    }

    handleDeepLinkIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    tauriWebView = webView
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

  companion object {
    @JvmStatic
    @JvmOverloads
    fun dispatchNativeEventToWebView(eventName: String, payloadJson: String = "") {
      android.util.Log.i("AntigravityApp", "Notification action: $eventName payload=$payloadJson")
    }
  }
}
