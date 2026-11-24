import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { isRemoteFileUri, resolveRemoteImageSrc } from '../api/tauriClient';

marked.setOptions({
  breaks: true,
  gfm: true,
});

const TRANSPARENT_PLACEHOLDER =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" rx="10" fill="rgba(128,128,128,0.12)"/></svg>'
  );

const IMAGE_LINK_RE = /\.(png|jpe?g|webp|gif|svg|bmp|avif)(?:[?#].*)?$/i;

function sanitizeRenderedHtml(rawHtml: string): string {
  // Strip <script>, <iframe>, <object>, <embed> tags and inline on* event handlers.
  const cleaned = rawHtml
    .replace(/<(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');

  // Prevent the WebView from immediately requesting workstation `file://` or `/abs/path`
  // image URIs directly (which fails with a broken-image icon before ReadFile completes).
  return cleaned.replace(
    /<img\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi,
    (full, before: string, quote: string, srcVal: string, after: string) => {
      if (isRemoteFileUri(srcVal)) {
        const escaped = srcVal.replace(/"/g, '&quot;');
        return `<img${before}src="${TRANSPARENT_PLACEHOLDER}" data-remote-src="${escaped}"${after}>`;
      }
      return full;
    }
  );
}

interface MarkdownViewProps {
  markdown: string;
  className?: string;
  accountId?: string;
  deviceUuid?: string;
  onPreviewImage?: (src: string, title: string) => void;
}

export function MarkdownView({
  markdown,
  className = '',
  accountId,
  deviceUuid,
  onPreviewImage,
}: MarkdownViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const html = useMemo(() => {
    try {
      const parsed = marked.parse(markdown || '', { async: false }) as string;
      return sanitizeRenderedHtml(parsed);
    } catch {
      return markdown;
    }
  }, [markdown]);

  // Hydrate any workstation local image paths (`file://...` or `/abs/path`) inside Markdown <img> tags via ReadFile.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img'));
    let cancelled = false;
    for (const img of imgs) {
      img.classList.add('rounded-xl', 'max-h-72', 'object-contain', 'my-2', 'border', 'cursor-pointer');
      img.style.borderColor = 'var(--border-subtle)';
      const remoteSrc = img.getAttribute('data-remote-src') || img.getAttribute('src') || '';
      if (remoteSrc && isRemoteFileUri(remoteSrc) && accountId && deviceUuid) {
        void resolveRemoteImageSrc(accountId, deviceUuid, remoteSrc).then((resolved) => {
          if (!cancelled && resolved) {
            img.src = resolved;
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [html, accountId, deviceUuid]);

  return (
    <div
      ref={containerRef}
      className={`agy-md ${className}`}
      onClick={(e) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.tagName === 'IMG' && onPreviewImage) {
          const img = target as HTMLImageElement;
          if (img.src && img.src !== TRANSPARENT_PLACEHOLDER) {
            onPreviewImage(img.src, img.alt || 'Image');
          }
          return;
        }
        const anchor = target.closest('a') as HTMLAnchorElement | null;
        if (anchor && onPreviewImage) {
          const href = anchor.getAttribute('href') || '';
          if (href && IMAGE_LINK_RE.test(href)) {
            e.preventDefault();
            const title = anchor.textContent?.trim() || href.split('/').pop() || 'Image';
            if (isRemoteFileUri(href) && accountId && deviceUuid) {
              void resolveRemoteImageSrc(accountId, deviceUuid, href).then((resolved) => {
                if (resolved) onPreviewImage(resolved, title);
              });
            } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('data:')) {
              onPreviewImage(href, title);
            }
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
