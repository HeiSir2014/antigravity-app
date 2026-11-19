import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UserRow {
  id: string; // Google `sub`
  email: string;
  name: string;
  avatar_url: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface VaultRow {
  user_id: string;
  ciphertext: string;
  iv: string;
  version: number;
  updated_at_ms: number;
}

const DB_PATH = process.env.DATABASE_PATH || './data/sync.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vaults (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at_ms INTEGER NOT NULL
  );
`);

export function upsertUser(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string;
}): UserRow {
  const now = Date.now();
  db.query(
    `INSERT INTO users (id, email, name, avatar_url, created_at_ms, updated_at_ms)
     VALUES ($id, $email, $name, $avatarUrl, $now, $now)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       avatar_url = excluded.avatar_url,
       updated_at_ms = excluded.updated_at_ms`
  ).run({
    $id: user.id,
    $email: user.email,
    $name: user.name,
    $avatarUrl: user.avatarUrl,
    $now: now,
  });

  return db.query<UserRow, { $id: string }>('SELECT * FROM users WHERE id = $id').get({ $id: user.id })!;
}

export function getUserById(id: string): UserRow | null {
  return db.query<UserRow, { $id: string }>('SELECT * FROM users WHERE id = $id').get({ $id: id }) ?? null;
}

export function getVault(userId: string): VaultRow | null {
  return (
    db
      .query<VaultRow, { $userId: string }>('SELECT * FROM vaults WHERE user_id = $userId')
      .get({ $userId: userId }) ?? null
  );
}

export function upsertVault(userId: string, ciphertext: string, iv: string): VaultRow {
  const now = Date.now();
  db.query(
    `INSERT INTO vaults (user_id, ciphertext, iv, version, updated_at_ms)
     VALUES ($userId, $ciphertext, $iv, 1, $now)
     ON CONFLICT(user_id) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       version = vaults.version + 1,
       updated_at_ms = excluded.updated_at_ms`
  ).run({
    $userId: userId,
    $ciphertext: ciphertext,
    $iv: iv,
    $now: now,
  });

  return getVault(userId)!;
}
