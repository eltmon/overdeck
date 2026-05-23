import { Schema } from "effect"

export const EDITORS = [
  { id: "cursor", label: "Cursor", command: "cursor", supportsGoto: true },
  { id: "windsurf", label: "Windsurf", command: "windsurf", supportsGoto: true },
  { id: "trae", label: "Trae", command: "trae", supportsGoto: true },
  { id: "kiro", label: "Kiro", command: "kiro", supportsGoto: true },
  { id: "vscode", label: "VS Code", command: "code", supportsGoto: true },
  { id: "vscode-insiders", label: "VS Code Insiders", command: "code-insiders", supportsGoto: true },
  { id: "vscodium", label: "VSCodium", command: "codium", supportsGoto: true },
  { id: "zed", label: "Zed", command: "zed", supportsGoto: false },
  { id: "antigravity", label: "Antigravity", command: "agy", supportsGoto: false },
  { id: "idea", label: "IntelliJ IDEA", command: "idea", supportsGoto: true },
  { id: "aqua", label: "Aqua", command: "aqua", supportsGoto: true },
  { id: "clion", label: "CLion", command: "clion", supportsGoto: true },
  { id: "datagrip", label: "DataGrip", command: "datagrip", supportsGoto: true },
  { id: "dataspell", label: "DataSpell", command: "dataspell", supportsGoto: true },
  { id: "goland", label: "GoLand", command: "goland", supportsGoto: true },
  { id: "phpstorm", label: "PhpStorm", command: "phpstorm", supportsGoto: true },
  { id: "pycharm", label: "PyCharm", command: "pycharm", supportsGoto: true },
  { id: "rider", label: "Rider", command: "rider", supportsGoto: true },
  { id: "rubymine", label: "RubyMine", command: "rubymine", supportsGoto: true },
  { id: "rustrover", label: "RustRover", command: "rustrover", supportsGoto: true },
  { id: "webstorm", label: "WebStorm", command: "webstorm", supportsGoto: true },
  { id: "file-manager", label: "File Manager", command: null, supportsGoto: false },
] as const

export type EditorEntry = (typeof EDITORS)[number]
export type EditorId = EditorEntry["id"]

const EDITOR_IDS: [EditorId, ...EditorId[]] = [
  "cursor",
  "windsurf",
  "trae",
  "kiro",
  "vscode",
  "vscode-insiders",
  "vscodium",
  "zed",
  "antigravity",
  "idea",
  "aqua",
  "clion",
  "datagrip",
  "dataspell",
  "goland",
  "phpstorm",
  "pycharm",
  "rider",
  "rubymine",
  "rustrover",
  "webstorm",
  "file-manager",
]
export const EditorIdSchema = Schema.Literals(EDITOR_IDS)

export const OpenInEditorInput = Schema.Struct({
  cwd: Schema.String,
  editor: EditorIdSchema,
})
export type OpenInEditorInput = typeof OpenInEditorInput.Type
