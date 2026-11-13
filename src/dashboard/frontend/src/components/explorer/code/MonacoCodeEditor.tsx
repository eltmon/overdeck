/**
 * Monaco editor for a code pane (PAN-5187, D-C16, D-C17).
 *
 * Only the code pane imports this module, and the Stage loads the code pane
 * with React.lazy, so `editor.main.js` (every Monaco language plus the
 * css/html/json/typescript language services) stays out of every other
 * chunk. TypeScript and JavaScript show syntax errors only (no project
 * context exists for semantic checks). Keybindings are registered per editor with `addAction`, never
 * `addCommand` (global across editors) or a window listener.
 */
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import { typescript } from 'monaco-editor/esm/vs/editor/editor.main.js'
import { useCallback, useMemo, useRef } from 'react'
import { useTheme } from '../../../hooks/useTheme'
import { ensureMonaco } from '../../../lib/monaco-setup'
import { monacoLanguageForPath } from './monaco-language'

ensureMonaco()

// The TypeScript service sees one file at a time with no project, node_modules
// or tsconfig, so its semantic checks flag every import, Node global and JSX
// element of real code. Keep syntax errors, drop the semantic noise.
const SYNTAX_ONLY = { noSemanticValidation: true, noSyntaxValidation: false, noSuggestionDiagnostics: true }
typescript.typescriptDefaults.setDiagnosticsOptions(SYNTAX_ONLY)
typescript.javascriptDefaults.setDiagnosticsOptions(SYNTAX_ONLY)

export type CodeEditorInstance = monaco.editor.IStandaloneCodeEditor
export type CodePosition = monaco.IPosition

/** The Monaco language id for a path, from Monaco's registered languages (D-C15). */
export function codeLanguageForPath(path: string): string {
  return monacoLanguageForPath(path, monaco.languages.getLanguages())
}

/** The model URI of a file, unique per (root, path), so two roots never share a model. */
export function codeModelUri(rootId: string, path: string): string {
  return `overdeck-explorer://${encodeURIComponent(rootId)}/${path}`
}

export interface MonacoCodeEditorProps {
  rootId: string
  path: string
  value: string
  wordWrap: 'on' | 'off'
  readOnly: boolean
  onChange(text: string): void
  onBlur(): void
  onSaveShortcut(): void
  onToggleWrap(): void
  onMount(editor: CodeEditorInstance): void
}

export function MonacoCodeEditor(props: MonacoCodeEditorProps) {
  const { rootId, path, value, wordWrap, readOnly } = props
  const theme = useTheme((s) => s.resolvedTheme)
  const language = useMemo(() => codeLanguageForPath(path), [path])

  // The editor's actions are registered once, so they call through a ref to
  // reach the latest callbacks.
  const latest = useRef(props)
  latest.current = props

  const handleMount = useCallback<OnMount>((editor) => {
    editor.addAction({
      id: 'overdeck.explorer.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => latest.current.onSaveShortcut(),
    })
    editor.addAction({
      id: 'overdeck.explorer.toggleWordWrap',
      label: 'Toggle Word Wrap',
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
      run: () => latest.current.onToggleWrap(),
    })
    editor.onDidBlurEditorText(() => latest.current.onBlur())
    latest.current.onMount(editor)
  }, [])

  return (
    <Editor
      height="100%"
      path={codeModelUri(rootId, path)}
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      value={value}
      loading={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}
      options={{
        ariaLabel: `Edit ${path}`,
        minimap: { enabled: false },
        wordWrap,
        readOnly,
        automaticLayout: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
      }}
      onChange={(next) => latest.current.onChange(next ?? '')}
      onMount={handleMount}
    />
  )
}
