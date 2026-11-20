import { describe, expect, test } from 'bun:test';
import { normalizeTrajectorySteps } from '../src/api/stepNormalizer';

describe('normalizeTrajectorySteps official payloads', () => {
  test('reads google.protobuf.Duration thinkingDuration', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE',
        status: 'CORTEX_STEP_STATUS_DONE',
        plannerResponse: {
          thinking: 'checking the workspace',
          thinkingDuration: { seconds: 2, nanos: 500_000_000 },
          response: 'done',
        },
      },
    ]);
    const thinking = result.items.find((item) => item.kind === 'thinking');
    expect(thinking && 'durationSec' in thinking ? thinking.durationSec : undefined).toBe(3);
  });

  test('surfaces requested_interaction even when status is not WAITING', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
        status: 'CORTEX_STEP_STATUS_RUNNING',
        requestedInteraction: { runCommand: {} },
        runCommand: { proposedCommandLine: 'bun test' },
      },
    ]);
    expect(result.pendingApproval?.kind).toBe('runCommand');
    expect(result.pendingApproval?.commandOrDiff).toBe('bun test');
  });

  test('does not resurrect a completed interaction', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_RUN_COMMAND',
        status: 'CORTEX_STEP_STATUS_WAITING',
        requestedInteraction: { runCommand: {} },
        completedInteractions: [{}],
        runCommand: { proposedCommandLine: 'bun test' },
      },
    ]);
    expect(result.pendingApproval).toBeNull();
  });

  test('maps file permission requested_interaction', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_CODE_ACTION',
        status: 'CORTEX_STEP_STATUS_RUNNING',
        requestedInteraction: {
          filePermission: { absolutePathUri: 'file:///workspace/src/a.ts' },
        },
      },
    ]);
    expect(result.pendingApproval?.kind).toBe('filePermission');
    expect(result.pendingApproval?.filePath).toBe('file:///workspace/src/a.ts');
  });

  test('rebuilds official unifiedDiff.lines into text', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_CODE_ACTION',
        status: 'CORTEX_STEP_STATUS_DONE',
        codeAction: {
          actionResult: {
            edit: {
              absoluteUri: 'file:///workspace/src/a.ts',
              diff: {
                unifiedDiff: {
                  lines: [
                    { type: 'UNIFIED_DIFF_LINE_TYPE_INSERT', text: 'const a = 1;' },
                    { type: 'UNIFIED_DIFF_LINE_TYPE_DELETE', text: 'const a = 0;' },
                  ],
                },
              },
            },
          },
        },
      },
    ]);
    expect(result.allDiffs[0]?.filePath).toBe('file:///workspace/src/a.ts');
    expect(result.allDiffs[0]?.diff).toBe('+const a = 1;\n-const a = 0;');
    expect(result.allDiffs[0]?.additions).toBe(1);
    expect(result.allDiffs[0]?.deletions).toBe(1);
  });

  test('maps notifyUser.notificationContent and taskSummary', () => {
    const result = normalizeTrajectorySteps([
      {
        type: 'CORTEX_STEP_TYPE_NOTIFY_USER',
        notifyUser: { notificationContent: 'Need your input' },
      },
      {
        type: 'CORTEX_STEP_TYPE_TASK_BOUNDARY',
        taskBoundary: { taskSummary: 'Refactor parser' },
      },
    ]);
    expect(result.items.some((item) => item.kind === 'assistant' && item.markdown === 'Need your input')).toBe(true);
    expect(result.tasks[0]?.label).toBe('Refactor parser');
  });
});
