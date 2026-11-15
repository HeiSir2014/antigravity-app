---
trigger: always_on
description: Antigravity App Architecture, Bun Toolchain, Modern Web Guidance & Trusted Types Security Rules
---

# Antigravity App Engineering Rules (`AGENTS.md`)

## 1. Package Manager, File Editing, Privacy & Build Commands
- **Mandatory File Editing Rule**: **ONLY use the dedicated `edit_file` / `write_file` tools** to create or modify files. **NEVER** use `python`, `sed`, `awk`, `cat <<EOF`, or shell scripts via `run_command` to edit or write files.
- **Privacy & Open-Source Hygiene**: **NEVER** commit or write local absolute user paths, personal machine hostnames, ADB serial numbers, or real session/instance UUIDs into documentation, comments, or code. Always use relative repository paths (`./`, `antigravity-app/`) and anonymized placeholders (`<instance-uuid>`, `<cascade-id>`).
- **Mandatory Package Manager & Bundler**: **ALWAYS use `bun`** (`bun install`, `bun run`, `bun build`, `bunx`). **NEVER** use `pnpm`, `pnpx`, `npm`, or `npx` for project scripts or dependency management.
- **Core Build Pipeline**:
  - `bun run build:inject`: Uses native `bun build --format=iife --target=browser` to bundle `src/inject/agy-bridge.ts` -> `src/generated/agy-bridge.iife.js` and `src/inject/gemini-bridge.ts` -> `src/generated/gemini-bridge.iife.js`.
  - `bun run build`: Runs `bun run build:inject && tsc --noEmit && vite build`. **Must always pass with 0 errors before checking `src-tauri`.**
  - `cd src-tauri && cargo check`: Verifies the Rust Tauri v2 host (which embeds `src/generated/*.iife.js` via `include_str!`).
  - `bun run tauri dev` / `bun run tauri android dev`: Launches Desktop or Android targets.

## 2. Single-App Dual-Engine Fusion Architecture
This app fuses **`https://gemini.google.com/app`** (Home / Chat) and **`https://antigravity.google.com/remote` + `/r/:uuid`** (Code Remote Control) into **one cohesive native-feel application**:
- **Shared Google SSO & Subscription**: Both top-level WebViews share the OS-level cookie store (`android.webkit.CookieManager` on Android, `WKWebsiteDataStore` on macOS). Never isolate cookies between the `gemini` and `antigravity` WebViews.
- **OAuth User-Agent Sanitization**: Always strip `; wv` and `Version/\d+\.\d+` from the WebView User-Agent (in both `src-tauri/src/lib.rs` and `MainActivity.kt`) so `accounts.google.com` never rejects sign-in with `403 disallowed_useragent`.
- **Top-Frame Host vs. `#hubFrame` Guest Iframe Split (`src/inject/agy-bridge.ts`)**:
  - When viewing a Remote Control machine at `https://antigravity.google.com/r/:uuid`, the outer host page (`window.self === window.top`) mounts `<ga-remote-control>` containing `<iframe #hubFrame src="https://antigravity.static.usercontent.goog/web/<version>/?iframe=true">`.
  - **Rule**: Because Tauri injects `agy-bridge.iife.js` with `.initialization_script_for_all_frames()`, `agy-bridge.ts` MUST check `window.self === window.top`:
    - **Top Frame (`isTopFrame === true`)**: Mounts the single `48px` Unified Top Bar (`#agy-unified-topbar`), Unified Drawer (`dialog.agy-unified-drawer`), Quick Composer Dock (`#agy-quick-dock`), 9 Claude Bottom Sheets (`dialog.agy-bottom-sheet`), and `MultiDeviceSessionAggregator`.
    - **Guest Iframe (`isTopFrame === false`)**: Runs `bootGuestHubFrameBridge()` ONLY — attaches the IME-safe Enter guard and listens for `AGY_GUEST_COMMAND` (`INSERT_COMPOSER` / `PERMISSION_DECISION`) via `postMessage` from `https://antigravity.google.com`. Never mount a second topbar or bottom dock inside `#hubFrame`.

## 3. Multi-Device Remote Session Aggregation Protocol (`src/inject/multi-device-aggregator.ts`)
Unlike the default Antigravity web UI (which forces selecting a machine before viewing its sessions), our app aggregates sessions across all machines like Claude Code (`com.anthropic.claude`):
- **Discovery**: Hooks `window.default_GoogleAntigravity.KC.GrpcClientService`, `window.default_GoogleAntigravity.cF.RemoteControlComponent`, and `globalThis.__JETSKI_LS_CLIENT_DECORATOR__`. Calls `/$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances` (`_.wk`) to list all paired machines (`RUNNING`, `IDLE`, `DISCONNECTED`).
- **Multiplexed Parallel Crawl**: Fans out stateless `/$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand` (`_.pk`) requests across all online `target_instance_uuid`s concurrently (`Promise.allSettled`) with:
  - `rpc_path`: `"/exa.language_server_pb.LanguageServerService/SearchConversations"`
  - `payload`: UTF-8 JSON `{"query":"","limit":25}` (`Content-Type: application/json`)
- **1-Tap Cross-Device Deep Linking (`openUnifiedSession`)**:
  - Same-device jump: Calls `RemoteControlComponent.navigateIframeToChildPath("c/<cascadeId>?project=<projectId>&tab=<chat|review|terminal>")` for 0ms in-memory navigation.
  - Cross-device jump: Navigates directly to `https://antigravity.google.com/r/<deviceUuid>?p=c%2F<cascadeId>%3Fproject%3D<projectId>%26tab%3D<tab>`.
- **Cross-Engine State Sync**: Synchronizes `UnifiedAppState` (`devices`, `sessions`, `geminiChats`) between the Gemini and Antigravity WebViews via `sync_unified_state` / `get_unified_state` (`src-tauri/src/lib.rs` & `MainActivity.kt`).

## 4. Remote WebView Security & Trusted Types Compliance
Both `https://antigravity.google.com`, `https://antigravity.static.usercontent.goog`, and `https://gemini.google.com` enforce:
- `X-Frame-Options: SAMEORIGIN` / `Cross-Origin-Opener-Policy: same-origin` (Never embed via custom `<iframe>`; always use top-level native WebViews).
- `Content-Security-Policy: require-trusted-types-for 'script'` with per-response cryptographic nonces.
- **STRICT RULES FOR ALL CODE IN `src/inject/*`**:
  1. **NEVER** assign strings to `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, or `<script>.textContent`.
  2. **ALWAYS** build DOM trees using `el()` and `clearChildren()` from `src/inject/dom-safe.ts` (`document.createElement`, `textContent`, `appendChild`).
  3. **ALWAYS** inject styles using `adoptStyleSheet()` from `src/inject/dom-safe.ts` (`new CSSStyleSheet()`, `sheet.replaceSync()`, `document.adoptedStyleSheets`).
  4. **ALWAYS** validate `event.origin` against `ALLOWED_ORIGINS` (`https://antigravity.google.com`, `https://antigravity.static.usercontent.goog`, `https://gemini.google.com`) in `window.addEventListener('message', ...)`.

## 5. Modern Web Guidance & Mobile UX Standards
- Always consult `modern-web-guidance` (`bunx modern-web-guidance@latest search "<query>"`) before introducing new UI components or CSS patterns.
- Target modern Chromium (Android System WebView 124+ / Desktop WebView) and WKWebView (macOS 15+).
- Use native `<dialog>` with `.showModal()`, `closedby="any"` (plus pointer light-dismiss fallback), `overscroll-behavior: contain`, `color-scheme: light dark`, `light-dark()`, `44px` minimum coarse-pointer touch targets, and the 3-part IME-safe Enter guard (`event.isComposing || event.keyCode === 229 || Math.abs(event.timeStamp - lastCompositionEndAt) < 50`).
