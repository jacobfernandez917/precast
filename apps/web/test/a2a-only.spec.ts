import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture guard: the web app interacts with Mastra agents **only over A2A**
 * (JSON-RPC 2.0) — either directly (`POST /api/a2a/:id`) or through the AgentBase
 * proxy — with or without AgentBase. It must NEVER call Mastra's native
 * agent surfaces (`/api/agents/:id/generate` | `/stream`, agent listing, etc.).
 *
 * All agent traffic goes through `app/lib/a2a-client.ts` (`callAgent()`), which
 * only ever targets A2A endpoints. This test fails if any web source file
 * references a non-A2A Mastra agent route, so the invariant can't silently rot.
 */
const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

// Non-A2A Mastra agent surfaces the web app must not use. `/api/a2a` and
// AgentBase's `/a2a` are the only allowed agent routes and don't match these.
const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\/api\/agents\b/, why: 'Mastra native REST (generate/stream) + agent listing' },
  { pattern: /\/agents\/[^\s/'"`]+\/messages/, why: 'legacy Mastra native invocation' },
];

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, acc);
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(abs);
  }
  return acc;
}

// Strip comments so the guard checks actual usage, not docs. Block comments
// (`/* */`) go entirely; line comments (`//…`) only when not part of `://`
// (so URL schemes like `http://` are preserved for matching).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

describe('web → agents: A2A only', () => {
  it('no web source references a non-A2A Mastra agent route', () => {
    const offenders: string[] = [];
    for (const file of walk(APP_DIR)) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(src)) {
          offenders.push(`${file.replace(APP_DIR, 'app')} matches ${pattern} (${why})`);
        }
      }
    }
    expect(
      offenders,
      `Web app must talk to agents only over A2A (via callAgent()). Offending refs:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
