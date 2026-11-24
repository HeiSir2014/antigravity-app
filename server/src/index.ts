import { decryptVaultText, encryptVaultText, signJwt, verifyJwt } from './crypto';
import { getUserById, getVault, upsertUser, upsertVault } from './db';
import { renderLegalPage, renderOAuthErrorPage, renderOAuthHandoffPage } from './pages';
import {
  getCachedReleaseVersion,
  getLatestReleaseSummary,
  renderPortalPage,
  startReleaseRefreshLoop,
} from './portal';

const PORT = Number(process.env.PORT || 8787);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const ALLOW_DEV_SSO = process.env.ALLOW_DEV_SSO === 'true';

function isAllowedAppRedirect(uri: string): boolean {
  return (
    uri.startsWith('http://127.0.0.1:') ||
    uri.startsWith('http://localhost:') ||
    uri.startsWith('antigravity://auth/callback')
  );
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
};

function htmlPage(markup: string, status = 200): Response {
  return new Response(markup, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function authenticateRequest(req: Request): Promise<{ userId: string; email: string } | null> {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const payload = await verifyJwt(auth.slice(7).trim());
  if (!payload) return null;
  return { userId: payload.sub, email: payload.email };
}

function decodeGoogleIdTokenPayload(idToken: string): {
  sub: string;
  email: string;
  name: string;
  picture: string;
  aud: string;
  iss: string;
  exp: number;
  nonce?: string;
} {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed Google ID token');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
  const sub = String(payload.sub || '');
  const email = String(payload.email || '');
  const aud = String(payload.aud || '');
  const iss = String(payload.iss || '');
  const exp = Number(payload.exp || 0);
  if (!sub || !email) throw new Error('Google ID token missing sub or email');
  if (iss !== 'https://accounts.google.com' && iss !== 'accounts.google.com') {
    throw new Error('Invalid Google ID token issuer');
  }
  if (exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Google ID token expired');
  }
  if (GOOGLE_CLIENT_ID && aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Google ID token audience mismatch');
  }
  return {
    sub,
    email,
    name: String(payload.name || email.split('@')[0]),
    picture: String(payload.picture || ''),
    aud,
    iss,
    exp,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
  };
}

async function verifyGoogleIdToken(idToken: string): Promise<{
  sub: string;
  email: string;
  name: string;
  picture: string;
  nonce?: string;
}> {
  // Always validate claims locally first (works even on mainland China servers without outbound Google access)
  const local = decodeGoogleIdTokenPayload(idToken);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (resp.ok) {
      const info = (await resp.json()) as Record<string, string>;
      if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) {
        throw new Error('Google ID token audience mismatch');
      }
      return {
        sub: info.sub || local.sub,
        email: info.email || local.email,
        name: info.name || local.name,
        picture: info.picture || local.picture,
        nonce: local.nonce,
      };
    }
  } catch {
    // Fallback to validated OIDC id_token claims when server cannot directly reach oauth2.googleapis.com
  }
  return {
    sub: local.sub,
    email: local.email,
    name: local.name,
    picture: local.picture,
    nonce: local.nonce,
  };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const acceptLang = req.headers.get('accept-language');

    // Flagship Open-Source Portal & Multi-Platform Download Hub
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/' || url.pathname === '/download')) {
      const langParam = url.searchParams.get('lang');
      const lang: 'zh' | 'en' =
        langParam === 'en'
          ? 'en'
          : langParam === 'zh'
            ? 'zh'
            : acceptLang && /^zh\b|,\s*zh\b/i.test(acceptLang)
              ? 'zh'
              : 'en';
      const release = await getLatestReleaseSummary();
      const body = renderPortalPage({
        release,
        oauthConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
        lang,
      });
      return new Response(req.method === 'HEAD' ? null : body, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=120',
        },
      });
    }

    // Serve real UI screenshots from server/public/screenshots/
    if (req.method === 'GET' && url.pathname.startsWith('/assets/screenshots/')) {
      const filename = url.pathname.slice('/assets/screenshots/'.length);
      if (/^[a-z0-9-]+\.png$/i.test(filename)) {
        const file = Bun.file(`${import.meta.dir}/../public/screenshots/${filename}`);
        if (await file.exists()) {
          return new Response(file, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=86400',
            },
          });
        }
      }
      return new Response('Not found', { status: 404 });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/privacy') {
      const body = renderLegalPage({ kind: 'privacy', acceptLanguage: acceptLang });
      return new Response(req.method === 'HEAD' ? null : body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/terms') {
      const body = renderLegalPage({ kind: 'terms', acceptLanguage: acceptLang });
      return new Response(req.method === 'HEAD' ? null : body, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({
        ok: true,
        service: 'antigravity-sync-server',
        portalVersion: getCachedReleaseVersion(),
        oauthConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
      });
    }

    // 1-Tap Browser Google OAuth Start (Desktop loopback & Mobile antigravity:// deep link)
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/google/start') {
      if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        return new Response(
          'Google OAuth is not configured on this server (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).',
          { status: 503 }
        );
      }
      const appRedirect = url.searchParams.get('redirect_uri') || '';
      const clientState = url.searchParams.get('state') || '';
      if (!isAllowedAppRedirect(appRedirect)) {
        return json({ error: 'Invalid redirect_uri' }, 400);
      }

      const origin = PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
      const serverCallback = `${origin}/api/v1/auth/google/callback`;
      const nonce = crypto.randomUUID();
      const packedState = Buffer.from(
        JSON.stringify({ r: appRedirect, s: clientState, n: nonce }),
        'utf8'
      ).toString('base64url');

      // Use OIDC `response_type=id_token` + `response_mode=form_post` so the user's browser
      // delivers Google's signed ID token directly to our callback without requiring outbound
      // server-to-Google connectivity (works seamlessly on mainland China servers!).
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', serverCallback);
      authUrl.searchParams.set('response_type', 'id_token');
      authUrl.searchParams.set('response_mode', 'form_post');
      authUrl.searchParams.set('scope', 'openid email profile');
      authUrl.searchParams.set('nonce', nonce);
      authUrl.searchParams.set('prompt', 'select_account');
      authUrl.searchParams.set('state', packedState);

      return Response.redirect(authUrl.toString(), 302);
    }

    // 1-Tap Browser Google OAuth Callback (supports both POST form_post id_token & GET code)
    if (
      (req.method === 'POST' || req.method === 'GET') &&
      url.pathname === '/api/v1/auth/google/callback'
    ) {
      try {
        let idToken = '';
        let code = '';
        let packedState = '';

        if (req.method === 'POST') {
          const form = await req.formData();
          idToken = String(form.get('id_token') || '');
          code = String(form.get('code') || '');
          packedState = String(form.get('state') || '');
        } else {
          idToken = url.searchParams.get('id_token') || '';
          code = url.searchParams.get('code') || '';
          packedState = url.searchParams.get('state') || '';
        }

        if ((!idToken && !code) || !packedState) {
          return htmlPage(
            renderOAuthErrorPage({
              detail: 'Missing OAuth id_token/code or state parameter.',
              acceptLanguage: acceptLang,
            }),
            400
          );
        }

        const decoded = JSON.parse(Buffer.from(packedState, 'base64url').toString('utf8')) as {
          r?: string;
          s?: string;
          n?: string;
        };
        const appRedirect = decoded.r || '';
        if (!isAllowedAppRedirect(appRedirect)) {
          return htmlPage(
            renderOAuthErrorPage({
              detail: 'Disallowed application redirect URI.',
              acceptLanguage: acceptLang,
            }),
            400
          );
        }

        if (!idToken && code) {
          const origin = PUBLIC_BASE_URL || `${url.protocol}//${url.host}`;
          const serverCallback = `${origin}/api/v1/auth/google/callback`;
          const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              code,
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              redirect_uri: serverCallback,
              grant_type: 'authorization_code',
            }),
          });
          if (!tokenResp.ok) {
            const errText = await tokenResp.text();
            return htmlPage(
              renderOAuthErrorPage({
                detail: `Google token exchange failed: ${errText}`,
                acceptLanguage: acceptLang,
              }),
              401
            );
          }
          const tokenJson = (await tokenResp.json()) as { id_token?: string };
          idToken = tokenJson.id_token || '';
        }

        if (!idToken) {
          return htmlPage(
            renderOAuthErrorPage({
              detail: 'Missing id_token from Google OAuth response.',
              acceptLanguage: acceptLang,
            }),
            401
          );
        }

        const profile = await verifyGoogleIdToken(idToken);
        if (decoded.n && profile.nonce && profile.nonce !== decoded.n) {
          return htmlPage(
            renderOAuthErrorPage({
              detail: 'OAuth nonce mismatch. Please restart sign-in from the app.',
              acceptLanguage: acceptLang,
            }),
            401
          );
        }
        const user = upsertUser({
          id: profile.sub,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        });
        const jwt = await signJwt(user.id, user.email);

        const target = new URL(appRedirect);
        target.searchParams.set('token', jwt);
        target.searchParams.set('id', user.id);
        target.searchParams.set('email', user.email);
        target.searchParams.set('name', user.name);
        target.searchParams.set('avatar', user.avatar_url);
        if (decoded.s) target.searchParams.set('state', decoded.s);

        return htmlPage(
          renderOAuthHandoffPage({
            targetUrl: target.toString(),
            name: user.name,
            email: user.email,
            avatarUrl: user.avatar_url,
            acceptLanguage: acceptLang,
          })
        );
      } catch (err) {
        return htmlPage(
          renderOAuthErrorPage({
            detail: `OAuth callback error: ${String(err)}`,
            acceptLanguage: acceptLang,
          }),
          500
        );
      }
    }

    // Google SSO Login (Zero custom password/registration system)
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/google') {
      try {
        const body = (await req.json()) as { idToken?: string };
        if (!body.idToken) return json({ error: 'Missing idToken' }, 400);
        const profile = await verifyGoogleIdToken(body.idToken);
        const user = upsertUser({
          id: profile.sub,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        });
        const token = await signJwt(user.id, user.email);
        return json({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatar_url,
          },
        });
      } catch (err) {
        return json({ error: String(err) }, 401);
      }
    }

    // Optional self-hosted/local dev SSO shortcut (only when ALLOW_DEV_SSO=true)
    if (req.method === 'POST' && url.pathname === '/api/v1/auth/dev-sso') {
      if (!ALLOW_DEV_SSO) {
        return json({ error: 'Dev SSO is disabled on this server' }, 403);
      }
      const body = (await req.json()) as { email?: string; name?: string };
      const email = (body.email || '').trim().toLowerCase();
      if (!email) return json({ error: 'Missing email' }, 400);
      const user = upsertUser({
        id: `dev-${email}`,
        email,
        name: (body.name || email.split('@')[0]).trim(),
        avatarUrl: '',
      });
      const token = await signJwt(user.id, user.email);
      return json({
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
      });
    }

    // Current user profile
    if (req.method === 'GET' && url.pathname === '/api/v1/auth/me') {
      const auth = await authenticateRequest(req);
      if (!auth) return json({ error: 'Unauthorized' }, 401);
      const user = getUserById(auth.userId);
      if (!user) return json({ error: 'User not found' }, 404);
      return json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatar_url,
        },
      });
    }

    // Pull encrypted Antigravity cookie vault (Cloud -> Mobile / PC)
    if (req.method === 'GET' && url.pathname === '/api/v1/vault') {
      const auth = await authenticateRequest(req);
      if (!auth) return json({ error: 'Unauthorized' }, 401);
      const row = getVault(auth.userId);
      if (!row) {
        return json({ vaultJson: '', version: 0, updatedAtMs: 0 });
      }
      const vaultJson = await decryptVaultText(row.ciphertext, row.iv);
      return json({
        vaultJson,
        version: row.version,
        updatedAtMs: row.updated_at_ms,
      });
    }

    // Push Antigravity cookie vault (PC / Mobile -> Cloud, AES-256-GCM at rest)
    if (req.method === 'PUT' && url.pathname === '/api/v1/vault') {
      const auth = await authenticateRequest(req);
      if (!auth) return json({ error: 'Unauthorized' }, 401);
      const body = (await req.json()) as { vaultJson?: string };
      if (typeof body.vaultJson !== 'string' || !body.vaultJson.trim()) {
        return json({ error: 'Missing vaultJson' }, 400);
      }
      const { ciphertext, iv } = await encryptVaultText(body.vaultJson);
      const saved = upsertVault(auth.userId, ciphertext, iv);
      return json({
        ok: true,
        version: saved.version,
        updatedAtMs: saved.updated_at_ms,
      });
    }

    return json({ error: 'Not found' }, 404);
  },
});

startReleaseRefreshLoop();
console.log(`Antigravity Sync Server listening on http://0.0.0.0:${server.port}`);
