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
            cookie_count: self.cookies.len(),
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
            .map(|(k, v)| format!("{k}={v}"))
            .collect();
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

pub fn parse_raw_cookies(raw_input: &str) -> Result<HashMap<String, String>, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("Empty cookie input".to_string());
    }

    let mut parsed = HashMap::new();

    // Format 0: Chrome/Firefox DevTools "Copy as cURL" (-b '...' / -b $'...' / -H 'cookie: ...')
    let effective_input: String = if trimmed.starts_with("curl ") {
        let mut extracted = None;
        for marker in [
            "-b $'",
            "-b '",
            "-b \"",
            "-H $'cookie:",
            "-H $'Cookie:",
            "-H 'cookie:",
            "-H 'Cookie:",
            "-H \"cookie:",
            "-H \"Cookie:",
        ] {
            if let Some(idx) = trimmed.find(marker) {
                let after = &trimmed[idx + marker.len()..];
                let quote = if marker.contains('\'') { '\'' } else { '"' };
                if let Some(end) = after.find(quote) {
                    extracted = Some(after[..end].trim().to_string());
                    break;
                }
            }
        }
        extracted.unwrap_or_else(|| trimmed.to_string())
    } else {
        trimmed.to_string()
    };
    let trimmed = effective_input.as_str();

    // Format 1: JSON array (Cookie-Editor / EditThisCookie) or JSON object map
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(arr) = val.as_array() {
                for item in arr {
                    let name = item.get("name").and_then(|v| v.as_str());
                    let value = item.get("value").and_then(|v| v.as_str());
                    if let (Some(n), Some(v)) = (name, value) {
                        parsed.insert(n.to_string(), v.to_string());
                    }
                }
            } else if let Some(obj) = val.as_object() {
                for (k, v) in obj {
                    if let Some(s) = v.as_str() {
                        parsed.insert(k.clone(), s.to_string());
                    }
                }
            }
        }
    }

    // Format 2: Netscape cookies.txt (tab-separated)
    if parsed.is_empty() && trimmed.contains('\t') {
        for line in trimmed.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() >= 7 {
                parsed.insert(cols[5].to_string(), cols[6].to_string());
            }
        }
    }

    // Format 3: Standard HTTP Cookie header string ("SID=...; SAPISID=...; ...")
    if parsed.is_empty() {
        let cleaned = trimmed
            .strip_prefix("Cookie:")
            .or_else(|| trimmed.strip_prefix("cookie:"))
            .unwrap_or(trimmed);
        for part in cleaned.split(';') {
            if let Some((k, v)) = part.split_once('=') {
                let key = k.trim();
                let val = v.trim();
                if !key.is_empty() && !val.is_empty() {
                    parsed.insert(key.to_string(), val.to_string());
                }
            }
        }
    }

    if parsed.is_empty() {
        return Err("Could not parse any cookies from input".to_string());
    }

    // Sanitize keys/values to valid HTTP header characters (strip CR/LF/control chars & stray quotes)
    let sanitized: HashMap<String, String> = parsed
        .into_iter()
        .filter_map(|(k, v)| {
            let clean_k: String = k
                .trim()
                .chars()
                .filter(|c| c.is_ascii() && !c.is_ascii_control() && *c != ';' && *c != ' ')
                .collect();
            let clean_v: String = v
                .trim()
                .chars()
                .filter(|c| c.is_ascii() && !c.is_ascii_control())
                .collect();
            if clean_k.is_empty() || clean_v.is_empty() {
                None
            } else {
                Some((clean_k, clean_v))
            }
        })
        .collect();

    if sanitized.is_empty() {
        return Err("Could not parse any valid cookies from input".to_string());
    }
    Ok(sanitized)
}

impl AuthStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let file_path = app_data_dir.join("accounts_vault.json");
        let loaded = fs::read_to_string(&file_path)
            .ok()
            .and_then(|s| serde_json::from_str::<VaultStoreData>(&s).ok())
            .unwrap_or_default();
        Self {
            vault: RwLock::new(loaded),
            file_path,
        }
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
        auth_user: Option<u32>,
    ) -> Result<AccountSummary, String> {
        let ts = now_ms();
        let mut guard = self.vault.write().unwrap_or_else(|e| e.into_inner());
        guard.updated_at_ms = ts;

        let target_id = account_id
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("acc-{}", &uuid::Uuid::new_v4().to_string()[..8]));

        if let Some(existing) = guard.accounts.iter_mut().find(|a| a.id == target_id) {
            for (k, v) in cookies {
                let kt = k.trim();
                let vt = v.trim();
                if !kt.is_empty() && !vt.is_empty() {
                    existing.cookies.insert(kt.to_string(), vt.to_string());
                }
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

        let clean_cookies: HashMap<String, String> = cookies
            .into_iter()
            .filter_map(|(k, v)| {
                let kt = k.trim().to_string();
                let vt = v.trim().to_string();
                if kt.is_empty() || vt.is_empty() {
                    None
                } else {
                    Some((kt, vt))
                }
            })
            .collect();

        let next_idx = guard.accounts.len() + 1;
        let record = AccountRecord {
            id: target_id,
            label: label
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("Account #{next_idx}")),
            email: email.unwrap_or_default(),
            cookies: clean_cookies,
            auth_user: auth_user.unwrap_or(0),
            enabled: true,
            updated_at_ms: ts,
        };
        let summary = record.summary();
        guard.accounts.push(record);
        self.persist_locked(&guard)?;
        Ok(summary)
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
        for inc in incoming.accounts {
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
