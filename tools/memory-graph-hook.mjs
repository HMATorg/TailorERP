#!/usr/bin/env node
/**
 * Claude Code hook wrapper around tools/memory-graph.mjs.
 *
 * Regenerates the memory graph and reports back as hook JSON. Two modes:
 *
 *   commit   PreToolUse on `git commit` — regenerate and stage the graph so it
 *            travels in the same commit as the change it describes, and feed any
 *            drift findings back into the model's context.
 *   session  SessionStart / PostCompact — regenerate and inject the current
 *            digest, so a fresh or just-compacted session starts from the repo
 *            rather than from a summary of it.
 *
 * Always exits 0: a bookkeeping step must never be the reason a commit fails.
 * Drift is surfaced as context to act on, not as a wall to climb.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const mode = process.argv[2] === 'commit' ? 'commit' : 'session';

const emit = (o) => {
  process.stdout.write(JSON.stringify(o));
  process.exit(0);
};

const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'memory-graph.mjs')], {
  cwd: ROOT,
  encoding: 'utf8',
});

// A broken generator must not become a broken commit.
if (run.error || run.stdout == null) {
  emit({ suppressOutput: true });
}

const out = (run.stdout || '').trim();
const [summary, ...rest] = out.split('\n');
const hasDrift = run.status !== 0;
const findings = rest.join('\n').trim();

if (mode === 'commit') {
  try {
    execFileSync('git', ['add', '--', 'docs/MEMORY-GRAPH.md'], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    /* not a repo, or nothing to add — the graph is still on disk */
  }
}

// Finding lines are the indented `[check-id] message` rows; the generator also
// prints a count header, which must not be counted as a finding itself.
const findingCount = findings.split('\n').filter((l) => /^\s+\[/.test(l)).length;

const context = hasDrift
  ? `Memory graph regenerated (docs/MEMORY-GRAPH.md).\n${summary}\n\n` +
    `DRIFT DETECTED — two sources of truth in this repo disagree:\n${findings}\n\n` +
    `Fix these rather than working around them. They mean the repo no longer matches its ` +
    `own records, which is exactly the condition the graph exists to catch.`
  : `Memory graph regenerated (docs/MEMORY-GRAPH.md), no drift.\n${summary}\n` +
    `Use this file — not recall — for Tailonix module/model/migration/decision/commit counts.`;

emit({
  systemMessage: hasDrift ? `memory-graph: DRIFT — ${findingCount} finding(s)` : undefined,
  suppressOutput: true,
  hookSpecificOutput: {
    // Deliberately no permissionDecision — this hook reports, it does not
    // auto-approve. `git commit` keeps whatever permission flow it already had.
    hookEventName: mode === 'commit' ? 'PreToolUse' : 'SessionStart',
    additionalContext: context,
  },
});
