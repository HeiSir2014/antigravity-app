<p align="center">
  <img src="src/assets/antigravity-icon.png" width="96" height="96" alt="Antigravity App Icon" />
</p>

<h1 align="center">Antigravity App (v2 — Pure Native)</h1>

<p align="center">
  <strong>Pure-Native Cross-Platform Mobile (Android) &amp; Desktop (macOS / Windows / Linux) Client for Google Antigravity Remote Control</strong><br/>
  Built with <strong>Tauri v2 · Rust · React 19 · Tailwind CSS v4 · Bun</strong>
</p>

<p align="center">
  <em>100% of the codebase in this repository was engineered and authored by <strong>Gemini 4 Neon</strong>.</em>
</p>

---

## Visual Showcase

| Light Mode (Agent Timeline) | Dark Mode (Warm Obsidian) | Multi-Account × Multi-Device Drawer |
| :---: | :---: | :---: |
| <img src="docs/screenshots/timeline-light.png" width="240" alt="Timeline Light" /> | <img src="docs/screenshots/timeline-dark.png" width="240" alt="Timeline Dark" /> | <img src="docs/screenshots/drawer-multi-account.png" width="240" alt="Multi-Account Drawer" /> |

| Visual Code Diff Sheet | Model Switcher & Quota Bars | 1:1 Claude Mobile Account & Settings |
| :---: | :---: | :---: |
| <img src="docs/screenshots/diff-preview.png" width="240" alt="Diff Preview" /> | <img src="docs/screenshots/model-quota.png" width="240" alt="Model Quota" /> | <img src="docs/screenshots/settings-account.png" width="240" alt="Account Settings" /> |

---

## Key Highlights

- **Pure-Native Protocol Engine (Rust)**:
  - Extracted the underlying `boq-jetski` gRPC-Web Binary (`ListInstances`, `ProxyCommand`, `StreamProxyCommand`) and `exa.language_server_pb.LanguageServerService` protocols directly into Rust (`reqwest` HTTP/2 + `rustls`, zero CORS, zero WebView DOM injection). See [docs/PROTOCOL.md](docs/PROTOCOL.md).
  - First-party Google `SAPISIDHASH` / `SAPISID1PHASH` / `SAPISID3PHASH` signing with per-account isolation.
- **Multi-Account × Multi-Device Aggregation**:
  - Concurrently fans out across **all enabled Antigravity accounts × all online/idle machines** into one unified chronological feed (just like Claude Code native client), with instant toggles for **Unified / By Account / By Device** views.
- **1:1 Claude App Mobile UX & Touch Ergonomics**:
  - Warm alabaster (light) & warm obsidian (dark) editorial palette, left-edge swipe-right drawer, swipe-down `<dialog>` bottom sheets, auto-collapsed read-only tool pills (`Used N tools`), collapsible thinking traces, inline Diff & Terminal cards, interactive `AskUserQuestion` cards, `/` Slash Command autocomplete palette, image/file attachments + full-screen lightbox, and sandboxed HTML/SVG/Markdown Artifact preview (`Preview | Source`).
  - Native Android IME inset support (`WindowInsetsCompat.Type.ime()`) + 3-part IME-safe Enter guard for Chinese/English/Japanese keyboards.
  - Full internationalization (`Auto`, `English`, `简体中文`, `繁體中文`) tailored for Global, China, and Singapore users.
- **Self-Hosted Cloud Sync Server (`server/`)**:
  - Lightweight **Bun + TypeScript + `bun:sqlite` + Docker** sync backend (~14 KB bundled, zero external DB).
  - Reuses **Google OAuth SSO** (no extra password/registration system); stores only SSO user profile + **AES-256-GCM** encrypted `antigravity-vault/v1` cookie bundles for seamless PC ↔ Mobile synchronization.
- **GitHub Releases Two-Tier Auto-Updater & Ultra-Small APK**:
  - Automatic `Incremental Delta` (~120 KB web bundle) & `Full Native APK` (with streaming progress, SHA-256 verification, and Android `FileProvider` self-installer).
  - Rust release profile (`opt-level = "z"`, `lto = true`, `strip = "symbols"`) + Android R8 shrinking (`isMinifyEnabled = true`, `isShrinkResources = true`).

> **Note on v1 Archive**: The previous Gemini + Antigravity dual-WebView fusion version (`v0.1.0`) is permanently preserved on the [`release/v1-webview-fusion`](../../tree/release/v1-webview-fusion) branch.

---

## Quick Start

### 1. App Development (Bun + Tauri v2)
```bash
bun install
bun run build
cd src-tauri && cargo check

# Launch Desktop app
bun run tauri dev

# Build Android Release APK (arm64-v8a recommended for minimal size)
bun run tauri android build --apk --target aarch64
```

### 2. Self-Hosted Sync Server (Bun + Docker)
```bash
cd server
cp .env.example .env
# Edit .env: set strong JWT_SECRET, VAULT_MASTER_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_BASE_URL
docker compose up -d --build
```

Register `https://<your-sync-server-domain>/api/v1/auth/google/callback` as the Authorized Redirect URI in Google Cloud Console to enable 1-Tap Google SSO sync between PC and Mobile.

---

## Credits

All architecture, protocol extraction, Rust backend, React/Tailwind native UI, Bun sync server, and CI/CD pipelines in this repository were developed by **Gemini 4 Neon**.
