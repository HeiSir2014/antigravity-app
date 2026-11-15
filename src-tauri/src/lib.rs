#![cfg_attr(not(desktop), allow(dead_code, unused_imports, unused_variables))]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};

const GEMINI_URL: &str = "https://gemini.google.com/app";
const ANTIGRAVITY_REMOTE_URL: &str = "https://antigravity.google.com/remote";

/// Native-matched platform User-Agents so accounts.google.com and anti-bot systems
/// never detect OS-fingerprint mismatches (e.g. Mac UA on Windows WebView2, or Chrome UA in WebKit).
#[cfg(target_os = "windows")]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0";

#[cfg(target_os = "macos")]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";

#[cfg(target_os = "linux")]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
const GOOGLE_SAFE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15";

const AGY_BRIDGE_SCRIPT: &str = include_str!("../../src/generated/agy-bridge.iife.js");
const GEMINI_BRIDGE_SCRIPT: &str = include_str!("../../src/generated/gemini-bridge.iife.js");

#[derive(Default)]
struct SharedEngineState {
    active_engine: Mutex<String>,
    unified_state_json: Mutex<String>,
    pending_teleport_prompt: Mutex<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeBridgePayload {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub engine: Option<String>,
    pub prompt: Option<String>,
    #[serde(rename = "sourceTitle")]
    pub source_title: Option<String>,
    #[serde(rename = "sessionId")]
    pub session_id: Option<String>,
    #[serde(rename = "requestId")]
    pub request_id: Option<String>,
    #[serde(rename = "toolName")]
    pub tool_name: Option<String>,
    #[serde(rename = "commandText")]
    pub command_text: Option<String>,
    pub decision: Option<String>,
    pub comment: Option<String>,
}

#[tauri::command]
fn switch_engine(
    app: AppHandle,
    state: State<'_, SharedEngineState>,
    engine: String,
) -> Result<String, String> {
    let mut active = state
        .active_engine
        .lock()
        .map_err(|_| "Mutex poisoned".to_string())?;
    *active = engine.clone();

    #[cfg(desktop)]
    {
        let (show_name, hide_name, target_url, bridge_script, title) = if engine == "gemini" {
            ("gemini", "antigravity", GEMINI_URL, GEMINI_BRIDGE_SCRIPT, "Antigravity — Gemini Chat")
        } else {
            ("antigravity", "gemini", ANTIGRAVITY_REMOTE_URL, AGY_BRIDGE_SCRIPT, "Antigravity — Remote Control")
        };

        let mut sync_pos = None;
        let mut sync_size = None;

        if let Some(hide_win) = app.get_webview_window(hide_name) {
            if let Ok(pos) = hide_win.outer_position() {
                sync_pos = Some(pos);
            }
            if let Ok(size) = hide_win.inner_size() {
                sync_size = Some(size);
            }
        }

        let parsed: Url = target_url.parse().map_err(|e| format!("{e}"))?;

        let target_win = if let Some(win) = app.get_webview_window(show_name) {
            if let Some(pos) = sync_pos {
                let _ = win.set_position(pos);
            }
            if let Some(size) = sync_size {
                let _ = win.set_size(size);
            }
            if let Ok(cur_url) = win.url() {
                if !cur_url.as_str().starts_with(target_url) {
                    let _ = win.navigate(parsed);
                }
            }
            let _ = win.set_title(title);
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
            win
        } else {
            let mut builder = WebviewWindowBuilder::new(&app, show_name, WebviewUrl::External(parsed))
                .title(title)
                .inner_size(1280.0, 860.0)
                .user_agent(GOOGLE_SAFE_USER_AGENT)
                .initialization_script_for_all_frames(bridge_script);
            if let Some(pos) = sync_pos {
                builder = builder.position(pos.x as f64, pos.y as f64);
            }
            let win = builder.build().map_err(|e| e.to_string())?;
            let _ = win.show();
            let _ = win.set_focus();
            win
        };

        // Hide previous window only AFTER the target window is shown and focused to prevent macOS deactivation
        if let Some(hide_win) = app.get_webview_window(hide_name) {
            let _ = hide_win.hide();
        }

        let _ = target_win.set_focus();
    }

    Ok(engine)
}

#[tauri::command]
fn navigate_to_remote_session(
    app: AppHandle,
    state: State<'_, SharedEngineState>,
    target_url: String,
) -> Result<(), String> {
    let is_agy = target_url.starts_with("https://antigravity.google.com/");
    let is_gemini = target_url.starts_with("https://gemini.google.com/");
    if !is_agy && !is_gemini {
        return Err("Invalid target origin".to_string());
    }
    let parsed: Url = target_url.parse().map_err(|e| format!("{e}"))?;

    {
        let mut active = state
            .active_engine
            .lock()
            .map_err(|_| "Mutex poisoned".to_string())?;
        *active = if is_gemini {
            "gemini".to_string()
        } else {
            "antigravity".to_string()
        };
    }

    #[cfg(desktop)]
    {
        let (show_name, hide_name, bridge_script, title) = if is_gemini {
            ("gemini", "antigravity", GEMINI_BRIDGE_SCRIPT, "Antigravity — Gemini Chat")
        } else {
            ("antigravity", "gemini", AGY_BRIDGE_SCRIPT, "Antigravity — Remote Control")
        };

        let mut sync_pos = None;
        let mut sync_size = None;

        if let Some(hide_win) = app.get_webview_window(hide_name) {
            if let Ok(pos) = hide_win.outer_position() {
                sync_pos = Some(pos);
            }
            if let Ok(size) = hide_win.inner_size() {
                sync_size = Some(size);
            }
        }

        let target_win = if let Some(win) = app.get_webview_window(show_name) {
            if let Some(pos) = sync_pos {
                let _ = win.set_position(pos);
            }
            if let Some(size) = sync_size {
                let _ = win.set_size(size);
            }
            let _ = win.navigate(parsed);
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
            win
        } else {
            let mut builder = WebviewWindowBuilder::new(&app, show_name, WebviewUrl::External(parsed))
                .title(title)
                .inner_size(1280.0, 860.0)
                .user_agent(GOOGLE_SAFE_USER_AGENT)
                .initialization_script_for_all_frames(bridge_script);
            if let Some(pos) = sync_pos {
                builder = builder.position(pos.x as f64, pos.y as f64);
            }
            let win = builder.build().map_err(|e| e.to_string())?;
            let _ = win.show();
            let _ = win.set_focus();
            win
        };

        if let Some(hide_win) = app.get_webview_window(hide_name) {
            let _ = hide_win.hide();
        }

        let _ = target_win.set_focus();
    }

    Ok(())
}

#[tauri::command]
fn agy_bridge_message(
    app: AppHandle,
    state: State<'_, SharedEngineState>,
    payload: NativeBridgePayload,
) -> Result<Option<String>, String> {
    match payload.msg_type.as_str() {
        "SWITCH_ENGINE" => {
            let target = payload.engine.unwrap_or_else(|| "antigravity".to_string());
            let _ = switch_engine(app, state, target)?;
            Ok(None)
        }
        "TELEPORT_TO_CODE" => {
            if let Some(prompt) = payload.prompt {
                if let Ok(mut guard) = state.pending_teleport_prompt.lock() {
                    *guard = Some(prompt);
                }
            }
            let _ = switch_engine(app, state, "antigravity".to_string())?;
            Ok(None)
        }
        "CONSUME_TELEPORT" => {
            let mut guard = state
                .pending_teleport_prompt
                .lock()
                .map_err(|_| "Mutex poisoned".to_string())?;
            Ok(guard.take())
        }
        _ => Ok(None),
    }
}

#[tauri::command]
fn sync_unified_state(
    state: State<'_, SharedEngineState>,
    state_json: String,
) -> Result<(), String> {
    let mut guard = state
        .unified_state_json
        .lock()
        .map_err(|_| "Mutex poisoned".to_string())?;

    if !guard.is_empty() {
        if let (Ok(serde_json::Value::Object(prev)), Ok(serde_json::Value::Object(mut next))) = (
            serde_json::from_str::<serde_json::Value>(&guard),
            serde_json::from_str::<serde_json::Value>(&state_json),
        ) {
            for key in ["devices", "sessions", "geminiChats"] {
                let next_empty = next
                    .get(key)
                    .and_then(|v| v.as_array())
                    .map_or(true, |a| a.is_empty());
                if next_empty {
                    if let Some(prev_val) = prev.get(key) {
                        next.insert(key.to_string(), prev_val.clone());
                    }
                }
            }
            if let Ok(merged_str) = serde_json::to_string(&next) {
                *guard = merged_str;
                return Ok(());
            }
        }
    }

    *guard = state_json;
    Ok(())
}

#[tauri::command]
fn get_unified_state(state: State<'_, SharedEngineState>) -> Result<String, String> {
    let guard = state
        .unified_state_json
        .lock()
        .map_err(|_| "Mutex poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
fn get_active_engine(state: State<'_, SharedEngineState>) -> Result<String, String> {
    let active = state
        .active_engine
        .lock()
        .map_err(|_| "Mutex poisoned".to_string())?;
    Ok(if active.is_empty() {
        "antigravity".to_string()
    } else {
        active.clone()
    })
}

#[tauri::command]
fn import_google_cookies(app: AppHandle, cookie_string: String) -> Result<bool, String> {
    let trimmed = cookie_string.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    #[cfg(desktop)]
    {
        let mut pairs: Vec<(String, String)> = Vec::new();

        if trimmed.starts_with('[') {
            if let Ok(serde_json::Value::Array(items)) = serde_json::from_str(trimmed) {
                for item in items {
                    if let (Some(n), Some(v)) = (
                        item.get("name").and_then(|x| x.as_str()),
                        item.get("value").and_then(|x| x.as_str()),
                    ) {
                        pairs.push((n.to_string(), v.to_string()));
                    }
                }
            }
        }

        if pairs.is_empty() {
            let clean = if trimmed.to_lowercase().starts_with("cookie:") {
                trimmed[7..].trim()
            } else {
                trimmed
            };
            for p in clean.split(';') {
                let s = p.trim();
                if let Some((n, v)) = s.split_once('=') {
                    let n = n.trim();
                    let v = v.trim();
                    if !n.is_empty() {
                        pairs.push((n.to_string(), v.to_string()));
                    }
                }
            }
        }

        let agy_win = app.get_webview_window("antigravity");
        let gem_win = app.get_webview_window("gemini");

        for (name, val) in &pairs {
            let cookie = tauri::webview::Cookie::build((name.clone(), val.clone()))
                .domain(".google.com")
                .path("/")
                .secure(true)
                .same_site(tauri::webview::cookie::SameSite::None)
                .build();

            if let Some(ref win) = agy_win {
                let _ = win.set_cookie(cookie.clone());
            }
            if let Some(ref win) = gem_win {
                let _ = win.set_cookie(cookie);
            }
        }

        let gem_url: Url = GEMINI_URL.parse().map_err(|e| format!("{e}"))?;
        let agy_url: Url = ANTIGRAVITY_REMOTE_URL.parse().map_err(|e| format!("{e}"))?;

        if let Some(ref win) = agy_win {
            let _ = win.navigate(agy_url);
        }
        if let Some(ref win) = gem_win {
            let _ = win.navigate(gem_url);
        }
    }

    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SharedEngineState::default())
        .invoke_handler(tauri::generate_handler![
            switch_engine,
            navigate_to_remote_session,
            agy_bridge_message,
            sync_unified_state,
            get_unified_state,
            get_active_engine,
            import_google_cookies
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let agy_url: Url = ANTIGRAVITY_REMOTE_URL.parse()?;
                WebviewWindowBuilder::new(app, "antigravity", WebviewUrl::External(agy_url))
                    .title("Antigravity — Remote Control")
                    .inner_size(1280.0, 860.0)
                    .user_agent(GOOGLE_SAFE_USER_AGENT)
                    .initialization_script_for_all_frames(AGY_BRIDGE_SCRIPT)
                    .build()?;

                // Pre-warm Gemini WebView hidden in background sharing Google session cookies
                let gem_url: Url = GEMINI_URL.parse()?;
                WebviewWindowBuilder::new(app, "gemini", WebviewUrl::External(gem_url))
                    .title("Antigravity — Gemini Chat")
                    .inner_size(1280.0, 860.0)
                    .visible(false)
                    .user_agent(GOOGLE_SAFE_USER_AGENT)
                    .initialization_script_for_all_frames(GEMINI_BRIDGE_SCRIPT)
                    .build()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Antigravity Tauri application");
}
