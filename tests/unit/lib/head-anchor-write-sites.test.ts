import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type AnchorField = 'reviewedAtCommit' | 'lastVerifiedCommit' | 'roleRunHead';

interface AnchorWrite {
  file: string;
  field: AnchorField;
  line: number;
}

interface AllowedWriteSite {
  fields: readonly AnchorField[];
  reason: string;
}

const ANCHOR_FIELDS = new Set<AnchorField>([
  'reviewedAtCommit',
  'lastVerifiedCommit',
  'roleRunHead',
]);

const ALLOWED_WRITE_SITES: Record<string, AllowedWriteSite> = {
  'packages/contracts/src/types.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit', 'roleRunHead'],
    reason: 'Wire schemas intentionally remain unbranded strings at serialization boundaries.',
  },
  'src/cli/commands/specialists/done.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'The review verdict CLI stamps the producer-issued workspace snapshot.',
  },
  'src/dashboard/server/read-model.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'The dashboard read model projects persisted status without fabricating an anchor.',
  },
  'src/dashboard/server/routes/specialists/legacy-routes.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'The legacy review verdict route stamps snapshotWorkspaceHeadsPromise output.',
  },
  'src/dashboard/server/routes/workspaces/review-control.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'Review reset explicitly clears the prior anchor with undefined.',
  },
  'src/dashboard/server/routes/workspaces.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'The review status route stamps snapshotWorkspaceHeadsPromise output.',
  },
  'src/lib/agents/agent-state.ts': {
    fields: ['roleRunHead'],
    reason: 'Agent-state deserialization copies the persisted storage value.',
  },
  'src/lib/agents/spawn.ts': {
    fields: ['roleRunHead'],
    reason: 'Role spawn stamps snapshotWorkspaceHeadsPromise output.',
  },
  'src/lib/cloister/deacon-review-status.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'Review recovery stamps snapshotWorkspaceHeadsPromise output.',
  },
  'src/lib/cloister/deacon.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'The deacon logs stored anchors, stamps producer/evaluator output, and clears stale verdicts.',
  },
  'src/lib/cloister/verification-runner.ts': {
    fields: ['lastVerifiedCommit'],
    reason: 'Verification stamps snapshotWorkspaceHeadsPromise output.',
  },
  'src/lib/database/agent-backfill.ts': {
    fields: ['roleRunHead'],
    reason: 'The database backfill maps the storage column name.',
  },
  'src/lib/database/agent-mappers.ts': {
    fields: ['roleRunHead'],
    reason: 'The database mapper serializes the already-stamped runtime value.',
  },
  'src/lib/database/agents-db.ts': {
    fields: ['roleRunHead'],
    reason: 'The database mapper deserializes the persisted runtime value.',
  },
  'src/lib/database/review-status-db.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'The database mapper deserializes persisted review anchors.',
  },
  'src/lib/overdeck/agent-state-sync.ts': {
    fields: ['roleRunHead'],
    reason: 'Agent cache reconciliation copies the persisted runtime value.',
  },
  'src/lib/overdeck/agents.ts': {
    fields: ['roleRunHead'],
    reason: 'Agent cache mapping deserializes the persisted runtime value.',
  },
  'src/lib/overdeck/review-status-record-sync.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'The durable record mirror copies already-validated review anchors.',
  },
  'src/lib/overdeck/review-status-sync.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'Review cache mapping deserializes persisted review anchors.',
  },
  'src/lib/pan-dir/records.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'The durable record writer mirrors already-validated review anchors.',
  },
  'src/lib/pan-dir/verdict-restore.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'Verdict restoration explicitly rehydrates stored strings at the write door.',
  },
  'src/lib/reconstruct/reconstruct-cache.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit', 'roleRunHead'],
    reason: 'Cache reconstruction copies values from durable storage into cache models.',
  },
  'src/lib/reopen.ts': {
    fields: ['reviewedAtCommit'],
    reason: 'Reopening an issue explicitly clears the prior review anchor.',
  },
  'src/lib/review-status.ts': {
    fields: ['reviewedAtCommit', 'lastVerifiedCommit'],
    reason: 'Starting fresh work explicitly clears both review anchors.',
  },
};

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

function violations(writes: AnchorWrite[]): AnchorWrite[] {
  return writes.filter((write) => {
    const allowed = ALLOWED_WRITE_SITES[write.file];
    return !allowed || !allowed.fields.includes(write.field);
  });
}

describe('HeadAnchor write-site inventory', () => {
  it('allows only documented producer, clear, mirror, and deserializer sites', () => {
    const writes = scanRepository();
    expect(violations(writes)).toEqual([]);

    const observed = new Set(writes.map(write => `${write.file}:${write.field}`));
    const allowed = Object.entries(ALLOWED_WRITE_SITES).flatMap(([file, site]) => {
      expect(site.reason.length).toBeGreaterThan(20);
      return site.fields.map(field => `${file}:${field}`);
    });
    expect([...observed].sort()).toEqual(allowed.sort());
  });

  it('flags an unlisted raw-string write with its file and line', () => {
    const writes = scanSource(
      'src/lib/unlisted-anchor-writer.ts',
      "const update = { reviewedAtCommit: 'raw-string' };\n",
    );

    expect(violations(writes)).toEqual([
      { file: 'src/lib/unlisted-anchor-writer.ts', field: 'reviewedAtCommit', line: 1 },
    ]);
  });
});
