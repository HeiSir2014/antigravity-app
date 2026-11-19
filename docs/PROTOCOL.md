# Antigravity Native Protocol Specification

This document describes the extracted wire protocol used by the pure-native **Antigravity v2** Tauri client to communicate directly with `https://antigravity.google.com` and remote paired workstations (`exa.language_server_pb.LanguageServerService`).

---

## 1. Transport & Authentication (`boq-jetski`)

All outer API calls are **gRPC-Web Binary (`application/grpc-web+proto`)** requests over HTTPS to `https://antigravity.google.com`.

### Required HTTP Headers
| Header | Value |
| :--- | :--- |
| `Content-Type` | `application/grpc-web+proto` |
| `Accept` | `application/grpc-web+proto` |
| `X-Grpc-Web` | `1` |
| `X-User-Agent` | `grpc-web-javascript/0.1` |
| `X-Goog-Api-Key` | Public web client key from `ConfigService.API_KEY` |
| `X-Goog-AuthUser` | `0` (configurable session index) |
| `X-Goog-Encode-Response-If-Executable` | `base64` |
| `X-Origin` / `Origin` | `https://antigravity.google.com` |
| `X-Referer` / `Referer` | `https://antigravity.google.com/` |
| `Authorization` | First-party Google cookie hash (`SAPISIDHASH`, `SAPISID1PHASH`, `SAPISID3PHASH`) |
| `Cookie` | Authenticated Google session cookies (`SID`, `SAPISID`, `__Secure-1PSID`, `__Secure-3PSID`, `__Secure-1PAPISID`, `__Secure-3PAPISID`, etc.) |

### `SAPISIDHASH` Derivation
For each available cookie (`SAPISID` -> `SAPISIDHASH`, `__Secure-1PAPISID` -> `SAPISID1PHASH`, `__Secure-3PAPISID` -> `SAPISID3PHASH`):
```text
ts = floor(unix_timestamp_seconds)
digest = lowercase_hex(SHA1(f"{ts} {cookie_value} https://antigravity.google.com"))
token = f"{SCHEME} {ts}_{digest}"
```
Join all generated tokens with a single space.

### gRPC-Web Binary Framing
Each message frame has a 5-byte header:
- Byte 0: `flags` (`0x00` = data frame, `0x80` = trailer frame)
- Bytes 1..5: `length` (big-endian `u32`)
- Bytes 5..(5 + length): protobuf payload (for `0x00`) or ASCII `key: value\r\n` trailers (for `0x80`, containing `grpc-status` and `grpc-message`).

---

## 2. Outer Control Plane (`devtools_jetski_boq_api_proto.ApiService`)

### 2.1 `ListInstances` (Unary)
- **Path**: `POST /$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances`
- **Request (`ListInstancesRequest`)**:
  - `field 1 (string)`: `project` (optional, default `""`)
- **Response (`ListInstancesResponse`)**:
  - `field 1 (repeated InstanceDetails)`: `instances`
    - `field 1 (string)`: `uuid`
    - `field 2 (InstanceMetadata)`: `metadata`
      - `field 1 (string)`: `name`
      - `field 2 (string)`: `version`
      - `field 3 (bool)`: `supports_chunking`
    - `field 3 (enum InstanceStatus)`: `status` (`0=UNSPECIFIED`, `1=RUNNING`, `2=IDLE`, `3=DISCONNECTED`)
    - `field 4 (google.protobuf.Timestamp)`: `status_last_updated_at` (`field 1: int64 seconds`, `field 2: int32 nanos`)
  - `field 2 (int32)`: `max_connected_instances`

### 2.2 `ProxyCommand` (Unary) & `StreamProxyCommand` (Server-Streaming)
- **Paths**:
  - `POST /$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand?$unique=<MethodName>`
  - `POST /$rpc/devtools_jetski_boq_api_proto.ApiService/StreamProxyCommand?$unique=<MethodName>`
- **Request (`ProxyCommandRequest`)**:
  - `field 1 (string)`: `target_instance_uuid`
  - `field 2 (string)`: `rpc_path` (e.g. `"/exa.language_server_pb.LanguageServerService/SearchConversations"`)
  - `field 3 (bytes)`: `payload` (UTF-8 JSON for unary `application/json`, or 5-byte Connect-framed JSON for streaming `application/connect+json`)
  - `field 4 (map<string, string>)`: `headers`
- **Response (`ProxyCommandResponse`)**:
  - `field 1 (bytes)`: `payload`
  - `field 2 (map<string, string>)`: `headers`

---

## 3. Inner Agent Plane (`exa.language_server_pb.LanguageServerService`)

Tunneled statelessly to any paired machine via `ProxyCommand` / `StreamProxyCommand`:

| RPC Method | Mode | Purpose |
| :--- | :--- | :--- |
| `SearchConversations` | Unary | Search/list conversations (`{"query":"","limit":25}`) |
| `GetAllCascadeTrajectories` | Unary | Fetch trajectory summaries & statuses across workspaces |
| `GetCascadeTrajectorySteps` | Unary | Paginated load of all steps (`{"cascadeId":"<id>","stepOffset":0}`) |
| `StreamAgentStateUpdates` | Server-Stream | Real-time streaming of step deltas, thinking, tool calls, and approval prompts |
| `StartCascade` | Unary | Create a new conversation on a target machine/workspace |
| `SendUserCascadeMessage` | Unary | Send user prompt, attachments, model & permission overrides |
| `HandleCascadeUserInteraction` | Unary | Approve/deny pending tool calls, shell commands, or file permissions |
| `CancelCascadeInvocation` | Unary | Stop an active agent run |
| `GetCascadeModelConfigs` | Unary | List available models on the remote instance |
| `StreamTerminalOutput` | Server-Stream | Live stdout/stderr stream for background terminal commands |
