#[cfg(target_os = "macos")]
use crate::auth::read_webkit_binary_cookies;
use crate::auth::{AccountRecord, AccountSummary, AuthStore, ANTIGRAVITY_ORIGIN};
use crate::protocol::wire::{
    decode_list_instances_response, decode_proxy_command_response, encode_grpc_web_frame,
    encode_proxy_command_request, extract_connect_or_raw_json, DeviceInstance, GrpcWebDecoder,
    GrpcWebFrame,
};
use futures_util::{future::join_all, StreamExt};
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, COOKIE, ORIGIN,
    PRAGMA, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;

const LIST_INSTANCES_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances";
const PROXY_COMMAND_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand";
#[allow(dead_code)]
const STREAM_PROXY_COMMAND_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/StreamProxyCommand";
const REMOTE_BOOTSTRAP_URL: &str = "https://antigravity.google.com/remote";
const ROTATE_COOKIES_URL: &str = "https://accounts.google.com/RotateCookies";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountFetchError {
    pub account_id: String,
    pub account_label: String,
    pub code: String, // "SESSION_EXPIRED" | "NETWORK_ERROR" | "API_ERROR"
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelQuotaItem {
    pub id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub remaining_fraction: Option<f64>,
    pub reset_time_iso: Option<String>,
    pub reset_time_ms: Option<u64>,
    pub weekly_remaining_fraction: Option<f64>,
    pub weekly_reset_time_iso: Option<String>,
    pub weekly_reset_time_ms: Option<u64>,
    pub is_default: bool,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaBucketSummary {
    pub bucket_id: String,
    pub display_name: String,
    pub description: Option<String>,
    pub remaining_fraction: Option<f64>,
    pub reset_time_iso: Option<String>,
    pub reset_time_ms: Option<u64>,
    pub disabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaGroupSummary {
    pub display_name: String,
    pub description: Option<String>,
    pub buckets: Vec<QuotaBucketSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountQuotaSnapshot {
    pub account_id: String,
    pub account_label: String,
    pub email: String,
    pub plan_name: Option<String>,
    pub user_tier: Option<String>,
    pub available_prompt_credits: Option<i64>,
    pub monthly_prompt_credits: Option<i64>,
    pub available_flow_credits: Option<i64>,
    pub monthly_flow_credits: Option<i64>,
    pub weekly_remaining_fraction: Option<f64>,
    pub weekly_reset_time_iso: Option<String>,
    pub weekly_reset_time_ms: Option<u64>,
    pub quota_description: Option<String>,
    pub quota_groups: Vec<QuotaGroupSummary>,
    pub online_devices: usize,
    pub total_devices: usize,
    pub source_device_name: Option<String>,
    pub models: Vec<ModelQuotaItem>,
    pub error_code: Option<String>, // "SESSION_EXPIRED" | "NO_ONLINE_DEVICE" | "NETWORK_ERROR" | "API_ERROR"
    pub error_message: Option<String>,
    pub fetched_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaDashboardSnapshot {
    pub accounts: Vec<AccountQuotaSnapshot>,
    pub fetched_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSessionSummary {
    pub id: String, // `${accountId}::${deviceUuid}::${cascadeId}`
    pub account_id: String,
    pub account_label: String,
    pub cascade_id: String,
    pub title: String,
    pub snippet: String,
    pub device_uuid: String,
    pub device_name: String,
    pub device_status: String,
    pub workspace_name: String,
    pub last_modified_ms: u64,
    pub step_count: u32,
    pub status: String, // "running" | "waiting_approval" | "idle"
    pub parent_cascade_id: Option<String>,
    pub subagent_role: Option<String>,
    pub subagent_type: Option<String>,
    pub nesting_depth: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AllSessionsSnapshot {
    pub accounts: Vec<AccountSummary>,
    pub devices: Vec<DeviceInstance>,
    pub sessions: Vec<UnifiedSessionSummary>,
    pub account_errors: Vec<AccountFetchError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AgentStreamEvent {
    Connected {
        account_id: String,
        device_uuid: String,
        cascade_id: String,
    },
    Update {
        payload: Value,
    },
    Error {
        message: String,
    },
    Closed,
}

fn decode_js_hex_escapes(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' && index + 3 < bytes.len() && bytes[index + 1] == b'x' {
            if let Ok(value) = u8::from_str_radix(&input[index + 2..index + 4], 16) {
                output.push(value);
                index += 4;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

#[derive(Debug, Clone)]
pub struct ResolvedAccountIdentity {
    pub email: String,
    pub name: String,
    pub avatar_url: String,
}

pub struct AntigravityClient {
    http: reqwest::Client,
    auth: Arc<AuthStore>,
    cached_api_key: RwLock<Option<String>>,
    trajectory_cache: Mutex<HashMap<String, (Instant, Value)>>,
}

/// `GetCascadeModelConfigs` is empty on a workspace-runner LS; the current
/// model catalog is exposed by `GetAvailableModels` under `response.models`
/// (map keyed by model id) plus `defaultAgentModelId`.
fn available_models_to_client_configs(raw: &Value) -> Value {
    let response = raw.get("response").unwrap_or(raw);
    let models = response
        .get("models")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let default_id = response
        .get("defaultAgentModelId")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let mut configs = Vec::new();
    for (id, model) in models {
        let enum_model = model
            .get("model")
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if enum_model.is_empty() {
            continue;
        }
        let label = model
            .get("displayName")
            .and_then(|value| value.as_str())
            .unwrap_or(&id);
        let description = model
            .get("description")
            .and_then(|value| value.as_str())
            .or_else(|| model.get("tagTitle").and_then(|value| value.as_str()))
            .unwrap_or("");
        configs.push(json!({
            "label": label,
            "modelOrAlias": { "model": enum_model },
            "modelId": id,
            "quotaInfo": model.get("quotaInfo").cloned().unwrap_or(Value::Null),
            "description": description,
            // The server marks most catalog entries `recommended`; the real
            // default is `defaultAgentModelId`.
            "isRecommended": id == default_id,
            "isDefault": id == default_id,
            "disabled": false
        }));
    }
    json!({
        "clientModelConfigs": configs,
        "defaultModelId": default_id,
        "source": "GetAvailableModels"
    })
}

fn build_start_cascade_body(workspace_uri: Option<String>) -> Value {
    let mut body = serde_json::Map::new();
    if let Some(uri) = workspace_uri {
        if !uri.is_empty() {
            body.insert("workspaceUris".to_string(), json!([uri]));
        }
    }
    // StartCascadeRequest has no project_id field (the old cloud AICODE
    // request did), so never serialize one.
    Value::Object(body)
}

fn build_send_user_message_body(
    cascade_id: &str,
    text: &str,
    model: Option<String>,
    media: Option<Vec<Value>>,
) -> Value {
    let mut body = json!({
        "cascadeId": cascade_id,
        "items": [{ "text": text }]
    });
    if let Some(m_list) = media {
        if !m_list.is_empty() {
            body["media"] = Value::Array(m_list);
        }
    }
    if let Some(m) = model {
        if !m.is_empty() {
            body["cascadeConfig"] = json!({
                "plannerConfig": {
                    "requestedModel": { "model": m }
                }
            });
        }
    }
    body
}

fn encode_file_uri_path(uri: &str) -> String {
    let mut out = String::with_capacity(uri.len());
    for &b in uri.as_bytes() {
        let keep = b.is_ascii_alphanumeric()
            || matches!(b, b'/' | b':' | b'-' | b'_' | b'.' | b'~' | b'%');
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn is_read_only_rpc_method(method_name: &str) -> bool {
    method_name.starts_with("Get")
        || method_name.starts_with("Search")
        || method_name.starts_with("List")
}

fn format_reqwest_error(err: &reqwest::Error) -> String {
    use std::error::Error as _;
    let mut parts = vec![err.to_string()];
    let mut cur = err.source();
    while let Some(src) = cur {
        let text = src.to_string();
        if !parts.last().is_some_and(|prev| prev.contains(&text)) {
            parts.push(text);
        }
        cur = src.source();
    }
    parts.join(": ")
}

fn is_retryable_network_error(err: &reqwest::Error, is_read_only: bool) -> bool {
    if err.is_connect() {
        return true;
    }
    is_read_only && (err.is_timeout() || err.is_request() || err.is_body() || err.is_decode())
}

impl AntigravityClient {
    pub fn new(auth: Arc<AuthStore>) -> Self {
        let http = reqwest::Client::builder()
            .use_rustls_tls()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .pool_idle_timeout(std::time::Duration::from_secs(20))
            .tcp_keepalive(Some(std::time::Duration::from_secs(15)))
            .http2_keep_alive_interval(Some(std::time::Duration::from_secs(20)))
            .http2_keep_alive_timeout(std::time::Duration::from_secs(10))
            .http2_keep_alive_while_idle(true)
            .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36")
            .build()
            .expect("Failed to build reqwest client");
        let env_key = std::env::var("ANTIGRAVITY_API_KEY")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        Self {
            http,
            auth,
            cached_api_key: RwLock::new(env_key),
            trajectory_cache: Mutex::new(HashMap::new()),
        }
    }

    fn capture_set_cookies(
        &self,
        account_id: &str,
        from_accounts: bool,
        headers: &HeaderMap,
    ) -> bool {
        let set_cookies: Vec<String> = headers
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok().map(|s| s.to_string()))
            .collect();
        if set_cookies.is_empty() {
            return false;
        }
        self.auth
            .merge_set_cookies(account_id, from_accounts, &set_cookies)
    }

    /// Calls Google's `accounts.google.com/RotateCookies` (HFCR 600s keepalive) to refresh
    /// short-lived session cookies (`__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`, `1PSIDCC`, `3PSIDCC`)
    /// and persists any updated `Set-Cookie` values back into `AuthStore`.
    #[cfg(target_os = "macos")]
    fn refresh_from_webkit_cookies(&self, account: &AccountRecord) -> Option<AccountRecord> {
        // The login WebView uses one shared WebKit cookie store. With multiple
        // accounts it contains the most recently signed-in account, so silently
        // importing it into an older account could switch identities. Only
        // self-heal automatically while exactly one account is configured.
        if self.auth.enabled_authenticated_accounts().len() > 1 {
            return None;
        }
        for bundle_id in ["com.google.antigravity.remoteapp", "antigravity-app"] {
            // Never let an older browser cookie file overwrite a newer vault.
            let store_mtime = crate::auth::webkit_cookie_store_mtime_ms(bundle_id);
            if matches!(store_mtime, Some(mtime) if mtime <= account.updated_at_ms) {
                continue;
            }
            let (google, accounts) = read_webkit_binary_cookies(bundle_id);
            let has_sapisid = google.contains_key("SAPISID")
                || google.contains_key("__Secure-1PAPISID")
                || google.contains_key("__Secure-3PAPISID");
            let has_sid = google.contains_key("SID")
                || google.contains_key("__Secure-1PSID")
                || google.contains_key("__Secure-3PSID");
            if !has_sapisid || !has_sid {
                continue;
            }
            if self
                .auth
                .upsert_account_cookies(
                    Some(account.id.clone()),
                    None,
                    None,
                    google,
                    accounts,
                    None,
                )
                .is_ok()
            {
                return self.auth.get_account(&account.id);
            }
        }
        None
    }

    pub async fn rotate_cookies_for_account(&self, account_id: &str) -> Result<bool, String> {
        let account = self.resolve_account(account_id)?;
        let Some(cookie_hdr) = account.accounts_cookie_header() else {
            return Ok(false);
        };
        // Official web sends `[<0..999>,"-<signed 64-bit nonce>"]` and
        // `x-chrome-id-consistency-request: [1,0]`; a static placeholder body
        // gets 400/401 and never rotates PSIDTS.
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let first = now.subsec_nanos() % 1000;
        let mixed = (u128::from(now.subsec_nanos()) * 6_364_136_223_846_793_005)
            ^ u128::from(std::process::id());
        let nonce = (mixed as u64).wrapping_add(now.as_secs());
        let body = format!("[{first},\"-{nonce}\"]");
        let resp = self
            .http
            .post(ROTATE_COOKIES_URL)
            .header(CONTENT_TYPE, "application/json")
            .header(ACCEPT, "*/*")
            .header(CACHE_CONTROL, "no-cache")
            .header(PRAGMA, "no-cache")
            .header(ORIGIN, "https://accounts.google.com")
            .header(REFERER, "https://accounts.google.com/RotateCookiesPage")
            .header("x-chrome-id-consistency-request", "[1,0]")
            .header(
                USER_AGENT,
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36",
            )
            .header(COOKIE, cookie_hdr)
            .body(body)
            .send()
            .await
            .map_err(|e| format!("RotateCookies network error: {e}"))?;

        let status = resp.status();
        let changed = self.capture_set_cookies(&account.id, true, resp.headers());
        if !status.is_success() {
            return Err(format!("RotateCookies HTTP {status}"));
        }
        Ok(changed)
    }

    /// Rotates cookies for all enabled authenticated accounts. Returns true if any account's cookies updated.
    pub async fn rotate_all_enabled_accounts(&self) -> bool {
        let accounts = self.auth.enabled_authenticated_accounts();
        if accounts.is_empty() {
            return false;
        }
        let futs = accounts
            .iter()
            .map(|acc| self.rotate_cookies_for_account(&acc.id));
        let results = join_all(futs).await;
        results.into_iter().any(|r| matches!(r, Ok(true)))
    }

    /// Dynamically discovers the public web client API key from antigravity.google.com's boq-jetski bundle
    /// (avoiding hardcoding any API key literal in source control).
    async fn resolve_api_key(&self) -> Result<String, String> {
        if let Some(existing) = self
            .cached_api_key
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
        {
            return Ok(existing);
        }

        let html = self
            .http
            .get(REMOTE_BOOTSTRAP_URL)
            .send()
            .await
            .map_err(|e| format!("Bootstrap fetch failed: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Bootstrap read failed: {e}"))?;

        let base_js_url = extract_boq_base_js_url(&html)
            .ok_or_else(|| "Could not locate boq-jetski base bundle URL".to_string())?;
        let js = self
            .http
            .get(&base_js_url)
            .send()
            .await
            .map_err(|e| format!("Bundle fetch failed: {e}"))?
            .text()
            .await
            .map_err(|e| format!("Bundle read failed: {e}"))?;

        let key = extract_config_api_key(&js).ok_or_else(|| {
            "Could not extract public ConfigService.API_KEY from bundle".to_string()
        })?;

        *self
            .cached_api_key
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(key.clone());
        Ok(key)
    }

    fn resolve_account(&self, account_id: &str) -> Result<AccountRecord, String> {
        self.auth
            .get_account(account_id)
            .ok_or_else(|| "Account not found or not authenticated".to_string())
    }

    async fn build_grpc_headers_for(&self, account: &AccountRecord) -> Result<HeaderMap, String> {
        let api_key = self.resolve_api_key().await?;
        let cookie_hdr = account
            .cookie_header()
            .ok_or_else(|| format!("Account '{}' has no cookies", account.label))?;
        let auth_hdr = account
            .build_authorization_header(ANTIGRAVITY_ORIGIN)
            .ok_or_else(|| {
                format!(
                    "Account '{}' is missing SAPISID / __Secure-1PAPISID cookie",
                    account.label
                )
            })?;

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/grpc-web+proto"),
        );
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/grpc-web+proto"),
        );
        headers.insert("x-grpc-web", HeaderValue::from_static("1"));
        headers.insert(
            "x-user-agent",
            HeaderValue::from_static("grpc-web-javascript/0.1"),
        );
        headers.insert(
            "x-goog-api-key",
            HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
        );
        headers.insert(
            "x-goog-authuser",
            HeaderValue::from_str(&account.auth_user.to_string()).map_err(|e| e.to_string())?,
        );
        headers.insert(
            "x-goog-encode-response-if-executable",
            HeaderValue::from_static("base64"),
        );
        headers.insert("x-origin", HeaderValue::from_static(ANTIGRAVITY_ORIGIN));
        headers.insert("x-referer", HeaderValue::from_static(ANTIGRAVITY_ORIGIN));
        headers.insert(ORIGIN, HeaderValue::from_static(ANTIGRAVITY_ORIGIN));
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://antigravity.google.com/"),
        );
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth_hdr).map_err(|e| e.to_string())?,
        );
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&cookie_hdr).map_err(|e| e.to_string())?,
        );
        Ok(headers)
    }

    async fn build_jspb_headers_for(&self, account: &AccountRecord) -> Result<HeaderMap, String> {
        let api_key = self.resolve_api_key().await?;
        let cookie_hdr = account
            .cookie_header()
            .ok_or_else(|| format!("Account '{}' has no cookies", account.label))?;
        let auth_hdr = account
            .build_authorization_header(ANTIGRAVITY_ORIGIN)
            .ok_or_else(|| {
                format!(
                    "Account '{}' is missing SAPISID / __Secure-1PAPISID cookie",
                    account.label
                )
            })?;

        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/json+protobuf"),
        );
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
        headers.insert(
            "x-user-agent",
            HeaderValue::from_static("grpc-web-javascript/0.1"),
        );
        headers.insert(
            "x-goog-api-key",
            HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
        );
        headers.insert(
            "x-goog-authuser",
            HeaderValue::from_str(&account.auth_user.to_string()).map_err(|e| e.to_string())?,
        );
        headers.insert(ORIGIN, HeaderValue::from_static(ANTIGRAVITY_ORIGIN));
        headers.insert(
            REFERER,
            HeaderValue::from_static("https://antigravity.google.com/"),
        );
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&auth_hdr).map_err(|e| e.to_string())?,
        );
        headers.insert(
            COOKIE,
            HeaderValue::from_str(&cookie_hdr).map_err(|e| e.to_string())?,
        );
        Ok(headers)
    }

    pub async fn list_instances_for_account(
        &self,
        account: &AccountRecord,
    ) -> Result<Vec<DeviceInstance>, String> {
        let mut active_account = account.clone();
        let mut rotated_on_401 = false;
        let mut last_err = String::from("ListInstances failed after retry");
        for attempt in 0..3 {
            let headers = self.build_jspb_headers_for(&active_account).await?;

            let resp = match self
                .http
                .post(LIST_INSTANCES_URL)
                .headers(headers)
                .body("[]")
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!("ListInstances network error: {}", format_reqwest_error(&e));
                    if attempt < 2 && is_retryable_network_error(&e, true) {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            350 * (attempt as u64 + 1),
                        ))
                        .await;
                        continue;
                    }
                    return Err(last_err);
                }
            };

            let status = resp.status();
            let _ = self.capture_set_cookies(&active_account.id, false, resp.headers());
            let raw_bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    last_err = format!("ListInstances read error: {}", format_reqwest_error(&e));
                    if attempt < 2 {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            350 * (attempt as u64 + 1),
                        ))
                        .await;
                        continue;
                    }
                    return Err(last_err);
                }
            };

            if status == reqwest::StatusCode::UNAUTHORIZED && !rotated_on_401 {
                rotated_on_401 = true;
                // Attempt silent RotateCookies recovery once before reporting SESSION_EXPIRED
                if matches!(
                    self.rotate_cookies_for_account(&active_account.id).await,
                    Ok(true)
                ) {
                    if let Some(refreshed) = self.auth.get_account(&active_account.id) {
                        active_account = refreshed;
                        continue;
                    }
                }
                // The login WebView may have a fresher cookie jar than the
                // vault (cookies_for_url is unreliable on macOS). Re-import
                // the WebKit binarycookies and retry once before giving up.
                #[cfg(target_os = "macos")]
                if let Some(refreshed) = self.refresh_from_webkit_cookies(&active_account) {
                    active_account = refreshed;
                    continue;
                }
            }

            if !status.is_success() {
                let err_preview = String::from_utf8_lossy(&raw_bytes);
                let short: String = err_preview.chars().take(240).collect();
                last_err = format!("ListInstances HTTP {status}: {short}");
                if matches!(status.as_u16(), 502 | 503 | 504) && attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        500 * (attempt as u64 + 1),
                    ))
                    .await;
                    continue;
                }
                return Err(last_err);
            }

            // Parse Google JSPB array response: [[ [uuid, [name, version, chunking], status, [sec, nanos]], ... ]]
            let mut list = if let Ok(val) = serde_json::from_slice::<Value>(&raw_bytes) {
                parse_jspb_instances(&val)
            } else {
                let mut decoder = GrpcWebDecoder::default();
                let frames = decoder.push(&raw_bytes);
                let mut data_payload: Option<Vec<u8>> = None;
                for frame in frames {
                    if let GrpcWebFrame::Data(d) = frame {
                        data_payload = Some(d);
                    }
                }
                decode_list_instances_response(&data_payload.unwrap_or_default())?
            };

            for d in &mut list {
                d.account_id = active_account.id.clone();
                d.account_label = active_account.label.clone();
            }
            return Ok(list);
        }
        Err(last_err)
    }

    pub async fn list_instances(
        &self,
        account_id: Option<&str>,
    ) -> Result<Vec<DeviceInstance>, String> {
        if let Some(aid) = account_id.filter(|s| !s.is_empty()) {
            let acc = self.resolve_account(aid)?;
            return self.list_instances_for_account(&acc).await;
        }
        let accounts = self.auth.enabled_authenticated_accounts();
        let futs = accounts
            .iter()
            .map(|acc| self.list_instances_for_account(acc));
        let results = join_all(futs).await;
        Ok(results
            .into_iter()
            .filter_map(|r| r.ok())
            .flatten()
            .collect())
    }

    pub async fn proxy_unary_json(
        &self,
        account_id: &str,
        target_instance_uuid: &str,
        rpc_path: &str,
        request_json: Value,
    ) -> Result<Value, String> {
        let account = self.resolve_account(account_id)?;
        self.proxy_unary_json_with_account(&account, target_instance_uuid, rpc_path, request_json)
            .await
    }

    async fn proxy_unary_json_with_account(
        &self,
        account: &AccountRecord,
        target_instance_uuid: &str,
        rpc_path: &str,
        request_json: Value,
    ) -> Result<Value, String> {
        let mut active_account = account.clone();
        let json_bytes = serde_json::to_vec(&request_json).map_err(|e| e.to_string())?;
        let b64_payload = b64_encode(&json_bytes);
        let jspb_body = serde_json::to_string(&json!([
            target_instance_uuid,
            rpc_path,
            b64_payload,
            [["Content-Type", "application/json"]]
        ]))
        .map_err(|e| e.to_string())?;

        let method_name = rpc_path.rsplit('/').next().unwrap_or("rpc");
        let is_read_only = is_read_only_rpc_method(method_name);
        let url = format!("{PROXY_COMMAND_URL}?$unique={method_name}");

        let mut last_err = String::new();
        let mut rotated_on_401 = false;
        for attempt in 0..3 {
            let headers = self.build_jspb_headers_for(&active_account).await?;
            let resp = match self
                .http
                .post(&url)
                .headers(headers)
                .body(jspb_body.clone())
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = format!(
                        "ProxyCommand({method_name}) network error: {}",
                        format_reqwest_error(&e)
                    );
                    if attempt < 2 && is_retryable_network_error(&e, is_read_only) {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            350 * (attempt as u64 + 1),
                        ))
                        .await;
                        continue;
                    }
                    return Err(last_err);
                }
            };

            let status = resp.status();
            let _ = self.capture_set_cookies(&active_account.id, false, resp.headers());
            let raw_bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    last_err = format!(
                        "ProxyCommand({method_name}) read error: {}",
                        format_reqwest_error(&e)
                    );
                    if attempt < 2 && is_read_only {
                        tokio::time::sleep(std::time::Duration::from_millis(
                            350 * (attempt as u64 + 1),
                        ))
                        .await;
                        continue;
                    }
                    return Err(last_err);
                }
            };

            if status == reqwest::StatusCode::UNAUTHORIZED && !rotated_on_401 {
                rotated_on_401 = true;
                if matches!(
                    self.rotate_cookies_for_account(&active_account.id).await,
                    Ok(true)
                ) {
                    if let Some(refreshed) = self.auth.get_account(&active_account.id) {
                        active_account = refreshed;
                        continue;
                    }
                }
                #[cfg(target_os = "macos")]
                if let Some(refreshed) = self.refresh_from_webkit_cookies(&active_account) {
                    active_account = refreshed;
                    continue;
                }
            }

            if !status.is_success() {
                let preview = String::from_utf8_lossy(&raw_bytes);
                let short: String = preview.chars().take(240).collect();
                last_err = format!("ProxyCommand({method_name}) HTTP {status}: {short}");
                let transient_gateway =
                    is_read_only && matches!(status.as_u16(), 502 | 503 | 504);
                if (preview.contains("TUNNEL_UNAVAILABLE") || transient_gateway) && attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(
                        if preview.contains("TUNNEL_UNAVAILABLE") {
                            1200
                        } else {
                            500 * (attempt as u64 + 1)
                        },
                    ))
                    .await;
                    continue;
                }
                return Err(last_err);
            }

            if let Ok(val) = serde_json::from_slice::<Value>(&raw_bytes) {
                if let Some(b64_str) = val.get(0).and_then(|v| v.as_str()) {
                    let decoded = b64_decode(b64_str)?;
                    if decoded.is_empty() {
                        return Ok(json!({}));
                    }
                    return serde_json::from_slice::<Value>(&decoded).map_err(|e| {
                        format!("ProxyCommand({method_name}) inner JSON decode error: {e}")
                    });
                }
                return Ok(json!({}));
            }

            let mut decoder = GrpcWebDecoder::default();
            let frames = decoder.push(&raw_bytes);
            let mut data_payload: Option<Vec<u8>> = None;
            for frame in frames {
                if let GrpcWebFrame::Data(d) = frame {
                    data_payload = Some(d);
                }
            }
            let Some(outer_bytes) = data_payload else {
                return Ok(json!({}));
            };
            let proxy_resp = decode_proxy_command_response(&outer_bytes)?;
            if proxy_resp.payload.is_empty() {
                return Ok(json!({}));
            }
            return serde_json::from_slice::<Value>(&proxy_resp.payload)
                .map_err(|e| format!("ProxyCommand({method_name}) JSON decode error: {e}"));
        }
        Err(last_err)
    }

    /// Fans out ListInstances + SearchConversations concurrently across ALL enabled accounts & online devices!
    /// Never silently swallows auth/network errors — returns per-account `account_errors` for UI recovery.
    pub async fn list_all_sessions(&self) -> Result<AllSessionsSnapshot, String> {
        let account_summaries = self.auth.list_accounts();
        let enabled_accounts = self.auth.enabled_authenticated_accounts();

        let per_account_futs = enabled_accounts.into_iter().map(|account| async move {
            let devices = match self.list_instances_for_account(&account).await {
                Ok(devs) => devs,
                Err(err) => {
                    let code = classify_account_error(&err).to_string();
                    return (
                        Vec::new(),
                        Vec::new(),
                        Some(AccountFetchError {
                            account_id: account.id.clone(),
                            account_label: account.label.clone(),
                            code,
                            message: err,
                        }),
                    );
                }
            };
            let online: Vec<DeviceInstance> = devices
                .iter()
                .filter(|d| d.status == "RUNNING" || d.status == "IDLE")
                .cloned()
                .collect();

            let device_futs = online.into_iter().map(|device| {
                let acc_ref = &account;
                async move {
                    let mut by_cascade: HashMap<String, UnifiedSessionSummary> = HashMap::new();

                    // 1. Fetch ALL historical trajectories (including idle/offline workspace sessions)
                    let traj_fut = self.proxy_unary_json_with_account(
                        acc_ref,
                        &device.uuid,
                        "/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories",
                        json!({}),
                    );
                    // 2. Also fetch SearchConversations for rich titles/snippets
                    let search_fut = self.proxy_unary_json_with_account(
                        acc_ref,
                        &device.uuid,
                        "/exa.language_server_pb.LanguageServerService/SearchConversations",
                        json!({ "query": "", "limit": 50 }),
                    );
                    let (traj_resp, search_resp) = tokio::join!(traj_fut, search_fut);

                    if let Ok(val) = traj_resp {
                        if let Some(map) =
                            val.get("trajectorySummaries").and_then(|v| v.as_object())
                        {
                            for (cascade_id, item) in map {
                                let workspace_name = item
                                    .get("workspaces")
                                    .and_then(|v| v.as_array())
                                    .and_then(|arr| arr.first())
                                    .and_then(|w| w.get("workspaceFolderAbsoluteUri"))
                                    .and_then(|u| u.as_str())
                                    .and_then(|u| u.trim_end_matches('/').rsplit('/').next())
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or("Workspace")
                                    .to_string();
                                let meta = item.get("trajectoryMetadata");
                                let parent_cascade_id = meta
                                    .and_then(|m| m.get("parentConversationId"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty());
                                let subagent_spec = meta.and_then(|m| m.get("subagentSpec"));
                                let subagent_role = subagent_spec
                                    .and_then(|sp| sp.get("role"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty());
                                let subagent_type = subagent_spec
                                    .and_then(|sp| sp.get("typeName"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty());
                                let nesting_depth = meta
                                    .and_then(|m| m.get("nestingDepth"))
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(if parent_cascade_id.is_some() { 1 } else { 0 })
                                    as u32;

                                let title = item
                                    .get("summary")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim())
                                    .filter(|s| !s.is_empty())
                                    .map(|s| s.to_string())
                                    .or_else(|| subagent_role.clone())
                                    .or_else(|| subagent_type.clone())
                                    .unwrap_or_else(|| {
                                        format!(
                                            "{} ({})",
                                            workspace_name,
                                            &cascade_id[..cascade_id.len().min(6)]
                                        )
                                    });
                                let step_count =
                                    item.get("stepCount").and_then(|v| v.as_u64()).unwrap_or(0)
                                        as u32;
                                let last_modified_ms =
                                    parse_proto_timestamp_ms(item.get("lastModifiedTime"));
                                let raw_status =
                                    item.get("status").and_then(|v| v.as_str()).unwrap_or("");
                                let status = if raw_status.contains("RUNNING") {
                                    "running"
                                } else if raw_status.contains("WAITING") {
                                    "waiting_approval"
                                } else {
                                    "idle"
                                }
                                .to_string();

                                by_cascade.insert(
                                    cascade_id.clone(),
                                    UnifiedSessionSummary {
                                        id: format!(
                                            "{}::{}::{}",
                                            acc_ref.id, device.uuid, cascade_id
                                        ),
                                        account_id: acc_ref.id.clone(),
                                        account_label: acc_ref.label.clone(),
                                        cascade_id: cascade_id.clone(),
                                        title,
                                        snippet: workspace_name.clone(),
                                        device_uuid: device.uuid.clone(),
                                        device_name: device.display_name.clone(),
                                        device_status: device.status.clone(),
                                        workspace_name,
                                        last_modified_ms,
                                        step_count,
                                        status,
                                        parent_cascade_id,
                                        subagent_role,
                                        subagent_type,
                                        nesting_depth,
                                    },
                                );
                            }
                        }
                    }

                    if let Ok(val) = search_resp {
                        if let Some(arr) = val.get("results").and_then(|v| v.as_array()) {
                            for item in arr {
                                let Some(cascade_id) =
                                    item.get("cascadeId").and_then(|v| v.as_str())
                                else {
                                    continue;
                                };
                                let title = item
                                    .get("title")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim())
                                    .filter(|s| !s.is_empty())
                                    .unwrap_or("Untitled Session")
                                    .to_string();
                                let workspace_name = item
                                    .get("workspaceName")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Workspace")
                                    .to_string();
                                let snippet = item
                                    .get("snippet")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(&workspace_name)
                                    .to_string();
                                let last_modified_ms =
                                    parse_proto_timestamp_ms(item.get("lastModifiedTime"));

                                by_cascade
                                    .entry(cascade_id.to_string())
                                    .and_modify(|existing| {
                                        existing.title = title.clone();
                                        existing.snippet = snippet.clone();
                                        if existing.last_modified_ms == 0 {
                                            existing.last_modified_ms = last_modified_ms;
                                        }
                                    })
                                    .or_insert_with(|| UnifiedSessionSummary {
                                        id: format!(
                                            "{}::{}::{}",
                                            acc_ref.id, device.uuid, cascade_id
                                        ),
                                        account_id: acc_ref.id.clone(),
                                        account_label: acc_ref.label.clone(),
                                        cascade_id: cascade_id.to_string(),
                                        title,
                                        snippet,
                                        device_uuid: device.uuid.clone(),
                                        device_name: device.display_name.clone(),
                                        device_status: device.status.clone(),
                                        workspace_name,
                                        last_modified_ms,
                                        step_count: 0,
                                        status: "idle".to_string(),
                                        parent_cascade_id: None,
                                        subagent_role: None,
                                        subagent_type: None,
                                        nesting_depth: 0,
                                    });
                            }
                        }
                    }

                    by_cascade.into_values().collect::<Vec<_>>()
                }
            });

            let sessions: Vec<UnifiedSessionSummary> =
                join_all(device_futs).await.into_iter().flatten().collect();
            (devices, sessions, None)
        });

        let aggregated = join_all(per_account_futs).await;
        let mut all_devices = Vec::new();
        let mut all_sessions = Vec::new();
        let mut all_errors = Vec::new();
        for (devs, sess, err_opt) in aggregated {
            all_devices.extend(devs);
            all_sessions.extend(sess);
            if let Some(err) = err_opt {
                all_errors.push(err);
            }
        }
        all_sessions.sort_by(|a, b| b.last_modified_ms.cmp(&a.last_modified_ms));

        Ok(AllSessionsSnapshot {
            accounts: account_summaries,
            devices: all_devices,
            sessions: all_sessions,
            account_errors: all_errors,
        })
    }

    /// Fetches real-time multi-account quota & usage across ALL enabled accounts in parallel.
    pub async fn get_all_accounts_quota(&self) -> Result<QuotaDashboardSnapshot, String> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let enabled_accounts = self.auth.enabled_authenticated_accounts();

        let futs = enabled_accounts.into_iter().map(|account| async move {
            let devices = match self.list_instances_for_account(&account).await {
                Ok(d) => d,
                Err(err) => {
                    return AccountQuotaSnapshot {
                        account_id: account.id.clone(),
                        account_label: account.label.clone(),
                        email: account.email.clone(),
                        plan_name: None,
                        user_tier: None,
                        available_prompt_credits: None,
                        monthly_prompt_credits: None,
                        available_flow_credits: None,
                        monthly_flow_credits: None,
                        weekly_remaining_fraction: None,
                        weekly_reset_time_iso: None,
                        weekly_reset_time_ms: None,
                        quota_description: None,
                        quota_groups: Vec::new(),
                        online_devices: 0,
                        total_devices: 0,
                        source_device_name: None,
                        models: Vec::new(),
                        error_code: Some(classify_account_error(&err).to_string()),
                        error_message: Some(err),
                        fetched_at_ms: now,
                    };
                }
            };

            let total_devices = devices.len();
            let online: Vec<&DeviceInstance> = devices
                .iter()
                .filter(|d| d.status == "RUNNING" || d.status == "IDLE")
                .collect();
            let online_devices = online.len();

            let Some(primary_dev) = online.first() else {
                return AccountQuotaSnapshot {
                    account_id: account.id.clone(),
                    account_label: account.label.clone(),
                    email: account.email.clone(),
                    plan_name: None,
                    user_tier: None,
                    available_prompt_credits: None,
                    monthly_prompt_credits: None,
                    available_flow_credits: None,
                    monthly_flow_credits: None,
                    weekly_remaining_fraction: None,
                    weekly_reset_time_iso: None,
                    weekly_reset_time_ms: None,
                    quota_description: None,
                    quota_groups: Vec::new(),
                    online_devices: 0,
                    total_devices,
                    source_device_name: None,
                    models: Vec::new(),
                    error_code: Some("NO_ONLINE_DEVICE".to_string()),
                    error_message: Some(
                        "No online workstation available to query model quota".to_string(),
                    ),
                    fetched_at_ms: now,
                };
            };

            let user_fut = self.proxy_unary_json_with_account(
                &account,
                &primary_dev.uuid,
                "/exa.language_server_pb.LanguageServerService/GetUserStatus",
                json!({}),
            );
            let models_fut = self.proxy_unary_json_with_account(
                &account,
                &primary_dev.uuid,
                "/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs",
                json!({}),
            );
            let quota_summary_fut = self.proxy_unary_json_with_account(
                &account,
                &primary_dev.uuid,
                "/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary",
                json!({ "forceRefresh": true }),
            );
            let (user_res, models_res, quota_summary_res) =
                tokio::join!(user_fut, models_fut, quota_summary_fut);

            let mut email = account.email.clone();
            let mut plan_name: Option<String> = None;
            let mut user_tier: Option<String> = None;
            let mut available_prompt_credits: Option<i64> = None;
            let mut monthly_prompt_credits: Option<i64> = None;
            let mut available_flow_credits: Option<i64> = None;
            let mut monthly_flow_credits: Option<i64> = None;
            let mut weekly_remaining_fraction: Option<f64> = None;
            let mut weekly_reset_time_iso: Option<String> = None;
            let mut weekly_reset_time_ms: Option<u64> = None;
            let mut quota_description: Option<String> = None;
            let mut quota_groups: Vec<QuotaGroupSummary> = Vec::new();
            let mut models: Vec<ModelQuotaItem> = Vec::new();
            let mut err_code: Option<String> = None;
            let mut err_msg: Option<String> = None;

            if let Ok(ref uval) = user_res {
                let us = uval.get("userStatus").unwrap_or(uval);
                if email.is_empty() {
                    if let Some(em) = us.get("email").and_then(|v| v.as_str()) {
                        if !em.is_empty() {
                            email = em.to_string();
                        }
                    }
                }
                user_tier = us
                    .get("userTier")
                    .and_then(|t| t.get("name").or_else(|| t.get("description")))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(ps) = us.get("planStatus") {
                    let info = ps.get("planInfo").unwrap_or(ps);
                    plan_name = info
                        .get("planName")
                        .or_else(|| info.get("teamsTier"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    available_prompt_credits = ps.get("availablePromptCredits").and_then(|v| {
                        v.as_i64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    });
                    monthly_prompt_credits = info.get("monthlyPromptCredits").and_then(|v| {
                        v.as_i64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    });
                    available_flow_credits = ps.get("availableFlowCredits").and_then(|v| {
                        v.as_i64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    });
                    monthly_flow_credits = info.get("monthlyFlowCredits").and_then(|v| {
                        v.as_i64()
                            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                    });
                }
                if let Some(list) = us
                    .get("cascadeModelConfigData")
                    .and_then(|c| c.get("clientModelConfigs"))
                    .and_then(|v| v.as_array())
                {
                    models = parse_model_quota_list(list);
                }
            }

            if let Ok(ref mval) = models_res {
                if let Some(list) = mval
                    .get("clientModelConfigs")
                    .or_else(|| mval.get("models"))
                    .and_then(|v| v.as_array())
                {
                    let parsed = parse_model_quota_list(list);
                    if !parsed.is_empty() {
                        models = parsed;
                    }
                }
            } else if models.is_empty() {
                if let Err(ref e) = models_res {
                    err_code = Some(classify_account_error(e).to_string());
                    err_msg = Some(e.clone());
                } else if let Err(ref e) = user_res {
                    err_code = Some(classify_account_error(e).to_string());
                    err_msg = Some(e.clone());
                }
            }

            if let Ok(ref sval) = quota_summary_res {
                let (desc, groups) = parse_user_quota_summary(sval);
                quota_description = desc;
                quota_groups = groups;
                let (w_frac, w_iso, w_ms) = extract_weekly_quota_from_value(sval);
                if w_frac.is_some() {
                    weekly_remaining_fraction = w_frac;
                    weekly_reset_time_iso = w_iso;
                    weekly_reset_time_ms = w_ms;
                }
            }
            if weekly_remaining_fraction.is_none() {
                if let Ok(ref uval) = user_res {
                    let (w_frac, w_iso, w_ms) = extract_weekly_quota_from_value(uval);
                    if w_frac.is_some() {
                        weekly_remaining_fraction = w_frac;
                        weekly_reset_time_iso = w_iso;
                        weekly_reset_time_ms = w_ms;
                    }
                }
            }

            AccountQuotaSnapshot {
                account_id: account.id.clone(),
                account_label: account.label.clone(),
                email,
                plan_name,
                user_tier,
                available_prompt_credits,
                monthly_prompt_credits,
                available_flow_credits,
                monthly_flow_credits,
                weekly_remaining_fraction,
                weekly_reset_time_iso,
                weekly_reset_time_ms,
                quota_description,
                quota_groups,
                online_devices,
                total_devices,
                source_device_name: Some(primary_dev.display_name.clone()),
                models,
                error_code: err_code,
                error_message: err_msg,
                fetched_at_ms: now,
            }
        });

        let accounts = join_all(futs).await;
        Ok(QuotaDashboardSnapshot {
            accounts,
            fetched_at_ms: now,
        })
    }

    pub async fn get_trajectory_steps(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        step_offset: u32,
    ) -> Result<Value, String> {
        let cache_key = format!("{account_id}|{device_uuid}|{cascade_id}|{step_offset}");
        if let Ok(cache) = self.trajectory_cache.lock() {
            if let Some((at, value)) = cache.get(&cache_key) {
                if at.elapsed() < Duration::from_secs(3) {
                    return Ok(value.clone());
                }
            }
        }

        let value = self
            .proxy_unary_json(
                account_id,
                device_uuid,
                "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps",
                json!({
                    "cascadeId": cascade_id,
                    "stepOffset": step_offset
                }),
            )
            .await?;

        if let Ok(mut cache) = self.trajectory_cache.lock() {
            if cache.len() >= 80 {
                if let Some(oldest) = cache
                    .iter()
                    .min_by_key(|(_, (at, _))| *at)
                    .map(|(key, _)| key.clone())
                {
                    cache.remove(&oldest);
                }
            }
            cache.insert(cache_key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }

    pub async fn start_cascade(
        &self,
        account_id: &str,
        device_uuid: &str,
        workspace_uri: Option<String>,
        _project_id: Option<String>,
    ) -> Result<Value, String> {
        // Keep the project_id parameter for Tauri command compatibility, but
        // StartCascadeRequest has no such field.
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/StartCascade",
            build_start_cascade_body(workspace_uri),
        )
        .await
    }

    pub async fn send_user_message(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        text: &str,
        model: Option<String>,
        media: Option<Vec<Value>>,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
            build_send_user_message_body(cascade_id, text, model, media),
        )
        .await
    }

    /// Resolve the signed-in Google profile from `ListAccounts`; this works
    /// even when the second account has no paired workstation yet.
    async fn profile_from_list_accounts(
        &self,
        account: &AccountRecord,
    ) -> Option<ResolvedAccountIdentity> {
        let cookie = account.accounts_cookie_header()?;
        let response = self
            .http
            .get("https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard&hl=en")
            .header(COOKIE, cookie)
            .header(ORIGIN, "https://accounts.google.com")
            .header(REFERER, "https://accounts.google.com/")
            .header("x-same-domain", "1")
            .send()
            .await
            .ok()?;
        let body = response.text().await.ok()?;
        let payload_start = body.find("postMessage('")? + "postMessage('".len();
        let rest = &body[payload_start..];
        let payload_end = rest.find("', '")?;
        let decoded = decode_js_hex_escapes(&rest[..payload_end]);
        let value: Value = serde_json::from_str(&decoded).ok()?;
        let account_entry = value.get(1)?.as_array()?.first()?.as_array()?;
        let name = account_entry.get(2).and_then(|v| v.as_str()).unwrap_or_default();
        let email = account_entry.get(3).and_then(|v| v.as_str())?.trim();
        if email.is_empty() {
            return None;
        }
        let avatar_url = account_entry
            .get(4)
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        Some(ResolvedAccountIdentity {
            email: email.to_string(),
            name: name.trim().to_string(),
            avatar_url: avatar_url.to_string(),
        })
    }

    /// Resolve the signed-in Google profile from the account's own workstation.
    /// Used after Google login so identity is not guessed from Cloud Sync.
    pub async fn resolve_account_identity(
        &self,
        account_id: &str,
    ) -> Option<ResolvedAccountIdentity> {
        let account = self.resolve_account(account_id).ok()?;
        if let Some(identity) = self.profile_from_list_accounts(&account).await {
            return Some(identity);
        }
        let instances = self.list_instances(Some(account_id)).await.ok()?;
        let device = instances
            .iter()
            .find(|device| device.status == "RUNNING")
            .or_else(|| instances.first())?;
        let value = self.get_user_status(account_id, &device.uuid).await.ok()?;
        let user = value.get("userStatus").unwrap_or(&value);
        let email = user
            .get("email")
            .and_then(|email| email.as_str())
            .map(str::trim)
            .unwrap_or_default();
        if email.is_empty() {
            return None;
        }
        Some(ResolvedAccountIdentity {
            email: email.to_string(),
            name: user
                .get("name")
                .and_then(|name| name.as_str())
                .unwrap_or_default()
                .trim()
                .to_string(),
            avatar_url: user
                .get("profilePictureUrl")
                .or_else(|| user.get("profilePictureUri"))
                .and_then(|avatar| avatar.as_str())
                .unwrap_or_default()
                .to_string(),
        })
    }

    pub async fn get_user_status(
        &self,
        account_id: &str,
        device_uuid: &str,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/GetUserStatus",
            json!({}),
        )
        .await
    }

    pub async fn handle_user_interaction(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        interaction: Value,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/HandleCascadeUserInteraction",
            json!({
                "cascadeId": cascade_id,
                "interaction": interaction
            }),
        )
        .await
    }

    pub async fn read_remote_file(
        &self,
        account_id: &str,
        device_uuid: &str,
        uri: &str,
    ) -> Result<Value, String> {
        let trimmed = uri.trim();
        let normalized_uri = if trimmed.starts_with("file://") {
            trimmed.to_string()
        } else if trimmed.starts_with('/') {
            format!("file://{trimmed}")
        } else if trimmed.len() >= 3
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':'
            && (trimmed.as_bytes()[2] == b'\\' || trimmed.as_bytes()[2] == b'/')
        {
            format!("file:///{}", trimmed.replace('\\', "/"))
        } else {
            trimmed.to_string()
        };

        let first = self
            .proxy_unary_json(
                account_id,
                device_uuid,
                "/exa.language_server_pb.LanguageServerService/ReadFile",
                json!({ "uri": normalized_uri }),
            )
            .await;

        if first.is_ok() {
            return first;
        }

        // Retry with percent-encoded URI if the raw path contained spaces or non-ASCII characters.
        let encoded = encode_file_uri_path(&normalized_uri);
        if encoded != normalized_uri {
            if let Ok(val) = self
                .proxy_unary_json(
                    account_id,
                    device_uuid,
                    "/exa.language_server_pb.LanguageServerService/ReadFile",
                    json!({ "uri": encoded }),
                )
                .await
            {
                return Ok(val);
            }
        }
        first
    }

    pub async fn send_all_queued_messages(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        model: Option<String>,
    ) -> Result<Value, String> {
        let mut body = json!({ "cascadeId": cascade_id });
        if let Some(m) = model {
            if !m.is_empty() {
                body["cascadeConfig"] = json!({
                    "plannerConfig": {
                        "requestedModel": { "model": m }
                    }
                });
            }
        }
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/SendAllQueuedMessages",
            body,
        )
        .await
    }

    pub async fn delete_queued_user_input_step(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        step_index: u32,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/DeleteQueuedUserInputStep",
            json!({
                "cascadeId": cascade_id,
                "stepIndex": step_index
            }),
        )
        .await
    }

    pub async fn cancel_invocation(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/CancelCascadeInvocation",
            json!({ "cascadeId": cascade_id }),
        )
        .await
    }

    pub async fn get_model_configs(
        &self,
        account_id: &str,
        device_uuid: &str,
    ) -> Result<Value, String> {
        if let Ok(primary) = self
            .proxy_unary_json(
                account_id,
                device_uuid,
                "/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs",
                json!({}),
            )
            .await
        {
            let has_models = primary
                .get("clientModelConfigs")
                .and_then(|value| value.as_array())
                .map(|list| !list.is_empty())
                .unwrap_or(false);
            if has_models {
                return Ok(primary);
            }
        }
        let available = self
            .proxy_unary_json(
                account_id,
                device_uuid,
                "/exa.language_server_pb.LanguageServerService/GetAvailableModels",
                json!({ "forceRefresh": true }),
            )
            .await?;
        Ok(available_models_to_client_configs(&available))
    }

    /// Resolve the workspace URIs of the paired machine. `StartCascadeRequest`
    /// expects at least one workspace_uri; without it the LS may create a
    /// workspace-less cascade or reject the request.
    pub async fn get_workspace_infos(
        &self,
        account_id: &str,
        device_uuid: &str,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/GetWorkspaceInfos",
            json!({}),
        )
        .await
    }

    /// Fetch the slash commands defined by the workspace/agent instead of
    /// showing the hard-coded fallback list.
    pub async fn get_slash_commands(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        model: Option<String>,
    ) -> Result<Value, String> {
        let mut model_enum = model.filter(|value| !value.is_empty());
        if model_enum.is_none() {
            if let Ok(configs) = self.get_model_configs(account_id, device_uuid).await {
                if let Some(list) = configs
                    .get("clientModelConfigs")
                    .and_then(|value| value.as_array())
                {
                    let chosen = list
                        .iter()
                        .find(|item| {
                            item.get("isRecommended")
                                .and_then(|value| value.as_bool())
                                .unwrap_or(false)
                        })
                        .or_else(|| list.first());
                    model_enum = chosen
                        .and_then(|item| item.get("modelOrAlias"))
                        .and_then(|value| value.get("model"))
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string());
                }
            }
        }
        let mut body = json!({ "cascadeId": cascade_id });
        if let Some(model_enum) = model_enum {
            body["cascadeConfig"] = json!({
                "plannerConfig": { "requestedModel": { "model": model_enum } }
            });
        }
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/GetSlashCommands",
            body,
        )
        .await
    }

    /// Live agent watcher using Google's `application/json+protobuf` ProxyCommand.
    /// Polls `GetAllCascadeTrajectories` every 2.5s to detect stepCount / status changes
    /// cleanly on both Wi-Fi and flaky mobile networks without gRPC-Web HTTP 400 failures.
    pub async fn stream_agent_state<F>(
        &self,
        account_id: String,
        device_uuid: String,
        cascade_id: String,
        mut on_event: F,
        mut cancel_rx: oneshot::Receiver<()>,
    ) where
        F: FnMut(AgentStreamEvent) + Send,
    {
        let account = match self.resolve_account(&account_id) {
            Ok(a) => a,
            Err(e) => {
                on_event(AgentStreamEvent::Error { message: e });
                on_event(AgentStreamEvent::Closed);
                return;
            }
        };

        on_event(AgentStreamEvent::Connected {
            account_id: account.id.clone(),
            device_uuid: device_uuid.clone(),
            cascade_id: cascade_id.clone(),
        });

        let mut last_sig = String::new();
        let mut consecutive_errors: u32 = 0;
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(2500));
        // Skip immediate first tick since frontend just loaded initial steps
        interval.tick().await;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    break;
                }
                _ = interval.tick() => {
                    // Always read latest account cookies in case background RotateCookies updated them
                    let latest_account = self.auth.get_account(&account.id).unwrap_or_else(|| account.clone());
                    match self
                        .proxy_unary_json_with_account(
                            &latest_account,
                            &device_uuid,
                            "/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories",
                            json!({}),
                        )
                        .await
                    {
                        Ok(val) => {
                            consecutive_errors = 0;
                            if let Some(entry) = val
                                .get("trajectorySummaries")
                                .and_then(|m| m.get(&cascade_id))
                            {
                                let step_count = entry.get("stepCount").and_then(|v| v.as_u64()).unwrap_or(0);
                                let status = entry.get("status").and_then(|v| v.as_str()).unwrap_or("");
                                let modified = entry.get("lastModifiedTime").and_then(|v| v.as_str()).unwrap_or("");
                                let sig = format!("{step_count}:{status}:{modified}");
                                if sig != last_sig {
                                    last_sig = sig;
                                    on_event(AgentStreamEvent::Update {
                                        payload: json!({
                                            "cascadeId": cascade_id,
                                            "stepCount": step_count,
                                            "status": status,
                                        }),
                                    });
                                }
                            }
                        }
                        Err(err) => {
                            consecutive_errors += 1;
                            let code = classify_account_error(&err);
                            if code == "SESSION_EXPIRED" {
                                on_event(AgentStreamEvent::Error {
                                    message: format!("SESSION_EXPIRED: {err}"),
                                });
                                break;
                            }
                            if consecutive_errors == 3 {
                                on_event(AgentStreamEvent::Error { message: err });
                            }
                        }
                    }
                }
            }
        }

        on_event(AgentStreamEvent::Closed);
    }
}

fn classify_account_error(err: &str) -> &'static str {
    let upper = err.to_ascii_uppercase();
    if upper.contains("HTTP 401")
        || upper.contains("SESSION_COOKIE_INVALID")
        || upper.contains("UNAUTHENTICATED")
        || upper.contains("MISSING SAPISID")
    {
        "SESSION_EXPIRED"
    } else if upper.contains("NETWORK ERROR")
        || upper.contains("TIMED OUT")
        || upper.contains("TIMEOUT")
        || upper.contains("DNS")
        || upper.contains("CONNECTION")
    {
        "NETWORK_ERROR"
    } else {
        "API_ERROR"
    }
}

/// Parses official `RetrieveUserQuotaSummaryResponse`:
/// `{ response: { description?: string, groups: [{ displayName, description, buckets: [{ bucketId, displayName, description, remainingFraction, resetTime, disabled }] }] } }`
fn parse_user_quota_summary(val: &Value) -> (Option<String>, Vec<QuotaGroupSummary>) {
    let root = val.get("response").unwrap_or(val);
    let description = root
        .get("description")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());
    let mut groups = Vec::new();
    if let Some(raw_groups) = root.get("groups").and_then(|v| v.as_array()) {
        for (g_idx, g) in raw_groups.iter().enumerate() {
            let display_name = g
                .get("displayName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let g_desc = g
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string());
            let mut buckets = Vec::new();
            if let Some(raw_buckets) = g.get("buckets").and_then(|v| v.as_array()) {
                for (b_idx, b) in raw_buckets.iter().enumerate() {
                    let b_name = b
                        .get("displayName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                    if b_name.is_empty() {
                        continue;
                    }
                    let bucket_id = b
                        .get("bucketId")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("bucket-{g_idx}-{b_idx}"));
                    let b_desc = b
                        .get("description")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .map(|s| s.to_string());
                    let remaining_fraction = b
                        .get("remainingFraction")
                        .and_then(|v| v.as_f64())
                        .or_else(|| {
                            b.get("remaining")
                                .and_then(|r| r.get("remainingFraction").or_else(|| r.get("value")))
                                .and_then(|v| v.as_f64())
                        });
                    let reset_val = b.get("resetTime");
                    let reset_time_iso = reset_val.and_then(|v| v.as_str()).map(|s| s.to_string());
                    let reset_time_ms = {
                        let ms = parse_proto_timestamp_ms(reset_val);
                        if ms > 0 { Some(ms) } else { None }
                    };
                    let disabled = b.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);
                    buckets.push(QuotaBucketSummary {
                        bucket_id,
                        display_name: b_name,
                        description: b_desc,
                        remaining_fraction,
                        reset_time_iso,
                        reset_time_ms,
                        disabled,
                    });
                }
            }
            if !display_name.is_empty() || !buckets.is_empty() || g_desc.is_some() {
                groups.push(QuotaGroupSummary {
                    display_name: if display_name.is_empty() {
                        format!("Quota Group {}", g_idx + 1)
                    } else {
                        display_name
                    },
                    description: g_desc,
                    buckets,
                });
            }
        }
    }
    (description, groups)
}

fn extract_weekly_quota_from_value(val: &Value) -> (Option<f64>, Option<String>, Option<u64>) {
    let root = val
        .get("quotaSummary")
        .or_else(|| val.get("userStatus"))
        .or_else(|| val.get("summary"))
        .unwrap_or(val);

    let direct_weekly = root
        .get("weeklyQuota")
        .or_else(|| root.get("longTermQuota"))
        .or_else(|| root.get("weeklyLimit"))
        .or_else(|| root.get("weeklyUsage"));

    if let Some(w) = direct_weekly {
        let frac = w
            .get("remainingFraction")
            .and_then(|v| v.as_f64())
            .or_else(|| {
                w.get("usedFraction")
                    .and_then(|v| v.as_f64())
                    .map(|used| (1.0 - used).clamp(0.0, 1.0))
            });
        let reset_val = w
            .get("resetTime")
            .or_else(|| w.get("resetTimestamp"))
            .or_else(|| w.get("quotaResetTime"));
        let iso = reset_val.and_then(|v| v.as_str()).map(|s| s.to_string());
        let ms = parse_proto_timestamp_ms(reset_val);
        if frac.is_some() {
            return (frac, iso, if ms > 0 { Some(ms) } else { None });
        }
    }

    // Check buckets array (e.g. quotaBuckets / buckets with type WEEKLY / LONG_TERM or >24h reset)
    if let Some(buckets) = root
        .get("quotaBuckets")
        .or_else(|| root.get("buckets"))
        .and_then(|v| v.as_array())
    {
        for b in buckets {
            let kind = b
                .get("bucketType")
                .or_else(|| b.get("quotaBucketType"))
                .or_else(|| b.get("window"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_ascii_uppercase();
            let is_weekly = kind.contains("WEEK") || kind.contains("LONG_TERM") || kind == "1";
            if !is_weekly {
                continue;
            }
            let frac = b
                .get("remainingFraction")
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    b.get("usedFraction")
                        .and_then(|v| v.as_f64())
                        .map(|used| (1.0 - used).clamp(0.0, 1.0))
                });
            let reset_val = b.get("resetTime").or_else(|| b.get("resetTimestamp"));
            let iso = reset_val.and_then(|v| v.as_str()).map(|s| s.to_string());
            let ms = parse_proto_timestamp_ms(reset_val);
            if frac.is_some() {
                return (frac, iso, if ms > 0 { Some(ms) } else { None });
            }
        }
    }

    (None, None, None)
}

fn parse_model_quota_list(list: &[Value]) -> Vec<ModelQuotaItem> {
    list.iter()
        .enumerate()
        .map(|(idx, m)| {
            let id = m
                .get("model")
                .or_else(|| m.get("modelOrAlias").and_then(|o| o.get("model")))
                .or_else(|| m.get("modelId"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("model-{idx}"));
            let display_name = m
                .get("label")
                .or_else(|| m.get("displayName"))
                .or_else(|| m.get("model"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| id.clone());
            let description = m
                .get("description")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.to_string());
            let quota = m.get("quotaInfo");
            let remaining_fraction = quota
                .and_then(|q| q.get("remainingFraction"))
                .and_then(|v| v.as_f64());
            let reset_val = quota.and_then(|q| q.get("resetTime"));
            let reset_time_iso = reset_val.and_then(|v| v.as_str()).map(|s| s.to_string());
            let reset_time_ms = {
                let ms = parse_proto_timestamp_ms(reset_val);
                if ms > 0 {
                    Some(ms)
                } else {
                    None
                }
            };
            let weekly_obj = quota
                .and_then(|q| q.get("weeklyQuota").or_else(|| q.get("longTermQuota")))
                .or_else(|| m.get("weeklyQuotaInfo"));
            let weekly_remaining_fraction = quota
                .and_then(|q| q.get("weeklyRemainingFraction"))
                .and_then(|v| v.as_f64())
                .or_else(|| {
                    weekly_obj
                        .and_then(|w| w.get("remainingFraction"))
                        .and_then(|v| v.as_f64())
                });
            let weekly_reset_val = quota
                .and_then(|q| q.get("weeklyResetTime"))
                .or_else(|| weekly_obj.and_then(|w| w.get("resetTime")));
            let weekly_reset_time_iso = weekly_reset_val
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let weekly_reset_time_ms = {
                let ms = parse_proto_timestamp_ms(weekly_reset_val);
                if ms > 0 {
                    Some(ms)
                } else {
                    None
                }
            };
            let is_default = m
                .get("isDefault")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let disabled = m.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false);

            ModelQuotaItem {
                id,
                display_name,
                description,
                remaining_fraction,
                reset_time_iso,
                reset_time_ms,
                weekly_remaining_fraction,
                weekly_reset_time_iso,
                weekly_reset_time_ms,
                is_default,
                disabled,
            }
        })
        .collect()
}

fn extract_boq_base_js_url(html: &str) -> Option<String> {
    let marker = "https://www.gstatic.com/_/mss/boq-jetski/_/js/";
    let mut search_from = 0usize;
    while let Some(rel) = html[search_from..].find(marker) {
        let start = search_from + rel;
        let rest = &html[start..];
        let end = rest
            .find(|c: char| c == '"' || c == '\'' || c == ' ' || c == '<' || c == '>')
            .unwrap_or(rest.len());
        let candidate = &rest[..end];
        if candidate.ends_with("/m=_b") || candidate.contains("/m=_b") {
            return Some(candidate.to_string());
        }
        search_from = start + marker.len();
    }
    None
}

fn extract_config_api_key(js: &str) -> Option<String> {
    let marker = "ConfigService.API_KEY=\"";
    let start = js.find(marker)? + marker.len();
    let rest = &js[start..];
    let end = rest.find('"')?;
    let key = rest[..end].trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn parse_proto_timestamp_ms(val: Option<&Value>) -> u64 {
    let Some(v) = val else {
        return 0;
    };
    if let Some(s) = v.as_str() {
        if let Ok(n) = s.parse::<u64>() {
            return if n > 1_000_000_000_000 { n } else { n * 1000 };
        }
        // Parse RFC3339 / ISO-8601 UTC string e.g. "2026-11-19T19:27:29.162047Z"
        if let Some(ms) = parse_iso8601_utc_ms(s) {
            return ms;
        }
    }
    if let Some(obj) = v.as_object() {
        if let Some(secs) = obj.get("seconds") {
            let s = secs
                .as_u64()
                .or_else(|| secs.as_str().and_then(|x| x.parse::<u64>().ok()))
                .unwrap_or(0);
            return s.saturating_mul(1000);
        }
    }
    0
}

fn parse_iso8601_utc_ms(s: &str) -> Option<u64> {
    let s = s.trim();
    if s.len() < 19 {
        return None;
    }
    let y: i64 = s.get(0..4)?.parse().ok()?;
    let m: i64 = s.get(5..7)?.parse().ok()?;
    let d: i64 = s.get(8..10)?.parse().ok()?;
    let hh: i64 = s.get(11..13)?.parse().ok()?;
    let mm: i64 = s.get(14..16)?.parse().ok()?;
    let ss: i64 = s.get(17..19)?.parse().ok()?;
    // Howard Hinnant civil-from-days inverse algorithm
    let y_adj = if m <= 2 { y - 1 } else { y };
    let era = y_adj.div_euclid(400);
    let yoe = y_adj.rem_euclid(400);
    let m_adj = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * m_adj + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hh * 3_600 + mm * 60 + ss;
    if secs < 0 {
        return None;
    }
    Some((secs as u64).saturating_mul(1000))
}

fn parse_jspb_instances(val: &Value) -> Vec<DeviceInstance> {
    let mut out = Vec::new();
    let Some(items) = val.get(0).and_then(|v| v.as_array()) else {
        return out;
    };
    for item in items {
        let Some(arr) = item.as_array() else {
            continue;
        };
        let uuid = arr
            .first()
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if uuid.is_empty() {
            continue;
        }
        let meta = arr.get(1).and_then(|v| v.as_array());
        let display_name = meta
            .and_then(|m| m.first())
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Host ({})", &uuid[..uuid.len().min(8)]));
        let version = meta
            .and_then(|m| m.get(1))
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "v2".to_string());
        let supports_chunking = meta
            .and_then(|m| m.get(2))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let status_code = arr.get(2).and_then(|v| v.as_u64()).unwrap_or(0);
        let status = match status_code {
            1 => "RUNNING",
            2 => "IDLE",
            _ => "DISCONNECTED",
        }
        .to_string();
        let last_active_ms = arr
            .get(3)
            .and_then(|ts| {
                ts.as_array().and_then(|a| a.first()).and_then(|s| {
                    s.as_u64()
                        .or_else(|| s.as_str().and_then(|x| x.parse::<u64>().ok()))
                })
            })
            .map(|s| s.saturating_mul(1000))
            .unwrap_or(0);

        out.push(DeviceInstance {
            uuid,
            display_name,
            version,
            status,
            last_active_ms,
            supports_chunking,
            account_id: String::new(),
            account_label: String::new(),
        });
    }
    out
}

fn b64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn b64_decode(input: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in input.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\r' | b'\n' | b' ' => continue,
            _ => return Err("Invalid base64 byte in ProxyCommand response".to_string()),
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_cascade_sends_workspace_but_no_project_id() {
        let body = build_start_cascade_body(Some("file:///workspace".into()));
        assert_eq!(body["workspaceUris"][0], "file:///workspace");
        assert!(body.get("projectId").is_none());
    }

    #[test]
    fn start_cascade_without_workspace_is_empty() {
        let body = build_start_cascade_body(None);
        assert_eq!(body, json!({}));
    }

    #[test]
    fn send_message_model_is_nested_under_requested_model() {
        let body = build_send_user_message_body(
            "cascade-1",
            "hello",
            Some("MODEL_GOOGLE_GEMINI_3_PRO".into()),
            None,
        );
        assert_eq!(
            body["cascadeConfig"]["plannerConfig"]["requestedModel"]["model"],
            "MODEL_GOOGLE_GEMINI_3_PRO"
        );
    }

    #[test]
    fn send_message_without_model_omits_cascade_config() {
        let body = build_send_user_message_body("cascade-1", "hello", None, None);
        assert!(body.get("cascadeConfig").is_none());
        assert_eq!(body["items"][0]["text"], "hello");
    }

    #[test]
    fn available_models_marks_only_the_server_default() {
        let raw = json!({
            "response": {
                "defaultAgentModelId": "model-b",
                "models": {
                    "model-a": { "displayName": "Model A", "model": "MODEL_A", "recommended": true },
                    "model-b": { "displayName": "Model B", "model": "MODEL_B", "recommended": true }
                }
            }
        });
        let normalized = available_models_to_client_configs(&raw);
        let configs = normalized["clientModelConfigs"].as_array().unwrap();
        assert_eq!(configs.len(), 2);
        assert_eq!(normalized["defaultModelId"], "model-b");
        let default = configs
            .iter()
            .filter(|model| model["isDefault"].as_bool().unwrap_or(false))
            .collect::<Vec<_>>();
        assert_eq!(default.len(), 1);
        assert_eq!(default[0]["modelOrAlias"]["model"], "MODEL_B");
    }

    #[test]
    fn send_message_keeps_media_payload() {
        let body = build_send_user_message_body(
            "cascade-1",
            "image",
            None,
            Some(vec![
                json!({ "mimeType": "image/png", "inlineData": "AA==" }),
            ]),
        );
        assert_eq!(body["media"][0]["mimeType"], "image/png");
    }

    /// Read-only probe against the real local vault. Run explicitly:
    /// `AGY_LIVE_VAULT_DIR="$HOME/Library/Application Support/com.google.antigravity.remoteapp" \
    ///  cargo test --lib live_vault_probe -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_vault_probe() {
        let dir = std::env::var("AGY_LIVE_VAULT_DIR").expect("AGY_LIVE_VAULT_DIR");
        let auth = Arc::new(AuthStore::new(std::path::PathBuf::from(dir)));
        let accounts = auth.list_accounts();
        println!("accounts={}", accounts.len());
        let account_id = accounts
            .iter()
            .filter(|account| account.enabled)
            .max_by_key(|account| account.updated_at_ms)
            .map(|account| account.id.clone())
            .expect("no enabled account in vault");

        let client = AntigravityClient::new(auth.clone());
        let instances = client
            .list_instances(Some(&account_id))
            .await
            .expect("list_instances failed");
        println!("instances={}", instances.len());
        for instance in &instances {
            println!(
                "instance status={} version={} supports_chunking={}",
                instance.status, instance.version, instance.supports_chunking
            );
        }
        let Some(device) = instances.first() else {
            println!("no paired instance; stop after instance probe");
            return;
        };

        match client.rotate_cookies_for_account(&account_id).await {
            Ok(changed) => println!("rotate_cookies changed={changed}"),
            Err(error) => println!("rotate_cookies error={error}"),
        }

        let models = client
            .get_model_configs(&account_id, &device.uuid)
            .await
            .expect("get_model_configs failed");
        std::fs::write(
            "/tmp/agy-live-model-configs.json",
            serde_json::to_vec_pretty(&models).unwrap(),
        )
        .unwrap();
        let configs = models
            .get("clientModelConfigs")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        println!("models={}", configs.len());
        for model in &configs {
            let label = model
                .get("label")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            let enum_model = model
                .get("modelOrAlias")
                .and_then(|value| value.get("model"))
                .and_then(|value| value.as_str())
                .unwrap_or("");
            println!("model label={label} enum={enum_model}");
        }
        for filter in [true, false] {
            if let Ok(raw) = client
                .proxy_unary_json(
                    &account_id,
                    &device.uuid,
                    "/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs",
                    json!({ "filter": filter }),
                )
                .await
            {
                let count = raw
                    .get("clientModelConfigs")
                    .and_then(|value| value.as_array())
                    .map(|list| list.len())
                    .unwrap_or(0);
                println!("models_filter={filter} count={count}");
            }
        }
        for (method, body) in [
            ("GetAvailableModels", json!({ "forceRefresh": true })),
            ("GetModelStatuses", json!({})),
        ] {
            match client
                .proxy_unary_json(
                    &account_id,
                    &device.uuid,
                    &format!("/exa.language_server_pb.LanguageServerService/{method}"),
                    body,
                )
                .await
            {
                Ok(raw) => {
                    std::fs::write(
                        format!("/tmp/agy-live-{method}.json"),
                        serde_json::to_vec_pretty(&raw).unwrap(),
                    )
                    .unwrap();
                    let keys = raw
                        .as_object()
                        .map(|object| object.keys().cloned().collect::<Vec<_>>());
                    println!("{method} keys={keys:?}");
                }
                Err(error) => println!("{method} error={error}"),
            }
        }

        let workspaces = client
            .get_workspace_infos(&account_id, &device.uuid)
            .await
            .expect("get_workspace_infos failed");
        std::fs::write(
            "/tmp/agy-live-workspaces.json",
            serde_json::to_vec_pretty(&workspaces).unwrap(),
        )
        .unwrap();
        println!(
            "workspaces={}",
            workspaces
                .get("workspaceInfos")
                .and_then(|value| value.as_array())
                .map(|list| list.len())
                .unwrap_or(0)
        );

        let sessions = client
            .list_all_sessions()
            .await
            .expect("list_all_sessions failed");
        println!("sessions={}", sessions.sessions.len());
        if let Some(session) = sessions
            .sessions
            .iter()
            .find(|session| session.account_id == account_id)
        {
            match client
                .get_slash_commands(&account_id, &session.device_uuid, &session.cascade_id, None)
                .await
            {
                Ok(commands) => {
                    std::fs::write(
                        "/tmp/agy-live-slash-commands.json",
                        serde_json::to_vec_pretty(&commands).unwrap(),
                    )
                    .unwrap();
                    let count = commands
                        .get("commands")
                        .and_then(|value| value.as_array())
                        .map(|list| list.len())
                        .unwrap_or(0);
                    println!("slash_commands={count}");
                    if let Some(list) = commands.get("commands").and_then(|value| value.as_array())
                    {
                        for command in list.iter().take(20) {
                            let name = command
                                .get("info")
                                .and_then(|info| info.get("name"))
                                .and_then(|value| value.as_str())
                                .unwrap_or("");
                            println!("slash name={name}");
                        }
                    }
                }
                Err(error) => println!("slash_commands_error={error}"),
            }
        }
    }

    #[test]
    fn read_only_rpc_classification() {
        assert!(is_read_only_rpc_method("GetCascadeTrajectorySteps"));
        assert!(is_read_only_rpc_method("GetAllCascadeTrajectories"));
        assert!(is_read_only_rpc_method("SearchConversations"));
        assert!(is_read_only_rpc_method("ListInstances"));
        assert!(!is_read_only_rpc_method("SendUserCascadeMessage"));
        assert!(!is_read_only_rpc_method("StartCascade"));
        assert!(!is_read_only_rpc_method("CancelCascadeInvocation"));
    }

    #[test]
    fn parses_retrieve_user_quota_summary_groups_and_buckets() {
        let raw = json!({
            "response": {
                "description": "Shared across Antigravity models",
                "groups": [
                    {
                        "displayName": "Gemini & Claude",
                        "description": "Rolling and weekly limits",
                        "buckets": [
                            {
                                "bucketId": "5h-rolling",
                                "displayName": "5-hour window",
                                "remainingFraction": 0.82,
                                "resetTime": "2026-11-24T05:00:00Z",
                                "description": "Resets every 5 hours"
                            },
                            {
                                "bucketId": "weekly",
                                "displayName": "Weekly limit",
                                "remainingFraction": 0.61,
                                "resetTime": "2026-11-30T00:00:00Z",
                                "description": "Resets weekly"
                            }
                        ]
                    }
                ]
            }
        });
        let (desc, groups) = parse_user_quota_summary(&raw);
        assert_eq!(desc.as_deref(), Some("Shared across Antigravity models"));
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].buckets.len(), 2);
        assert_eq!(groups[0].buckets[0].display_name, "5-hour window");
        assert_eq!(groups[0].buckets[0].remaining_fraction, Some(0.82));
        assert_eq!(groups[0].buckets[1].display_name, "Weekly limit");
        assert_eq!(groups[0].buckets[1].remaining_fraction, Some(0.61));
        assert!(groups[0].buckets[1].reset_time_ms.is_some());
    }
}
