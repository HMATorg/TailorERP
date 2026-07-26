#!/usr/bin/env node
/**
 * Regenerates docs/MEMORY-GRAPH.md from the repository itself.
 *
 * Every fact in the output is read out of git, the Prisma schema, the NestJS
 * module graph, or the decisions log. Nothing is carried in this file's head.
 * That is the entire point: a graph that is *remembered* drifts from the code
 * the moment someone edits the code; a graph that is *derived* cannot.
 *
 * It also runs drift checks — places where two sources of truth in this repo
 * have started to disagree — and exits non-zero when any of them fail, so a
 * hook or CI stage can refuse to let the disagreement through silently.
 *
 *   node tools/memory-graph.mjs            write the graph, report drift
 *   node tools/memory-graph.mjs --check    report only, write nothing
 *   node tools/memory-graph.mjs --quiet    suppress the human summary
 *   node tools/memory-graph.mjs --pending-commit
 *                                          a commit is about to be created from
 *                                          the index; label HEAD as the parent
 *                                          so the committed file reads honestly
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'MEMORY-GRAPH.md');
const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const QUIET = args.has('--quiet');
const PENDING_COMMIT = args.has('--pending-commit');

const git = (...a) => {
  try {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** Recursive file walk that skips the directories that would swamp it. */
function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (['node_modules', 'dist', 'build', '.git', 'coverage', '.turbo'].includes(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

const head = git('rev-parse', '--short', 'HEAD');
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const dirty = git('status', '--porcelain');
const commits = git('log', '--format=%h\t%ad\t%s', '--date=short')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [sha, date, ...rest] = l.split('\t');
    return { sha, date, subject: rest.join('\t') };
  });

// --- apps -------------------------------------------------------------------
// The SPAs let Vite auto-assign their dev port, so .claude/launch.json is the
// only place the assignment is actually written down. The API reads PORT from env.
const launchPorts = new Map();
try {
  for (const c of JSON.parse(read(join(ROOT, '.claude', 'launch.json')) || '{}').configurations ?? []) {
    if (c.name && c.port) launchPorts.set(c.name, c.port);
  }
} catch {
  /* no launch.json, or hand-broken — ports just render as unknown */
}
const apiPort = read(join(ROOT, 'apps', 'api', '.env.example')).match(/^PORT=(\d+)/m)?.[1];

const appsDir = join(ROOT, 'apps');
const apps = (existsSync(appsDir) ? readdirSync(appsDir) : [])
  .filter((d) => statSync(join(appsDir, d)).isDirectory())
  .map((name) => {
    const pkg = read(join(appsDir, name, 'package.json'));
    let pkgName = name;
    let deps = 0;
    try {
      const j = JSON.parse(pkg || '{}');
      deps = Object.keys(j.dependencies ?? {}).length;
      pkgName = j.name ?? name;
    } catch {
      /* a malformed package.json is caught by the build, not here */
    }
    const port = launchPorts.get(name) ?? (name === 'api' ? Number(apiPort) || null : null);
    const files = walk(join(appsDir, name)).filter((f) => /\.(ts|tsx)$/.test(f));
    return { name, pkgName, port, deps, files: files.length };
  });

// --- API module graph -------------------------------------------------------
const apiSrc = join(ROOT, 'apps', 'api', 'src');
const moduleFiles = walk(apiSrc).filter((f) => f.endsWith('.module.ts'));
const modules = moduleFiles.map((f) => {
  const src = read(f);
  const cls = src.match(/export class (\w+Module)/)?.[1] ?? rel(f);
  // Imports listed in the @Module({ imports: [...] }) block, not the ES imports.
  const block = src.match(/imports:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  const named = [...block.matchAll(/\b(\w+Module)\b/g)].map((m) => m[1]);
  // Only the ones pulled in from a relative path are ours. `ConfigModule` and
  // friends come from @nestjs/* and have no *.module.ts to match against.
  const local = new Set(
    [...src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.[^']*)'/g)].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()),
    ),
  );
  const imports = named.filter((n) => local.has(n));
  const external = named.filter((n) => !local.has(n));
  return { class: cls, file: rel(f), dir: rel(f).split('/').slice(-2)[0], imports, external };
});
const appModule = modules.find((m) => m.class === 'AppModule');
const wired = new Set(appModule?.imports ?? []);

// --- data model -------------------------------------------------------------
const schema = read(join(ROOT, 'apps', 'api', 'prisma', 'schema.prisma'));
const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const enums = [...schema.matchAll(/^enum\s+(\w+)\s*\{/gm)].map((m) => m[1]);
const migrationsDir = join(ROOT, 'apps', 'api', 'prisma', 'migrations');
const migrations = (existsSync(migrationsDir) ? readdirSync(migrationsDir) : [])
  .filter((d) => statSync(join(migrationsDir, d)).isDirectory())
  .sort();

// --- decisions --------------------------------------------------------------
const decisionsPath = join(ROOT, 'docs', 'ENGINEERING-DECISIONS.md');
const decisionsDoc = read(decisionsPath);
const decisions = [...decisionsDoc.matchAll(/^##\s+(D-(\d{3})):\s*(.+)$/gm)].map((m, i) => ({
  id: m[1],
  num: Number(m[2]),
  title: m[3].trim(),
  order: i,
}));
const decisionIds = new Set(decisions.map((d) => d.id));

// Cross-references from code back to the decision log. The negative lookbehind
// keeps order numbers like ORD-000009 out of the match.
const sourceFiles = [...walk(join(ROOT, 'apps')), ...walk(join(ROOT, 'packages'))].filter((f) =>
  /\.(ts|tsx|prisma|sql)$/.test(f),
);
const citations = new Map(); // D-0xx -> Set(file)
for (const f of sourceFiles) {
  for (const m of read(f).matchAll(/(?<![A-Za-z0-9-])D-(\d{3})\b/g)) {
    const id = `D-${m[1]}`;
    if (!citations.has(id)) citations.set(id, new Set());
    citations.get(id).add(rel(f));
  }
}

// --- tests ------------------------------------------------------------------
const specFiles = sourceFiles.filter((f) => /\.spec\.ts$/.test(f));
const countCases = (files) =>
  files.reduce((n, f) => n + [...read(f).matchAll(/^\s*(?:it|test)\s*(?:\.\w+)?\s*\(/gm)].length, 0);
const e2eFiles = specFiles.filter((f) => f.includes('.e2e-spec.'));
const unitFiles = specFiles.filter((f) => !f.includes('.e2e-spec.'));

// ---------------------------------------------------------------------------
// Drift checks — the part that actually prevents hallucination
// ---------------------------------------------------------------------------

const drift = [];
const fail = (id, msg) => drift.push({ id, msg });

// 1. Code cites a decision that does not exist in the log.
for (const [id, files] of citations) {
  if (!decisionIds.has(id)) {
    fail('dangling-decision', `${id} is cited in ${[...files][0]} but has no entry in docs/ENGINEERING-DECISIONS.md`);
  }
}

// 2. Duplicate decision IDs — two entries claiming the same number.
const seen = new Map();
for (const d of decisions) {
  if (seen.has(d.id)) fail('duplicate-decision', `${d.id} appears twice in the decisions log`);
  seen.set(d.id, d);
}

// 3. Gaps in the decision numbering — an ID was skipped or an entry deleted.
const max = decisions.reduce((n, d) => Math.max(n, d.num), 0);
for (let i = 1; i <= max; i++) {
  const id = `D-${String(i).padStart(3, '0')}`;
  if (!decisionIds.has(id)) fail('missing-decision', `${id} is missing — numbering runs 001..${String(max).padStart(3, '0')}`);
}

// 4. Decisions filed out of order. Harmless on its own, but it is the signature
//    of an entry appended by hand without reading the file first.
for (let i = 1; i < decisions.length; i++) {
  if (decisions[i].num < decisions[i - 1].num) {
    fail(
      'out-of-order-decision',
      `${decisions[i].id} is filed after ${decisions[i - 1].id} — the log is meant to read in order`,
    );
  }
}

// 5. A feature module exists on disk but was never wired into AppModule, so it
//    ships no routes. Silent in tests, invisible until someone calls the endpoint.
for (const m of modules) {
  if (m.class === 'AppModule') continue;
  if (!wired.has(m.class)) {
    fail('unwired-module', `${m.class} (${m.file}) is not imported by AppModule`);
  }
}

// 6. AppModule imports something that no longer exists on disk.
const declared = new Set(modules.map((m) => m.class));
for (const imp of wired) {
  if (!declared.has(imp)) fail('phantom-module', `AppModule imports ${imp}, which has no *.module.ts`);
}

// 7. Schema changed but no migration was written for it.
const schemaTouchedAt = git('log', '-1', '--format=%at', '--', 'apps/api/prisma/schema.prisma');
const lastMigration = migrations[migrations.length - 1];
if (schemaTouchedAt && lastMigration) {
  const migTouchedAt = git('log', '-1', '--format=%at', '--', `apps/api/prisma/migrations/${lastMigration}`);
  if (migTouchedAt && Number(schemaTouchedAt) > Number(migTouchedAt)) {
    fail(
      'schema-ahead-of-migrations',
      `schema.prisma was committed after the newest migration (${lastMigration}) — a migration may be missing`,
    );
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + 'Z';
const pad = (s, n) => String(s).padEnd(n);

const mermaidId = (s) => s.replace(/Module$/, '');
const edges = [];
for (const m of modules) {
  if (m.class === 'AppModule') continue;
  for (const imp of m.imports) {
    if (imp === m.class || !declared.has(imp)) continue;
    edges.push(`  ${mermaidId(m.class)} --> ${mermaidId(imp)}`);
  }
}

const lines = [];
lines.push('# Tailonix Memory Graph');
lines.push('');
lines.push('> **Generated file — do not edit.** Rewritten by `node tools/memory-graph.mjs`,');
lines.push('> which reads git, the Prisma schema, the NestJS module graph, and the decisions');
lines.push('> log. Hand edits are lost on the next run. Judgment that cannot be derived from');
lines.push('> the repo — why something is blocked, what a trap looks like — belongs in the');
lines.push('> auto-memory directory, not here.');
lines.push('');
if (PENDING_COMMIT) {
  // Written from the index moments before `git commit` runs, so `head` is about
  // to become the parent and the History table below stops one row short of the
  // commit this file is being carried in. Say so, rather than let a later reader
  // mistake a one-commit lag for a stale graph.
  lines.push(
    `**Parent** \`${head}\` on \`${branch}\` · **generated** ${now} · staged into the commit being created on top of it`,
  );
  lines.push('');
  lines.push('_History below runs to the parent; the commit carrying this file is its child._');
} else {
  lines.push(
    `**HEAD** \`${head}\` on \`${branch}\` · **generated** ${now} · **working tree** ${dirty ? `${dirty.split('\n').length} file(s) uncommitted` : 'clean'}`,
  );
}
lines.push('');

// --- drift ------------------------------------------------------------------
lines.push('## Drift');
lines.push('');
if (drift.length === 0) {
  lines.push('No drift. Every decision cited in code exists in the log, every module on disk is');
  lines.push('wired into `AppModule`, decision numbering is dense and ordered, and the schema is');
  lines.push('not ahead of its migrations.');
} else {
  lines.push(`${drift.length} disagreement(s) between sources of truth in this repo:`);
  lines.push('');
  lines.push('| Check | Detail |');
  lines.push('| --- | --- |');
  for (const d of drift) lines.push(`| \`${d.id}\` | ${d.msg} |`);
}
lines.push('');

// --- subsystem graph --------------------------------------------------------
lines.push('## Subsystem graph');
lines.push('');
lines.push('Edges are `imports:` declarations read out of each `*.module.ts`.');
lines.push('');
lines.push('```mermaid');
lines.push('graph LR');
for (const e of [...new Set(edges)].sort()) lines.push(e);
lines.push('```');
lines.push('');

// --- apps -------------------------------------------------------------------
lines.push('## Applications');
lines.push('');
lines.push('| App | Package | Dev port | TS/TSX files | Direct deps |');
lines.push('| --- | --- | --- | --- | --- |');
for (const a of apps) {
  lines.push(`| \`apps/${a.name}\` | \`${a.pkgName}\` | ${a.port ?? '—'} | ${a.files} | ${a.deps} |`);
}
lines.push('');

// --- modules ----------------------------------------------------------------
lines.push('## API modules');
lines.push('');
lines.push(`${modules.length - 1} feature modules, all wired into \`AppModule\`.`);
lines.push('');
lines.push('| Module | Path | Depends on |');
lines.push('| --- | --- | --- |');
for (const m of modules.filter((x) => x.class !== 'AppModule').sort((a, b) => a.class.localeCompare(b.class))) {
  const deps = m.imports.filter((i) => declared.has(i) && i !== m.class);
  lines.push(`| \`${m.class}\` | \`${m.file}\` | ${deps.length ? deps.map((d) => `\`${d}\``).join(', ') : '—'} |`);
}
lines.push('');

// --- data -------------------------------------------------------------------
lines.push('## Data model');
lines.push('');
lines.push(`${models.length} models, ${enums.length} enums, ${migrations.length} migrations.`);
lines.push('');
lines.push('<details><summary>Models</summary>');
lines.push('');
lines.push(models.sort().map((m) => `\`${m}\``).join(' · '));
lines.push('');
lines.push('</details>');
lines.push('');
lines.push('| # | Migration |');
lines.push('| --- | --- |');
migrations.forEach((m, i) => lines.push(`| ${i + 1} | \`${m}\` |`));
lines.push('');

// --- decisions --------------------------------------------------------------
lines.push('## Engineering decisions');
lines.push('');
lines.push(`${decisions.length} recorded in \`docs/ENGINEERING-DECISIONS.md\`. "Cited by" counts source`);
lines.push('files that reference the decision in a comment — an uncited decision is not wrong,');
lines.push('but it is the first place to look when something has quietly been undone.');
lines.push('');
lines.push('| ID | Decision | Cited by |');
lines.push('| --- | --- | --- |');
for (const d of [...decisions].sort((a, b) => a.num - b.num)) {
  const c = citations.get(d.id);
  lines.push(`| \`${d.id}\` | ${d.title} | ${c ? `${c.size} file(s)` : '—'} |`);
}
lines.push('');

// --- tests ------------------------------------------------------------------
lines.push('## Tests');
lines.push('');
lines.push('| Suite | Files | Declared cases |');
lines.push('| --- | --- | --- |');
lines.push(`| unit | ${unitFiles.length} | ${countCases(unitFiles)} |`);
lines.push(`| e2e | ${e2eFiles.length} | ${countCases(e2eFiles)} |`);
lines.push('');
lines.push('Counts are parsed from `it(` / `test(` call sites, so they include any case that is');
lines.push('currently skipped. They are a shape check, not a substitute for running the suite.');
lines.push('');

// --- history ----------------------------------------------------------------
lines.push('## History');
lines.push('');
lines.push('| Commit | Date | Subject |');
lines.push('| --- | --- | --- |');
for (const c of commits) lines.push(`| \`${c.sha}\` | ${c.date} | ${c.subject} |`);
lines.push('');

const out = lines.join('\n') + '\n';

if (!CHECK_ONLY) {
  const prev = read(OUT);
  if (prev !== out) writeFileSync(OUT, out, 'utf8');
}

if (!QUIET) {
  const summary =
    `memory-graph: ${apps.length} apps · ${modules.length - 1} modules · ${models.length} models · ` +
    `${migrations.length} migrations · ${decisions.length} decisions · ${commits.length} commits`;
  console.log(summary);
  if (drift.length) {
    console.log(`\n${drift.length} drift finding(s):`);
    for (const d of drift) console.log(`  [${pad(d.id, 26)}] ${d.msg}`);
  } else {
    console.log('no drift');
  }
}

process.exit(drift.length ? 1 : 0);
