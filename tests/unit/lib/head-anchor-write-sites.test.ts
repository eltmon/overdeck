import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type AnchorField = 'reviewedAtCommit' | 'lastVerifiedCommit' | 'roleRunHead';

interface AnchorWrite {
  file: string;
  field: AnchorField;
  line: number;
  expression: string;
}

interface AllowedWriteSite extends AnchorWrite {
  reason: string;
}

const ANCHOR_FIELDS = new Set<AnchorField>([
  'reviewedAtCommit',
  'lastVerifiedCommit',
  'roleRunHead',
]);

function allow(
  file: string,
  field: AnchorField,
  line: number,
  expression: string,
  reason: string,
): AllowedWriteSite {
  return { file, field, line, expression, reason };
}

const ALLOWED_WRITE_SITES: AllowedWriteSite[] = [
  allow('src/cli/commands/specialists/done.ts', 'reviewedAtCommit', 159, 'update.reviewedAtCommit = workspaceHead', 'Producer-fed review verdict CLI stamp.'),
  allow('src/dashboard/server/read-model.ts', 'reviewedAtCommit', 336, 'reviewedAtCommit: status.reviewedAtCommit || undefined', 'Read-model projection of persisted status.'),
  allow('src/dashboard/server/routes/specialists/legacy-routes.ts', 'reviewedAtCommit', 304, 'reviewedAtCommit: headAnchor', 'Producer-fed legacy review verdict stamp.'),
  allow('src/dashboard/server/routes/workspaces/review-control.ts', 'reviewedAtCommit', 283, 'reviewedAtCommit: undefined', 'Explicit review-reset clear.'),
  allow('src/dashboard/server/routes/workspaces.ts', 'reviewedAtCommit', 1466, 'update.reviewedAtCommit = headAnchor', 'Producer-fed review status route stamp.'),
  allow('src/lib/agents/agent-state.ts', 'roleRunHead', 246, 'roleRunHead: raw.roleRunHead', 'Agent-state storage deserialization.'),
  allow('src/lib/agents/spawn.ts', 'roleRunHead', 470, 'state.roleRunHead = headAnchor', 'Producer-fed role-run stamp.'),
  allow('src/lib/cloister/deacon-review-status.ts', 'reviewedAtCommit', 544, "reviewUpdate['reviewedAtCommit'] = await snapshotWorkspaceHeadsPromise(issueId, workspacePath)", 'Producer-fed review recovery stamp.'),
  allow('src/lib/cloister/deacon.ts', 'reviewedAtCommit', 1336, 'reviewedAtCommit: status.reviewedAtCommit', 'Diagnostic nudge payload mirrors persisted status.'),
  allow('src/lib/cloister/deacon.ts', 'lastVerifiedCommit', 1337, 'lastVerifiedCommit: status.lastVerifiedCommit', 'Diagnostic nudge payload mirrors persisted status.'),
  allow('src/lib/cloister/deacon.ts', 'reviewedAtCommit', 1535, 'reviewedAtCommit', 'Producer-fed verification-bypass stamp.'),
  allow('src/lib/cloister/deacon.ts', 'reviewedAtCommit', 1606, 'reviewedAtCommit: verdict.currentAnchor', 'Drift evaluator advances a proven-benign anchor.'),
  allow('src/lib/cloister/deacon.ts', 'reviewedAtCommit', 1622, 'reviewedAtCommit: undefined', 'Explicit stale-review clear.'),
  allow('src/lib/cloister/verification-runner.ts', 'lastVerifiedCommit', 892, 'lastVerifiedCommit', 'Producer-fed verification stamp.'),
  allow('src/lib/database/agent-backfill.ts', 'roleRunHead', 73, "roleRunHead: 'role_run_head'", 'Database backfill column mapping.'),
  allow('src/lib/database/agent-mappers.ts', 'roleRunHead', 49, 'roleRunHead: state.roleRunHead ?? null', 'Agent runtime serialization.'),
  allow('src/lib/database/agents-db.ts', 'roleRunHead', 104, "roleRunHead: (row['role_run_head'] as string | null) ?? null", 'Agent runtime deserialization.'),
  allow('src/lib/database/review-status-db.ts', 'reviewedAtCommit', 479, 'reviewedAtCommit: row.reviewed_at_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/database/review-status-db.ts', 'lastVerifiedCommit', 489, 'lastVerifiedCommit: row.last_verified_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/overdeck/agent-state-sync.ts', 'roleRunHead', 171, 'roleRunHead: row.role_run_head ?? undefined', 'Agent cache reconciliation.'),
  allow('src/lib/overdeck/agents.ts', 'roleRunHead', 1099, "roleRunHead: (row['role_run_head'] as string | null) ?? null", 'Agent cache deserialization.'),
  allow('src/lib/overdeck/review-status-record-sync.ts', 'reviewedAtCommit', 121, 'reviewedAtCommit: p.reviewedAtCommit', 'Durable record mirror of validated status.'),
  allow('src/lib/overdeck/review-status-record-sync.ts', 'lastVerifiedCommit', 122, 'lastVerifiedCommit: p.lastVerifiedCommit', 'Durable record mirror of validated status.'),
  allow('src/lib/overdeck/review-status-sync.ts', 'reviewedAtCommit', 115, 'reviewedAtCommit: row.reviewed_at_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/overdeck/review-status-sync.ts', 'lastVerifiedCommit', 127, 'lastVerifiedCommit: row.last_verified_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/pan-dir/records.ts', 'reviewedAtCommit', 124, 'reviewedAtCommit: status.reviewedAtCommit', 'Durable record serialization of validated status.'),
  allow('src/lib/pan-dir/records.ts', 'lastVerifiedCommit', 125, 'lastVerifiedCommit: status.lastVerifiedCommit', 'Durable record serialization of validated status.'),
  allow('src/lib/pan-dir/verdict-restore.ts', 'reviewedAtCommit', 64, 'reviewedAtCommit: pipeline.reviewedAtCommit ? rehydrateHeadAnchor(pipeline.reviewedAtCommit) : undefined', 'Explicit durable-record rehydration.'),
  allow('src/lib/pan-dir/verdict-restore.ts', 'lastVerifiedCommit', 68, 'lastVerifiedCommit: pipeline.lastVerifiedCommit ? rehydrateHeadAnchor(pipeline.lastVerifiedCommit) : undefined', 'Explicit durable-record rehydration.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'roleRunHead', 88, 'roleRunHead: state.roleRunHead || undefined', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'reviewedAtCommit', 200, 'reviewedAtCommit: pipeline.reviewedAtCommit', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'lastVerifiedCommit', 201, 'lastVerifiedCommit: pipeline.lastVerifiedCommit', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'roleRunHead', 330, 'roleRunHead: agent.roleRunHead ?? undefined', 'Cache reconstruction from agent storage.'),
  allow('src/lib/reopen.ts', 'reviewedAtCommit', 78, 'reviewedAtCommit: undefined', 'Explicit reopen clear.'),
  allow('src/lib/review-status.ts', 'reviewedAtCommit', 640, 'reviewedAtCommit: undefined', 'Explicit work-start clear.'),
  allow('src/lib/review-status.ts', 'lastVerifiedCommit', 641, 'lastVerifiedCommit: undefined', 'Explicit work-start clear.'),
  allow('packages/contracts/src/types.ts', 'roleRunHead', 304, 'roleRunHead: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
  allow('packages/contracts/src/types.ts', 'reviewedAtCommit', 381, 'reviewedAtCommit: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
  allow('packages/contracts/src/types.ts', 'lastVerifiedCommit', 383, 'lastVerifiedCommit: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
];

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
  return undefined;
}

function scanSource(file: string, source: string): AnchorWrite[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const writes: AnchorWrite[] = [];

  function record(node: ts.Node, field: string | undefined): void {
    if (!field || !ANCHOR_FIELDS.has(field as AnchorField)) return;
    writes.push({
      file,
      field: field as AnchorField,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      expression: node.getText(sourceFile).replace(/\s+/g, ' '),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      record(node, propertyName(node.name));
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (ts.isPropertyAccessExpression(node.left)) {
        record(node, node.left.name.text);
      } else if (ts.isElementAccessExpression(node.left) && ts.isStringLiteral(node.left.argumentExpression)) {
        record(node, node.left.argumentExpression.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return writes;
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(path);
    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });
}

function scanRepository(): AnchorWrite[] {
  const root = process.cwd();
  const files = [
    ...sourceFiles(join(root, 'src')),
    join(root, 'packages', 'contracts', 'src', 'types.ts'),
  ];
  return files.flatMap((file) => scanSource(
    relative(root, file).replaceAll('\\', '/'),
    readFileSync(file, 'utf-8'),
  ));
}

function sameWrite(left: AnchorWrite, right: AnchorWrite): boolean {
  return left.file === right.file
    && left.field === right.field
    && left.line === right.line
    && left.expression === right.expression;
}

function violations(
  writes: AnchorWrite[],
  allowed: readonly AllowedWriteSite[] = ALLOWED_WRITE_SITES,
): AnchorWrite[] {
  return writes.filter(write => !allowed.some(site => sameWrite(write, site)));
}

function withoutReasons(sites: readonly AllowedWriteSite[]): AnchorWrite[] {
  return sites.map(({ reason: _reason, ...write }) => write);
}

function sortWrites(writes: AnchorWrite[]): AnchorWrite[] {
  return [...writes].sort((left, right) =>
    `${left.file}:${left.line}:${left.field}`.localeCompare(`${right.file}:${right.line}:${right.field}`),
  );
}

describe('HeadAnchor write-site inventory', () => {
  it('locks every documented write occurrence, source expression, and location', () => {
    const writes = scanRepository();
    expect(violations(writes)).toEqual([]);
    expect(sortWrites(writes)).toEqual(sortWrites(withoutReasons(ALLOWED_WRITE_SITES)));
    for (const site of ALLOWED_WRITE_SITES) expect(site.reason.length).toBeGreaterThan(15);
  });

  it('flags a raw write added beside a legitimate write in an allowlisted file', () => {
    const file = 'src/lib/agents/spawn.ts';
    const writes = scanSource(
      file,
      "const headAnchor = producer();\nstate.roleRunHead = headAnchor;\nstate.roleRunHead = 'raw-string';\n",
    );
    const allowed = [allow(
      file,
      'roleRunHead',
      2,
      'state.roleRunHead = headAnchor',
      'Fixture producer-fed write.',
    )];

    expect(violations(writes, allowed)).toEqual([{
      file,
      field: 'roleRunHead',
      line: 3,
      expression: "state.roleRunHead = 'raw-string'",
    }]);
  });
});
