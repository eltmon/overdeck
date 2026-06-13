/**
 * Tests for the stub-UI scanner (PAN-1500).
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanStubUi } from '../lint-stub-ui.js';

const gitConfig = [
  '-c', 'user.email=test@example.com',
  '-c', 'user.name=Test User',
];

function git(workspace: string, ...args: string[]) {
  const result = spawnSync('git', [...gitConfig, ...args], {
    cwd: workspace,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? result.stdout}`);
  }
}

function setupRepo(workspace: string) {
  git(workspace, 'init');
  git(workspace, 'commit', '--allow-empty', '-m', 'initial');
}

function commitFile(workspace: string, relPath: string, content: string) {
  const full = join(workspace, relPath);
  mkdirSync(full.slice(0, full.lastIndexOf('/')), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  git(workspace, 'add', relPath);
  git(workspace, 'commit', '-m', `add ${relPath}`);
}

describe('scanStubUi source constraints', () => {
  it('uses execAsync only — no execSync or readFileSync', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/cloister/lint-stub-ui.ts'), 'utf-8');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('readFileSync');
  });
});

describe('scanStubUi PAN-1389 fixture', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-pan-1389-'));
    setupRepo(workspace);

    const base = `src/dashboard/frontend/src/components/Inspector/ExistingTab.tsx`;
    commitFile(
      workspace,
      base,
      `export function ExistingTab() {\n  const items = useItems();\n  return <div>{items.length} items</div>;\n}\n`,
    );

    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/FilesTab.tsx',
      [
        `export function FilesTab() {`,
        `  const files = useFiles();`,
        `  return (`,
        `    <div>`,
        `      {files.length === 0 ? <p>Coming soon</p> : files.map(f => <p key={f.id}>{f.name}</p>)}`,
        `    </div>`,
        `  );`,
        `}`,
        ``,
        `function useFiles() {`,
        `  return [];`,
        `}`,
      ].join('\n') + '\n',
    );

    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/CommentsTab.tsx',
      [
        `export function CommentsTab() {`,
        `  const comments = useComments();`,
        `  return <div>{comments.length} comments</div>;`,
        `}`,
        ``,
        `function useComments() {`,
        `  return null;`,
        `}`,
      ].join('\n') + '\n',
    );
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('flags the empty-array-return pattern in FilesTab', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~2');
    const filesTabFindings = findings.filter(f => f.filePath.includes('FilesTab.tsx'));
    expect(filesTabFindings.some(f => f.patternId === 'empty-array-return')).toBe(true);
  });

  it('flags the coming-soon-copy pattern in FilesTab', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~2');
    expect(findings.some(f => f.patternId === 'coming-soon-copy' && f.filePath.includes('FilesTab.tsx'))).toBe(true);
  });

  it('flags the null-return pattern in CommentsTab', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~2');
    const commentsTabFindings = findings.filter(f => f.filePath.includes('CommentsTab.tsx'));
    expect(commentsTabFindings.some(f => f.patternId === 'null-return')).toBe(true);
  });

  it('produces findings for both stub files', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~2');
    expect(findings.some(f => f.filePath.includes('FilesTab.tsx'))).toBe(true);
    expect(findings.some(f => f.filePath.includes('CommentsTab.tsx'))).toBe(true);
  });
});

describe('scanStubUi PAN-1231 fixture', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-pan-1231-'));
    setupRepo(workspace);

    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Fleet/FleetAgentsView.tsx',
      [
        `export function FleetAgentsView() {`,
        `  const [mode, setMode] = useState('table');`,
        `  return (`,
        `    <SegmentedControl value={mode} onChange={() => {}}>`,
        `      <SegmentedControl.Item value="table" label="Table" />`,
        `      <SegmentedControl.Item value="timeline" label="Timeline" />`,
        `    </SegmentedControl>`,
        `  );`,
        `}`,
      ].join('\n') + '\n',
    );
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('flags the segmented-control no-op onChange handler', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~1');
    expect(findings.some(f => f.patternId === 'segmented-control-noop')).toBe(true);
  });

  it('records a finding in FleetAgentsView.tsx', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~1');
    expect(findings.some(f => f.filePath.includes('FleetAgentsView.tsx'))).toBe(true);
  });
});

describe('scanStubUi negative cases', () => {
  let workspace = '';

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'pan-1500-negative-'));
    setupRepo(workspace);

    commitFile(
      workspace,
      'src/dashboard/frontend/src/components/Inspector/RealTab.tsx',
      [
        `export function RealTab() {`,
        `  const { data } = useFetch('/api/items');`,
        `  if (!data) return <div>Loading…</div>;`,
        `  return <div>{data.map(item => <span key={item.id}>{item.name}</span>)}</div>;`,
        `}`,
      ].join('\n') + '\n',
    );
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('returns zero findings for a tab with real data and non-empty render', async () => {
    const findings = await scanStubUi(workspace, 'HEAD~1');
    expect(findings).toEqual([]);
  });
});

describe('scanStubUi failure modes', () => {
  it('returns an empty array when the workspace is not a git repo', async () => {
    const notARepo = mkdtempSync(join(tmpdir(), 'pan-1500-not-repo-'));
    try {
      const findings = await scanStubUi(notARepo, 'main');
      expect(findings).toEqual([]);
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });

  it('returns an empty array when the diff base does not exist', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pan-1500-bad-base-'));
    setupRepo(workspace);
    try {
      const findings = await scanStubUi(workspace, 'nonexistent-base-12345');
      expect(findings).toEqual([]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
