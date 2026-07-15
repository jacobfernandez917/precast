#!/usr/bin/env node
/**
 * progress-stamp.mjs — Auto-journaling for PROGRESS.md
 *
 * Called by Claude Code hooks (PostToolUse, Stop, SessionStart) to append
 * auto-journal entries to PROGRESS.md's Session Log.
 *
 * Usage:
 *   node scripts/progress-stamp.mjs --event=edit
 *   node scripts/progress-stamp.mjs --event=session-start
 *   node scripts/progress-stamp.mjs --event=session-stop
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const eventType = process.argv.find((a) => a.startsWith('--event='))?.split('=')[1] || 'unknown';
const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

const journalPath = join(rootDir, 'docs', '.progress-journal.jsonl');
const progressPath = join(rootDir, 'docs', 'PROGRESS.md');

// Append to journal file
const journalDir = dirname(journalPath);
if (!existsSync(journalDir)) {
  // Skip silently if docs/ doesn't exist yet
  process.exit(0);
}

const entry =
  JSON.stringify({
    timestamp,
    event: eventType,
    source: 'claude-code',
  }) + '\n';

try {
  appendFileSync(journalPath, entry);
} catch {
  // Silent fail — journal file is non-critical
}

// For edit events, also try to append to PROGRESS.md Session Log
if (eventType === 'edit' && existsSync(progressPath)) {
  try {
    const content = readFileSync(progressPath, 'utf-8');
    const journalLine = `<auto-journal: ${timestamp} — file edit>`;
    const sessionLogSection = '## 8. Session Log';
    const insertIdx = content.indexOf(sessionLogSection);

    if (insertIdx !== -1) {
      // Find end of the section header line and insert after the blank line
      const afterSection = content.indexOf('\n\n', insertIdx) + 2;
      const updated =
        content.slice(0, afterSection) + `\n${journalLine}\n` + content.slice(afterSection);
      writeFileSync(progressPath, updated, 'utf-8');
    }
  } catch {
    // Silent fail — non-critical
  }
}

process.exit(0);
