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
  if (s.includes('RUNNING') || s.includes('GENERATING') || s.includes('PENDING')) return 'running';
  if (s.includes('ERROR') || s.includes('FAILED') || s.includes('CANCEL')) return 'error';
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

    // 2. Planner Response (Thinking + Assistant Markdown)
    const planner = asObj(step.plannerResponse);
    if (planner || stepType.includes('PLANNER_RESPONSE')) {
      const thinking = asStr(planner?.thinking || planner?.thought);
      if (thinking.trim()) {
        items.push({
          id: `think-${idx}`,
          kind: 'thinking',
          stepIndex: idx,
          text: thinking.trim(),
          durationSec: typeof planner?.thinkingDurationMs === 'number'
            ? Math.max(1, Math.round(planner.thinkingDurationMs / 1000))
            : undefined,
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

      if (status === 'waiting') {
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
      const targetUri = asStr(
        asObj(codeAction?.actionSpec)?.targetUri ||
          codeAction?.targetFile ||
          codeAction?.path ||
          codeAction?.uri
      );
      const fileName = targetUri ? targetUri.split('/').pop() || targetUri : 'File edit';
      const diffText = asStr(
        asObj(codeAction?.diff)?.unifiedDiff || codeAction?.unifiedDiff || codeAction?.codeContent || ''
      );
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

      if (status === 'waiting') {
        pendingApproval = {
          trajectoryId,
          stepIndex: idx,
          kind: 'filePermission',
          toolName: 'Edit File',
          title: `Allow edit to ${fileName}?`,
          commandOrDiff: diffText || targetUri,
          filePath: targetUri,
        };
      }
      return;
    }

    // 5. Notify User / Plan Review
    const notifyUser = asObj(step.notifyUser);
    if (notifyUser || stepType.includes('NOTIFY_USER')) {
      const msg = asStr(notifyUser?.message);
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
      const taskName = asStr(taskBoundary.taskName || taskBoundary.taskStatus);
      if (taskName) {
        tasks.push({
          id: `task-${idx}`,
          label: taskName,
          status: status === 'done' ? 'done' : 'in_progress',
        });
      }
      return;
    }

    // 7. Error Step
    const errObj = asObj(step.errorMessage) || asObj(step.error);
    if (errObj) {
      const message = asStr(asObj(errObj.error)?.message || errObj.message || errObj.userErrorMessage);
      if (message) {
        items.push({ id: `err-${idx}`, kind: 'error', stepIndex: idx, message });
      }
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
