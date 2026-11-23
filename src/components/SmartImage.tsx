import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { isRemoteFileUri, resolveRemoteImageSrc } from '../api/tauriClient';

interface SmartImageProps {
  src?: string;
  remoteUri?: string;
  mimeType?: string;
  alt: string;
  accountId?: string;
  deviceUuid?: string;
  className?: string;
  onClick?: (resolvedSrc: string) => void;
}

/**
 * Renders images from all 3 Antigravity sources seamlessly:
 * 1. Inline Base64 / `data:` URLs
 * 2. Remote `http(s)://` URLs
 * 3. Workstation local file paths (`file://...` or `/abs/path`) fetched on demand via `ReadFile`
 */
export function SmartImage({
  src,
  remoteUri,
  mimeType,
  alt,
  accountId,
  deviceUuid,
  className = 'w-28 h-28 object-cover',
  onClick,
}: SmartImageProps) {
  const initialDirect =
    src && !isRemoteFileUri(src)
      ? src
      : remoteUri && !isRemoteFileUri(remoteUri)
        ? remoteUri
        : '';
  const filePathToFetch =
    !initialDirect && (remoteUri || src) && isRemoteFileUri(remoteUri || src || '')
      ? (remoteUri || src || '')
      : '';

  const [resolvedSrc, setResolvedSrc] = useState(initialDirect);
  const [loading, setLoading] = useState(Boolean(filePathToFetch));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (initialDirect) {
      setResolvedSrc(initialDirect);
      setLoading(false);
      return;
    }
    if (!filePathToFetch || !accountId || !deviceUuid) {
      setResolvedSrc('');
      setLoading(false);
      setFailed(Boolean(filePathToFetch));
      return;
    }

    let cancelled = false;
    setLoading(true);
    void resolveRemoteImageSrc(accountId, deviceUuid, filePathToFetch, mimeType).then((url) => {
      if (cancelled) return;
      if (url) {
        setResolvedSrc(url);
        setFailed(false);
      } else {
        setFailed(true);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [initialDirect, filePathToFetch, accountId, deviceUuid, mimeType]);

  if (loading) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border ${className}`}
        style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  if (failed || !resolvedSrc) {
    return (
      <div
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[0.72rem] font-mono max-w-[200px]"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
        title={remoteUri || src || alt}
      >
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{alt || 'Image'}</span>
      </div>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(resolvedSrc)}
        className="rounded-xl overflow-hidden border cursor-pointer active:opacity-85 transition-opacity block"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <img
          src={resolvedSrc}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className={className}
        />
      </button>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`rounded-xl border ${className}`}
      style={{ borderColor: 'var(--border-subtle)' }}
    />
  );
}
