const JWT_SECRET = process.env.JWT_SECRET || 'dev-change-me-jwt-secret-please-32bytes!';
const VAULT_MASTER_KEY = process.env.VAULT_MASTER_KEY || 'dev-change-me-vault-key-32bytes!!';

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

async function getHmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function getAesKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(VAULT_MASTER_KEY));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export interface JwtPayload {
  sub: string;
  email: string;
  exp: number;
}

export async function signJwt(sub: string, email: string, ttlSeconds = 30 * 24 * 3600): Promise<string> {
  const header = b64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({
        sub,
        email,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      })
    )
  );
  const data = `${header}.${payload}`;
  const key = await getHmacKey();
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return `${data}.${b64urlEncode(sig)}`;
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sigStr] = parts;
    const key = await getHmacKey();
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sigStr),
      new TextEncoder().encode(`${header}.${payload}`)
    );
    if (!ok) return null;
    const decoded = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as JwtPayload;
    if (!decoded.sub || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function encryptVaultText(plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getAesKey();
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  return {
    ciphertext: Buffer.from(encrypted).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
  };
}

export async function decryptVaultText(ciphertext: string, iv: string): Promise<string> {
  const key = await getAesKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(Buffer.from(iv, 'base64')) },
    key,
    new Uint8Array(Buffer.from(ciphertext, 'base64'))
  );
  return new TextDecoder().decode(decrypted);
}
