import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ config: vi.fn() }));

vi.mock('@monaco-editor/react', () => ({ loader: { config: mocks.config } }));
vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => ({ editor: {} }));

function fakeWorker(kind: string) {
  return {
    default: class {
      readonly kind = kind;
    },
  };
}
vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => fakeWorker('editor'));
vi.mock('monaco-editor/esm/vs/language/css/css.worker?worker', () => fakeWorker('css'));
vi.mock('monaco-editor/esm/vs/language/html/html.worker?worker', () => fakeWorker('html'));
vi.mock('monaco-editor/esm/vs/language/json/json.worker?worker', () => fakeWorker('json'));
vi.mock('monaco-editor/esm/vs/language/typescript/ts.worker?worker', () => fakeWorker('typescript'));

const { ensureMonaco, workerKindForLabel } = await import('../monaco-setup');

describe('workerKindForLabel', () => {
  it.each([
    ['json', 'json'],
    ['css', 'css'],
    ['scss', 'css'],
    ['less', 'css'],
    ['html', 'html'],
    ['handlebars', 'html'],
    ['razor', 'html'],
    ['typescript', 'typescript'],
    ['javascript', 'typescript'],
    ['markdown', 'editor'],
    ['editorWorkerService', 'editor'],
  ])('maps %s to %s', (label, kind) => {
    expect(workerKindForLabel(label)).toBe(kind);
  });
});

describe('ensureMonaco', () => {
  it('configures the loader once and routes workers by label', () => {
    ensureMonaco();
    ensureMonaco();
    expect(mocks.config).toHaveBeenCalledTimes(1);
    const env = self.MonacoEnvironment!;
    expect((env.getWorker!('1', 'javascript') as unknown as { kind: string }).kind).toBe('typescript');
    expect((env.getWorker!('2', 'scss') as unknown as { kind: string }).kind).toBe('css');
    expect((env.getWorker!('3', 'markdown') as unknown as { kind: string }).kind).toBe('editor');
  });
});
