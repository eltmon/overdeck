#!/usr/bin/env node
// rename-sync-suffix.mjs — PAN-4002.
//
// Renames surviving `...Sync` functions (no async twin left, per the PAN-3958
// CH-8b/CH-9 ledger `.pan/notes/pan-3958-no-loss.md`) to their bare name, and
// the AC-W6 residual `...Promise` names (REFACTOR-QUEUE row 21j) to either the
// bare name (Effect twin already deleted) or `...Body` (private body behind a
// kept Effect export, following the CH-4 convention).
//
// Candidate lists are checked-in data files, not re-derived at runtime, because
// they were already produced mechanically (scripts/audit-effect-boundary.mjs)
// and hand-verified against `.pan/notes/pan-3958-no-loss.md` lines 2169-2286 and
// `git grep -nE "async function \w+Promise\(" -- src/lib` (see PAN-4002 PR body
// for the verification notes, including three names the ledger listed that are
// NOT renamed — see SEMANTIC_EXCLUSIONS below).
//
// Modes:
//   node scripts/codemods/rename-sync-suffix.mjs --plan
//     Computes every target (rename or skip, with a reason), writes
//     scripts/codemods/rename-sync-suffix-targets.json, and prints a summary.
//   node scripts/codemods/rename-sync-suffix.mjs --apply [targets.json]
//     Reads the plan file (default: the one --plan just wrote) and performs
//     every non-skipped rename with ts-morph's `.rename()`, then saves once.
//
// Never re-run --plan after --apply against the same targets file mid-session
// without re-checking out a clean tree first: the candidate lists are declared
// against the ORIGINAL (pre-rename) names, and re-deriving from an
// already-renamed tree would double-strip names like `planHooksSyncSync`.

import { Project } from 'ts-morph';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');

const SYNC_CANDIDATES = JSON.parse(readFileSync(join(HERE, 'rename-sync-suffix-sync-candidates.json'), 'utf8'));
const PROMISE_CANDIDATES = JSON.parse(readFileSync(join(HERE, 'rename-sync-suffix-promise-candidates.json'), 'utf8'));

const DEFAULT_TARGETS_PATH = join(HERE, 'rename-sync-suffix-targets.json');

// Oh My Pi is out of scope (#4003) regardless of which list a name is in.
const isOhMyPi = (module) => /ohmypi/i.test(module);

// Ledger entries whose `Sync` is a domain noun ("needs a sync", "version-sync
// config", "before [the] sync [step]"), not the PAN-3958 twin-suffix — each one
// is declared `async function ...Sync(`, which is itself the tell: a *sync*
// suffix on an *async* function cannot mean "the synchronous variant". Found by
// re-deriving the ledger's list mechanically and checking every candidate's
// modifier list; not called out in the ledger itself.
const SEMANTIC_EXCLUSIONS = new Set([
  'shadow-state.ts::needsSync',
  'cloister/merge-agent.ts::autoCommitWorkspaceChangesBeforeSync',
  'projects-writer.ts::setProjectVersionSync',
]);

function buildProject() {
  const project = new Project({ tsConfigFilePath: join(ROOT, 'tsconfig.json') });
  // NOTE: do not mix a `!exclude` glob for dashboard/server test files with a
  // separate positive `src/**/*.test.ts` pattern in the same call — ts-morph
  // (like .gitignore) applies negation across the whole pattern array, so the
  // exclusion silently drops files the other pattern was supposed to re-add.
  // Duplicates across these patterns are harmless; ts-morph dedupes by path.
  project.addSourceFilesAtPaths([
    join(ROOT, 'src/dashboard/server/**/*.ts'),
    join(ROOT, 'src/**/*.test.ts'),
    join(ROOT, 'src/**/*.test.tsx'),
    join(ROOT, 'tests/**/*.ts'),
    join(ROOT, 'packages/contracts/src/**/*.ts'),
  ]);
  return project;
}

function findTopLevelDecl(sourceFile, name) {
  if (!sourceFile) return null;
  return sourceFile.getFunction(name) || sourceFile.getVariableDeclaration(name) || null;
}

function topLevelNames(sourceFile) {
  const names = new Set();
  for (const fn of sourceFile.getFunctions()) {
    const n = fn.getName();
    if (n) names.add(n);
  }
  for (const vd of sourceFile.getVariableDeclarations()) names.add(vd.getName());
  for (const cls of sourceFile.getClasses()) {
    const n = cls.getName();
    if (n) names.add(n);
  }
  for (const i of sourceFile.getInterfaces()) names.add(i.getName());
  for (const t of sourceFile.getTypeAliases()) names.add(t.getName());
  for (const e of sourceFile.getEnums()) names.add(e.getName());
  for (const imp of sourceFile.getImportDeclarations()) {
    const def = imp.getDefaultImport();
    if (def) names.add(def.getText());
    const ns = imp.getNamespaceImport();
    if (ns) names.add(ns.getText());
    for (const spec of imp.getNamedImports()) {
      const bound = spec.getAliasNode() || spec.getNameNode();
      names.add(bound.getText());
    }
  }
  return names;
}

/** Skip if the new name would already be visible (shadow) in the declaring
 * module or in any file that references the old name. */
function findCollision(sourceFile, decl, oldName, newName) {
  const localNames = topLevelNames(sourceFile);
  localNames.delete(oldName);
  if (localNames.has(newName)) {
    return `module-level name \`${newName}\` already exists in ${sourceFile.getFilePath()}`;
  }
  let refs;
  try {
    refs = decl.findReferencesAsNodes();
  } catch (err) {
    return `could not resolve references (${err.message})`;
  }
  const checked = new Set();
  for (const ref of refs) {
    const refSf = ref.getSourceFile();
    if (refSf === sourceFile) continue;
    const key = refSf.getFilePath();
    if (checked.has(key)) continue;
    checked.add(key);
    const names = topLevelNames(refSf);
    names.delete(oldName);
    if (names.has(newName)) {
      return `would collide with an existing \`${newName}\` in ${key}`;
    }
  }
  return null;
}

function planSyncTargets(project) {
  const targets = [];
  for (const { module, name } of SYNC_CANDIDATES) {
    const file = `src/lib/${module}`;
    const filePath = join(ROOT, file);
    const base = {
      kind: 'sync',
      file,
      oldName: name,
      newName: name.slice(0, -'Sync'.length),
    };
    if (isOhMyPi(module)) {
      targets.push({ ...base, skip: true, skipReason: 'Oh My Pi (#4003)' });
      continue;
    }
    if (SEMANTIC_EXCLUSIONS.has(`${module}::${name}`)) {
      targets.push({
        ...base,
        skip: true,
        skipReason: 'semantic false positive: "Sync" is a domain noun on an async function, not the twin suffix',
      });
      continue;
    }
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      targets.push({ ...base, skip: true, skipReason: `file not found: ${file}` });
      continue;
    }
    const decl = findTopLevelDecl(sourceFile, name);
    if (!decl) {
      targets.push({ ...base, skip: true, skipReason: `declaration \`${name}\` not found in ${file}` });
      continue;
    }
    const collision = findCollision(sourceFile, decl, name, base.newName);
    if (collision) {
      targets.push({ ...base, skip: true, skipReason: `collision: ${collision}` });
      continue;
    }
    targets.push({ ...base, skip: false });
  }
  return targets;
}

function planPromiseTargets(project) {
  const targets = [];
  for (const { module, name } of PROMISE_CANDIDATES) {
    const file = `src/lib/${module}`;
    const filePath = join(ROOT, file);
    const base0 = name.slice(0, -'Promise'.length);
    if (isOhMyPi(module)) {
      targets.push({ kind: 'promise', file, oldName: name, newName: base0, skip: true, skipReason: 'Oh My Pi (#4003)' });
      continue;
    }
    const sourceFile = project.getSourceFile(filePath);
    if (!sourceFile) {
      targets.push({ kind: 'promise', file, oldName: name, newName: base0, skip: true, skipReason: `file not found: ${file}` });
      continue;
    }
    const decl = findTopLevelDecl(sourceFile, name);
    if (!decl) {
      targets.push({ kind: 'promise', file, oldName: name, newName: base0, skip: true, skipReason: `declaration \`${name}\` not found in ${file}` });
      continue;
    }
    const hasBareTwin = !!findTopLevelDecl(sourceFile, base0);
    const newName = hasBareTwin ? `${base0}Body` : base0;
    const kind = hasBareTwin ? 'promise-body' : 'promise-bare';
    if (hasBareTwin && findTopLevelDecl(sourceFile, newName)) {
      targets.push({ kind, file, oldName: name, newName, skip: true, skipReason: `\`${newName}\` already exists in ${file}` });
      continue;
    }
    const collision = findCollision(sourceFile, decl, name, newName);
    if (collision) {
      targets.push({ kind, file, oldName: name, newName, skip: true, skipReason: `collision: ${collision}` });
      continue;
    }
    targets.push({ kind, file, oldName: name, newName, skip: false });
  }
  return targets;
}

function summarize(targets) {
  const renamed = targets.filter((t) => !t.skip);
  const skipped = targets.filter((t) => t.skip);
  const byReason = new Map();
  for (const t of skipped) {
    const key = t.skipReason.split(':')[0];
    byReason.set(key, (byReason.get(key) || 0) + 1);
  }
  console.log(`\n${renamed.length} to rename, ${skipped.length} skipped.`);
  for (const [reason, count] of byReason) console.log(`  skipped (${reason}): ${count}`);
  if (skipped.length) {
    console.log('\nSkipped, in full:');
    for (const t of skipped) console.log(`  ${t.file} ${t.oldName} -> ${t.newName}: ${t.skipReason}`);
  }
}

function runPlan() {
  const project = buildProject();
  const syncTargets = planSyncTargets(project);
  const promiseTargets = planPromiseTargets(project);
  const targets = [...syncTargets, ...promiseTargets];
  writeFileSync(DEFAULT_TARGETS_PATH, JSON.stringify(targets, null, 2) + '\n');
  console.log(`Wrote ${targets.length} targets to ${DEFAULT_TARGETS_PATH}`);
  console.log('\n== Sync suffix ==');
  summarize(syncTargets);
  console.log('\n== Promise suffix ==');
  summarize(promiseTargets);
}

function runApply(targetsPath) {
  const targets = JSON.parse(readFileSync(targetsPath, 'utf8'));
  const project = buildProject();
  let applied = 0;
  for (const t of targets) {
    if (t.skip) continue;
    const filePath = join(ROOT, t.file);
    const sourceFile = project.getSourceFileOrThrow(filePath);
    const decl = findTopLevelDecl(sourceFile, t.oldName);
    if (!decl) {
      throw new Error(`apply: declaration \`${t.oldName}\` not found in ${t.file} (tree changed since --plan?)`);
    }
    decl.rename(t.newName, { renameInComments: true, renameInStrings: false, usePrefixAndSuffixText: false });
    applied += 1;
  }
  console.log(`Applying ${applied} renames...`);
  project.saveSync();
  console.log('Done.');
}

const argv = process.argv.slice(2);
if (argv[0] === '--plan') {
  runPlan();
} else if (argv[0] === '--apply') {
  runApply(argv[1] || DEFAULT_TARGETS_PATH);
} else {
  console.error('usage: rename-sync-suffix.mjs --plan | --apply [targets.json]');
  process.exit(2);
}
