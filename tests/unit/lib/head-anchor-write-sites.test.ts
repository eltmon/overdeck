import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type AnchorField = 'reviewedAtCommit' | 'lastVerifiedCommit' | 'roleRunHead';

interface AnchorWrite {
  file: string;
  field: AnchorField;
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
  expression: string,
  reason: string,
): AllowedWriteSite {
  return { file, field, expression, reason };
}

// Stable audit identity: file + field + normalized AST expression. Source lines
// are deliberately excluded, while the full-array comparison preserves counts.
const ALLOWED_WRITE_SITES: AllowedWriteSite[] = [
  allow('src/cli/commands/specialists/done.ts', 'reviewedAtCommit', 'update.reviewedAtCommit = workspaceHead', 'Producer-fed passed review verdict CLI stamp.'),
  allow('src/cli/commands/specialists/done.ts', 'reviewedAtCommit', 'reviewedAtCommit', 'Producer-fed blocked review verdict CLI stamp after feedback delivery.'),
  allow('src/dashboard/server/read-model.ts', 'reviewedAtCommit', 'reviewedAtCommit: status.reviewedAtCommit || undefined', 'Read-model projection of persisted status.'),
  allow('src/dashboard/server/routes/specialists/legacy-routes.ts', 'reviewedAtCommit', 'reviewedAtCommit: headAnchor', 'Producer-fed passed legacy review verdict stamp.'),
  allow('src/dashboard/server/routes/specialists/legacy-routes.ts', 'reviewedAtCommit', 'reviewedAtCommit', 'Producer-fed blocked legacy review verdict stamp after feedback delivery.'),
  allow('src/dashboard/server/routes/workspaces/review-control.ts', 'reviewedAtCommit', 'reviewedAtCommit: undefined', 'Explicit review-reset clear.'),
  allow('src/dashboard/server/routes/workspaces.ts', 'reviewedAtCommit', 'update.reviewedAtCommit = headAnchor', 'Producer-fed review status route stamp.'),
  allow('src/lib/agents/agent-state.ts', 'roleRunHead', 'roleRunHead: raw.roleRunHead', 'Agent-state storage deserialization.'),
  allow('src/lib/agents/spawn.ts', 'roleRunHead', 'state.roleRunHead = headAnchor', 'Producer-fed role-run stamp.'),
  allow('src/lib/cloister/deacon-review-signals.ts', 'reviewedAtCommit', 'reviewedAtCommit: fallbackHead', 'Producer-fed blocked fallback-synthesis review stamp.'),
  allow('src/lib/cloister/deacon-review-status.ts', 'reviewedAtCommit', "reviewUpdate['reviewedAtCommit'] = await snapshotWorkspaceHeadsPromise(issueId, workspacePath)", 'Producer-fed review recovery stamp.'),
  allow('src/lib/cloister/deacon.ts', 'reviewedAtCommit', 'reviewedAtCommit: status.reviewedAtCommit', 'Diagnostic nudge payload mirrors persisted status.'),
  allow('src/lib/cloister/deacon.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: status.lastVerifiedCommit', 'Diagnostic nudge payload mirrors persisted status.'),
  allow('src/lib/cloister/review-verdict-writer.ts', 'reviewedAtCommit', 'reviewedAtCommit: input.evidenceHead as HeadAnchor', 'Anchor-match verdict preserves the already-verified evidence anchor.'),
  allow('src/lib/cloister/review-verdict-writer.ts', 'reviewedAtCommit', 'reviewedAtCommit: input.evidenceHead as HeadAnchor', 'Verdict write door persists the producer-issued evidence anchor after freshness classification.'),
  allow('src/lib/cloister/deacon-post-review-commits.ts', 'reviewedAtCommit', 'reviewedAtCommit: verdict.currentAnchor', 'Drift evaluator advances a proven-benign anchor.'),
  allow('src/lib/cloister/deacon-post-review-commits.ts', 'reviewedAtCommit', 'reviewedAtCommit: undefined', 'Explicit blocked-review stale anchor clear before re-dispatch.'),
  allow('src/lib/cloister/deacon-post-review-commits.ts', 'reviewedAtCommit', 'reviewedAtCommit: undefined', 'Explicit passed-review stale anchor clear before re-dispatch.'),
  allow('src/dashboard/server/routes/workspaces/merge-strike.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: verifiedAnchor', 'Producer-fed CI-green merge verification stamp (PAN-3067).'),
  allow('src/lib/cloister/uat-promote-verification.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: rehydrateHeadAnchor(member.headSha)', 'UAT member HEAD rehydrated at the generation-record boundary (PAN-3114).'),
  allow('src/lib/cloister/verification-runner.ts', 'lastVerifiedCommit', 'lastVerifiedCommit', 'Producer-fed verification stamp.'),
  allow('src/lib/database/agent-backfill.ts', 'roleRunHead', "roleRunHead: 'role_run_head'", 'Database backfill column mapping.'),
  allow('src/lib/database/agent-mappers.ts', 'roleRunHead', 'roleRunHead: state.roleRunHead ?? null', 'Agent runtime serialization.'),
  allow('src/lib/database/agents-db.ts', 'roleRunHead', "roleRunHead: (row['role_run_head'] as string | null) ?? null", 'Agent runtime deserialization.'),
  allow('src/lib/database/review-status-db.ts', 'reviewedAtCommit', 'reviewedAtCommit: row.reviewed_at_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/database/review-status-db.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: row.last_verified_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/overdeck/agent-state-sync.ts', 'roleRunHead', 'roleRunHead: row.role_run_head ?? undefined', 'Agent cache reconciliation.'),
  allow('src/lib/overdeck/agent-state-sync.ts', 'roleRunHead', 'roleRunHead: state.roleRunHead', 'Host-recorded run anchor projection for stale journal validation.'),
  allow('src/lib/overdeck/agents.ts', 'roleRunHead', "roleRunHead: (row['role_run_head'] as string | null) ?? null", 'Agent cache deserialization.'),
  allow('src/lib/overdeck/review-status-record-sync.ts', 'reviewedAtCommit', 'reviewedAtCommit: p.reviewedAtCommit', 'Durable record mirror of validated status.'),
  allow('src/lib/overdeck/review-status-record-sync.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: p.lastVerifiedCommit', 'Durable record mirror of validated status.'),
  allow('src/lib/overdeck/review-status-sync.ts', 'reviewedAtCommit', 'reviewedAtCommit: row.reviewed_at_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/overdeck/review-status-sync.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: row.last_verified_commit ?? undefined', 'Review cache deserialization.'),
  allow('src/lib/pan-dir/records.ts', 'reviewedAtCommit', 'reviewedAtCommit: status.reviewedAtCommit', 'Durable record serialization of validated status.'),
  allow('src/lib/pan-dir/records.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: status.lastVerifiedCommit', 'Durable record serialization of validated status.'),
  allow('src/lib/pan-dir/verdict-restore.ts', 'reviewedAtCommit', 'reviewedAtCommit: pipeline.reviewedAtCommit ? rehydrateHeadAnchor(pipeline.reviewedAtCommit) : undefined', 'Explicit durable-record rehydration.'),
  allow('src/lib/pan-dir/verdict-restore.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: pipeline.lastVerifiedCommit ? rehydrateHeadAnchor(pipeline.lastVerifiedCommit) : undefined', 'Explicit durable-record rehydration.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'roleRunHead', 'roleRunHead: state.roleRunHead || undefined', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'reviewedAtCommit', 'reviewedAtCommit: pipeline.reviewedAtCommit', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: pipeline.lastVerifiedCommit', 'Cache reconstruction from durable state.'),
  allow('src/lib/reconstruct/reconstruct-cache.ts', 'roleRunHead', 'roleRunHead: agent.roleRunHead ?? undefined', 'Cache reconstruction from agent storage.'),
  allow('src/lib/reopen.ts', 'reviewedAtCommit', 'reviewedAtCommit: undefined', 'Explicit reopen clear.'),
  allow('src/lib/review-status.ts', 'reviewedAtCommit', 'reviewedAtCommit: undefined', 'Explicit work-start clear.'),
  allow('src/lib/review-status.ts', 'reviewedAtCommit', 'reviewedAtCommit: status.reviewedAtCommit as HeadAnchor | undefined', 'Verdict-preservation adapter supplies a branded review anchor.'),
  allow('src/lib/review-status.ts', 'reviewedAtCommit', 'reviewedAtCommit: anchor', 'Verdict-preservation adapter advances a proven-benign review anchor.'),
  allow('src/lib/review-status.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: undefined', 'Explicit work-start clear.'),
  allow('packages/contracts/src/types.ts', 'roleRunHead', 'roleRunHead: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
  allow('packages/contracts/src/types.ts', 'reviewedAtCommit', 'reviewedAtCommit: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
  allow('packages/contracts/src/types.ts', 'lastVerifiedCommit', 'lastVerifiedCommit: Schema.optional(Schema.String)', 'Unbranded wire schema boundary.'),
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
    `${left.file}:${left.field}:${left.expression}`.localeCompare(
      `${right.file}:${right.field}:${right.expression}`,
    ),
  );
}

describe('HeadAnchor write-site inventory', () => {
  it('locks every documented write occurrence and source expression', () => {
    const writes = scanRepository();
    expect(violations(writes)).toEqual([]);
    expect(sortWrites(writes)).toEqual(sortWrites(withoutReasons(ALLOWED_WRITE_SITES)));
    for (const site of ALLOWED_WRITE_SITES) expect(site.reason.length).toBeGreaterThan(15);
  });

  it('flags a raw write without coupling the legitimate allowance to source lines', () => {
    const file = 'src/lib/agents/spawn.ts';
    const writes = scanSource(
      file,
      "// unrelated edit shifts the write\n\nconst headAnchor = producer();\nstate.roleRunHead = headAnchor;\nstate.roleRunHead = 'raw-string';\n",
    );
    const allowed = [allow(
      file,
      'roleRunHead',
      'state.roleRunHead = headAnchor',
      'Fixture producer-fed write.',
    )];

    expect(violations(writes, allowed)).toEqual([{
      file,
      field: 'roleRunHead',
      expression: "state.roleRunHead = 'raw-string'",
    }]);
  });
});
