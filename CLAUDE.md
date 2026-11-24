# CLAUDE.md — Antigravity App Developer & Agent Guide

Please read and follow all rules in [`AGENTS.md`](AGENTS.md) and [`.agents/rules/AGENTS.md`](.agents/rules/AGENTS.md).

## Quick Checklist for Every Change
0. **Only use `edit_file` / `write_file` tools & protect open-source privacy**:
   - Never use `python`, `sed`, `awk`, or shell scripts to edit or write project files.
   - Never include local absolute user paths, personal hostnames, device serials, or real session/instance UUIDs in code or docs. Use relative paths (`./`, `antigravity-app/`) and placeholders (`<instance-uuid>`, `<cascade-id>`).
1. **Use `bun` exclusively**:
   - `bun install`
   - `bun run build:inject` (bundles `src/inject/agy-bridge.ts` and `src/inject/gemini-bridge.ts` into `src/generated/*.iife.js`)
   - `bun run build` (runs `bun run build:inject && tsc --noEmit && vite build`)
   - `cd src-tauri && cargo check`
2. **Trusted Types Safety (`require-trusted-types-for 'script'`)**:
   - Never use `innerHTML`, `outerHTML`, or `insertAdjacentHTML` in `src/inject/*`.
   - Always use `el()` and `adoptStyleSheet()` from `src/inject/dom-safe.ts`.
3. **Top-Frame vs. `#hubFrame` Guest Separation**:
   - Keep UI chrome (`#agy-unified-topbar`, `dialog.agy-unified-drawer`, `#agy-quick-dock`, `dialog.agy-bottom-sheet`) strictly inside `isTopFrame` (`window.self === window.top`), and use `AGY_GUEST_COMMAND` `postMessage` forwarding to interact with `#hubFrame` (`https://antigravity.static.usercontent.goog`).
4. **Modern Web Guidance**:
   - Consult `bunx modern-web-guidance@latest search "<query>"` when modifying HTML/CSS/DOM components.
5. **Release & Web Portal Sync (`server/`)**:
   - Whenever publishing a new version (`vX.Y.Z`), always update `DEFAULT_RELEASE` (and highlights/screenshots if changed) in `server/src/portal.ts`, deploy `server/` to the portal server (`docker compose up -d --build`, preserving `.env` and `sync-data`), and verify `https://antigravity.yterm.cn/` + `/health` serve `vX.Y.Z`. Keep concrete SSH host details in gitignored `CLAUDE.local.md` or `~/.ssh/config`, never in git-tracked files.
