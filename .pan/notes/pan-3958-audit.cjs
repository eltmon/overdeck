// PAN-3958 audit: Effect facades, sync/async twins, runPromise density, module classification.
// Run from the repo root (needs node_modules/typescript): node .pan/notes/pan-3958-audit.cjs > /tmp/pan-3958.json
// Output keys: facades (Shape A = Effect.promise/tryPromise, Shape B = Effect.sync/try), twinPairs, modules, runPromise*.
const ts = require(require.resolve('typescript', { paths: [process.cwd()] }));
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const all = execSync("git ls-files '*.ts' '*.tsx' '*.mts'", { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n').filter(Boolean).filter(f => !f.includes('node_modules'));
const isTest = f => /(^|\/)(tests?|__tests__|e2e)\//.test(f) || /\.(test|spec)\.tsx?$/.test(f);
const libFiles = all.filter(f => f.startsWith('src/lib/') && !isTest(f) && !f.endsWith('.d.ts'));

const sfCache = new Map();
function sf(f) {
  if (!sfCache.has(f)) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    sfCache.set(f, ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
  }
  return sfCache.get(f);
}
const line = (s, n) => s.getLineAndCharacterOfPosition(n.getStart(s)).line + 1;
const isExported = n => (ts.getCombinedModifierFlags(n) & ts.ModifierFlags.Export) !== 0;

// Classify an exported function-like into effect|async|sync.
function classifyFn(s, node, typeNode, body, isAsync) {
  const rt = typeNode ? typeNode.getText(s) : '';
  if (/^Effect\.Effect</.test(rt) || /^Effect</.test(rt)) return 'effect';
  if (isAsync || /^Promise</.test(rt)) return 'async';
  if (body) {
    let expr = body;
    if (ts.isBlock(body)) {
      const ret = body.statements.find(st => ts.isReturnStatement(st));
      const lastRet = [...body.statements].reverse().find(st => ts.isReturnStatement(st));
      expr = (lastRet || ret) ? (lastRet || ret).expression : null;
    }
    if (expr) {
      const t = expr.getText(s);
      if (/^Effect\.(gen|promise|tryPromise|sync|try|succeed|fail|fn|suspend|void|andThen|map|flatMap|forEach|all|catch|scoped|acquireRelease)\b/.test(t) || /^Effect\.fn\b/.test(t) || /\.pipe\(/.test(t) && /Effect\./.test(t)) return 'effect';
      if (/^new Promise\b/.test(t) || /^Promise\./.test(t)) return 'async';
    }
  }
  return 'sync';
}

// Facade: returned expression is Effect.promise(() => call(...)) / Effect.tryPromise({try: () => call(...)}) where callee is in-repo.
function span(s, node) {
  const full = node.getFullStart();
  const start = s.getLineAndCharacterOfPosition(full).line;
  const end = s.getLineAndCharacterOfPosition(node.getEnd()).line;
  return end - start + 1;
}
function facadeCallee(s, body, localNames, importedRel) {
  if (!body) return null;
  let expr = body;
  if (ts.isBlock(body)) {
    if (body.statements.length !== 1 || !ts.isReturnStatement(body.statements[0])) return null;
    expr = body.statements[0].expression;
  }
  if (!expr || !ts.isCallExpression(expr)) return null;
  const callee = expr.expression.getText(s);
  let thunk = null;
  if (callee === 'Effect.promise' || callee === 'Effect.sync') thunk = expr.arguments[0];
  else if (callee === 'Effect.tryPromise' || callee === 'Effect.try') {
    const a = expr.arguments[0];
    if (a && ts.isObjectLiteralExpression(a)) {
      const p = a.properties.find(p => p.name && p.name.getText(s) === 'try');
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
  const inRepo = localNames.has(base) || importedRel.has(base);
  return inRepo ? { name, via: callee } : null;
}

const exportsByFile = {}; // file -> [{name, kind, line}]
const facades = [];
const runPromiseByFile = {};
const effectPromiseByFile = {};
for (const f of libFiles) {
  const s = sf(f);
  const text = s.text;
  runPromiseByFile[f] = (text.match(/Effect\.runPromise\(/g) || []).length;
  effectPromiseByFile[f] = (text.match(/Effect\.(promise|tryPromise)\(/g) || []).length;
  const localNames = new Set();
  const importedRel = new Set();
  const exps = [];
  for (const st of s.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text.startsWith('.')) {
      const nb = st.importClause && st.importClause.namedBindings;
      if (st.importClause && st.importClause.name) importedRel.add(st.importClause.name.text);
      if (nb && ts.isNamedImports(nb)) nb.elements.forEach(e => importedRel.add(e.name.text));
      if (nb && ts.isNamespaceImport(nb)) importedRel.add(nb.name.text);
    }
    if (ts.isFunctionDeclaration(st) && st.name) localNames.add(st.name.text);
    if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach(d => ts.isIdentifier(d.name) && localNames.add(d.name.text));
  }
  for (const st of s.statements) {
    if (ts.isFunctionDeclaration(st) && st.name && isExported(st)) {
      const isAsync = !!(st.modifiers || []).find(m => m.kind === ts.SyntaxKind.AsyncKeyword);
      const kind = classifyFn(s, st, st.type, st.body, isAsync);
      const fc = facadeCallee(s, st.body, localNames, importedRel);
      exps.push({ name: st.name.text, kind, line: line(s, st) });
      if (fc) facades.push({ file: f, line: line(s, st), name: st.name.text, callee: fc.name, via: fc.via, span: span(s, st) });
    } else if (ts.isVariableStatement(st) && isExported(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          const isAsync = !!(init.modifiers || []).find(m => m.kind === ts.SyntaxKind.AsyncKeyword);
          const kind = classifyFn(s, init, init.type || (d.type), init.body, isAsync);
          const fc = facadeCallee(s, init.body, localNames, importedRel);
          exps.push({ name: d.name.text, kind, line: line(s, d) });
          if (fc) facades.push({ file: f, line: line(s, d), name: d.name.text, callee: fc.name, via: fc.via, span: span(s, st) });
        } else if (init && /^Effect\.fn\b/.test(init.getText(s))) {
          exps.push({ name: d.name.text, kind: 'effect', line: line(s, d) });
        }
      }
    }
  }
  exportsByFile[f] = exps;
}

// twin pairs
const twinPairs = [];
for (const [f, exps] of Object.entries(exportsByFile)) {
  const names = new Map(exps.map(e => [e.name, e]));
  for (const e of exps) {
    const n = e.name;
    let m;
    if ((m = n.match(/^(.+)Sync$/)) && names.has(m[1])) twinPairs.push({ file: f, kind: 'Sync', base: m[1], twin: n, baseKind: names.get(m[1]).kind, line: e.line });
    if ((m = n.match(/^(.+)Async$/)) && names.has(m[1])) twinPairs.push({ file: f, kind: 'Async', base: m[1], twin: n, baseKind: names.get(m[1]).kind, twinKind: e.kind, line: e.line });
    if ((m = n.match(/^(.+)Promise$/)) && names.has(m[1])) twinPairs.push({ file: f, kind: 'Promise', base: m[1], twin: n, baseKind: names.get(m[1]).kind, line: e.line });
    if ((m = n.match(/^(.+)Effect$/)) && names.has(m[1])) twinPairs.push({ file: f, kind: 'Effect', base: m[1], twin: n, baseKind: names.get(m[1]).kind, line: e.line });
  }
}

// Consumers: callers of each twin name across repo, classified by enclosing function async-ness.
const targets = new Map(); // name -> list of def files
for (const p of twinPairs) for (const n of [p.twin, p.base]) { if (!targets.has(n)) targets.set(n, new Set()); targets.get(n).add(p.file); }
for (const fc of facades) for (const n of [fc.name, fc.callee.split('.').pop()]) { if (!targets.has(n)) targets.set(n, new Set()); targets.get(n).add(fc.file); }
const usage = {}; // name -> {prodAsync, prodSync, prodTop, test, files:Set}
function enclosingFn(n) {
  let cur = n.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur) || ts.isArrowFunction(cur) || ts.isMethodDeclaration(cur) || ts.isGetAccessor(cur) || ts.isConstructorDeclaration(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}
function inEffectGen(n) {
  let cur = n.parent;
  while (cur) {
    if (ts.isFunctionExpression(cur) && cur.asteriskToken) return true;
    cur = cur.parent;
  }
  return false;
}
const scanFiles = all.filter(f => !f.endsWith('.d.ts') && /^(src|tests|packages|apps|scripts|sync-sources)\//.test(f));
for (const f of scanFiles) {
  let s;
  try { s = sf(f); } catch { continue; }
  const txt = s.text;
  // cheap prefilter
  const walk = n => {
    if (ts.isIdentifier(n) && targets.has(n.text)) {
      const p = n.parent;
      const isCall = (ts.isCallExpression(p) && p.expression === n) || (ts.isPropertyAccessExpression(p) && p.name === n && ts.isCallExpression(p.parent) && p.parent.expression === p);
      const isDecl = (ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name === n;
      const isImport = ts.isImportSpecifier(p) || ts.isExportSpecifier(p);
      if (!isDecl && !isImport) {
        const u = usage[n.text] || (usage[n.text] = { prodAsync: 0, prodSync: 0, prodGen: 0, prodTop: 0, prodRef: 0, test: 0, files: new Set(), syncSites: [], prodSites: [], selfProd: 0, extProd: 0, extFiles: new Set() });
        const defFiles = targets.get(n.text);
        u.files.add(f);
        if (!isTest(f)) { if (defFiles.has(f)) u.selfProd++; else { u.extProd++; u.extFiles.add(f); } }
        if (isTest(f)) u.test++;
        else if (!isCall) u.prodRef++;
        else {
          const fn = enclosingFn(n);
          if (!fn) u.prodTop++;
          else if (fn.asteriskToken || inEffectGen(n)) u.prodGen++;
          else if ((fn.modifiers || []).some(m => m.kind === ts.SyntaxKind.AsyncKeyword)) u.prodAsync++;
          else { u.prodSync++; if (u.syncSites.length < 6) u.syncSites.push(`${f}:${line(s, n)}`); }
          if (u.prodSites.length < 8) u.prodSites.push(`${f}:${line(s, n)}`);
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  if ([...targets.keys()].some(() => true)) walk(s);
}

const out = {
  libFiles: libFiles.length,
  libLines: libFiles.reduce((a, f) => a + sf(f).text.split('\n').length, 0),
  facades: facades.map(fc => ({ ...fc, use: usage[fc.name] && { ...usage[fc.name], files: usage[fc.name].files.size, extFiles: [...usage[fc.name].extFiles] }, calleeUse: usage[fc.callee.split('.').pop()] && { ...usage[fc.callee.split('.').pop()], files: usage[fc.callee.split('.').pop()].files.size, extFiles: [...usage[fc.callee.split('.').pop()].extFiles] } })),
  runPromiseTotal: Object.values(runPromiseByFile).reduce((a, b) => a + b, 0),
  runPromiseFilesNonZero: Object.values(runPromiseByFile).filter(Boolean).length,
  runPromiseTop: Object.entries(runPromiseByFile).sort((a, b) => b[1] - a[1]).slice(0, 25),
  effectPromiseTotal: Object.values(effectPromiseByFile).reduce((a, b) => a + b, 0),
  twinPairs: twinPairs.map(p => ({ ...p, twinUse: usage[p.twin] && { ...usage[p.twin], files: usage[p.twin].files.size, extFiles: [...usage[p.twin].extFiles] }, baseUse: usage[p.base] && { ...usage[p.base], files: usage[p.base].files.size, extFiles: [...usage[p.base].extFiles] } })),
  modules: Object.fromEntries(Object.entries(exportsByFile).map(([f, e]) => [f, { effect: e.filter(x => x.kind === 'effect').length, async: e.filter(x => x.kind === 'async').length, sync: e.filter(x => x.kind === 'sync').length, runPromise: runPromiseByFile[f] }])),
};
process.stdout.write(JSON.stringify(out, null, 1));
