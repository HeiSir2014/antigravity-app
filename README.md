# Antigravity App ⚡✦

> Cross-platform unified client (Android & Desktop) combining **Google Gemini Chat** and **Google Antigravity Code Remote Control** into a seamless, native-feel mobile & desktop experience.
> Reverse-engineered and inspired by the UX architecture of Anthropic's Claude Code Remote Control (`com.anthropic.claude`).

---

## 🌟 Key Features

- **✦ Dual-Engine Instant Switching**:
  - `✦ Chat`: Full-featured `https://gemini.google.com/app` integration with native IME support, Google SSO authentication, and conversation synchronization.
  - `⚡ Code`: Deep integration with `https://antigravity.google.com/remote` and Remote Control workstations (`/r/:uuid`).
  - Seamless zero-latency switching between Chat and Code via the persistent unified topbar.
- **🖥️ Multi-Device Remote Session Aggregator**:
  - Solves the web limitation of having to select a workstation first.
  - Automatically discovers paired workstations via boq-jetski GrpcClientService and aggregates sessions across all machines into a single unified list.
  - 1-tap deep linking to any remote session on any device.
- **📱 Claude-Style Bottom Sheets & Navigation**:
  - Native `<dialog>` modal bottom sheets following modern web guidance (`closedby="any"`, gesture-dismissible).
  - Workstations & Sessions explorer, Diff review, Approval inspector, Terminal output, and System Settings.
  - Mobile-first adaptive topbar with customizable height (48px / 54px / 60px) and global typography options (12px ~ 18px).
- **🛡️ Trusted Types & CSP Security**:
  - 100% compliant with Google's strict `require-trusted-types-for 'script'` Content Security Policy.
  - Zero `innerHTML` / `eval` usage — all DOM manipulations use typed element builders (`el()`).
- **🔔 Native System Notifications & Quick Actions**:
  - Background notification receiver for agent permission decisions and approvals (`AGYPermissionActionReceiver`).

---

## 🏗️ Architecture

```text
antigravity-app/
├── src/
│   ├── inject/                      # Trusted-Types WebView bridge engine
│   │   ├── agy-bridge.ts            # Entrypoint for antigravity.google.com
│   │   ├── gemini-bridge.ts         # Entrypoint for gemini.google.com/app
│   │   ├── shared-nav-bar.ts        # Unified Topbar & Drawer navigation
│   │   ├── claude-bottom-sheets.ts  # Modal bottom sheets
│   │   ├── multi-device-aggregator.ts # Stateless RPC fan-out aggregator
│   │   ├── quick-composer.ts        # 3-part IME guard & Slash command dock
│   │   └── dom-safe.ts              # Zero-innerHTML DOM builder & CSS adopter
│   └── generated/                   # IIFE bundles compiled via Bun
├── src-tauri/                       # Tauri v2 native host (Rust + Kotlin)
│   ├── src/lib.rs                   # Multi-window & state synchronization
│   └── gen/android/                 # Android WebView container & permissions
└── AGENTS.md                        # Authoritative engineering rules & architecture
```

---

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (v1.0+)
- [Rust](https://rustup.rs/) (v1.75+)
- Android SDK & NDK (for Android builds)

### Development Commands

```bash
# 1. Install dependencies
bun install

# 2. Bundle WebView injection scripts
bun run build:inject

# 3. Typecheck and build frontend
bun run build

# 4. Run Desktop (macOS / Linux / Windows)
bun run tauri dev

# 5. Run Android in debug mode
bun run tauri android dev
```

### Building Release APK

```bash
# Build universal release APK
bun run tauri android build --target aarch64
```
Output APK location:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

---

## 📄 License

Apache-2.0 / MIT
