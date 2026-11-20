#![cfg_attr(not(desktop), allow(dead_code, unused_imports, unused_variables))]

mod auth;
mod protocol;
mod sync;
mod updater;

use auth::{parse_raw_cookies, AccountSummary, AuthStore};
use protocol::client::{
    AgentStreamEvent, AllSessionsSnapshot, AntigravityClient, QuotaDashboardSnapshot,
};
use protocol::wire::DeviceInstance;
use sync::{SyncClient, SyncStatusInfo};
use updater::{ReleaseAssetInfo, UpdateCheckResult, UpdateDownloadEvent};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

#[cfg(desktop)]
use tauri::{Url, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0";
#[cfg(target_os = "macos")]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

struct AppState {
    auth: Arc<AuthStore>,
    client: Arc<AntigravityClient>,
    sync: Arc<SyncClient>,
    active_streams: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

#[tauri::command]
fn list_accounts(state: State<'_, AppState>) -> Vec<AccountSummary> {
    state.auth.list_accounts()
}

#[tauri::command]
async fn import_account_cookies(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: Option<String>,
    label: Option<String>,
    email: Option<String>,
    raw_input: String,
    auth_user: Option<u32>,
) -> Result<AccountSummary, String> {
    let parsed = parse_raw_cookies(&raw_input)?;
    let cookies = parsed.google_cookies;
    let accounts_cookies = parsed.accounts_cookies;
    let has_sapisid = cookies.contains_key("SAPISID")
        || cookies.contains_key("__Secure-3PAPISID")
        || cookies.contains_key("__Secure-1PAPISID");
    let has_sid = cookies.contains_key("SID")
        || cookies.contains_key("__Secure-1PSID")
        || cookies.contains_key("__Secure-3PSID");
    if !has_sapisid || !has_sid {
        return Err(
            "Invalid cookies: missing required Google auth tokens (SAPISID / SID). Please export cookies from antigravity.google.com."
                .to_string(),
        );
    }

    let is_new = account_id.is_none();
    let summary = state.auth.upsert_account_cookies(
        account_id,
        label,
        email,
        cookies,
        accounts_cookies,
        auth_user,
    )?;

    // Verify cookies live against Google Antigravity before committing & syncing to Cloud Vault
    if let Err(err) = state.client.list_instances(Some(&summary.id)).await {
        if is_new {
            let _ = state.auth.remove_account(&summary.id);
        }
        return Err(format!("Cookie verification failed (expired or unauthorized): {err}"));
    }

    // Verified valid! Auto-push encrypted vault to Cloud Sync if signed in
    if state.sync.status().signed_in {
        if let Ok(st) = state.sync.push_vault().await {
            let _ = app.emit("agy:sync-updated", &st);
        }
    }

    Ok(summary)
}

#[tauri::command]
fn toggle_account(
    state: State<'_, AppState>,
    account_id: String,
    enabled: bool,
) -> Result<Vec<AccountSummary>, String> {
    state.auth.toggle_account(&account_id, enabled)
}

#[tauri::command]
fn remove_account(
    state: State<'_, AppState>,
    account_id: String,
) -> Result<Vec<AccountSummary>, String> {
    state.auth.remove_account(&account_id)
}

#[tauri::command]
fn export_vault_json(state: State<'_, AppState>) -> Result<String, String> {
    state.auth.export_vault_json()
}

#[tauri::command]
fn import_vault_json(
    state: State<'_, AppState>,
    raw_json: String,
) -> Result<Vec<AccountSummary>, String> {
    state.auth.import_vault_json(&raw_json)
}

#[tauri::command]
fn sync_get_status(state: State<'_, AppState>) -> SyncStatusInfo {
    state.sync.status()
}

#[tauri::command]
fn sync_set_server_url(
    state: State<'_, AppState>,
    server_url: String,
) -> Result<SyncStatusInfo, String> {
    state.sync.set_server_url(&server_url)
}

#[tauri::command]
async fn sync_login_google_id_token(
    state: State<'_, AppState>,
    id_token: String,
) -> Result<SyncStatusInfo, String> {
    state.sync.login_google_id_token(&id_token).await
}

#[tauri::command]
async fn sync_login_dev_sso(
    state: State<'_, AppState>,
    email: String,
    name: Option<String>,
) -> Result<SyncStatusInfo, String> {
    state.sync.login_dev_sso(&email, name).await
}

#[tauri::command]
async fn sync_start_google_oauth(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SyncStatusInfo, String> {
    state.sync.start_google_oauth(&app).await
}

#[tauri::command]
fn sync_complete_oauth_callback(
    state: State<'_, AppState>,
    callback_url: String,
) -> Result<SyncStatusInfo, String> {
    state.sync.complete_oauth_callback(&callback_url, None)
}

#[tauri::command]
fn sync_logout(state: State<'_, AppState>) -> Result<SyncStatusInfo, String> {
    state.sync.logout()
}

#[tauri::command]
async fn sync_push_vault(state: State<'_, AppState>) -> Result<SyncStatusInfo, String> {
    state.sync.push_vault().await
}

#[tauri::command]
async fn sync_pull_vault(
    state: State<'_, AppState>,
) -> Result<(SyncStatusInfo, Vec<AccountSummary>), String> {
    state.sync.pull_vault().await
}

#[tauri::command]
async fn check_app_update(repo: Option<String>) -> Result<UpdateCheckResult, String> {
    updater::check_github_update(repo).await
}

#[tauri::command]
async fn download_app_update(
    app: AppHandle,
    asset: ReleaseAssetInfo,
    strategy: String,
    on_event: Channel<UpdateDownloadEvent>,
) -> Result<String, String> {
    let updates_dir = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("antigravity-updates"))
        .join("updates");

    let path = updater::download_and_verify_update(updates_dir, asset, strategy, move |evt| {
        let _ = on_event.send(evt);
    })
    .await?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_google_login(app: AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        if let Some(existing) = app.get_webview_window("google-login") {
            let _ = existing.show();
            let _ = existing.set_focus();
            return Ok(());
        }
        let parsed: Url = "https://antigravity.google.com/remote"
            .parse()
            .map_err(|e| format!("{e}"))?;
        let win = WebviewWindowBuilder::new(&app, "google-login", WebviewUrl::External(parsed))
            .title("Sign in to Google Antigravity")
            .inner_size(520.0, 740.0)
            .user_agent(GOOGLE_SAFE_USER_AGENT)
            .build()
            .map_err(|e| e.to_string())?;
        let _ = win.show();
        let _ = win.set_focus();

        // Automatically watch the login window and harvest HttpOnly Google cookies
        // as soon as sign-in completes and redirects back to antigravity.google.com.
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let target_url: Url = match "https://antigravity.google.com/".parse() {
                Ok(u) => u,
                Err(_) => return,
            };
            let accounts_url: Url = match "https://accounts.google.com/".parse() {
                Ok(u) => u,
                Err(_) => return,
            };
            for _ in 0..240 {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                let Some(login_win) = app_handle.get_webview_window("google-login") else {
                    break;
                };
                let on_agy = login_win
                    .url()
                    .ok()
                    .and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case("antigravity.google.com")))
                    .unwrap_or(false);
                if !on_agy {
                    continue;
                }
                let Ok(cookies) = login_win.cookies_for_url(target_url.clone()) else {
                    continue;
                };
                let mut map = HashMap::new();
                for c in cookies {
                    map.insert(c.name().to_string(), c.value().to_string());
                }
                let has_sapisid = map.contains_key("SAPISID")
                    || map.contains_key("__Secure-3PAPISID")
                    || map.contains_key("__Secure-1PAPISID");
                let has_sid = map.contains_key("SID")
                    || map.contains_key("__Secure-1PSID")
                    || map.contains_key("__Secure-3PSID");
                if !has_sapisid || !has_sid {
                    continue;
                }

                // Also harvest accounts.google.com host-only cookies (__Host-1PLSID, __Host-3PLSID, LSID)
                // so our background RotateCookies keepalive can continuously refresh __Secure-1PSIDTS!
                let mut accounts_map = HashMap::new();
                if let Ok(acc_cookies) = login_win.cookies_for_url(accounts_url.clone()) {
                    for c in acc_cookies {
                        accounts_map.insert(c.name().to_string(), c.value().to_string());
                    }
                }

                let state = app_handle.state::<AppState>();
                let sync_email = state
                    .sync
                    .status()
                    .user
                    .map(|u| u.email)
                    .filter(|e| !e.is_empty());
                let label = sync_email
                    .as_deref()
                    .and_then(|e| e.split('@').next())
                    .map(|s| s.to_string())
                    .or_else(|| Some("Google Account".to_string()));

                if let Ok(summary) = state.auth.upsert_account_cookies(
                    None,
                    label,
                    sync_email,
                    map,
                    accounts_map,
                    Some(0),
                ) {
                    if summary.authenticated {
                        let _ = login_win.close();
                        let _ = app_handle.emit("agy:account-captured", &summary);
                        // Auto-push encrypted vault to Cloud Sync if signed in, so Mobile syncs automatically
                        if state.sync.status().signed_in {
                            if let Ok(st) = state.sync.push_vault().await {
                                let _ = app_handle.emit("agy:sync-updated", &st);
                            }
                        }
                        break;
                    }
                }
            }
        });

        Ok(())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("Use Cloud Sync (1-Tap Google SSO) or Cookie Import on mobile".to_string())
    }
}

#[tauri::command]
fn harvest_login_cookies(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: Option<String>,
    label: Option<String>,
    email: Option<String>,
    auth_user: Option<u32>,
) -> Result<AccountSummary, String> {
    #[cfg(desktop)]
    {
        let win = app
            .get_webview_window("google-login")
            .ok_or_else(|| "Google login window is not open".to_string())?;
        let url: Url = "https://antigravity.google.com/"
            .parse()
            .map_err(|e| format!("{e}"))?;
        let accounts_url: Url = "https://accounts.google.com/"
            .parse()
            .map_err(|e| format!("{e}"))?;
        let cookies = win.cookies_for_url(url).map_err(|e| e.to_string())?;
        let mut map = HashMap::new();
        for c in cookies {
            map.insert(c.name().to_string(), c.value().to_string());
        }
        let mut accounts_map = HashMap::new();
        if let Ok(acc_cookies) = win.cookies_for_url(accounts_url) {
            for c in acc_cookies {
                accounts_map.insert(c.name().to_string(), c.value().to_string());
            }
        }
        let summary = state.auth.upsert_account_cookies(
            account_id,
            label,
            email,
            map,
            accounts_map,
            auth_user,
        )?;
        if summary.authenticated {
            let _ = win.close();
        }
        Ok(summary)
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, state, account_id, label, email, auth_user);
        Err("harvest_login_cookies is desktop-only".to_string())
    }
}

#[tauri::command]
async fn list_instances(
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<Vec<DeviceInstance>, String> {
    state.client.list_instances(account_id.as_deref()).await
}

#[tauri::command]
async fn list_all_sessions(state: State<'_, AppState>) -> Result<AllSessionsSnapshot, String> {
    state.client.list_all_sessions().await
}

#[tauri::command]
async fn get_trajectory_steps(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
    step_offset: Option<u32>,
) -> Result<Value, String> {
    state
        .client
        .get_trajectory_steps(&account_id, &device_uuid, &cascade_id, step_offset.unwrap_or(0))
        .await
}

#[tauri::command]
async fn start_cascade(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    workspace_uri: Option<String>,
    project_id: Option<String>,
) -> Result<Value, String> {
    state
        .client
        .start_cascade(&account_id, &device_uuid, workspace_uri, project_id)
        .await
}

#[tauri::command]
async fn send_user_message(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
    text: String,
    model: Option<String>,
    media: Option<Vec<Value>>,
) -> Result<Value, String> {
    state
        .client
        .send_user_message(&account_id, &device_uuid, &cascade_id, &text, model, media)
        .await
}

#[tauri::command]
async fn get_user_status(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
) -> Result<Value, String> {
    state.client.get_user_status(&account_id, &device_uuid).await
}

#[tauri::command]
async fn handle_user_interaction(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
    interaction: Value,
) -> Result<Value, String> {
    state
        .client
        .handle_user_interaction(&account_id, &device_uuid, &cascade_id, interaction)
        .await
}

#[tauri::command]
async fn cancel_invocation(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
) -> Result<Value, String> {
    state
        .client
        .cancel_invocation(&account_id, &device_uuid, &cascade_id)
        .await
}

#[tauri::command]
async fn get_model_configs(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
) -> Result<Value, String> {
    state.client.get_model_configs(&account_id, &device_uuid).await
}

#[tauri::command]
async fn get_all_accounts_quota(
    state: State<'_, AppState>,
) -> Result<QuotaDashboardSnapshot, String> {
    state.client.get_all_accounts_quota().await
}

#[tauri::command]
async fn rotate_account_cookies(
    app: AppHandle,
    state: State<'_, AppState>,
    account_id: Option<String>,
) -> Result<bool, String> {
    let changed = if let Some(aid) = account_id.filter(|s| !s.is_empty()) {
        state.client.rotate_cookies_for_account(&aid).await?
    } else {
        state.client.rotate_all_enabled_accounts().await
    };
    if changed && state.sync.status().signed_in {
        if let Ok(st) = state.sync.push_vault().await {
            let _ = app.emit("agy:sync-updated", &st);
        }
    }
    Ok(changed)
}

#[tauri::command]
async fn proxy_raw_rpc(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    rpc_path: String,
    request_json: Value,
) -> Result<Value, String> {
    state
        .client
        .proxy_unary_json(&account_id, &device_uuid, &rpc_path, request_json)
        .await
}

#[tauri::command]
async fn stream_agent_state(
    state: State<'_, AppState>,
    stream_id: String,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
    on_event: Channel<AgentStreamEvent>,
) -> Result<(), String> {
    let (tx, rx) = oneshot::channel::<()>();
    {
        let mut streams = state
            .active_streams
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(prev) = streams.insert(stream_id.clone(), tx) {
            let _ = prev.send(());
        }
    }

    let client = state.client.clone();
    tauri::async_runtime::spawn(async move {
        client
            .stream_agent_state(
                account_id,
                device_uuid,
                cascade_id,
                move |evt| {
                    let _ = on_event.send(evt);
                },
                rx,
            )
            .await;
    });

    Ok(())
}

#[tauri::command]
fn stop_agent_stream(state: State<'_, AppState>, stream_id: String) -> Result<(), String> {
    let mut streams = state
        .active_streams
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = streams.remove(&stream_id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("antigravity-app"));
            let auth = Arc::new(AuthStore::new(data_dir.clone()));
            let client = Arc::new(AntigravityClient::new(auth.clone()));
            let sync = Arc::new(SyncClient::new(data_dir, auth.clone()));

            // High-availability background Google Cookie HFCR keepalive loop (every 8 min < 600s window)
            let bg_client = client.clone();
            let bg_sync = sync.clone();
            let bg_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(480));
                // First tick after 30s startup grace period
                interval.tick().await;
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                loop {
                    let changed = bg_client.rotate_all_enabled_accounts().await;
                    if changed && bg_sync.status().signed_in {
                        if let Ok(st) = bg_sync.push_vault().await {
                            let _ = bg_app.emit("agy:sync-updated", &st);
                        }
                    }
                    interval.tick().await;
                }
            });

            app.manage(AppState {
                auth,
                client,
                sync,
                active_streams: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            import_account_cookies,
            toggle_account,
            remove_account,
            export_vault_json,
            import_vault_json,
            sync_get_status,
            sync_set_server_url,
            sync_login_google_id_token,
            sync_login_dev_sso,
            sync_start_google_oauth,
            sync_complete_oauth_callback,
            sync_logout,
            sync_push_vault,
            sync_pull_vault,
            check_app_update,
            download_app_update,
            open_google_login,
            harvest_login_cookies,
            list_instances,
            list_all_sessions,
            get_trajectory_steps,
            start_cascade,
            send_user_message,
            handle_user_interaction,
            cancel_invocation,
            get_model_configs,
            get_user_status,
            get_all_accounts_quota,
            rotate_account_cookies,
            proxy_raw_rpc,
            stream_agent_state,
            stop_agent_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running Antigravity native application");
}
