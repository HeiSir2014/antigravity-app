import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Pencil,
  Send,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n';
import type { QueuedUserMessage } from '../types/agent';

interface PendingQueueTrayProps {
  items: QueuedUserMessage[];
  onSendNow: (item: QueuedUserMessage) => void;
  onSendAllNow?: () => void;
  onEdit: (item: QueuedUserMessage, nextText: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (item: QueuedUserMessage) => void;
}

/**
 * Multi-item Pending / Queued Messages tray displayed above the Composer while the agent is busy.
 * Supports:
 * - Multiple pending messages in order
 * - Reordering items up/down
 * - Inline editing & saving a queued message
 * - One-tap "Send Now" on ANY item (including an item in the middle of the queue)
 * - Deleting individual queued messages
 */
export function PendingQueueTray({
  items,
  onSendNow,
  onSendAllNow,
  onEdit,
  onReorder,
  onDelete,
}: PendingQueueTrayProps) {
  const { resolved } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  if (items.length === 0) return null;

  const startEdit = (item: QueuedUserMessage) => {
    setEditingId(item.id);
    setDraft(item.text);
  };

  const commitEdit = (item: QueuedUserMessage) => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onEdit(item, trimmed);
    setEditingId(null);
    setDraft('');
  };

  return (
    <div
      className="mb-2 rounded-2xl border overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        borderColor: 'var(--border-strong)',
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 border-b"
        style={{
          background: 'var(--bg-elevated)',
          borderColor: collapsed ? 'transparent' : 'var(--border-subtle)',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex items-center gap-1.5 text-[0.74rem] font-semibold cursor-pointer min-w-0"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <span className="truncate">
            {resolved === 'en'
              ? `Pending Queue (${items.length})`
              : `待发送队列 (${items.length})`}
          </span>
          {collapsed ? (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          )}
        </button>

        {items.length > 1 && onSendAllNow && (
          <button
            type="button"
            onClick={onSendAllNow}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[0.7rem] font-semibold cursor-pointer active:scale-95 shrink-0"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            <Zap className="w-3 h-3" />
            <span>{resolved === 'en' ? 'Send All' : '全部立发'}</span>
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="divide-y max-h-48 overflow-y-auto" style={{ borderColor: 'var(--border-subtle)' }}>
          {items.map((item, idx) => {
            const isEditing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="px-3 py-2 flex items-start gap-2"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <span
                  className="text-[0.68rem] font-mono font-semibold w-4 pt-0.5 shrink-0 text-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {idx + 1}
                </span>

                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <textarea
                        rows={2}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="w-full rounded-xl px-2.5 py-1.5 text-[0.8rem] border outline-none resize-none"
                        style={{
                          background: 'var(--bg-elevated)',
                          borderColor: 'var(--accent)',
                          color: 'var(--text-primary)',
                        }}
                      />
                      <div className="flex items-center gap-1.5 justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setDraft('');
                          }}
                          className="inline-flex items-center gap-1 px-2 h-6.5 rounded-lg text-[0.7rem] font-medium cursor-pointer"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                        >
                          <X className="w-3 h-3" />
                          <span>{resolved === 'en' ? 'Cancel' : '取消'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={!draft.trim()}
                          onClick={() => commitEdit(item)}
                          className="inline-flex items-center gap-1 px-2.5 h-6.5 rounded-lg text-[0.7rem] font-semibold cursor-pointer disabled:opacity-40"
                          style={{ background: 'var(--accent)', color: '#fff' }}
                        >
                          <Check className="w-3 h-3" />
                          <span>{resolved === 'en' ? 'Save' : '保存'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className="text-[0.8rem] leading-snug line-clamp-2 break-words"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {item.text || (resolved === 'en' ? '[Attachment]' : '[图片/附件]')}
                    </div>
                  )}
                </div>

                {!isEditing && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    {items.length > 1 && (
                      <>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onReorder(idx, idx - 1)}
                          title={resolved === 'en' ? 'Move up' : '上移'}
                          aria-label="Move up"
                          className="flex items-center justify-center w-6.5 h-6.5 rounded-lg cursor-pointer disabled:opacity-25 active:scale-90"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === items.length - 1}
                          onClick={() => onReorder(idx, idx + 1)}
                          title={resolved === 'en' ? 'Move down' : '下移'}
                          aria-label="Move down"
                          className="flex items-center justify-center w-6.5 h-6.5 rounded-lg cursor-pointer disabled:opacity-25 active:scale-90"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => onSendNow(item)}
                      title={resolved === 'en' ? 'Send immediately' : '立即发送'}
                      aria-label="Send immediately"
                      className="flex items-center justify-center w-6.5 h-6.5 rounded-lg cursor-pointer active:scale-90"
                      style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(item)}
                      title={resolved === 'en' ? 'Edit queued message' : '编辑'}
                      aria-label="Edit queued message"
                      className="flex items-center justify-center w-6.5 h-6.5 rounded-lg cursor-pointer active:scale-90"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item)}
                      title={resolved === 'en' ? 'Delete queued message' : '删除'}
                      aria-label="Delete queued message"
                      className="flex items-center justify-center w-6.5 h-6.5 rounded-lg cursor-pointer active:scale-90"
                      style={{ color: 'var(--red)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
