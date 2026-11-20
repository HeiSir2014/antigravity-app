import { describe, expect, test } from 'bun:test';
import { mapSlashCommands } from '../src/api/slashCommands';

describe('mapSlashCommands', () => {
  test('maps info.name and description with a single leading slash', () => {
    expect(
      mapSlashCommands({
        commands: [
          { info: { name: 'plan' }, description: 'Plan first' },
          { info: { name: '/review' }, description: 'Review diff' },
        ],
      })
    ).toEqual([
      { cmd: '/plan', desc: 'Plan first' },
      { cmd: '/review', desc: 'Review diff' },
    ]);
  });

  test('falls back to model-facing text and ignores nameless entries', () => {
    const commands = mapSlashCommands({
      commands: [{ info: { name: 'compact', modelFacingText: 'Compact context' } }, {}],
    });
    expect(commands).toEqual([{ cmd: '/compact', desc: 'Compact context' }]);
  });

  test('handles malformed responses', () => {
    expect(mapSlashCommands(null)).toEqual([]);
    expect(mapSlashCommands({ commands: 'nope' })).toEqual([]);
  });
});
