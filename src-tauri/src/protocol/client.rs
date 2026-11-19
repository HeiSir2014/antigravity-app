use crate::auth::{AccountRecord, AccountSummary, AuthStore, ANTIGRAVITY_ORIGIN};
use crate::protocol::wire::{
    decode_list_instances_response, decode_proxy_command_response, encode_grpc_web_frame,
    encode_proxy_command_request, extract_connect_or_raw_json,
    DeviceInstance, GrpcWebDecoder, GrpcWebFrame,
};
use futures_util::{future::join_all, StreamExt};
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN, REFERER,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::oneshot;

const LIST_INSTANCES_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances";
const PROXY_COMMAND_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand";
const STREAM_PROXY_COMMAND_URL: &str =
    "https://antigravity.google.com/$rpc/devtools_jetski_boq_api_proto.ApiService/StreamProxyCommand";
const REMOTE_BOOTSTRAP_URL: &str = "https://antigravity.google.com/remote";

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

pub struct AntigravityClient {
    http: reqwest::Client,
    auth: Arc<AuthStore>,
    cached_api_key: RwLock<Option<String>>,
}

impl AntigravityClient {
    pub fn new(auth: Arc<AuthStore>) -> Self {
        let http = reqwest::Client::builder()
            .use_rustls_tls()
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
        }
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

        let key = extract_config_api_key(&js)
            .ok_or_else(|| "Could not extract public ConfigService.API_KEY from bundle".to_string())?;

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
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/grpc-web+proto"));
        headers.insert(ACCEPT, HeaderValue::from_static("application/grpc-web+proto"));
        headers.insert("x-grpc-web", HeaderValue::from_static("1"));
        headers.insert("x-user-agent", HeaderValue::from_static("grpc-web-javascript/0.1"));
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
        headers.insert(REFERER, HeaderValue::from_static("https://antigravity.google.com/"));
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
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json+protobuf"));
        headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
        headers.insert("x-user-agent", HeaderValue::from_static("grpc-web-javascript/0.1"));
        headers.insert(
            "x-goog-api-key",
            HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
        );
        headers.insert(
            "x-goog-authuser",
            HeaderValue::from_str(&account.auth_user.to_string()).map_err(|e| e.to_string())?,
        );
        headers.insert(ORIGIN, HeaderValue::from_static(ANTIGRAVITY_ORIGIN));
        headers.insert(REFERER, HeaderValue::from_static("https://antigravity.google.com/"));
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
        let headers = self.build_jspb_headers_for(account).await?;

        let resp = self
            .http
            .post(LIST_INSTANCES_URL)
            .headers(headers)
            .body("[]")
            .send()
            .await
            .map_err(|e| format!("ListInstances network error: {e}"))?;

        let status = resp.status();
        let raw_bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("ListInstances read error: {e}"))?;

        if !status.is_success() {
            let err_preview = String::from_utf8_lossy(&raw_bytes);
            let short: String = err_preview.chars().take(180).collect();
            return Err(format!("ListInstances HTTP {status}: {short}"));
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
            d.account_id = account.id.clone();
            d.account_label = account.label.clone();
        }
        Ok(list)
    }

    pub async fn list_instances(&self, account_id: Option<&str>) -> Result<Vec<DeviceInstance>, String> {
        if let Some(aid) = account_id.filter(|s| !s.is_empty()) {
            let acc = self.resolve_account(aid)?;
            return self.list_instances_for_account(&acc).await;
        }
        let accounts = self.auth.enabled_authenticated_accounts();
        let futs = accounts
            .iter()
            .map(|acc| self.list_instances_for_account(acc));
        let results = join_all(futs).await;
        Ok(results.into_iter().filter_map(|r| r.ok()).flatten().collect())
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
        let headers = self.build_jspb_headers_for(account).await?;
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
        let url = format!("{PROXY_COMMAND_URL}?$unique={method_name}");

        let mut last_err = String::new();
        for attempt in 0..3 {
            let resp = self
                .http
                .post(&url)
                .headers(headers.clone())
                .body(jspb_body.clone())
                .send()
                .await
                .map_err(|e| format!("ProxyCommand({method_name}) network error: {e}"))?;

            let status = resp.status();
            let raw_bytes = resp
                .bytes()
                .await
                .map_err(|e| format!("ProxyCommand({method_name}) read error: {e}"))?;

            if !status.is_success() {
                let preview = String::from_utf8_lossy(&raw_bytes);
                let short: String = preview.chars().take(180).collect();
                last_err = format!("ProxyCommand({method_name}) HTTP {status}: {short}");
                if preview.contains("TUNNEL_UNAVAILABLE") && attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
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
    pub async fn list_all_sessions(&self) -> Result<AllSessionsSnapshot, String> {
        let account_summaries = self.auth.list_accounts();
        let enabled_accounts = self.auth.enabled_authenticated_accounts();

        let per_account_futs = enabled_accounts.into_iter().map(|account| async move {
            let devices = self
                .list_instances_for_account(&account)
                .await
                .unwrap_or_default();
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
                        if let Some(map) = val.get("trajectorySummaries").and_then(|v| v.as_object()) {
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
                                        format!("{} ({})", workspace_name, &cascade_id[..cascade_id.len().min(6)])
                                    });
                                let step_count = item
                                    .get("stepCount")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(0) as u32;
                                let last_modified_ms =
                                    parse_proto_timestamp_ms(item.get("lastModifiedTime"));
                                let raw_status = item.get("status").and_then(|v| v.as_str()).unwrap_or("");
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
                                        id: format!("{}::{}::{}", acc_ref.id, device.uuid, cascade_id),
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
                                        id: format!("{}::{}::{}", acc_ref.id, device.uuid, cascade_id),
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
            (devices, sessions)
        });

        let aggregated = join_all(per_account_futs).await;
        let mut all_devices = Vec::new();
        let mut all_sessions = Vec::new();
        for (devs, sess) in aggregated {
            all_devices.extend(devs);
            all_sessions.extend(sess);
        }
        all_sessions.sort_by(|a, b| b.last_modified_ms.cmp(&a.last_modified_ms));

        Ok(AllSessionsSnapshot {
            accounts: account_summaries,
            devices: all_devices,
            sessions: all_sessions,
        })
    }

    pub async fn get_trajectory_steps(
        &self,
        account_id: &str,
        device_uuid: &str,
        cascade_id: &str,
        step_offset: u32,
    ) -> Result<Value, String> {
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/GetCascadeTrajectorySteps",
            json!({
                "cascadeId": cascade_id,
                "stepOffset": step_offset
            }),
        )
        .await
    }

    pub async fn start_cascade(
        &self,
        account_id: &str,
        device_uuid: &str,
        workspace_uri: Option<String>,
        project_id: Option<String>,
    ) -> Result<Value, String> {
        let mut body = serde_json::Map::new();
        if let Some(uri) = workspace_uri {
            if !uri.is_empty() {
                body.insert("workspaceUris".to_string(), json!([uri]));
            }
        }
        if let Some(pid) = project_id {
            if !pid.is_empty() {
                body.insert("projectId".to_string(), json!(pid));
            }
        }
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/StartCascade",
            Value::Object(body),
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
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage",
            body,
        )
        .await
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
        self.proxy_unary_json(
            account_id,
            device_uuid,
            "/exa.language_server_pb.LanguageServerService/GetCascadeModelConfigs",
            json!({}),
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
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(2500));
        // Skip immediate first tick since frontend just loaded initial steps
        interval.tick().await;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    break;
                }
                _ = interval.tick() => {
                    if let Ok(val) = self
                        .proxy_unary_json_with_account(
                            &account,
                            &device_uuid,
                            "/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories",
                            json!({}),
                        )
                        .await
                    {
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
                }
            }
        }

        on_event(AgentStreamEvent::Closed);
    }
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
        out.push(if chunk.len() > 1 { TABLE[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(n & 63) as usize] as char } else { '=' });
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
