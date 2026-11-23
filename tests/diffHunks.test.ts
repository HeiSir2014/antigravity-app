import { describe, expect, test } from 'bun:test';
import { parseDiffIntoHunks } from '../src/utils/diffHunks';

describe('parseDiffIntoHunks', () => {
  test('collapses long unchanged spans from full-file Antigravity unifiedDiff.lines and tracks 1-based line numbers', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 40; i++) {
      lines.push(` line ${i}`);
    }
    lines.push('-old line 41');
    lines.push('+new line 41');
    for (let i = 42; i <= 80; i++) {
      lines.push(` line ${i}`);
    }

    const parsed = parseDiffIntoHunks(lines.join('\n'), 3);
    expect(parsed.additions).toBe(1);
    expect(parsed.deletions).toBe(1);
    expect(parsed.hunkCount).toBe(1);
    expect(parsed.hasCollapsibleContext).toBe(true);
    expect(parsed.firstChangeIndex).toBe(40);

    expect(parsed.blocks.length).toBe(3);
    expect(parsed.blocks[0].kind).toBe('collapsed');
    expect(parsed.blocks[1].kind).toBe('lines');
    expect(parsed.blocks[2].kind).toBe('collapsed');

    if (parsed.blocks[1].kind === 'lines') {
      expect(parsed.blocks[1].startNewLine).toBe(38);
      const delLine = parsed.blocks[1].lines.find((l) => l.kind === 'del');
      const addLine = parsed.blocks[1].lines.find((l) => l.kind === 'add');
      expect(delLine?.oldLine).toBe(41);
      expect(addLine?.newLine).toBe(41);
    }
  });

  test('respects standard @@ hunk headers for line numbers', () => {
    const raw = [
      '@@ -120,4 +125,4 @@',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      ' const c = 4;',
    ].join('\n');

    const parsed = parseDiffIntoHunks(raw, 3);
    expect(parsed.additions).toBe(1);
    expect(parsed.deletions).toBe(1);
    expect(parsed.hunkCount).toBe(1);
    expect(parsed.hasCollapsibleContext).toBe(false);
    const delLine = parsed.allLines.find((l) => l.kind === 'del');
    const addLine = parsed.allLines.find((l) => l.kind === 'add');
    expect(delLine?.oldLine).toBe(121);
    expect(addLine?.newLine).toBe(126);
  });
});
