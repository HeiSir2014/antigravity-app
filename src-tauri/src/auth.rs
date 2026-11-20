use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

pub const ANTIGRAVITY_ORIGIN: &str = "https://antigravity.google.com";
pub const VAULT_SCHEMA_VERSION: &str = "antigravity-vault/v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecord {
    pub id: String,
    pub label: String,
    pub email: String,
    pub cookies: HashMap<String, String>,
    #[serde(default)]
    pub accounts_cookies: HashMap<String, String>,
    pub auth_user: u32,
    pub enabled: bool,
    pub updated_at_ms: u64,
}

impl AccountRecord {
    pub fn has_sapisid(&self) -> bool {
        self.cookies.contains_key("SAPISID")
            || self.cookies.contains_key("__Secure-1PAPISID")
            || self.cookies.contains_key("__Secure-3PAPISID")
    }

    pub fn is_authenticated(&self) -> bool {
        self.has_sapisid()
            && (self.cookies.contains_key("SID")
                || self.cookies.contains_key("__Secure-1PSID")
                || self.cookies.contains_key("__Secure-3PSID"))
    }

    pub fn summary(&self) -> AccountSummary {
        AccountSummary {
            id: self.id.clone(),
            label: self.label.clone(),
            email: self.email.clone(),
            authenticated: self.is_authenticated(),
            has_sapisid: self.has_sapisid(),
            cookie_count: self.cookies.len() + self.accounts_cookies.len(),
            auth_user: self.auth_user,
            enabled: self.enabled,
            updated_at_ms: self.updated_at_ms,
        }
    }

    pub fn cookie_header(&self) -> Option<String> {
        if self.cookies.is_empty() {
            return None;
        }
        let pairs: Vec<String> = self
            .cookies
            .iter()
            .filter(|(k, v)| is_valid_cookie_name(k) && is_valid_cookie_value(v))
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
        if pairs.is_empty() {
            None
        } else {
            Some(pairs.join("; "))
        }
    }

    /// Builds Cookie header for `accounts.google.com` (merges `.google.com` + `accounts.google.com` host-only cookies).
    pub fn accounts_cookie_header(&self) -> Option<String> {
        if self.cookies.is_empty() && self.accounts_cookies.is_empty() {
            return None;
        }
        let mut merged: HashMap<&str, &str> = HashMap::new();
        for (k, v) in &self.cookies {
            if is_valid_cookie_name(k) && is_valid_cookie_value(v) {
                merged.insert(k.as_str(), v.as_str());
            }
        }
        for (k, v) in &self.accounts_cookies {
            if is_valid_cookie_name(k) && is_valid_cookie_value(v) {
                merged.insert(k.as_str(), v.as_str());
            }
        }
        if merged.is_empty() {
            return None;
        }
        let pairs: Vec<String> = merged.into_iter().map(|(k, v)| format!("{k}={v}")).collect();
        Some(pairs.join("; "))
    }

    /// Generates Google's first-party SAPISIDHASH / SAPISID1PHASH / SAPISID3PHASH Authorization header.
    pub fn build_authorization_header(&self, origin: &str) -> Option<String> {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let schemes = [
            ("SAPISID", "SAPISIDHASH"),
            ("__Secure-1PAPISID", "SAPISID1PHASH"),
            ("__Secure-3PAPISID", "SAPISID3PHASH"),
        ];

        let mut parts = Vec::new();
        for (cookie_name, scheme) in schemes {
            if let Some(cookie_val) = self.cookies.get(cookie_name) {
                let mut hasher = Sha1::new();
                hasher.update(format!("{ts} {cookie_val} {origin}").as_bytes());
                let digest = hex::encode(hasher.finalize());
                parts.push(format!("{scheme} {ts}_{digest}"));
            }
        }

        if parts.is_empty() {
            None
        } else {
            Some(parts.join(" "))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub label: String,
    pub email: String,
    pub authenticated: bool,
    pub has_sapisid: bool,
    pub cookie_count: usize,
    pub auth_user: u32,
    pub enabled: bool,
    pub updated_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStoreData {
    pub version: String,
    pub accounts: Vec<AccountRecord>,
    pub updated_at_ms: u64,
}

impl Default for VaultStoreData {
    fn default() -> Self {
        Self {
            version: VAULT_SCHEMA_VERSION.to_string(),
            accounts: Vec::new(),
            updated_at_ms: 0,
        }
    }
}

pub struct AuthStore {
    vault: RwLock<VaultStoreData>,
    file_path: PathBuf,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_valid_cookie_name(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= 128
        && k.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

fn is_valid_cookie_value(v: &str) -> bool {
    !v.is_empty()
        && v.bytes()
            .all(|b| b > 0x20 && b < 0x7f && b != b';' && b != b'\'' && b != b'"' && b != b'\\')
}

fn sanitize_cookie_map(raw: HashMap<String, String>) -> HashMap<String, String> {
    raw.into_iter()
        .filter_map(|(k, v)| {
            let kt = k.trim();
            if !is_valid_cookie_name(kt) {
                return None;
            }
            // Strip accidental trailing cURL quotes/escapes/whitespace if present
            let vt = v
                .trim()
                .split(|c: char| c == '\'' || c == '"' || c == '\\' || c.is_whitespace() || c == ';')
                .next()
                .unwrap_or("");
            if !is_valid_cookie_value(vt) {
                return None;
            }
            // Skip known bogus single-letter keys from malformed cURL headers
            if (kt == "q" || kt == "v") && vt.len() > 16 {
                return None;
            }
            Some((kt.to_string(), vt.to_string()))
        })
        .collect()
}

pub struct ParsedCookies {
    pub google_cookies: HashMap<String, String>,
    pub accounts_cookies: HashMap<String, String>,
}

fn extract_curl_cookie_payload(input: &str) -> Option<String> {
    // Match Chrome / Firefox / Windows "Copy as cURL" regardless of leading prefix or multi-line breaks
    for marker in [
        "-b $'",
        "-b '",
        "-b \"",
        "-b ^\"",
        "--cookie $'",
        "--cookie '",
        "--cookie \"",
        "-H $'cookie:",
        "-H $'Cookie:",
        "-H 'cookie:",
        "-H 'Cookie:",
        "-H \"cookie:",
        "-H \"Cookie:",
        "-H ^\"cookie:",
        "-H ^\"Cookie:",
    ] {
        if let Some(idx) = input.find(marker) {
            let after = &input[idx + marker.len()..];
            let quote = if marker.contains('\'') { '\'' } else { '"' };
            if let Some(end) = after.find(quote) {
                let candidate = after[..end].trim().trim_end_matches('^').trim();
                if !candidate.is_empty() {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    None
}

fn is_accounts_only_domain(domain: &str) -> bool {
    let d = domain.trim().trim_start_matches('.').to_ascii_lowercase();
    d == "accounts.google.com"
}

fn is_accounts_only_cookie_name(name: &str) -> bool {
    matches!(
        name,
        "LSID" | "__Host-1PLSID" | "__Host-3PLSID" | "__Host-GAPS" | "ACCOUNT_CHOOSER"
    )
}

pub fn parse_raw_cookies(raw_input: &str) -> Result<ParsedCookies, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("Empty cookie input".to_string());
    }

    let mut google_parsed = HashMap::new();
    let mut accounts_parsed = HashMap::new();

    // Format 0: Chrome/Firefox DevTools "Copy as cURL" (-b '...' / -H 'cookie: ...')
    // Detect even if user missed the leading "curl " or copied multi-line cURL
    let effective_input: String = extract_curl_cookie_payload(trimmed)
        .unwrap_or_else(|| trimmed.to_string());
    let trimmed = effective_input.as_str();

    // Format 1: JSON array (Cookie-Editor / EditThisCookie) or JSON object map
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(arr) = val.as_array() {
                for item in arr {
                    let name = item.get("name").and_then(|v| v.as_str());
                    let value = item.get("value").and_then(|v| v.as_str());
                    let domain = item.get("domain").and_then(|v| v.as_str()).unwrap_or("");
                    if let (Some(n), Some(v)) = (name, value) {
                        if is_accounts_only_domain(domain) || is_accounts_only_cookie_name(n) {
                            accounts_parsed.insert(n.to_string(), v.to_string());
                        } else if domain.is_empty()
                            || domain.to_ascii_lowercase().contains("google.com")
                        {
                            google_parsed.insert(n.to_string(), v.to_string());
                        }
                    }
                }
            } else if let Some(obj) = val.as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        if is_accounts_only_cookie_name(k) {
                            accounts_parsed.insert(k.clone(), s.to_string());
                        } else {
                            google_parsed.insert(k.clone(), s.to_string());
                        }
                    }
                }
            }
        }
    }

    // Format 2: Netscape cookies.txt (tab-separated)
    if google_parsed.is_empty() && accounts_parsed.is_empty() && trimmed.contains('\t') {
        for line in trimmed.lines() {
            let line = line.trim();
            if line.is_empty() || (line.starts_with('#') && !line.starts_with("#HttpOnly_")) {
                continue;
            }
            let effective_line = line.strip_prefix("#HttpOnly_").unwrap_or(line);
            let cols: Vec<&str> = effective_line.split('\t').collect();
            if cols.len() >= 7 {
                let domain = cols[0];
                let name = cols[5];
                let value = cols[6];
                if is_accounts_only_domain(domain) || is_accounts_only_cookie_name(name) {
                    accounts_parsed.insert(name.to_string(), value.to_string());
                } else if domain.to_ascii_lowercase().contains("google.com") {
                    google_parsed.insert(name.to_string(), value.to_string());
                }
            }
        }
    }

    // Format 3: Standard HTTP Cookie header string ("SID=...; SAPISID=...; ...")
    if google_parsed.is_empty() && accounts_parsed.is_empty() {
        let cleaned = trimmed
            .strip_prefix("Cookie:")
            .or_else(|| trimmed.strip_prefix("cookie:"))
            .unwrap_or(trimmed);
        for part in cleaned.split(';') {
            if let Some((k, v)) = part.split_once('=') {
                let key = k.trim();
                let val = v.trim();
                if !key.is_empty() && !val.is_empty() {
                    if is_accounts_only_cookie_name(key) {
                        accounts_parsed.insert(key.to_string(), val.to_string());
                    } else {
                        google_parsed.insert(key.to_string(), val.to_string());
                    }
                }
            }
        }
    }

    let google_cookies = sanitize_cookie_map(google_parsed);
    let accounts_cookies = sanitize_cookie_map(accounts_parsed);

    if google_cookies.is_empty() {
        return Err("Could not parse any valid Google cookies from input".to_string());
    }
    Ok(ParsedCookies {
        google_cookies,
        accounts_cookies,
    })
}

impl AuthStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let file_path = app_data_dir.join("accounts_vault.json");
        let mut loaded = fs::read_to_string(&file_path)
            .ok()
            .and_then(|s| serde_json::from_str::<VaultStoreData>(&s).ok())
            .unwrap_or_default();
        // Self-heal any previously corrupted cookie entries on startup
        let mut healed = false;
        for acc in &mut loaded.accounts {
            let orig_len = acc.cookies.len();
            let clean = sanitize_cookie_map(acc.cookies.clone());
            if clean.len() != orig_len || clean != acc.cookies {
                acc.cookies = clean;
                healed = true;
            }
            let orig_acc_len = acc.accounts_cookies.len();
            let clean_acc = sanitize_cookie_map(acc.accounts_cookies.clone());
            if clean_acc.len() != orig_acc_len || clean_acc != acc.accounts_cookies {
                acc.accounts_cookies = clean_acc;
                healed = true;
            }
        }
        let store = Self {
            vault: RwLock::new(loaded),
            file_path,
        };
        if healed {
            if let Ok(guard) = store.vault.read() {
                let _ = store.persist_locked(&guard);
            }
        }
        store
    }

    fn persist_locked(&self, vault: &VaultStoreData) -> Result<(), String> {
        if let Some(parent) = self.file_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json = serde_json::to_string_pretty(vault).map_err(|e| e.to_string())?;
        fs::write(&self.file_path, json).map_err(|e| e.to_string())
    }

    pub fn list_accounts(&self) -> Vec<AccountSummary> {
        let guard = self.vault.read().unwrap_or_else(|e| e.into_inner());
        guard.accounts.iter().map(|a| a.summary()).collect()
    }

    pub fn enabled_authenticated_accounts(&self) -> Vec<AccountRecord> {
        let guard = self.vault.read().unwrap_or_else(|e| e.into_inner());
        guard
            .accounts
            .iter()
            .filter(|a| a.enabled && a.is_authenticated())
            .cloned()
            .collect()
    }

    pub fn get_account(&self, account_id: &str) -> Option<AccountRecord> {
        let guard = self.vault.read().unwrap_or_else(|e| e.into_inner());
        if account_id.is_empty() {
            return guard
                .accounts
                .iter()
                .find(|a| a.enabled && a.is_authenticated())
                .cloned();
        }
        guard.accounts.iter().find(|a| a.id == account_id).cloned()
    }

    pub fn upsert_account_cookies(
        &self,
        account_id: Option<String>,
        label: Option<String>,
        email: Option<String>,
        cookies: HashMap<String, String>,
        accounts_cookies: HashMap<String, String>,
        auth_user: Option<u32>,
    ) -> Result<AccountSummary, String> {
        let ts = now_ms();
        let clean_cookies = sanitize_cookie_map(cookies);
        let clean_accounts = sanitize_cookie_map(accounts_cookies);
        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        guard.updated_at_ms = ts;

        let target_id = account_id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("acc-{}", &uuid::Uuid::new_v4().to_string()[..8]));

        if let Some(existing) = guard.accounts.iter_mut().find(|a| a.id == target_id) {
            for (k, v) in clean_cookies {
                existing.cookies.insert(k, v);
            }
            for (k, v) in clean_accounts {
                existing.accounts_cookies.insert(k, v);
            }
            if let Some(l) = label.filter(|s| !s.trim().is_empty()) {
                existing.label = l.trim().to_string();
            }
            if let Some(em) = email.filter(|s| !s.trim().is_empty()) {
                existing.email = em.trim().to_string();
            }
            if let Some(au) = auth_user {
                existing.auth_user = au;
            }
            existing.updated_at_ms = ts;
            let summary = existing.summary();
            self.persist_locked(&guard)?;
            return Ok(summary);
        }

        let next_idx = guard.accounts.len() + 1;
        let record = AccountRecord {
            id: target_id,
            label: label
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("Account #{next_idx}")),
            email: email.unwrap_or_default(),
            cookies: clean_cookies,
            accounts_cookies: clean_accounts,
            auth_user: auth_user.unwrap_or(0),
            enabled: true,
            updated_at_ms: ts,
        };
        let summary = record.summary();
        guard.accounts.push(record);
        self.persist_locked(&guard)?;
        Ok(summary)
    }

    /// Merges `Set-Cookie` headers returned by Google (`RotateCookies` / RPC endpoints) back into
    /// the stored account so rotated `__Secure-1PSIDTS` / `__Secure-3PSIDTS` / `SIDCC` persist!
    pub fn merge_set_cookies(
        &self,
        account_id: &str,
        from_accounts_domain: bool,
        set_cookie_headers: &[String],
    ) -> bool {
        if set_cookie_headers.is_empty() {
            return false;
        }
        let mut updates_google: Vec<(String, String)> = Vec::new();
        let mut updates_accounts: Vec<(String, String)> = Vec::new();

        for raw in set_cookie_headers {
            let mut parts = raw.split(';');
            let Some(first) = parts.next() else {
                continue;
            };
            let Some((k, v)) = first.split_once('=') else {
                continue;
            };
            let kt = k.trim();
            let vt = v.trim();
            if !is_valid_cookie_name(kt) || !is_valid_cookie_value(vt) {
                continue;
            }
            // Skip cookie deletion directives (Max-Age=0 or Expires=1970)
            let lower = raw.to_ascii_lowercase();
            if lower.contains("max-age=0") || lower.contains("expires=thu, 01-jan-1970") || lower.contains("expires=mon, 01-jan-1990") {
                continue;
            }
            let has_google_domain = lower.contains("domain=.google.com") || lower.contains("domain=google.com");
            if is_accounts_only_cookie_name(kt) || (from_accounts_domain && !has_google_domain && kt.starts_with("__Host-")) {
                updates_accounts.push((kt.to_string(), vt.to_string()));
            } else {
                updates_google.push((kt.to_string(), vt.to_string()));
            }
        }

        if updates_google.is_empty() && updates_accounts.is_empty() {
            return false;
        }

        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        let Some(acc) = guard.accounts.iter_mut().find(|a| a.id == account_id) else {
            return false;
        };

        let mut changed = false;
        for (k, v) in updates_google {
            if acc.cookies.get(&k).map(|old| old != &v).unwrap_or(true) {
                acc.cookies.insert(k, v);
                changed = true;
            }
        }
        for (k, v) in updates_accounts {
            if acc.accounts_cookies.get(&k).map(|old| old != &v).unwrap_or(true) {
                acc.accounts_cookies.insert(k, v);
                changed = true;
            }
        }
        if changed {
            let ts = now_ms();
            acc.updated_at_ms = ts;
            guard.updated_at_ms = ts;
            let _ = self.persist_locked(&guard);
        }
        changed
    }

    pub fn toggle_account(&self, account_id: &str, enabled: bool) -> Result<Vec<AccountSummary>, String> {
        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        if let Some(acc) = guard.accounts.iter_mut().find(|a| a.id == account_id) {
            acc.enabled = enabled;
            acc.updated_at_ms = now_ms();
            guard.updated_at_ms = acc.updated_at_ms;
            self.persist_locked(&guard)?;
        }
        Ok(guard.accounts.iter().map(|a| a.summary()).collect())
    }

    pub fn remove_account(&self, account_id: &str) -> Result<Vec<AccountSummary>, String> {
        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        guard.accounts.retain(|a| a.id != account_id);
        guard.updated_at_ms = now_ms();
        self.persist_locked(&guard)?;
        Ok(guard.accounts.iter().map(|a| a.summary()).collect())
    }

    /// Exports the multi-account vault bundle (`antigravity-vault/v1`) for PC <-> Mobile sync.
    pub fn export_vault_json(&self) -> Result<String, String> {
        let guard = self.vault.read().unwrap_or_else(|e| e.into_inner());
        serde_json::to_string_pretty(&*guard).map_err(|e| e.to_string())
    }

    /// Merges an imported vault bundle into local accounts (newest `updated_at_ms` wins per account ID).
    pub fn import_vault_json(&self, raw_json: &str) -> Result<Vec<AccountSummary>, String> {
        let incoming: VaultStoreData =
            serde_json::from_str(raw_json).map_err(|e| format!("Invalid vault JSON: {e}"))?;
        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        for mut inc in incoming.accounts {
            inc.cookies = sanitize_cookie_map(inc.cookies);
            inc.accounts_cookies = sanitize_cookie_map(inc.accounts_cookies);
            if let Some(existing) = guard.accounts.iter_mut().find(|a| a.id == inc.id) {
                if inc.updated_at_ms >= existing.updated_at_ms {
                    *existing = inc;
                }
            } else {
                guard.accounts.push(inc);
            }
        }
        guard.updated_at_ms = now_ms();
        self.persist_locked(&guard)?;
        Ok(guard.accounts.iter().map(|a| a.summary()).collect())
    }
}
