// PAN-3958 CH-9: exact comment stripping for pan-3958-dead-exports.py.
// Reads a JSON array of file paths on stdin and writes a JSON object {path: text} where every
// comment is blanked (newlines kept, so line numbers hold). Comments come from the TypeScript
// parser's own trivia ranges, so regex literals after keywords, nested template literals and
// JSX text are handled exactly. Type positions are left intact (no transpile).
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function scriptKind(path) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.ts') || path.endsWith('.mts') || path.endsWith('.cts')) return ts.ScriptKind.TS;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function strip(path, src) {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.Latest, true, scriptKind(path));
  const ranges = new Map();
  const jsxText = [];
  const add = (found) => {
    for (const r of found ?? []) ranges.set(r.pos, r.end);
  };
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) jsxText.push([node.getFullStart(), node.getEnd()]);
    add(ts.getLeadingCommentRanges(src, node.getFullStart()));
    add(ts.getTrailingCommentRanges(src, node.getEnd()));
    for (const child of node.getChildren(sf)) visit(child);
  };
  visit(sf);
  const inJsxText = (pos) => jsxText.some(([start, end]) => pos >= start && pos < end);
  const chars = src.split('');
  for (const [pos, end] of ranges) {
    if (inJsxText(pos)) continue;
    for (let i = pos; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}

const files = JSON.parse(readFileSync(0, 'utf8'));
const out = {};
for (const path of files) {
  let src;
  try {
    src = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  out[path] = strip(path, src);
}
process.stdout.write(JSON.stringify(out));
