import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileCode2,
  FileText,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type {
  AskUserQuestionData,
  SheetDestination,
  TimelineItem,
  ToolCallDetail,
} from '../types/agent';
import { MarkdownView } from './MarkdownView';

interface AgentTimelineProps {
  items: TimelineItem[];
  isRunning: boolean;
  onOpenSheet: (sheet: SheetDestination) => void;
  onAnswerQuestion?: (questionId: string, answer: string) => void;
}

type RenderBlock =
  | { kind: 'single'; item: TimelineItem }
  | { kind: 'tool-group'; id: string; tools: ToolCallDetail[] };

function groupTimelineItems(items: TimelineItem[]): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  let pendingGroup: ToolCallDetail[] = [];

  const flushGroup = () => {
    if (pendingGroup.length === 0) return;
    if (pendingGroup.length === 1) {
      blocks.push({
        kind: 'single',
        item: {
          id: pendingGroup[0].id,
          kind: 'tool',
          stepIndex: pendingGroup[0].stepIndex,
          tool: pendingGroup[0],
        },
      });
    } else {
      blocks.push({
        kind: 'tool-group',
        id: `group-${pendingGroup[0].id}`,
        tools: [...pendingGroup],
      });
    }
    pendingGroup = [];
  };

  for (const item of items) {
    if (
      item.kind === 'tool' &&
      (item.tool.category === 'read' || item.tool.category === 'search' || item.tool.category === 'other')
    ) {
      pendingGroup.push(item.tool);
    } else {
      flushGroup();
      blocks.push({ kind: 'single', item });
    }
  }
  flushGroup();
  return blocks;
}

function ThinkingCard({
  text,
  durationSec,
  isStreaming,
  onOpenFull,
}: {
  text: string;
  durationSec?: number;
  isStreaming?: boolean;
  onOpenFull: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className="rounded-2xl border overflow-hidden"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0 cursor-pointer"
        >
          <Brain
            className={`w-3.5 h-3.5 shrink-0 ${isStreaming ? 'animate-pulse' : ''}`}
            style={{ color: 'var(--accent)' }}
          />
          <span className="text-[0.8rem] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {isStreaming
              ? t('thinkingLive')
              : durationSec
                ? t('thoughtFor', { sec: durationSec })
                : t('reasoning')}
          </span>
        </button>
        <button
          type="button"
          onClick={onOpenFull}
          className="text-[0.72rem] font-medium px-2 py-0.5 rounded-lg cursor-pointer"
          style={{ color: 'var(--text-muted)' }}
        >
          {t('fullView')}
        </button>
      </div>
      {expanded && (
        <div
          className="px-3.5 pb-3 pt-1.5 text-[0.8rem] leading-relaxed whitespace-pre-wrap border-t"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function AssistantMessageBlock({ markdown, isStreaming }: { markdown: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="px-1 py-0.5 group">
      <MarkdownView markdown={markdown} />
      {isStreaming && (
        <span
          className="inline-block w-2 h-4 ml-1 align-middle rounded-sm animate-pulse"
          style={{ background: 'var(--accent)' }}
        />
      )}
      {!isStreaming && markdown.trim().length > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[0.72rem] font-medium active:scale-95 transition-transform cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5" style={{ color: 'var(--green)' }} />
                <span style={{ color: 'var(--green)' }}>{t('copied')}</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>{t('copy')}</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ToolCallDetail['status'] }) {
  if (status === 'running') {
    return <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />;
  }
  if (status === 'error') {
    return <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--red)' }} />;
  }
  if (status === 'waiting') {
    return <span className="w-2 h-2 rounded-full shrink-0 animate-pulse" style={{ background: 'var(--amber)' }} />;
  }
  return <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--green)' }} />;
}

function AskUserQuestionCard({
  data,
  onAnswer,
}: {
  data: AskUserQuestionData;
  onAnswer?: (questionId: string, answer: string) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const [submitted, setSubmitted] = useState(Boolean(data.answered));

  const toggleOpt = (opt: string) => {
    if (submitted) return;
    if (data.multiSelect) {
      setSelected((prev) => (prev.includes(opt) ? prev.filter((x) => x !== opt) : [...prev, opt]));
    } else {
      setSelected([opt]);
    }
  };

  const handleSubmit = () => {
    const parts = [...selected];
    if (otherText.trim()) parts.push(otherText.trim());
    const finalAns = parts.join(', ');
    if (!finalAns) return;
    setSubmitted(true);
    onAnswer?.(data.id, finalAns);
  };

  return (
    <div
      className="p-3.5 rounded-2xl border space-y-2.5"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--accent)' }}
    >
      <div className="text-[0.88rem] font-semibold leading-snug">{data.question}</div>
      <div className="space-y-1.5">
        {data.options.map((opt) => {
          const active = selected.includes(opt) || data.selectedAnswer === opt;
          return (
            <button
              key={opt}
              type="button"
              disabled={submitted}
              onClick={() => toggleOpt(opt)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left text-[0.83rem] font-medium active:scale-[0.99] cursor-pointer disabled:opacity-75"
              style={{
                background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                color: active ? 'var(--accent)' : 'var(--text-primary)',
              }}
            >
              <span>{opt}</span>
              {active && <Check className="w-4 h-4 shrink-0" />}
            </button>
          );
        })}
      </div>
      {!submitted && (
        <div className="flex gap-2 pt-1">
          <input
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            placeholder={t('otherPlaceholder')}
            className="flex-1 px-3 h-9.5 rounded-xl text-[0.82rem] border outline-none"
            style={{
              background: 'var(--bg-elevated)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          />
          <button
            type="button"
            disabled={selected.length === 0 && !otherText.trim()}
            onClick={handleSubmit}
            className="px-4 h-9.5 rounded-xl text-[0.82rem] font-semibold cursor-pointer disabled:opacity-40"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {t('submitBtn')}
          </button>
        </div>
      )}
    </div>
  );
}

export function AgentTimeline({ items, isRunning, onOpenSheet, onAnswerQuestion }: AgentTimelineProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [showScrollFab, setShowScrollFab] = useState(false);
  const blocks = useMemo(() => groupTimelineItems(items), [items]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    if (!showScrollFab) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [items.length]);

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <main
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShowScrollFab(distFromBottom > 180);
        }}
        className="flex-1 overflow-y-auto px-3.5 md:px-6 py-4"
      >
        <div className="max-w-3xl mx-auto w-full space-y-3">
        {blocks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
            <img src="/favicon.svg" alt="Antigravity" className="w-12 h-12 mb-3 opacity-90" />
            <h2 className="text-[1.08rem] font-semibold">{t('readyToCode')}</h2>
            <p className="text-[0.85rem] mt-1.5 max-w-xs" style={{ color: 'var(--text-secondary)' }}>
              {t('readyToCodeDesc')}
            </p>
          </div>
        ) : (
          blocks.map((block) => {
            if (block.kind === 'tool-group') {
              const anyRunning = block.tools.some((tool) => tool.status === 'running');
              const summaryLabel = block.tools.map((tool) => tool.summary).slice(0, 2).join(', ');
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() =>
                    onOpenSheet({
                      kind: 'CollapsedToolCalls',
                      title: t('usedTools', { count: block.tools.length }),
                      tools: block.tools,
                    })
                  }
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-left active:scale-[0.99] transition-transform cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {anyRunning ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
                    ) : (
                      <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    )}
                    <span className="text-[0.8rem] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
                      {t('usedTools', { count: block.tools.length })} · {summaryLabel}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>
              );
            }

            const { item } = block;

            if (item.kind === 'user') {
              return (
                <div key={item.id} className="flex justify-end">
                  <div
                    className="max-w-[88%] px-4 py-2.5 rounded-2xl rounded-tr-md leading-relaxed whitespace-pre-wrap space-y-2"
                    style={{
                      fontSize: 'calc(0.93rem * var(--agy-font-scale))',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {item.attachments && item.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {item.attachments.map((att) =>
                          att.mimeType.startsWith('image/') ? (
                            <button
                              key={att.id}
                              type="button"
                              onClick={() =>
                                onOpenSheet({ kind: 'ImagePreview', src: att.dataUrl, title: att.name })
                              }
                              className="rounded-xl overflow-hidden border cursor-pointer"
                              style={{ borderColor: 'var(--border-subtle)' }}
                            >
                              <img src={att.dataUrl} alt={att.name} className="w-24 h-24 object-cover" />
                            </button>
                          ) : (
                            <span
                              key={att.id}
                              className="px-2 py-1 rounded-lg text-[0.72rem] font-mono border"
                              style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                            >
                              {att.name}
                            </span>
                          )
                        )}
                      </div>
                    )}
                    {item.text && <div>{item.text}</div>}
                  </div>
                </div>
              );
            }

            if (item.kind === 'question') {
              return (
                <AskUserQuestionCard
                  key={item.id}
                  data={item.question}
                  onAnswer={onAnswerQuestion}
                />
              );
            }

            if (item.kind === 'thinking') {
              return (
                <ThinkingCard
                  key={item.id}
                  text={item.text}
                  durationSec={item.durationSec}
                  isStreaming={item.isStreaming}
                  onOpenFull={() =>
                    onOpenSheet({
                      kind: 'ViewThinking',
                      text: item.text,
                      durationSec: item.durationSec,
                    })
                  }
                />
              );
            }

            if (item.kind === 'plan') {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    onOpenSheet({
                      kind: 'PlanView',
                      title: item.title,
                      path: item.path,
                      markdown: item.markdown,
                    })
                  }
                  className="w-full flex items-center justify-between gap-3 px-3.5 py-3 rounded-2xl border text-left active:scale-[0.99] transition-transform cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <FileText className="w-4.5 h-4.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[0.86rem] font-semibold truncate">{item.title}</div>
                      <div className="text-[0.74rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                        {t('tapInspectPlan')}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                </button>
              );
            }

            if (item.kind === 'tool') {
              const tool = item.tool;

              if (tool.category === 'edit') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onOpenSheet({
                        kind: 'DiffView',
                        title: tool.summary,
                        filePath: tool.filePath,
                        diff: tool.diffContent || tool.detail,
                      })
                    }
                    className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl border text-left active:scale-[0.99] transition-transform cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileCode2 className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
                      <div className="min-w-0">
                        <div className="text-[0.85rem] font-semibold truncate">{tool.summary}</div>
                        {tool.filePath && (
                          <div className="text-[0.72rem] font-mono truncate" style={{ color: 'var(--text-muted)' }}>
                            {tool.filePath}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {(tool.additions || tool.deletions) && (
                        <span className="text-[0.74rem] font-mono font-semibold">
                          <span style={{ color: 'var(--green)' }}>+{tool.additions || 0}</span>{' '}
                          <span style={{ color: 'var(--red)' }}>-{tool.deletions || 0}</span>
                        </span>
                      )}
                      <StatusIcon status={tool.status} />
                    </div>
                  </button>
                );
              }

              if (tool.category === 'terminal') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      onOpenSheet({
                        kind: 'BackgroundShellOutput',
                        command: tool.commandLine || tool.summary,
                        output: tool.shellOutput || tool.detail,
                        status: tool.status,
                      })
                    }
                    className="w-full rounded-2xl border overflow-hidden text-left active:scale-[0.99] transition-transform cursor-pointer"
                    style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <Terminal className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                        <span className="text-[0.8rem] font-mono font-medium truncate">
                          {tool.commandLine || tool.summary}
                        </span>
                      </div>
                      <StatusIcon status={tool.status} />
                    </div>
                    {tool.shellOutput && (
                      <div
                        className="px-3.5 py-2 text-[0.74rem] font-mono leading-[1.45] border-t"
                        style={{
                          background: 'var(--bg-elevated)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        <div className="line-clamp-2 whitespace-pre-wrap break-words">{tool.shellOutput}</div>
                      </div>
                    )}
                  </button>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    onOpenSheet({
                      kind: 'CollapsedToolCalls',
                      title: tool.name,
                      tools: [tool],
                    })
                  }
                  className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-left active:scale-[0.99] cursor-pointer"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Wrench className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-[0.8rem] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
                      {tool.name}: {tool.summary}
                    </span>
                  </div>
                  <StatusIcon status={tool.status} />
                </button>
              );
            }

            if (item.kind === 'error') {
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-2xl border text-[0.84rem]"
                  style={{
                    background: 'rgba(220, 38, 38, 0.08)',
                    borderColor: 'rgba(220, 38, 38, 0.25)',
                    color: 'var(--red)',
                  }}
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{item.message}</span>
                </div>
              );
            }

            return (
              <AssistantMessageBlock
                key={item.id}
                markdown={item.markdown}
                isStreaming={item.isStreaming}
              />
            );
          })
        )}

        {isRunning && (
          <div className="flex items-center gap-2 px-1 py-1 text-[0.8rem]" style={{ color: 'var(--text-muted)' }}>
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
            <span>{t('agentWorking')}</span>
          </div>
        )}

        <div ref={bottomRef} className="h-2" />
        </div>
      </main>

      {/* Floating Scroll-to-Bottom Pill */}
      {showScrollFab && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t('scrollToBottom')}
          className="absolute bottom-3 right-3.5 flex items-center justify-center w-9.5 h-9.5 rounded-full shadow-lg border active:scale-90 transition-transform cursor-pointer"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border-strong)',
            color: 'var(--text-primary)',
          }}
        >
          <ArrowDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
