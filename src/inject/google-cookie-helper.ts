import {
  adoptStyleSheet,
  clearChildren,
  el,
  importGoogleSessionCookies,
  openExternalBrowser,
} from './dom-safe';

const COOKIE_HELPER_CSS = `
.agy-cookie-import-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--agy-surface-elev, light-dark(#f8fafc, #1a1d24));
  border: 1px solid var(--agy-border, light-dark(rgba(0,0,0,0.08), rgba(255,255,255,0.1)));
  box-sizing: border-box;
}

.agy-cookie-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.agy-cookie-card-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.agy-cookie-card-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  font-size: 15px;
  background: light-dark(rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.22));
  color: #2563eb;
  flex-shrink: 0;
}

.agy-cookie-card-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--agy-text, light-dark(#0f172a, #f8fafc));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agy-cookie-card-badge {
  font-size: 0.7rem;
  font-weight: 650;
  padding: 2px 7px;
  border-radius: 999px;
  background: light-dark(rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.22));
  color: light-dark(#b45309, #fbbf24);
  white-space: nowrap;
}

.agy-cookie-card-desc {
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--agy-muted, light-dark(#64748b, #94a3b8));
}

.agy-cookie-actions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.agy-cookie-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 13px;
  border-radius: 8px;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s ease, background 0.15s ease;
  user-select: none;
  font-family: inherit;
}

.agy-cookie-btn-primary {
  background: #1a73e8;
  color: #ffffff;
  border-color: #1a73e8;
}

.agy-cookie-btn-primary:active {
  opacity: 0.88;
}

.agy-cookie-btn-outline {
  background: transparent;
  color: var(--agy-text, light-dark(#0f172a, #f8fafc));
  border-color: var(--agy-border, light-dark(rgba(0,0,0,0.12), rgba(255,255,255,0.14)));
}

.agy-cookie-btn-outline:active {
  background: light-dark(rgba(0,0,0,0.05), rgba(255,255,255,0.08));
}

.agy-cookie-textarea {
  width: 100%;
  min-height: 68px;
  max-height: 140px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--agy-border, light-dark(rgba(0,0,0,0.15), rgba(255,255,255,0.15)));
  background: var(--agy-surface, light-dark(#ffffff, #111318));
  color: var(--agy-text, light-dark(#0f172a, #f8fafc));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.78rem;
  line-height: 1.4;
  resize: vertical;
  box-sizing: border-box;
}

.agy-cookie-textarea:focus {
  outline: none;
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.agy-cookie-help-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  background: light-dark(rgba(0,0,0,0.03), rgba(255,255,255,0.04));
  border: 1px dashed var(--agy-border, light-dark(rgba(0,0,0,0.12), rgba(255,255,255,0.12)));
  font-size: 0.76rem;
  line-height: 1.5;
  color: var(--agy-muted, light-dark(#475569, #94a3b8));
}

.agy-cookie-help-panel ol {
  margin: 0;
  padding-left: 18px;
}

.agy-cookie-status-msg {
  font-size: 0.8rem;
  font-weight: 600;
  border-radius: 6px;
  padding: 6px 10px;
  display: none;
}

.agy-cookie-status-msg.success {
  display: block;
  background: light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2));
  color: #16a34a;
}

.agy-cookie-status-msg.error {
  display: block;
  background: light-dark(rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.2));
  color: #dc2626;
}

/* Floating helper banner pinned to top of accounts.google.com */
.agy-auth-helper-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2147483647;
  padding: 10px 14px;
  background: light-dark(#1e293b, #0f172a);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.agy-auth-helper-content {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.agy-auth-helper-text {
  font-size: 0.82rem;
  line-height: 1.35;
}

.agy-auth-helper-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  font-weight: 650;
  cursor: pointer;
  background: #3b82f6;
  color: #ffffff;
  border: none;
  white-space: nowrap;
}

/* Modal Dialog for standalone Cookie Import */
dialog.agy-cookie-modal {
  border: none;
  border-radius: 16px;
  padding: 0;
  width: calc(100% - 32px);
  max-width: 480px;
  background: var(--agy-surface, light-dark(#ffffff, #181b21));
  color: var(--agy-text, light-dark(#0f172a, #f8fafc));
  box-shadow: 0 16px 36px rgba(0,0,0,0.35);
  margin: auto;
  box-sizing: border-box;
}

dialog.agy-cookie-modal::backdrop {
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.agy-cookie-modal-inner {
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.agy-cookie-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.agy-cookie-modal-close-btn {
  background: transparent;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--agy-muted, light-dark(#64748b, #94a3b8));
  padding: 4px 8px;
  line-height: 1;
}
`;

/**
 * Creates the Google Cookie Sync / Session Import Card.
 * Can be embedded into the Settings Sheet or standalone modal.
 */
export function createCookieImportCard(onSuccess?: () => void): HTMLElement {
  adoptStyleSheet('agy-cookie-helper-styles', COOKIE_HELPER_CSS);

  const card = el('div', { className: 'agy-cookie-import-card' });

  // 1. Header
  const header = el(
    'div',
    { className: 'agy-cookie-card-header' },
    el(
      'div',
      { className: 'agy-cookie-card-title-box' },
      el('div', { className: 'agy-cookie-card-icon', text: '🔑' }),
      el('div', { className: 'agy-cookie-card-title', text: 'Google 账号凭证同步 (Cookie 秒登)' })
    ),
    el('span', { className: 'agy-cookie-card-badge', text: '免内嵌拦截' })
  );

  // 2. Description
  const desc = el('div', {
    className: 'agy-cookie-card-desc',
    text: '因 Google 安全机制禁止在应用内嵌窗口直接输入密码登录，最佳解决方案为：在外部系统浏览器登录一次后，将 Cookie 凭证粘贴至下方即可一键同步双端工作区！',
  });

  // 3. Textarea
  const textarea = el('textarea', {
    className: 'agy-cookie-textarea',
    placeholder:
      '在此粘贴 Google Cookie 字符串 (如: SID=...; HSID=...; __Secure-1PSID=... 或 Cookie-Editor 导出的 JSON)...',
    aria: { label: 'Google Cookie 字符串' },
  });

  // 4. Status Message Box
  const statusMsg = el('div', { className: 'agy-cookie-status-msg' });

  // 5. Help Collapsible Box
  let helpVisible = false;
  const helpPanel = el(
    'div',
    { className: 'agy-cookie-help-panel', style: { display: 'none' } },
    el('div', {
      style: { fontWeight: '700', color: 'var(--agy-text, inherit)' },
      text: '📌 两种极其简单的凭证获取方式：',
    }),
    el(
      'ol',
      {},
      el(
        'li',
        {},
        '方式一（推荐扩展）：在 Chrome/Edge 浏览器安装 Cookie-Editor 扩展，打开 gemini.google.com 或 google.com 登录后，点击扩展「Export」->「Header String」或「JSON」，直接粘贴至上方。'
      ),
      el(
        'li',
        {},
        '方式二（开发者工具）：在任意浏览器打开已登录的 gemini.google.com，按 F12 -> Network (网络) -> 刷新页面 -> 点击任一请求 -> 复制 Request Headers 中的 Cookie 属性整行粘贴即可。'
      )
    )
  );

  // 6. Action Buttons Row
  const actionsRow = el('div', { className: 'agy-cookie-actions-row' });

  const openBrowserBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-cookie-btn agy-cookie-btn-outline',
      onClick: () => {
        openExternalBrowser('https://accounts.google.com');
      },
    },
    '🌐 打开系统浏览器登录'
  );

  const toggleHelpBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-cookie-btn agy-cookie-btn-outline',
      onClick: () => {
        helpVisible = !helpVisible;
        helpPanel.style.display = helpVisible ? 'flex' : 'none';
        toggleHelpBtn.textContent = helpVisible ? '✕ 收起提取指南' : '❓ 查看提取指南';
      },
    },
    '❓ 查看提取指南'
  );

  const importBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-cookie-btn agy-cookie-btn-primary',
      onClick: async () => {
        const val = textarea.value.trim();
        if (!val) {
          statusMsg.className = 'agy-cookie-status-msg error';
          statusMsg.textContent = '请先粘贴 Cookie 字符串或 JSON 内容！';
          textarea.focus();
          return;
        }

        importBtn.disabled = true;
        importBtn.textContent = '⏳ 正在同步凭证...';
        statusMsg.className = 'agy-cookie-status-msg';
        statusMsg.textContent = '';

        try {
          const success = await importGoogleSessionCookies(val);
          if (success) {
            statusMsg.className = 'agy-cookie-status-msg success';
            statusMsg.textContent = '✓ Google 会话凭证已成功同步！正在重定向到工作区...';
            textarea.value = '';
            setTimeout(() => {
              if (onSuccess) onSuccess();
            }, 1200);
          } else {
            statusMsg.className = 'agy-cookie-status-msg error';
            statusMsg.textContent = '导入失败，请检查 Cookie 格式是否正确！';
            importBtn.disabled = false;
            importBtn.textContent = '✦ 一键同步会话凭证';
          }
        } catch (err) {
          statusMsg.className = 'agy-cookie-status-msg error';
          statusMsg.textContent = `同步异常: ${String(err)}`;
          importBtn.disabled = false;
          importBtn.textContent = '✦ 一键同步会话凭证';
        }
      },
    },
    '✦ 一键同步会话凭证'
  );

  actionsRow.append(importBtn, openBrowserBtn, toggleHelpBtn);

  card.append(header, desc, textarea, statusMsg, actionsRow, helpPanel);
  return card;
}

/**
 * Opens a standalone modal dialog for importing Google session cookies.
 * Useful when launched from TopBar, Drawer, or directly on accounts.google.com.
 */
export function openCookieImportModal(): void {
  adoptStyleSheet('agy-cookie-helper-styles', COOKIE_HELPER_CSS);

  const existing = document.querySelector<HTMLDialogElement>('dialog.agy-cookie-modal');
  if (existing) {
    existing.close();
    existing.remove();
  }

  const dlg = el('dialog', { className: 'agy-cookie-modal' }) as HTMLDialogElement;

  const inner = el('div', { className: 'agy-cookie-modal-inner' });
  const topRow = el(
    'div',
    { className: 'agy-cookie-modal-header' },
    el('div', {
      style: { fontWeight: '700', fontSize: '1rem', color: 'var(--agy-text)' },
      text: '✦ Google 统一账号认证',
    }),
    el('button', {
      type: 'button',
      className: 'agy-cookie-modal-close-btn',
      text: '×',
      onClick: () => dlg.close(),
    })
  );

  const card = createCookieImportCard(() => {
    dlg.close();
  });

  inner.append(topRow, card);
  dlg.appendChild(inner);

  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) {
      dlg.close();
    }
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
  });

  document.body.appendChild(dlg);
  dlg.showModal();
}

/**
 * Injects a floating helper banner on `accounts.google.com` so users who land on Google's
 * blocked login screen can immediately launch external browser login and import cookies.
 */
export function mountAccountsGoogleLoginHelper(): void {
  if (document.getElementById('agy-auth-helper-banner')) return;
  adoptStyleSheet('agy-cookie-helper-styles', COOKIE_HELPER_CSS);

  const banner = el('div', {
    id: 'agy-auth-helper-banner',
    className: 'agy-auth-helper-banner',
  });

  const content = el(
    'div',
    { className: 'agy-auth-helper-content' },
    el('span', { style: { fontSize: '1.2rem' }, text: '⚡' }),
    el(
      'div',
      { className: 'agy-auth-helper-text' },
      el('strong', { text: 'Antigravity 登录助手：' }),
      ' Google 官方安全策略禁止在内嵌应用直接输入密码。请在外部浏览器登录后点击右侧一键导入 Cookie 凭证即可秒登。'
    )
  );

  const btnRow = el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } });

  const importBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-auth-helper-btn',
      onClick: () => {
        openCookieImportModal();
      },
    },
    '🔑 导入 Cookie 秒登'
  );

  const browserBtn = el(
    'button',
    {
      type: 'button',
      className: 'agy-auth-helper-btn',
      style: { background: 'rgba(255,255,255,0.15)' },
      onClick: () => {
        openExternalBrowser('https://accounts.google.com');
      },
    },
    '🌐 浏览器登录'
  );

  btnRow.append(importBtn, browserBtn);
  banner.append(content, btnRow);

  document.body.appendChild(banner);
  // Add padding to body so Google page content doesn't get obscured
  document.body.style.paddingTop = '54px';
}
