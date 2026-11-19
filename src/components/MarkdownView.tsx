import { useMemo } from 'react';
import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

interface MarkdownViewProps {
  markdown: string;
  className?: string;
}

export function MarkdownView({ markdown, className = '' }: MarkdownViewProps) {
  const html = useMemo(() => {
    try {
      return marked.parse(markdown || '', { async: false }) as string;
    } catch {
      return markdown;
    }
  }, [markdown]);

  return (
    <div
      className={`agy-md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
