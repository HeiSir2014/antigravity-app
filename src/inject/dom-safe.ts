/**
 * Trusted-Types-safe DOM & CSS utilities.
 * Strictly avoids innerHTML / outerHTML / insertAdjacentHTML to comply with
 * `Content-Security-Policy: require-trusted-types-for 'script'` on
 * `antigravity.google.com/remote` and `gemini.google.com/app`.
 */

export type ChildNodeSpec =
  | Node
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly ChildNodeSpec[];

export interface ElementAttributes {
  className?: string;
  id?: string;
  text?: string;
  textContent?: string;
  title?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  target?: string;
  rel?: string;
  role?: string;
  tabIndex?: number;
  hidden?: boolean | 'until-found';
  autofocus?: boolean;
  disabled?: boolean;
  dataset?: Record<string, string>;
  aria?: Record<string, string>;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  onClick?: (ev: MouseEvent) => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  onInput?: (ev: Event) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementAttributes = {},
  ...children: ChildNodeSpec[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (props.className) node.className = props.className;
  if (props.id) node.id = props.id;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.textContent !== undefined) node.textContent = props.textContent;
  if (props.title) node.title = props.title;
  if (props.role) node.setAttribute('role', props.role);
  if (props.tabIndex !== undefined) node.tabIndex = props.tabIndex;
  if (props.autofocus) node.autofocus = true;

  if (props.hidden === 'until-found') {
    node.setAttribute('hidden', 'until-found');
  } else if (props.hidden === true) {
    node.hidden = true;
  }

  if (props.type && 'type' in node) {
    (node as HTMLButtonElement | HTMLInputElement).type = props.type;
  }
  if (props.value !== undefined && 'value' in node) {
    (node as HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement).value = props.value;
  }
  if (props.placeholder && 'placeholder' in node) {
    (node as HTMLInputElement | HTMLTextAreaElement).placeholder = props.placeholder;
  }
  if (props.disabled !== undefined && 'disabled' in node) {
    (node as HTMLButtonElement | HTMLInputElement).disabled = props.disabled;
  }
  if (props.href && node instanceof HTMLAnchorElement) {
    node.href = props.href;
    if (props.target) node.target = props.target;
    if (props.rel) node.rel = props.rel;
  }

  if (props.dataset) {
    for (const [k, v] of Object.entries(props.dataset)) {
      node.dataset[k] = v;
    }
  }

  if (props.aria) {
    for (const [k, v] of Object.entries(props.aria)) {
      node.setAttribute(`aria-${k}`, v);
    }
  }

  if (props.attrs) {
    for (const [k, v] of Object.entries(props.attrs)) {
      node.setAttribute(k, v);
    }
  }

  if (props.style) {
    if (typeof props.style === 'string') {
      node.style.cssText = props.style;
    } else {
      Object.assign(node.style, props.style);
    }
  }

  if (props.onClick) {
    node.addEventListener('click', props.onClick as EventListener);
  }
  if (props.onKeyDown) {
    node.addEventListener('keydown', props.onKeyDown as EventListener);
  }
  if (props.onInput) {
    node.addEventListener('input', props.onInput);
  }

  const appendSpec = (spec: ChildNodeSpec): void => {
    if (spec === null || spec === undefined || typeof spec === 'boolean') return;
    if (Array.isArray(spec)) {
      for (const item of spec) appendSpec(item);
    } else if (typeof spec === 'string' || typeof spec === 'number') {
      node.appendChild(document.createTextNode(String(spec)));
    } else if (spec instanceof Node) {
      node.appendChild(spec);
    }
  };

  for (const child of children) {
    appendSpec(child);
  }

  return node;
}

export function clearChildren(node: Element): void {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

/**
 * Injects CSS using Constructable Stylesheets (`document.adoptedStyleSheets`),
 * bypassing CSP `style-src` / Trusted Types restrictions cleanly.
 */
export function adoptStyleSheet(id: string, cssText: string): CSSStyleSheet | null {
  try {
    const existing = (window as unknown as Record<string, Map<string, CSSStyleSheet>>).__agySheets;
    const map = existing ?? new Map<string, CSSStyleSheet>();
    (window as unknown as Record<string, Map<string, CSSStyleSheet>>).__agySheets = map;

    let sheet = map.get(id);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      map.set(id, sheet);
    } else {
      sheet.replaceSync(cssText);
    }
    return sheet;
  } catch {
    return null;
  }
}

/**
 * Detects whether the current execution environment is a Desktop PC (macOS / Windows / Linux)
 * versus a Mobile Device (Android WebView / iOS).
 */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.AgyAndroidBridge) return false;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false;
  return true;
}

/**
 * Initializes form-factor attributes (`data-agy-form-factor="desktop" | "mobile"`)
 * on `<html>` and `<body>` per modern-web-guidance `form-factor-adaptation`.
 */
export function initFormFactor(): void {
  if (typeof document === 'undefined') return;
  const isDesktop = isDesktopApp();
  const factor = isDesktop ? 'desktop' : 'mobile';
  document.documentElement.setAttribute('data-agy-form-factor', factor);
  if (document.body) {
    document.body.setAttribute('data-agy-form-factor', factor);
  }
}

/**
 * Ensures `<meta name="color-scheme" content="light dark">` and viewport-fit=cover
 * are present in `<head>` per modern-web-guidance `dark-mode` & `form-factor-adaptation`.
 */
export function ensureModernHeadMeta(): void {
  initFormFactor();
  if (!document.head) return;

  if (!document.querySelector('meta[name="color-scheme"]')) {
    const meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light dark';
    document.head.prepend(meta);
  }

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport && !viewport.content.includes('viewport-fit=cover')) {
    viewport.content = `${viewport.content}, viewport-fit=cover, interactive-widget=resizes-content`;
  }
}

/**
 * Native bridge helper supporting both Android `@JavascriptInterface` (`window.AgyAndroidBridge`)
 * and Tauri v2 IPC (`window.__TAURI_INTERNALS__`).
 */
export interface NativeBridgePayload {
  type:
    | 'SWITCH_ENGINE'
    | 'UPDATE_THEME'
    | 'TELEPORT_TO_CODE'
    | 'CONSUME_TELEPORT'
    | 'PERMISSION_PROMPT'
    | 'PERMISSION_DECISION'
    | 'HAPTIC_TICK'
    | 'UPDATE_BADGE';
  engine?: 'gemini' | 'antigravity';
  isDark?: boolean;
  prompt?: string;
  sourceTitle?: string;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  commandText?: string;
  decision?: 'APPROVE' | 'DENY' | 'DENY_WITH_COMMENT';
  comment?: string;
  badgeText?: string;
}

declare global {
  interface Window {
    AgyAndroidBridge?: {
      postMessage: (json: string) => string | void;
      switchEngine?: (engine: string) => void;
      updateTheme?: (isDark: boolean) => void;
      openExternalUrl?: (url: string) => void;
      teleportToCode?: (prompt: string) => void;
      consumeTeleport?: () => string;
      notifyPermissionPrompt?: (toolName: string, commandText: string, requestId: string) => void;
      hapticTick?: () => void;
      importGoogleCookies?: (cookieString: string) => boolean;
    };
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    __AGY_RECEIVE_NATIVE_EVENT__?: (eventJson: string) => void;
  }
}

export function sendToNative(payload: NativeBridgePayload): void {
  try {
    if (window.AgyAndroidBridge) {
      if (payload.type === 'SWITCH_ENGINE' && payload.engine && window.AgyAndroidBridge.switchEngine) {
        window.AgyAndroidBridge.switchEngine(payload.engine);
        return;
      }
      if (payload.type === 'TELEPORT_TO_CODE' && payload.prompt && window.AgyAndroidBridge.teleportToCode) {
        window.AgyAndroidBridge.teleportToCode(payload.prompt);
        return;
      }
      if (
        payload.type === 'PERMISSION_PROMPT' &&
        window.AgyAndroidBridge.notifyPermissionPrompt
      ) {
        window.AgyAndroidBridge.notifyPermissionPrompt(
          payload.toolName ?? 'Agent Action',
          payload.commandText ?? '',
          payload.requestId ?? `req_${Date.now()}`
        );
        return;
      }
      if (payload.type === 'HAPTIC_TICK' && window.AgyAndroidBridge.hapticTick) {
        window.AgyAndroidBridge.hapticTick();
        return;
      }
      window.AgyAndroidBridge.postMessage(JSON.stringify(payload));
      return;
    }

    if (window.__TAURI_INTERNALS__?.invoke) {
      void window.__TAURI_INTERNALS__.invoke('agy_bridge_message', { payload });
      return;
    }
  } catch {
    // Graceful fallback below
  }

  // Fallback for single-window navigation when native dual-webview bridge is absent
  if (payload.type === 'SWITCH_ENGINE') {
    const targetUrl =
      payload.engine === 'gemini'
        ? 'https://gemini.google.com/app'
        : 'https://antigravity.google.com/remote';
    if (!location.href.startsWith(targetUrl)) {
      location.href = targetUrl;
    }
  } else if (payload.type === 'TELEPORT_TO_CODE' && payload.prompt) {
    try {
      window.name = JSON.stringify({
        __agy_teleport: payload.prompt,
        ts: Date.now(),
      });
    } catch {
      // ignore
    }
    location.href = 'https://antigravity.google.com/remote';
  }
}

export async function consumePendingTeleport(): Promise<string | null> {
  try {
    if (window.AgyAndroidBridge?.consumeTeleport) {
      const res = window.AgyAndroidBridge.consumeTeleport();
      if (res && res.trim().length > 0) return res;
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
      const res = await window.__TAURI_INTERNALS__.invoke('agy_bridge_message', {
        payload: { type: 'CONSUME_TELEPORT' },
      });
      if (typeof res === 'string' && res.trim().length > 0) {
        return res;
      }
    }
    if (window.name && window.name.startsWith('{')) {
      const parsed = JSON.parse(window.name) as { __agy_teleport?: string; ts?: number };
      if (parsed.__agy_teleport && Date.now() - (parsed.ts ?? 0) < 120_000) {
        window.name = '';
        return parsed.__agy_teleport;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Opens a URL in the user's default external browser (Chrome / Safari / Edge).
 * Bypasses embedded WebViews to allow full Google SSO login or account management.
 */
export function openExternalBrowser(url: string): void {
  try {
    if (window.AgyAndroidBridge?.openExternalUrl) {
      window.AgyAndroidBridge.openExternalUrl(url);
      return;
    }
  } catch {
    // fallback
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Imports Google session cookies (`.google.com`) into the native WebView cookie store
 * across Android (CookieManager) and Desktop (Tauri v2 WebviewWindow set_cookie).
 * After importing, reloads or redirects both WebViews into authenticated home/remote.
 */
export async function importGoogleSessionCookies(cookieInput: string): Promise<boolean> {
  const trimmed = cookieInput.trim();
  if (!trimmed) return false;

  // 1. Android Native WebViews
  if (window.AgyAndroidBridge?.importGoogleCookies) {
    try {
      const ok = window.AgyAndroidBridge.importGoogleCookies(trimmed);
      if (ok) return true;
    } catch (e) {
      console.warn('[AgyBridge] Android cookie import error:', e);
    }
  }

  // 2. Desktop Tauri WebViews
  if (window.__TAURI_INTERNALS__?.invoke) {
    try {
      const ok = await window.__TAURI_INTERNALS__.invoke('import_google_cookies', {
        cookieString: trimmed,
      });
      return Boolean(ok);
    } catch (e) {
      console.warn('[AgyBridge] Tauri cookie import error:', e);
    }
  }

  // 3. Fallback for client-side cookies
  try {
    const clean = trimmed.toLowerCase().startsWith('cookie:') ? trimmed.slice(7).trim() : trimmed;
    const pairs = clean.split(';');
    for (const raw of pairs) {
      const p = raw.trim();
      if (p.includes('=')) {
        document.cookie = `${p}; domain=.google.com; path=/; SameSite=None; Secure`;
      }
    }
    location.reload();
    return true;
  } catch (e) {
    console.warn('[AgyBridge] Client-side cookie fallback error:', e);
    return false;
  }
}

/**
 * Cross-Engine Unified Theme System (`light` | `dark`).
 * Ensures `✦ Chat` (Gemini), `⚡ Code` (Antigravity `/remote`, `/r/:uuid`, and guest `#hubFrame`),
 * `#agy-unified-topbar`, `dialog.agy-unified-drawer`, `#agy-quick-dock`, and `dialog.agy-bottom-sheet`
 * always render in the exact same color theme.
 */
export type UnifiedThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'agy.unifiedTheme.v1';
const themeListeners = new Set<(theme: UnifiedThemeMode) => void>();
const darkMediaListeners = new Set<(ev: MediaQueryListEvent) => void>();
const lightMediaListeners = new Set<(ev: MediaQueryListEvent) => void>();

const nativeMatchMedia =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : null;

function readInitialUnifiedTheme(): UnifiedThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
    const rawState = window.localStorage.getItem('agy.unifiedAppState.v1');
    if (rawState) {
      const parsed = JSON.parse(rawState) as { theme?: string };
      if (parsed?.theme === 'dark' || parsed?.theme === 'light') {
        return parsed.theme;
      }
    }
  } catch {
    // ignore storage errors in sandboxed frames
  }
  try {
    if (nativeMatchMedia && nativeMatchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // ignore
  }
  return 'light';
}

let currentUnifiedTheme: UnifiedThemeMode = readInitialUnifiedTheme();
let matchMediaIntercepted = false;

export function getUnifiedTheme(): UnifiedThemeMode {
  return currentUnifiedTheme;
}

export function subscribeUnifiedTheme(listener: (theme: UnifiedThemeMode) => void): () => void {
  themeListeners.add(listener);
  listener(currentUnifiedTheme);
  return () => themeListeners.delete(listener);
}

const ONYX_LIGHT_VARS: Record<string, string> = {
  '--background': '#FFFFFF',
  '--foreground': '#0A0A0C',
  '--primary': '#2F75C3',
  '--primary-foreground': '#FFFFFF',
  '--shell': '#FAFAFA',
  '--sidebar': '#FAFAFA',
  '--sidebar-secondary': 'rgb(10 10 12 / 0.075)',
  '--sidebar-muted': 'rgb(10 10 12 / 0.042)',
  '--secondary': 'rgb(10 10 12 / 0.06)',
  '--secondary-foreground': '#3F3F46',
  '--muted': 'rgb(10 10 12 / 0.038)',
  '--muted-foreground': '#71717A',
  '--placeholder': '#8E8E95',
  '--content': '#FFFFFF',
  '--card': '#FFFFFF',
  '--card-border': 'rgb(10 10 12 / 0.07)',
  '--border': 'rgb(10 10 12 / 0.06)',
  '--glass': '#FFFFFF',
  '--glass-border': 'rgb(10 10 12 / 0.065)',
  '--glass-highlight': 'rgb(255 255 255 / 1)',
  '--scrim': 'rgb(10 10 12 / 0.28)',
  '--onyx-frame': '#F9F9F9',
  '--onyx-well': 'rgb(10 10 12 / 0.055)',
  '--onyx-raised': '#FFFFFF',
  '--onyx-selected': 'color-mix(in srgb, var(--foreground) 6.5%, var(--sidebar))',
  '--onyx-key': '#FFFFFF',
};

const ONYX_DARK_VARS: Record<string, string> = {
  '--background': '#070708',
  '--foreground': '#FFFFFF',
  '--primary': '#2F71E3',
  '--primary-foreground': '#FFFFFF',
  '--shell': '#111114',
  '--sidebar': '#111114',
  '--sidebar-secondary': 'rgb(255 255 255 / 0.09)',
  '--sidebar-muted': 'rgb(255 255 255 / 0.048)',
  '--secondary': 'rgb(255 255 255 / 0.075)',
  '--secondary-foreground': '#BCBDC6',
  '--muted': 'rgb(255 255 255 / 0.042)',
  '--muted-foreground': '#87888F',
  '--placeholder': '#636470',
  '--content': '#070708',
  '--card': '#131317',
  '--card-border': 'rgb(255 255 255 / 0.08)',
  '--border': 'rgb(255 255 255 / 0.06)',
  '--glass': '#131317',
  '--glass-border': 'rgb(255 255 255 / 0.085)',
  '--glass-highlight': 'rgb(255 255 255 / 0.085)',
  '--scrim': 'rgb(0 0 0 / 0.64)',
  '--onyx-frame': '#0D0D11',
  '--onyx-well': '#111115',
  '--onyx-raised': '#15151A',
  '--onyx-selected': '#1F1F24',
  '--onyx-key': '#24252A',
};

export function applyUnifiedThemeToDocument(theme: UnifiedThemeMode = currentUnifiedTheme): void {
  const isDark = theme === 'dark';
  const root = document.documentElement;
  const host = window.location.hostname;
  if (root) {
    root.setAttribute('data-agy-unified-theme', theme);
    root.style.colorScheme = theme;
    root.classList.toggle('dark', isDark);
    root.classList.toggle('light', !isDark);
    root.classList.toggle('dark-theme', isDark);
    root.classList.toggle('light-theme', !isDark);
    root.style.setProperty('--agy-surface', isDark ? '#131314' : '#ffffff');

    if (!host.includes('gemini.google.com')) {
      const vars = isDark ? ONYX_DARK_VARS : ONYX_LIGHT_VARS;
      for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
      }
    }
  }

  const body = document.body;
  if (body) {
    if (host.includes('gemini.google.com')) {
      body.classList.toggle('dark-theme', isDark);
      body.classList.toggle('light-theme', !isDark);
      body.classList.toggle('dark', isDark);
      body.classList.toggle('light', !isDark);

      const chatApp = document.querySelector('chat-app, chat-app-orchestrator');
      if (chatApp) {
        chatApp.classList.toggle('dark-theme', isDark);
        chatApp.classList.toggle('light-theme', !isDark);
      }
    } else {
      body.classList.toggle('dark', isDark);
      body.classList.toggle('dark-theme', isDark);
      body.classList.toggle('theme-dark', isDark);
      body.classList.toggle('theme-light', !isDark);
    }
  }

  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    window.localStorage.setItem('bcsp', theme);
    if (window.location.hostname.includes('gemini.google.com')) {
      window.localStorage.setItem(
        'Bard-Color-Theme',
        isDark ? 'Bard-Dark-Theme' : 'Bard-Light-Theme'
      );
      window.localStorage.setItem(
        'bard-color-theme',
        isDark ? 'Bard-Dark-Theme' : 'Bard-Light-Theme'
      );
    }
  } catch {
    // ignore
  }

  // Sync Android System Status & Navigation Bar Appearance
  try {
    if (window.AgyAndroidBridge?.updateTheme) {
      window.AgyAndroidBridge.updateTheme(isDark);
    } else {
      const bridge = (window as unknown as {
        AndroidBridge?: { updateTheme?: (d: boolean) => void };
      }).AndroidBridge;
      if (bridge?.updateTheme) {
        bridge.updateTheme(isDark);
      }
    }
  } catch {
    // ignore
  }

  // Forward theme change into guest #hubFrame if present
  try {
    const iframes = document.querySelectorAll<HTMLIFrameElement>('iframe');
    for (const frame of Array.from(iframes)) {
      if (frame.src && frame.src.includes('antigravity.static.usercontent.goog')) {
        frame.contentWindow?.postMessage(
          { type: 'AGY_GUEST_COMMAND', action: 'SET_THEME', theme },
          'https://antigravity.static.usercontent.goog'
        );
      }
    }
  } catch {
    // ignore
  }
}

export function setUnifiedTheme(theme: UnifiedThemeMode, notifyListeners = true): void {
  const changed = currentUnifiedTheme !== theme;
  currentUnifiedTheme = theme;
  applyUnifiedThemeToDocument(theme);

  if (changed) {
    const isDark = theme === 'dark';
    const darkEv = {
      matches: isDark,
      media: '(prefers-color-scheme: dark)',
    } as MediaQueryListEvent;
    for (const fn of darkMediaListeners) {
      try {
        fn(darkEv);
      } catch {
        // ignore
      }
    }
    const lightEv = {
      matches: !isDark,
      media: '(prefers-color-scheme: light)',
    } as MediaQueryListEvent;
    for (const fn of lightMediaListeners) {
      try {
        fn(lightEv);
      } catch {
        // ignore
      }
    }
  }

  if (notifyListeners) {
    for (const listener of themeListeners) {
      try {
        listener(theme);
      } catch {
        // ignore
      }
    }
  }
}

export function toggleUnifiedTheme(): UnifiedThemeMode {
  const next: UnifiedThemeMode = currentUnifiedTheme === 'dark' ? 'light' : 'dark';
  setUnifiedTheme(next, true);
  return next;
}

export type UnifiedFontSize = '12px' | '14px' | '16px' | '18px';
export type UnifiedTopbarHeight = '48px' | '54px' | '60px';

export function getUnifiedFontSize(): UnifiedFontSize {
  try {
    const saved = localStorage.getItem('agy.fontSize') as UnifiedFontSize | null;
    if (saved && ['12px', '14px', '16px', '18px'].includes(saved)) {
      return saved;
    }
  } catch {}
  return '14px';
}

export function setUnifiedFontSize(size: UnifiedFontSize): void {
  try {
    localStorage.setItem('agy.fontSize', size);
  } catch {}
  document.documentElement.style.setProperty('--agy-font-size', size);
}

export function getUnifiedTopbarHeight(): UnifiedTopbarHeight {
  try {
    const saved = localStorage.getItem('agy.topbarHeight') as UnifiedTopbarHeight | null;
    if (saved && ['48px', '54px', '60px'].includes(saved)) {
      return saved;
    }
  } catch {}
  return '54px';
}

export function setUnifiedTopbarHeight(height: UnifiedTopbarHeight): void {
  try {
    localStorage.setItem('agy.topbarHeight', height);
  } catch {}
  document.documentElement.style.setProperty('--agy-topbar-h', height);
}

export function getShowSubtabs(): boolean {
  try {
    const val = localStorage.getItem('agy.showSubtabs');
    if (val === null) return false;
    return val === 'true';
  } catch {
    return false;
  }
}

export function setShowSubtabs(show: boolean): void {
  try {
    localStorage.setItem('agy.showSubtabs', String(show));
  } catch {}
}

export function installUnifiedThemeSystem(): void {
  if (matchMediaIntercepted || !nativeMatchMedia) return;
  matchMediaIntercepted = true;

  try {
    window.matchMedia = ((query: string): MediaQueryList => {
      const mql = nativeMatchMedia(query);
      const q = query.trim().toLowerCase();
      const isDarkQuery = q === '(prefers-color-scheme: dark)';
      const isLightQuery = q === '(prefers-color-scheme: light)';
      if (!isDarkQuery && !isLightQuery) {
        return mql;
      }

      const listenerSet = isDarkQuery ? darkMediaListeners : lightMediaListeners;
      const origAdd = mql.addEventListener.bind(mql);
      const origRemove = mql.removeEventListener.bind(mql);

      return new Proxy(mql, {
        get(target, prop) {
          if (prop === 'matches') {
            return isDarkQuery ? currentUnifiedTheme === 'dark' : currentUnifiedTheme === 'light';
          }
          if (prop === 'addEventListener') {
            return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
              if (type === 'change' && typeof listener === 'function') {
                listenerSet.add(listener as (ev: MediaQueryListEvent) => void);
              }
              return origAdd(type, listener, options);
            };
          }
          if (prop === 'removeEventListener') {
            return (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
              if (type === 'change' && typeof listener === 'function') {
                listenerSet.delete(listener as (ev: MediaQueryListEvent) => void);
              }
              return origRemove(type, listener, options);
            };
          }
          if (prop === 'addListener') {
            return (listener: ((ev: MediaQueryListEvent) => void) | null) => {
              if (typeof listener === 'function') listenerSet.add(listener);
            };
          }
          if (prop === 'removeListener') {
            return (listener: ((ev: MediaQueryListEvent) => void) | null) => {
              if (typeof listener === 'function') listenerSet.delete(listener);
            };
          }
          const val = Reflect.get(target, prop);
          return typeof val === 'function' ? val.bind(target) : val;
        },
      });
    }) as typeof window.matchMedia;
  } catch {
    // ignore if matchMedia is non-configurable
  }

  applyUnifiedThemeToDocument(currentUnifiedTheme);
  document.documentElement.style.setProperty('--agy-font-size', getUnifiedFontSize());
  document.documentElement.style.setProperty('--agy-topbar-h', getUnifiedTopbarHeight());
  if (document.readyState === 'loading') {
    window.addEventListener(
      'DOMContentLoaded',
      () => applyUnifiedThemeToDocument(currentUnifiedTheme),
      { once: true }
    );
  }
  window.addEventListener(
    'load',
    () => applyUnifiedThemeToDocument(currentUnifiedTheme),
    { once: true }
  );
  setTimeout(() => applyUnifiedThemeToDocument(currentUnifiedTheme), 350);
}

installUnifiedThemeSystem();

/**
 * Intercepts clicks on external `<a>` links or `window.open` calls across both
 * Gemini and Antigravity (including `#hubFrame`), routing all third-party URIs
 * to the OS System Browser (`Intent.ACTION_VIEW`) so the app WebView is never
 * hijacked or navigated away from the native app experience.
 */
export function isAllowedInAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    if (parsed.protocol === 'blob:' || parsed.protocol === 'data:' || parsed.protocol === 'javascript:') {
      return true;
    }
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;

    if (host === 'antigravity.static.usercontent.goog') return true;
    if (host === 'accounts.google.com') return true;
    if (host === 'antigravity.google.com') {
      return path === '' || path === '/' || path.startsWith('/remote') || path.startsWith('/r/');
    }
    if (host === 'gemini.google.com') {
      return path === '' || path === '/' || path.startsWith('/app') || path.startsWith('/u/');
    }
    return false;
  } catch {
    return false;
  }
}

export function openExternalInSystemBrowser(url: string): void {
  try {
    if (window.AgyAndroidBridge?.openExternalUrl) {
      window.AgyAndroidBridge.openExternalUrl(url);
      return;
    }
    const androidBridge = (window as unknown as {
      AndroidBridge?: { openExternalUrl?: (u: string) => void };
    }).AndroidBridge;
    if (androidBridge?.openExternalUrl) {
      androidBridge.openExternalUrl(url);
      return;
    }
    if (window.self !== window.top) {
      window.top?.postMessage(
        { type: 'AGY_OPEN_EXTERNAL_URL', url },
        'https://antigravity.google.com'
      );
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // ignore
  }
}

let linkGuardInstalled = false;
export function installExternalLinkGuard(): void {
  if (linkGuardInstalled) return;
  linkGuardInstalled = true;

  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target || typeof target.closest !== 'function') return;
      const anchor = target.closest<HTMLAnchorElement>('a[href]');
      if (!anchor) return;
      const rawHref = anchor.getAttribute('href') || '';
      if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) return;

      const resolved = anchor.href;
      if (!isAllowedInAppUrl(resolved)) {
        event.preventDefault();
        event.stopPropagation();
        openExternalInSystemBrowser(resolved);
      }
    },
    true
  );
}

installExternalLinkGuard();
