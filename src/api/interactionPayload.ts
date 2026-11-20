import type { PendingApproval } from '../types/agent';

export type ApprovalScope = 'once' | 'session';

/**
 * Builds the official `CascadeUserInteraction` JSON for
 * `HandleCascadeUserInteraction`. The permission scope enum must be
 * `PERMISSION_SCOPE_*`; the old `"ONCE"` / `"SESSION"` strings are invalid.
 */
export function buildInteractionPayload(
  approval: PendingApproval,
  allow: boolean,
  scope: ApprovalScope = 'once',
  comment?: string
): Record<string, unknown> {
  const scopeValue =
    scope === 'session' ? 'PERMISSION_SCOPE_CONVERSATION' : 'PERMISSION_SCOPE_ONCE';
  const base = {
    trajectoryId: approval.trajectoryId,
    stepIndex: approval.stepIndex,
  };

  switch (approval.kind) {
    case 'runCommand':
      return {
        ...base,
        runCommand: {
          confirm: allow,
          proposedCommandLine: approval.commandOrDiff,
          submittedCommandLine: approval.commandOrDiff,
        },
      };
    case 'filePermission':
      return {
        ...base,
        filePermission: {
          allow,
          scope: scopeValue,
          absolutePathUri: approval.filePath || '',
        },
      };
    case 'plan':
      return {
        ...base,
        approvalInteraction: { confirm: allow },
      };
    default:
      return {
        ...base,
        permission: {
          allow,
          scope: scopeValue,
          ...(comment ? { userDenyInstruction: comment } : {}),
        },
      };
  }
}
