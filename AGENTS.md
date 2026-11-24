# AGENTS.md — Antigravity Unified App (Gemini Chat + Antigravity Code Remote)

> This document is the authoritative engineering guide for AI coding agents working in this repository (`antigravity-app`). Also mirrored in [`.agents/rules/AGENTS.md`](.agents/rules/AGENTS.md) and [`CLAUDE.md`](CLAUDE.md).

---

## 1. Project Overview

**Antigravity App** is a cross-platform mobile (Android) and desktop (macOS/Windows/Linux) application built with **Tauri v2 + TypeScript + Kotlin** that fuses:
1. **`✦ Chat (Home)` — `https://gemini.google.com/app`**
2. **`⚡ Code (Remote)` — `https://antigravity.google.com/remote` & `https://antigravity.google.com/r/:uuid`**

into **one cohesive native-feel application**, modeled after the mobile UX and reverse-engineered architecture of Anthropic's **Claude Android App (`com.anthropic.claude` v1.261112.18 Code Remote Control)**.

---

## 2. Toolchain, File Editing, Privacy & Commands (`bun` Only)

- **File Editing Policy**: **Strictly use the `edit_file` and `write_file` tools** to create or modify files. Never use Python scripts, `sed`, `awk`, or shell redirections (`cat <<EOF`) to edit files.
- **Privacy & Open-Source Hygiene**: **Never** write local absolute user paths, personal machine hostnames, device serial numbers, or real session/instance UUIDs into any source file, comment, or documentation. Always use repository-relative paths (`./`, `antigravity-app/`) and placeholder identifiers (`<instance-uuid>`, `<cascade-id>`).
- **Package Manager & Bundler**: **Strictly use `bun`** (`bun install`, `bun build`, `bun run`, `bunx`). Do **not** use `pnpm` or `npm`.
- **Key Commands**:
  ```bash
  # Install dependencies
  bun install

  # Bundle injected WebView scripts (agy-bridge.iife.js & gemini-bridge.iife.js) in ~4ms
  bun run build:inject

  # Full frontend + bridge build & TypeScript typecheck
  bun run build

  # Verify Rust Tauri v2 backend (must run after bun run build:inject)
  cd src-tauri && cargo check

  # Launch Desktop app in development mode
  bun run tauri dev

  # Build / run Android target (requires ANDROID_HOME, NDK_HOME, JAVA_HOME)
  bun run tauri android dev
  ```

---

## 3. Repository Structure

```text
antigravity-app/
├── .agents/rules/AGENTS.md          # Always-on agent engineering & security rules
├── AGENTS.md                        # Root engineering documentation (this file)
├── CLAUDE.md                        # Pointer & quick reference for Claude/agent tools
├── package.json                     # Bun scripts & dependencies
├── src/
│   ├── main.ts                      # Local diagnostic & interactive Bottom Sheet preview hub
│   ├── styles.css                   # Baseline light-dark() & responsive styles
│   ├── generated/                   # Built by `bun run build:inject` (embedded into Rust via include_str!)
│   │   ├── agy-bridge.iife.js
│   │   └── gemini-bridge.iife.js
│   └── inject/                      # Trusted-Types-safe WebView injection engine
│       ├── dom-safe.ts              # Zero-innerHTML DOM builder (`el`), `adoptStyleSheet`, Native IPC bridge
│       ├── multi-device-aggregator.ts # Hooks `boq-jetski` ListInstances + ProxyCommand(SearchConversations)
│       ├── shared-nav-bar.ts        # Unified 48px Top Bar, Chrome stripper, & Cross-Engine Unified Drawer
│       ├── claude-bottom-sheets.ts  # 9 Claude-style `<dialog>` Bottom Sheet destinations
│       ├── quick-composer.ts        # 3-part IME-safe Enter guard & horizontal scroll-snap slash dock
│       ├── agy-bridge.ts            # Entrypoint for antigravity.google.com & guest #hubFrame
│       └── gemini-bridge.ts         # Entrypoint for gemini.google.com/app (+ "Send to Code" handoff)
└── src-tauri/
    ├── Cargo.toml                   # Tauri v2 Rust dependencies
    ├── tauri.conf.json              # Tauri v2 config (uses `bun run ...`)
    ├── src/lib.rs                   # Dual-window manager, `sync_unified_state`, `navigate_to_remote_session`
    └── gen/android/                 # Android Gradle project (compileSdk = 36, targetSdk = 36)
        └── app/src/main/java/com/google/antigravity/remoteapp/
            ├── MainActivity.kt               # Dual-WebView FrameLayout container + AgyAndroidBridge
            └── AGYPermissionActionReceiver.kt # 1:1 counterpart of Claude's CCRPermissionActionReceiver
```

---

## 4. Deep Architectural Invariants (Read Before Modifying)

### 4.1 Top-Frame Host vs. `#hubFrame` Guest Iframe Split
When connected to a Remote Control workstation at `https://antigravity.google.com/r/<instanceUuid>?p=c%2F<cascadeId>%3Fproject%3D<projectId>%26tab%3D<tab>`:
- The outer frame (`https://antigravity.google.com/r/:uuid`) runs Angular's `RemoteControlComponent` (`<ga-remote-control>`).
- Inside `<ga-remote-control>`, it mounts a cross-origin guest iframe: `<iframe #hubFrame src="https://antigravity.static.usercontent.goog/web/<version>/?iframe=true">`.
- Because `src-tauri/src/lib.rs` registers `AGY_BRIDGE_SCRIPT` via `.initialization_script_for_all_frames()`, `src/inject/agy-bridge.ts` checks `isTopFrame` (`window.self === window.top`):
  - **Top Frame (`https://antigravity.google.com`)**: Mounts `#agy-unified-topbar`, `dialog.agy-unified-drawer`, `#agy-quick-dock`, `dialog.agy-bottom-sheet`, and runs `MultiDeviceSessionAggregator`. Forwards composer insertions and approval decisions into `#hubFrame` via `postMessage({ type: 'AGY_GUEST_COMMAND', ... })`.
  - **Guest Frame (`https://antigravity.static.usercontent.goog`)**: Runs `bootGuestHubFrameBridge()` — attaches the IME-safe Enter guard to the inner composer and executes `AGY_GUEST_COMMAND` actions without rendering duplicate chrome.

### 4.2 Solving "Select Device First" via Stateless `ProxyCommand` Fan-Out
In `boq-jetski.GoogleAntigravity` (`m=_b`, `m=Mc2QKe`, `m=PGmR6b`):
- `window.default_GoogleAntigravity.KC.GrpcClientService` provides an authenticated `ApiServicePromiseClient`.
- `/$rpc/devtools_jetski_boq_api_proto.ApiService/ListInstances` (`_.wk`) lists all paired machines.
- `/$rpc/devtools_jetski_boq_api_proto.ApiService/ProxyCommand` (`_.pk`) is **stateless** and accepts any `target_instance_uuid` in field 1.
- `src/inject/multi-device-aggregator.ts` fans out `ProxyCommand(device.uuid, "/exa.language_server_pb.LanguageServerService/SearchConversations", {"query":"","limit":25})` across all online devices in parallel (`Promise.allSettled`), merging all sessions into a single unified feed sorted by `lastModifiedMs`.

### 4.3 Mandatory Trusted Types & CSP Compliance
Both `antigravity.google.com` and `gemini.google.com` enforce `Content-Security-Policy: require-trusted-types-for 'script'`.
- **Forbidden APIs in `src/inject/*`**: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`.
- **Required Helpers**: Always use `el()`, `clearChildren()`, and `adoptStyleSheet()` from `src/inject/dom-safe.ts`.

---

## 5. Release & Web Portal Deployment Rule (`server/`)

Whenever publishing a new app version (`vX.Y.Z`):
1. **Update Portal Fallback & Highlights (`server/src/portal.ts`)**:
   - Update `DEFAULT_RELEASE` to the newly published `vX.Y.Z` tag, download URLs, and exact asset sizes so the portal never falls back to a stale release if GitHub API is slow or rate-limited.
   - Update feature highlights or screenshots in `server/public/screenshots/` whenever user-facing capabilities change.
2. **Deploy Updated Portal (`server/`)**:
   - Sync updated `server/` source and assets to the production portal host (`<portal-ssh-host>:~/antigravity-sync-server/`, preserving `.env` and the `sync-data` Docker volume) and run `docker compose up -d --build`.
   - Keep concrete SSH hostnames/usernames out of git-tracked files (store local deploy targets in gitignored `CLAUDE.local.md` or `~/.ssh/config`).
3. **Verify Live Portal**:
   - Confirm `https://antigravity.yterm.cn/health` returns `"ok": true` and `"portalVersion": "vX.Y.Z"`, and that `https://antigravity.yterm.cn/` renders the `vX.Y.Z` version badge and download links.
