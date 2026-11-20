import { describe, expect, test } from 'bun:test';
import { buildInteractionPayload } from '../src/api/interactionPayload';
import type { PendingApproval } from '../src/types/agent';

const base: PendingApproval = {
  trajectoryId: 'cascade-test',
  stepIndex: 3,
  kind: 'runCommand',
  toolName: 'Run Command',
  title: 'Allow terminal command?',
  commandOrDiff: 'bun test',
};

describe('buildInteractionPayload', () => {
  test('runCommand uses official CascadeRunCommandInteraction fields', () => {
    const body = buildInteractionPayload(base, true);
    expect(body).toMatchObject({
      trajectoryId: 'cascade-test',
      stepIndex: 3,
      runCommand: {
        confirm: true,
        proposedCommandLine: 'bun test',
        submittedCommandLine: 'bun test',
      },
    });
  });

  test('filePermission uses PERMISSION_SCOPE_CONVERSATION and absolutePathUri', () => {
    const body = buildInteractionPayload(
      { ...base, kind: 'filePermission', filePath: 'file:///workspace/a.ts' },
      false,
      'session'
    );
    expect(body).toMatchObject({
      filePermission: {
        allow: false,
        scope: 'PERMISSION_SCOPE_CONVERSATION',
        absolutePathUri: 'file:///workspace/a.ts',
      },
    });
    expect(JSON.stringify(body)).not.toContain('"SESSION"');
    expect(JSON.stringify(body)).not.toContain('"ONCE"');
  });

  test('permission carries deny comment and once scope', () => {
    const body = buildInteractionPayload(
      { ...base, kind: 'permission', commandOrDiff: 'network access' },
      false,
      'once',
      'do not touch prod'
    );
    expect(body).toMatchObject({
      permission: {
        allow: false,
        scope: 'PERMISSION_SCOPE_ONCE',
        userDenyInstruction: 'do not touch prod',
      },
    });
  });

  test('plan uses approvalInteraction.confirm', () => {
    const body = buildInteractionPayload({ ...base, kind: 'plan' }, true);
    expect(body).toEqual({
      trajectoryId: 'cascade-test',
      stepIndex: 3,
      approvalInteraction: { confirm: true },
    });
  });
});
