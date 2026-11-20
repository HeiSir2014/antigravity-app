import type {
  PendingApproval,
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
  isRunning: boolean;
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
  let pendingApproval: PendingApproval | null = null;
  let isRunning = false;

  rawSteps.forEach((raw, idx) => {
    const step = asObj(raw);
    if (!step) return;

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

    // 1. User Input
    const userInput = asObj(step.userInput);
    if (userInput || stepType.includes('USER_INPUT')) {
      const textParts: string[] = [];
      const rawItems = Array.isArray(userInput?.items) ? userInput.items : [];
      for (const it of rawItems) {
        const obj = asObj(it);
        if (obj?.text) textParts.push(asStr(obj.text));
      }
      const text = textParts.join('\n').trim() || asStr(userInput?.userResponse) || asStr(step.text);
      if (text) {
        items.push({
          id: `user-${idx}`,
          kind: 'user',
          stepIndex: idx,
          text,
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

    // 6. Task Boundary
    const taskBoundary = asObj(step.taskBoundary);
    if (taskBoundary) {
      const taskName = asStr(
        taskBoundary.taskName || taskBoundary.taskSummary || taskBoundary.taskStatus
      );
      if (taskName) {
        tasks.push({
          id: `task-${idx}`,
          label: taskName,
          status: status === 'done' ? 'done' : 'in_progress',
        });
      }
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

    // 8. Generic / Read / Search / MCP Tool Step
    const category = classifyTool(stepType);
    const cleanName = stepType
      .replace(/^CORTEX_STEP_TYPE_/, '')
      .split('_')
      .map((w) => (w ? w[0] + w.slice(1).toLowerCase() : ''))
      .join(' ')
      .trim() || 'Tool';

    const viewFile = asObj(step.viewFile);
    const grepSearch = asObj(step.grepSearch);
    const findByName = asObj(step.findByName);
    const listDir = asObj(step.listDir);

    const summary =
      asStr(viewFile?.absolutePathUri || viewFile?.path).split('/').pop() ||
      asStr(grepSearch?.query) ||
      asStr(findByName?.pattern) ||
      asStr(listDir?.directoryPath).split('/').pop() ||
      cleanName;

    const tool: ToolCallDetail = {
      id: `tool-${idx}`,
      stepIndex: idx,
      name: cleanName,
      category,
      summary,
      detail: JSON.stringify(step, null, 2).slice(0, 4000),
      status,
    };
    items.push({ id: tool.id, kind: 'tool', stepIndex: idx, tool });
  });

  return { items, pendingApproval, allDiffs, tasks, isRunning };
}
