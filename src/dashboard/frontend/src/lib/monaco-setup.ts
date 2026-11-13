/**
 * Shared Monaco setup (PAN-5187, D-C16).
 *
 * Every Monaco editor in the dashboard (the Context page and the code
 * pane) uses one global Monaco instance. `ensureMonaco()` points
 * `@monaco-editor/react` at the locally bundled `editor.api.js` and gives
 * Monaco its web workers through Vite `?worker` imports. This local
 * dashboard must not depend on a public CDN to open an editor.
 *
 * Only `editor.api.js` is imported here. The all-language bundle
 * (`editor.main.js`) is imported by the code pane's lazy chunk, so the
 * Context page never loads it.
 */
import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

export type MonacoWorkerKind = 'json' | 'css' | 'html' | 'typescript' | 'editor';

/** The worker Monaco asks for by language label; labels without a language service use the editor worker. */
export function workerKindForLabel(label: string): MonacoWorkerKind {
  switch (label) {
    case 'json':
      return 'json';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'html':
    case 'handlebars':
    case 'razor':
      return 'html';
    case 'typescript':
    case 'javascript':
      return 'typescript';
    default:
      return 'editor';
  }
}

function createWorker(kind: MonacoWorkerKind): Worker {
  switch (kind) {
    case 'json':
      return new JsonWorker();
    case 'css':
      return new CssWorker();
    case 'html':
      return new HtmlWorker();
    case 'typescript':
      return new TsWorker();
    case 'editor':
      return new EditorWorker();
  }
}

let configured = false;

/** Configure Monaco's workers and loader once; later calls do nothing. */
export function ensureMonaco(): void {
  if (configured) return;
  configured = true;
  self.MonacoEnvironment = { getWorker: (_workerId, label) => createWorker(workerKindForLabel(label)) };
  loader.config({ monaco });
}
