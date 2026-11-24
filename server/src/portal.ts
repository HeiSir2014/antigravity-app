// Flagship Open-Source Portal & Multi-Platform Download Hub for https://antigravity.yterm.cn/
// Pure HTML/CSS/JS, zero external CDN dependencies, blazingly fast worldwide & in mainland China.

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ReleaseAssetSummary {
  version: string;
  releaseUrl: string;
  androidApkUrl: string;
  androidApkSize: string;
  macosDmgUrl: string;
  macosDmgSize: string;
  windowsExeUrl: string;
  windowsExeSize: string;
  windowsMsiUrl: string;
  linuxDebUrl: string;
  linuxDebSize: string;
  linuxAppImageUrl: string;
  linuxRpmUrl: string;
  webBundleSize: string;
}

const DEFAULT_RELEASE: ReleaseAssetSummary = {
  version: 'v2.1.2',
  releaseUrl: 'https://github.com/HeiSir2014/antigravity-app/releases/tag/v2.1.2',
  androidApkUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/app-universal-release.apk',
  androidApkSize: '25.24 MB',
  macosDmgUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity_2.1.2_aarch64.dmg',
  macosDmgSize: '2.66 MB',
  windowsExeUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity_2.1.2_x64-setup.exe',
  windowsExeSize: '1.89 MB',
  windowsMsiUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity_2.1.2_x64_en-US.msi',
  linuxDebUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity_2.1.2_amd64.deb',
  linuxDebSize: '2.47 MB',
  linuxAppImageUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity_2.1.2_amd64.AppImage',
  linuxRpmUrl:
    'https://github.com/HeiSir2014/antigravity-app/releases/download/v2.1.2/Antigravity-2.1.2-1.x86_64.rpm',
  webBundleSize: '171 KB',
};

const CACHE_TTL_MS = 5 * 60 * 1000;
const RETRY_BACKOFF_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 6000;

let cachedRelease: { data: ReleaseAssetSummary; fetchedAt: number; ok: boolean } | null = null;
let inFlightFetch: Promise<ReleaseAssetSummary> | null = null;

function fmtMB(bytes: number | undefined, fallback: string): string {
  if (!bytes || bytes <= 0) return fallback;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function fetchLatestReleaseFromGitHub(): Promise<ReleaseAssetSummary> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'antigravity-portal/2.1',
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const resp = await fetch('https://api.github.com/repos/HeiSir2014/antigravity-app/releases/latest', {
      headers,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
    const json = (await resp.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    const assets = json.assets || [];
    const find = (pred: (name: string) => boolean) => assets.find((a) => pred(a.name));
    const apk = find((n) => n.endsWith('.apk'));
    const dmg = find((n) => n.endsWith('.dmg'));
    const exe = find((n) => n.endsWith('.exe'));
    const msi = find((n) => n.endsWith('.msi'));
    const deb = find((n) => n.endsWith('.deb'));
    const appImage = find((n) => n.endsWith('.AppImage'));
    const rpm = find((n) => n.endsWith('.rpm'));
    const bundle = find((n) => n === 'web-bundle.tar.gz');

    const summary: ReleaseAssetSummary = {
      version: json.tag_name || DEFAULT_RELEASE.version,
      releaseUrl: json.html_url || DEFAULT_RELEASE.releaseUrl,
      androidApkUrl: apk?.browser_download_url || DEFAULT_RELEASE.androidApkUrl,
      androidApkSize: fmtMB(apk?.size, DEFAULT_RELEASE.androidApkSize),
      macosDmgUrl: dmg?.browser_download_url || DEFAULT_RELEASE.macosDmgUrl,
      macosDmgSize: fmtMB(dmg?.size, DEFAULT_RELEASE.macosDmgSize),
      windowsExeUrl: exe?.browser_download_url || DEFAULT_RELEASE.windowsExeUrl,
      windowsExeSize: fmtMB(exe?.size, DEFAULT_RELEASE.windowsExeSize),
      windowsMsiUrl: msi?.browser_download_url || DEFAULT_RELEASE.windowsMsiUrl,
      linuxDebUrl: deb?.browser_download_url || DEFAULT_RELEASE.linuxDebUrl,
      linuxDebSize: fmtMB(deb?.size, DEFAULT_RELEASE.linuxDebSize),
      linuxAppImageUrl: appImage?.browser_download_url || DEFAULT_RELEASE.linuxAppImageUrl,
      linuxRpmUrl: rpm?.browser_download_url || DEFAULT_RELEASE.linuxRpmUrl,
      webBundleSize: fmtMB(bundle?.size, DEFAULT_RELEASE.webBundleSize),
    };
    cachedRelease = { data: summary, fetchedAt: Date.now(), ok: true };
    return summary;
  } catch {
    const fallback = cachedRelease?.ok ? cachedRelease.data : DEFAULT_RELEASE;
    cachedRelease = { data: fallback, fetchedAt: Date.now(), ok: false };
    return fallback;
  } finally {
    clearTimeout(timer);
    inFlightFetch = null;
  }
}

export async function getLatestReleaseSummary(forceRefresh = false): Promise<ReleaseAssetSummary> {
  const now = Date.now();
  if (!forceRefresh && cachedRelease) {
    const ttl = cachedRelease.ok ? CACHE_TTL_MS : RETRY_BACKOFF_MS;
    if (now - cachedRelease.fetchedAt < ttl) {
      return cachedRelease.data;
    }
    if (cachedRelease.ok) {
      if (!inFlightFetch) {
        inFlightFetch = fetchLatestReleaseFromGitHub();
      }
      return cachedRelease.data;
    }
  }
  if (!inFlightFetch) {
    inFlightFetch = fetchLatestReleaseFromGitHub();
  }
  return inFlightFetch;
}

export function getCachedReleaseVersion(): string {
  return cachedRelease?.data.version || DEFAULT_RELEASE.version;
}

export function startReleaseRefreshLoop(): void {
  void getLatestReleaseSummary(true);
  const timer = setInterval(() => {
    void getLatestReleaseSummary(true);
  }, CACHE_TTL_MS);
  if (typeof timer === 'object' && 'unref' in timer) {
    timer.unref();
  }
}

const LOGO_SVG = `<svg class="brand-svg" viewBox="0 0 100 100" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="ag-portal-grad" x1="18" y1="88" x2="82" y2="12" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#3B82F6"/>
      <stop offset="38%" stop-color="#06B6D4"/>
      <stop offset="68%" stop-color="#F59E0B"/>
      <stop offset="100%" stop-color="#EF4444"/>
    </linearGradient>
  </defs>
  <path d="M50 11C42.2 11 36.2 17.6 31.6 28.4L14.8 73.2C11.9 80.7 16.5 87.8 23.6 87.8C29.1 87.8 33.4 83.4 36.4 76.2C40.1 67.3 44.5 62.6 50 62.6C55.5 62.6 59.9 67.3 63.6 76.2C66.6 83.4 70.9 87.8 76.4 87.8C83.5 87.8 88.1 80.7 85.2 73.2L68.4 28.4C63.8 17.6 57.8 11 50 11Z" fill="url(#ag-portal-grad)"/>
</svg>`;

export function renderPortalPage(opts: {
  release: ReleaseAssetSummary;
  oauthConfigured: boolean;
  lang: 'zh' | 'en';
}): string {
  const { release, oauthConfigured, lang } = opts;
  const zh = lang === 'zh';
  const otherLangHref = zh ? '/?lang=en' : '/?lang=zh';
  const otherLangLabel = zh ? 'EN' : '中文';

  const t = {
    pageTitle: zh
      ? 'Antigravity — 开源全平台 AI 远程编程客户端'
      : 'Antigravity — Open-Source Native AI Remote Coding Client',
    navFeatures: zh ? '核心特性' : 'Features',
    navShowcase: zh ? '界面预览' : 'Showcase',
    navDownload: zh ? '全平台下载' : 'Download',
    navSelfHost: zh ? '自托管' : 'Self-Host',
    syncOnline: oauthConfigured
      ? zh
        ? '云同步 · OAuth 已就绪'
        : 'Sync · OAuth Ready'
      : zh
        ? '云同步运行中'
        : 'Sync Online',
    eyebrow: zh
      ? `开源免费 · 纯原生 Tauri v2 + Rust · 100% 由 Gemini 4 Neon 开发`
      : `Open Source · Pure Native Tauri v2 + Rust · 100% Built by Gemini 4 Neon`,
    heroTitle: zh
      ? '把所有 AI 远程工作站，\n装进口袋与桌面。'
      : 'Every AI coding workstation,\nunified in one native app.',
    heroSub: zh
      ? '无需逐台切换设备。Antigravity 以 Rust 原生协议引擎并发聚合你的多账号、多机器远程会话，提供媲美 Claude Mobile & Desktop 的丝滑审批、Diff 审查、Artifact 预览与 AES-256-GCM 端到端云同步。'
      : 'Stop picking machines one by one. Antigravity concurrently aggregates every remote session across all accounts and devices in pure Rust — with Claude-grade approval cards, diff review, rich artifacts, and AES-256-GCM cloud sync.',
    ctaPrimaryDefault: zh ? `下载最新版本 (${release.version})` : `Download ${release.version}`,
    ctaAllPlatforms: zh ? '查看全部平台' : 'All Platforms',
    ctaGithub: 'GitHub',
    statDesktop: zh ? 'macOS / Win 安装包' : 'Desktop Installer',
    statDelta: zh ? '增量热更新包' : 'Delta Hot-Update',
    statCrypto: zh ? '云端密钥库加密' : 'Vault Encryption',
    statLicense: zh ? '开源可审计' : 'Open Source',
    showcaseEyebrow: zh ? 'REAL UI · 97/100 视觉打磨' : 'REAL UI · 97/100 VISUAL POLISH',
    showcaseTitle: zh ? '移动端与桌面端自适应，每一帧都像原生旗舰' : 'Adaptive Mobile & Desktop UX, crafted down to the pixel',
    showcaseSub: zh
      ? '采用温暖米白 / 深曜石双主题、安全区手势与 44px 触控靶心；桌面端自动切换为 280px 持久化侧边栏分屏布局。'
      : 'Warm alabaster & obsidian themes, safe-area ergonomics, and automatic 280px split-pane sidebar layout on desktop viewports.',
    featuresEyebrow: zh ? 'ARCHITECTURE' : 'ARCHITECTURE',
    featuresTitle: zh ? '为重度 AI 编程开发者而设计' : 'Engineered for power AI coding workflows',
    downloadEyebrow: zh ? `RELEASE ${release.version.toUpperCase()}` : `RELEASE ${release.version.toUpperCase()}`,
    downloadTitle: zh ? '全平台原生客户端下载' : 'Download for Every Platform',
    downloadSub: zh
      ? '所有二进制包均由 GitHub Actions 自动编译发布，支持客户端内一键检查更新与 SHA-256 校验。'
      : 'Every installer is transparently built via GitHub Actions with built-in update checking and SHA-256 verification.',
    selfHostTitle: zh ? '30 秒自托管你的专属云同步服务' : 'Self-Host Your Own Sync Vault in 30 Seconds',
    selfHostSub: zh
      ? '不想依赖公共节点？使用内置的 Bun + SQLite + Docker 服务端，一条命令即可在自有服务器部署，支持 AES-256-GCM 静态加密与一键 Google OIDC 登录。'
      : 'Prefer full ownership? Deploy our zero-dependency Bun + SQLite Docker server on your own VPS with AES-256-GCM encryption and 1-Tap Google OIDC.',
    copyCmd: zh ? '复制命令' : 'Copy',
    copiedCmd: zh ? '已复制 ✓' : 'Copied ✓',
    footerPrivacy: zh ? '隐私政策' : 'Privacy',
    footerTerms: zh ? '服务条款' : 'Terms',
    footerHealth: zh ? '服务状态' : 'Status',
    footerCredit: zh
      ? '本项目 100% 代码均由 Gemini 4 Neon 驱动开发 · MIT 开源协议'
      : '100% of code crafted by Gemini 4 Neon · Open Source under MIT',
  };

  const screenshots = [
    {
      id: 'timeline-dark',
      label: zh ? '对话与审批卡片' : 'Chat & Approvals',
      caption: zh
        ? '终端命令实时审批、AskUserQuestion 交互卡片与快捷 Slash 指令坞'
        : 'Live terminal approval cards, AskUserQuestion prompts & slash command dock',
      src: '/assets/screenshots/timeline-dark.png',
    },
    {
      id: 'drawer-multi-account',
      label: zh ? '多账号 × 多设备聚合' : 'Multi-Device Hub',
      caption: zh
        ? '无需先选机器！一键切换统一视图、按账号分组或按设备分组'
        : 'Skip machine picking — switch between Unified, By Account, and By Device views',
      src: '/assets/screenshots/drawer-multi-account.png',
    },
    {
      id: 'diff-preview',
      label: zh ? 'Diff 与 Artifact 预览' : 'Diff & Artifacts',
      caption: zh
        ? '内置代码修改可视化 Diff、HTML/SVG/Mermaid 沙箱预览与全屏图片灯箱'
        : 'Visual unified diff viewer, HTML/SVG/Mermaid artifact sandbox & image lightbox',
      src: '/assets/screenshots/diff-preview.png',
    },
    {
      id: 'model-quota',
      label: zh ? '模型切换与配额' : 'Models & Quota',
      caption: zh
        ? '实时查看各模型配额进度条，一键切换 Gemini / Claude / 思考预算'
        : 'Live model quota bars with 1-tap switching across Gemini, Claude & thinking modes',
      src: '/assets/screenshots/model-quota.png',
    },
    {
      id: 'settings-account',
      label: zh ? '云端加密 Vault 同步' : 'Encrypted Cloud Sync',
      caption: zh
        ? '一键 Google SSO 登录后，PC 与手机端加密同步所有工作站账号'
        : '1-Tap Google SSO syncs your encrypted multi-account vault across PC and mobile',
      src: '/assets/screenshots/settings-account.png',
    },
    {
      id: 'timeline-light',
      label: zh ? '温暖米白浅色模式' : 'Warm Alabaster Light',
      caption: zh
        ? '高对比度护眼米白主题，自动跟随系统深浅色切换'
        : 'High-contrast warm alabaster light theme adapting automatically to system preference',
      src: '/assets/screenshots/timeline-light.png',
    },
  ];

  const features = [
    {
      badge: '01 · RUST ENGINE',
      title: zh ? '多账号 × 多设备并发聚合' : 'Multi-Account × Multi-Device Fan-Out',
      desc: zh
        ? '直接通过 Rust HTTP/2 原生调用 boq-jetski 与 LanguageServerService，打破“先选机器再看会话”的割裂体验。'
        : 'Native Rust HTTP/2 protocol engine fans out across every online workstation concurrently — all sessions in one unified feed.',
    },
    {
      badge: '02 · ADAPTIVE UX',
      title: zh ? '桌面端 + 移动端双形态自适应' : 'Claude Mobile & Desktop Adaptive UI',
      desc: zh
        ? '手机端单手抽屉 + 底部 Sheet + 原生 IME 避让；桌面宽屏自动展开 280px 持久化侧边栏与居中阅读列。'
        : 'Touch-optimized bottom sheets & IME ergonomics on mobile; automatic 280px collapsible sidebar split-pane on desktop.',
    },
    {
      badge: '03 · ZERO-KNOWLEDGE',
      title: zh ? '一键 Google SSO 与 AES-256-GCM' : '1-Tap Google SSO & AES-256-GCM Vault',
      desc: zh
        ? 'PC 端与手机端通过 OIDC 零代理登录，账号 Cookie Vault 经 AES-256-GCM 静态加密，一键 Push / Pull 跨端同步。'
        : 'Zero-proxy OIDC sign-in with AES-256-GCM encrypted vault storage — sync all accounts between PC and phone in one tap.',
    },
    {
      badge: '04 · DELTA OTA',
      title: zh
        ? `两级智能更新（${release.webBundleSize} 热更）`
        : `Two-Tier Auto-Updater (${release.webBundleSize} Delta)`,
      desc: zh
        ? `界面与交互迭代仅需拉取 ~${release.webBundleSize} 增量包；原生内核升级自动校验 SHA-256 并流式下载最新安装包。`
        : `UI updates ship as ~${release.webBundleSize} incremental bundles; native upgrades download directly from GitHub Releases with SHA-256 verification.`,
    },
    {
      badge: '05 · RICH PREVIEWS',
      title: zh ? 'Hunk Diff、多级模型配额与待发队列' : 'Hunk Diff, 2-Level Model Picker & Queue',
      desc: zh
        ? '代码 Hunk Diff 审查、远程工作站本地图片渲染、两级模型与思考强度切换、5 小时/每周配额条、多条消息待发队列与 AskUserQuestion 审批一应俱全。'
        : 'Hunk-based code diff viewer, remote workstation image rendering, 2-level model & thinking effort picker, 5h/weekly quota bars, multi-item pending queue & AskUserQuestion cards.',
    },
    {
      badge: '06 · ULTRA LIGHT',
      title: zh ? '告别 Electron 臃肿，体积缩小 30×' : '30× Smaller Than Electron',
      desc: zh
        ? `基于 Tauri v2 + Rust (opt-level="z" + LTO + strip symbols)，macOS 安装包仅 ${release.macosDmgSize}，Windows 仅 ${release.windowsExeSize}。`
        : `Built with Tauri v2 + Rust (opt-level="z", LTO, stripped symbols) — just ${release.macosDmgSize} on macOS and ${release.windowsExeSize} on Windows.`,
    },
  ];

  const selfHostCmd = `git clone https://github.com/HeiSir2014/antigravity-app.git
cd antigravity-app/server
cp .env.example .env
docker compose up -d --build`;

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <meta name="description" content="${escapeHtml(t.heroSub)}" />
  <title>${escapeHtml(t.pageTitle)}</title>
  <style>
    :root {
      --bg-light: #faf9f5;
      --bg-dark: #141413;
      --surface-light: rgba(255, 255, 255, 0.84);
      --surface-dark: rgba(26, 26, 24, 0.84);
      --subtle-light: #f2f0e8;
      --subtle-dark: #201f1d;
      --border-light: rgba(20, 20, 19, 0.09);
      --border-dark: rgba(250, 249, 245, 0.10);
      --border-strong-light: rgba(20, 20, 19, 0.16);
      --border-strong-dark: rgba(250, 249, 245, 0.18);
      --text-light: #141413;
      --text-dark: #f5f4ef;
      --muted-light: #64625b;
      --muted-dark: #9e9c93;
      --accent-light: #d97757;
      --accent-dark: #e08364;
      --accent-hover-light: #c36242;
      --accent-hover-dark: #ec9274;
      --success-light: #15803d;
      --success-dark: #4ade80;
      --success-bg-light: rgba(21, 128, 61, 0.10);
      --success-bg-dark: rgba(74, 222, 128, 0.14);
      --shadow-light: 0 24px 64px -24px rgba(20, 20, 19, 0.14), 0 1px 3px rgba(20, 20, 19, 0.04);
      --shadow-dark: 0 28px 72px -20px rgba(0, 0, 0, 0.65), 0 1px 0 rgba(255, 255, 255, 0.04) inset;

      --bg: var(--bg-light);
      --surface: var(--surface-light);
      --subtle: var(--subtle-light);
      --border: var(--border-light);
      --border-strong: var(--border-strong-light);
      --text: var(--text-light);
      --muted: var(--muted-light);
      --accent: var(--accent-light);
      --accent-hover: var(--accent-hover-light);
      --success: var(--success-light);
      --success-bg: var(--success-bg-light);
      --shadow: var(--shadow-light);

      @media (prefers-color-scheme: dark) {
        --bg: var(--bg-dark);
        --surface: var(--surface-dark);
        --subtle: var(--subtle-dark);
        --border: var(--border-dark);
        --border-strong: var(--border-strong-dark);
        --text: var(--text-dark);
        --muted: var(--muted-dark);
        --accent: var(--accent-dark);
        --accent-hover: var(--accent-hover-dark);
        --success: var(--success-dark);
        --success-bg: var(--success-bg-dark);
        --shadow: var(--shadow-dark);
      }

      @supports (color: light-dark(white, black)) {
        --bg: light-dark(var(--bg-light), var(--bg-dark));
        --surface: light-dark(var(--surface-light), var(--surface-dark));
        --subtle: light-dark(var(--subtle-light), var(--subtle-dark));
        --border: light-dark(var(--border-light), var(--border-dark));
        --border-strong: light-dark(var(--border-strong-light), var(--border-strong-dark));
        --text: light-dark(var(--text-light), var(--text-dark));
        --muted: light-dark(var(--muted-light), var(--muted-dark));
        --accent: light-dark(var(--accent-light), var(--accent-dark));
        --accent-hover: light-dark(var(--accent-hover-light), var(--accent-hover-dark));
        --success: light-dark(var(--success-light), var(--success-dark));
        --success-bg: light-dark(var(--success-bg-light), var(--success-bg-dark));
      }

      color-scheme: light dark;
      accent-color: var(--accent);
    }

    *, *::before, *::after { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100dvh;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      line-height: 1.55;
      overflow-x: hidden;
    }

    .bg-aura {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      background:
        radial-gradient(900px 520px at 50% -6%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
        radial-gradient(620px 440px at 88% 24%, rgba(59, 130, 246, 0.09), transparent 70%),
        radial-gradient(520px 420px at 12% 76%, rgba(6, 182, 212, 0.07), transparent 70%);
    }

    .container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 1120px;
      margin: 0 auto;
      padding: 0 20px;
    }

    /* Sticky Topbar */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 40;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      background: color-mix(in srgb, var(--bg) 78%, transparent);
      border-bottom: 1px solid var(--border);
    }

    .topbar-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      height: 64px;
    }

    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text);
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.02em;
    }

    .brand-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: var(--subtle);
      border: 1px solid var(--border);
      display: grid;
      place-items: center;
    }

    .brand-svg { width: 22px; height: 22px; display: block; }

    .ver-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--subtle);
      border: 1px solid var(--border);
      color: var(--muted);
    }

    .nav-links {
      display: none;
      align-items: center;
      gap: 24px;
    }

    @media (min-width: 820px) {
      .nav-links { display: flex; }
    }

    .nav-links a {
      color: var(--muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: color 140ms ease;
    }

    .nav-links a:hover { color: var(--text); }

    .nav-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .status-chip {
      display: none;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 550;
      padding: 6px 11px;
      border-radius: 999px;
      background: var(--success-bg);
      color: var(--success);
      text-decoration: none;
    }

    @media (min-width: 640px) {
      .status-chip { display: inline-flex; }
    }

    .live-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--success);
    }

    .lang-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      font-size: 12.5px;
      font-weight: 600;
      text-decoration: none;
      transition: border-color 140ms ease, background-color 140ms ease;
    }

    .lang-btn:hover { border-color: var(--border-strong); background: var(--subtle); }

    /* Hero */
    .hero {
      padding: clamp(56px, 8vw, 96px) 0 clamp(44px, 6vw, 72px);
      text-align: center;
    }

    .eyebrow-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface);
      font-size: 12.5px;
      font-weight: 550;
      color: var(--muted);
      margin-bottom: 22px;
    }

    .eyebrow-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--accent);
    }

    .hero-title {
      margin: 0 auto 20px;
      max-width: 820px;
      font-size: clamp(2.15rem, 1.4rem + 3vw, 3.85rem);
      line-height: 1.08;
      font-weight: 760;
      letter-spacing: -0.035em;
      white-space: pre-line;
    }

    .hero-sub {
      margin: 0 auto 32px;
      max-width: 660px;
      font-size: clamp(1rem, 0.92rem + 0.35vw, 1.15rem);
      color: var(--muted);
      line-height: 1.65;
    }

    .hero-ctas {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 40px;
    }

    .btn {
      appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 48px;
      padding: 0 22px;
      border-radius: 14px;
      border: 1px solid transparent;
      font-family: inherit;
      font-size: 15px;
      font-weight: 620;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease, transform 150ms ease;
    }

    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .btn-primary {
      background: var(--accent);
      color: #ffffff;
      box-shadow: 0 12px 28px -12px color-mix(in srgb, var(--accent) 70%, transparent);
    }

    .btn-primary:hover { background: var(--accent-hover); }

    .btn-secondary {
      background: var(--surface);
      border-color: var(--border);
      color: var(--text);
    }

    .btn-secondary:hover { background: var(--subtle); border-color: var(--border-strong); }

    @media (prefers-reduced-motion: no-preference) {
      .btn:active { transform: translateY(1px); }
    }

    .stats-bar {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      max-width: 780px;
      margin: 0 auto;
    }

    @media (min-width: 680px) {
      .stats-bar { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    .stat {
      padding: 14px 16px;
      border-radius: 16px;
      background: var(--surface);
      border: 1px solid var(--border);
      text-align: left;
    }

    .stat-val {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 2px;
    }

    .stat-label {
      font-size: 12px;
      color: var(--muted);
    }

    /* Section chrome */
    section {
      padding: clamp(48px, 6vw, 84px) 0;
    }

    .section-head {
      text-align: center;
      max-width: 680px;
      margin: 0 auto 36px;
    }

    .section-eyebrow {
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.12em;
      color: var(--accent);
      margin-bottom: 10px;
      text-transform: uppercase;
    }

    .section-title {
      margin: 0 0 12px;
      font-size: clamp(1.55rem, 1.2rem + 1.6vw, 2.35rem);
      font-weight: 720;
      letter-spacing: -0.03em;
      line-height: 1.18;
    }

    .section-sub {
      margin: 0;
      font-size: 15px;
      color: var(--muted);
    }

    /* Interactive Screenshot Showcase */
    .showcase-shell {
      border-radius: 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
      padding: clamp(18px, 3vw, 32px);
    }

    .showcase-tabs {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
    }

    .tab-btn {
      appearance: none;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      padding: 8px 14px;
      border-radius: 999px;
      cursor: pointer;
      min-height: 36px;
      transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
    }

    .tab-btn:hover { color: var(--text); border-color: var(--border-strong); }
    .tab-btn[aria-selected="true"] {
      background: var(--accent);
      border-color: var(--accent);
      color: #ffffff;
    }

    .showcase-stage {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      align-items: center;
    }

    @media (min-width: 820px) {
      .showcase-stage {
        grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
      }
    }

    .phone-stage {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 16px;
      padding: 8px 0;
    }

    .phone-frame {
      width: min(296px, 78vw);
      aspect-ratio: 390 / 844;
      border-radius: 34px;
      padding: 8px;
      background: var(--subtle);
      border: 1px solid var(--border-strong);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .phone-frame img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 26px;
      display: block;
    }

    .showcase-info {
      text-align: left;
      padding: 8px 4px;
    }

    .showcase-info h3 {
      margin: 0 0 10px;
      font-size: 22px;
      letter-spacing: -0.02em;
    }

    .showcase-info p {
      margin: 0 0 20px;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.65;
    }

    .thumb-strip {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .thumb-card {
      padding: 4px;
      border-radius: 14px;
      border: 1.5px solid var(--border);
      background: var(--subtle);
      cursor: pointer;
      transition: border-color 140ms ease, opacity 140ms ease;
      opacity: 0.72;
    }

    .thumb-card:hover, .thumb-card.active {
      border-color: var(--accent);
      opacity: 1;
    }

    .thumb-card img {
      width: 100%;
      aspect-ratio: 390 / 844;
      object-fit: cover;
      border-radius: 10px;
      display: block;
    }

    /* Feature Bento Grid */
    .bento-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }

    .bento-card {
      container-type: inline-size;
      padding: 24px;
      border-radius: 22px;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .bento-badge {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      color: var(--accent);
    }

    .bento-card h3 {
      margin: 0;
      font-size: 18px;
      letter-spacing: -0.02em;
    }

    .bento-card p {
      margin: 0;
      font-size: 14px;
      color: var(--muted);
      line-height: 1.6;
    }

    /* Download Grid */
    .download-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(245px, 1fr));
      gap: 16px;
    }

    .dl-card {
      container-type: inline-size;
      padding: 24px 22px;
      border-radius: 22px;
      background: var(--surface);
      border: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      transition: border-color 150ms ease;
    }

    .dl-card.recommended {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
      box-shadow: 0 18px 46px -22px color-mix(in srgb, var(--accent) 40%, transparent);
    }

    .dl-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .dl-os {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .dl-size {
      font-size: 11.5px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      background: var(--subtle);
      color: var(--muted);
    }

    .dl-desc {
      margin: 8px 0 0;
      font-size: 13.5px;
      color: var(--muted);
    }

    .dl-actions {
      display: grid;
      gap: 8px;
    }

    .dl-btn {
      min-height: 42px;
      border-radius: 12px;
      font-size: 13.5px;
      padding: 0 14px;
    }

    .dl-alt-row {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12.5px;
    }

    .dl-alt-row a {
      color: var(--muted);
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    .dl-alt-row a:hover { color: var(--text); }

    /* Self-Host Block */
    .selfhost-card {
      border-radius: 24px;
      background: var(--surface);
      border: 1px solid var(--border);
      padding: clamp(22px, 3.5vw, 36px);
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
      align-items: center;
    }

    @media (min-width: 820px) {
      .selfhost-card {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
    }

    .code-box {
      position: relative;
      border-radius: 16px;
      background: #141413;
      color: #f5f4ef;
      border: 1px solid rgba(255, 255, 255, 0.10);
      padding: 18px;
      overflow-x: auto;
      color-scheme: dark;
    }

    .code-box pre {
      margin: 0;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.65;
    }

    .copy-code-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      min-height: 30px;
      padding: 0 10px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: #f5f4ef;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }

    .copy-code-btn:hover { background: rgba(255, 255, 255, 0.16); }

    /* Footer */
    footer.site-footer {
      margin-top: 24px;
      padding: 28px 0 40px;
      border-top: 1px solid var(--border);
      font-size: 13px;
      color: var(--muted);
    }

    .footer-inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    .footer-links {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
    }

    .footer-links a {
      color: var(--muted);
      text-decoration: none;
    }

    .footer-links a:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="bg-aura" aria-hidden="true"></div>

  <header class="topbar">
    <div class="container topbar-inner">
      <a class="brand" href="/">
        <span class="brand-icon">${LOGO_SVG}</span>
        <span>Antigravity</span>
        <span class="ver-pill">${escapeHtml(release.version)}</span>
      </a>

      <nav class="nav-links" aria-label="Main navigation">
        <a href="#showcase">${escapeHtml(t.navShowcase)}</a>
        <a href="#features">${escapeHtml(t.navFeatures)}</a>
        <a href="#download">${escapeHtml(t.navDownload)}</a>
        <a href="#selfhost">${escapeHtml(t.navSelfHost)}</a>
      </nav>

      <div class="nav-actions">
        <a class="status-chip" href="/health">
          <span class="live-dot" aria-hidden="true"></span>
          <span>${escapeHtml(t.syncOnline)}</span>
        </a>
        <a class="lang-btn" href="${otherLangHref}">${otherLangLabel}</a>
      </div>
    </div>
  </header>

  <main>
    <!-- Hero -->
    <section class="hero">
      <div class="container">
        <div class="eyebrow-pill">
          <span class="eyebrow-dot" aria-hidden="true"></span>
          <span>${escapeHtml(t.eyebrow)}</span>
        </div>

        <h1 class="hero-title">${escapeHtml(t.heroTitle)}</h1>
        <p class="hero-sub">${escapeHtml(t.heroSub)}</p>

        <div class="hero-ctas">
          <a class="btn btn-primary" id="hero-primary-dl" href="${escapeHtml(release.releaseUrl)}">
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 3v9.5m0 0l-3.8-3.8M10 12.5l3.8-3.8M4 15.5h12" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span id="hero-dl-label">${escapeHtml(t.ctaPrimaryDefault)}</span>
          </a>
          <a class="btn btn-secondary" href="#download">${escapeHtml(t.ctaAllPlatforms)}</a>
          <a class="btn btn-secondary" href="https://github.com/HeiSir2014/antigravity-app" target="_blank" rel="noopener noreferrer">${escapeHtml(t.ctaGithub)}</a>
        </div>

        <div class="stats-bar">
          <div class="stat">
            <div class="stat-val">${escapeHtml(release.macosDmgSize)}</div>
            <div class="stat-label">${escapeHtml(t.statDesktop)}</div>
          </div>
          <div class="stat">
            <div class="stat-val">${escapeHtml(release.webBundleSize)}</div>
            <div class="stat-label">${escapeHtml(t.statDelta)}</div>
          </div>
          <div class="stat">
            <div class="stat-val">AES-256-GCM</div>
            <div class="stat-label">${escapeHtml(t.statCrypto)}</div>
          </div>
          <div class="stat">
            <div class="stat-val">MIT</div>
            <div class="stat-label">${escapeHtml(t.statLicense)}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- Real UI Showcase -->
    <section id="showcase">
      <div class="container">
        <div class="section-head">
          <div class="section-eyebrow">${escapeHtml(t.showcaseEyebrow)}</div>
          <h2 class="section-title">${escapeHtml(t.showcaseTitle)}</h2>
          <p class="section-sub">${escapeHtml(t.showcaseSub)}</p>
        </div>

        <div class="showcase-shell">
          <div class="showcase-tabs" role="tablist" aria-label="App screenshots">
            ${screenshots
              .map(
                (s, idx) =>
                  `<button type="button" class="tab-btn" role="tab" aria-selected="${idx === 0 ? 'true' : 'false'}" data-idx="${idx}">${escapeHtml(s.label)}</button>`
              )
              .join('')}
          </div>

          <div class="showcase-stage">
            <div class="phone-stage">
              <div class="phone-frame">
                <img id="stage-img" src="${screenshots[0].src}" alt="${escapeHtml(screenshots[0].label)}" loading="eager" decoding="async" />
              </div>
            </div>
            <div class="showcase-info">
              <h3 id="stage-title">${escapeHtml(screenshots[0].label)}</h3>
              <p id="stage-caption">${escapeHtml(screenshots[0].caption)}</p>
              <div class="thumb-strip">
                ${screenshots
                  .map(
                    (s, idx) =>
                      `<button type="button" class="thumb-card ${idx === 0 ? 'active' : ''}" data-idx="${idx}" aria-label="${escapeHtml(s.label)}"><img src="${s.src}" alt="${escapeHtml(s.label)}" loading="lazy" decoding="async" /></button>`
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Features Bento -->
    <section id="features">
      <div class="container">
        <div class="section-head">
          <div class="section-eyebrow">${escapeHtml(t.featuresEyebrow)}</div>
          <h2 class="section-title">${escapeHtml(t.featuresTitle)}</h2>
        </div>

        <div class="bento-grid">
          ${features
            .map(
              (f) => `<article class="bento-card">
                <div class="bento-badge">${escapeHtml(f.badge)}</div>
                <h3>${escapeHtml(f.title)}</h3>
                <p>${escapeHtml(f.desc)}</p>
              </article>`
            )
            .join('')}
        </div>
      </div>
    </section>

    <!-- Multi-Platform Download Hub -->
    <section id="download">
      <div class="container">
        <div class="section-head">
          <div class="section-eyebrow">${escapeHtml(t.downloadEyebrow)}</div>
          <h2 class="section-title">${escapeHtml(t.downloadTitle)}</h2>
          <p class="section-sub">${escapeHtml(t.downloadSub)}</p>
        </div>

        <div class="download-grid">
          <article class="dl-card" data-os="android">
            <div>
              <div class="dl-head">
                <span class="dl-os">Android</span>
                <span class="dl-size">${escapeHtml(release.androidApkSize)}</span>
              </div>
              <p class="dl-desc">${zh ? `Android 8.0+ · 支持边缘手势、原生输入法避让与 ${escapeHtml(release.webBundleSize)} 增量热更` : `Android 8.0+ · Native IME ergonomics & ${escapeHtml(release.webBundleSize)} delta updates`}</p>
            </div>
            <div class="dl-actions">
              <a class="btn btn-primary dl-btn" href="${escapeHtml(release.androidApkUrl)}">${zh ? '下载 APK 安装包' : 'Download APK'}</a>
              <div class="dl-alt-row">
                <a href="${escapeHtml(release.releaseUrl)}" target="_blank" rel="noopener noreferrer">${zh ? 'GitHub Releases 校验页' : 'Release Notes & SHA-256'}</a>
              </div>
            </div>
          </article>

          <article class="dl-card" data-os="macos">
            <div>
              <div class="dl-head">
                <span class="dl-os">macOS</span>
                <span class="dl-size">${escapeHtml(release.macosDmgSize)}</span>
              </div>
              <p class="dl-desc">${zh ? 'Apple Silicon (M1–M4) 原生双栏桌面端，零 Electron 内存占用' : 'Apple Silicon (M1–M4) native split-pane desktop app'}</p>
            </div>
            <div class="dl-actions">
              <a class="btn btn-primary dl-btn" href="${escapeHtml(release.macosDmgUrl)}">${zh ? '下载 Apple Silicon (.dmg)' : 'Download Apple Silicon (.dmg)'}</a>
              <div class="dl-alt-row">
                <a href="${escapeHtml(release.releaseUrl)}" target="_blank" rel="noopener noreferrer">${zh ? '全部 macOS 产物' : 'All macOS Assets'}</a>
              </div>
            </div>
          </article>

          <article class="dl-card" data-os="windows">
            <div>
              <div class="dl-head">
                <span class="dl-os">Windows</span>
                <span class="dl-size">${escapeHtml(release.windowsExeSize)}</span>
              </div>
              <p class="dl-desc">${zh ? 'Windows 10 / 11 (x64) · WebView2 原生轻量化桌面客户端' : 'Windows 10 / 11 (x64) · Lightweight WebView2 native app'}</p>
            </div>
            <div class="dl-actions">
              <a class="btn btn-primary dl-btn" href="${escapeHtml(release.windowsExeUrl)}">${zh ? '下载安装程序 (.exe)' : 'Download Setup (.exe)'}</a>
              <div class="dl-alt-row">
                <a href="${escapeHtml(release.windowsMsiUrl)}">${zh ? 'MSI 企业安装包' : 'MSI Installer'}</a>
              </div>
            </div>
          </article>

          <article class="dl-card" data-os="linux">
            <div>
              <div class="dl-head">
                <span class="dl-os">Linux</span>
                <span class="dl-size">${escapeHtml(release.linuxDebSize)}</span>
              </div>
              <p class="dl-desc">${zh ? 'Ubuntu / Debian / Fedora / Arch (x64) 原生 GTK/WebKit 客户端' : 'Ubuntu / Debian / Fedora / Arch (x64) native client'}</p>
            </div>
            <div class="dl-actions">
              <a class="btn btn-primary dl-btn" href="${escapeHtml(release.linuxDebUrl)}">${zh ? '下载 Debian/Ubuntu (.deb)' : 'Download .deb'}</a>
              <div class="dl-alt-row">
                <a href="${escapeHtml(release.linuxAppImageUrl)}">AppImage</a>
                <a href="${escapeHtml(release.linuxRpmUrl)}">RPM</a>
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Self-Host -->
    <section id="selfhost">
      <div class="container">
        <div class="selfhost-card">
          <div>
            <div class="section-eyebrow">SELF-HOST · BUN + SQLITE</div>
            <h2 class="section-title" style="text-align:left;margin-bottom:12px;">${escapeHtml(t.selfHostTitle)}</h2>
            <p class="section-sub" style="text-align:left;">${escapeHtml(t.selfHostSub)}</p>
          </div>
          <div class="code-box">
            <button type="button" class="copy-code-btn" id="copy-selfhost">${escapeHtml(t.copyCmd)}</button>
            <pre><code id="selfhost-code">${escapeHtml(selfHostCmd)}</code></pre>
          </div>
        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <div>${escapeHtml(t.footerCredit)}</div>
      <div class="footer-links">
        <a href="https://github.com/HeiSir2014/antigravity-app" target="_blank" rel="noopener noreferrer">GitHub</a>
        <a href="${escapeHtml(release.releaseUrl)}" target="_blank" rel="noopener noreferrer">Releases (${escapeHtml(release.version)})</a>
        <a href="/privacy">${escapeHtml(t.footerPrivacy)}</a>
        <a href="/terms">${escapeHtml(t.footerTerms)}</a>
        <a href="/health">${escapeHtml(t.footerHealth)}</a>
      </div>
    </div>
  </footer>

  <script>
    (function () {
      var slides = ${JSON.stringify(screenshots)};
      var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab-btn'));
      var thumbs = Array.prototype.slice.call(document.querySelectorAll('.thumb-card'));
      var img = document.getElementById('stage-img');
      var title = document.getElementById('stage-title');
      var caption = document.getElementById('stage-caption');

      function selectSlide(idx) {
        var item = slides[idx];
        if (!item) return;
        if (img) { img.src = item.src; img.alt = item.label; }
        if (title) title.textContent = item.label;
        if (caption) caption.textContent = item.caption;
        tabs.forEach(function (el, i) { el.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });
        thumbs.forEach(function (el, i) { el.classList.toggle('active', i === idx); });
      }

      tabs.forEach(function (el) {
        el.addEventListener('click', function () { selectSlide(Number(el.getAttribute('data-idx') || 0)); });
      });
      thumbs.forEach(function (el) {
        el.addEventListener('click', function () { selectSlide(Number(el.getAttribute('data-idx') || 0)); });
      });

      // OS-aware smart hero CTA & recommended platform highlight
      var ua = navigator.userAgent || '';
      var dlMap = {
        android: { url: ${JSON.stringify(release.androidApkUrl)}, label: ${JSON.stringify(zh ? `下载 Android APK (${release.version})` : `Download for Android (${release.version})`)} },
        macos: { url: ${JSON.stringify(release.macosDmgUrl)}, label: ${JSON.stringify(zh ? `下载 macOS Apple Silicon (${release.macosDmgSize})` : `Download for macOS (${release.macosDmgSize})`)} },
        windows: { url: ${JSON.stringify(release.windowsExeUrl)}, label: ${JSON.stringify(zh ? `下载 Windows 安装包 (${release.windowsExeSize})` : `Download for Windows (${release.windowsExeSize})`)} },
        linux: { url: ${JSON.stringify(release.linuxDebUrl)}, label: ${JSON.stringify(zh ? `下载 Linux .deb (${release.linuxDebSize})` : `Download for Linux (${release.linuxDebSize})`)} }
      };
      var detected = /Android/i.test(ua) ? 'android'
        : /Macintosh|Mac OS X/i.test(ua) ? 'macos'
        : /Windows/i.test(ua) ? 'windows'
        : /Linux/i.test(ua) ? 'linux' : null;
      if (detected && dlMap[detected]) {
        var heroBtn = document.getElementById('hero-primary-dl');
        var heroLabel = document.getElementById('hero-dl-label');
        if (heroBtn) heroBtn.setAttribute('href', dlMap[detected].url);
        if (heroLabel) heroLabel.textContent = dlMap[detected].label;
        var card = document.querySelector('.dl-card[data-os="' + detected + '"]');
        if (card) card.classList.add('recommended');
      }

      // Copy self-host command
      var copyBtn = document.getElementById('copy-selfhost');
      var codeEl = document.getElementById('selfhost-code');
      if (copyBtn && codeEl) {
        copyBtn.addEventListener('click', function () {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(codeEl.textContent || '').then(function () {
              copyBtn.textContent = ${JSON.stringify(t.copiedCmd)};
              setTimeout(function () { copyBtn.textContent = ${JSON.stringify(t.copyCmd)}; }, 2000);
            });
          }
        });
      }
    })();
  </script>
</body>
</html>`;
}
