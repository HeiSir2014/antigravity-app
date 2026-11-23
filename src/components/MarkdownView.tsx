import { useEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import { isRemoteFileUri, resolveRemoteImageSrc } from '../api/tauriClient';

marked.setOptions({
  breaks: true,
  gfm: true,
});

function sanitizeRenderedHtml(rawHtml: string): string {
  // Strip <script>, <iframe>, <object>, <embed> tags and inline on* event handlers.
  return rawHtml
    .replace(/<(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');
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

  // Hydrate any workstation local image paths (`file://...` or `/abs/path`) inside Markdown <img> tags.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const imgs = Array.from(root.querySelectorAll('img'));
    let cancelled = false;
    for (const img of imgs) {
      img.classList.add('rounded-xl', 'max-h-72', 'object-contain', 'my-2', 'border', 'cursor-pointer');
      img.style.borderColor = 'var(--border-subtle)';
      const rawSrc = img.getAttribute('src') || '';
      if (rawSrc && isRemoteFileUri(rawSrc) && accountId && deviceUuid) {
        void resolveRemoteImageSrc(accountId, deviceUuid, rawSrc).then((resolved) => {
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
        if (target && target.tagName === 'IMG' && onPreviewImage) {
          const img = target as HTMLImageElement;
          if (img.src) {
            onPreviewImage(img.src, img.alt || 'Image');
          }
        }
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
