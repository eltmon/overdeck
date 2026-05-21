#!/usr/bin/env node
/**
 * Pre-flight analyzer for the src/lib Effect migration swarm (PAN-1249).
 *
 * Walks src/lib/**\/*.ts (excluding tests + already-migrated files), parses
 * imports via the TypeScript compiler API, builds an internal dependency
 * graph, topologically sorts into waves, and emits a vBRIEF plan JSON ready
 * to attach to the swarm issue.
 *
 * Output:
 *   .pan/swarm-migration-plan.vbrief.json
 *
 * Each per-file item carries:
 *   - id: effect-migrate-<sanitized-relative-path>
 *   - metadata.files_scope: [<relative path>] (single-file scope per slot)
 *   - blocks edges to every file it imports inside src/lib/
 *
 * Wave 0 also gets a shared-errors item that lands the common
 * Data.TaggedError classes before any per-file slot runs (PAN-1193 mitigation).
 *
 * Run:
 *   tsx scripts/analyze-effect-migration.ts
 *   tsx scripts/analyze-effect-migration.ts --out path/to/plan.json
 *   tsx scripts/analyze-effect-migration.ts --dry-run        # print stats, write nothing
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, dirname, sep, posix } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const LIB_ROOT = resolve(REPO_ROOT, 'src/lib');
const DEFAULT_OUT = resolve(REPO_ROOT, '.pan/swarm-migration-plan.vbrief.json');

const ALREADY_MIGRATED = new Set<string>([
  resolve(LIB_ROOT, 'cloister/flywheel.ts'),
]);

interface CliArgs {
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let out = DEFAULT_OUT;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' && i + 1 < argv.length) out = resolve(argv[++i]!);
    else if (a === '--dry-run') dryRun = true;
    else if (a === '-h' || a === '--help') {
      process.stdout.write(
        'Usage: tsx scripts/analyze-effect-migration.ts [--out path] [--dry-run]\n',
      );
      process.exit(0);
    }
  }
  return { out, dryRun };
}

function listProductionTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const st = statSync(abs);
      if (st.isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(abs);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (entry.endsWith('.test.ts') || entry.endsWith('.spec.ts')) continue;
      if (entry.endsWith('.d.ts')) continue;
      if (ALREADY_MIGRATED.has(abs)) continue;
      out.push(abs);
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Parse import paths from a TypeScript source file. Returns relative module
 * specifiers (the literal text from `from "..."` / `import("...")`), unfiltered.
 */
function parseImports(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf-8');
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      specs.push((node.arguments[0] as ts.StringLiteral).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return specs;
}

/**
 * Resolve a relative module specifier to an absolute file path inside src/lib.
 * Returns null for non-relative imports (third-party) or imports that escape
 * src/lib (e.g. into src/dashboard or packages/contracts).
 */
function resolveLocalImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);

  // Strategy: try TS-source paths first (handles the common case where spec
  // ends in .js per ESM convention but the source is .ts).
  const candidates: string[] = [];
  if (spec.endsWith('.js')) {
    candidates.push(base.replace(/\.js$/, '.ts'));
    candidates.push(base.replace(/\.js$/, '.tsx'));
  }
  if (spec.endsWith('.ts') || spec.endsWith('.tsx')) {
    candidates.push(base);
  }
  // Bare specs (no extension): try .ts/.tsx, then directory/index.ts
  if (!spec.match(/\.[a-zA-Z]+$/)) {
    candidates.push(base + '.ts');
    candidates.push(base + '.tsx');
    candidates.push(join(base, 'index.ts'));
    candidates.push(join(base, 'index.tsx'));
  }
  // Final fallback: maybe the literal path exists
  candidates.push(base);

  for (const c of candidates) {
    try {
      const st = statSync(c);
      if (st.isFile()) return resolve(c);
    } catch {
      /* not found, try next */
    }
  }
  return null;
}

function isInsideLib(abs: string): boolean {
  const rel = relative(LIB_ROOT, abs);
  return !rel.startsWith('..') && !resolve(rel).startsWith('..' + sep);
}

function relFromRepo(abs: string): string {
  return relative(REPO_ROOT, abs).split(sep).join(posix.sep);
}

function relFromLib(abs: string): string {
  return relative(LIB_ROOT, abs).split(sep).join(posix.sep);
}

function sanitizeId(relPath: string): string {
  return relPath
    .replace(/\.ts$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase();
}

function uuidv4(): string {
  return crypto.randomUUID();
}

interface AnalysisGraph {
  nodes: ReadonlyArray<string>; // absolute paths
  imports: ReadonlyMap<string, ReadonlySet<string>>; // file -> set of files it imports (inside lib only)
}

function buildGraph(files: ReadonlyArray<string>): AnalysisGraph {
  const fileSet = new Set(files);
  const imports = new Map<string, Set<string>>();
  for (const f of files) {
    const specs = parseImports(f);
    const resolved = new Set<string>();
    for (const s of specs) {
      const target = resolveLocalImport(f, s);
      if (target == null) continue; // third-party or non-relative
      if (!isInsideLib(target)) continue; // out-of-lib import
      if (target === f) continue; // self-import (shouldn't happen)
      if (!fileSet.has(target)) continue; // imports a file we're not migrating (test, already-migrated, etc.)
      resolved.add(target);
    }
    imports.set(f, resolved);
  }
  return { nodes: files, imports };
}

interface Wave {
  index: number;
  files: ReadonlyArray<string>;
}

/**
 * Tarjan's strongly-connected components algorithm. Returns SCCs in reverse
 * topological order (sinks first). Singleton SCCs without a self-edge are
 * non-cyclic; all others are real cycles.
 */
function tarjanSCC(graph: AnalysisGraph): ReadonlyArray<ReadonlyArray<string>> {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const sccs: string[][] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.imports.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };

  for (const v of graph.nodes) {
    if (!indices.has(v)) strongConnect(v);
  }

  return sccs;
}

/**
 * Build a DAG of SCCs (condensation graph) and assign waves to SCCs via
 * Kahn's algorithm. Singleton non-cyclic SCCs become single-file waves;
 * multi-file SCCs become "cycle group" waves where every file in the cycle
 * must dispatch together (or with an adapter strategy — see the migration plan).
 */
function assignWaves(graph: AnalysisGraph): {
  waves: ReadonlyArray<Wave>;
  cycleSCCs: ReadonlyArray<ReadonlyArray<string>>;
} {
  const sccs = tarjanSCC(graph);
  const fileToSccIndex = new Map<string, number>();
  sccs.forEach((scc, i) => {
    for (const f of scc) fileToSccIndex.set(f, i);
  });

  const isCyclicSCC = (scc: ReadonlyArray<string>): boolean => {
    if (scc.length > 1) return true;
    const f = scc[0]!;
    return (graph.imports.get(f) ?? new Set()).has(f);
  };

  // Build condensation graph: edge between SCCs if any file in source SCC
  // imports a file in target SCC.
  const sccDeps = new Map<number, Set<number>>();
  for (let i = 0; i < sccs.length; i++) sccDeps.set(i, new Set());
  for (const [f, imps] of graph.imports) {
    const srcSCC = fileToSccIndex.get(f)!;
    for (const target of imps) {
      const tgtSCC = fileToSccIndex.get(target)!;
      if (tgtSCC !== srcSCC) sccDeps.get(srcSCC)!.add(tgtSCC);
    }
  }

  // Kahn's on the condensation graph (which is guaranteed acyclic).
  const sccDependents = new Map<number, Set<number>>();
  for (let i = 0; i < sccs.length; i++) sccDependents.set(i, new Set());
  for (const [src, deps] of sccDeps) {
    for (const tgt of deps) sccDependents.get(tgt)!.add(src);
  }

  const sccWave = new Map<number, number>();
  const remainingDeps = new Map<number, number>();
  for (let i = 0; i < sccs.length; i++) {
    remainingDeps.set(i, sccDeps.get(i)!.size);
  }

  let frontier: number[] = [];
  for (let i = 0; i < sccs.length; i++) {
    if (remainingDeps.get(i) === 0) frontier.push(i);
  }
  let currentWave = 0;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const s of frontier) sccWave.set(s, currentWave);
    for (const s of frontier) {
      for (const dep of sccDependents.get(s) ?? []) {
        const r = remainingDeps.get(dep)! - 1;
        remainingDeps.set(dep, r);
        if (r === 0 && !sccWave.has(dep)) next.push(dep);
      }
    }
    frontier = next;
    currentWave++;
  }

  // Group files by wave
  const grouped = new Map<number, string[]>();
  for (let i = 0; i < sccs.length; i++) {
    const w = sccWave.get(i);
    if (w == null) continue;
    if (!grouped.has(w)) grouped.set(w, []);
    grouped.get(w)!.push(...sccs[i]!);
  }
  const waveList: Wave[] = [];
  for (let i = 0; i < currentWave; i++) {
    const files = (grouped.get(i) ?? []).sort();
    if (files.length > 0) waveList.push({ index: i, files });
  }

  const cycleSCCs = sccs.filter(isCyclicSCC);
  return { waves: waveList, cycleSCCs };
}

interface VBriefEdge {
  from: string;
  to: string;
  type: 'blocks';
}

interface VBriefSubItem {
  id: string;
  title: string;
  status: 'pending';
  metadata: { kind: 'acceptance_criterion' };
}

interface VBriefItem {
  id: string;
  title: string;
  status: 'pending';
  priority: 'medium';
  created: string;
  metadata: {
    difficulty: 'simple' | 'medium' | 'complex';
    issueLabel: 'pan-1249';
    files_scope: string[];
    wave: number;
    importsCount: number;
    sizeBytes: number;
  };
  narrative: { Action: string };
  subItems: VBriefSubItem[];
}

const ACCEPTANCE_CRITERIA_TEMPLATE: ReadonlyArray<string> = [
  'All exported functions return `Effect.Effect<T, E>` with typed errors (no `Promise<T>` returns remain).',
  'All `execAsync` / `execFileAsync` calls replaced with `@effect/platform-node` `ChildProcessSpawner`.',
  'All `try/catch` for expected failure modes replaced with `Data.TaggedError` channels — no thrown exceptions.',
  'All `fs/promises` calls replaced with `@effect/platform` `FileSystem` service.',
  'Test file (if exists) migrated to `@effect/vitest` using `it.effect()`.',
  'No new `Effect.runPromise()` introduced inside `src/lib/` — only at adapter boundaries.',
  'Observable behavior unchanged — no logic changes alongside the migration.',
  '`npm run typecheck` and `npm run lint` pass for the touched file and its callers.',
];

function difficultyFor(sizeBytes: number, importsCount: number): 'simple' | 'medium' | 'complex' {
  if (sizeBytes >= 50_000 || importsCount >= 15) return 'complex';
  if (sizeBytes >= 15_000 || importsCount >= 5) return 'medium';
  return 'simple';
}

function buildPerFileItem(args: {
  absPaths: ReadonlyArray<string>;
  waveIndex: number;
  sizeBytes: number;
  importsCount: number;
  nowIso: string;
}): VBriefItem {
  const isCycle = args.absPaths.length > 1;
  const relPaths = args.absPaths.map(relFromRepo);
  const id = isCycle
    ? `effect-migrate-cycle-${sanitizeId(relFromLib(args.absPaths[0]!))}-and-${args.absPaths.length - 1}-more`
    : `effect-migrate-${sanitizeId(relFromLib(args.absPaths[0]!))}`;
  const title = isCycle
    ? `Effect migration (cyclic SCC, ${args.absPaths.length} files): ${relPaths[0]} + ${args.absPaths.length - 1} more`
    : `Effect migration: ${relPaths[0]}`;
  return {
    id,
    title,
    status: 'pending',
    priority: isCycle ? 'high' : 'medium',
    created: args.nowIso,
    metadata: {
      difficulty: isCycle
        ? args.absPaths.length >= 8
          ? 'complex'
          : 'medium'
        : difficultyFor(args.sizeBytes, args.importsCount),
      issueLabel: 'pan-1249',
      files_scope: relPaths,
      wave: args.waveIndex,
      importsCount: args.importsCount,
      sizeBytes: args.sizeBytes,
    },
    narrative: {
      Action: isCycle
        ? [
            `Convert ${args.absPaths.length} mutually-recursive files to Effect-native in a single PR.`,
            '',
            'Files in this cyclic SCC (all migrate together):',
            ...relPaths.map((p) => `  - ${p}`),
            '',
            'Why this is one item, not many: these files import each other in a cycle.',
            'Migrating any one in isolation would break the others mid-wave. Single slot,',
            'single PR, all files migrate together.',
            '',
            'Concrete steps:',
            `1. Replace each \`async function\` / \`Promise<T>\` return with \`Effect.Effect<T, E>\` across all files in scope.`,
            `2. Define typed errors as \`Data.TaggedError\` (or import from \`src/lib/errors.ts\` from wave 0).`,
            `3. Replace child-process spawning with \`ChildProcessSpawner\` from \`@effect/platform-node\`.`,
            `4. Replace \`fs/promises\` with \`FileSystem.FileSystem\` service.`,
            `5. Update internal call sites in this SCC to use \`yield*\`.`,
            `6. Update external call sites (in other src/lib files): leave for their own slot — but ensure the new signatures are exported correctly.`,
            `7. Migrate adjacent test files (if exist) to \`@effect/vitest\`.`,
            '',
            'STRICT RULES (do not break, per PAN-1193 mitigation):',
            '- Only modify files in `files_scope`. Need a shared type? Use `src/lib/errors.ts` from wave 0.',
            '- Do NOT create new files outside files_scope. If one is needed, stop and report.',
            '- Do NOT introduce logic changes alongside the migration.',
          ].join('\n')
        : [
            `Convert ${relPaths[0]} from promise-based to Effect-native.`,
        '',
        'Concrete steps:',
        `1. Replace each \`async function\` / \`Promise<T>\` return with \`Effect.Effect<T, E>\`.`,
        `2. Define typed errors as \`Data.TaggedError\` subclasses where this file needs to surface failure modes.`,
        `3. Replace child-process spawning with \`ChildProcessSpawner\` from \`@effect/platform-node\`.`,
        `4. Replace \`fs/promises\` with \`FileSystem.FileSystem\` service.`,
        `5. Update the callers inside src/lib/ — but ONLY adjust their call sites to use \`yield*\`; do not migrate them in this slot (they have their own slots).`,
        `6. For callers outside src/lib/ that already use Effect (dashboard server), consume via \`yield*\`.`,
        `7. For callers outside src/lib/ still on promises (CLI commands), wrap with \`Effect.runPromise()\` at the boundary.`,
        `8. Migrate adjacent test file (if exists) to \`@effect/vitest\`.`,
        '',
        'STRICT RULES (do not break, per PAN-1193 mitigation):',
        '- Only modify files in `files_scope`. If you need a shared type, use the existing `src/lib/errors.ts` from wave 0.',
        '- Do NOT create new files outside files_scope. If you discover one is needed, stop and report.',
        '- Do NOT introduce logic changes alongside the migration.',
      ].join('\n'),
    },
    subItems: ACCEPTANCE_CRITERIA_TEMPLATE.map((title, idx) => ({
      id: `${id}.ac${idx + 1}`,
      title,
      status: 'pending' as const,
      metadata: { kind: 'acceptance_criterion' as const },
    })),
  };
}

function buildSharedErrorsItem(nowIso: string): VBriefItem {
  const id = 'effect-migrate-w0-shared-errors';
  return {
    id,
    title: 'Effect migration: wave-0 shared errors (`src/lib/errors.ts`)',
    status: 'pending',
    priority: 'high',
    created: nowIso,
    metadata: {
      difficulty: 'simple',
      issueLabel: 'pan-1249',
      files_scope: ['src/lib/errors.ts'],
      wave: 0,
      importsCount: 0,
      sizeBytes: 0,
    },
    narrative: {
      Action: [
        'Create src/lib/errors.ts with `Data.TaggedError` subclasses that downstream slots can import.',
        '',
        'Required error classes (add more if the wave-0 slot reviewer identifies common cases):',
        '- VcsError, VcsTimeoutError',
        '- FsError, FsNotFoundError',
        '- GitError, MergeConflictError',
        '- TmuxError',
        '- TrackerError, GitHubApiError, LinearApiError',
        '- CheckpointError, InvalidAgentIdError',
        '- ConfigError, ConfigParseError',
        '- ProcessSpawnError, ProcessTimeoutError',
        '',
        'Each error should be a `Data.TaggedError("Name")<{ readonly ... }>` declaration with the fields downstream slots will want (cause, operation context, command args where applicable).',
        '',
        'This item exists because the swarm has no `files_scope` enforcement at merge time (PAN-1193). By pre-creating shared errors in wave 0, no downstream slot ever has reason to invent them, avoiding the racing-creation failure mode.',
      ].join('\n'),
    },
    subItems: [
      {
        id: `${id}.ac1`,
        title: '`src/lib/errors.ts` exports the listed `Data.TaggedError` subclasses with documented field shapes.',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
      {
        id: `${id}.ac2`,
        title: '`npm run typecheck` and `npm run lint` pass with the new file.',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
      {
        id: `${id}.ac3`,
        title: 'A unit test demonstrates each tagged error can be constructed, narrowed by `_tag`, and matched in an Effect channel.',
        status: 'pending',
        metadata: { kind: 'acceptance_criterion' },
      },
    ],
  };
}

interface AnalysisOutput {
  totals: {
    files: number;
    waves: number;
    cycles: number;
    sharedErrorsItem: 1;
  };
  perWave: ReadonlyArray<{ wave: number; count: number; samples: string[] }>;
  cycles: ReadonlyArray<ReadonlyArray<string>>;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  process.stderr.write(`Scanning ${LIB_ROOT}...\n`);
  const files = listProductionTsFiles(LIB_ROOT);
  process.stderr.write(`  ${files.length} production .ts files to migrate (excluding tests + flywheel.ts)\n`);

  process.stderr.write(`Parsing imports...\n`);
  const graph = buildGraph(files);
  let edgeCount = 0;
  for (const set of graph.imports.values()) edgeCount += set.size;
  process.stderr.write(`  ${edgeCount} internal-import edges\n`);

  process.stderr.write(`Assigning waves (Tarjan SCC + Kahn on condensation)...\n`);
  const { waves, cycleSCCs } = assignWaves(graph);
  process.stderr.write(`  ${waves.length} waves\n`);
  process.stderr.write(`  ${cycleSCCs.length} cyclic SCC(s)\n`);
  const sortedSCCs = [...cycleSCCs].sort((a, b) => b.length - a.length);
  for (const scc of sortedSCCs.slice(0, 5)) {
    process.stderr.write(`    SCC (${scc.length} files): ${scc.slice(0, 3).map(relFromRepo).join(', ')}${scc.length > 3 ? ', ...' : ''}\n`);
  }
  if (sortedSCCs.length > 5) {
    process.stderr.write(`    ... and ${sortedSCCs.length - 5} more SCC(s)\n`);
  }

  // Group files in the same SCC under one item (mutually-recursive files
  // must migrate together). Build an SCC lookup keyed by canonical SCC root.
  const fileToSCC = new Map<string, string[]>();
  for (const scc of cycleSCCs) {
    const sortedSCC = [...scc].sort();
    for (const f of sortedSCC) fileToSCC.set(f, sortedSCC);
  }

  // Build items
  const nowIso = new Date().toISOString();
  const items: VBriefItem[] = [];
  const sharedErrors = buildSharedErrorsItem(nowIso);
  items.push(sharedErrors);

  // Track which SCC groups we've already emitted (avoid duplicating items)
  const emittedSCC = new Set<string>(); // key = sorted joined paths

  // Map each file to the item id that will migrate it (for edge construction)
  const fileToItemId = new Map<string, string>();

  for (const wave of waves) {
    // Group files in this wave by SCC; singletons are passed as length-1 groups
    const groups: string[][] = [];
    const seenInWave = new Set<string>();
    for (const abs of wave.files) {
      if (seenInWave.has(abs)) continue;
      const scc = fileToSCC.get(abs);
      if (scc != null && scc.length > 1) {
        const key = scc.join('|');
        if (emittedSCC.has(key)) {
          for (const f of scc) seenInWave.add(f);
          continue;
        }
        emittedSCC.add(key);
        groups.push(scc);
        for (const f of scc) seenInWave.add(f);
      } else {
        groups.push([abs]);
        seenInWave.add(abs);
      }
    }

    for (const group of groups) {
      const totalSize = group.reduce((acc, f) => acc + statSync(f).size, 0);
      const totalImports = group.reduce((acc, f) => acc + (graph.imports.get(f)?.size ?? 0), 0);
      const item = buildPerFileItem({
        absPaths: group,
        waveIndex: wave.index + 1, // bump everyone by 1 to leave wave-0 for shared-errors
        sizeBytes: totalSize,
        importsCount: totalImports,
        nowIso,
      });
      items.push(item);
      for (const f of group) fileToItemId.set(f, item.id);
    }
  }

  // Build edges
  const edges: VBriefEdge[] = [];
  // Every per-file item depends on shared-errors (wave 0)
  for (const item of items) {
    if (item.id === sharedErrors.id) continue;
    edges.push({ from: sharedErrors.id, to: item.id, type: 'blocks' });
  }
  // File-to-file dependency edges, deduplicated at the item level
  const edgeKey = new Set<string>();
  for (const [f, deps] of graph.imports) {
    const toId = fileToItemId.get(f);
    if (toId == null) continue;
    for (const dep of deps) {
      const fromId = fileToItemId.get(dep);
      if (fromId == null) continue;
      if (fromId === toId) continue; // intra-SCC edge, already handled by coalesced item
      const k = `${fromId}->${toId}`;
      if (edgeKey.has(k)) continue;
      edgeKey.add(k);
      edges.push({ from: fromId, to: toId, type: 'blocks' });
    }
  }

  // Build vBRIEF document
  const doc = {
    vBRIEFInfo: {
      version: '0.5.0',
      created: nowIso,
      updated: nowIso,
      author: 'scripts/analyze-effect-migration.ts',
      description:
        'src/lib Effect migration — one item per file, topologically waved. See .pan/swarm-migration-plan.md for context.',
    },
    plan: {
      id: 'pan-1249-effect-migration',
      title: 'Complete src/lib Effect migration (swarm dispatch)',
      status: 'proposed',
      uid: uuidv4(),
      sequence: 1,
      created: nowIso,
      updated: nowIso,
      author: 'scripts/analyze-effect-migration.ts',
      tags: ['effect-migration', 'swarm', 'architecture'],
      references: [
        { type: 'issue', id: 'PAN-1249', url: 'https://github.com/eltmon/panopticon-cli/issues/1249' },
        { type: 'design-doc', id: 'swarm-migration-plan', url: '.pan/swarm-migration-plan.md' },
        { type: 'risk', id: 'PAN-1193', url: 'https://github.com/eltmon/panopticon-cli/issues/1193' },
      ],
      narratives: {
        Problem:
          'src/lib/ is 363 production .ts files but only 1 (cloister/flywheel.ts) is Effect-native. The dashboard server consuming it is already Effect-native, so every consumer pays Effect.tryPromise tax at the boundary, loses typed errors, and locks in tech debt.',
        Proposal:
          'Single swarm dispatch with one slot per file, topologically waved so leaves migrate first. Wave-0 pre-lands shared Data.TaggedError classes so no slot ever needs to invent them (PAN-1193 mitigation).',
        Constraint:
          'Each slot must only modify files in its files_scope. No new files outside scope. No logic changes alongside migration.',
        Risk:
          'PAN-1193 (no files_scope enforcement at merge time) is mitigated by wave-0 shared errors + strict per-slot prompt. PAN-1192 (model default) is overridden at dispatch via --model.',
      },
      metadata: {
        canonicalFilename: 'pan-1249-effect-migration.vbrief.json',
        generatedBy: 'analyze-effect-migration.ts',
        stats: {
          fileCount: files.length,
          edgeCount,
          waveCount: waves.length + 1, // include wave-0 shared-errors
          cycleCount: cycleSCCs.length,
        },
      },
      items,
      edges,
    },
    status: 'proposed',
  };

  // Print summary
  const perWaveSummary: { wave: number; count: number; samples: string[] }[] = [
    {
      wave: 0,
      count: 1,
      samples: ['src/lib/errors.ts (shared errors)'],
    },
  ];
  for (const w of waves) {
    perWaveSummary.push({
      wave: w.index + 1,
      count: w.files.length,
      samples: w.files.slice(0, 3).map((f) => relFromRepo(f)),
    });
  }

  const summary: AnalysisOutput = {
    totals: {
      files: files.length,
      waves: waves.length + 1,
      cycles: cycleSCCs.length,
      sharedErrorsItem: 1,
    },
    perWave: perWaveSummary,
    cycles: cycleSCCs.map((c) => c.map((f) => relFromRepo(f))),
  };

  process.stdout.write('\n=== ANALYSIS SUMMARY ===\n');
  process.stdout.write(`Total files: ${summary.totals.files} (plus 1 wave-0 shared-errors item)\n`);
  process.stdout.write(`Waves: ${summary.totals.waves} (wave-0 = shared errors, then ${waves.length} topological waves)\n`);
  process.stdout.write(`Cycle groups: ${summary.totals.cycles}\n`);
  process.stdout.write('\nPer-wave file counts:\n');
  for (const w of perWaveSummary) {
    process.stdout.write(`  wave ${w.wave.toString().padStart(2)}: ${w.count.toString().padStart(4)} files — sample: ${w.samples[0] ?? '(none)'}\n`);
  }

  if (args.dryRun) {
    process.stdout.write('\n--dry-run set; not writing output.\n');
    return;
  }

  writeFileSync(args.out, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
  process.stdout.write(`\nWrote vBRIEF plan: ${args.out}\n`);
  process.stdout.write(`  ${items.length} items, ${edges.length} edges\n`);
}

main();
