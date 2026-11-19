// Editorial-grade Antigravity OAuth Callback & Sync Status HTML templates
// Zero external dependencies, light/dark adaptive via color-scheme + light-dark(),
// compositor-only animations respecting prefers-reduced-motion.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isZhLocale(acceptLanguage: string | null): boolean {
  return Boolean(acceptLanguage && /^zh\b|,\s*zh\b/i.test(acceptLanguage));
}

const ANTIGRAVITY_LOGO_SVG = `<svg class="brand-glyph" viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="ag-grad" x1="18" y1="88" x2="82" y2="12" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3B82F6"/>
      <stop offset="38%" stop-color="#06B6D4"/>
      <stop offset="68%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>
  </defs>
  <path d="M50 11C42.2 11 36.2 17.6 31.6 28.4L14.8 73.2C11.9 80.7 16.5 87.8 23.6 87.8C29.1 87.8 33.4 83.4 36.4 76.2C40.1 67.3 44.5 62.6 50 62.6C55.5 62.6 59.9 67.3 63.6 76.2C66.6 83.4 70.9 87.8 76.4 87.8C83.5 87.8 88.1 80.7 85.2 73.2L68.4 28.4C63.8 17.6 57.8 11 50 11Z" fill="url(#ag-grad)"/>
</svg>`;

const SHARED_STYLES = `
:root {
  --bg-light: #faf9f5;
  --bg-dark: #141413;
  --surface-light: rgba(255, 255, 255, 0.88);
  --surface-dark: rgba(28, 28, 26, 0.88);
  --surface-subtle-light: #f3f1ea;
  --surface-subtle-dark: #232220;
  --border-light: rgba(20, 20, 19, 0.09);
  --border-dark: rgba(250, 249, 245, 0.10);
  --text-light: #141413;
  --text-dark: #f5f4ef;
  --muted-light: #6e6c65;
  --muted-dark: #9c9a92;
  --accent-light: #d97757;
  --accent-dark: #e08364;
  --accent-hover-light: #c46444;
  --accent-hover-dark: #ea9173;
  --success-light: #15803d;
  --success-dark: #4ade80;
  --success-bg-light: rgba(21, 128, 61, 0.10);
  --success-bg-dark: rgba(74, 222, 128, 0.14);
  --danger-light: #b91c1c;
  --danger-dark: #f87171;
  --danger-bg-light: rgba(185, 28, 28, 0.09);
  --danger-bg-dark: rgba(248, 113, 113, 0.14);
  --shadow-light: 0 24px 64px -20px rgba(20, 20, 19, 0.14), 0 2px 8px rgba(20, 20, 19, 0.04);
  --shadow-dark: 0 28px 72px -18px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(255, 255, 255, 0.04) inset;

  --bg: var(--bg-light);
  --surface: var(--surface-light);
  --surface-subtle: var(--surface-subtle-light);
  --border: var(--border-light);
  --text: var(--text-light);
  --muted: var(--muted-light);
  --accent: var(--accent-light);
  --accent-hover: var(--accent-hover-light);
  --success: var(--success-light);
  --success-bg: var(--success-bg-light);
  --danger: var(--danger-light);
  --danger-bg: var(--danger-bg-light);
  --shadow: var(--shadow-light);

  @media (prefers-color-scheme: dark) {
    --bg: var(--bg-dark);
    --surface: var(--surface-dark);
    --surface-subtle: var(--surface-subtle-dark);
    --border: var(--border-dark);
    --text: var(--text-dark);
    --muted: var(--muted-dark);
    --accent: var(--accent-dark);
    --accent-hover: var(--accent-hover-dark);
    --success: var(--success-dark);
    --success-bg: var(--success-bg-dark);
    --danger: var(--danger-dark);
    --danger-bg: var(--danger-bg-dark);
    --shadow: var(--shadow-dark);
  }

  @supports (color: light-dark(white, black)) {
    --bg: light-dark(var(--bg-light), var(--bg-dark));
    --surface: light-dark(var(--surface-light), var(--surface-dark));
    --surface-subtle: light-dark(var(--surface-subtle-light), var(--surface-subtle-dark));
    --border: light-dark(var(--border-light), var(--border-dark));
    --text: light-dark(var(--text-light), var(--text-dark));
    --muted: light-dark(var(--muted-light), var(--muted-dark));
    --accent: light-dark(var(--accent-light), var(--accent-dark));
    --accent-hover: light-dark(var(--accent-hover-light), var(--accent-hover-dark));
    --success: light-dark(var(--success-light), var(--success-dark));
    --success-bg: light-dark(var(--success-bg-light), var(--success-bg-dark));
    --danger: light-dark(var(--danger-light), var(--danger-dark));
    --danger-bg: light-dark(var(--danger-bg-light), var(--danger-bg-dark));
  }

  color-scheme: light dark;
  accent-color: var(--accent);
}

*, *::before, *::after { box-sizing: border-box; }

html, body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body {
  display: grid;
  place-items: center;
  padding: 24px 16px;
  position: relative;
  overflow-x: hidden;
}

.aura {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(640px 420px at 50% 18%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 72%),
    radial-gradient(520px 360px at 80% 82%, rgba(59, 130, 246, 0.08), transparent 72%);
}

.card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 440px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 32px 28px 26px;
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: cardEnter 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }
}

@keyframes cardEnter {
  from { opacity: 0; transform: translateY(14px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-bottom: 24px;
}

.brand-icon-wrap {
  position: relative;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  box-shadow: 0 6px 20px -8px rgba(0, 0, 0, 0.16);
}

.brand-glyph {
  width: 32px;
  height: 32px;
  display: block;
}

.status-badge {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  border: 2.5px solid var(--bg);
}

.status-badge.ok {
  background: var(--success);
  color: #ffffff;
}

.status-badge.err {
  background: var(--danger);
  color: #ffffff;
}

@media (prefers-reduced-motion: no-preference) {
  .status-badge {
    animation: popIn 420ms cubic-bezier(0.34, 1.56, 0.64, 1) 180ms both;
  }
}

@keyframes popIn {
  from { opacity: 0; transform: scale(0.4); }
  to { opacity: 1; transform: scale(1); }
}

.title {
  margin: 0 0 8px;
  text-align: center;
  font-size: 22px;
  line-height: 1.25;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.subtitle {
  margin: 0 0 22px;
  text-align: center;
  font-size: 14px;
  line-height: 1.55;
  color: var(--muted);
}

.user-pill {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  margin-bottom: 18px;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--accent);
  color: #fff;
  font-weight: 650;
  font-size: 15px;
  display: grid;
  place-items: center;
}

.user-meta {
  min-width: 0;
  flex: 1;
}

.user-name {
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-email {
  font-size: 12.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.verified-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 4px 9px;
  border-radius: 999px;
  background: var(--success-bg);
  color: var(--success);
  white-space: nowrap;
}

.stepper {
  display: grid;
  gap: 10px;
  margin-bottom: 22px;
  padding: 14px 16px;
  border-radius: 16px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--muted);
}

.step.done {
  color: var(--text);
}

.step-dot {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
}

.step.done .step-dot {
  background: var(--success-bg);
  color: var(--success);
}

.step.active .step-dot {
  border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  border-top-color: var(--accent);
}

@media (prefers-reduced-motion: no-preference) {
  .step.active .step-dot {
    animation: spin 850ms linear infinite;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.actions {
  display: grid;
  gap: 10px;
}

.btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 13px;
  min-height: 44px;
  padding: 11px 16px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background-color 150ms ease, border-color 150ms ease, opacity 150ms ease;
}

.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.btn-primary {
  background: var(--accent);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: transparent;
  border-color: var(--border);
  color: var(--text);
}

.btn-secondary:hover {
  background: var(--surface-subtle);
}

.error-box {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--danger-bg);
  color: var(--danger);
  font-size: 13px;
  line-height: 1.5;
  margin-bottom: 20px;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 20px;
}

.metric {
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
}

.metric-label {
  font-size: 11.5px;
  color: var(--muted);
  margin-bottom: 4px;
}

.metric-value {
  font-size: 13.5px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--success);
  flex-shrink: 0;
}

.footer {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--muted);
}

.footer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
`;

export function renderOAuthHandoffPage(opts: {
  targetUrl: string;
  name: string;
  email: string;
  avatarUrl: string;
  acceptLanguage: string | null;
}): string {
  const zh = isZhLocale(opts.acceptLanguage);
  const safeName = escapeHtml(opts.name || opts.email.split('@')[0] || 'User');
  const safeEmail = escapeHtml(opts.email);
  const safeTargetAttr = escapeHtml(opts.targetUrl);
  const safeTargetJson = JSON.stringify(opts.targetUrl);
  const isMobileDeepLink = opts.targetUrl.startsWith('antigravity://');
  const initial = escapeHtml((opts.name || opts.email || 'A').trim().charAt(0).toUpperCase());

  const avatarMarkup = opts.avatarUrl
    ? `<img class="avatar" src="${escapeHtml(opts.avatarUrl)}" alt="${safeName}" referrerpolicy="no-referrer" />`
    : `<div class="avatar" aria-hidden="true">${initial}</div>`;

  const title = zh ? 'Google 登录已验证' : 'Google Sign-In Verified';
  const subtitle = zh
    ? isMobileDeepLink
      ? '正在唤起 Antigravity 手机端并同步加密密钥库…'
      : '正在将加密会话安全交接给 Antigravity 桌面端…'
    : isMobileDeepLink
      ? 'Opening Antigravity mobile and handing off your encrypted sync session…'
      : 'Securely handing off your encrypted sync session to Antigravity Desktop…';

  const openBtnLabel = zh ? '立即返回 Antigravity' : 'Open Antigravity Now';
  const copyBtnLabel = zh ? '复制回调链接' : 'Copy Handoff Link';
  const copiedLabel = zh ? '已复制链接 ✓' : 'Link Copied ✓';
  const verifiedBadge = zh ? '已认证' : 'Verified';
  const step1 = zh ? 'Google OIDC 身份校验通过' : 'Google OIDC identity verified';
  const step2 = zh ? '已签发端到端云同步会话 (JWT)' : 'Encrypted Vault session issued';
  const step3Pending = zh ? '正在跳转回 Antigravity 客户端…' : 'Returning to Antigravity app…';
  const step3Done = zh ? '已发起客户端唤起，如未自动跳转请点击上方按钮' : 'Handoff triggered — click above if the app did not focus';

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)} · Antigravity</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="aura" aria-hidden="true"></div>
  <main class="card" role="main" aria-live="polite">
    <div class="brand-row">
      <div class="brand-icon-wrap">
        ${ANTIGRAVITY_LOGO_SVG}
        <span class="status-badge ok" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    </div>

    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>

    <div class="user-pill">
      ${avatarMarkup}
      <div class="user-meta">
        <div class="user-name">${safeName}</div>
        <div class="user-email">${safeEmail}</div>
      </div>
      <span class="verified-tag">${escapeHtml(verifiedBadge)}</span>
    </div>

    <div class="stepper" role="list">
      <div class="step done" role="listitem">
        <span class="step-dot" aria-hidden="true">✓</span>
        <span>${escapeHtml(step1)}</span>
      </div>
      <div class="step done" role="listitem">
        <span class="step-dot" aria-hidden="true">✓</span>
        <span>${escapeHtml(step2)}</span>
      </div>
      <div class="step active" id="handoff-step" role="listitem">
        <span class="step-dot" id="handoff-dot" aria-hidden="true"></span>
        <span id="handoff-text">${escapeHtml(step3Pending)}</span>
      </div>
    </div>

    <div class="actions">
      <a class="btn btn-primary" id="open-btn" href="${safeTargetAttr}">
        <span>${escapeHtml(openBtnLabel)}</span>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6 3.5H12.5V10M12.5 3.5L3.5 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
      <button type="button" class="btn btn-secondary" id="copy-btn">${escapeHtml(copyBtnLabel)}</button>
    </div>

    <footer class="footer">
      <span>Antigravity Cloud Sync</span>
      <code>AES-256-GCM · OIDC</code>
    </footer>
  </main>

  <script>
    (function () {
      var target = ${safeTargetJson};
      var step = document.getElementById('handoff-step');
      var dot = document.getElementById('handoff-dot');
      var text = document.getElementById('handoff-text');
      var copyBtn = document.getElementById('copy-btn');

      if (copyBtn) {
        copyBtn.addEventListener('click', function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(target).then(function () {
              copyBtn.textContent = ${JSON.stringify(copiedLabel)};
              setTimeout(function () {
                copyBtn.textContent = ${JSON.stringify(copyBtnLabel)};
              }, 2000);
            });
          }
        });
      }

      setTimeout(function () {
        if (step && dot && text) {
          step.classList.remove('active');
          step.classList.add('done');
          dot.textContent = '✓';
          text.textContent = ${JSON.stringify(step3Done)};
        }
        window.location.replace(target);
      }, 650);
    })();
  </script>
</body>
</html>`;
}

export function renderOAuthErrorPage(opts: {
  title?: string;
  detail: string;
  acceptLanguage: string | null;
}): string {
  const zh = isZhLocale(opts.acceptLanguage);
  const heading = opts.title || (zh ? 'Google 登录未能完成' : 'Sign-In Could Not Complete');
  const subtitle = zh
    ? '请返回 Antigravity 客户端重新点击「Continue with Google」重试。'
    : 'Please return to Antigravity and tap “Continue with Google” to try again.';
  const closeLabel = zh ? '关闭当前标签页' : 'Close This Tab';

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(heading)} · Antigravity</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="aura" aria-hidden="true"></div>
  <main class="card" role="main">
    <div class="brand-row">
      <div class="brand-icon-wrap">
        ${ANTIGRAVITY_LOGO_SVG}
        <span class="status-badge err" aria-hidden="true">!</span>
      </div>
    </div>

    <h1 class="title">${escapeHtml(heading)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>

    <div class="error-box" role="alert">${escapeHtml(opts.detail)}</div>

    <div class="actions">
      <button type="button" class="btn btn-secondary" onclick="window.close()">${escapeHtml(closeLabel)}</button>
    </div>

    <footer class="footer">
      <span>Antigravity Cloud Sync</span>
      <code>OAuth Callback</code>
    </footer>
  </main>
</body>
</html>`;
}

export function renderSyncLandingPage(opts: {
  oauthConfigured: boolean;
  acceptLanguage: string | null;
}): string {
  const zh = isZhLocale(opts.acceptLanguage);
  const title = zh ? 'Antigravity 云端同步服务' : 'Antigravity Cloud Sync';
  const subtitle = zh
    ? '专为 Antigravity 桌面端与移动端打造的零知识加密 Vault 与一键 Google SSO 网关。'
    : 'Zero-knowledge AES-256-GCM account vault & 1-Tap Google OAuth gateway for Antigravity Desktop & Mobile.';
  const statusLabel = zh ? '服务状态' : 'Service Status';
  const statusVal = zh ? '运行正常' : 'Operational';
  const oauthLabel = zh ? 'Google OAuth SSO' : 'Google OAuth SSO';
  const oauthVal = opts.oauthConfigured
    ? zh ? '已就绪 (OIDC)' : 'Ready (OIDC)'
    : zh ? '未配置' : 'Not Configured';
  const githubBtn = zh ? '前往 GitHub 下载客户端' : 'Download Antigravity on GitHub';
  const healthBtn = zh ? '查看 /health 状态 JSON' : 'Inspect /health JSON';

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="aura" aria-hidden="true"></div>
  <main class="card" role="main">
    <div class="brand-row">
      <div class="brand-icon-wrap">
        ${ANTIGRAVITY_LOGO_SVG}
        <span class="status-badge ok" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
    </div>

    <h1 class="title">${escapeHtml(title)}</h1>
    <p class="subtitle">${escapeHtml(subtitle)}</p>

    <div class="metrics">
      <div class="metric">
        <div class="metric-label">${escapeHtml(statusLabel)}</div>
        <div class="metric-value"><span class="live-dot" aria-hidden="true"></span>${escapeHtml(statusVal)}</div>
      </div>
      <div class="metric">
        <div class="metric-label">${escapeHtml(oauthLabel)}</div>
        <div class="metric-value">${escapeHtml(oauthVal)}</div>
      </div>
    </div>

    <div class="actions">
      <a class="btn btn-primary" href="https://github.com/HeiSir2014/antigravity-app/releases" target="_blank" rel="noopener noreferrer">${escapeHtml(githubBtn)}</a>
      <a class="btn btn-secondary" href="/health">${escapeHtml(healthBtn)}</a>
    </div>

    <footer class="footer">
      <span>Bun + SQLite · AES-256-GCM</span>
      <code>v2.0.0</code>
    </footer>
  </main>
</body>
</html>`;
}

export function renderLegalPage(opts: {
  kind: 'privacy' | 'terms';
  acceptLanguage: string | null;
}): string {
  const zh = isZhLocale(opts.acceptLanguage);
  const isPrivacy = opts.kind === 'privacy';
  const title = isPrivacy
    ? zh ? '隐私政策 · Antigravity' : 'Privacy Policy · Antigravity'
    : zh ? '服务条款 · Antigravity' : 'Terms of Service · Antigravity';
  const heading = isPrivacy
    ? zh ? '隐私政策' : 'Privacy Policy'
    : zh ? '服务条款' : 'Terms of Service';
  const items = isPrivacy
    ? zh
      ? [
          '仅使用 Google OIDC 基础身份信息（邮箱、姓名、头像）用于跨设备同步账户识别，不请求任何敏感或受限的 Google API 权限。',
          '您的 Antigravity 会话凭证在服务端采用 AES-256-GCM 静态加密存储，仅用于您本人的桌面端与移动端同步。',
          '我们不会向任何第三方出售、共享或泄露您的个人数据；您随时可以在客户端退出登录或请求清除云端 Vault 数据。',
        ]
      : [
          'We only request basic Google OIDC profile scopes (openid, email, profile) to identify your sync account — no sensitive or restricted Google API scopes are requested.',
          'Your synced Antigravity account vault is encrypted at rest with AES-256-GCM and used exclusively to synchronize your own Desktop and Mobile devices.',
          'We never sell, rent, or share your personal data with third parties. You may sign out or clear your vault at any time.',
        ]
    : zh
      ? [
          'Antigravity Cloud Sync 为开源 Antigravity 客户端提供个人跨设备加密同步与 Google OAuth 登录网关服务。',
          '请勿滥用本服务进行自动化攻击、违规抓取或超出个人正常使用范围的请求。',
          '本服务按“现状”提供，完整源代码与自托管指南托管于 GitHub (HeiSir2014/antigravity-app)。',
        ]
      : [
          'Antigravity Cloud Sync provides personal encrypted cross-device vault synchronization and Google OAuth sign-in for the open-source Antigravity client.',
          'You agree not to abuse the service with automated scraping, denial-of-service traffic, or unlawful activity.',
          'The service is provided as-is; full source code and self-hosting instructions are available on GitHub (HeiSir2014/antigravity-app).',
        ];

  const listMarkup = items
    .map(
      (line) =>
        `<div class="step done" role="listitem"><span class="step-dot" aria-hidden="true">•</span><span>${escapeHtml(line)}</span></div>`
    )
    .join('');

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)}</title>
  <style>${SHARED_STYLES}</style>
</head>
<body>
  <div class="aura" aria-hidden="true"></div>
  <main class="card" role="main">
    <div class="brand-row">
      <div class="brand-icon-wrap">${ANTIGRAVITY_LOGO_SVG}</div>
    </div>
    <h1 class="title">${escapeHtml(heading)}</h1>
    <p class="subtitle">Antigravity Cloud Sync · antigravity.yterm.cn</p>
    <div class="stepper" role="list">${listMarkup}</div>
    <div class="actions">
      <a class="btn btn-secondary" href="/">${zh ? '返回首页' : 'Back to Home'}</a>
    </div>
    <footer class="footer">
      <span>Contact: heisir2012@gmail.com</span>
      <code>v2.0.0</code>
    </footer>
  </main>
</body>
</html>`;
}
