(() => {
  // src/inject/dom-safe.ts
  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    if (props.className)
      node.className = props.className;
    if (props.id)
      node.id = props.id;
    if (props.text !== undefined)
      node.textContent = props.text;
    if (props.textContent !== undefined)
      node.textContent = props.textContent;
    if (props.title)
      node.title = props.title;
    if (props.role)
      node.setAttribute("role", props.role);
    if (props.tabIndex !== undefined)
      node.tabIndex = props.tabIndex;
    if (props.autofocus)
      node.autofocus = true;
    if (props.hidden === "until-found") {
      node.setAttribute("hidden", "until-found");
    } else if (props.hidden === true) {
      node.hidden = true;
    }
    if (props.type && "type" in node) {
      node.type = props.type;
    }
    if (props.value !== undefined && "value" in node) {
      node.value = props.value;
    }
    if (props.placeholder && "placeholder" in node) {
      node.placeholder = props.placeholder;
    }
    if (props.disabled !== undefined && "disabled" in node) {
      node.disabled = props.disabled;
    }
    if (props.href && node instanceof HTMLAnchorElement) {
      node.href = props.href;
      if (props.target)
        node.target = props.target;
      if (props.rel)
        node.rel = props.rel;
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
      if (typeof props.style === "string") {
        node.style.cssText = props.style;
      } else {
        Object.assign(node.style, props.style);
      }
    }
    if (props.onClick) {
      node.addEventListener("click", props.onClick);
    }
    if (props.onKeyDown) {
      node.addEventListener("keydown", props.onKeyDown);
    }
    if (props.onInput) {
      node.addEventListener("input", props.onInput);
    }
    const appendSpec = (spec) => {
      if (spec === null || spec === undefined || typeof spec === "boolean")
        return;
      if (Array.isArray(spec)) {
        for (const item of spec)
          appendSpec(item);
      } else if (typeof spec === "string" || typeof spec === "number") {
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
  function clearChildren(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }
  function adoptStyleSheet(id, cssText) {
    try {
      const existing = window.__agySheets;
      const map = existing ?? new Map;
      window.__agySheets = map;
      let sheet = map.get(id);
      if (!sheet) {
        sheet = new CSSStyleSheet;
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
  function isDesktopApp() {
    if (typeof window === "undefined")
      return false;
    if (window.AgyAndroidBridge)
      return false;
    const ua = navigator.userAgent;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua))
      return false;
    return true;
  }
  function initFormFactor() {
    if (typeof document === "undefined")
      return;
    const isDesktop = isDesktopApp();
    const factor = isDesktop ? "desktop" : "mobile";
    document.documentElement.setAttribute("data-agy-form-factor", factor);
    if (document.body) {
      document.body.setAttribute("data-agy-form-factor", factor);
    }
  }
  function ensureModernHeadMeta() {
    initFormFactor();
    if (!document.head)
      return;
    if (!document.querySelector('meta[name="color-scheme"]')) {
      const meta = document.createElement("meta");
      meta.name = "color-scheme";
      meta.content = "light dark";
      document.head.prepend(meta);
    }
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport && !viewport.content.includes("viewport-fit=cover")) {
      viewport.content = `${viewport.content}, viewport-fit=cover, interactive-widget=resizes-content`;
    }
  }
  function sendToNative(payload) {
    try {
      if (window.AgyAndroidBridge) {
        if (payload.type === "SWITCH_ENGINE" && payload.engine && window.AgyAndroidBridge.switchEngine) {
          window.AgyAndroidBridge.switchEngine(payload.engine);
          return;
        }
        if (payload.type === "TELEPORT_TO_CODE" && payload.prompt && window.AgyAndroidBridge.teleportToCode) {
          window.AgyAndroidBridge.teleportToCode(payload.prompt);
          return;
        }
        if (payload.type === "PERMISSION_PROMPT" && window.AgyAndroidBridge.notifyPermissionPrompt) {
          window.AgyAndroidBridge.notifyPermissionPrompt(payload.toolName ?? "Agent Action", payload.commandText ?? "", payload.requestId ?? `req_${Date.now()}`);
          return;
        }
        if (payload.type === "HAPTIC_TICK" && window.AgyAndroidBridge.hapticTick) {
          window.AgyAndroidBridge.hapticTick();
          return;
        }
        window.AgyAndroidBridge.postMessage(JSON.stringify(payload));
        return;
      }
      if (window.__TAURI_INTERNALS__?.invoke) {
        window.__TAURI_INTERNALS__.invoke("agy_bridge_message", { payload });
        return;
      }
    } catch {}
    if (payload.type === "SWITCH_ENGINE") {
      const targetUrl = payload.engine === "gemini" ? "https://gemini.google.com/app" : "https://antigravity.google.com/remote";
      if (!location.href.startsWith(targetUrl)) {
        location.href = targetUrl;
      }
    } else if (payload.type === "TELEPORT_TO_CODE" && payload.prompt) {
      try {
        window.name = JSON.stringify({
          __agy_teleport: payload.prompt,
          ts: Date.now()
        });
      } catch {}
      location.href = "https://antigravity.google.com/remote";
    }
  }
  function openExternalBrowser(url) {
    try {
      if (window.AgyAndroidBridge?.openExternalUrl) {
        window.AgyAndroidBridge.openExternalUrl(url);
        return;
      }
    } catch {}
    window.open(url, "_blank", "noopener,noreferrer");
  }
  async function importGoogleSessionCookies(cookieInput) {
    const trimmed = cookieInput.trim();
    if (!trimmed)
      return false;
    if (window.AgyAndroidBridge?.importGoogleCookies) {
      try {
        const ok = window.AgyAndroidBridge.importGoogleCookies(trimmed);
        if (ok)
          return true;
      } catch (e) {
        console.warn("[AgyBridge] Android cookie import error:", e);
      }
    }
    if (window.__TAURI_INTERNALS__?.invoke) {
      try {
        const ok = await window.__TAURI_INTERNALS__.invoke("import_google_cookies", {
          cookieString: trimmed
        });
        return Boolean(ok);
      } catch (e) {
        console.warn("[AgyBridge] Tauri cookie import error:", e);
      }
    }
    try {
      const clean = trimmed.toLowerCase().startsWith("cookie:") ? trimmed.slice(7).trim() : trimmed;
      const pairs = clean.split(";");
      for (const raw of pairs) {
        const p = raw.trim();
        if (p.includes("=")) {
          document.cookie = `${p}; domain=.google.com; path=/; SameSite=None; Secure`;
        }
      }
      location.reload();
      return true;
    } catch (e) {
      console.warn("[AgyBridge] Client-side cookie fallback error:", e);
      return false;
    }
  }
  var THEME_STORAGE_KEY = "agy.unifiedTheme.v1";
  var themeListeners = new Set;
  var darkMediaListeners = new Set;
  var lightMediaListeners = new Set;
  var nativeMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : null;
  function readInitialUnifiedTheme() {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "dark" || saved === "light")
        return saved;
      const rawState = window.localStorage.getItem("agy.unifiedAppState.v1");
      if (rawState) {
        const parsed = JSON.parse(rawState);
        if (parsed?.theme === "dark" || parsed?.theme === "light") {
          return parsed.theme;
        }
      }
    } catch {}
    try {
      if (nativeMatchMedia && nativeMatchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch {}
    return "light";
  }
  var currentUnifiedTheme = readInitialUnifiedTheme();
  var matchMediaIntercepted = false;
  function getUnifiedTheme() {
    return currentUnifiedTheme;
  }
  function subscribeUnifiedTheme(listener) {
    themeListeners.add(listener);
    listener(currentUnifiedTheme);
    return () => themeListeners.delete(listener);
  }
  var ONYX_LIGHT_VARS = {
    "--background": "#FFFFFF",
    "--foreground": "#0A0A0C",
    "--primary": "#2F75C3",
    "--primary-foreground": "#FFFFFF",
    "--shell": "#FAFAFA",
    "--sidebar": "#FAFAFA",
    "--sidebar-secondary": "rgb(10 10 12 / 0.075)",
    "--sidebar-muted": "rgb(10 10 12 / 0.042)",
    "--secondary": "rgb(10 10 12 / 0.06)",
    "--secondary-foreground": "#3F3F46",
    "--muted": "rgb(10 10 12 / 0.038)",
    "--muted-foreground": "#71717A",
    "--placeholder": "#8E8E95",
    "--content": "#FFFFFF",
    "--card": "#FFFFFF",
    "--card-border": "rgb(10 10 12 / 0.07)",
    "--border": "rgb(10 10 12 / 0.06)",
    "--glass": "#FFFFFF",
    "--glass-border": "rgb(10 10 12 / 0.065)",
    "--glass-highlight": "rgb(255 255 255 / 1)",
    "--scrim": "rgb(10 10 12 / 0.28)",
    "--onyx-frame": "#F9F9F9",
    "--onyx-well": "rgb(10 10 12 / 0.055)",
    "--onyx-raised": "#FFFFFF",
    "--onyx-selected": "color-mix(in srgb, var(--foreground) 6.5%, var(--sidebar))",
    "--onyx-key": "#FFFFFF"
  };
  var ONYX_DARK_VARS = {
    "--background": "#070708",
    "--foreground": "#FFFFFF",
    "--primary": "#2F71E3",
    "--primary-foreground": "#FFFFFF",
    "--shell": "#111114",
    "--sidebar": "#111114",
    "--sidebar-secondary": "rgb(255 255 255 / 0.09)",
    "--sidebar-muted": "rgb(255 255 255 / 0.048)",
    "--secondary": "rgb(255 255 255 / 0.075)",
    "--secondary-foreground": "#BCBDC6",
    "--muted": "rgb(255 255 255 / 0.042)",
    "--muted-foreground": "#87888F",
    "--placeholder": "#636470",
    "--content": "#070708",
    "--card": "#131317",
    "--card-border": "rgb(255 255 255 / 0.08)",
    "--border": "rgb(255 255 255 / 0.06)",
    "--glass": "#131317",
    "--glass-border": "rgb(255 255 255 / 0.085)",
    "--glass-highlight": "rgb(255 255 255 / 0.085)",
    "--scrim": "rgb(0 0 0 / 0.64)",
    "--onyx-frame": "#0D0D11",
    "--onyx-well": "#111115",
    "--onyx-raised": "#15151A",
    "--onyx-selected": "#1F1F24",
    "--onyx-key": "#24252A"
  };
  function applyUnifiedThemeToDocument(theme = currentUnifiedTheme) {
    const isDark = theme === "dark";
    const root = document.documentElement;
    const host = window.location.hostname;
    if (root) {
      root.setAttribute("data-agy-unified-theme", theme);
      root.style.colorScheme = theme;
      root.classList.toggle("dark", isDark);
      root.classList.toggle("light", !isDark);
      root.classList.toggle("dark-theme", isDark);
      root.classList.toggle("light-theme", !isDark);
      root.style.setProperty("--agy-surface", isDark ? "#131314" : "#ffffff");
      if (!host.includes("gemini.google.com")) {
        const vars = isDark ? ONYX_DARK_VARS : ONYX_LIGHT_VARS;
        for (const [k, v] of Object.entries(vars)) {
          root.style.setProperty(k, v);
        }
      }
    }
    const body = document.body;
    if (body) {
      if (host.includes("gemini.google.com")) {
        body.classList.toggle("dark-theme", isDark);
        body.classList.toggle("light-theme", !isDark);
        body.classList.toggle("dark", isDark);
        body.classList.toggle("light", !isDark);
        const chatApp = document.querySelector("chat-app, chat-app-orchestrator");
        if (chatApp) {
          chatApp.classList.toggle("dark-theme", isDark);
          chatApp.classList.toggle("light-theme", !isDark);
        }
      } else {
        body.classList.toggle("dark", isDark);
        body.classList.toggle("dark-theme", isDark);
        body.classList.toggle("theme-dark", isDark);
        body.classList.toggle("theme-light", !isDark);
      }
    }
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
      window.localStorage.setItem("bcsp", theme);
      if (window.location.hostname.includes("gemini.google.com")) {
        window.localStorage.setItem("Bard-Color-Theme", isDark ? "Bard-Dark-Theme" : "Bard-Light-Theme");
        window.localStorage.setItem("bard-color-theme", isDark ? "Bard-Dark-Theme" : "Bard-Light-Theme");
      }
    } catch {}
    try {
      if (window.AgyAndroidBridge?.updateTheme) {
        window.AgyAndroidBridge.updateTheme(isDark);
      } else {
        const bridge = window.AndroidBridge;
        if (bridge?.updateTheme) {
          bridge.updateTheme(isDark);
        }
      }
    } catch {}
    try {
      const iframes = document.querySelectorAll("iframe");
      for (const frame of Array.from(iframes)) {
        if (frame.src && frame.src.includes("antigravity.static.usercontent.goog")) {
          frame.contentWindow?.postMessage({ type: "AGY_GUEST_COMMAND", action: "SET_THEME", theme }, "https://antigravity.static.usercontent.goog");
        }
      }
    } catch {}
  }
  function setUnifiedTheme(theme, notifyListeners = true) {
    const changed = currentUnifiedTheme !== theme;
    currentUnifiedTheme = theme;
    applyUnifiedThemeToDocument(theme);
    if (changed) {
      const isDark = theme === "dark";
      const darkEv = {
        matches: isDark,
        media: "(prefers-color-scheme: dark)"
      };
      for (const fn of darkMediaListeners) {
        try {
          fn(darkEv);
        } catch {}
      }
      const lightEv = {
        matches: !isDark,
        media: "(prefers-color-scheme: light)"
      };
      for (const fn of lightMediaListeners) {
        try {
          fn(lightEv);
        } catch {}
      }
    }
    if (notifyListeners) {
      for (const listener of themeListeners) {
        try {
          listener(theme);
        } catch {}
      }
    }
  }
  function toggleUnifiedTheme() {
    const next = currentUnifiedTheme === "dark" ? "light" : "dark";
    setUnifiedTheme(next, true);
    return next;
  }
  function getUnifiedFontSize() {
    try {
      const saved = localStorage.getItem("agy.fontSize");
      if (saved && ["12px", "14px", "16px", "18px"].includes(saved)) {
        return saved;
      }
    } catch {}
    return "14px";
  }
  function setUnifiedFontSize(size) {
    try {
      localStorage.setItem("agy.fontSize", size);
    } catch {}
    document.documentElement.style.setProperty("--agy-font-size", size);
  }
  function getUnifiedTopbarHeight() {
    try {
      const saved = localStorage.getItem("agy.topbarHeight");
      if (saved && ["48px", "54px", "60px"].includes(saved)) {
        return saved;
      }
    } catch {}
    return "54px";
  }
  function setUnifiedTopbarHeight(height) {
    try {
      localStorage.setItem("agy.topbarHeight", height);
    } catch {}
    document.documentElement.style.setProperty("--agy-topbar-h", height);
  }
  function getShowSubtabs() {
    try {
      const val = localStorage.getItem("agy.showSubtabs");
      if (val === null)
        return false;
      return val === "true";
    } catch {
      return false;
    }
  }
  function setShowSubtabs(show) {
    try {
      localStorage.setItem("agy.showSubtabs", String(show));
    } catch {}
  }
  function installUnifiedThemeSystem() {
    if (matchMediaIntercepted || !nativeMatchMedia)
      return;
    matchMediaIntercepted = true;
    try {
      window.matchMedia = (query) => {
        const mql = nativeMatchMedia(query);
        const q = query.trim().toLowerCase();
        const isDarkQuery = q === "(prefers-color-scheme: dark)";
        const isLightQuery = q === "(prefers-color-scheme: light)";
        if (!isDarkQuery && !isLightQuery) {
          return mql;
        }
        const listenerSet = isDarkQuery ? darkMediaListeners : lightMediaListeners;
        const origAdd = mql.addEventListener.bind(mql);
        const origRemove = mql.removeEventListener.bind(mql);
        return new Proxy(mql, {
          get(target, prop) {
            if (prop === "matches") {
              return isDarkQuery ? currentUnifiedTheme === "dark" : currentUnifiedTheme === "light";
            }
            if (prop === "addEventListener") {
              return (type, listener, options) => {
                if (type === "change" && typeof listener === "function") {
                  listenerSet.add(listener);
                }
                return origAdd(type, listener, options);
              };
            }
            if (prop === "removeEventListener") {
              return (type, listener, options) => {
                if (type === "change" && typeof listener === "function") {
                  listenerSet.delete(listener);
                }
                return origRemove(type, listener, options);
              };
            }
            if (prop === "addListener") {
              return (listener) => {
                if (typeof listener === "function")
                  listenerSet.add(listener);
              };
            }
            if (prop === "removeListener") {
              return (listener) => {
                if (typeof listener === "function")
                  listenerSet.delete(listener);
              };
            }
            const val = Reflect.get(target, prop);
            return typeof val === "function" ? val.bind(target) : val;
          }
        });
      };
    } catch {}
    applyUnifiedThemeToDocument(currentUnifiedTheme);
    document.documentElement.style.setProperty("--agy-font-size", getUnifiedFontSize());
    document.documentElement.style.setProperty("--agy-topbar-h", getUnifiedTopbarHeight());
    if (document.readyState === "loading") {
      window.addEventListener("DOMContentLoaded", () => applyUnifiedThemeToDocument(currentUnifiedTheme), { once: true });
    }
    window.addEventListener("load", () => applyUnifiedThemeToDocument(currentUnifiedTheme), { once: true });
    setTimeout(() => applyUnifiedThemeToDocument(currentUnifiedTheme), 350);
  }
  installUnifiedThemeSystem();
  function isAllowedInAppUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.origin);
      if (parsed.protocol === "blob:" || parsed.protocol === "data:" || parsed.protocol === "javascript:") {
        return true;
      }
      if (parsed.protocol !== "https:")
        return false;
      const host = parsed.hostname.toLowerCase();
      const path = parsed.pathname;
      if (host === "antigravity.static.usercontent.goog")
        return true;
      if (host === "accounts.google.com")
        return true;
      if (host === "antigravity.google.com") {
        return path === "" || path === "/" || path.startsWith("/remote") || path.startsWith("/r/");
      }
      if (host === "gemini.google.com") {
        return path === "" || path === "/" || path.startsWith("/app") || path.startsWith("/u/");
      }
      return false;
    } catch {
      return false;
    }
  }
  function openExternalInSystemBrowser(url) {
    try {
      if (window.AgyAndroidBridge?.openExternalUrl) {
        window.AgyAndroidBridge.openExternalUrl(url);
        return;
      }
      const androidBridge = window.AndroidBridge;
      if (androidBridge?.openExternalUrl) {
        androidBridge.openExternalUrl(url);
        return;
      }
      if (window.self !== window.top) {
        window.top?.postMessage({ type: "AGY_OPEN_EXTERNAL_URL", url }, "https://antigravity.google.com");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {}
  }
  var linkGuardInstalled = false;
  function installExternalLinkGuard() {
    if (linkGuardInstalled)
      return;
    linkGuardInstalled = true;
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function")
        return;
      const anchor = target.closest("a[href]");
      if (!anchor)
        return;
      const rawHref = anchor.getAttribute("href") || "";
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:"))
        return;
      const resolved = anchor.href;
      if (!isAllowedInAppUrl(resolved)) {
        event.preventDefault();
        event.stopPropagation();
        openExternalInSystemBrowser(resolved);
      }
    }, true);
  }
  installExternalLinkGuard();

  // src/inject/google-cookie-helper.ts
  var COOKIE_HELPER_CSS = `
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
  function createCookieImportCard(onSuccess) {
    adoptStyleSheet("agy-cookie-helper-styles", COOKIE_HELPER_CSS);
    const card = el("div", { className: "agy-cookie-import-card" });
    const header = el("div", { className: "agy-cookie-card-header" }, el("div", { className: "agy-cookie-card-title-box" }, el("div", { className: "agy-cookie-card-icon", text: "\uD83D\uDD11" }), el("div", { className: "agy-cookie-card-title", text: "Google 账号凭证同步 (Cookie 秒登)" })), el("span", { className: "agy-cookie-card-badge", text: "免内嵌拦截" }));
    const desc = el("div", {
      className: "agy-cookie-card-desc",
      text: "因 Google 安全机制禁止在应用内嵌窗口直接输入密码登录，最佳解决方案为：在外部系统浏览器登录一次后，将 Cookie 凭证粘贴至下方即可一键同步双端工作区！"
    });
    const textarea = el("textarea", {
      className: "agy-cookie-textarea",
      placeholder: "在此粘贴 Google Cookie 字符串 (如: SID=...; HSID=...; __Secure-1PSID=... 或 Cookie-Editor 导出的 JSON)...",
      aria: { label: "Google Cookie 字符串" }
    });
    const statusMsg = el("div", { className: "agy-cookie-status-msg" });
    let helpVisible = false;
    const helpPanel = el("div", { className: "agy-cookie-help-panel", style: { display: "none" } }, el("div", {
      style: { fontWeight: "700", color: "var(--agy-text, inherit)" },
      text: "\uD83D\uDCCC 两种极其简单的凭证获取方式："
    }), el("ol", {}, el("li", {}, "方式一（推荐扩展）：在 Chrome/Edge 浏览器安装 Cookie-Editor 扩展，打开 gemini.google.com 或 google.com 登录后，点击扩展「Export」->「Header String」或「JSON」，直接粘贴至上方。"), el("li", {}, "方式二（开发者工具）：在任意浏览器打开已登录的 gemini.google.com，按 F12 -> Network (网络) -> 刷新页面 -> 点击任一请求 -> 复制 Request Headers 中的 Cookie 属性整行粘贴即可。")));
    const actionsRow = el("div", { className: "agy-cookie-actions-row" });
    const openBrowserBtn = el("button", {
      type: "button",
      className: "agy-cookie-btn agy-cookie-btn-outline",
      onClick: () => {
        openExternalBrowser("https://accounts.google.com");
      }
    }, "\uD83C\uDF10 打开系统浏览器登录");
    const toggleHelpBtn = el("button", {
      type: "button",
      className: "agy-cookie-btn agy-cookie-btn-outline",
      onClick: () => {
        helpVisible = !helpVisible;
        helpPanel.style.display = helpVisible ? "flex" : "none";
        toggleHelpBtn.textContent = helpVisible ? "✕ 收起提取指南" : "❓ 查看提取指南";
      }
    }, "❓ 查看提取指南");
    const importBtn = el("button", {
      type: "button",
      className: "agy-cookie-btn agy-cookie-btn-primary",
      onClick: async () => {
        const val = textarea.value.trim();
        if (!val) {
          statusMsg.className = "agy-cookie-status-msg error";
          statusMsg.textContent = "请先粘贴 Cookie 字符串或 JSON 内容！";
          textarea.focus();
          return;
        }
        importBtn.disabled = true;
        importBtn.textContent = "⏳ 正在同步凭证...";
        statusMsg.className = "agy-cookie-status-msg";
        statusMsg.textContent = "";
        try {
          const success = await importGoogleSessionCookies(val);
          if (success) {
            statusMsg.className = "agy-cookie-status-msg success";
            statusMsg.textContent = "✓ Google 会话凭证已成功同步！正在重定向到工作区...";
            textarea.value = "";
            setTimeout(() => {
              if (onSuccess)
                onSuccess();
            }, 1200);
          } else {
            statusMsg.className = "agy-cookie-status-msg error";
            statusMsg.textContent = "导入失败，请检查 Cookie 格式是否正确！";
            importBtn.disabled = false;
            importBtn.textContent = "✦ 一键同步会话凭证";
          }
        } catch (err) {
          statusMsg.className = "agy-cookie-status-msg error";
          statusMsg.textContent = `同步异常: ${String(err)}`;
          importBtn.disabled = false;
          importBtn.textContent = "✦ 一键同步会话凭证";
        }
      }
    }, "✦ 一键同步会话凭证");
    actionsRow.append(importBtn, openBrowserBtn, toggleHelpBtn);
    card.append(header, desc, textarea, statusMsg, actionsRow, helpPanel);
    return card;
  }
  function openCookieImportModal() {
    adoptStyleSheet("agy-cookie-helper-styles", COOKIE_HELPER_CSS);
    const existing = document.querySelector("dialog.agy-cookie-modal");
    if (existing) {
      existing.close();
      existing.remove();
    }
    const dlg = el("dialog", { className: "agy-cookie-modal" });
    const inner = el("div", { className: "agy-cookie-modal-inner" });
    const topRow = el("div", { className: "agy-cookie-modal-header" }, el("div", {
      style: { fontWeight: "700", fontSize: "1rem", color: "var(--agy-text)" },
      text: "✦ Google 统一账号认证"
    }), el("button", {
      type: "button",
      className: "agy-cookie-modal-close-btn",
      text: "×",
      onClick: () => dlg.close()
    }));
    const card = createCookieImportCard(() => {
      dlg.close();
    });
    inner.append(topRow, card);
    dlg.appendChild(inner);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) {
        dlg.close();
      }
    });
    dlg.addEventListener("close", () => {
      dlg.remove();
    });
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  function mountAccountsGoogleLoginHelper() {
    if (document.getElementById("agy-auth-helper-banner"))
      return;
    adoptStyleSheet("agy-cookie-helper-styles", COOKIE_HELPER_CSS);
    const banner = el("div", {
      id: "agy-auth-helper-banner",
      className: "agy-auth-helper-banner"
    });
    const content = el("div", { className: "agy-auth-helper-content" }, el("span", { style: { fontSize: "1.2rem" }, text: "⚡" }), el("div", { className: "agy-auth-helper-text" }, el("strong", { text: "Antigravity 登录助手：" }), " Google 官方安全策略禁止在内嵌应用直接输入密码。请在外部浏览器登录后点击右侧一键导入 Cookie 凭证即可秒登。"));
    const btnRow = el("div", { style: { display: "flex", gap: "8px", alignItems: "center" } });
    const importBtn = el("button", {
      type: "button",
      className: "agy-auth-helper-btn",
      onClick: () => {
        openCookieImportModal();
      }
    }, "\uD83D\uDD11 导入 Cookie 秒登");
    const browserBtn = el("button", {
      type: "button",
      className: "agy-auth-helper-btn",
      style: { background: "rgba(255,255,255,0.15)" },
      onClick: () => {
        openExternalBrowser("https://accounts.google.com");
      }
    }, "\uD83C\uDF10 浏览器登录");
    btnRow.append(importBtn, browserBtn);
    banner.append(content, btnRow);
    document.body.appendChild(banner);
    document.body.style.paddingTop = "54px";
  }

  // src/inject/multi-device-aggregator.ts
  var CACHE_KEY = "agy.unifiedAppState.v1";
  var capturedGrpcClient = null;
  var capturedRemoteControlComp = null;
  var capturedLsClient = null;
  var stateListeners = new Set;
  function isValidGeminiChatThread(item) {
    if (!item || typeof item !== "object")
      return false;
    const candidate = item;
    const id = String(candidate.id || "").trim();
    const rawTitle = String(candidate.title || "").trim();
    if (!id || !rawTitle)
      return false;
    const titleLower = rawTitle.toLowerCase();
    const idLower = id.toLowerCase();
    if (rawTitle.length < 2 || rawTitle.length > 250)
      return false;
    const forbiddenKeywords = [
      "sign in",
      "signin",
      "log in",
      "login",
      "sign up",
      "signup",
      "get started",
      "get gemini",
      "try gemini",
      "upgrade",
      "登录",
      "登入",
      "注册",
      "开始使用",
      "升级",
      "main menu",
      "主菜单",
      "menu",
      "菜单",
      "settings",
      "设置",
      "help",
      "帮助",
      "feedback",
      "反馈",
      "privacy",
      "隐私",
      "terms",
      "条款",
      "faq",
      "new chat",
      "新建对话",
      "新对话",
      "chats",
      "conversations",
      "pinned",
      "置顶",
      "recent",
      "最近",
      "activity",
      "活动记录",
      "gem manager",
      "gems",
      "extensions",
      "扩展",
      "updates",
      "更新",
      "google account",
      "google 账号",
      "google 帳號"
    ];
    for (const kw of forbiddenKeywords) {
      if (titleLower === kw)
        return false;
      if (titleLower.startsWith(kw + " ") || titleLower.endsWith(" " + kw))
        return false;
    }
    if (/\b(sign in|log in|signin|login|sign-in|log-in)\b/i.test(titleLower))
      return false;
    if (/^(登录|登入|注册)/.test(titleLower))
      return false;
    const forbiddenIds = new Set([
      "signin",
      "login",
      "auth",
      "settings",
      "help",
      "upgrade",
      "prompts",
      "apps",
      "privacy",
      "terms",
      "faq",
      "account",
      "home",
      "app",
      "new"
    ]);
    if (forbiddenIds.has(idLower))
      return false;
    return true;
  }
  function loadCachedUnifiedState() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.devices) && Array.isArray(parsed.sessions)) {
          parsed.geminiChats = (parsed.geminiChats || []).filter(isValidGeminiChatThread);
          return parsed;
        }
      }
    } catch {}
    const routeInfo = parseCurrentAgyRoute();
    return {
      activeEngine: window.location.hostname.includes("gemini.google.com") ? "gemini" : "antigravity",
      theme: getUnifiedTheme(),
      currentInstanceUuid: routeInfo.instanceUuid,
      currentCascadeId: routeInfo.cascadeId,
      currentProjectId: routeInfo.projectId,
      currentTab: routeInfo.tab,
      devices: [
        {
          uuid: "__remote_conversations__",
          displayName: "Cloud Environments",
          version: "cloud",
          status: "RUNNING",
          lastActiveMs: Date.now(),
          group: "remoteConversations"
        }
      ],
      sessions: [],
      geminiChats: [],
      lastSyncedMs: 0
    };
  }
  var currentState = loadCachedUnifiedState();
  function getUnifiedState() {
    return currentState;
  }
  function subscribeUnifiedState(listener) {
    stateListeners.add(listener);
    listener(currentState);
    return () => stateListeners.delete(listener);
  }
  function mergeUnifiedStates(base, incoming) {
    const mergedDevices = incoming.devices && incoming.devices.length > 0 ? incoming.devices : base.devices;
    const mergedSessions = incoming.sessions && incoming.sessions.length > 0 ? incoming.sessions : base.sessions;
    const mergedGeminiChats = incoming.geminiChats !== undefined ? incoming.geminiChats.filter(isValidGeminiChatThread) : (base.geminiChats || []).filter(isValidGeminiChatThread);
    return {
      ...base,
      ...incoming,
      devices: mergedDevices,
      sessions: mergedSessions,
      geminiChats: mergedGeminiChats,
      theme: incoming.theme || base.theme || getUnifiedTheme(),
      currentInstanceUuid: incoming.currentInstanceUuid || base.currentInstanceUuid,
      currentCascadeId: incoming.currentCascadeId || base.currentCascadeId,
      currentProjectId: incoming.currentProjectId || base.currentProjectId,
      currentTab: incoming.currentTab || base.currentTab
    };
  }
  function saveAndBroadcastState(partial) {
    const routeInfo = parseCurrentAgyRoute();
    currentState = mergeUnifiedStates(currentState, {
      ...partial,
      currentInstanceUuid: partial.currentInstanceUuid ?? (routeInfo.instanceUuid || currentState.currentInstanceUuid),
      currentCascadeId: partial.currentCascadeId ?? (routeInfo.cascadeId || currentState.currentCascadeId),
      currentProjectId: partial.currentProjectId ?? (routeInfo.projectId || currentState.currentProjectId),
      currentTab: partial.currentTab ?? routeInfo.tab,
      lastSyncedMs: Date.now()
    });
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(currentState));
    } catch {}
    for (const listener of stateListeners) {
      try {
        listener(currentState);
      } catch {}
    }
    syncStateToNativeHost(currentState);
  }
  var lastNativeSyncedJson = "";
  function syncStateToNativeHost(state) {
    const json = JSON.stringify(state);
    if (json === lastNativeSyncedJson)
      return;
    lastNativeSyncedJson = json;
    const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (tauriInvoke) {
      tauriInvoke("sync_unified_state", {
        stateJson: json
      }).catch(() => {});
    }
    const androidBridge = window.AndroidBridge;
    if (androidBridge?.syncUnifiedState) {
      try {
        androidBridge.syncUnifiedState(json);
      } catch {}
    }
  }
  async function pullStateFromNativeHost() {
    let rawJson = "";
    const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (tauriInvoke) {
      try {
        rawJson = await tauriInvoke("get_unified_state") || "";
      } catch {}
    } else {
      const androidBridge = window.AndroidBridge;
      if (androidBridge?.getUnifiedState) {
        try {
          rawJson = androidBridge.getUnifiedState() || "";
        } catch {}
      }
    }
    if (rawJson) {
      try {
        const hostState = JSON.parse(rawJson);
        if (hostState && typeof hostState === "object") {
          currentState = mergeUnifiedStates(currentState, hostState);
          if (currentState.theme === "dark" || currentState.theme === "light") {
            setUnifiedTheme(currentState.theme, false);
          }
          for (const listener of stateListeners) {
            listener(currentState);
          }
        }
      } catch {}
    }
    return currentState;
  }
  subscribeUnifiedTheme((theme) => {
    if (currentState.theme !== theme) {
      saveAndBroadcastState({ theme });
    }
  });
  window.__AGY_PULL_UNIFIED_STATE__ = () => {
    pullStateFromNativeHost();
  };
  function parseCurrentAgyRoute() {
    if (window.location.hostname.includes("gemini.google.com")) {
      return {
        surface: "gemini",
        instanceUuid: "",
        cascadeId: "",
        projectId: "",
        tab: "chat"
      };
    }
    const pathname = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const rMatch = /^\/r\/([^/?#]+)/.exec(pathname);
    if (rMatch) {
      const instanceUuid = decodeURIComponent(rMatch[1]);
      const rawChildPath = searchParams.get("p") || "";
      let cascadeId = "";
      let projectId = "default-cli-project";
      let tab = "chat";
      if (rawChildPath) {
        const qIdx = rawChildPath.indexOf("?");
        const childPathPart = qIdx >= 0 ? rawChildPath.slice(0, qIdx) : rawChildPath;
        const childQueryPart = qIdx >= 0 ? rawChildPath.slice(qIdx + 1) : "";
        const cMatch = /^\/?c\/([^/?#]+)/.exec(childPathPart);
        if (cMatch) {
          cascadeId = decodeURIComponent(cMatch[1]);
        }
        const childParams = new URLSearchParams(childQueryPart);
        projectId = childParams.get("project") || "default-cli-project";
        const rawTab = childParams.get("tab");
        if (rawTab === "review" || rawTab === "files" || rawTab === "terminal" || rawTab === "chat") {
          tab = rawTab;
        }
      }
      return {
        surface: "remote-control",
        instanceUuid,
        cascadeId,
        projectId,
        tab
      };
    }
    const remoteMatch = /^\/remote\/(?:c\/)?([^/?#]+)/.exec(pathname);
    const cascadeId = remoteMatch && remoteMatch[1] !== "agents" ? decodeURIComponent(remoteMatch[1]) : "";
    return {
      surface: "remote-agents",
      instanceUuid: "__remote_conversations__",
      cascadeId,
      projectId: searchParams.get("project") || "cloud",
      tab: "chat"
    };
  }
  async function proxyUnaryRpcToDevice(targetInstanceUuid, rpcPath, requestObj = {}) {
    const closureNs = globalThis.default_GoogleAntigravity;
    const ProxyCommandRequest = closureNs?.pk || closureNs?.R?.devtools_jetski_boq_api_proto?.ProxyCommandRequest;
    if (capturedRemoteControlComp && typeof capturedRemoteControlComp.selectedInstanceUuid === "function" && capturedRemoteControlComp.selectedInstanceUuid() === targetInstanceUuid && typeof capturedRemoteControlComp.proxyCommand === "function") {
      try {
        const payloadBytes = new TextEncoder().encode(JSON.stringify(requestObj));
        const { payload } = await capturedRemoteControlComp.proxyCommand(rpcPath, payloadBytes, {
          "Content-Type": "application/json"
        });
        const text = new TextDecoder("utf-8").decode(payload);
        return JSON.parse(text);
      } catch {}
    }
    if (!capturedGrpcClient?.client || !ProxyCommandRequest) {
      return null;
    }
    try {
      const req = new ProxyCommandRequest;
      req.setTargetInstanceUuid(targetInstanceUuid);
      req.setRpcPath(rpcPath);
      req.setPayload(new TextEncoder().encode(JSON.stringify(requestObj)));
      if (typeof req.getHeadersMap === "function") {
        req.getHeadersMap().set("Content-Type", "application/json");
      }
      const metadata = {
        "x-antigravity-test": "true"
      };
      if (capturedRemoteControlComp && typeof capturedRemoteControlComp.authMetadata === "function") {
        Object.assign(metadata, capturedRemoteControlComp.authMetadata());
      }
      const resp = await capturedGrpcClient.client.proxyCommand(req, metadata);
      const rawPayload = resp?.getPayload?.();
      let decodedText = "";
      if (rawPayload) {
        if (typeof rawPayload.asStringUtf8 === "function") {
          decodedText = rawPayload.asStringUtf8();
        } else if (typeof rawPayload.asUint8Array === "function") {
          decodedText = new TextDecoder("utf-8").decode(rawPayload.asUint8Array());
        } else if (rawPayload instanceof Uint8Array) {
          decodedText = new TextDecoder("utf-8").decode(rawPayload);
        } else if (typeof rawPayload === "string") {
          decodedText = atob(rawPayload);
        }
      }
      return decodedText ? JSON.parse(decodedText) : null;
    } catch {
      return null;
    }
  }
  function formatRelativeTime(ms) {
    if (!ms || ms <= 0)
      return "Recently";
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 60)
      return "Just now";
    if (diffSec < 3600)
      return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400)
      return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  }
  async function refreshAllMultiDeviceSessions() {
    const closureNs = globalThis.default_GoogleAntigravity;
    const devices = [
      {
        uuid: "__remote_conversations__",
        displayName: "Cloud Environments",
        version: "cloud",
        status: "RUNNING",
        lastActiveMs: Date.now(),
        group: "remoteConversations"
      }
    ];
    if (capturedRemoteControlComp && typeof capturedRemoteControlComp.instances === "function") {
      try {
        const rawList = capturedRemoteControlComp.instances() || [];
        for (const item of rawList) {
          if (!item?.uuid)
            continue;
          const statusStr = item.status === 1 || item.status === "RUNNING" ? "RUNNING" : item.status === 2 || item.status === "IDLE" ? "IDLE" : "DISCONNECTED";
          devices.push({
            uuid: item.uuid,
            displayName: item.metadata?.name || item.displayName || item.uuid.slice(0, 12),
            version: item.metadata?.version || "v2",
            status: statusStr,
            lastActiveMs: item.statusLastUpdatedAtMs || Date.now(),
            group: "instances"
          });
        }
      } catch {}
    } else if (capturedGrpcClient?.client && closureNs?.wk) {
      try {
        const req = new closureNs.wk;
        const resp = await capturedGrpcClient.client.listInstances(req, {
          "x-antigravity-test": "true"
        });
        const list = resp?.getInstancesList?.() || [];
        for (const inst of list) {
          const uuid = inst.getUuid?.();
          if (!uuid)
            continue;
          const meta = inst.getMetadata?.();
          const rawStatus = inst.getStatus?.();
          const statusStr = rawStatus === 1 ? "RUNNING" : rawStatus === 2 ? "IDLE" : "DISCONNECTED";
          const ts = inst.getStatusLastUpdatedAt?.();
          const updatedMs = ts ? Number(ts.getSeconds?.() || 0) * 1000 : Date.now();
          devices.push({
            uuid,
            displayName: meta?.getName?.() || uuid.slice(0, 12),
            version: meta?.getVersion?.() || "v2",
            status: statusStr,
            lastActiveMs: updatedMs,
            group: "instances"
          });
        }
      } catch {}
    }
    const routeInfo = parseCurrentAgyRoute();
    if (routeInfo.instanceUuid && routeInfo.instanceUuid !== "__remote_conversations__" && !devices.some((d) => d.uuid === routeInfo.instanceUuid)) {
      devices.push({
        uuid: routeInfo.instanceUuid,
        displayName: `Host (${routeInfo.instanceUuid.slice(0, 8)})`,
        version: routeInfo.instanceUuid.endsWith("-v2") ? "v2" : "v1",
        status: "RUNNING",
        lastActiveMs: Date.now(),
        group: "instances"
      });
    }
    const domInstanceNodes = document.querySelectorAll('[data-testid^="remote-control-instance-"], [data-testid^="instance-selector-item-"]');
    domInstanceNodes.forEach((node) => {
      const testId = node.getAttribute("data-testid") || "";
      const uuid = testId.replace("remote-control-instance-", "").replace("instance-selector-item-", "");
      if (uuid && !devices.some((d) => d.uuid === uuid)) {
        const label = (node.textContent || "").trim().split(`
`)[0] || uuid.slice(0, 12);
        devices.push({
          uuid,
          displayName: label,
          version: "v2",
          status: "RUNNING",
          lastActiveMs: Date.now(),
          group: "instances"
        });
      }
    });
    const sessionMap = new Map;
    for (const prev of currentState.sessions) {
      sessionMap.set(prev.id, prev);
    }
    if (routeInfo.cascadeId && routeInfo.instanceUuid) {
      const dev = devices.find((d) => d.uuid === routeInfo.instanceUuid);
      const id = `${routeInfo.instanceUuid}::${routeInfo.cascadeId}`;
      const existing = sessionMap.get(id);
      const pageTitle = document.title.replace(/\s*[-|]\s*Google Antigravity.*$/i, "").replace(/^Google Antigravity$/i, "").trim();
      sessionMap.set(id, {
        id,
        cascadeId: routeInfo.cascadeId,
        title: pageTitle || existing?.title || `Session ${routeInfo.cascadeId.slice(0, 8)}`,
        snippet: existing?.snippet || `Project: ${routeInfo.projectId}`,
        deviceUuid: routeInfo.instanceUuid,
        deviceName: dev?.displayName || `Host (${routeInfo.instanceUuid.slice(0, 8)})`,
        deviceStatus: dev?.status || "RUNNING",
        projectId: routeInfo.projectId,
        workspaceName: routeInfo.projectId,
        lastModifiedMs: Date.now(),
        lastModifiedLabel: "Active now",
        status: "running",
        activeTab: routeInfo.tab
      });
    }
    const onlineDevices = devices.filter((d) => d.group === "instances" && (d.status === "RUNNING" || d.status === "IDLE"));
    await Promise.allSettled(onlineDevices.map(async (device) => {
      const searchResp = await proxyUnaryRpcToDevice(device.uuid, "/exa.language_server_pb.LanguageServerService/SearchConversations", {
        query: "",
        limit: 25
      });
      const results = searchResp?.results || [];
      for (const item of results) {
        if (!item.cascadeId)
          continue;
        const id = `${device.uuid}::${item.cascadeId}`;
        let modifiedMs = Date.now();
        if (typeof item.lastModifiedTime === "string") {
          const parsed = Date.parse(item.lastModifiedTime);
          if (!Number.isNaN(parsed))
            modifiedMs = parsed;
        } else if (item.lastModifiedTime && typeof item.lastModifiedTime === "object") {
          const secs = Number(item.lastModifiedTime.seconds || 0);
          if (secs > 0)
            modifiedMs = secs * 1000;
        }
        const isCurrentActive = routeInfo.instanceUuid === device.uuid && routeInfo.cascadeId === item.cascadeId;
        sessionMap.set(id, {
          id,
          cascadeId: item.cascadeId,
          title: item.title?.trim() || `Session ${item.cascadeId.slice(0, 8)}`,
          snippet: item.snippet || item.workspaceName || "Remote Workspace",
          deviceUuid: device.uuid,
          deviceName: device.displayName,
          deviceStatus: device.status,
          projectId: item.workspaceName || "default-cli-project",
          workspaceName: item.workspaceName || "default-cli-project",
          lastModifiedMs: isCurrentActive ? Date.now() : modifiedMs,
          lastModifiedLabel: isCurrentActive ? "Active now" : formatRelativeTime(modifiedMs),
          status: isCurrentActive ? "running" : "idle",
          activeTab: isCurrentActive ? routeInfo.tab : "chat"
        });
      }
    }));
    if (capturedLsClient && typeof capturedLsClient.searchConversations === "function") {
      try {
        const cloudResp = await capturedLsClient.searchConversations({ query: "", limit: 20 });
        const results = cloudResp?.results || [];
        for (const item of results) {
          if (!item.cascadeId)
            continue;
          const id = `__remote_conversations__::${item.cascadeId}`;
          const modifiedMs = typeof item.lastModifiedTime === "string" ? Date.parse(item.lastModifiedTime) || Date.now() : Date.now();
          sessionMap.set(id, {
            id,
            cascadeId: item.cascadeId,
            title: item.title?.trim() || `Cloud Session ${item.cascadeId.slice(0, 8)}`,
            snippet: item.snippet || item.workspaceName || "Cloud Agent",
            deviceUuid: "__remote_conversations__",
            deviceName: "Cloud Environments",
            deviceStatus: "RUNNING",
            projectId: item.workspaceName || "cloud",
            workspaceName: item.workspaceName || "cloud",
            lastModifiedMs: modifiedMs,
            lastModifiedLabel: formatRelativeTime(modifiedMs),
            status: "idle",
            activeTab: "chat"
          });
        }
      } catch {}
    }
    const convLinks = document.querySelectorAll('a[href*="/c/"]');
    convLinks.forEach((a) => {
      const href = a.getAttribute("href") || "";
      const match = /\/c\/([^/?#]+)/.exec(href);
      if (!match)
        return;
      const cascadeId = decodeURIComponent(match[1]);
      const devUuid = routeInfo.instanceUuid || "__remote_conversations__";
      const dev = devices.find((d) => d.uuid === devUuid);
      const id = `${devUuid}::${cascadeId}`;
      if (!sessionMap.has(id)) {
        const title = (a.textContent || "").trim() || `Session ${cascadeId.slice(0, 8)}`;
        sessionMap.set(id, {
          id,
          cascadeId,
          title,
          deviceUuid: devUuid,
          deviceName: dev?.displayName || "Remote Host",
          deviceStatus: dev?.status || "RUNNING",
          projectId: routeInfo.projectId || "default-cli-project",
          workspaceName: routeInfo.projectId || "default-cli-project",
          lastModifiedMs: Date.now() - 60000,
          lastModifiedLabel: "Recent",
          status: "idle"
        });
      }
    });
    const mergedSessions = Array.from(sessionMap.values()).sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
    saveAndBroadcastState({
      devices,
      sessions: mergedSessions
    });
    ensureActiveConversationOpen();
    return currentState;
  }
  var lastAutoRedirectMs = 0;
  function ensureActiveConversationOpen() {
    if (!window.location.hostname.includes("antigravity.google.com"))
      return;
    const routeInfo = parseCurrentAgyRoute();
    if (routeInfo.cascadeId)
      return;
    if (currentState.sessions.length === 0)
      return;
    if (Date.now() - lastAutoRedirectMs < 2500)
      return;
    const preferred = currentState.sessions.find((s) => s.cascadeId === currentState.currentCascadeId && s.deviceUuid !== "__remote_conversations__") || currentState.sessions.find((s) => s.deviceUuid !== "__remote_conversations__") || currentState.sessions[0];
    if (preferred && preferred.cascadeId) {
      lastAutoRedirectMs = Date.now();
      openUnifiedSession(preferred, preferred.activeTab || "chat");
    }
  }
  function openUnifiedSession(session, tab = "chat") {
    const childPath = `c/${session.cascadeId}?project=${encodeURIComponent(session.projectId || "default-cli-project")}&tab=${tab}`;
    const targetUrl = session.deviceUuid === "__remote_conversations__" ? `https://antigravity.google.com/remote/c/${encodeURIComponent(session.cascadeId)}` : `https://antigravity.google.com/r/${encodeURIComponent(session.deviceUuid)}?p=${encodeURIComponent(childPath)}`;
    if (window.location.hostname.includes("gemini.google.com")) {
      const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
      if (tauriInvoke) {
        tauriInvoke("navigate_to_remote_session", { targetUrl });
        return;
      }
      const androidBridge = window.AndroidBridge;
      if (androidBridge?.navigateToRemoteSession) {
        androidBridge.navigateToRemoteSession(targetUrl);
        return;
      }
      window.location.assign(targetUrl);
      return;
    }
    const routeInfo = parseCurrentAgyRoute();
    if (routeInfo.surface === "remote-control" && routeInfo.instanceUuid === session.deviceUuid && capturedRemoteControlComp && typeof capturedRemoteControlComp.navigateIframeToChildPath === "function") {
      capturedRemoteControlComp.navigateIframeToChildPath(childPath);
      if (typeof capturedRemoteControlComp.handleUrlChanged === "function") {
        capturedRemoteControlComp.handleUrlChanged(childPath);
      }
      saveAndBroadcastState({
        currentInstanceUuid: session.deviceUuid,
        currentCascadeId: session.cascadeId,
        currentProjectId: session.projectId,
        currentTab: tab
      });
      return;
    }
    if (session.deviceUuid !== "__remote_conversations__" && capturedRemoteControlComp?.router && typeof capturedRemoteControlComp.router.navigate === "function") {
      capturedRemoteControlComp.router.navigate(["/r", session.deviceUuid], {
        queryParams: { p: childPath }
      });
      return;
    }
    window.location.assign(targetUrl);
  }
  function syncGeminiChatsFromDom() {
    if (!window.location.hostname.includes("gemini.google.com"))
      return;
    const threads = [];
    const seen = new Set;
    const selectors = [
      'bard-sidenav a[href*="/app/"]',
      'conversations-list a[href*="/app/"]',
      'chat-history-list a[href*="/app/"]',
      '[data-test-id*="conversation"] a[href*="/app/"]',
      'a[data-test-id*="conversation"]',
      'nav a[href*="/app/"]'
    ];
    const links = document.querySelectorAll(selectors.join(", "));
    links.forEach((a) => {
      const href = a.getAttribute("href") || "";
      const match = /\/app\/([a-zA-Z0-9_-]{10,})/.exec(href);
      if (!match)
        return;
      const id = match[1];
      if (seen.has(id))
        return;
      const titleNode = a.querySelector('.conversation-title, [data-test-id*="title"], [role="button"] span') || a;
      const rawTitle = (titleNode.textContent || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const candidate = {
        id,
        title: rawTitle.slice(0, 80),
        url: `https://gemini.google.com/app/${id}`,
        updatedAtMs: Date.now() - threads.length * 1000
      };
      if (!isValidGeminiChatThread(candidate))
        return;
      seen.add(id);
      threads.push(candidate);
    });
    if (threads.length > 0) {
      const currentIds = currentState.geminiChats.map((t) => t.id).join(",");
      const newThreads = threads.slice(0, 20);
      const newIds = newThreads.map((t) => t.id).join(",");
      if (currentIds !== newIds) {
        saveAndBroadcastState({
          activeEngine: "gemini",
          geminiChats: newThreads
        });
      }
    }
  }
  function syncUserProfileFromDom() {
    try {
      let name = "";
      let email = "";
      let avatarUrl = "";
      let tier = "";
      const accountBtn = document.querySelector('a[aria-label*="Google Account"], button[aria-label*="Google Account"], a[aria-label*="Google 账号"], button[aria-label*="Google 账号"], a[aria-label*="Google 帳號"], [data-ogsr-up]');
      if (accountBtn) {
        const label = accountBtn.getAttribute("aria-label") || "";
        const emailMatch = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/.exec(label);
        if (emailMatch) {
          email = emailMatch[1];
        }
        const nameMatch = /(?:Google Account|Google 账号|Google 帳號)[：:\s]+([^(\n]+)/i.exec(label);
        if (nameMatch) {
          name = nameMatch[1].trim();
        }
        const img = accountBtn.querySelector('img[src*="googleusercontent.com"], img');
        if (img?.src) {
          avatarUrl = img.src;
        }
      }
      if (!avatarUrl) {
        const avatarImg = document.querySelector('img[src*="googleusercontent.com/a/"], img[src*="googleusercontent.com/ogw/"]');
        if (avatarImg?.src) {
          avatarUrl = avatarImg.src;
        }
      }
      if (document.querySelector('gemini-advanced-badge, [data-test-id="gemini-advanced"], .advanced-badge')) {
        tier = "Gemini Advanced";
      } else if (window.location.hostname.includes("antigravity.google.com")) {
        tier = "Google AI · Dual Engine";
      }
      if (name || email || avatarUrl) {
        const current = getUnifiedState();
        const existing = current.userProfile;
        if (!existing || existing.email !== email || existing.name !== name || existing.avatarUrl !== avatarUrl) {
          saveAndBroadcastState({
            userProfile: {
              name: name || existing?.name || "Google User",
              email: email || existing?.email || "",
              avatarUrl: avatarUrl || existing?.avatarUrl,
              tier: tier || existing?.tier || "Google AI · Dual Engine"
            }
          });
        }
      }
    } catch {}
  }

  // src/inject/claude-bottom-sheets.ts
  var STORAGE_PERM_KEY = "__agy_sticky_permission_mode__";
  function loadStickyPermissionMode() {
    try {
      const saved = localStorage.getItem(STORAGE_PERM_KEY);
      if (saved === "request-review" || saved === "accept-edits" || saved === "proceed-in-sandbox" || saved === "always-proceed") {
        return saved;
      }
    } catch {}
    return "request-review";
  }
  var sessionState = {
    stickyPermissionMode: loadStickyPermissionMode(),
    pendingApproval: null,
    planTitle: "implementation_plan.md",
    planContent: "",
    latestDiffTitle: "Workspace Changes",
    latestDiffContent: "",
    shellOutput: [],
    toolCalls: [],
    thinkingBlocks: [],
    subagents: [
      { name: "main-agent", role: "Coordinator (Antigravity Remote)", status: "working" }
    ],
    activeModel: "Gemini 4 Argon"
  };
  var SHEET_CSS = `
/* Modern Web Guidance: dialog scroll containment & light-dark color tokens */
:root {
  --agy-surface-light: #ffffff;
  --agy-surface-dark: #13151a;
  --agy-surface-elev-light: #f3f5f8;
  --agy-surface-elev-dark: #1d2028;
  --agy-text-light: #111827;
  --agy-text-dark: #f3f4f6;
  --agy-muted-light: #5f6672;
  --agy-muted-dark: #9ca3af;
  --agy-border-light: rgb(0 0 0 / 0.1);
  --agy-border-dark: rgb(255 255 255 / 0.12);
  --agy-accent-light: #1a73e8;
  --agy-accent-dark: #7cacf8;
  --agy-danger-light: #d93025;
  --agy-danger-dark: #f28b82;
  --agy-success-light: #188038;
  --agy-success-dark: #81c995;

  --agy-surface: var(--agy-surface-light);
  --agy-surface-elev: var(--agy-surface-elev-light);
  --agy-text: var(--agy-text-light);
  --agy-muted: var(--agy-muted-light);
  --agy-border: var(--agy-border-light);
  --agy-accent: var(--agy-accent-light);
  --agy-danger: var(--agy-danger-light);
  --agy-success: var(--agy-success-light);

  @media (prefers-color-scheme: dark) {
    --agy-surface: var(--agy-surface-dark);
    --agy-surface-elev: var(--agy-surface-elev-dark);
    --agy-text: var(--agy-text-dark);
    --agy-muted: var(--agy-muted-dark);
    --agy-border: var(--agy-border-dark);
    --agy-accent: var(--agy-accent-dark);
    --agy-danger: var(--agy-danger-dark);
    --agy-success: var(--agy-success-dark);
  }

  @supports (color: light-dark(white, black)) {
    --agy-surface: light-dark(var(--agy-surface-light), var(--agy-surface-dark));
    --agy-surface-elev: light-dark(var(--agy-surface-elev-light), var(--agy-surface-elev-dark));
    --agy-text: light-dark(var(--agy-text-light), var(--agy-text-dark));
    --agy-muted: light-dark(var(--agy-muted-light), var(--agy-muted-dark));
    --agy-border: light-dark(var(--agy-border-light), var(--agy-border-dark));
    --agy-accent: light-dark(var(--agy-accent-light), var(--agy-accent-dark));
    --agy-danger: light-dark(var(--agy-danger-light), var(--agy-danger-dark));
    --agy-success: light-dark(var(--agy-success-light), var(--agy-success-dark));
  }

  color-scheme: light dark;
}

html[data-agy-unified-theme="light"] {
  color-scheme: light;
  --agy-surface: var(--agy-surface-light);
  --agy-surface-elev: var(--agy-surface-elev-light);
  --agy-text: var(--agy-text-light);
  --agy-muted: var(--agy-muted-light);
  --agy-border: var(--agy-border-light);
  --agy-accent: var(--agy-accent-light);
  --agy-danger: var(--agy-danger-light);
  --agy-success: var(--agy-success-light);
}

html[data-agy-unified-theme="dark"] {
  color-scheme: dark;
  --agy-surface: var(--agy-surface-dark);
  --agy-surface-elev: var(--agy-surface-elev-dark);
  --agy-text: var(--agy-text-dark);
  --agy-muted: var(--agy-muted-dark);
  --agy-border: var(--agy-border-dark);
  --agy-accent: var(--agy-accent-dark);
  --agy-danger: var(--agy-danger-dark);
  --agy-success: var(--agy-success-dark);
}

dialog.agy-bottom-sheet:modal {
  overscroll-behavior: contain;
}

dialog.agy-bottom-sheet::backdrop {
  overflow: hidden;
  overscroll-behavior: contain;
  background: rgb(0 0 0 / 0.55);
  backdrop-filter: blur(4px);
}

dialog.agy-bottom-sheet {
  inset: auto 0 0 0;
  width: 100%;
  max-width: 48rem;
  max-height: 86dvh;
  margin: auto auto 0 auto;
  padding: 0;
  border: 1px solid var(--agy-border);
  border-bottom: 0;
  border-radius: 20px 20px 0 0;
  background: var(--agy-surface);
  color: var(--agy-text);
  box-shadow: 0 -12px 40px rgb(0 0 0 / 0.35);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

/* Modern Web Guidance: Desktop PC adaptive centered dialog layout */
@media (min-width: 768px) and (pointer: fine), (min-width: 1024px) {
  dialog.agy-bottom-sheet {
    inset: 0 !important;
    margin: auto !important;
    width: min(780px, 92vw) !important;
    max-height: 84vh !important;
    border-radius: 16px !important;
    border: 1px solid var(--agy-border) !important;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45) !important;
    transform: none !important;
  }

  .agy-sheet-handle-bar {
    display: none !important;
  }

  @media (prefers-reduced-motion: no-preference) {
    dialog.agy-bottom-sheet[open] {
      animation: agy-desktop-modal-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both !important;
    }
  }

  @keyframes agy-desktop-modal-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
}

html[data-agy-form-factor="desktop"] dialog.agy-bottom-sheet {
  inset: 0 !important;
  margin: auto !important;
  width: min(780px, 92vw) !important;
  max-height: 84vh !important;
  border-radius: 16px !important;
  border: 1px solid var(--agy-border) !important;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45) !important;
  transform: none !important;
}

html[data-agy-form-factor="desktop"] .agy-sheet-handle-bar {
  display: none !important;
}

.agy-sheet-body {
  scrollbar-width: thin;
  scrollbar-color: var(--agy-border) transparent;
}

.agy-sheet-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.agy-sheet-body::-webkit-scrollbar-thumb {
  background: var(--agy-border);
  border-radius: 999px;
}

dialog.agy-bottom-sheet[open] {
  display: flex;
  flex-direction: column;
}

@media (prefers-reduced-motion: no-preference) {
  dialog.agy-bottom-sheet[open] {
    animation: agy-sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}

@keyframes agy-sheet-up {
  from {
    translate: 0 100%;
  }
}

.agy-sheet-handle-bar {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}

.agy-sheet-pill {
  width: 40px;
  height: 4px;
  border-radius: 999px;
  background: var(--agy-muted);
  opacity: 0.45;
}

.agy-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px 12px;
  border-bottom: 1px solid var(--agy-border);
}

.agy-sheet-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 650;
  text-wrap: balance;
}

.agy-sheet-body {
  padding: 16px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.agy-sheet-footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 18px max(14px, env(safe-area-inset-bottom, 14px));
  border-top: 1px solid var(--agy-border);
  background: var(--agy-surface-elev);
}

.agy-btn {
  min-block-size: var(--target-size, 44px);
  min-inline-size: var(--target-size, 44px);
  padding: 8px 14px;
  border-radius: 12px;
  border: 1px solid var(--agy-border);
  background: var(--agy-surface);
  color: var(--agy-text);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: box-shadow 150ms ease-out, scale 150ms ease-out;
}

.agy-btn:hover {
  box-shadow: 0 2px 8px rgb(0 0 0 / 0.2);
}

.agy-btn:active {
  scale: 0.97;
}

.agy-btn:focus-visible {
  outline: 2px solid CanvasText;
  outline-offset: 3px;
}

.agy-btn-primary {
  background: var(--agy-accent);
  color: #fff;
  border-color: transparent;
  flex: 1 1 auto;
}

@media (prefers-color-scheme: dark) {
  .agy-btn-primary {
    color: #081226;
  }
}

.agy-btn-danger {
  background: rgb(217 48 37 / 0.14);
  color: var(--agy-danger);
  border-color: var(--agy-danger);
}

.agy-btn-success {
  background: var(--agy-success);
  color: #071f10;
  border-color: transparent;
  flex: 1 1 auto;
}

.agy-code-box {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.5;
  background: #0d1117;
  color: #e6edf3;
  padding: 12px 14px;
  border-radius: 12px;
  overflow-x: auto;
  white-space: pre;
  border: 1px solid rgb(255 255 255 / 0.12);
}

.agy-code-box.is-wrapped {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.agy-diff-add {
  background: rgb(46 160 67 / 0.2);
  color: #7ee787;
  display: block;
  padding: 1px 6px;
}

.agy-diff-del {
  background: rgb(248 81 73 / 0.2);
  color: #ffa198;
  display: block;
  padding: 1px 6px;
}

.agy-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 650;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
}

.agy-badge-danger {
  background: rgb(217 48 37 / 0.18);
  color: var(--agy-danger);
  border-color: var(--agy-danger);
}

.agy-card-item {
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agy-sheet-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 8px 18px 0;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}

.agy-sheet-tab {
  position: relative;
  flex: none;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--agy-muted);
  font-size: 0.84rem;
  font-weight: 600;
  cursor: pointer;
  scroll-snap-align: start;
}

.agy-sheet-tab[aria-selected="true"] {
  color: var(--agy-accent);
}

.agy-sheet-tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  border-block-end: 3px solid var(--agy-accent);
}

.agy-comment-input {
  width: 100%;
  min-block-size: 44px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--agy-border);
  background: var(--agy-surface);
  color: var(--agy-text);
  font-size: 0.9rem;
  box-sizing: border-box;
}

/* Inset Grouped Settings & Account Center (Claude / Apple Grade) */
.agy-settings-container {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 24px;
}

.agy-settings-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agy-settings-section-title {
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--agy-muted);
  padding: 0 4px;
}

.agy-settings-group {
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  border-radius: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.agy-settings-row {
  min-height: 52px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  text-decoration: none;
  background: transparent;
  border: 0;
  color: var(--agy-text);
  font-family: inherit;
  position: relative;
  box-sizing: border-box;
}

.agy-settings-row + .agy-settings-row::before {
  content: "";
  position: absolute;
  top: 0;
  left: 54px;
  right: 0;
  height: 1px;
  background: var(--agy-border);
  opacity: 0.6;
}

.agy-settings-row.agy-interactive {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

.agy-settings-row.agy-interactive:active {
  background: light-dark(rgba(0, 0, 0, 0.05), rgba(255, 255, 255, 0.06));
}

.agy-settings-row-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  flex: 1 1 auto;
}

.agy-settings-icon {
  width: 32px;
  height: 32px;
  border-radius: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
}

.agy-settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.agy-settings-row-title {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--agy-text);
  line-height: 1.3;
}

.agy-settings-row-desc {
  font-size: 0.74rem;
  color: var(--agy-muted);
  line-height: 1.25;
}

.agy-settings-row-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.agy-settings-row-value {
  font-size: 0.82rem;
  color: var(--agy-muted);
  font-weight: 500;
}

.agy-settings-chevron {
  color: var(--agy-muted);
  font-size: 1.1rem;
  opacity: 0.55;
  margin-left: 2px;
  line-height: 1;
}

.agy-settings-segmented {
  display: flex;
  background: var(--agy-surface);
  border: 1px solid var(--agy-border);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
}

.agy-settings-segment-btn {
  padding: 5px 12px;
  border-radius: 999px;
  border: 0;
  background: transparent;
  color: var(--agy-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  white-space: nowrap;
  font-family: inherit;
}

.agy-settings-segment-btn[aria-checked="true"] {
  background: var(--agy-surface-elev);
  color: var(--agy-accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

.agy-account-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: var(--agy-surface-elev);
  border: 1px solid var(--agy-border);
  border-radius: 16px;
}

.agy-account-avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(66, 133, 244, 0.25);
  border: 2px solid rgba(66, 133, 244, 0.5);
}

.agy-account-avatar-placeholder {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4285f4 0%, #a855f7 100%);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(66, 133, 244, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.2);
}
`;
  var sheetDialog = null;
  var currentDestination = "ApprovalDiffDetail";
  function isHighRiskCommand(text) {
    return /\b(rm\s+-rf|sudo\s+|git\s+push\s+--force|git\s+reset\s+--hard|chmod\s+777|mkfs|dd\s+if=)\b/i.test(text);
  }
  function sendTextToPageComposer(text, autoSubmit = false) {
    const selectors = [
      "textarea",
      '[contenteditable="true"][role="textbox"]',
      'rich-textarea [contenteditable="true"]',
      '[contenteditable="true"]'
    ];
    for (const sel of selectors) {
      const nodes = Array.from(document.querySelectorAll(sel));
      const target = nodes.find((n) => !n.closest("dialog.agy-bottom-sheet") && n.offsetParent !== null);
      if (!target)
        continue;
      target.focus();
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
        const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        if (nativeSetter) {
          nativeSetter.call(target, text);
        } else {
          target.value = text;
        }
        target.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        target.textContent = text;
        target.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      }
      if (autoSubmit) {
        setTimeout(() => {
          const sendBtn = Array.from(document.querySelectorAll("button")).find((b) => !b.closest("dialog.agy-bottom-sheet") && /send|submit|发送|run/i.test(`${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`));
          if (sendBtn) {
            sendBtn.click();
          } else {
            target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
          }
        }, 80);
      }
      return true;
    }
    const hubFrame = document.querySelector('iframe[src*="antigravity.static.usercontent.goog"], ga-remote-control iframe');
    if (hubFrame?.contentWindow) {
      try {
        const targetOrigin = new URL(hubFrame.src).origin;
        hubFrame.contentWindow.postMessage({
          type: "AGY_GUEST_COMMAND",
          action: "INSERT_COMPOSER",
          text,
          autoSubmit
        }, targetOrigin);
        return true;
      } catch {}
    }
    return false;
  }
  function executePermissionDecision(decision, comment) {
    const pending = sessionState.pendingApproval;
    sendToNative({
      type: "PERMISSION_DECISION",
      decision,
      comment,
      requestId: pending?.requestId ?? "latest"
    });
    if (decision === "APPROVE") {
      if (pending?.approveBtn) {
        pending.approveBtn.click();
      } else {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => !b.closest("dialog.agy-bottom-sheet") && /\b(approve|allow|proceed|accept|run|confirm|批准|允许|继续)\b/i.test(`${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`));
        btn?.click();
      }
      sessionState.pendingApproval = null;
    } else {
      if (pending?.denyBtn) {
        pending.denyBtn.click();
      } else {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => !b.closest("dialog.agy-bottom-sheet") && /\b(deny|reject|cancel|decline|拒绝|取消)\b/i.test(`${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`));
        btn?.click();
      }
      sessionState.pendingApproval = null;
      if (decision === "DENY_WITH_COMMENT" && comment && comment.trim().length > 0) {
        sendTextToPageComposer(`[Rejected Tool Action] 请按以下要求调整：${comment.trim()}`, true);
      }
    }
    const hubFrame = document.querySelector('iframe[src*="antigravity.static.usercontent.goog"], ga-remote-control iframe');
    if (hubFrame?.contentWindow) {
      try {
        const targetOrigin = new URL(hubFrame.src).origin;
        hubFrame.contentWindow.postMessage({
          type: "AGY_GUEST_COMMAND",
          action: "PERMISSION_DECISION",
          decision,
          comment
        }, targetOrigin);
      } catch {}
    }
    if (sheetDialog?.open && currentDestination === "ApprovalDiffDetail") {
      sheetDialog.close("decision");
    }
  }
  function attachLightDismissFallback(dialog) {
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (e) => {
        const r = dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (e) => {
        pressedOutside = outside(e);
      });
      dialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && outside(e))
          dialog.close();
      });
    }
  }
  function ensureSheetDialog() {
    adoptStyleSheet("agy-bottom-sheets", SHEET_CSS);
    if (sheetDialog && document.body.contains(sheetDialog)) {
      return sheetDialog;
    }
    const dlg = el("dialog", {
      className: "agy-bottom-sheet",
      id: "agy-claude-bottom-sheet",
      aria: { labelledby: "agy-sheet-heading" },
      attrs: { closedby: "any" }
    });
    dlg.addEventListener("close", () => {
      dlg.returnValue = "";
    });
    attachLightDismissFallback(dlg);
    document.body.appendChild(dlg);
    sheetDialog = dlg;
    return dlg;
  }
  var SHEET_TABS = [
    { id: "ApprovalDiffDetail", label: "\uD83D\uDEE1️ 审批 (Approval)" },
    { id: "PermissionModeSelection", label: "⚙️ 权限模式" },
    { id: "PlanView", label: "\uD83D\uDCCB 计划 (Plan)" },
    { id: "DiffView", label: "\uD83D\uDD0D 代码 Diff" },
    { id: "BackgroundShellOutput", label: "\uD83D\uDCBB 终端 & 任务" },
    { id: "CollapsedToolCalls", label: "\uD83D\uDEE0️ 工具时间轴" },
    { id: "ViewThinking", label: "\uD83E\uDDE0 思考链" },
    { id: "TaskList", label: "\uD83E\uDD16 子智能体" },
    { id: "DeviceSessions", label: "\uD83D\uDDA5️ 设备 & 账号" }
  ];
  function openClaudeBottomSheet(destination) {
    currentDestination = destination;
    const dlg = ensureSheetDialog();
    renderSheetContents(dlg, destination);
    if (!dlg.open) {
      dlg.showModal();
    }
  }
  function renderSheetContents(dlg, destination) {
    clearChildren(dlg);
    const handleBar = el("div", { className: "agy-sheet-handle-bar" }, el("div", { className: "agy-sheet-pill" }));
    const tabBar = el("div", {
      className: "agy-sheet-tabs",
      attrs: { focusgroup: "tablist nomemory" },
      aria: { label: "Claude Code Remote Bottom Sheets" }
    }, ...SHEET_TABS.map((t) => el("button", {
      type: "button",
      className: "agy-sheet-tab",
      role: "tab",
      aria: { selected: String(t.id === destination) },
      attrs: t.id === destination ? { focusgroupstart: "" } : {},
      text: t.label,
      onClick: () => renderSheetContents(dlg, t.id)
    })));
    const titleMap = {
      ApprovalDiffDetail: "权限审批与命令详情 (ApprovalDiffDetail)",
      PermissionModeSelection: "会话权限策略 (PermissionModeSelection)",
      PlanView: "实施方案与构件阅读器 (PlanView & Artifacts)",
      DiffView: "代码变更单列检视器 (DiffView & WorkspaceFile)",
      BackgroundShellOutput: "实时终端流与后台任务 (BackgroundShellOutput)",
      CollapsedToolCalls: "工具调用时间轴 (CollapsedToolCalls)",
      ViewThinking: "模型推理思考链 (ViewThinking)",
      TaskList: "子智能体与协作状态 (Subagents & Swarm)",
      DeviceSessions: "⚡ 远程工作台与会话",
      Settings: "⚙️ 应用设置与账号中心"
    };
    const closeBtn = el("button", {
      type: "button",
      className: "agy-btn",
      aria: { label: "关闭面板" },
      text: "✕",
      onClick: () => dlg.close("cancel")
    });
    const body = el("div", { className: "agy-sheet-body" });
    const footer = el("div", { className: "agy-sheet-footer" });
    if (destination === "Settings") {
      const headerTitle = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0" } }, el("h2", {
        className: "agy-sheet-title",
        id: "agy-sheet-heading",
        style: { fontSize: "1.16rem", fontWeight: "750", letterSpacing: "-0.02em" },
        text: "设置与账号"
      }), el("span", {
        className: "agy-badge",
        style: {
          background: "light-dark(rgba(26, 115, 232, 0.1), rgba(124, 172, 248, 0.16))",
          color: "var(--agy-accent)",
          fontWeight: "650",
          fontSize: "0.72rem",
          padding: "2px 8px"
        },
        text: "v0.1.0"
      }));
      const setCloseBtn = el("button", {
        type: "button",
        className: "agy-btn",
        style: {
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0",
          fontSize: "15px",
          background: "var(--agy-surface-elev)",
          border: "1px solid var(--agy-border)",
          color: "var(--agy-muted)",
          cursor: "pointer",
          flexShrink: "0"
        },
        aria: { label: "关闭设置" },
        text: "✕",
        onClick: () => dlg.close("cancel")
      });
      const setHeader = el("div", { className: "agy-sheet-header" }, headerTitle, setCloseBtn);
      populateSettingsSheet(body, footer, dlg);
      dlg.append(handleBar, setHeader, body, footer);
      return;
    }
    if (destination === "DeviceSessions") {
      const unified = getUnifiedState();
      const onlineCount = unified.devices.filter((d) => d.status === "RUNNING").length;
      const headerTitle = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0" } }, el("h2", { className: "agy-sheet-title", id: "agy-sheet-heading", text: "⚡ 远程工作台与会话" }), el("span", {
        className: "agy-badge",
        style: {
          background: "light-dark(rgba(26, 115, 232, 0.1), rgba(124, 172, 248, 0.16))",
          color: "var(--agy-accent)",
          fontWeight: "650",
          fontSize: "0.75rem"
        },
        text: `${onlineCount} 在线 · ${unified.sessions.length} 个会话`
      }));
      const devHeader = el("div", { className: "agy-sheet-header" }, headerTitle, closeBtn);
      populateDeviceSessionsSheet(body, footer, dlg);
      dlg.append(handleBar, devHeader, body, footer);
      return;
    }
    const header = el("div", { className: "agy-sheet-header" }, el("h2", { className: "agy-sheet-title", id: "agy-sheet-heading", text: titleMap[destination] }), closeBtn);
    switch (destination) {
      case "ApprovalDiffDetail":
        populateApprovalSheet(body, footer);
        break;
      case "PermissionModeSelection":
        populatePermissionModeSheet(body, footer, dlg);
        break;
      case "PlanView":
        populatePlanSheet(body, footer, dlg);
        break;
      case "DiffView":
        populateDiffSheet(body, footer);
        break;
      case "BackgroundShellOutput":
        populateShellSheet(body, footer);
        break;
      case "CollapsedToolCalls":
        populateToolCallsSheet(body, footer);
        break;
      case "ViewThinking":
        populateThinkingSheet(body, footer);
        break;
      case "TaskList":
        populateTaskListSheet(body, footer);
        break;
    }
    dlg.append(handleBar, tabBar, header, body, footer);
  }
  function populateApprovalSheet(body, footer) {
    const pending = sessionState.pendingApproval;
    const cmdText = pending?.commandOrDiff || `当前无阻塞中的高危审批请求。
当远端 Agent 请求执行终端命令或修改受保护文件时，此抽屉会自动弹出完整（无 100 字符截断）的命令与 Diff 预览。`;
    const highRisk = isHighRiskCommand(cmdText);
    const metaRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" } }, el("span", {
      className: "agy-badge",
      text: `\uD83D\uDEE0️ 工具: ${pending?.toolName ?? "Terminal / File Action"}`
    }), el("span", {
      className: "agy-badge",
      text: `\uD83D\uDD12 当前模式: ${sessionState.stickyPermissionMode}`
    }), highRisk ? el("span", {
      className: "agy-badge agy-badge-danger",
      text: "⚠️ 检测到高危命令特征 (rm/sudo/force)"
    }) : null);
    let wrapped = true;
    const codeBox = el("pre", {
      className: "agy-code-box is-wrapped",
      text: cmdText
    });
    const wrapToggle = el("button", {
      type: "button",
      className: "agy-btn",
      text: "⇄ 切换折行 / 横向滚动",
      onClick: () => {
        wrapped = !wrapped;
        codeBox.classList.toggle("is-wrapped", wrapped);
      }
    });
    const commentInput = el("input", {
      type: "text",
      className: "agy-comment-input",
      placeholder: "附言拒绝 (ccr_comment)：告诉 Agent 为什么拒绝或如何修改...",
      aria: { label: "拒绝并附言指导 Agent" }
    });
    body.append(metaRow, wrapToggle, codeBox, commentInput);
    const approveBtn = el("button", {
      type: "button",
      className: "agy-btn agy-btn-success",
      autofocus: !highRisk,
      text: "✅ 批准本次 (Approve)",
      onClick: () => executePermissionDecision("APPROVE")
    });
    const stickyApproveBtn = el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "⚡ 开启自动放行 (Accept Edits)",
      onClick: () => {
        sessionState.stickyPermissionMode = "accept-edits";
        try {
          localStorage.setItem(STORAGE_PERM_KEY, "accept-edits");
        } catch {}
        executePermissionDecision("APPROVE");
      }
    });
    const denyWithCommentBtn = el("button", {
      type: "button",
      className: "agy-btn agy-btn-danger",
      autofocus: highRisk,
      text: "\uD83D\uDCAC 拒绝并发送附言",
      onClick: () => {
        const c = commentInput.value.trim();
        if (c.length > 0) {
          executePermissionDecision("DENY_WITH_COMMENT", c);
        } else {
          executePermissionDecision("DENY");
        }
      }
    });
    footer.append(approveBtn, stickyApproveBtn, denyWithCommentBtn);
  }
  function populatePermissionModeSheet(body, footer, dlg) {
    const modes = [
      {
        id: "request-review",
        title: "\uD83D\uDEE1️ Request Review（默认逐项审批）",
        desc: "Agent 执行终端命令或外部写入前弹出底部抽屉与锁屏通知，由你确认。"
      },
      {
        id: "accept-edits",
        title: "✍️ Accept Safe Edits（对标 claude --permission-mode acceptEdits）",
        desc: "自动放行常规代码文件编辑与安全读取，仅拦截高危命令（如 rm -rf、git push）。"
      },
      {
        id: "proceed-in-sandbox",
        title: "\uD83D\uDCE6 Proceed in Sandbox（终端沙箱内自动放行）",
        desc: "在 Antigravity 隔离沙箱环境内自动批准命令执行，兼顾效率与边界安全。"
      },
      {
        id: "always-proceed",
        title: "\uD83D\uDE80 Always Proceed（全自动无人值守模式 /goal）",
        desc: "自动点击所有常规审批弹窗，适合在手机端挂机运行长耗时任务。"
      }
    ];
    for (const m of modes) {
      const active = sessionState.stickyPermissionMode === m.id;
      const card = el("div", {
        className: "agy-card-item",
        style: {
          borderColor: active ? "var(--agy-accent)" : "var(--agy-border)",
          cursor: "pointer"
        },
        onClick: () => {
          sessionState.stickyPermissionMode = m.id;
          try {
            localStorage.setItem(STORAGE_PERM_KEY, m.id);
          } catch {}
          renderSheetContents(dlg, "PermissionModeSelection");
        }
      }, el("div", { style: { display: "flex", justifyContent: "space-between", fontWeight: "650" } }, el("span", { text: m.title }), el("span", { text: active ? "✅ 当前生效" : "点击启用" })), el("div", { style: { fontSize: "0.83rem", color: "var(--agy-muted)" }, text: m.desc }));
      body.appendChild(card);
    }
    footer.appendChild(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "完成设置",
      onClick: () => dlg.close()
    }));
  }
  function populatePlanSheet(body, footer, dlg) {
    const content = sessionState.planContent || extractLatestArtifactOrPlanFromDom() || `暂未在当前视图捕获到 Plan / Artifact 文档。
你可以点击下方「发送 /plan 指令」让 Antigravity 生成结构化实施方案。`;
    body.append(el("div", {
      className: "agy-badge",
      text: `\uD83D\uDCC4 ${sessionState.planTitle}`
    }), el("pre", {
      className: "agy-code-box is-wrapped",
      text: content
    }));
    footer.append(el("button", {
      type: "button",
      className: "agy-btn agy-btn-success",
      text: "✅ Proceed (批准方案并开始执行)",
      onClick: () => {
        executePermissionDecision("APPROVE");
        sendTextToPageComposer("Proceed with the plan.", true);
        dlg.close();
      }
    }), el("button", {
      type: "button",
      className: "agy-btn",
      text: "\uD83D\uDCD0 触发 /plan",
      onClick: () => {
        sendTextToPageComposer("/plan ", false);
        dlg.close();
      }
    }));
  }
  function populateDiffSheet(body, footer) {
    const rawDiff = sessionState.latestDiffContent || extractLatestCodeOrDiffFromDom() || `--- a/src/main.ts
+++ b/src/main.ts
@@ -1,4 +1,6 @@
 // 点击页面任意代码块或 Diff 区域即可在此全屏单列检视
-const legacyMode = true;
+const claudeBottomSheetMode = true;
+const sharedGoogleAuth = true;`;
    const diffContainer = el("div", { className: "agy-code-box" });
    for (const line of rawDiff.split(`
`)) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        diffContainer.appendChild(el("span", { className: "agy-diff-add", text: line }));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        diffContainer.appendChild(el("span", { className: "agy-diff-del", text: line }));
      } else {
        diffContainer.appendChild(el("div", { text: line }));
      }
    }
    body.append(el("div", { className: "agy-badge", text: `\uD83D\uDCC2 ${sessionState.latestDiffTitle}` }), diffContainer);
    footer.append(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "\uD83D\uDCCB 复制代码 / Diff",
      onClick: () => {
        navigator.clipboard?.writeText(rawDiff);
      }
    }), el("button", {
      type: "button",
      className: "agy-btn",
      text: "\uD83D\uDD04 重新扫描页面代码块",
      onClick: () => {
        sessionState.latestDiffContent = extractLatestCodeOrDiffFromDom();
        if (sheetDialog)
          renderSheetContents(sheetDialog, "DiffView");
      }
    }));
  }
  function populateShellSheet(body, footer) {
    const logs = sessionState.shellOutput.length > 0 ? sessionState.shellOutput.join(`

`) : `$ agy remote status
[OK] Connected to Workstation via Outbound Relay
[OK] Terminal stream ready. Any command output from the agent will stream here.`;
    body.append(el("div", { className: "agy-badge", text: "\uD83D\uDDA5️ BackgroundShellOutput & Terminals" }), el("pre", { className: "agy-code-box", text: logs }));
    footer.append(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "\uD83D\uDCCB 复制终端日志发给 Agent 排查",
      onClick: () => {
        sendTextToPageComposer(`请帮我分析以下终端输出：
\`\`\`
${logs.slice(-1500)}
\`\`\``, false);
        sheetDialog?.close();
      }
    }));
  }
  function populateToolCallsSheet(body, footer) {
    if (sessionState.toolCalls.length === 0) {
      body.appendChild(el("div", { className: "agy-card-item" }, el("strong", { text: "\uD83D\uDEE0️ 暂无折叠的工具调用记录" }), el("span", {
        style: { fontSize: "0.84rem", color: "var(--agy-muted)" },
        text: "当 Agent 执行 read_file、run_command、edit_file 等工具时，主聊天流会自动折叠冗余日志并汇总到此处。"
      })));
    } else {
      for (const tc of sessionState.toolCalls) {
        body.appendChild(el("details", { className: "agy-card-item" }, el("summary", { style: { cursor: "pointer", fontWeight: "650" } }, `${tc.status === "done" ? "✅" : "⏳"} ${tc.name} — ${tc.summary} (${tc.timestamp})`), el("pre", { className: "agy-code-box is-wrapped", text: tc.detail })));
      }
    }
    footer.appendChild(el("button", {
      type: "button",
      className: "agy-btn",
      text: "清空记录",
      onClick: () => {
        sessionState.toolCalls = [];
        if (sheetDialog)
          renderSheetContents(sheetDialog, "CollapsedToolCalls");
      }
    }));
  }
  function populateThinkingSheet(body, footer) {
    const thoughts = sessionState.thinkingBlocks.length > 0 ? sessionState.thinkingBlocks.join(`

───

`) : "当模型输出 Thinking 推理过程时，主界面会自动将其折叠为紧凑胶囊，点击即可在此独立抽屉中沉浸式阅读，避免打断手机端主对话流。";
    body.append(el("div", { className: "agy-badge", text: "\uD83E\uDDE0 Model Reasoning / Chain-of-Thought" }), el("pre", { className: "agy-code-box is-wrapped", text: thoughts }));
    footer.appendChild(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "关闭",
      onClick: () => sheetDialog?.close()
    }));
  }
  function populateTaskListSheet(body, footer) {
    for (const sub of sessionState.subagents) {
      body.appendChild(el("div", { className: "agy-card-item" }, el("div", { style: { display: "flex", justifyContent: "space-between", fontWeight: "650" } }, el("span", { text: `\uD83E\uDD16 ${sub.name}` }), el("span", { className: "agy-badge", text: sub.status.toUpperCase() })), el("div", { style: { fontSize: "0.84rem", color: "var(--agy-muted)" }, text: sub.role })));
    }
    footer.append(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "\uD83D\uDC1D 发起 /teamwork 多智能体协作",
      onClick: () => {
        sendTextToPageComposer("/teamwork ", false);
        sheetDialog?.close();
      }
    }), el("button", {
      type: "button",
      className: "agy-btn",
      text: "\uD83D\uDE80 发起 /boost 深度验证",
      onClick: () => {
        sendTextToPageComposer("/boost ", false);
        sheetDialog?.close();
      }
    }));
  }
  function populateDeviceSessionsSheet(body, footer, dlg) {
    const unified = getUnifiedState();
    let currentTab = "sessions";
    const subNav = el("div", {
      style: {
        display: "flex",
        gap: "6px",
        padding: "4px",
        background: "var(--agy-surface-elev)",
        borderRadius: "12px",
        marginBottom: "4px"
      }
    });
    const sessionsTabBtn = el("button", {
      type: "button",
      className: "agy-btn",
      style: {
        flex: "1",
        minHeight: "36px",
        fontSize: "0.85rem",
        fontWeight: "600",
        borderRadius: "8px",
        border: "none",
        background: "var(--agy-surface)",
        boxShadow: "0 1px 3px rgb(0 0 0 / 0.1)",
        color: "var(--agy-text)"
      },
      text: `⚡ 活跃会话 (${unified.sessions.length})`
    });
    const devicesTabBtn = el("button", {
      type: "button",
      className: "agy-btn",
      style: {
        flex: "1",
        minHeight: "36px",
        fontSize: "0.85rem",
        fontWeight: "600",
        borderRadius: "8px",
        border: "none",
        background: "transparent",
        boxShadow: "none",
        color: "var(--agy-muted)"
      },
      text: `\uD83D\uDCBB 配对设备 (${unified.devices.length})`
    });
    subNav.append(sessionsTabBtn, devicesTabBtn);
    body.appendChild(subNav);
    const contentContainer = el("div", {
      style: { display: "flex", flexDirection: "column", gap: "8px" }
    });
    body.appendChild(contentContainer);
    const renderTabContent = () => {
      clearChildren(contentContainer);
      if (currentTab === "sessions") {
        sessionsTabBtn.style.background = "var(--agy-surface)";
        sessionsTabBtn.style.color = "var(--agy-text)";
        sessionsTabBtn.style.boxShadow = "0 1px 3px rgb(0 0 0 / 0.1)";
        devicesTabBtn.style.background = "transparent";
        devicesTabBtn.style.color = "var(--agy-muted)";
        devicesTabBtn.style.boxShadow = "none";
        if (unified.sessions.length === 0) {
          contentContainer.appendChild(el("div", {
            style: {
              textAlign: "center",
              padding: "36px 16px",
              color: "var(--agy-muted)"
            }
          }, el("div", { style: { fontSize: "2rem", marginBottom: "8px" }, text: "☁️" }), el("strong", { style: { fontSize: "0.95rem" }, text: "暂无远程会话" }), el("div", {
            style: { fontSize: "0.82rem", marginTop: "4px" },
            text: "在已配对的工作台上发起会话后，将在此自动汇聚显示"
          })));
        } else {
          for (const sess of unified.sessions) {
            const isCurrent = unified.currentInstanceUuid === sess.deviceUuid && unified.currentCascadeId === sess.cascadeId;
            const card = el("div", {
              className: "agy-card-item",
              style: {
                cursor: "pointer",
                borderColor: isCurrent ? "var(--agy-accent)" : "var(--agy-border)",
                background: isCurrent ? "light-dark(rgba(26, 115, 232, 0.06), rgba(124, 172, 248, 0.08))" : "var(--agy-surface)",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "12px 14px",
                borderRadius: "14px",
                borderWidth: isCurrent ? "1.5px" : "1px",
                borderStyle: "solid",
                transition: "border-color 150ms ease, background 150ms ease"
              },
              onClick: () => {
                dlg.close();
                openUnifiedSession(sess, sess.activeTab || "chat");
              }
            }, el("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px"
              }
            }, el("strong", {
              style: {
                fontSize: "0.92rem",
                color: "var(--agy-text)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: "1"
              },
              text: sess.title
            }), isCurrent ? el("span", {
              className: "agy-badge agy-badge-accent",
              style: { fontSize: "0.75rem", fontWeight: "700", padding: "2px 8px" },
              text: "当前会话"
            }) : el("span", {
              style: { fontSize: "0.75rem", color: "var(--agy-muted)", whiteSpace: "nowrap" },
              text: sess.lastModifiedLabel
            })), el("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "8px"
              }
            }, el("div", {
              style: {
                display: "flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "0.78rem",
                color: "var(--agy-muted)",
                overflow: "hidden"
              }
            }, el("span", {
              className: sess.deviceStatus === "RUNNING" ? "agy-status-dot" : "agy-status-dot offline",
              style: { width: "6px", height: "6px", flexShrink: "0" }
            }), el("span", {
              style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              text: sess.deviceName
            }), el("span", { text: "·" }), el("span", {
              style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              text: `\uD83D\uDCC1 ${sess.projectId}`
            })), el("span", {
              style: {
                color: "var(--agy-muted)",
                fontSize: "1rem",
                lineHeight: "1",
                flexShrink: "0"
              },
              text: "›"
            })));
            contentContainer.appendChild(card);
          }
        }
      } else {
        sessionsTabBtn.style.background = "transparent";
        sessionsTabBtn.style.color = "var(--agy-muted)";
        sessionsTabBtn.style.boxShadow = "none";
        devicesTabBtn.style.background = "var(--agy-surface)";
        devicesTabBtn.style.color = "var(--agy-text)";
        devicesTabBtn.style.boxShadow = "0 1px 3px rgb(0 0 0 / 0.1)";
        for (const dev of unified.devices) {
          const isCurrent = unified.currentInstanceUuid === dev.uuid;
          const devSessions = unified.sessions.filter((s) => s.deviceUuid === dev.uuid);
          const card = el("div", {
            className: "agy-card-item",
            style: {
              cursor: "pointer",
              borderColor: isCurrent ? "var(--agy-accent)" : "var(--agy-border)",
              background: isCurrent ? "light-dark(rgba(26, 115, 232, 0.06), rgba(124, 172, 248, 0.08))" : "var(--agy-surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              padding: "12px 14px",
              borderRadius: "14px",
              borderWidth: isCurrent ? "1.5px" : "1px",
              borderStyle: "solid"
            },
            onClick: () => {
              dlg.close();
              if (dev.uuid === "__remote_conversations__") {
                window.location.assign("https://antigravity.google.com/remote");
              } else {
                window.location.assign(`https://antigravity.google.com/r/${encodeURIComponent(dev.uuid)}`);
              }
            }
          }, el("div", { style: { display: "flex", alignItems: "center", gap: "10px", minWidth: "0" } }, el("span", {
            style: { fontSize: "1.25rem", flexShrink: "0" },
            text: dev.group === "remoteConversations" ? "☁️" : "\uD83D\uDCBB"
          }), el("div", { style: { display: "flex", flexDirection: "column", gap: "2px", minWidth: "0" } }, el("strong", {
            style: {
              fontSize: "0.9rem",
              color: "var(--agy-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            },
            text: dev.displayName
          }), el("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "0.78rem",
              color: "var(--agy-muted)"
            }
          }, el("span", {
            className: dev.status === "RUNNING" ? "agy-status-dot" : dev.status === "IDLE" ? "agy-status-dot idle" : "agy-status-dot offline",
            style: { width: "6px", height: "6px", flexShrink: "0" }
          }), el("span", {
            text: dev.status === "RUNNING" ? "在线" : dev.status === "IDLE" ? "空闲" : "离线"
          }), el("span", { text: "·" }), el("span", { text: `${devSessions.length} 个会话` })))), el("span", {
            className: "agy-badge",
            style: {
              fontSize: "0.75rem",
              fontWeight: "600",
              flexShrink: "0"
            },
            text: isCurrent ? "当前工作台" : "切换连接"
          }));
          contentContainer.appendChild(card);
        }
      }
    };
    sessionsTabBtn.addEventListener("click", () => {
      currentTab = "sessions";
      renderTabContent();
    });
    devicesTabBtn.addEventListener("click", () => {
      currentTab = "devices";
      renderTabContent();
    });
    renderTabContent();
    footer.append(el("button", {
      type: "button",
      className: "agy-btn agy-btn-primary",
      text: "✦ 新建会话",
      onClick: () => {
        dlg.close();
        if (window.location.hostname.includes("gemini.google.com")) {
          sendToNative({ type: "SWITCH_ENGINE", engine: "antigravity" });
        } else {
          window.location.assign("https://antigravity.google.com/remote");
        }
      }
    }), el("button", {
      type: "button",
      className: "agy-btn",
      text: "↻ 刷新设备与会话",
      onClick: () => {
        refreshAllMultiDeviceSessions().then(() => {
          renderSheetContents(dlg, "DeviceSessions");
        });
      }
    }));
  }
  function populateSettingsSheet(body, footer, dlg) {
    const unified = getUnifiedState();
    const user = unified.userProfile;
    const onlineCount = unified.devices.filter((d) => d.status === "RUNNING").length;
    const totalSessions = unified.sessions.length;
    const container = el("div", { className: "agy-settings-container" });
    let avatarEl;
    if (user?.avatarUrl) {
      avatarEl = el("img", {
        className: "agy-account-avatar",
        attrs: { src: user.avatarUrl, alt: user.name || "User avatar" }
      });
    } else {
      avatarEl = el("div", { className: "agy-account-avatar-placeholder" }, el("span", { text: user?.name ? user.name.slice(0, 1).toUpperCase() : "✦" }));
    }
    const profileDetails = el("div", { style: { display: "flex", flexDirection: "column", gap: "3px", minWidth: "0", flex: "1" } }, el("div", {
      style: {
        fontSize: "1.02rem",
        fontWeight: "700",
        color: "var(--agy-text)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      },
      text: user?.name || "Google 账号 (统一身份认证)"
    }), el("div", {
      style: {
        fontSize: "0.8rem",
        color: "var(--agy-muted)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      },
      text: user?.email || "已连接 Google 统一身份认证"
    }), el("span", {
      className: "agy-badge",
      style: {
        background: "light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))",
        color: "#16a34a",
        fontWeight: "650",
        fontSize: "0.72rem",
        marginTop: "2px",
        alignSelf: "flex-start"
      },
      text: user?.tier || "✦ Google One AI Premium"
    }));
    const accountCard = el("div", { className: "agy-account-card" }, avatarEl, profileDetails);
    container.appendChild(accountCard);
    const cookieCard = createCookieImportCard(() => {
      dlg.close();
    });
    const cookieSection = el("div", { className: "agy-settings-section" }, el("div", { className: "agy-settings-section-title", text: "账号登录与凭证同步" }), cookieCard);
    container.appendChild(cookieSection);
    const accountGroup = el("div", { className: "agy-settings-group" }, el("button", {
      type: "button",
      className: "agy-settings-row agy-interactive",
      style: { width: "100%", textAlign: "left" },
      onClick: () => {
        window.open("https://myaccount.google.com", "_blank");
      }
    }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(66, 133, 244, 0.12), rgba(66, 133, 244, 0.22))", color: "#1a73e8" }
    }, "\uD83D\uDC64"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "管理 Google 账号" }), el("span", { className: "agy-settings-row-desc", text: "个人资料、安全与付款方式" }))), el("span", { className: "agy-settings-chevron", text: "›" })), el("button", {
      type: "button",
      className: "agy-settings-row agy-interactive",
      style: { width: "100%", textAlign: "left" },
      onClick: () => {
        window.open("https://accounts.google.com/AddSession", "_blank");
      }
    }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(168, 85, 247, 0.12), rgba(168, 85, 247, 0.22))", color: "#9333ea" }
    }, "⇄"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "切换或添加其他账号" }), el("span", { className: "agy-settings-row-desc", text: "在浏览器中登录多账号凭证" }))), el("span", { className: "agy-settings-chevron", text: "›" })));
    const accountSection = el("div", { className: "agy-settings-section" }, el("div", { className: "agy-settings-section-title", text: "账号中心" }), accountGroup);
    container.appendChild(accountSection);
    const isDarkCurrent = document.documentElement.getAttribute("data-agy-unified-theme") === "dark" || window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const prefGroup = el("div", { className: "agy-settings-group" }, el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(59, 130, 246, 0.12), rgba(59, 130, 246, 0.22))", color: "#2563eb" }
    }, "✦"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "核心启动引擎" }), el("span", { className: "agy-settings-row-desc", text: "优先呈现的工作区" }))), (() => {
      const seg = el("div", { className: "agy-settings-segmented" });
      const chatBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(unified.activeEngine === "gemini") },
        text: "✦ Gemini",
        onClick: () => {
          if (unified.activeEngine !== "gemini") {
            sendToNative({ type: "SWITCH_ENGINE", engine: "gemini" });
            chatBtn.setAttribute("aria-checked", "true");
            codeBtn.setAttribute("aria-checked", "false");
          }
        }
      });
      const codeBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(unified.activeEngine === "antigravity") },
        text: "⚡ Code",
        onClick: () => {
          if (unified.activeEngine !== "antigravity") {
            sendToNative({ type: "SWITCH_ENGINE", engine: "antigravity" });
            chatBtn.setAttribute("aria-checked", "false");
            codeBtn.setAttribute("aria-checked", "true");
          }
        }
      });
      seg.append(chatBtn, codeBtn);
      return seg;
    })()), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.22))", color: "#d97706" }
    }, "\uD83C\uDFA8"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "界面外观主题" }), el("span", { className: "agy-settings-row-desc", text: "全局深色 / 浅色模式" }))), (() => {
      const seg = el("div", { className: "agy-settings-segmented" });
      const lightBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(!isDarkCurrent) },
        text: "☀️ 浅色",
        onClick: () => {
          document.documentElement.setAttribute("data-agy-unified-theme", "light");
          try {
            localStorage.setItem("agy.unifiedTheme", "light");
          } catch {}
          sendToNative({ type: "UPDATE_THEME", isDark: false });
          lightBtn.setAttribute("aria-checked", "true");
          darkBtn.setAttribute("aria-checked", "false");
        }
      });
      const darkBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(isDarkCurrent) },
        text: "\uD83C\uDF19 深色",
        onClick: () => {
          document.documentElement.setAttribute("data-agy-unified-theme", "dark");
          try {
            localStorage.setItem("agy.unifiedTheme", "dark");
          } catch {}
          sendToNative({ type: "UPDATE_THEME", isDark: true });
          lightBtn.setAttribute("aria-checked", "false");
          darkBtn.setAttribute("aria-checked", "true");
        }
      });
      seg.append(lightBtn, darkBtn);
      return seg;
    })()), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.22))", color: "#6366f1" }
    }, "\uD83D\uDD24"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "全局字体大小" }), el("span", { className: "agy-settings-row-desc", text: "排版字号 (默认 14px 推荐)" }))), (() => {
      const seg = el("div", { className: "agy-settings-segmented" });
      const sizes = [
        { id: "12px", label: "12" },
        { id: "14px", label: "14 (默认)" },
        { id: "16px", label: "16" },
        { id: "18px", label: "18" }
      ];
      const curSize = getUnifiedFontSize();
      const btns = [];
      for (const s of sizes) {
        const btn = el("button", {
          type: "button",
          className: "agy-settings-segment-btn",
          aria: { checked: String(curSize === s.id) },
          text: s.label,
          onClick: () => {
            setUnifiedFontSize(s.id);
            btns.forEach((b, idx) => b.setAttribute("aria-checked", String(sizes[idx].id === s.id)));
          }
        });
        btns.push(btn);
        seg.append(btn);
      }
      return seg;
    })()), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(236, 72, 153, 0.12), rgba(236, 72, 153, 0.22))", color: "#ec4899" }
    }, "\uD83D\uDCCF"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "顶栏高度与触控密度" }), el("span", { className: "agy-settings-row-desc", text: "导航栏垂直高度 (默认 54px)" }))), (() => {
      const seg = el("div", { className: "agy-settings-segmented" });
      const heights = [
        { id: "48px", label: "48 紧凑" },
        { id: "54px", label: "54 标准" },
        { id: "60px", label: "60 舒适" }
      ];
      const curH = getUnifiedTopbarHeight();
      const btns = [];
      for (const h of heights) {
        const btn = el("button", {
          type: "button",
          className: "agy-settings-segment-btn",
          aria: { checked: String(curH === h.id) },
          text: h.label,
          onClick: () => {
            setUnifiedTopbarHeight(h.id);
            btns.forEach((b, idx) => b.setAttribute("aria-checked", String(heights[idx].id === h.id)));
          }
        });
        btns.push(btn);
        seg.append(btn);
      }
      return seg;
    })()), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.22))", color: "#0284c7" }
    }, "⚡"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "Code 顶栏子视图快捷入口" }), el("span", { className: "agy-settings-row-desc", text: "顶栏右侧会话/搜索/终端图标 (\uD83D\uDCAC \uD83D\uDD0D >_)" }))), (() => {
      const seg = el("div", { className: "agy-settings-segmented" });
      const showCurrent = getShowSubtabs();
      const onBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(showCurrent) },
        text: "开启",
        onClick: () => {
          setShowSubtabs(true);
          onBtn.setAttribute("aria-checked", "true");
          offBtn.setAttribute("aria-checked", "false");
        }
      });
      const offBtn = el("button", {
        type: "button",
        className: "agy-settings-segment-btn",
        aria: { checked: String(!showCurrent) },
        text: "极简隐藏",
        onClick: () => {
          setShowSubtabs(false);
          onBtn.setAttribute("aria-checked", "false");
          offBtn.setAttribute("aria-checked", "true");
        }
      });
      seg.append(onBtn, offBtn);
      return seg;
    })()), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(16, 185, 129, 0.12), rgba(16, 185, 129, 0.22))", color: "#059669" }
    }, "⌨️"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "中文输入法防抖保护" }), el("span", { className: "agy-settings-row-desc", text: "IME 3 段组合键拦截防误发" }))), el("span", {
      className: "agy-badge",
      style: {
        background: "light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))",
        color: "#16a34a",
        fontWeight: "650",
        fontSize: "0.72rem"
      },
      text: "已开启 ✓"
    })));
    const prefSection = el("div", { className: "agy-settings-section" }, el("div", { className: "agy-settings-section-title", text: "偏好设置" }), prefGroup);
    container.appendChild(prefSection);
    const syncGroup = el("div", { className: "agy-settings-group" }, el("button", {
      type: "button",
      className: "agy-settings-row agy-interactive",
      style: { width: "100%", textAlign: "left" },
      onClick: () => {
        renderSheetContents(dlg, "DeviceSessions");
      }
    }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(20, 184, 166, 0.12), rgba(20, 184, 166, 0.22))", color: "#0d9488" }
    }, "\uD83D\uDCBB"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "多端工作台与会话" }), el("span", {
      className: "agy-settings-row-desc",
      text: `${onlineCount} 台工作台在线 · ${totalSessions} 个已索引会话`
    }))), el("div", { className: "agy-settings-row-right" }, el("span", { className: "agy-settings-row-value", text: "检视" }), el("span", { className: "agy-settings-chevron", text: "›" }))), el("button", {
      type: "button",
      className: "agy-settings-row agy-interactive",
      style: { width: "100%", textAlign: "left" },
      onClick: (e) => {
        const btn = e.currentTarget;
        const valEl = btn.querySelector(".agy-settings-row-value");
        if (valEl)
          valEl.textContent = "同步中...";
        refreshAllMultiDeviceSessions().then(() => {
          pullStateFromNativeHost().then(() => {
            if (valEl)
              valEl.textContent = "已更新 ✓";
            setTimeout(() => {
              if (valEl)
                valEl.textContent = "立即拉取";
            }, 2000);
          });
        });
      }
    }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(14, 165, 233, 0.12), rgba(14, 165, 233, 0.22))", color: "#0284c7" }
    }, "↻"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "同步全端工作台状态" }), el("span", { className: "agy-settings-row-desc", text: "重新扫描 Jetski 工作台与 Gemini" }))), el("div", { className: "agy-settings-row-right" }, el("span", {
      className: "agy-settings-row-value",
      style: { color: "var(--agy-accent)" },
      text: "立即拉取"
    }), el("span", { className: "agy-settings-chevron", text: "›" }))), el("button", {
      type: "button",
      className: "agy-settings-row agy-interactive",
      style: { width: "100%", textAlign: "left" },
      onClick: () => {
        try {
          localStorage.removeItem("agy.unifiedAppState.v1");
        } catch {}
        dlg.close();
        window.location.reload();
      }
    }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.22))", color: "#dc2626" }
    }, "\uD83D\uDDD1️"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "清理本地会话缓存" }), el("span", { className: "agy-settings-row-desc", text: "重置离线聚合状态并重新载入" }))), el("div", { className: "agy-settings-row-right" }, el("span", {
      className: "agy-settings-row-value",
      style: { color: "var(--agy-danger)" },
      text: "清理"
    }), el("span", { className: "agy-settings-chevron", text: "›" }))));
    const syncSection = el("div", { className: "agy-settings-section" }, el("div", { className: "agy-settings-section-title", text: "工作台与数据" }), syncGroup);
    container.appendChild(syncSection);
    const aboutGroup = el("div", { className: "agy-settings-group" }, el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(100, 116, 139, 0.12), rgba(100, 116, 139, 0.22))", color: "#475569" }
    }, "✦"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "Antigravity Unified App" }), el("span", { className: "agy-settings-row-desc", text: "Tauri v2 + Android Dual Engine Fusion" }))), el("span", { className: "agy-settings-row-value", style: { fontFamily: "monospace" }, text: "v0.1.0" })), el("div", { className: "agy-settings-row" }, el("div", { className: "agy-settings-row-left" }, el("div", {
      className: "agy-settings-icon",
      style: { background: "light-dark(rgba(99, 102, 241, 0.12), rgba(99, 102, 241, 0.22))", color: "#4f46e5" }
    }, "\uD83D\uDEE1️"), el("div", { className: "agy-settings-row-text" }, el("span", { className: "agy-settings-row-title", text: "Trusted Types & CSP 安全" }), el("span", { className: "agy-settings-row-desc", text: "Zero-innerHTML DOMSafe 隔离" }))), el("span", {
      className: "agy-badge",
      style: {
        background: "light-dark(rgba(34, 197, 94, 0.12), rgba(34, 197, 94, 0.2))",
        color: "#16a34a",
        fontWeight: "650",
        fontSize: "0.72rem"
      },
      text: "已合规 ✓"
    })));
    const aboutSection = el("div", { className: "agy-settings-section" }, el("div", { className: "agy-settings-section-title", text: "关于与安全" }), aboutGroup);
    container.appendChild(aboutSection);
    body.appendChild(container);
    clearChildren(footer);
    footer.style.borderTop = "none";
    footer.style.padding = "4px 18px 16px";
    footer.style.justifyContent = "center";
    footer.appendChild(el("span", {
      style: {
        fontSize: "0.74rem",
        color: "var(--agy-muted)",
        opacity: "0.75",
        textAlign: "center",
        width: "100%",
        display: "block"
      },
      text: "Google Antigravity · Unified Chat & Code Remote Control"
    }));
  }
  function extractLatestArtifactOrPlanFromDom() {
    const candidates = Array.from(document.querySelectorAll('article, .markdown-body, [data-testid*="artifact"], main pre')).filter((n) => !n.closest("dialog.agy-bottom-sheet"));
    const last = candidates.at(-1);
    return last?.textContent?.trim() ?? "";
  }
  function extractLatestCodeOrDiffFromDom() {
    const blocks = Array.from(document.querySelectorAll("pre code, pre")).filter((n) => !n.closest("dialog.agy-bottom-sheet") && (n.textContent?.trim().length ?? 0) > 10);
    const last = blocks.at(-1);
    return last?.textContent?.trim() ?? "";
  }

  // src/inject/shared-nav-bar.ts
  var NAV_CSS = `
:root {
  --agy-topbar-h: 54px;
  --agy-font-size: 14px;
}

:root,
html[data-agy-unified-theme="light"] {
  color-scheme: light;
  --agy-bar-bg: rgba(255, 255, 255, 0.94);
  --agy-bar-border: rgba(15, 23, 42, 0.08);
  --agy-bar-fg: #0f172a;
  --agy-bar-muted: #64748b;
  --agy-pill-active: #eef2ff;
  --agy-accent: #2563eb;
  --agy-card-bg: #f8fafc;
  --agy-drawer-bg: #ffffff;
}

html[data-agy-unified-theme="dark"] {
  color-scheme: dark;
  --agy-bar-bg: rgba(13, 15, 20, 0.94);
  --agy-bar-border: rgba(255, 255, 255, 0.1);
  --agy-bar-fg: #f1f5f9;
  --agy-bar-muted: #94a3b8;
  --agy-pill-active: #1e293b;
  --agy-accent: #60a5fa;
  --agy-card-bg: #161922;
  --agy-drawer-bg: #111318;
}

/* Strip redundant web headers/chrome so Gemini & Antigravity feel like ONE native app */
header.gb_Pa, .gb_Pa, .gb_Fd, [data-ogsr-up], #product-controls-placeholder,
.boqOnegoogleliteOgbOneGoogleBar, .header-feedback-btn, .app-brand {
  display: none !important;
}

html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  position: relative !important;
  font-size: var(--agy-font-size, 14px) !important;
}

/* Pin Antigravity (<ga-root>) and Gemini (<chat-app-orchestrator#app-root>) strictly inside the viewport below the topbar */
ga-root,
ga-root.fullscreen,
body > app-root {
  display: block !important;
  position: absolute !important;
  top: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px)) !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  transform: translateZ(0) !important;
}

chat-app-orchestrator#app-root {
  display: flex !important;
  position: absolute !important;
  top: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px)) !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: auto !important;
  max-height: none !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  transform: translateZ(0) !important;
}

chat-app {
  display: flex !important;
  position: relative !important;
  top: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

main.chat-app,
bard-sidenav-container,
bard-sidenav-content {
  flex: 1 1 auto !important;
  height: 100% !important;
  min-height: 0 !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}

ga-root #main-content.ga-content,
ga-remote-control,
ga-remote-control .app-container,
ga-remote-control .iframe-panel,
ga-remote-control iframe,
ga-remote-agents,
ga-remote-agents .theme-standalone,
ga-remote-agents .h-\\[100dvh\\] {
  width: 100% !important;
  max-width: 100vw !important;
  height: 100% !important;
  max-height: 100% !important;
  box-sizing: border-box !important;
}

/* Hide mobile-specific redundant headers while preserving desktop workstation toolbars */
ga-remote-agents .border-b.border-border,
ga-remote-agents div.shrink-0:has(> .border-b),
ga-remote-agents button[aria-label="Back to home"],
ga-remote-agents [data-testid="mobile-back-to-home"],
ga-remote-control button[aria-label="Back to home"],
ga-remote-control [data-testid="mobile-back-to-home"] {
  display: none !important;
}

/* Modern Web Guidance: Desktop PC adaptive topbar & layout rules */
html[data-agy-form-factor="desktop"] {
  --agy-topbar-h: 36px;
}

html[data-agy-form-factor="desktop"] #agy-unified-topbar {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  width: 100% !important;
  height: 36px !important;
  transform: none !important;
  border-radius: 0 !important;
  border: none !important;
  border-bottom: 1px solid var(--agy-bar-border) !important;
  background: light-dark(rgba(248, 249, 250, 0.96), rgba(18, 20, 24, 0.96)) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 0 12px !important;
  box-sizing: border-box !important;
  z-index: 2147483640 !important;
  overflow: hidden !important;
}

/* Ensure Desktop WebViews start strictly below the 36px App Bar with zero content overlap */
html[data-agy-form-factor="desktop"] ga-root,
html[data-agy-form-factor="desktop"] ga-root.fullscreen,
html[data-agy-form-factor="desktop"] body > app-root,
html[data-agy-form-factor="desktop"] chat-app-orchestrator#app-root {
  top: 36px !important;
  height: calc(100% - 36px) !important;
  max-height: calc(100% - 36px) !important;
}

/* Desktop Topbar Layout */
html[data-agy-form-factor="desktop"] .agy-top-left {
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
}

html[data-agy-form-factor="desktop"] .agy-top-left .agy-nav-icon-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  font-size: 13px !important;
  border-radius: 6px !important;
  padding: 0 !important;
}

html[data-agy-form-factor="desktop"] .agy-mode-switcher {
  display: inline-flex !important;
  align-items: center !important;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08)) !important;
  padding: 2px !important;
  border-radius: 999px !important;
  gap: 2px !important;
}

html[data-agy-form-factor="desktop"] .agy-mode-tab {
  padding: 2px 12px !important;
  height: 24px !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  border-radius: 999px !important;
}

html[data-agy-form-factor="desktop"] .agy-device-context-pill,
html[data-agy-form-factor="desktop"] .agy-subtab-group {
  display: none !important;
}

html[data-agy-form-factor="desktop"] .agy-top-right {
  display: inline-flex !important;
  align-items: center !important;
}

html[data-agy-form-factor="desktop"] .agy-top-right .agy-nav-icon-btn {
  width: 26px !important;
  height: 26px !important;
  min-width: 26px !important;
  min-height: 26px !important;
  font-size: 12px !important;
  border-radius: 6px !important;
  padding: 0 !important;
}

@media (min-width: 768px) and (pointer: fine), (min-width: 1024px) {
  dialog.agy-unified-drawer {
    width: min(380px, 32vw);
    max-width: 420px;
    box-shadow: 8px 0 32px rgba(0, 0, 0, 0.35);
  }

  .agy-drawer-scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--agy-bar-border) transparent;
  }

  .agy-drawer-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .agy-drawer-scroll::-webkit-scrollbar-thumb {
    background: var(--agy-bar-border);
    border-radius: 999px;
  }

  .agy-mode-shortcut-hint {
    display: inline-block !important;
    font-size: 10px;
    opacity: 0.6;
    margin-left: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    vertical-align: middle;
  }
}

.agy-mode-shortcut-hint {
  display: none;
}

#agy-unified-topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: calc(var(--agy-topbar-h, 54px) + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) 8px 0 8px;
  box-sizing: border-box;
  background: var(--agy-bar-bg);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--agy-bar-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  z-index: 2147483644;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
  user-select: none;
  font-size: var(--agy-font-size, 14px);
  overflow: hidden;
}

.agy-top-left {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  z-index: 5;
}

.agy-mode-switcher {
  display: inline-flex;
  align-items: center;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
  padding: 2px 3px;
  border-radius: 999px;
  gap: 2px;
  flex: 0 0 auto;
  margin: 0 auto;
  z-index: 10;
}

.agy-top-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  flex: 0 0 auto;
  z-index: 5;
}

.agy-nav-icon-btn {
  width: 34px;
  height: 34px;
  min-width: 34px;
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}

.agy-nav-icon-btn:hover {
  background: var(--agy-pill-active);
}

.agy-device-context-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 82px;
  height: 28px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  box-sizing: border-box;
}

.agy-device-pill-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 0 1 auto;
  max-width: 48px;
  font-size: 11px;
}

.agy-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  flex: 0 0 7px;
}

.agy-status-dot.idle {
  background: #f59e0b;
}

.agy-status-dot.offline {
  background: #64748b;
}

.agy-dropdown-arrow {
  flex: 0 0 10px !important;
  width: 10px !important;
  height: 10px !important;
  color: var(--agy-bar-fg);
  opacity: 0.85;
  display: inline-block;
  vertical-align: middle;
}

.agy-mode-tab {
  min-height: 30px;
  padding: 0 10px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: var(--agy-bar-muted);
  font-size: clamp(12px, var(--agy-font-size, 14px), 15px);
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: background 140ms ease, color 140ms ease;
}

.agy-mode-tab[aria-selected="true"] {
  background: var(--agy-pill-active);
  color: var(--agy-bar-fg);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
}

.agy-mode-badge {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  background: rgba(59, 130, 246, 0.2);
  color: var(--agy-accent);
}

.agy-subtab-group {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.agy-subtab-btn {
  padding: 5px 9px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.agy-subtab-btn[aria-current="true"] {
  background: var(--agy-pill-active);
  border-color: var(--agy-bar-border);
  color: var(--agy-accent);
}

@media (max-width: 520px) {
  .agy-device-context-pill {
    max-width: 146px;
  }
  .agy-subtab-label-hide-sm {
    display: none;
  }
}

/* Unified App Navigation Drawer (<dialog>) - Conventional Mobile Best Practices */
dialog.agy-unified-drawer {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  bottom: 0 !important;
  z-index: 2147483647 !important;
  margin: 0;
  height: 100dvh;
  max-height: 100dvh;
  width: min(84vw, 320px);
  border: none;
  border-right: 1px solid var(--agy-bar-border);
  background: var(--agy-drawer-bg, #ffffff);
  color: var(--agy-bar-fg);
  padding: calc(14px + env(safe-area-inset-top, 0px)) 12px calc(14px + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
  transform: translateX(-100%);
  transition: transform 220ms cubic-bezier(0.2, 0, 0, 1),
              display 220ms allow-discrete,
              overlay 220ms allow-discrete;
  box-shadow: 4px 0 24px rgba(0, 0, 0, 0.28);
  touch-action: pan-y;
}

dialog.agy-unified-drawer[open] {
  display: flex !important;
  flex-direction: column;
  gap: 10px;
  transform: translateX(var(--agy-drawer-tx, 0px)) !important;
}

@starting-style {
  dialog.agy-unified-drawer[open] {
    transform: translateX(-100%) !important;
  }
}

dialog.agy-unified-drawer::backdrop {
  z-index: 2147483646 !important;
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
}

/* Drawer Profile Header */
.agy-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 10px;
  border-bottom: 1px solid var(--agy-bar-border);
}

.agy-drawer-user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.agy-drawer-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4285f4, #9b51e0);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(66, 133, 244, 0.3);
}

.agy-drawer-user-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.agy-drawer-user-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--agy-bar-fg);
  line-height: 1.2;
}

.agy-drawer-user-desc {
  font-size: 11px;
  color: var(--agy-bar-muted);
  line-height: 1.2;
  margin-top: 2px;
}

.agy-drawer-close-btn {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 140ms ease;
}

.agy-drawer-close-btn:hover {
  background: var(--agy-pill-active);
}

/* Quick Action Launchers Grid */
.agy-drawer-action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 4px;
}

.agy-drawer-action-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 140ms ease;
  box-sizing: border-box;
}

.agy-drawer-action-btn:hover,
.agy-drawer-action-btn:active {
  background: var(--agy-pill-active);
  border-color: var(--agy-accent);
}

.agy-drawer-action-btn.primary {
  background: light-dark(#eff6ff, #1e293b);
  border-color: rgba(59, 130, 246, 0.35);
}

/* Engine Mode Nav Tiles */
.agy-drawer-nav-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--agy-bar-border);
}

.agy-drawer-nav-tile {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease;
  text-align: left;
  width: 100%;
  box-sizing: border-box;
}

.agy-drawer-nav-tile:hover {
  background: var(--agy-card-bg);
}

.agy-drawer-nav-tile[data-active="true"] {
  background: light-dark(#eff6ff, #1e293b);
  border-color: rgba(59, 130, 246, 0.25);
  font-weight: 700;
  color: var(--agy-accent);
}

.agy-drawer-nav-tile-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agy-drawer-badge-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.18);
  color: var(--agy-accent);
}

.agy-drawer-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-right: 2px;
}

.agy-drawer-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agy-drawer-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--agy-bar-muted);
  padding: 4px 4px 2px;
  text-transform: uppercase;
}

.agy-drawer-section-count {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 999px;
  background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.08));
}

.agy-drawer-item-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agy-drawer-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--agy-bar-fg);
  text-align: left;
  cursor: pointer;
  transition: all 120ms ease;
  width: 100%;
  box-sizing: border-box;
}

.agy-drawer-item:hover {
  background: var(--agy-card-bg);
  border-color: var(--agy-bar-border);
}

.agy-drawer-item[data-active="true"] {
  background: light-dark(#eff6ff, #1b2234);
  border-color: var(--agy-accent);
}

.agy-drawer-item-title {
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--agy-bar-fg);
}

.agy-drawer-item-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--agy-bar-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agy-drawer-empty-hint {
  padding: 12px 8px;
  font-size: 11px;
  color: var(--agy-bar-muted);
  text-align: center;
}

/* Bottom Sticky Footer */
.agy-drawer-footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--agy-bar-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
}

.agy-drawer-footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--agy-bar-border);
  background: var(--agy-card-bg);
  color: var(--agy-bar-fg);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 140ms ease;
}

.agy-drawer-footer-btn:hover {
  background: var(--agy-pill-active);
}

.agy-drawer-footer-badge {
  font-size: 10px;
  color: var(--agy-bar-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
`;
  function navigateCrossEngineUrl(targetUrl) {
    const isTargetGemini = targetUrl.startsWith("https://gemini.google.com/");
    const isCurrentGemini = window.location.hostname.includes("gemini.google.com");
    if (isTargetGemini === isCurrentGemini) {
      window.location.assign(targetUrl);
      return;
    }
    const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (tauriInvoke) {
      tauriInvoke("navigate_to_remote_session", { targetUrl });
      return;
    }
    const androidBridge = window.AndroidBridge;
    if (androidBridge?.navigateToRemoteSession) {
      androidBridge.navigateToRemoteSession(targetUrl);
      return;
    }
    window.location.assign(targetUrl);
  }
  function switchAppEngine(target) {
    const targetUrl = target === "gemini" ? "https://gemini.google.com/app" : "https://antigravity.google.com/remote";
    const androidBridge = window.AndroidBridge;
    if (androidBridge && typeof androidBridge.switchEngine === "function") {
      androidBridge.switchEngine(target);
      return;
    }
    if (window.AgyAndroidBridge?.switchEngine) {
      window.AgyAndroidBridge.switchEngine(target);
      return;
    }
    const tauriInvoke = window.__TAURI_INTERNALS__?.invoke;
    if (tauriInvoke) {
      tauriInvoke("switch_engine", { engine: target }).catch((err) => {
        console.warn("Native switch_engine failed, fallback to assign:", err);
        if (!window.location.href.startsWith(targetUrl)) {
          window.location.assign(targetUrl);
        }
      });
      return;
    }
    if (!window.location.href.startsWith(targetUrl)) {
      window.location.assign(targetUrl);
    }
  }
  var createSvgAntigravityLogo = (size = 18) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("agy-brand-logo-svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M482.04-859.61Q557.08-860 597-803.84t70,127.77q25.23,61.92 49.23,137.5t50.93,151.03q26.3,72.47 57.65,137.05T897-139.62q6.46,8.08 6.46,16.96T897-107.69t-16.35,6.38t-17.1-6.11q-76.71-64.2-122.32-140.01T646.48-376.6q-34.64-38.4-74.56-61.21t-89.63-22.42q-49.72-0.38-89.89,22.42T317.82-376.6q-49.36,53.37-94.98,129.18T100.52-107.42q-7.21,6.42-16.91,6.11t-16.54-6.58q-6.46-5.88-6.27-14.77t6.65-16.96q40.46-45.92 71.81-110.69t57.65-137.24Q223.85-463 247.85-538.3t49.23-137.77q29.18-71.36 69.55-127.64t115.41-55.9Zm-87.46,93.88q-31.27,48.5-53.88,102.27q-35.31,81.54-60.92,169.19T222.31-326.61q24.73-33.65 48.21-62.32t48.87-51.52q36.15-31.54 75.31-48.35t87.35-16.81t87.35,16.81t75.69,48.35q25,22.85 48.48,51.52t48.21,62.32q-31.85-80-57.46-167.65T623.77-663.46q-23-53.77-54.27-102.27t-87.46-48.5t-87.46,48.5Z");
    svg.appendChild(path);
    return svg;
  };
  function injectSharedNavBar(engineParam, onOpenSessionsSheet) {
    const currentEngine = typeof window !== "undefined" && window.location.hostname.includes("gemini.google.com") ? "gemini" : typeof window !== "undefined" && window.location.hostname.includes("antigravity.google.com") ? "antigravity" : engineParam;
    adoptStyleSheet("agy-shared-nav-styles", NAV_CSS);
    if (document.getElementById("agy-unified-topbar"))
      return;
    const drawer = el("dialog", {
      className: "agy-unified-drawer",
      attrs: {
        "aria-label": "Antigravity Unified Workspace & Sessions Drawer",
        "data-engine": currentEngine
      }
    });
    const drawerAvatar = el("div", { className: "agy-drawer-avatar" }, [createSvgAntigravityLogo(22)]);
    const drawerUserName = el("span", { className: "agy-drawer-user-name", textContent: "Antigravity" });
    const drawerUserDesc = el("span", { className: "agy-drawer-user-desc", textContent: "Google AI · Dual Engine" });
    const drawerUserInfo = el("div", {
      className: "agy-drawer-user-info",
      attrs: { title: "点击打开账号中心与设置" },
      style: "cursor: pointer;",
      onClick: () => {
        drawer.close();
        openClaudeBottomSheet("Settings");
      }
    }, [drawerAvatar, el("div", { className: "agy-drawer-user-text" }, [drawerUserName, drawerUserDesc])]);
    const drawerProfile = el("div", { className: "agy-drawer-header" }, [
      drawerUserInfo,
      el("button", {
        className: "agy-drawer-close-btn",
        attrs: { type: "button", "aria-label": "Close drawer" },
        textContent: "✕",
        onClick: () => drawer.close()
      })
    ]);
    const actionGrid = el("div", { className: "agy-drawer-action-grid" }, [
      el("button", {
        className: "agy-drawer-action-btn primary",
        attrs: { type: "button" },
        onClick: () => {
          drawer.close();
          if (currentEngine === "gemini") {
            window.location.assign("https://gemini.google.com/app");
          } else {
            switchAppEngine("gemini");
          }
        }
      }, [
        el("span", { textContent: "✦", attrs: { style: "color: #3b82f6; font-size: 15px;" } }),
        el("span", { textContent: "新建对话" })
      ]),
      el("button", {
        className: "agy-drawer-action-btn",
        attrs: { type: "button" },
        onClick: () => {
          drawer.close();
          if (currentEngine === "antigravity") {
            window.location.assign("https://antigravity.google.com/remote");
          } else {
            switchAppEngine("antigravity");
          }
        }
      }, [
        el("span", { textContent: "⚡", attrs: { style: "color: #f59e0b; font-size: 15px;" } }),
        el("span", { textContent: "新建代码" })
      ])
    ]);
    const navGroup = el("div", { className: "agy-drawer-nav-group" }, [
      el("button", {
        className: "agy-drawer-nav-tile",
        attrs: {
          type: "button",
          "data-active": currentEngine === "gemini" ? "true" : "false"
        },
        onClick: () => {
          drawer.close();
          switchAppEngine("gemini");
        }
      }, [
        el("div", { className: "agy-drawer-nav-tile-left" }, [
          el("span", { textContent: "✦", attrs: { style: "color: #3b82f6;" } }),
          el("span", { textContent: "Gemini Chat" })
        ]),
        ...currentEngine === "gemini" ? [el("span", { className: "agy-drawer-badge-pill", textContent: "当前" })] : []
      ]),
      el("button", {
        className: "agy-drawer-nav-tile",
        attrs: {
          type: "button",
          "data-active": currentEngine === "antigravity" ? "true" : "false"
        },
        onClick: () => {
          drawer.close();
          switchAppEngine("antigravity");
        }
      }, [
        el("div", { className: "agy-drawer-nav-tile-left" }, [
          createSvgAntigravityLogo(17),
          el("span", { textContent: "Antigravity Code" })
        ]),
        ...currentEngine === "antigravity" ? [el("span", { className: "agy-drawer-badge-pill", textContent: "当前" })] : []
      ])
    ]);
    const drawerScroll = el("div", { className: "agy-drawer-scroll" });
    const drawerThemeIcon = el("span", {
      textContent: getUnifiedTheme() === "dark" ? "☀️" : "\uD83C\uDF19"
    });
    const drawerThemeText = el("span", {
      textContent: getUnifiedTheme() === "dark" ? "浅色" : "深色"
    });
    const drawerThemeBtn = el("button", {
      className: "agy-drawer-footer-btn",
      attrs: {
        type: "button",
        title: "切换全局浅色/深色主题 (Chat & Code 统一同步)"
      },
      onClick: () => {
        toggleUnifiedTheme();
      }
    }, [drawerThemeIcon, drawerThemeText]);
    const drawerRefreshBtn = el("button", {
      className: "agy-drawer-footer-btn",
      attrs: {
        type: "button",
        title: "刷新并同步全部工作台与会话状态"
      },
      onClick: () => {
        refreshAllMultiDeviceSessions();
        pullStateFromNativeHost();
      }
    }, [el("span", { textContent: "↻" }), el("span", { textContent: "同步" })]);
    const drawerSettingsBtn = el("button", {
      className: "agy-drawer-footer-btn",
      attrs: {
        type: "button",
        title: "打开应用设置与账号中心"
      },
      onClick: () => {
        drawer.close();
        openClaudeBottomSheet("Settings");
      }
    }, [el("span", { textContent: "⚙️" }), el("span", { textContent: "设置" })]);
    const drawerFooter = el("div", { className: "agy-drawer-footer" }, [
      el("div", { attrs: { style: "display:flex;gap:6px;align-items:center;" } }, [
        drawerThemeBtn,
        drawerRefreshBtn,
        drawerSettingsBtn
      ]),
      el("span", { className: "agy-drawer-footer-badge", textContent: "v0.1.0" })
    ]);
    const topbarThemeBtn = el("button", {
      className: "agy-nav-icon-btn",
      textContent: getUnifiedTheme() === "dark" ? "☀️" : "\uD83C\uDF19",
      attrs: {
        type: "button",
        title: "切换全局浅色/深色主题 (Chat & Code 统一同步)"
      },
      onClick: () => {
        toggleUnifiedTheme();
      }
    });
    subscribeUnifiedTheme((theme) => {
      const isDark = theme === "dark";
      const icon = isDark ? "☀️" : "\uD83C\uDF19";
      drawerThemeIcon.textContent = icon;
      drawerThemeText.textContent = isDark ? "浅色" : "深色";
      topbarThemeBtn.textContent = icon;
    });
    drawer.append(drawerProfile, actionGrid, navGroup, drawerScroll, drawerFooter);
    drawer.addEventListener("click", (e) => {
      if (e.target === drawer)
        drawer.close();
    });
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;
    let isDraggingDrawer = false;
    let isHorizontalGestureLocked = false;
    window.addEventListener("touchstart", (e) => {
      if (!drawer.open)
        return;
      const touch = e.touches[0];
      if (!touch)
        return;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchStartTime = Date.now();
      isDraggingDrawer = false;
      isHorizontalGestureLocked = false;
    }, { passive: true });
    window.addEventListener("touchmove", (e) => {
      if (!drawer.open)
        return;
      const touch = e.touches[0];
      if (!touch)
        return;
      const diffX = touch.clientX - touchStartX;
      const diffY = touch.clientY - touchStartY;
      if (!isHorizontalGestureLocked) {
        if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
          if (diffX < 0) {
            isHorizontalGestureLocked = true;
            isDraggingDrawer = true;
            drawer.style.transition = "none";
          }
        } else if (Math.abs(diffY) > 8) {
          isHorizontalGestureLocked = true;
          isDraggingDrawer = false;
        }
      }
      if (isDraggingDrawer && diffX < 0) {
        if (e.cancelable)
          e.preventDefault();
        drawer.style.setProperty("--agy-drawer-tx", `${diffX}px`);
      }
    }, { passive: false });
    const handleTouchEnd = (e) => {
      if (!drawer.open || !isDraggingDrawer) {
        isHorizontalGestureLocked = false;
        isDraggingDrawer = false;
        return;
      }
      isDraggingDrawer = false;
      isHorizontalGestureLocked = false;
      const touch = e.changedTouches[0];
      const diffX = touch ? touch.clientX - touchStartX : -100;
      const duration = Math.max(1, Date.now() - touchStartTime);
      const velocityX = diffX / duration;
      const shouldClose = diffX < -50 || diffX < -15 && velocityX < -0.35;
      drawer.style.transition = "transform 200ms cubic-bezier(0.2, 0, 0, 1)";
      if (shouldClose) {
        drawer.style.setProperty("--agy-drawer-tx", "-100%");
        setTimeout(() => {
          if (drawer.open)
            drawer.close();
          drawer.style.removeProperty("--agy-drawer-tx");
          drawer.style.transition = "";
        }, 210);
      } else {
        drawer.style.setProperty("--agy-drawer-tx", "0px");
        setTimeout(() => {
          drawer.style.removeProperty("--agy-drawer-tx");
          drawer.style.transition = "";
        }, 210);
      }
    };
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    drawer.addEventListener("close", () => {
      drawer.style.removeProperty("--agy-drawer-tx");
      drawer.style.transition = "";
      isDraggingDrawer = false;
      isHorizontalGestureLocked = false;
    });
    const createSvgChevronDown = () => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 12 12");
      svg.setAttribute("width", "11");
      svg.setAttribute("height", "11");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.classList.add("agy-dropdown-arrow");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M2.5 4.5L6 8L9.5 4.5");
      svg.appendChild(path);
      return svg;
    };
    const devicePillDot = el("span", { className: "agy-status-dot" });
    const devicePillLabel = el("span", {
      className: "agy-device-pill-label",
      textContent: currentEngine === "gemini" ? "工作台" : "远程主机"
    });
    const deviceDropdownArrow = createSvgChevronDown();
    const deviceContextPill = el("button", {
      className: "agy-device-context-pill",
      attrs: {
        type: "button",
        title: "切换工作台与会话 (Workstations & Sessions)",
        "aria-label": "切换工作台与会话"
      },
      onClick: () => {
        if (onOpenSessionsSheet) {
          onOpenSessionsSheet();
        } else {
          if (!drawer.open) {
            drawer.showModal();
          }
        }
      }
    }, [devicePillDot, devicePillLabel, deviceDropdownArrow]);
    const sessionCountBadge = el("span", {
      className: "agy-mode-badge",
      textContent: "1"
    });
    const rightSubtabsContainer = el("div", { className: "agy-top-right" });
    const renderStateIntoUI = (state) => {
      const activeDev = state.devices.find((d) => d.uuid === state.currentInstanceUuid);
      if (currentEngine === "antigravity" && activeDev) {
        const rawName = activeDev.displayName || "工作台";
        let shortName = "工作台";
        if (rawName.toLowerCase().includes("mini"))
          shortName = "mini";
        else if (rawName.includes("-"))
          shortName = rawName.split("-")[0].slice(0, 4);
        else
          shortName = rawName.slice(0, 4);
        devicePillLabel.textContent = shortName;
        devicePillDot.className = activeDev.status === "RUNNING" ? "agy-status-dot" : activeDev.status === "IDLE" ? "agy-status-dot idle" : "agy-status-dot offline";
      } else {
        const onlineCount = state.devices.filter((d) => d.status === "RUNNING").length;
        devicePillLabel.textContent = onlineCount > 0 ? `${onlineCount}在线` : "工作台";
        devicePillDot.className = "agy-status-dot";
      }
      sessionCountBadge.textContent = String(Math.max(1, state.sessions.length));
      clearChildren(rightSubtabsContainer);
      if (currentEngine === "antigravity") {
        rightSubtabsContainer.append(deviceContextPill);
        if (getShowSubtabs() && state.currentCascadeId) {
          const subtabs = [
            { id: "chat", label: "Chat", icon: "\uD83D\uDCAC" },
            { id: "review", label: "Review", icon: "\uD83D\uDD0D" },
            { id: "terminal", label: "Term", icon: ">_ " }
          ];
          const group = el("div", { className: "agy-subtab-group" });
          for (const t of subtabs) {
            group.append(el("button", {
              className: "agy-subtab-btn",
              attrs: {
                type: "button",
                "aria-current": state.currentTab === t.id ? "true" : "false",
                title: `Switch session view to ${t.label}`
              },
              onClick: () => {
                openUnifiedSession({
                  deviceUuid: state.currentInstanceUuid || "__remote_conversations__",
                  cascadeId: state.currentCascadeId,
                  projectId: state.currentProjectId || "default-cli-project"
                }, t.id);
              }
            }, [
              el("span", { textContent: t.icon }),
              el("span", { className: "agy-subtab-label-hide-sm", textContent: ` ${t.label}` })
            ]));
          }
          rightSubtabsContainer.append(group);
        }
      }
      rightSubtabsContainer.append(topbarThemeBtn);
      if (state.userProfile) {
        drawerUserName.textContent = state.userProfile.name || "Google User";
        drawerUserDesc.textContent = state.userProfile.email || state.userProfile.tier || "Google AI · Dual Engine";
        if (state.userProfile.avatarUrl) {
          clearChildren(drawerAvatar);
          drawerAvatar.style.background = "transparent";
          drawerAvatar.appendChild(el("img", {
            attrs: { src: state.userProfile.avatarUrl, alt: "avatar" },
            style: "width:100%;height:100%;border-radius:50%;object-fit:cover;"
          }));
        }
      }
      clearChildren(drawerScroll);
      const sessionsSection = el("div", { className: "agy-drawer-section" });
      sessionsSection.append(el("div", { className: "agy-drawer-section-title" }, [
        el("span", { textContent: "⚡ 最近代码会话" }),
        el("span", {
          className: "agy-drawer-section-count",
          textContent: `${state.sessions.length}`
        })
      ]));
      const sessionsList = el("div", { className: "agy-drawer-item-list" });
      if (state.sessions.length === 0) {
        sessionsList.append(el("div", {
          className: "agy-drawer-empty-hint",
          textContent: "暂无最近会话，点击下方配对工作台或上方新建"
        }));
      } else {
        for (const sess of state.sessions.slice(0, 5)) {
          const isCurrent = state.currentInstanceUuid === sess.deviceUuid && state.currentCascadeId === sess.cascadeId;
          sessionsList.append(el("button", {
            className: "agy-drawer-item",
            attrs: {
              type: "button",
              "data-active": isCurrent ? "true" : "false"
            },
            onClick: () => {
              drawer.close();
              openUnifiedSession(sess, sess.activeTab || "chat");
            }
          }, [
            el("div", { className: "agy-drawer-item-title", textContent: sess.title }),
            el("div", { className: "agy-drawer-item-meta" }, [
              el("span", {
                className: sess.deviceStatus === "RUNNING" ? "agy-status-dot" : sess.deviceStatus === "IDLE" ? "agy-status-dot idle" : "agy-status-dot offline"
              }),
              el("span", { textContent: sess.deviceName }),
              el("span", { textContent: "·" }),
              el("span", { textContent: sess.projectId }),
              el("span", {
                attrs: { style: "margin-left:auto;font-size:10px;" },
                textContent: sess.lastModifiedLabel
              })
            ])
          ]));
        }
      }
      sessionsSection.append(sessionsList);
      drawerScroll.append(sessionsSection);
      if (state.geminiChats.length > 0) {
        const geminiSection = el("div", { className: "agy-drawer-section" });
        geminiSection.append(el("div", { className: "agy-drawer-section-title" }, [
          el("span", { textContent: "✦ 最近 Gemini 对话" }),
          el("span", {
            className: "agy-drawer-section-count",
            textContent: `${state.geminiChats.length}`
          })
        ]));
        const geminiList = el("div", { className: "agy-drawer-item-list" });
        for (const chat of state.geminiChats.slice(0, 5)) {
          geminiList.append(el("button", {
            className: "agy-drawer-item",
            attrs: { type: "button" },
            onClick: () => {
              drawer.close();
              navigateCrossEngineUrl(chat.url);
            }
          }, [
            el("div", { className: "agy-drawer-item-title", textContent: chat.title }),
            el("div", { className: "agy-drawer-item-meta" }, [
              el("span", { textContent: "\uD83D\uDCAC Gemini 网页对话" })
            ])
          ]));
        }
        geminiSection.append(geminiList);
        drawerScroll.append(geminiSection);
      }
      const devicesSection = el("div", { className: "agy-drawer-section" });
      devicesSection.append(el("div", { className: "agy-drawer-section-title" }, [
        el("span", { textContent: "\uD83D\uDCBB 配对工作台" }),
        el("span", {
          className: "agy-drawer-section-count",
          textContent: `${state.devices.length} 台`
        })
      ]));
      const devicesList = el("div", { className: "agy-drawer-item-list" });
      for (const dev of state.devices) {
        const isCurrent = state.currentInstanceUuid === dev.uuid;
        devicesList.append(el("button", {
          className: "agy-drawer-item",
          attrs: {
            type: "button",
            "data-active": isCurrent ? "true" : "false"
          },
          onClick: () => {
            drawer.close();
            const targetUrl = dev.uuid === "__remote_conversations__" ? "https://antigravity.google.com/remote" : `https://antigravity.google.com/r/${encodeURIComponent(dev.uuid)}`;
            navigateCrossEngineUrl(targetUrl);
          }
        }, [
          el("div", {
            attrs: {
              style: "display:flex;align-items:center;justify-content:space-between;width:100%;"
            }
          }, [
            el("div", { attrs: { style: "display:flex;align-items:center;gap:6px;" } }, [
              el("span", {
                className: dev.status === "RUNNING" ? "agy-status-dot" : dev.status === "IDLE" ? "agy-status-dot idle" : "agy-status-dot offline"
              }),
              el("span", {
                className: "agy-drawer-item-title",
                textContent: `${dev.group === "remoteConversations" ? "☁️ " : "\uD83D\uDCBB "}${dev.displayName}`
              })
            ]),
            el("span", {
              attrs: {
                style: `font-size:10px;font-weight:600;color:${dev.status === "RUNNING" ? "#22c55e" : "#94a3b8"};`
              },
              textContent: dev.status === "RUNNING" ? "在线" : "离线"
            })
          ])
        ]));
      }
      devicesSection.append(devicesList);
      drawerScroll.append(devicesSection);
    };
    const topbar = el("nav", {
      id: "agy-unified-topbar",
      attrs: {
        "aria-label": "Antigravity Unified App Bar",
        "data-engine": currentEngine
      }
    });
    const leftCluster = el("div", { className: "agy-top-left" }, [
      el("button", {
        className: "agy-nav-icon-btn",
        textContent: "☰",
        attrs: { type: "button", "aria-label": "Open Unified App Drawer" },
        onClick: () => {
          pullStateFromNativeHost();
          if (currentEngine === "antigravity") {
            refreshAllMultiDeviceSessions();
          }
          if (!drawer.open) {
            drawer.showModal();
          }
        }
      })
    ]);
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || navigator.platform);
    const modKeyLabel = isMac ? "⌘" : "Ctrl+";
    const switcher = el("div", {
      className: "agy-mode-switcher",
      attrs: { role: "tablist", "aria-label": "App Engine Mode" }
    }, [
      el("button", {
        className: "agy-mode-tab",
        attrs: {
          type: "button",
          role: "tab",
          title: `切换至 Gemini Chat (${modKeyLabel}1)`,
          "aria-selected": currentEngine === "gemini" ? "true" : "false"
        },
        onClick: () => {
          switchAppEngine("gemini");
        }
      }, [
        el("span", { textContent: "✦ Chat" }),
        el("span", { className: "agy-mode-shortcut-hint", textContent: `${modKeyLabel}1` })
      ]),
      el("button", {
        className: "agy-mode-tab",
        attrs: {
          type: "button",
          role: "tab",
          title: `切换至 Antigravity Code Remote (${modKeyLabel}2)`,
          "aria-selected": currentEngine === "antigravity" ? "true" : "false"
        },
        onClick: () => {
          switchAppEngine("antigravity");
        }
      }, [
        el("span", { attrs: { style: "display:inline-flex;align-items:center;gap:4px;" } }, [
          createSvgAntigravityLogo(13),
          el("span", { textContent: "Code" })
        ]),
        sessionCountBadge,
        el("span", { className: "agy-mode-shortcut-hint", textContent: `${modKeyLabel}2` })
      ])
    ]);
    window.addEventListener("keydown", (e) => {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && !e.shiftKey && !e.altKey) {
        if (e.key === "1") {
          e.preventDefault();
          if (currentEngine !== "gemini")
            switchAppEngine("gemini");
        } else if (e.key === "2") {
          e.preventDefault();
          if (currentEngine !== "antigravity")
            switchAppEngine("antigravity");
        } else if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          if (drawer.open) {
            drawer.close();
          } else {
            pullStateFromNativeHost();
            if (currentEngine === "antigravity")
              refreshAllMultiDeviceSessions();
            drawer.showModal();
          }
        } else if (e.key === ",") {
          e.preventDefault();
          if (drawer.open)
            drawer.close();
          openClaudeBottomSheet("Settings");
        }
      } else if (isMeta && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        if (drawer.open)
          drawer.close();
        if (onOpenSessionsSheet)
          onOpenSessionsSheet();
        else
          openClaudeBottomSheet("DeviceSessions");
      }
    });
    topbar.append(leftCluster, switcher, rightSubtabsContainer);
    document.body.append(topbar, drawer);
    window.addEventListener("scroll", () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    }, { passive: true });
    if (typeof window !== "undefined" && window.visualViewport) {
      const syncWithVisualViewport = () => {
        const topbarEl = document.getElementById("agy-unified-topbar");
        if (topbarEl && window.visualViewport) {
          const offsetTop = Math.max(0, window.visualViewport.offsetTop || 0);
          topbarEl.style.transform = offsetTop > 0 ? `translate3d(0, ${offsetTop}px, 0)` : "";
        }
      };
      window.visualViewport.addEventListener("resize", syncWithVisualViewport, { passive: true });
      window.visualViewport.addEventListener("scroll", syncWithVisualViewport, { passive: true });
    }
    subscribeUnifiedState(renderStateIntoUI);
    pullStateFromNativeHost();
  }

  // src/inject/gemini-bridge.ts
  var GEMINI_FUSION_CSS = `
.agy-handoff-code-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.35);
  background: rgba(37, 99, 235, 0.14);
  color: #60a5fa;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
}

.agy-handoff-code-btn:hover {
  background: rgba(37, 99, 235, 0.24);
}

/* Hide Gemini Web "Chat with Gemini in an app / Try app" mobile upsell banner */
upsell-banner,
mobile-upsell-banner,
[data-test-id*="upsell"],
a[href*="play.google.com/store/apps/details"] {
  display: none !important;
}

/* Mobile-only: Keep Gemini's side nav mounted offscreen so it fetches and renders conversation history for the Unified Drawer */
html[data-agy-form-factor="mobile"] bard-sidenav,
html[data-agy-form-factor="mobile"] mat-sidenav,
html[data-agy-form-factor="mobile"] .side-nav-container {
  position: fixed !important;
  left: -9999px !important;
  top: 0 !important;
  width: 320px !important;
  opacity: 0 !important;
  pointer-events: none !important;
  z-index: -10 !important;
}

html[data-agy-form-factor="mobile"] mat-sidenav-content,
html[data-agy-form-factor="mobile"] bard-sidenav-content,
html[data-agy-form-factor="mobile"] .mat-drawer-content {
  margin-left: 0 !important;
  margin-right: 0 !important;
  width: 100% !important;
  max-width: 100vw !important;
}

/* Mobile-only: Hide Gemini Web's native menu and onegoogle bars on small screens */
html[data-agy-form-factor="mobile"] button[aria-label*="Main menu"],
html[data-agy-form-factor="mobile"] button[aria-label*="主菜单"],
html[data-agy-form-factor="mobile"] button[data-test-id="side-nav-button"],
html[data-agy-form-factor="mobile"] .side-nav-button,
html[data-agy-form-factor="mobile"] .boqOnegoogleliteOgbOneGoogleBar,
html[data-agy-form-factor="mobile"] header.gb_Pa,
html[data-agy-form-factor="mobile"] .gb_Pa,
html[data-agy-form-factor="mobile"] .gb_Fd {
  position: absolute !important;
  left: -9999px !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* Suppress all backdrop overlays so they NEVER intercept user taps on the chat input / composer */
mat-drawer-backdrop,
.mat-drawer-backdrop,
mat-sidenav-backdrop,
.mat-sidenav-backdrop,
.cdk-overlay-backdrop {
  display: none !important;
  pointer-events: none !important;
  visibility: hidden !important;
}

/* Ensure editor, rich-textarea, and composer are always interactive and focusable for IME */
.ql-editor,
rich-textarea,
rich-textarea *,
input,
textarea,
[contenteditable="true"] {
  pointer-events: auto !important;
  user-select: text !important;
  -webkit-user-select: text !important;
  touch-action: manipulation !important;
}

/* Clean adaptive theme support for Gemini Web */
html[data-agy-unified-theme="light"],
html[data-agy-unified-theme="light"] body {
  background-color: #ffffff !important;
  color: #1f1f1f !important;
}

html[data-agy-unified-theme="dark"],
html[data-agy-unified-theme="dark"] body {
  background-color: #131314 !important;
  color: #e3e3e3 !important;
}
`;
  var menuTriggered = false;
  function triggerGeminiMenuToLoadConversations() {
    if (menuTriggered)
      return;
    const hasChats = document.querySelector('a[href*="/app/"]');
    if (hasChats) {
      menuTriggered = true;
      return;
    }
    const menuBtn = document.querySelector('button[aria-label*="主菜单"], button[aria-label*="Main menu"], button[data-test-id="side-nav-button"], .side-nav-button');
    if (menuBtn) {
      menuTriggered = true;
      menuBtn.click();
    }
  }
  function openGeminiMultiDeviceSheet() {
    pullStateFromNativeHost().then(() => {
      openClaudeBottomSheet("DeviceSessions");
    });
  }
  function scanGeminiCodeBlocks() {
    const codeBlocks = document.querySelectorAll("pre, code-block");
    codeBlocks.forEach((block) => {
      if (block.dataset.agyHandoffAttached === "true")
        return;
      block.dataset.agyHandoffAttached = "true";
      const handoffBtn = el("button", {
        className: "agy-handoff-code-btn",
        textContent: "⚡ Send to Antigravity Code",
        attrs: {
          type: "button",
          title: "Continue or execute this snippet in Antigravity Remote Control"
        },
        onClick: () => {
          const snippet = (block.textContent || "").trim();
          sessionState.latestDiffContent = snippet;
          sendToNative({
            type: "TELEPORT_TO_CODE",
            prompt: `请基于以下来自 Gemini 对话的代码片段继续实现或验证：
\`\`\`
${snippet.slice(0, 2000)}
\`\`\``
          });
        }
      });
      block.parentElement?.append(handoffBtn);
    });
  }
  function bootGeminiBridge() {
    if (typeof window !== "undefined" && (window.location.hostname.includes("accounts.google.com") || window.location.pathname.startsWith("/accounts"))) {
      if (typeof window !== "undefined" && window.self === window.top) {
        if (!document.body) {
          window.addEventListener("DOMContentLoaded", () => mountAccountsGoogleLoginHelper(), {
            once: true
          });
        } else {
          mountAccountsGoogleLoginHelper();
        }
      }
      return;
    }
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", bootGeminiBridge, { once: true });
      return;
    }
    ensureModernHeadMeta();
    adoptStyleSheet("agy-gemini-fusion-styles", GEMINI_FUSION_CSS);
    injectSharedNavBar("gemini", () => openGeminiMultiDeviceSheet());
    scanGeminiCodeBlocks();
    triggerGeminiMenuToLoadConversations();
    pullStateFromNativeHost().then(() => {
      syncGeminiChatsFromDom();
      syncUserProfileFromDom();
    });
    window.setInterval(() => {
      pullStateFromNativeHost().then(() => {
        syncGeminiChatsFromDom();
        syncUserProfileFromDom();
      });
    }, 1e4);
    let mutationDebounceTimer = null;
    const observer = new MutationObserver(() => {
      if (mutationDebounceTimer !== null)
        return;
      mutationDebounceTimer = window.setTimeout(() => {
        mutationDebounceTimer = null;
        scanGeminiCodeBlocks();
        syncGeminiChatsFromDom();
      }, 2500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  bootGeminiBridge();
})();
