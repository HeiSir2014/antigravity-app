import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Clock, Cpu, ImagePlus, Plus, Shield, Sparkles, Square, X, Zap } from 'lucide-react';
import { useI18n } from '../i18n';
import { registerBackHandler } from '../utils/backStack';
import { parseModelVariant } from '../utils/modelGroups';
import type { MediaAttachment, PermissionMode, QueuedUserMessage } from '../types/agent';
import { PendingQueueTray } from './PendingQueueTray';

interface ComposerProps {
  permissionMode: PermissionMode;
  activeModel: string;
  serverSlashCommands?: Array<{ cmd: string; desc: string }>;
  isRunning: boolean;
  queuedMessages?: QueuedUserMessage[];
  onSend: (text: string, attachments: MediaAttachment[]) => void;
  onQueueMessage?: (text: string, attachments: MediaAttachment[]) => void;
  onSendQueuedNow?: (item: QueuedUserMessage) => void;
  onSendAllQueuedNow?: () => void;
  onEditQueued?: (item: QueuedUserMessage, nextText: string) => void;
  onReorderQueued?: (fromIndex: number, toIndex: number) => void;
  onDeleteQueued?: (item: QueuedUserMessage) => void;
  onStop: () => void;
  onOpenPermissionSheet: () => void;
  onOpenModelSheet: () => void;
}

interface SlashCommandDef {
  cmd: string;
  desc: string;
}

export function Composer({
  permissionMode,
  activeModel,
  serverSlashCommands,
  isRunning,
  queuedMessages = [],
  onSend,
  onQueueMessage,
  onSendQueuedNow,
  onSendAllQueuedNow,
  onEditQueued,
  onReorderQueued,
  onDeleteQueued,
  onStop,
  onOpenPermissionSheet,
  onOpenModelSheet,
}: ComposerProps) {
  const { t, resolved } = useI18n();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(pointer: coarse)').matches;
  });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const lastCompositionEndRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = (event: MediaQueryListEvent) => setIsTouchDevice(event.matches);
    setIsTouchDevice(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const unregisterBack = registerBackHandler(40, () => {
      setMenuOpen(false);
      return true;
    });
    document.addEventListener('pointerdown', closeOnOutside);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      unregisterBack();
    };
  }, [menuOpen]);

  const slashCommands = useMemo<SlashCommandDef[]>(() => {
    if (serverSlashCommands && serverSlashCommands.length > 0) {
      return serverSlashCommands;
    }
    return [
      { cmd: '/plan', desc: t('slashPlan') },
      { cmd: '/review', desc: t('slashReview') },
      { cmd: '/compact', desc: t('slashCompact') },
      { cmd: '/test', desc: t('slashTest') },
      { cmd: '/diff', desc: t('slashDiff') },
      { cmd: '/goal', desc: t('slashGoal') },
      { cmd: '/grill-me', desc: t('slashGrill') },
      { cmd: '/learn', desc: t('slashLearn') },
    ];
  }, [t, serverSlashCommands]);

  const permLabels: Record<PermissionMode, string> = {
    'request-review': t('permAsk'),
    'accept-edits': t('permAcceptEdits'),
    'proceed-in-sandbox': t('permSandbox'),
    'always-proceed': t('permAuto'),
  };

  // Intelligent slash command suggestions when user types `/`
  const slashSuggestions = useMemo(() => {
    const match = /(?:^|\s)(\/[a-z-]*)$/i.exec(text);
    if (!match) return [];
    const query = match[1].toLowerCase();
    return slashCommands
      .filter(
        (c) => c.cmd.toLowerCase().startsWith(query) || c.desc.toLowerCase().includes(query.slice(1))
      )
      .slice(0, 6);
  }, [text, slashCommands]);

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(132, Math.max(40, el.scrollHeight))}px`;
  };

  const applySlashCommand = (cmd: string) => {
    const next = text.replace(/(?:^|\s)\/[a-z-]*$/i, (m) => (m.startsWith(' ') ? ` ${cmd} ` : `${cmd} `));
    setText(next);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        adjustHeight(textareaRef.current);
      }
    });
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const loaded: MediaAttachment[] = [];
    for (const file of Array.from(files).slice(0, 4)) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      loaded.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        dataUrl,
        base64,
      });
    }
    setAttachments((prev) => [...prev, ...loaded].slice(0, 4));
  };

  const clearComposer = () => {
    setText('');
    setAttachments([]);
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }
  };

  const handleSubmit = (mode: 'auto' | 'queue' | 'immediate' = 'auto') => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    if ((mode === 'queue' || (mode === 'auto' && isRunning)) && onQueueMessage) {
      onQueueMessage(trimmed, attachments);
    } else {
      onSend(trimmed, attachments);
    }
    clearComposer();
  };

  return (
    <footer
      className="relative px-3 md:px-6 pt-1.5 pb-2.5 shrink-0 border-t"
      style={{
        background: 'var(--bg-canvas)',
        borderColor: 'var(--border-subtle)',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div className="relative max-w-3xl mx-auto w-full">
      {queuedMessages.length > 0 && onSendQueuedNow && onEditQueued && onReorderQueued && onDeleteQueued && (
        <PendingQueueTray
          items={queuedMessages}
          onSendNow={onSendQueuedNow}
          onSendAllNow={onSendAllQueuedNow}
          onEdit={onEditQueued}
          onReorder={onReorderQueued}
          onDelete={onDeleteQueued}
        />
      )}
      {/* Floating Intelligent Slash Command Autocomplete Palette */}
      {slashSuggestions.length > 0 && (
        <div
          className="absolute left-3 right-3 bottom-full mb-2 rounded-2xl border shadow-xl overflow-hidden z-30"
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border-strong)',
          }}
        >
          {slashSuggestions.map((item) => (
            <button
              key={item.cmd}
              type="button"
              onClick={() => applySlashCommand(item.cmd)}
              className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left border-b last:border-b-0 active:opacity-75 cursor-pointer"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <span className="text-[0.84rem] font-mono font-semibold" style={{ color: 'var(--accent)' }}>
                  {item.cmd}
                </span>
                <span className="text-[0.76rem] truncate" style={{ color: 'var(--text-secondary)' }}>
                  {item.desc}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Main Claude-style rounded composer card */}
      <div
        className="rounded-2xl border px-3 pt-2 pb-2"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border-strong)',
        }}
      >
        {/* Attached Image / File Thumbnails */}
        {attachments.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 mb-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            {attachments.map((att) => (
              <div
                key={att.id}
                className="relative flex items-center gap-1.5 rounded-xl border overflow-hidden shrink-0"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                {att.mimeType.startsWith('image/') ? (
                  <img src={att.dataUrl} alt={att.name} className="w-12 h-12 object-cover" />
                ) : (
                  <div className="px-2.5 py-2 text-[0.74rem] font-mono max-w-[120px] truncate">{att.name}</div>
                )}
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== att.id))}
                  className="absolute top-0.5 right-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-black/65 text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          enterKeyHint={isTouchDevice ? 'enter' : 'send'}
          inputMode="text"
          autoCapitalize="sentences"
          onChange={(e) => {
            setText(e.target.value);
            adjustHeight(e.target);
          }}
          onCompositionEnd={(e) => {
            lastCompositionEndRef.current = e.timeStamp;
          }}
          onKeyDown={(e) => {
            // 3-part IME-safe Enter guard for Chinese/Japanese/Korean mobile & desktop keyboards
            const native = e.nativeEvent as KeyboardEvent;
            const isIme =
              native.isComposing ||
              native.keyCode === 229 ||
              Math.abs(e.timeStamp - lastCompositionEndRef.current) < 50;
            if (isIme) return;

            if (e.key === 'Tab' && slashSuggestions.length > 0) {
              e.preventDefault();
              applySlashCommand(slashSuggestions[0].cmd);
              return;
            }

            if (e.key === 'Enter') {
              if (isTouchDevice) {
                // On touch/mobile devices, Enter inserts a newline (IME shows Enter/Return);
                // only Cmd/Ctrl+Enter (hardware keyboard) or the Send button submits.
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  handleSubmit();
                }
                return;
              }
              if (!e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }
          }}
          placeholder={t('composerPlaceholder')}
          className="w-full resize-none bg-transparent outline-none leading-snug max-h-[132px]"
          style={{
            fontSize: 'calc(0.95rem * var(--agy-font-scale))',
            color: 'var(--text-primary)',
          }}
        />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.md,.txt,.ts,.tsx,.rs,.json,.py"
          className="hidden"
          onChange={(e) => {
            void handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="flex items-center justify-between gap-2 mt-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setMenuOpen((value) => !value)}
                aria-label={t('composerMenu')}
                aria-expanded={menuOpen}
                className="flex items-center justify-center w-8 h-8 rounded-full active:scale-95 cursor-pointer"
                style={{
                  background: menuOpen ? 'var(--accent-soft)' : 'var(--bg-elevated)',
                  color: menuOpen ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                <Plus className="w-4 h-4" />
              </button>

              {menuOpen && (
                <div
                  className="absolute bottom-full left-0 mb-2 w-60 rounded-xl border shadow-xl overflow-hidden z-30"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-strong)' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left active:opacity-75 cursor-pointer"
                  >
                    <ImagePlus className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    <span className="text-[0.8rem] font-medium">{t('attachFile')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenPermissionSheet();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-t active:opacity-75 cursor-pointer"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <Shield className="w-4 h-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    <span className="text-[0.8rem] font-medium flex-1">{t('permissionsRow')}</span>
                    <span className="text-[0.72rem]" style={{ color: 'var(--text-muted)' }}>
                      {permLabels[permissionMode]}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {(() => {
              const parsedModel = parseModelVariant(activeModel);
              return (
                <button
                  type="button"
                  onClick={onOpenModelSheet}
                  title={activeModel}
                  className="flex items-center gap-1.5 h-7.5 px-2.5 rounded-full text-[0.74rem] font-medium max-w-[230px] sm:max-w-[280px] min-w-0 active:scale-95 cursor-pointer"
                  style={{
                    background: 'var(--bg-elevated)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Cpu className="w-3 h-3 shrink-0" />
                  <span className="truncate min-w-0">{parsedModel.familyName}</span>
                  {parsedModel.shortBadge && (
                    <span
                      className="shrink-0 px-1.5 py-0.25 rounded-full text-[0.65rem] font-semibold leading-tight"
                      style={{
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                      }}
                    >
                      {parsedModel.shortBadge}
                    </span>
                  )}
                </button>
              );
            })()}
          </div>

          {isRunning && !text.trim() && attachments.length === 0 ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop agent"
              className="flex items-center justify-center w-9 h-9 rounded-full active:scale-90 transition-transform cursor-pointer shrink-0"
              style={{
                background: 'var(--text-primary)',
                color: 'var(--bg-surface)',
              }}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : isRunning && (text.trim() || attachments.length > 0) && onQueueMessage ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => handleSubmit('immediate')}
                title={resolved === 'en' ? 'Send immediately' : '立即发送'}
                className="inline-flex items-center gap-1 h-8.5 px-2.5 rounded-full text-[0.72rem] font-semibold border active:scale-95 transition-transform cursor-pointer"
                style={{
                  background: 'var(--bg-elevated)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              >
                <Zap className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>{resolved === 'en' ? 'Now' : '立发'}</span>
              </button>
              <button
                type="button"
                onClick={() => handleSubmit('queue')}
                title={resolved === 'en' ? 'Add to pending queue' : '排队发送'}
                className="inline-flex items-center gap-1 h-8.5 px-3 rounded-full text-[0.74rem] font-semibold active:scale-95 transition-transform cursor-pointer"
                style={{
                  background: 'var(--accent)',
                  color: '#ffffff',
                }}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>{resolved === 'en' ? 'Queue' : '排队'}</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!text.trim() && attachments.length === 0}
              onClick={() => handleSubmit('immediate')}
              aria-label="Send message"
              className="flex items-center justify-center w-9 h-9 rounded-full active:scale-90 transition-transform cursor-pointer disabled:opacity-35 shrink-0"
              style={{
                background: 'var(--accent)',
                color: '#ffffff',
              }}
            >
              <ArrowUp className="w-4.5 h-4.5" />
            </button>
          )}
        </div>
      </div>
      </div>
    </footer>
  );
}
