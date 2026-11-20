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
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use sync::{SyncClient, SyncStatusInfo};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;
use updater::{ReleaseAssetInfo, UpdateCheckResult, UpdateDownloadEvent};

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

#[cfg(target_os = "macos")]
fn merge_webkit_cookie_fallback(
    app: &AppHandle,
    cookies: &mut HashMap<String, String>,
    accounts_cookies: &mut HashMap<String, String>,
) {
    let (google, accounts) = crate::auth::read_webkit_binary_cookies(&app.config().identifier);
    for (name, value) in google {
        cookies.entry(name).or_insert(value);
    }
    for (name, value) in accounts {
        accounts_cookies.entry(name).or_insert(value);
    }
}

#[tauri::command]
fn list_accounts(state: State<'_, AppState>) -> Vec<AccountSummary> {
    state.auth.list_accounts()
}

#[tauri::command]
async fn refresh_account_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<AccountSummary>, String> {
    for account in state.auth.enabled_authenticated_accounts() {
        let needs_profile = account.email.trim().is_empty()
            || account.name.trim().is_empty()
            || account.label.starts_with("Google Account");
        if !needs_profile {
            continue;
        }
        if let Some(identity) = state.client.resolve_account_identity(&account.id).await {
            let preferred_label = if account.label.starts_with("Google Account") {
                None
            } else {
                Some(account.label.clone())
            };
            let _ = state.auth.update_account_profile(
                &account.id,
                identity.email,
                identity.name,
                identity.avatar_url,
                preferred_label,
            );
        }
    }
    Ok(state.auth.list_accounts())
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
        return Err(format!(
            "Cookie verification failed (expired or unauthorized): {err}"
        ));
    }

    // Verified valid! Auto-push encrypted vault to Cloud Sync if signed in
    if state.sync.status().signed_in {
        if let Ok(st) = state.sync.push_vault().await {
            state.auth.clear_dirty();
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
    let status = state.sync.push_vault().await?;
    state.auth.clear_dirty();
    Ok(status)
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
fn open_google_login(
    app: AppHandle,
    label: Option<String>,
    email: Option<String>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let account_label = label
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let account_email = email
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                account_label
                    .as_deref()
                    .filter(|value| value.contains('@'))
                    .map(|value| value.to_string())
            });
        if let Some(existing) = app.get_webview_window("google-login") {
            // Recreate instead of reusing the old page: it may already be
            // signed in as the first account and would auto-redirect again.
            let _ = existing.close();
        }
        // `AddSession` + `prompt=select_account` forces Google to show the
        // account chooser ("Use another account") instead of silently
        // reusing the first Google session in the shared WebKit cookie store.
        let mut login_url =
            Url::parse("https://accounts.google.com/AddSession").map_err(|e| format!("{e}"))?;
        login_url
            .query_pairs_mut()
            .append_pair("continue", "https://antigravity.google.com/remote")
            .append_pair("prompt", "select_account");
        let win = WebviewWindowBuilder::new(&app, "google-login", WebviewUrl::External(login_url))
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
            for _ in 0..240 {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                let Some(login_win) = app_handle.get_webview_window("google-login") else {
                    break;
                };
                let on_agy = login_win
                    .url()
                    .ok()
                    .and_then(|u| {
                        u.host_str()
                            .map(|h| h.eq_ignore_ascii_case("antigravity.google.com"))
                    })
                    .unwrap_or(false);
                if !on_agy {
                    continue;
                }
                // `cookies_for_url` can return Err on macOS even though the
                // live WKWebView cookie store has everything. `cookies()` reads
                // the whole store and works while the login window is still open.
                let mut map = HashMap::new();
                let mut accounts_map = HashMap::new();
                if let Ok(cookies) = login_win.cookies() {
                    for c in cookies {
                        let domain = c.domain().unwrap_or_default();
                        if domain == "accounts.google.com" {
                            accounts_map.insert(c.name().to_string(), c.value().to_string());
                        } else if domain == "antigravity.google.com"
                            || domain == "google.com"
                            || domain == ".google.com"
                            || domain == "google.com.sg"
                            || domain == ".google.com.sg"
                        {
                            map.insert(c.name().to_string(), c.value().to_string());
                        }
                    }
                }
                // Merge the WebKit binary cookie store BEFORE checking for
                // SAPISID/SID: cookies_for_url can return Err/empty on macOS.
                #[cfg(target_os = "macos")]
                merge_webkit_cookie_fallback(&app_handle, &mut map, &mut accounts_map);

                let has_sapisid = map.contains_key("SAPISID")
                    || map.contains_key("__Secure-3PAPISID")
                    || map.contains_key("__Secure-1PAPISID");
                let has_sid = map.contains_key("SID")
                    || map.contains_key("__Secure-1PSID")
                    || map.contains_key("__Secure-3PSID");
                if !has_sapisid || !has_sid {
                    continue;
                }

                let state = app_handle.state::<AppState>();
                // Use the label/email captured before opening AddSession. The
                // Cloud Sync email belongs to the first account and must never
                // overwrite the identity of the account that just signed in.
                let label = account_label
                    .clone()
                    .or_else(|| Some("Google Account".to_string()));

                if let Ok(mut summary) = state.auth.upsert_account_cookies(
                    None,
                    label,
                    account_email.clone(),
                    map,
                    accounts_map,
                    Some(0),
                ) {
                    if summary.authenticated {
                        // Resolve the real Google profile from the newly
                        // captured account; outer-account login has no form label.
                        if let Some(identity) =
                            state.client.resolve_account_identity(&summary.id).await
                        {
                            let preferred_label = account_label
                                .clone()
                                .filter(|value| !value.starts_with("Google Account"));
                            if let Ok(updated) = state.auth.update_account_profile(
                                &summary.id,
                                identity.email,
                                identity.name,
                                identity.avatar_url,
                                preferred_label,
                            ) {
                                summary = updated;
                            }
                        }
                        let _ = login_win.close();
                        let _ = app_handle.emit("agy:account-captured", &summary);
                        // Auto-push encrypted vault to Cloud Sync if signed in, so Mobile syncs automatically
                        if state.sync.status().signed_in {
                            if let Ok(st) = state.sync.push_vault().await {
                                state.auth.clear_dirty();
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
        let mut map = HashMap::new();
        let mut accounts_map = HashMap::new();
        if let Ok(cookies) = win.cookies() {
            for c in cookies {
                let domain = c.domain().unwrap_or_default();
                if domain == "accounts.google.com" {
                    accounts_map.insert(c.name().to_string(), c.value().to_string());
                } else if domain == "antigravity.google.com"
                    || domain == "google.com"
                    || domain == ".google.com"
                    || domain == "google.com.sg"
                    || domain == ".google.com.sg"
                {
                    map.insert(c.name().to_string(), c.value().to_string());
                }
            }
        }
        #[cfg(target_os = "macos")]
        merge_webkit_cookie_fallback(&app, &mut map, &mut accounts_map);
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
        .get_trajectory_steps(
            &account_id,
            &device_uuid,
            &cascade_id,
            step_offset.unwrap_or(0),
        )
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
    state
        .client
        .get_user_status(&account_id, &device_uuid)
        .await
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
    state
        .client
        .get_model_configs(&account_id, &device_uuid)
        .await
}

#[tauri::command]
async fn get_workspace_infos(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
) -> Result<Value, String> {
    state
        .client
        .get_workspace_infos(&account_id, &device_uuid)
        .await
}

#[tauri::command]
async fn get_slash_commands(
    state: State<'_, AppState>,
    account_id: String,
    device_uuid: String,
    cascade_id: String,
    model: Option<String>,
) -> Result<Value, String> {
    state
        .client
        .get_slash_commands(&account_id, &device_uuid, &cascade_id, model)
        .await
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
            state.auth.clear_dirty();
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
            let bg_auth = auth.clone();
            let bg_auth_rotate = auth.clone();
            let bg_sync_dirty = sync.clone();
            let bg_app_dirty = app.handle().clone();
            let profile_client = client.clone();
            let profile_auth = auth.clone();
            let profile_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(480));
                // First tick after 30s startup grace period
                interval.tick().await;
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                loop {
                    let changed = bg_client.rotate_all_enabled_accounts().await;
                    if changed && bg_sync.status().signed_in {
                        if let Ok(st) = bg_sync.push_vault().await {
                            bg_auth_rotate.clear_dirty();
                            let _ = bg_app.emit("agy:sync-updated", &st);
                        }
                    }
                    interval.tick().await;
                }
            });

            // Cookie self-heal / imports / label changes mark AuthStore dirty.
            // Push that state to Cloud Vault promptly, even when the user did
            // not click an explicit sync button.
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
                interval.tick().await;
                loop {
                    interval.tick().await;
                    if !bg_auth.is_dirty() || !bg_sync_dirty.status().signed_in {
                        continue;
                    }
                    if let Ok(st) = bg_sync_dirty.push_vault().await {
                        bg_auth.clear_dirty();
                        let _ = bg_app_dirty.emit("agy:sync-updated", &st);
                    }
                }
            });

            // Resolve real Google profile data for legacy/cookie-imported
            // accounts. Runs in Rust so it does not depend on the WebView
            // being ready or on IPC.
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                for account in profile_auth.enabled_authenticated_accounts() {
                    let needs_profile = account.email.trim().is_empty()
                        || account.name.trim().is_empty()
                        || account.label.starts_with("Google Account");
                    if !needs_profile {
                        continue;
                    }
                    if let Some(identity) =
                        profile_client.resolve_account_identity(&account.id).await
                    {
                        let preferred_label = if account.label.starts_with("Google Account") {
                            None
                        } else {
                            Some(account.label.clone())
                        };
                        let _ = profile_auth.update_account_profile(
                            &account.id,
                            identity.email,
                            identity.name,
                            identity.avatar_url,
                            preferred_label,
                        );
                    }
                }
                let _ = profile_app.emit("agy:accounts-updated", ());
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
            refresh_account_profiles,
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
            get_workspace_infos,
            get_slash_commands,
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
