import Editor from '@monaco-editor/react';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import { ensureMonaco } from '../../lib/monaco-setup';

ensureMonaco();

interface ContextEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function ContextEditor({ value, onChange, disabled = false }: ContextEditorProps) {
  return (
    <Editor
      height="100%"
      language="markdown"
      theme="vs-dark"
      value={value}
      loading={<div className="p-4 text-sm text-muted-foreground">Loading editor…</div>}
      options={{
        ariaLabel: 'Context markdown editor',
        tabFocusMode: true,
        minimap: { enabled: false },
        wordWrap: 'on',
        lineNumbers: 'on',
        readOnly: disabled,
        scrollBeyondLastLine: false,
        fontSize: 13,
        padding: { top: 16, bottom: 16 },
        automaticLayout: true,
      }}
      onChange={(next) => onChange(next ?? '')}
    />
  );
}
