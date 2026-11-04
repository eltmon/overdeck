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
  // With editor "file-manager": open the folder containing `cwd` and select
  // the file in it, instead of opening `cwd` itself.
  reveal: Schema.optional(Schema.Boolean),
})
export type OpenInEditorInput = typeof OpenInEditorInput.Type

// Browsers the dashboard can open a local file in (PAN-4762). Kept apart from
// EDITORS: the preferred-editor fallback and PanOpenInPicker list EDITORS, so a
// browser there would become someone's "editor".
// linuxCommands: binaries tried in order on Linux. macApp: the /Applications
// app name on macOS. default-browser uses the platform opener instead.
export const BROWSERS = [
  { id: "default-browser", label: "browser", linuxCommands: [], macApp: null },
  { id: "chrome", label: "Google Chrome", linuxCommands: ["google-chrome"], macApp: "Google Chrome" },
  { id: "chromium", label: "Chromium", linuxCommands: ["chromium", "chromium-browser"], macApp: "Chromium" },
  { id: "firefox", label: "Firefox", linuxCommands: ["firefox"], macApp: "Firefox" },
  { id: "brave", label: "Brave", linuxCommands: ["brave-browser"], macApp: "Brave Browser" },
  { id: "edge", label: "Microsoft Edge", linuxCommands: ["microsoft-edge"], macApp: "Microsoft Edge" },
  { id: "vivaldi", label: "Vivaldi", linuxCommands: ["vivaldi"], macApp: "Vivaldi" },
] as const

export type BrowserEntry = (typeof BROWSERS)[number]
export type BrowserId = BrowserEntry["id"]

const BROWSER_IDS: [BrowserId, ...BrowserId[]] = [
  "default-browser",
  "chrome",
  "chromium",
  "firefox",
  "brave",
  "edge",
  "vivaldi",
]
export const BrowserIdSchema = Schema.Literals(BROWSER_IDS)

export const OpenInBrowserInput = Schema.Struct({
  // Absolute path of the file to open; the server turns it into a file:// URL.
  path: Schema.String,
  browser: BrowserIdSchema,
})
export type OpenInBrowserInput = typeof OpenInBrowserInput.Type
