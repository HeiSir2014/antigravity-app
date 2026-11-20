export interface SlashCommandOption {
  cmd: string;
  desc: string;
}

/**
 * Maps `GetSlashCommandsResponse.commands[]` (`info.name`, `description`) to
 * the composer's `{ cmd, desc }` shape.
 */
export function mapSlashCommands(raw: unknown): SlashCommandOption[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { commands?: unknown };
  if (!Array.isArray(obj.commands)) return [];

  return obj.commands
    .map((entry, idx): SlashCommandOption | null => {
      if (!entry || typeof entry !== 'object') return null;
      const command = entry as Record<string, unknown>;
      const info =
        command.info && typeof command.info === 'object'
          ? (command.info as Record<string, unknown>)
          : {};
      const name = String(info.name || command.name || '')
        .trim()
        .replace(/^\/+/, '');
      const desc = String(command.description || info.description || info.modelFacingText || '').trim();
      return name ? { cmd: `/${name}`, desc: desc || `Command ${idx + 1}` } : null;
    })
    .filter((command): command is SlashCommandOption => Boolean(command));
}
