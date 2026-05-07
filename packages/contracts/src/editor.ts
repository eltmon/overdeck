import { Schema } from "effect"

export const EDITORS = [
  { id: "cursor", label: "Cursor", command: "cursor", supportsGoto: true },
  { id: "windsurf", label: "Windsurf", command: "windsurf", supportsGoto: true },
  { id: "trae", label: "Trae", command: "trae", supportsGoto: true },
  { id: "vscode", label: "VS Code", command: "code", supportsGoto: true },
  { id: "vscode-insiders", label: "VS Code Insiders", command: "code-insiders", supportsGoto: true },
  { id: "vscodium", label: "VSCodium", command: "codium", supportsGoto: true },
  { id: "zed", label: "Zed", command: "zed", supportsGoto: false },
  { id: "antigravity", label: "Antigravity", command: "agy", supportsGoto: false },
  { id: "file-manager", label: "File Manager", command: null, supportsGoto: false },
] as const

export type EditorEntry = (typeof EDITORS)[number]
export type EditorId = EditorEntry["id"]

export const EditorIdSchema = Schema.Literal(
  ...EDITORS.map((e) => e.id) as [EditorId, ...EditorId[]]
)

export const OpenInEditorInput = Schema.Struct({
  cwd: Schema.String.pipe(Schema.trimmed(), Schema.nonEmptyString()),
  editor: EditorIdSchema,
})
export type OpenInEditorInput = typeof OpenInEditorInput.Type
