import type {
  MediaAttachment,
  PendingApproval,
  QueuedUserMessage,
  TaskChecklistItem,
  TimelineItem,
  ToolCallDetail,
  ToolCategory,
} from '../types/agent';

export interface NormalizedTrajectory {
  items: TimelineItem[];
  pendingApproval: PendingApproval | null;
  allDiffs: Array<{ title: string; filePath: string; diff: string; additions: number; deletions: number }>;
  tasks: TaskChecklistItem[];
  queuedMessages: QueuedUserMessage[];
  isRunning: boolean;
  detectedModel?: string;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|bmp|avif)(?:[?#].*)?$/i;

function inferMime(pathOrUrl: string, explicitMime?: string): string {
  if (explicitMime && explicitMime.includes('/')) return explicitMime;
  const lower = (pathOrUrl || '').split('?')[0].toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

function extractMediaFromEntry(raw: unknown, idPrefix: string): MediaAttachment | null {
  if (typeof raw === 'string' && raw.trim()) {
    const s = raw.trim();
    if (s.startsWith('data:image/')) {
      const mime = s.slice(5, s.indexOf(';')) || 'image/png';
      return { id: idPrefix, name: 'image', mimeType: mime, dataUrl: s, base64: '' };
    }
    if (s.startsWith('http://') || s.startsWith('https://')) {
      return {
        id: idPrefix,
        name: s.split('/').pop() || 'image',
        mimeType: inferMime(s, 'image/png'),
        dataUrl: s,
        base64: '',
        remoteUri: s,
      };
    }
    if (IMAGE_EXT_RE.test(s)) {
      return {
        id: idPrefix,
        name: s.split('/').pop() || 'image',
        mimeType: inferMime(s, 'image/png'),
        dataUrl: '',
        base64: '',
        remoteUri: s,
      };
    }
    return null;
  }

  const obj = asObj(raw);
  if (!obj) return null;

  const uri = asStr(
    obj.uri ||
      obj.url ||
      obj.imageUrl ||
      obj.imageUri ||
      obj.absolutePathUri ||
      obj.path ||
      obj.filePath ||
      obj.outputPath
  );
  const name =
    asStr(obj.name || obj.fileName || obj.title) ||
    (uri ? uri.split('/').pop() || 'attachment' : 'image');

  const payload = asObj(obj.payload);
  const inlineData =
    asStr(obj.inlineData) ||
    asStr(obj.base64) ||
    asStr(obj.data) ||
    (payload?.case === 'inlineData' ? asStr(payload.value) : '') ||
    asStr(obj.thumbnail);

  const explicitMime = asStr(obj.mimeType || obj.mediaType || obj.contentType);
  const mimeType = inferMime(uri || name, explicitMime || (inlineData ? 'image/png' : undefined));

  let dataUrl = '';
  let base64 = '';
  if (inlineData) {
    if (inlineData.startsWith('data:')) {
      dataUrl = inlineData;
    } else {
      base64 = inlineData.replace(/\s+/g, '');
      dataUrl = `data:${mimeType.startsWith('image/') ? mimeType : 'image/png'};base64,${base64}`;
    }
  } else if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:'))) {
    dataUrl = uri;
  }

  if (!dataUrl && !uri) return null;

  return {
    id: idPrefix,
    name,
    mimeType: dataUrl.startsWith('data:image/') || IMAGE_EXT_RE.test(uri || name) ? (mimeType.startsWith('image/') ? mimeType : 'image/png') : mimeType,
    dataUrl,
    base64,
    remoteUri: uri || undefined,
  };
}

function collectMediaAttachments(sources: unknown[], idPrefix: string): MediaAttachment[] {
  const out: MediaAttachment[] = [];
  const seen = new Set<string>();
  let idx = 0;
  for (const src of sources) {
    const list = Array.isArray(src) ? src : src ? [src] : [];
    for (const entry of list) {
      const att = extractMediaFromEntry(entry, `${idPrefix}-${idx++}`);
      if (!att) continue;
      const dedupeKey = att.remoteUri || att.dataUrl.slice(0, 64) || att.id;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(att);
    }
  }
  return out;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Official `google.protobuf.Duration` JSON is `{ seconds, nanos }`. */
function durationSeconds(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.max(1, Math.round(v));
  }
  const obj = asObj(v);
  if (!obj) {
    if (typeof v === 'string') {
      const seconds = Number.parseFloat(v);
      return Number.isFinite(seconds) && seconds > 0 ? Math.max(1, Math.round(seconds)) : undefined;
    }
    return undefined;
  }
  const seconds = Number(obj.seconds ?? 0);
  const nanos = Number(obj.nanos ?? 0);
  const total = (Number.isFinite(seconds) ? seconds : 0) + (Number.isFinite(nanos) ? nanos / 1e9 : 0);
  return total > 0 ? Math.max(1, Math.round(total)) : undefined;
}

function approvalFromRequestedInteraction(
  step: Record<string, unknown>,
  requested: Record<string, unknown>,
  trajectoryId: string,
  stepIndex: number
): PendingApproval | null {
  const runCommand = asObj(requested.runCommand);
  if (runCommand) {
    const stepRun = asObj(step.runCommand);
    const commandLine = asStr(
      runCommand.commandLine ||
        runCommand.proposedCommandLine ||
        stepRun?.commandLine ||
        stepRun?.proposedCommandLine ||
        stepRun?.command
    );
    return {
      trajectoryId,
      stepIndex,
      kind: 'runCommand',
      toolName: 'Run Command',
      title: 'Allow terminal command?',
      commandOrDiff: commandLine,
    };
  }

  const filePermission = asObj(requested.filePermission);
  if (filePermission) {
    const codeAction = asObj(step.codeAction);
    const filePermissionRequest = asObj(codeAction?.filePermissionRequest);
    const path = asStr(
      filePermission.absolutePathUri ||
        filePermission.absolutePathMigrateMeToUri ||
        filePermissionRequest?.absolutePathUri
    );
    return {
      trajectoryId,
      stepIndex,
      kind: 'filePermission',
      toolName: 'Edit File',
      title: path ? `Allow edit to ${path.split('/').pop() || path}?` : 'Allow file access?',
      commandOrDiff: path,
      filePath: path,
    };
  }

  const permission = asObj(requested.permission);
  if (permission) {
    const detail = asStr(
      permission.actionDescription || permission.reason || permission.resource || 'Permission required'
    );
    return {
      trajectoryId,
      stepIndex,
      kind: 'permission',
      toolName: 'Permission',
      title: 'Allow this action?',
      commandOrDiff: detail,
    };
  }

  if (asObj(requested.approvalInteraction)) {
    return {
      trajectoryId,
      stepIndex,
      kind: 'plan',
      toolName: 'Approval',
      title: 'Approve this plan?',
      commandOrDiff: '',
    };
  }

  return null;
}

export function isQuotaLimitError(message: string, errorCode?: string): boolean {
  const combined = `${errorCode || ''} ${message || ''}`.toUpperCase();
  return (
    combined.includes('MODEL_QUOTA_LIMIT_EXCEEDED') ||
    combined.includes('LOW_CREDITS') ||
    combined.includes('RESOURCE_EXHAUSTED') ||
    combined.includes('QUOTA_EXCEEDED') ||
    combined.includes('QUOTA') ||
    combined.includes('RATE_LIMIT') ||
    combined.includes('RATE LIMIT') ||
    combined.includes('USAGE LIMIT') ||
    combined.includes('LIMIT REACHED') ||
    combined.includes('OUT OF CREDITS') ||
    combined.includes('INSUFFICIENT CREDITS') ||
    combined.includes('HTTP 429') ||
    combined.includes('TOO MANY REQUESTS') ||
    combined.includes('用量') ||
    combined.includes('配额') ||
    combined.includes('额度')
  );
}

interface ExtractedStepError {
  message: string;
  errorCode?: string;
  isQuotaError: boolean;
  resetTime?: string;
}

function extractStepError(step: Record<string, unknown>): ExtractedStepError | null {
  const errMsgWrap = asObj(step.errorMessage);
  const errObj = asObj(errMsgWrap?.error) || asObj(step.error) || errMsgWrap;
  if (!errObj) return null;

  const rawCode = errObj.errorCode ?? errObj.code ?? errObj.reason;
  const errorCode =
    rawCode === 8 || String(rawCode).toUpperCase().includes('RESOURCE_EXHAUSTED')
      ? 'RESOURCE_EXHAUSTED'
      : rawCode != null && String(rawCode).trim() !== ''
        ? String(rawCode)
        : undefined;

  // Build message from official Antigravity error fields (userErrorMessage / shortError / fullError / message / structuredErrorParts)
  let message =
    asStr(errObj.userErrorMessage) ||
    asStr(errObj.shortError) ||
    asStr(errObj.message) ||
    asStr(errMsgWrap?.userErrorMessage) ||
    asStr(errMsgWrap?.message) ||
    asStr(errObj.fullError);

  if (!message && Array.isArray(errObj.structuredErrorParts)) {
    const parts = errObj.structuredErrorParts
      .map((p) => {
        const po = asObj(p);
        return asStr(po?.text || po?.message);
      })
      .filter(Boolean);
    if (parts.length > 0) message = parts.join(' ');
  }

  if (!message.trim()) return null;

  // Try to extract reset time string if embedded in error details or text
  const resetTime =
    asStr(errObj.resetTime) ||
    asStr(asObj(errObj.quotaInfo)?.resetTime) ||
    undefined;

  const isQuotaError = isQuotaLimitError(message, errorCode);
  return { message: message.trim(), errorCode, isQuotaError, resetTime };
}

function classifyTool(rawType: string): ToolCategory {
  const t = rawType.toLowerCase();
  if (t.includes('view') || t.includes('read') || t.includes('list_dir')) return 'read';
  if (t.includes('grep') || t.includes('find') || t.includes('search') || t.includes('mquery')) return 'search';
  if (t.includes('code_action') || t.includes('edit') || t.includes('write') || t.includes('replace')) return 'edit';
  if (t.includes('command') || t.includes('terminal') || t.includes('shell')) return 'terminal';
  if (t.includes('browser')) return 'browser';
  if (t.includes('mcp')) return 'mcp';
  return 'other';
}

function mapStepStatus(raw: unknown): 'running' | 'done' | 'error' | 'waiting' {
  const s = String(raw || '').toUpperCase();
  if (s.includes('WAITING')) return 'waiting';
  if (
    s.includes('RUNNING') ||
    s.includes('GENERATING') ||
    s.includes('PENDING') ||
    s.includes('QUEUED')
  ) {
    return 'running';
  }
  if (
    s.includes('ERROR') ||
    s.includes('FAILED') ||
    s.includes('CANCEL') ||
    s.includes('INVALID') ||
    s.includes('INTERRUPTED')
  ) {
    return 'error';
  }
  return 'done';
}

/**
 * Converts raw LanguageServerService `GetCascadeTrajectoryStepsResponse` or
 * `StreamAgentStateUpdatesResponse` step arrays into clean Claude-Mobile-style TimelineItems.
 */
export function normalizeTrajectorySteps(rawSteps: unknown[], trajectoryId = ''): NormalizedTrajectory {
  const items: TimelineItem[] = [];
  const allDiffs: NormalizedTrajectory['allDiffs'] = [];
  const tasks: TaskChecklistItem[] = [];
  const queuedMessages: QueuedUserMessage[] = [];
  let pendingApproval: PendingApproval | null = null;
  let isRunning = false;
  let detectedModel: string | undefined;

  rawSteps.forEach((raw, idx) => {
    const step = asObj(raw);
    if (!step) return;

    // Track the most recently used model in this remote session so the mobile composer
    // automatically stays in sync with the workstation.
    const meta = asObj(step.metadata);
    const stepPlanner = asObj(step.plannerResponse);
    const stepUser = asObj(step.userInput);
    const reqModelObj =
      asObj(meta?.requestedModel) ||
      asObj(asObj(asObj(stepUser?.cascadeConfig)?.plannerConfig)?.requestedModel) ||
      asObj(stepPlanner?.requestedModel);
    const candidateModel =
      asStr(meta?.generatorModel) ||
      asStr(meta?.model) ||
      asStr(reqModelObj?.model) ||
      asStr(reqModelObj?.alias) ||
      asStr(stepPlanner?.model);
    if (candidateModel) {
      detectedModel = candidateModel;
    }

    const stepType = asStr(step.type || step.stepType);
    const status = mapStepStatus(step.status);
    if (status === 'running') isRunning = true;

    // Official approvals are carried by requested_interaction, not only by
    // CORTEX_STEP_STATUS_WAITING. Read it before the step-type renderers.
    const requestedInteraction = asObj(step.requestedInteraction);
    const completedInteractions = Array.isArray(step.completedInteractions)
      ? step.completedInteractions
      : [];
    if (requestedInteraction && completedInteractions.length === 0 && !pendingApproval) {
      pendingApproval = approvalFromRequestedInteraction(
        step,
        requestedInteraction,
        trajectoryId,
        idx
      );
    }

    // 1. User Input (including queued messages and base64 / URL / file media attachments)
    const userInput = asObj(step.userInput);
    if (userInput || stepType.includes('USER_INPUT')) {
      const textParts: string[] = [];
      const itemMedia: unknown[] = [];
      const rawItems = Array.isArray(userInput?.items) ? userInput.items : [];
      for (const it of rawItems) {
        const obj = asObj(it);
        if (obj?.text) textParts.push(asStr(obj.text));
        if (obj?.image) itemMedia.push(obj.image);
        if (obj?.media) itemMedia.push(obj.media);
        if (obj?.item) {
          const inner = asObj(obj.item);
          if (inner?.image) itemMedia.push(inner.image);
          if (inner?.media) itemMedia.push(inner.media);
        }
      }
      const attachments = collectMediaAttachments(
        [userInput?.media, userInput?.images, step.media, itemMedia],
        `user-media-${idx}`
      );
      const text = textParts.join('\n').trim() || asStr(userInput?.userResponse) || asStr(step.text);
      const isQueued = String(step.status || '').toUpperCase().includes('QUEUED');
      if (isQueued && (text || attachments.length > 0)) {
        queuedMessages.push({
          id: `queued-${idx}`,
          stepIndex: idx,
          text,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
      }
      if (text || attachments.length > 0) {
        items.push({
          id: `user-${idx}`,
          kind: 'user',
          stepIndex: idx,
          text,
          attachments: attachments.length > 0 ? attachments : undefined,
          queued: isQueued || undefined,
        });
      }
      return;
    }

    // 2. Planner Response (Thinking + Assistant Markdown + attached Step Error such as Quota Exceeded)
    const planner = asObj(step.plannerResponse);
    if (planner || stepType.includes('PLANNER_RESPONSE')) {
      const thinking = asStr(planner?.thinking || planner?.thought);
      if (thinking.trim()) {
        items.push({
          id: `think-${idx}`,
          kind: 'thinking',
          stepIndex: idx,
          text: thinking.trim(),
          durationSec:
            durationSeconds(planner?.thinkingDuration) ??
            (typeof planner?.thinkingDurationMs === 'number'
              ? Math.max(1, Math.round(planner.thinkingDurationMs / 1000))
              : undefined),
          isStreaming: status === 'running' && !asStr(planner?.response || planner?.modifiedResponse),
        });
      }
      const response = asStr(planner?.modifiedResponse || planner?.response);
      if (response.trim()) {
        items.push({
          id: `asst-${idx}`,
          kind: 'assistant',
          stepIndex: idx,
          markdown: response,
          isStreaming: status === 'running',
        });
      }
      // Official web UI renders step.error on plannerResponse when model hits quota/rate limit or fails
      const stepErr = extractStepError(step);
      if (stepErr) {
        items.push({
          id: `err-${idx}`,
          kind: 'error',
          stepIndex: idx,
          message: stepErr.message,
          isQuotaError: stepErr.isQuotaError,
          errorCode: stepErr.errorCode,
          resetTime: stepErr.resetTime,
        });
      }
      return;
    }

    // 3. Run Command / Terminal
    const runCmd = asObj(step.runCommand);
    if (runCmd || stepType.includes('RUN_COMMAND')) {
      const cmdLine = asStr(runCmd?.commandLine || runCmd?.proposedCommandLine || runCmd?.command);
      const output = asStr(
        asObj(runCmd?.combinedOutput)?.full || runCmd?.output || runCmd?.stdout || ''
      );
      const exitCode = typeof runCmd?.exitCode === 'number' ? runCmd.exitCode : undefined;

      const tool: ToolCallDetail = {
        id: `cmd-${idx}`,
        stepIndex: idx,
        name: 'Terminal',
        category: 'terminal',
        summary: cmdLine || 'Run command',
        detail: output || cmdLine,
        commandLine: cmdLine,
        shellOutput: output,
        exitCode,
        status,
      };
      items.push({ id: tool.id, kind: 'tool', stepIndex: idx, tool });

      if (!pendingApproval && completedInteractions.length === 0 && status === 'waiting') {
        pendingApproval = {
          trajectoryId,
          stepIndex: idx,
          kind: 'runCommand',
          toolName: 'Run Command',
          title: 'Allow terminal command?',
          commandOrDiff: cmdLine,
        };
      }
      return;
    }

    // 4. Code Action / File Edit
    const codeAction = asObj(step.codeAction) || asObj(step.writeToFile) || asObj(step.replaceFileContent);
    if (codeAction || stepType.includes('CODE_ACTION') || stepType.includes('WRITE_TO_FILE')) {
      const actionSpec = asObj(codeAction?.actionSpec);
      const actionResult = asObj(codeAction?.actionResult);
      const editResult = asObj(actionResult?.edit);
      const specCommand = asObj(actionSpec?.command);
      const specCreate = asObj(actionSpec?.createFile);
      const specDelete = asObj(actionSpec?.deleteFile);
      const specSed = asObj(actionSpec?.sed);
      const specPath =
        asObj(specCommand?.file) ||
        asObj(specCreate?.path) ||
        asObj(specDelete?.path) ||
        asObj(specSed?.path);
      const targetUri = asStr(
        editResult?.absoluteUri ||
          editResult?.absolutePathMigrateMeToUri ||
          specPath?.absoluteUri ||
          specPath?.absolutePathMigrateMeToUri ||
          codeAction?.targetFile ||
          codeAction?.path ||
          codeAction?.uri
      );
      const fileName = targetUri ? targetUri.split('/').pop() || targetUri : 'File edit';

      // Official diff is ActionResult.edit.diff.unifiedDiff.lines[] with
      // UNIFIED_DIFF_LINE_TYPE_INSERT/DELETE/UNCHANGED, not a unified string.
      const rawDiffLines = asObj(asObj(editResult?.diff)?.unifiedDiff)?.lines;
      let diffText = '';
      if (Array.isArray(rawDiffLines)) {
        diffText = rawDiffLines
          .map((line) => {
            const obj = asObj(line);
            const type = asStr(obj?.type);
            const text = asStr(obj?.text);
            const prefix = type.endsWith('INSERT') ? '+' : type.endsWith('DELETE') ? '-' : ' ';
            return `${prefix}${text}`;
          })
          .join('\n');
      }
      if (!diffText) {
        diffText = asStr(
          asObj(codeAction?.diff)?.unifiedDiff || codeAction?.unifiedDiff || codeAction?.codeContent || ''
        );
      }
      const additions = diffText ? (diffText.match(/^\+[^+]/gm) || []).length : 0;
      const deletions = diffText ? (diffText.match(/^-[^-]/gm) || []).length : 0;

      if (fileName.endsWith('.md') && (fileName.includes('plan') || fileName.includes('walkthrough'))) {
        items.push({
          id: `plan-${idx}`,
          kind: 'plan',
          stepIndex: idx,
          title: fileName,
          path: targetUri,
          markdown: diffText || 'Artifact updated',
        });
      } else {
        const tool: ToolCallDetail = {
          id: `edit-${idx}`,
          stepIndex: idx,
          name: 'Edit File',
          category: 'edit',
          summary: fileName,
          detail: diffText || targetUri,
          filePath: targetUri,
          additions,
          deletions,
          diffContent: diffText,
          status,
        };
        items.push({ id: tool.id, kind: 'tool', stepIndex: idx, tool });
        if (diffText) {
          allDiffs.push({ title: fileName, filePath: targetUri, diff: diffText, additions, deletions });
        }
      }

      const filePermissionRequest = asObj(codeAction?.filePermissionRequest);
      if (
        !pendingApproval &&
        completedInteractions.length === 0 &&
        (filePermissionRequest || status === 'waiting')
      ) {
        pendingApproval = {
          trajectoryId,
          stepIndex: idx,
          kind: 'filePermission',
          toolName: 'Edit File',
          title: `Allow edit to ${fileName}?`,
          commandOrDiff: diffText || targetUri,
          filePath: targetUri || asStr(filePermissionRequest?.absolutePathUri),
        };
      }
      return;
    }

    // 5. Notify User / Plan Review
    const notifyUser = asObj(step.notifyUser);
    if (notifyUser || stepType.includes('NOTIFY_USER')) {
      const msg = asStr(notifyUser?.notificationContent || notifyUser?.message);
      if (msg) {
        items.push({
          id: `notify-${idx}`,
          kind: 'assistant',
          stepIndex: idx,
          markdown: msg,
        });
      }
      return;
    }

    // 6. Task Boundary (milestone divider + task checklist)
    const taskBoundary = asObj(step.taskBoundary);
    if (taskBoundary) {
      const taskName = asStr(
        taskBoundary.taskName || taskBoundary.taskSummary || taskBoundary.taskStatus
      );
      const taskStatus = asStr(taskBoundary.taskStatus);
      const mode = asStr(taskBoundary.mode);
      if (taskName) {
        tasks.push({
          id: `task-${idx}`,
          label: taskName,
          status: status === 'done' ? 'done' : 'in_progress',
        });
        items.push({
          id: `milestone-${idx}`,
          kind: 'milestone',
          stepIndex: idx,
          title: taskName,
          subtitle: taskStatus && taskStatus !== taskName ? taskStatus : undefined,
          mode: mode || undefined,
          status,
        });
      }
      return;
    }

    // 6b. Interactive Ask Question
    const askQuestion = asObj(step.askQuestion);
    if (askQuestion || stepType.includes('ASK_QUESTION')) {
      const rawQuestions = Array.isArray(askQuestion?.questions) ? askQuestion.questions : [];
      const firstQ = asObj(rawQuestions[0]) || askQuestion;
      const questionText = asStr(firstQ?.question || firstQ?.prompt || askQuestion?.prompt);
      const rawOpts = Array.isArray(firstQ?.options) ? firstQ.options : [];
      const options = rawOpts
        .map((o) => (typeof o === 'string' ? o : asStr(asObj(o)?.label || asObj(o)?.text)))
        .filter(Boolean);
      if (questionText) {
        items.push({
          id: `question-${idx}`,
          kind: 'question',
          stepIndex: idx,
          question: {
            id: `question-${idx}`,
            stepIndex: idx,
            question: questionText,
            options,
            multiSelect: Boolean(firstQ?.isMultiSelect || firstQ?.multiSelect),
            answered: status === 'done',
          },
        });
        return;
      }
    }

    // 6c. Generate Image & Browser Screenshot (inline image gallery)
    const genImage = asObj(step.generateImage);
    const screenshot = asObj(step.captureBrowserScreenshot);
    if (genImage || screenshot || stepType.includes('GENERATE_IMAGE') || stepType.includes('CAPTURE_BROWSER_SCREENSHOT')) {
      const isGen = Boolean(genImage || stepType.includes('GENERATE_IMAGE'));
      const srcObj = isGen ? genImage : screenshot;
      const attachments = collectMediaAttachments(
        [
          srcObj?.images,
          srcObj?.media,
          srcObj?.image,
          srcObj?.screenshot,
          srcObj?.outputPaths,
          srcObj?.outputPath,
          srcObj?.uri,
          srcObj?.imageUri,
          srcObj?.url,
          step.media,
        ],
        `img-step-${idx}`
      );
      const summary =
        asStr(srcObj?.prompt || srcObj?.imageName || srcObj?.url || srcObj?.title) ||
        (isGen ? 'Generated image' : 'Browser screenshot');
      const tool: ToolCallDetail = {
        id: `media-${idx}`,
        stepIndex: idx,
        name: isGen ? 'Generate Image' : 'Screenshot',
        category: isGen ? 'other' : 'browser',
        summary,
        detail: summary,
        attachments: attachments.length > 0 ? attachments : undefined,
        status,
      };
      items.push({ id: tool.id, kind: 'tool', stepIndex: idx, tool });
      return;
    }

    // 7. Error Step (including MODEL_QUOTA_LIMIT_EXCEEDED / LOW_CREDITS / RESOURCE_EXHAUSTED)
    const extractedErr = extractStepError(step);
    if (extractedErr && (step.errorMessage || stepType.includes('ERROR') || status === 'error')) {
      items.push({
        id: `err-${idx}`,
        kind: 'error',
        stepIndex: idx,
        message: extractedErr.message,
        isQuotaError: extractedErr.isQuotaError,
        errorCode: extractedErr.errorCode,
        resetTime: extractedErr.resetTime,
      });
      return;
    }

    // 8. Semantic Read / Search / Subagent / Browser / MCP Tool Steps
    const category = classifyTool(stepType);
    const cleanName = stepType
      .replace(/^CORTEX_STEP_TYPE_/, '')
      .split('_')
      .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : ''))
      .join(' ')
      .trim() || 'Tool';

    const viewFile = asObj(step.viewFile);
    const viewOutline = asObj(step.viewFileOutline);
    const viewCodeItem = asObj(step.viewCodeItem);
    const grepSearch = asObj(step.grepSearch);
    const findByName = asObj(step.findByName) || asObj(step.find);
    const listDir = asObj(step.listDir) || asObj(step.listDirectory);
    const searchWeb = asObj(step.searchWeb);
    const readUrl = asObj(step.readUrlContent) || asObj(step.openBrowserUrl);
    const mcpTool = asObj(step.mcpTool);
    const subagent = asObj(step.invokeSubagent) || asObj(step.browserSubagent);

    const filePath = asStr(
      viewFile?.absolutePathUri ||
        viewFile?.path ||
        viewOutline?.absolutePathUri ||
        viewCodeItem?.file ||
        listDir?.directoryPath
    );
    const startLine = typeof viewFile?.startLine === 'number' ? viewFile.startLine : undefined;
    const endLine = typeof viewFile?.endLine === 'number' ? viewFile.endLine : undefined;
    const lineRange =
      startLine && endLine ? `L${startLine}-${endLine}` : startLine ? `L${startLine}` : undefined;

    const viewedImageAttachments =
      filePath && IMAGE_EXT_RE.test(filePath)
        ? collectMediaAttachments([filePath, viewFile?.media, step.media], `view-img-${idx}`)
        : [];

    let name = cleanName;
    let summary = cleanName;
    let detail = '';

    if (viewFile || viewOutline || viewCodeItem) {
      name = viewFile ? 'Read File' : viewOutline ? 'File Outline' : 'View Symbol';
      summary = filePath ? filePath.split('/').pop() || filePath : name;
      detail = [filePath, lineRange].filter(Boolean).join(' · ') || summary;
    } else if (listDir) {
      name = 'List Directory';
      summary = filePath ? filePath.split('/').pop() || filePath : name;
      detail = filePath || summary;
    } else if (grepSearch) {
      name = 'Grep Search';
      const q = asStr(grepSearch.query);
      const hits = Array.isArray(grepSearch.results) ? grepSearch.results.length : undefined;
      summary = q || name;
      detail = hits !== undefined ? `Query: ${q} (${hits} matches)` : `Query: ${q}`;
    } else if (findByName) {
      name = 'Find Files';
      summary = asStr(findByName.pattern || findByName.query) || name;
      detail = summary;
    } else if (searchWeb) {
      name = 'Web Search';
      summary = asStr(searchWeb.query) || name;
      detail = summary;
    } else if (readUrl) {
      name = stepType.includes('BROWSER') ? 'Open URL' : 'Read URL';
      summary = asStr(readUrl.url) || name;
      detail = summary;
    } else if (mcpTool) {
      const server = asStr(mcpTool.serverName);
      const toolName = asStr(mcpTool.toolName);
      name = server ? `MCP · ${server}` : 'MCP Tool';
      summary = toolName || name;
      detail = asStr(mcpTool.result || mcpTool.output) || JSON.stringify(mcpTool.arguments ?? mcpTool, null, 2).slice(0, 2000);
    } else if (subagent) {
      name = stepType.includes('BROWSER') ? 'Browser Agent' : 'Subagent';
      summary = asStr(subagent.role || subagent.taskName || subagent.prompt || subagent.task).slice(0, 80) || name;
      detail = asStr(subagent.prompt || subagent.task || subagent.result) || summary;
    } else {
      detail = JSON.stringify(step, null, 2).slice(0, 2500);
    }

    const tool: ToolCallDetail = {
      id: `tool-${idx}`,
      stepIndex: idx,
      name,
      category,
      summary,
      detail,
      filePath: filePath || undefined,
      lineRange,
      attachments: viewedImageAttachments.length > 0 ? viewedImageAttachments : undefined,
      status,
    };
    items.push({ id: tool.id, kind: 'tool', stepIndex: idx, tool });
  });

  return { items, pendingApproval, allDiffs, tasks, queuedMessages, isRunning, detectedModel };
}
