import { createRequire } from 'node:module';
import pino, { type Logger, type Level } from 'pino';

/**
 * Server-only structured logger for the web app (route handlers, server
 * components, `a2a-client`). Never import from a client component — pino is a
 * Node-only logger.
 *
 * - Level comes from `LOG_LEVEL` (default `info`), so `info`/`warn`/`error`
 *   always show. Run `pnpm dev:web:verbose` (or set `LOG_LEVEL=debug`) for the
 *   detailed firehose (every request + A2A call).
 * - In development the output is pretty-printed + colorized via `pino-pretty`
 *   (loaded lazily as a stream, kept external from the bundle); production
 *   emits structured JSON.
 */

const VALID_LEVELS: readonly Level[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

function resolveLevel(): Level {
  const raw = process.env.LOG_LEVEL;
  return raw && (VALID_LEVELS as readonly string[]).includes(raw) ? (raw as Level) : 'info';
}

export function createLogger(name: string): Logger {
  const level = resolveLevel();

  if (process.env.NODE_ENV === 'production') {
    return pino({ name, level });
  }

  try {
    const require = createRequire(import.meta.url);
    const pretty = require('pino-pretty') as (opts: unknown) => NodeJS.WritableStream;
    return pino(
      { name, level },
      pretty({
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        messageFormat: '{name} · {msg}',
      }),
    );
  } catch {
    return pino({ name, level });
  }
}

export const log = createLogger('precast-web');
