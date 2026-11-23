export interface ParsedDiffLine {
  index: number;
  kind: 'add' | 'del' | 'context' | 'hunk' | 'meta';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunkBlock {
  kind: 'lines';
  hunkIndex: number;
  firstChangeLineIndex: number | null;
  startOldLine: number | null;
  startNewLine: number | null;
  lines: ParsedDiffLine[];
}

export interface DiffCollapsedBlock {
  kind: 'collapsed';
  id: string;
  startIndex: number;
  endIndex: number;
  hiddenCount: number;
  lines: ParsedDiffLine[];
}

export type DiffDisplayBlock = DiffHunkBlock | DiffCollapsedBlock;

export interface ParsedDiffResult {
  allLines: ParsedDiffLine[];
  blocks: DiffDisplayBlock[];
  hunkCount: number;
  additions: number;
  deletions: number;
  hasCollapsibleContext: boolean;
  firstChangeIndex: number | null;
}

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

/**
 * Parses either a standard unified diff (with `@@ -a,b +c,d @@` headers) or a full-file
 * Antigravity `unifiedDiff.lines` dump into numbered lines and collapsible edit hunks.
 */
export function parseDiffIntoHunks(rawDiff: string, contextLines = 3): ParsedDiffResult {
  const rawLines = (rawDiff || '').split('\n');
  const allLines: ParsedDiffLine[] = [];

  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  let firstChangeIndex: number | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (line.startsWith('@@')) {
      const m = HUNK_HEADER_RE.exec(line);
      if (m) {
        oldLine = Number.parseInt(m[1], 10);
        newLine = Number.parseInt(m[2], 10);
      }
      allLines.push({ index: i, kind: 'hunk', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (
      line.startsWith('+++ ') ||
      line.startsWith('--- ') ||
      line.startsWith('diff --git ') ||
      line.startsWith('index ')
    ) {
      allLines.push({ index: i, kind: 'meta', text: line, oldLine: null, newLine: null });
      continue;
    }
    if (line.startsWith('+')) {
      if (firstChangeIndex === null) firstChangeIndex = i;
      additions += 1;
      allLines.push({
        index: i,
        kind: 'add',
        text: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
      continue;
    }
    if (line.startsWith('-')) {
      if (firstChangeIndex === null) firstChangeIndex = i;
      deletions += 1;
      allLines.push({
        index: i,
        kind: 'del',
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
      continue;
    }
    const text = line.startsWith(' ') ? line.slice(1) : line;
    allLines.push({
      index: i,
      kind: 'context',
      text,
      oldLine: oldLine++,
      newLine: newLine++,
    });
  }

  // Determine which line indices are within `contextLines` of any add/del/hunk line.
  const changeIndices: number[] = [];
  for (let i = 0; i < allLines.length; i++) {
    const k = allLines[i].kind;
    if (k === 'add' || k === 'del') {
      changeIndices.push(i);
    }
  }

  // If there are no add/del markers at all, show everything directly without collapsing.
  if (changeIndices.length === 0) {
    return {
      allLines,
      blocks:
        allLines.length > 0
          ? [
              {
                kind: 'lines',
                hunkIndex: 0,
                firstChangeLineIndex: null,
                startOldLine: allLines[0].oldLine,
                startNewLine: allLines[0].newLine,
                lines: allLines,
              },
            ]
          : [],
      hunkCount: 0,
      additions,
      deletions,
      hasCollapsibleContext: false,
      firstChangeIndex: null,
    };
  }

  const visible = new Array<boolean>(allLines.length).fill(false);
  for (const idx of changeIndices) {
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(allLines.length - 1, idx + contextLines);
    for (let j = start; j <= end; j++) {
      visible[j] = true;
    }
  }
  // Keep explicit hunk/meta headers visible if adjacent to visible lines
  for (let i = 0; i < allLines.length; i++) {
    if (allLines[i].kind === 'hunk') visible[i] = true;
  }

  // Avoid collapsing tiny gaps (<= 3 lines) — just show them inline.
  let i = 0;
  while (i < allLines.length) {
    if (visible[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < allLines.length && !visible[j]) j++;
    if (j - i <= 3) {
      for (let k = i; k < j; k++) visible[k] = true;
    }
    i = j;
  }

  const blocks: DiffDisplayBlock[] = [];
  let hunkIndex = 0;
  let hasCollapsibleContext = false;
  let pos = 0;
  while (pos < allLines.length) {
    if (!visible[pos]) {
      const start = pos;
      while (pos < allLines.length && !visible[pos]) pos++;
      hasCollapsibleContext = true;
      blocks.push({
        kind: 'collapsed',
        id: `collapsed-${start}-${pos}`,
        startIndex: start,
        endIndex: pos - 1,
        hiddenCount: pos - start,
        lines: allLines.slice(start, pos),
      });
    } else {
      const start = pos;
      while (pos < allLines.length && visible[pos]) pos++;
      const slice = allLines.slice(start, pos);
      const firstChange = slice.find((l) => l.kind === 'add' || l.kind === 'del') || null;
      const firstNumbered = slice.find((l) => l.oldLine !== null || l.newLine !== null) || null;
      blocks.push({
        kind: 'lines',
        hunkIndex: hunkIndex++,
        firstChangeLineIndex: firstChange ? firstChange.index : null,
        startOldLine: firstNumbered?.oldLine ?? null,
        startNewLine: firstNumbered?.newLine ?? null,
        lines: slice,
      });
    }
  }

  return {
    allLines,
    blocks,
    hunkCount: hunkIndex,
    additions,
    deletions,
    hasCollapsibleContext,
    firstChangeIndex,
  };
}
