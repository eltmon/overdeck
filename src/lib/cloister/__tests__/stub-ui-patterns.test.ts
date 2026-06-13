/**
 * Unit tests for the stub-UI pattern catalog (PAN-1500).
 */
import { describe, expect, it } from 'vitest';
import {
  STUB_UI_FILE_GLOBS,
  STUB_UI_PATTERNS,
  matchesStubUiFileGlob,
  isStubUiFileInScope,
  type StubUiPattern,
  type StubUiSeverity,
} from '../stub-ui-patterns.js';

function findPattern(id: string): StubUiPattern {
  const p = STUB_UI_PATTERNS.find((pat) => pat.id === id);
  if (!p) throw new Error(`Unknown pattern id: ${id}`);
  return p;
}

function expectMatch(id: string, line: string) {
  const p = findPattern(id);
  expect({ id, line, matches: p.regex.test(line) }).toEqual({ id, line, matches: true });
}

function expectNoMatch(id: string, line: string) {
  const p = findPattern(id);
  expect({ id, line, matches: p.regex.test(line) }).toEqual({ id, line, matches: false });
}

describe('STUB_UI_FILE_GLOBS', () => {
  it('covers Tab, Mode, and View suffixes under the dashboard components tree', () => {
    expect(STUB_UI_FILE_GLOBS).toContain('src/dashboard/frontend/src/components/**/*Tab.tsx');
    expect(STUB_UI_FILE_GLOBS).toContain('src/dashboard/frontend/src/components/**/*Mode.tsx');
    expect(STUB_UI_FILE_GLOBS).toContain('src/dashboard/frontend/src/components/**/*View.tsx');
  });

  it('covers net-new files under src/dashboard/frontend/src/components/', () => {
    expect(STUB_UI_FILE_GLOBS).toContain('src/dashboard/frontend/src/components/**/*.tsx');
  });

  it('matches UI affordance files under the components directory', () => {
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Inspector/FilesTab.tsx')).toBe(true);
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Fleet/TableMode.tsx')).toBe(true);
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Fleet/FleetAgentsView.tsx')).toBe(true);
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Button.tsx')).toBe(true);
  });

  it('does not match files outside the dashboard components tree', () => {
    expect(matchesStubUiFileGlob('src/lib/cloister/foo.ts')).toBe(false);
    expect(matchesStubUiFileGlob('src/dashboard/server/routes/foo.ts')).toBe(false);
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/hooks/useFoo.ts')).toBe(false);
    expect(matchesStubUiFileGlob('packages/contracts/src/types.ts')).toBe(false);
  });

  it('does not match non-tsx files', () => {
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Styles.css')).toBe(false);
    expect(matchesStubUiFileGlob('src/dashboard/frontend/src/components/Notes.md')).toBe(false);
  });
});

describe('isStubUiFileInScope', () => {
  it('treats added component files as in scope', () => {
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/NewThing.tsx', 'A')).toBe(true);
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Inspector/FilesTab.tsx', 'A')).toBe(true);
  });

  it('treats modified affordance-suffix files as in scope', () => {
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Inspector/FilesTab.tsx', 'M')).toBe(true);
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Fleet/TableMode.tsx', 'M')).toBe(true);
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Fleet/FleetAgentsView.tsx', 'M')).toBe(true);
  });

  it('excludes modified generic component files from scope', () => {
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Button.tsx', 'M')).toBe(false);
    expect(isStubUiFileInScope('src/dashboard/frontend/src/components/Layout.tsx', 'M')).toBe(false);
  });
});

describe('STUB_UI_PATTERNS per-pattern matching', () => {
  const cases: Array<{
    id: string;
    expectedSeverity: StubUiSeverity;
    positives: string[];
    negatives: string[];
  }> = [
    {
      id: 'coming-soon-copy',
      expectedSeverity: 'block',
      positives: [
        `<p>Coming soon</p>`,
        `<p>coming soon</p>`,
        `label="Not yet implemented"`,
        `title='Coming soon'`,
        `const message = "Not yet implemented";`,
      ],
      negatives: [
        `// We are no longer coming soon`,
        `const soon = 'later';`,
        `return <p>Ready now</p>;`,
      ],
    },
    {
      id: 'empty-array-return',
      expectedSeverity: 'block',
      positives: [
        `return [];`,
        `  return [];`,
        `return [ ];`,
      ],
      negatives: [
        `return [...prev];`,
        `return [1, 2, 3];`,
        `return items ?? [];`,
        `const empty: string[] = [];`,
      ],
    },
    {
      id: 'null-return',
      expectedSeverity: 'block',
      positives: [
        `return null;`,
        `  return null;`,
      ],
      negatives: [
        `return value ?? null;`,
        `return nullish ? null : value;`,
        `const x: string | null = null;`,
      ],
    },
    {
      id: 'use-state-false',
      expectedSeverity: 'advisory',
      positives: [
        `const [active] = useState(false);`,
        `const [mode, setMode] = useState(false);`,
        `useState(false)`,
      ],
      negatives: [
        `const [active] = useState(true);`,
        `const [count] = useState(0);`,
        `const [open, setOpen] = useState(() => false);`,
      ],
    },
    {
      id: 'new-tab-or-route',
      expectedSeverity: 'advisory',
      positives: [
        `<Tab value="files">Files</Tab>`,
        `<TabPanel value="files">`,
        `<Route path="/files" element={<FilesPage />} />`,
        `<Tabs><Tab label="Comments" /></Tabs>`,
      ],
      negatives: [
        `const tab = 'files';`,
        `// Tab order matters`,
        `function formatTabName() {}`,
      ],
    },
    {
      id: 'segmented-control-noop',
      expectedSeverity: 'block',
      positives: [
        `onChange={() => {}}`,
        `onChange={() => null}`,
        `onChange={() => undefined}`,
        `  onChange: () => {},`,
      ],
      negatives: [
        `onChange={(value) => setMode(value)}`,
        `onChange={handleChange}`,
        `onClick={() => {}}`,
      ],
    },
    {
      id: 'noop-handler',
      expectedSeverity: 'block',
      positives: [
        `onClick={() => {}}`,
        `onClick={() => null}`,
        `onSelect={() => {}}`,
        `onSubmit={() => undefined}`,
      ],
      negatives: [
        `onClick={handleClick}`,
        `onClick={(e) => e.preventDefault()}`,
        `onChange={() => {}}`,
      ],
    },
  ];

  for (const c of cases) {
    describe(c.id, () => {
      it(`has severity ${c.expectedSeverity}`, () => {
        expect(findPattern(c.id).severity).toBe(c.expectedSeverity);
      });

      it('matches expected positive lines', () => {
        for (const line of c.positives) {
          expectMatch(c.id, line);
        }
      });

      it('rejects expected negative lines', () => {
        for (const line of c.negatives) {
          expectNoMatch(c.id, line);
        }
      });
    });
  }
});

describe('pattern id stability', () => {
  it('exports every pattern with a stable id present in the type union', () => {
    const ids = STUB_UI_PATTERNS.map((p) => p.id);
    expect(ids).toContain('coming-soon-copy');
    expect(ids).toContain('empty-array-return');
    expect(ids).toContain('null-return');
    expect(ids).toContain('use-state-false');
    expect(ids).toContain('new-tab-or-route');
    expect(ids).toContain('segmented-control-noop');
    expect(ids).toContain('noop-handler');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
