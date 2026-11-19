use crate::auth::{AccountSummary, AuthStore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

pub const DEFAULT_SYNC_SERVER_URL: &str = "https://antigravity.yterm.cn";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncUserProfile {
    pub id: String,
    pub email: String,
    pub name: String,
    pub avatar_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigData {
    pub server_url: String,
    pub access_token: String,
    pub user: Option<SyncUserProfile>,
    pub vault_version: u64,
    pub last_synced_ms: u64,
}

impl Default for SyncConfigData {
    fn default() -> Self {
        Self {
            server_url: DEFAULT_SYNC_SERVER_URL.to_string(),
            access_token: String::new(),
            user: None,
            vault_version: 0,
            last_synced_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusInfo {
    pub server_url: String,
    pub signed_in: bool,
    pub user: Option<SyncUserProfile>,
    pub vault_version: u64,
    pub last_synced_ms: u64,
}

pub struct SyncClient {
    http: reqwest::Client,
    config: RwLock<SyncConfigData>,
    file_path: PathBuf,
    auth: Arc<AuthStore>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl SyncClient {
    pub fn new(app_data_dir: PathBuf, auth: Arc<AuthStore>) -> Self {
        let file_path = app_data_dir.join("sync_config.json");
        let loaded = fs::read_to_string(&file_path)
            .ok()
            .and_then(|s| serde_json::from_str::<SyncConfigData>(&s).ok())
            .unwrap_or_default();
        let http = reqwest::Client::builder()
            .use_rustls_tls()
            .build()
            .expect("Failed to build sync reqwest client");
        Self {
            http,
            config: RwLock::new(loaded),
            file_path,
            auth,
        }
    }

    fn persist_locked(&self, cfg: &SyncConfigData) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, json).map_err(|e| e.to_string())
    }

    pub fn status(&self) -> SyncStatusInfo {
        let guard = self.config.read().unwrap_or_else(|e| e.into_inner());
        SyncStatusInfo {
            server_url: guard.server_url.clone(),
            signed_in: !guard.access_token.is_empty() && guard.user.is_some(),
            user: guard.user.clone(),
            vault_version: guard.vault_version,
            last_synced_ms: guard.last_synced_ms,
        }
    }

    pub fn set_server_url(&self, url: &str) -> Result<SyncStatusInfo, String> {
        let cleaned = url.trim().trim_end_matches('/').to_string();
        if cleaned.is_empty() {
            return Err("Server URL cannot be empty".to_string());
        }
        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.server_url = cleaned;
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    pub fn logout(&self) -> Result<SyncStatusInfo, String> {
        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.access_token.clear();
            guard.user = None;
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    pub async fn login_google_id_token(&self, id_token: &str) -> Result<SyncStatusInfo, String> {
        let base_url = self.config.read().unwrap_or_else(|e| e.into_inner()).server_url.clone();
        let resp = self
            .http
            .post(format!("{base_url}/api/v1/auth/google"))
            .json(&json!({ "idToken": id_token }))
            .send()
            .await
            .map_err(|e| format!("Sync server unreachable: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Google SSO sync login failed: {text}"));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let token = body
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing JWT token in response".to_string())?
            .to_string();
        let user: SyncUserProfile = serde_json::from_value(
            body.get("user")
                .cloned()
                .ok_or_else(|| "Missing user in response".to_string())?,
        )
        .map_err(|e| e.to_string())?;

        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.access_token = token;
            guard.user = Some(user);
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    pub async fn login_dev_sso(&self, email: &str, name: Option<String>) -> Result<SyncStatusInfo, String> {
        let base_url = self.config.read().unwrap_or_else(|e| e.into_inner()).server_url.clone();
        let resp = self
            .http
            .post(format!("{base_url}/api/v1/auth/dev-sso"))
            .json(&json!({ "email": email, "name": name.unwrap_or_default() }))
            .send()
            .await
            .map_err(|e| format!("Sync server unreachable: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Dev SSO login failed: {text}"));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let token = body
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Missing JWT token".to_string())?
            .to_string();
        let user: SyncUserProfile = serde_json::from_value(
            body.get("user")
                .cloned()
                .ok_or_else(|| "Missing user".to_string())?,
        )
        .map_err(|e| e.to_string())?;

        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.access_token = token;
            guard.user = Some(user);
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    pub async fn push_vault(&self) -> Result<SyncStatusInfo, String> {
        let (base_url, token) = {
            let guard = self.config.read().unwrap_or_else(|e| e.into_inner());
            (guard.server_url.clone(), guard.access_token.clone())
        };
        if token.is_empty() {
            return Err("Not signed in to Sync Server".to_string());
        }
        let vault_json = self.auth.export_vault_json()?;
        let resp = self
            .http
            .put(format!("{base_url}/api/v1/vault"))
            .bearer_auth(&token)
            .json(&json!({ "vaultJson": vault_json }))
            .send()
            .await
            .map_err(|e| format!("Vault push failed: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Vault push error: {text}"));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let version = body.get("version").and_then(|v| v.as_u64()).unwrap_or(1);
        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.vault_version = version;
            guard.last_synced_ms = now_ms();
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    pub async fn pull_vault(&self) -> Result<(SyncStatusInfo, Vec<AccountSummary>), String> {
        let (base_url, token) = {
            let guard = self.config.read().unwrap_or_else(|e| e.into_inner());
            (guard.server_url.clone(), guard.access_token.clone())
        };
        if token.is_empty() {
            return Err("Not signed in to Sync Server".to_string());
        }
        let resp = self
            .http
            .get(format!("{base_url}/api/v1/vault"))
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Vault pull failed: {e}"))?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Vault pull error: {text}"));
        }

        let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let vault_json = body.get("vaultJson").and_then(|v| v.as_str()).unwrap_or("");
        let version = body.get("version").and_then(|v| v.as_u64()).unwrap_or(0);

        let accounts = if !vault_json.trim().is_empty() {
            self.auth.import_vault_json(vault_json)?
        } else {
            self.auth.list_accounts()
        };

        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.vault_version = version;
            guard.last_synced_ms = now_ms();
            self.persist_locked(&guard)?;
        }
        Ok((self.status(), accounts))
    }

    pub fn complete_oauth_callback(&self, callback_url: &str, expected_state: Option<&str>) -> Result<SyncStatusInfo, String> {
        let parsed = tauri::Url::parse(callback_url).map_err(|e| format!("Invalid callback URL: {e}"))?;
        let params: HashMap<String, String> = parsed
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();

        if let Some(exp) = expected_state {
            if params.get("state").map(|s| s.as_str()) != Some(exp) {
                return Err("OAuth state mismatch".to_string());
            }
        }

        let token = params
            .get("token")
            .cloned()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "Missing token in OAuth callback".to_string())?;
        let email = params.get("email").cloned().unwrap_or_default();
        let id = params.get("id").cloned().unwrap_or_else(|| email.clone());
        let name = params
            .get("name")
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| email.split('@').next().unwrap_or("User").to_string());
        let avatar_url = params.get("avatar").cloned().unwrap_or_default();

        {
            let mut guard = self.config.write().unwrap_or_else(|e| e.into_inner());
            guard.access_token = token;
            guard.user = Some(SyncUserProfile {
                id,
                email,
                name,
                avatar_url,
            });
            self.persist_locked(&guard)?;
        }
        Ok(self.status())
    }

    /// Starts 1-tap system-browser Google OAuth SSO via our Bun Sync Server.
    /// - Desktop: binds an ephemeral localhost loopback listener and waits for callback.
    /// - Android: emits `agy:open-external-url` so MainActivity launches Chrome via Intent.ACTION_VIEW
    ///   and returns via `antigravity://auth/callback` deep link.
    pub async fn start_google_oauth(&self, app: &AppHandle) -> Result<SyncStatusInfo, String> {
        let base_url = self
            .config
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .server_url
            .clone();
        let state = uuid::Uuid::new_v4().to_string();

        #[cfg(target_os = "android")]
        {
            let mut start_url = tauri::Url::parse(&format!("{base_url}/api/v1/auth/google/start"))
                .map_err(|e| format!("Invalid sync server URL: {e}"))?;
            start_url
                .query_pairs_mut()
                .append_pair("redirect_uri", "antigravity://auth/callback")
                .append_pair("state", &state);
            app.emit("agy:open-external-url", start_url.as_str())
                .map_err(|e| format!("Failed to emit browser launch event: {e}"))?;
            return Ok(self.status());
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = app;
            let listener = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind local OAuth callback port: {e}"))?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let redirect_uri = format!("http://127.0.0.1:{port}/callback");

            let mut start_url = tauri::Url::parse(&format!("{base_url}/api/v1/auth/google/start"))
                .map_err(|e| format!("Invalid sync server URL: {e}"))?;
            start_url
                .query_pairs_mut()
                .append_pair("redirect_uri", &redirect_uri)
                .append_pair("state", &state);

            open_system_browser(start_url.as_str())?;

            let (mut socket, _) = tokio::time::timeout(Duration::from_secs(180), listener.accept())
                .await
                .map_err(|_| "Timed out waiting for Google sign-in callback (180s)".to_string())?
                .map_err(|e| format!("OAuth callback accept error: {e}"))?;

            let mut buf = vec![0u8; 8192];
            let n = socket.read(&mut buf).await.unwrap_or(0);
            let req_text = String::from_utf8_lossy(&buf[..n]);
            let req_path = req_text
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or("/callback");

            let full_cb = format!("http://127.0.0.1:{port}{req_path}");
            let result = self.complete_oauth_callback(&full_cb, Some(&state));

            let html = match &result {
                Ok(st) => {
                    let name = st.user.as_ref().map(|u| u.name.as_str()).unwrap_or("Antigravity User");
                    let email = st.user.as_ref().map(|u| u.email.as_str()).unwrap_or("");
                    let avatar = st.user.as_ref().map(|u| u.avatar_url.as_str()).unwrap_or("");
                    render_loopback_callback_html(Ok((name, email, avatar)))
                }
                Err(e) => render_loopback_callback_html(Err(e.as_str())),
            };

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                html.len(),
                html
            );
            let _ = socket.write_all(response.as_bytes()).await;
            let _ = socket.shutdown().await;

            result
        }
    }
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn render_loopback_callback_html(outcome: Result<(&str, &str, &str), &str>) -> String {
    let logo_svg = r##"<svg class="brand-glyph" viewBox="0 0 100 100" fill="none" aria-hidden="true"><defs><linearGradient id="ag-grad" x1="18" y1="88" x2="82" y2="12" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#3B82F6"/><stop offset="38%" stop-color="#06B6D4"/><stop offset="68%" stop-color="#F59E0B"/><stop offset="100%" stop-color="#EF4444"/></linearGradient></defs><path d="M50 11C42.2 11 36.2 17.6 31.6 28.4L14.8 73.2C11.9 80.7 16.5 87.8 23.6 87.8C29.1 87.8 33.4 83.4 36.4 76.2C40.1 67.3 44.5 62.6 50 62.6C55.5 62.6 59.9 67.3 63.6 76.2C66.6 83.4 70.9 87.8 76.4 87.8C83.5 87.8 88.1 80.7 85.2 73.2L68.4 28.4C63.8 17.6 57.8 11 50 11Z" fill="url(#ag-grad)"/></svg>"##;

    let (title, subtitle, badge_cls, badge_inner, body_block) = match outcome {
        Ok((name, email, avatar)) => {
            let safe_name = escape_html(if name.is_empty() { "Antigravity User" } else { name });
            let safe_email = escape_html(email);
            let initial = name
                .chars()
                .next()
                .or_else(|| email.chars().next())
                .unwrap_or('A')
                .to_ascii_uppercase();
            let avatar_html = if !avatar.is_empty() {
                format!(
                    r#"<img class="avatar" src="{}" alt="{safe_name}" referrerpolicy="no-referrer"/>"#,
                    escape_html(avatar)
                )
            } else {
                format!(r#"<div class="avatar" aria-hidden="true">{initial}</div>"#)
            };
            (
                "Connected to Antigravity",
                "Your Google SSO session is synced with Antigravity Desktop. You can safely close this tab.",
                "ok",
                r#"<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5L6.5 11.5L12.5 4.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>"#,
                format!(
                    r#"<div class="user-pill">{avatar_html}<div class="user-meta"><div class="user-name">{safe_name}</div><div class="user-email">{safe_email}</div></div><span class="verified-tag">Connected</span></div>"#
                ),
            )
        }
        Err(err) => (
            "Sign-In Failed",
            "Please return to Antigravity Desktop and try signing in again.",
            "err",
            "!",
            format!(r#"<div class="error-box" role="alert">{}</div>"#, escape_html(err)),
        ),
    };

    format!(
        r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>{title} · Antigravity</title>
  <style>
    :root {{
      --bg-light: #faf9f5; --bg-dark: #141413;
      --surface-light: rgba(255,255,255,0.88); --surface-dark: rgba(28,28,26,0.88);
      --subtle-light: #f3f1ea; --subtle-dark: #232220;
      --border-light: rgba(20,20,19,0.09); --border-dark: rgba(250,249,245,0.10);
      --text-light: #141413; --text-dark: #f5f4ef;
      --muted-light: #6e6c65; --muted-dark: #9c9a92;
      --accent-light: #d97757; --accent-dark: #e08364;
      --success-light: #15803d; --success-dark: #4ade80;
      --success-bg-light: rgba(21,128,61,0.10); --success-bg-dark: rgba(74,222,128,0.14);
      --danger-light: #b91c1c; --danger-dark: #f87171;
      --danger-bg-light: rgba(185,28,28,0.09); --danger-bg-dark: rgba(248,113,113,0.14);
      --bg: var(--bg-light); --surface: var(--surface-light); --subtle: var(--subtle-light);
      --border: var(--border-light); --text: var(--text-light); --muted: var(--muted-light);
      --accent: var(--accent-light); --success: var(--success-light); --success-bg: var(--success-bg-light);
      --danger: var(--danger-light); --danger-bg: var(--danger-bg-light);
      @media (prefers-color-scheme: dark) {{
        --bg: var(--bg-dark); --surface: var(--surface-dark); --subtle: var(--subtle-dark);
        --border: var(--border-dark); --text: var(--text-dark); --muted: var(--muted-dark);
        --accent: var(--accent-dark); --success: var(--success-dark); --success-bg: var(--success-bg-dark);
        --danger: var(--danger-dark); --danger-bg: var(--danger-bg-dark);
      }}
      @supports (color: light-dark(white, black)) {{
        --bg: light-dark(var(--bg-light), var(--bg-dark));
        --surface: light-dark(var(--surface-light), var(--surface-dark));
        --subtle: light-dark(var(--subtle-light), var(--subtle-dark));
        --border: light-dark(var(--border-light), var(--border-dark));
        --text: light-dark(var(--text-light), var(--text-dark));
        --muted: light-dark(var(--muted-light), var(--muted-dark));
        --accent: light-dark(var(--accent-light), var(--accent-dark));
        --success: light-dark(var(--success-light), var(--success-dark));
        --success-bg: light-dark(var(--success-bg-light), var(--success-bg-dark));
        --danger: light-dark(var(--danger-light), var(--danger-dark));
        --danger-bg: light-dark(var(--danger-bg-light), var(--danger-bg-dark));
      }}
      color-scheme: light dark;
      accent-color: var(--accent);
    }}
    *, *::before, *::after {{ box-sizing: border-box; }}
    html, body {{ margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", sans-serif; -webkit-font-smoothing: antialiased; }}
    body {{ display: grid; place-items: center; padding: 24px 16px; position: relative; }}
    .aura {{ position: fixed; inset: 0; pointer-events: none; background: radial-gradient(640px 420px at 50% 18%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 72%), radial-gradient(520px 360px at 80% 82%, rgba(59,130,246,0.08), transparent 72%); }}
    .card {{ position: relative; z-index: 1; width: 100%; max-width: 430px; background: var(--surface); border: 1px solid var(--border); border-radius: 24px; padding: 32px 28px 26px; box-shadow: 0 24px 64px -20px rgba(0,0,0,0.22); backdrop-filter: blur(18px); }}
    @media (prefers-reduced-motion: no-preference) {{ .card {{ animation: enter 420ms cubic-bezier(0.16,1,0.3,1) both; }} }}
    @keyframes enter {{ from {{ opacity: 0; transform: translateY(12px) scale(0.985); }} to {{ opacity: 1; transform: translateY(0) scale(1); }} }}
    .brand-row {{ display: flex; justify-content: center; margin-bottom: 22px; }}
    .brand-wrap {{ position: relative; width: 52px; height: 52px; border-radius: 16px; background: var(--subtle); border: 1px solid var(--border); display: grid; place-items: center; }}
    .brand-glyph {{ width: 32px; height: 32px; display: block; }}
    .badge {{ position: absolute; right: -5px; bottom: -5px; width: 22px; height: 22px; border-radius: 999px; display: grid; place-items: center; border: 2.5px solid var(--bg); color: #fff; font-size: 12px; font-weight: 700; }}
    .badge.ok {{ background: var(--success); }}
    .badge.err {{ background: var(--danger); }}
    h1 {{ margin: 0 0 8px; text-align: center; font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }}
    p.sub {{ margin: 0 0 22px; text-align: center; font-size: 14px; line-height: 1.55; color: var(--muted); }}
    .user-pill {{ display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--subtle); border: 1px solid var(--border); margin-bottom: 20px; }}
    .avatar {{ width: 40px; height: 40px; border-radius: 999px; object-fit: cover; flex-shrink: 0; background: var(--accent); color: #fff; font-weight: 650; font-size: 15px; display: grid; place-items: center; }}
    .user-meta {{ min-width: 0; flex: 1; }}
    .user-name {{ font-size: 14.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .user-email {{ font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .verified-tag {{ font-size: 11px; font-weight: 600; padding: 4px 9px; border-radius: 999px; background: var(--success-bg); color: var(--success); }}
    .error-box {{ padding: 12px 14px; border-radius: 14px; background: var(--danger-bg); color: var(--danger); font-size: 13px; margin-bottom: 20px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; }}
    .btn {{ width: 100%; min-height: 44px; border-radius: 13px; border: 1px solid var(--border); background: var(--accent); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 150ms ease; }}
    .btn:hover {{ opacity: 0.92; }}
    .hint {{ margin-top: 12px; text-align: center; font-size: 12px; color: var(--muted); }}
    .footer {{ margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); display: flex; justify-content: space-between; font-size: 11.5px; color: var(--muted); }}
  </style>
</head>
<body>
  <div class="aura" aria-hidden="true"></div>
  <main class="card" role="main">
    <div class="brand-row"><div class="brand-wrap">{logo_svg}<span class="badge {badge_cls}" aria-hidden="true">{badge_inner}</span></div></div>
    <h1>{title}</h1>
    <p class="sub">{subtitle}</p>
    {body_block}
    <button type="button" class="btn" id="close-btn">Close This Tab</button>
    <div class="hint" id="hint">Shortcut: ⌘W / Ctrl+W</div>
    <footer class="footer"><span>Antigravity Desktop</span><span>Localhost OAuth Loopback</span></footer>
  </main>
  <script>
    (function(){{
      var btn = document.getElementById('close-btn');
      var hint = document.getElementById('hint');
      if (btn) btn.addEventListener('click', function(){{
        window.close();
        if (hint) hint.textContent = 'Browser prevented auto-close — press ⌘W or Ctrl+W to close.';
      }});
    }})();
  </script>
</body>
</html>"##
    )
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(url).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd").args(["/C", "start", "", url]).status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open").arg(url).status();

    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(s) => Err(format!("Browser command exited with status {s}")),
        Err(e) => Err(format!("Failed to launch system browser: {e}")),
    }
}
