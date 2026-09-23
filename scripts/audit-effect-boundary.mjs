#!/usr/bin/env node
// audit-effect-boundary.mjs — Effect façade and sync/async twin audit (PAN-3958).
//
// Classifies every exported function in <root>/src/lib (tests excluded) with the
// TypeScript compiler API:
//   Shape A  Promise façade: the whole body is Effect.promise / Effect.tryPromise
//            around a call to an in-repo function (declared in the file or imported
//            from a relative path).
//   Shape B  sync façade: the same with Effect.sync / Effect.try.
//   Shape C  sync/async twin pair: exported `foo` + `fooSync` in one file where
//            `foo` is not a Shape A/B façade (two independent implementations).
// See docs/EFFECT-BRIDGING.md "In-repo code: no façades".
//
// Usage (from anywhere):
//   node scripts/audit-effect-boundary.mjs [--root <dir>]            summary
//   node scripts/audit-effect-boundary.mjs --baseline                ratchet rows
//   node scripts/audit-effect-boundary.mjs --json [--usage]          full JSON
// --usage adds the consumer walk (production/test reference counts per name,
// over src, tests, packages, apps, scripts, sync-sources) for planners.
// scripts/lint-effect-facades.sh consumes --baseline: one "<shape> <count> <path>"
// row per non-zero count, sorted.

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

const USAGE = 'usage: node scripts/audit-effect-boundary.mjs [--root <dir>] [--baseline | --json [--usage]]';

function parseArgs(argv) {
  const opts = { root: join(dirname(fileURLToPath(import.meta.url)), '..'), mode: 'summary', usage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root' && argv[i + 1]) opts.root = argv[(i += 1)];
    else if (arg === '--baseline') opts.mode = 'baseline';
    else if (arg === '--json') opts.mode = 'json';
    else if (arg === '--usage') opts.usage = true;
    else {
      console.error(USAGE);
      process.exit(2);
    }
  }
  return opts;
}

const PRUNED_DIRS = new Set(['node_modules', 'dist', '.git']);
const toPosix = (p) => p.split(sep).join('/');

/** Recursively list files under `dir` (relative to `root`, posix separators), pruning build dirs. */
function listFiles(root, dir) {
  const out = [];
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED_DIRS.has(entry.name)) walk(child);
      } else if (entry.isFile()) {
        out.push(toPosix(relative(root, child)));
      }
    }
  };
  walk(join(root, dir));
  return out.sort();
}

const isTestFile = (f) => /\.(test|spec)\.tsx?$/.test(f) || f.includes('/__tests__/');
const isLibSource = (f) => /\.tsx?$/.test(f) && !f.endsWith('.d.ts') && !isTestFile(f);
const isUsageTest = (f) => /(^|\/)(tests?|__tests__|e2e)\//.test(f) || /\.(test|spec)\.tsx?$/.test(f);

function createParser(root) {
  const cache = new Map();
  return (f) => {
    if (!cache.has(f)) {
      const text = readFileSync(join(root, f), 'utf8');
      const kind = f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      cache.set(f, ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kind));
    }
    return cache.get(f);
  };
}

const lineOf = (s, n) => s.getLineAndCharacterOfPosition(n.getStart(s)).line + 1;
const isExported = (n) => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;
const isAsyncFn = (n) => (n.modifiers || []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

const EFFECT_RETURN_RE =
  /^Effect\.(gen|promise|tryPromise|sync|try|succeed|fail|fn|suspend|void|andThen|map|flatMap|forEach|all|catch|scoped|acquireRelease)\b/;

/** Classify an exported function-like as effect | async | sync. */
function classifyFn(s, typeNode, body, isAsync) {
  const rt = typeNode ? typeNode.getText(s) : '';
  if (/^Effect\.Effect</.test(rt) || /^Effect</.test(rt)) return 'effect';
  if (isAsync || /^Promise</.test(rt)) return 'async';
  if (body) {
    let expr = body;
    if (ts.isBlock(body)) {
      const lastRet = [...body.statements].reverse().find((st) => ts.isReturnStatement(st));
      expr = lastRet ? lastRet.expression : null;
    }
    if (expr) {
      const t = expr.getText(s);
      if (EFFECT_RETURN_RE.test(t) || (/\.pipe\(/.test(t) && /Effect\./.test(t))) return 'effect';
      if (/^new Promise\b/.test(t) || /^Promise\./.test(t)) return 'async';
    }
  }
  return 'sync';
}

function spanLines(s, node) {
  const start = s.getLineAndCharacterOfPosition(node.getFullStart()).line;
  const end = s.getLineAndCharacterOfPosition(node.getEnd()).line;
  return end - start + 1;
}

/**
 * A façade's whole body is `Effect.promise|tryPromise|sync|try(() => callee(…))`
 * (or `{ try: () => callee(…), catch }`) where `callee` is in-repo. Returns the
 * callee name and the bridge used, or null.
 */
function facadeCallee(s, body, localNames, importedRel) {
  if (!body) return null;
  let expr = body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return null;
    expr = body.statements[0].expression;
  }
  if (!expr || !ts.isCallExpression(expr)) return null;
  const bridge = expr.expression.getText(s);
  let thunk = null;
  if (bridge === 'Effect.promise' || bridge === 'Effect.sync') thunk = expr.arguments[0];
  else if (bridge === 'Effect.tryPromise' || bridge === 'Effect.try') {
    const a = expr.arguments[0];
    if (a && ts.isObjectLiteralExpression(a)) {
      const p = a.properties.find((prop) => prop.name && prop.name.getText(s) === 'try');
      thunk = p && p.initializer;
    } else thunk = a;
  }
  if (!thunk || !(ts.isArrowFunction(thunk) || ts.isFunctionExpression(thunk))) return null;
  let inner = thunk.body;
  if (ts.isBlock(inner)) return null;
  while (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)) inner = inner.expression;
  if (!ts.isCallExpression(inner)) return null;
  const name = inner.expression.getText(s);
  const base = name.split('.')[0];
  return localNames.has(base) || importedRel.has(base) ? { name, via: bridge } : null;
}

const shapeOf = (via) => (via === 'Effect.promise' || via === 'Effect.tryPromise' ? 'A' : 'B');

/** Collect local and relative-import names, then every exported function and façade. */
function scanModule(s, f) {
  const localNames = new Set();
  const importedRel = new Set();
  for (const st of s.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith('.')) {
      const clause = st.importClause;
      const nb = clause && clause.namedBindings;
      if (clause && clause.name) importedRel.add(clause.name.text);
      if (nb && ts.isNamedImports(nb)) nb.elements.forEach((e) => importedRel.add(e.name.text));
      if (nb && ts.isNamespaceImport(nb)) importedRel.add(nb.name.text);
    }
    if (ts.isFunctionDeclaration(st) && st.name) localNames.add(st.name.text);
    if (ts.isVariableStatement(st)) {
      st.declarationList.declarations.forEach((d) => ts.isIdentifier(d.name) && localNames.add(d.name.text));
    }
  }

  const exps = [];
  const facades = [];
  const record = (name, node, spanNode, typeNode, body, isAsync) => {
    exps.push({ name, kind: classifyFn(s, typeNode, body, isAsync), line: lineOf(s, node) });
    const fc = facadeCallee(s, body, localNames, importedRel);
    if (fc) {
      facades.push({ file: f, line: lineOf(s, node), name, shape: shapeOf(fc.via), callee: fc.name, via: fc.via, span: spanLines(s, spanNode) });
    }
  };
  for (const st of s.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && isExported(st)) {
      record(st.name.text, st, st, st.type, st.body, isAsyncFn(st));
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          record(d.name.text, d, st, init.type || d.type, init.body, isAsyncFn(init));
        } else if (init && /^Effect\.fn\b/.test(init.getText(s))) {
          exps.push({ name: d.name.text, kind: 'effect', line: lineOf(s, d) });
        }
      }
    }
  }
  return { exps, facades };
}

const TWIN_SUFFIXES = ['Sync', 'Async', 'Promise', 'Effect'];

/** Exported name pairs `foo` + `foo<Suffix>` in the same file. Shape C = Sync pairs whose `foo` is not a façade. */
function findTwinPairs(exportsByFile, facadeKeys) {
  const pairs = [];
  for (const [f, exps] of Object.entries(exportsByFile)) {
    const byName = new Map(exps.map((e) => [e.name, e]));
    for (const e of exps) {
      for (const kind of TWIN_SUFFIXES) {
        if (!e.name.endsWith(kind) || e.name.length === kind.length) continue;
        const base = e.name.slice(0, -kind.length);
        if (!byName.has(base)) continue;
        const pair = { file: f, kind, base, twin: e.name, baseKind: byName.get(base).kind, twinKind: e.kind, line: e.line };
        pair.shapeC = kind === 'Sync' && !facadeKeys.has(`${f}::${base}`);
        pairs.push(pair);
      }
    }
  }
  return pairs;
}

/** Consumer walk: per target name, production vs test references and calling context. */
function usageWalk(root, parse, targets) {
  const usage = {};
  const enclosingFn = (n) => {
    for (let cur = n.parent; cur; cur = cur.parent) {
      if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) ||
        ts.isMethodDeclaration(cur) || ts.isGetAccessor(cur) || ts.isConstructorDeclaration(cur)) return cur;
    }
    return null;
  };
  const inEffectGen = (n) => {
    for (let cur = n.parent; cur; cur = cur.parent) if (ts.isFunctionExpression(cur) && cur.asteriskToken) return true;
    return false;
  };
  const scanFiles = ['src', 'tests', 'packages', 'apps', 'scripts', 'sync-sources']
    .flatMap((dir) => listFiles(root, dir))
    .filter((f) => /\.(ts|tsx|mts)$/.test(f) && !f.endsWith('.d.ts'))
    .sort();
  for (const f of scanFiles) {
    let s;
    try {
      s = parse(f);
    } catch {
      continue;
    }
    const test = isUsageTest(f);
    const walk = (n) => {
      if (ts.isIdentifier(n) && targets.has(n.text)) {
        const p = n.parent;
        const isCall = (ts.isCallExpression(p) && p.expression === n) ||
          (ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p);
        const isDecl = (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name === n;
        const isImport = ts.isImportSpecifier(p) || ts.isExportSpecifier(p);
        if (!isDecl && !isImport) {
          const u = usage[n.text] ||= { prodAsync: 0, prodSync: 0, prodGen: 0, prodTop: 0, prodRef: 0, test: 0, files: new Set(), syncSites: [], prodSites: [], selfProd: 0, extProd: 0, extFiles: new Set() };
          u.files.add(f);
          if (!test) {
            if (targets.get(n.text).has(f)) u.selfProd += 1;
            else { u.extProd += 1; u.extFiles.add(f); }
          }
          if (test) u.test += 1;
          else if (!isCall) u.prodRef += 1;
          else {
            const fn = enclosingFn(n);
            if (!fn) u.prodTop += 1;
            else if (fn.asteriskToken || inEffectGen(n)) u.prodGen += 1;
            else if (isAsyncFn(fn)) u.prodAsync += 1;
            else { u.prodSync += 1; if (u.syncSites.length < 6) u.syncSites.push(`${f}:${lineOf(s, n)}`); }
            if (u.prodSites.length < 8) u.prodSites.push(`${f}:${lineOf(s, n)}`);
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(s);
  }
  const plain = (u) => u && { ...u, files: u.files.size, extFiles: [...u.extFiles] };
  return (name) => plain(usage[name]);
}

export function audit(root, { usage = false } = {}) {
  const parse = createParser(root);
  const libFiles = listFiles(root, 'src/lib').filter(isLibSource);
  const exportsByFile = {};
  const facades = [];
  const runPromiseByFile = {};
  let effectPromiseTotal = 0;
  let libLines = 0;
  for (const f of libFiles) {
    const s = parse(f);
    libLines += s.text.split('\n').length;
    runPromiseByFile[f] = (s.text.match(/Effect\.runPromise\(/g) || []).length;
    effectPromiseTotal += (s.text.match(/Effect\.(promise|tryPromise)\(/g) || []).length;
    const scanned = scanModule(s, f);
    exportsByFile[f] = scanned.exps;
    facades.push(...scanned.facades);
  }
  const facadeKeys = new Set(facades.map((fc) => `${fc.file}::${fc.name}`));
  const twinPairs = findTwinPairs(exportsByFile, facadeKeys);

  const counts = {};
  const bump = (f, shape) => {
    counts[f] ||= { A: 0, B: 0, C: 0 };
    counts[f][shape] += 1;
  };
  facades.forEach((fc) => bump(fc.file, fc.shape));
  twinPairs.filter((p) => p.shapeC).forEach((p) => bump(p.file, 'C'));

  const result = {
    libFiles: libFiles.length,
    libLines,
    totals: {
      A: facades.filter((fc) => fc.shape === 'A').length,
      B: facades.filter((fc) => fc.shape === 'B').length,
      C: twinPairs.filter((p) => p.shapeC).length,
    },
    counts,
    facades,
    twinPairs,
    runPromiseTotal: Object.values(runPromiseByFile).reduce((a, b) => a + b, 0),
    runPromiseFilesNonZero: Object.values(runPromiseByFile).filter(Boolean).length,
    runPromiseTop: Object.entries(runPromiseByFile).sort((a, b) => b[1] - a[1]).slice(0, 25),
    effectPromiseTotal,
    modules: Object.fromEntries(Object.entries(exportsByFile).map(([f, e]) => [f, {
      effect: e.filter((x) => x.kind === 'effect').length,
      async: e.filter((x) => x.kind === 'async').length,
      sync: e.filter((x) => x.kind === 'sync').length,
      runPromise: runPromiseByFile[f],
    }])),
  };

  if (usage) {
    const targets = new Map();
    const addTarget = (name, file) => {
      if (!targets.has(name)) targets.set(name, new Set());
      targets.get(name).add(file);
    };
    for (const p of twinPairs) [p.twin, p.base].forEach((n) => addTarget(n, p.file));
    for (const fc of facades) [fc.name, fc.callee.split('.').pop()].forEach((n) => addTarget(n, fc.file));
    const use = usageWalk(root, parse, targets);
    result.facades = facades.map((fc) => ({ ...fc, use: use(fc.name), calleeUse: use(fc.callee.split('.').pop()) }));
    result.twinPairs = twinPairs.map((p) => ({ ...p, twinUse: use(p.twin), baseUse: use(p.base) }));
  }
  return result;
}

/** Ratchet rows "<shape> <count> <path>", one per non-zero count, sorted bytewise (LC_ALL=C order). */
export function baselineRows(result) {
  const rows = [];
  for (const [f, c] of Object.entries(result.counts)) {
    for (const shape of ['A', 'B', 'C']) if (c[shape] > 0) rows.push(`${shape} ${c[shape]} ${f}`);
  }
  return rows.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function summary(result) {
  const { A, B, C } = result.totals;
  const modulesWith = (shape) => Object.values(result.counts).filter((c) => c[shape] > 0).length;
  const lines = [
    `Effect boundary audit: ${result.libFiles} src/lib modules, ${result.libLines} lines`,
    `  Shape A (Promise façades): ${A} in ${modulesWith('A')} modules`,
    `  Shape B (sync façades):    ${B} in ${modulesWith('B')} modules`,
    `  Shape C (sync/async twins): ${C} in ${modulesWith('C')} modules`,
    `  Effect.runPromise( calls:  ${result.runPromiseTotal} in ${result.runPromiseFilesNonZero} modules`,
    '',
    'Top modules by façade + twin count:',
  ];
  const ranked = Object.entries(result.counts)
    .map(([f, c]) => [f, c, c.A + c.B + c.C])
    .sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 15);
  for (const [f, c, total] of ranked) lines.push(`  ${String(total).padStart(3)}  A${c.A} B${c.B} C${c.C}  ${f}`);
  lines.push('', 'Rows: --baseline; file:line detail: --json [--usage].');
  return lines.join('\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.usage && opts.mode !== 'json') {
    console.error(`--usage requires --json\n${USAGE}`);
    process.exit(2);
  }
  const result = audit(opts.root, { usage: opts.usage });
  if (opts.mode === 'baseline') {
    const rows = baselineRows(result);
    if (rows.length) process.stdout.write(`${rows.join('\n')}\n`);
  } else if (opts.mode === 'json') {
    process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
  } else {
    console.log(summary(result));
  }
}
