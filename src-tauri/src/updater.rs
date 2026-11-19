use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

pub const CURRENT_APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEFAULT_GITHUB_REPO: &str = "HeiSir2014/antigravity-app";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAssetInfo {
    pub name: String,
    pub url: String,
    pub size: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateManifest {
    pub version: String,
    pub min_native_version: Option<String>,
    pub notes: String,
    pub pub_date: String,
    pub web_bundle: Option<ReleaseAssetInfo>,
    pub android_apk: Option<ReleaseAssetInfo>,
    pub desktop_asset: Option<ReleaseAssetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub strategy: String, // "none" | "incremental" | "full"
    pub notes: String,
    pub pub_date: String,
    pub release_url: String,
    pub target_asset: Option<ReleaseAssetInfo>,
    pub repo: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum UpdateDownloadEvent {
    Started { total_bytes: u64, file_name: String },
    Progress { downloaded_bytes: u64, total_bytes: u64, percent: u8 },
    Verifying,
    Ready { file_path: String, sha256: String, strategy: String },
    Error { message: String },
}

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let cleaned = v.trim().trim_start_matches('v').split('-').next().unwrap_or("0.0.0");
    let mut parts = cleaned.split('.').map(|s| s.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

pub fn is_newer_version(latest: &str, current: &str) -> bool {
    parse_semver(latest) > parse_semver(current)
}

fn is_compatible_native(min_native: Option<&str>, current: &str) -> bool {
    match min_native {
        Some(m) if !m.trim().is_empty() => parse_semver(current) >= parse_semver(m),
        _ => true,
    }
}

pub async fn check_github_update(repo: Option<String>) -> Result<UpdateCheckResult, String> {
    let target_repo = repo
        .map(|s| s.trim().trim_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_GITHUB_REPO.to_string());

    let http = reqwest::Client::builder()
        .use_rustls_tls()
        .user_agent(format!("Antigravity-App/{CURRENT_APP_VERSION}"))
        .build()
        .map_err(|e| e.to_string())?;

    let api_url = format!("https://api.github.com/repos/{target_repo}/releases/latest");
    let resp = http
        .get(&api_url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub update check failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("GitHub Releases API returned HTTP {}", resp.status()));
    }

    let gh: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let tag_name = gh
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or(CURRENT_APP_VERSION)
        .trim_start_matches('v')
        .to_string();
    let release_url = gh
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let body_notes = gh
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let pub_date = gh
        .get("published_at")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let assets = gh
        .get("assets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 1. Prefer structured `update-manifest.json` if published in the GitHub Release
    if let Some(manifest_asset) = assets.iter().find(|a| {
        a.get("name")
            .and_then(|n| n.as_str())
            .map(|n| n == "update-manifest.json")
            .unwrap_or(false)
    }) {
        if let Some(m_url) = manifest_asset.get("browser_download_url").and_then(|v| v.as_str()) {
            if let Ok(m_resp) = http.get(m_url).send().await {
                if let Ok(manifest) = m_resp.json::<UpdateManifest>().await {
                    let has_update = is_newer_version(&manifest.version, CURRENT_APP_VERSION);
                    let can_incremental = has_update
                        && manifest.web_bundle.is_some()
                        && is_compatible_native(
                            manifest.min_native_version.as_deref(),
                            CURRENT_APP_VERSION,
                        );

                    let (strategy, target_asset) = if !has_update {
                        ("none".to_string(), None)
                    } else if can_incremental {
                        ("incremental".to_string(), manifest.web_bundle)
                    } else {
                        #[cfg(target_os = "android")]
                        let full = manifest.android_apk;
                        #[cfg(not(target_os = "android"))]
                        let full = manifest.desktop_asset.or(manifest.android_apk);
                        ("full".to_string(), full)
                    };

                    return Ok(UpdateCheckResult {
                        current_version: CURRENT_APP_VERSION.to_string(),
                        latest_version: manifest.version,
                        has_update,
                        strategy,
                        notes: if manifest.notes.is_empty() {
                            body_notes
                        } else {
                            manifest.notes
                        },
                        pub_date: if manifest.pub_date.is_empty() {
                            pub_date
                        } else {
                            manifest.pub_date
                        },
                        release_url,
                        target_asset,
                        repo: target_repo,
                    });
                }
            }
        }
    }

    // 2. Fallback: directly match platform asset from GitHub Release assets
    let find_asset = |exts: &[&str]| -> Option<ReleaseAssetInfo> {
        assets.iter().find_map(|a| {
            let name = a.get("name")?.as_str()?;
            let lower = name.to_ascii_lowercase();
            if exts.iter().any(|ext| lower.ends_with(ext)) {
                Some(ReleaseAssetInfo {
                    name: name.to_string(),
                    url: a.get("browser_download_url")?.as_str()?.to_string(),
                    size: a.get("size").and_then(|v| v.as_u64()).unwrap_or(0),
                    sha256: None,
                })
            } else {
                None
            }
        })
    };

    let has_update = is_newer_version(&tag_name, CURRENT_APP_VERSION);
    let web_bundle = find_asset(&["web-bundle.tar.gz", "web-bundle.zip"]);

    #[cfg(target_os = "android")]
    let full_asset = find_asset(&[".apk"]);
    #[cfg(target_os = "macos")]
    let full_asset = find_asset(&[".dmg", ".app.tar.gz"]).or_else(|| find_asset(&[".apk"]));
    #[cfg(target_os = "windows")]
    let full_asset = find_asset(&[".msi", ".exe"]).or_else(|| find_asset(&[".apk"]));
    #[cfg(all(unix, not(target_os = "macos"), not(target_os = "android")))]
    let full_asset = find_asset(&[".appimage", ".deb"]).or_else(|| find_asset(&[".apk"]));

    let (strategy, target_asset) = if !has_update {
        ("none".to_string(), None)
    } else if full_asset.is_some() {
        ("full".to_string(), full_asset)
    } else if web_bundle.is_some() {
        ("incremental".to_string(), web_bundle)
    } else {
        ("full".to_string(), None)
    };

    Ok(UpdateCheckResult {
        current_version: CURRENT_APP_VERSION.to_string(),
        latest_version: tag_name,
        has_update,
        strategy,
        notes: body_notes,
        pub_date,
        release_url,
        target_asset,
        repo: target_repo,
    })
}

/// Downloads an APK or incremental bundle with streaming progress & atomic SHA-256 verification.
pub async fn download_and_verify_update<F>(
    updates_dir: PathBuf,
    asset: ReleaseAssetInfo,
    strategy: String,
    mut on_event: F,
) -> Result<PathBuf, String>
where
    F: FnMut(UpdateDownloadEvent) + Send,
{
    fs::create_dir_all(&updates_dir).map_err(|e| format!("Failed to create updates dir: {e}"))?;

    let safe_name = asset
        .name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect::<String>();
    let final_path = updates_dir.join(&safe_name);
    let part_path = updates_dir.join(format!("{safe_name}.part"));

    let http = reqwest::Client::builder()
        .use_rustls_tls()
        .user_agent(format!("Antigravity-App/{CURRENT_APP_VERSION}"))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = http
        .get(&asset.url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    let total_bytes = resp.content_length().unwrap_or(asset.size);
    on_event(UpdateDownloadEvent::Started {
        total_bytes,
        file_name: safe_name.clone(),
    });

    let mut file = File::create(&part_path).map_err(|e| format!("Failed to create temp file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_percent: u8 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Download stream error: {e}"))?;
        file.write_all(&chunk).map_err(|e| format!("Write error: {e}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;

        let percent = if total_bytes > 0 {
            ((downloaded.saturating_mul(100)) / total_bytes).min(100) as u8
        } else {
            0
        };
        if percent != last_percent || downloaded == total_bytes {
            last_percent = percent;
            on_event(UpdateDownloadEvent::Progress {
                downloaded_bytes: downloaded,
                total_bytes,
                percent,
            });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    drop(file);

    on_event(UpdateDownloadEvent::Verifying);
    let actual_sha256 = hex::encode(hasher.finalize());

    if let Some(expected) = asset.sha256.as_deref().map(|s| s.trim().to_ascii_lowercase()) {
        if !expected.is_empty() && actual_sha256 != expected {
            let _ = fs::remove_file(&part_path);
            let err = format!("SHA-256 mismatch! expected {expected}, got {actual_sha256}");
            on_event(UpdateDownloadEvent::Error { message: err.clone() });
            return Err(err);
        }
    }

    fs::rename(&part_path, &final_path).map_err(|e| format!("Atomic finalize failed: {e}"))?;

    on_event(UpdateDownloadEvent::Ready {
        file_path: final_path.to_string_lossy().to_string(),
        sha256: actual_sha256,
        strategy,
    });
    Ok(final_path)
}
