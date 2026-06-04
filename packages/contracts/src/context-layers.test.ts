import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import {
  CONTEXT_PREVIEW_HARNESSES,
  ContextLayerSaveRequest,
  ContextLayersResponse,
  ContextPreviewRequest,
  ContextPreviewResponse,
  ContextSyncRequest,
} from "./index"
import type { Harness } from "./types"

const decodeLayersResponse = Schema.decodeUnknownSync(ContextLayersResponse)
const decodePreviewRequest = Schema.decodeUnknownSync(ContextPreviewRequest)
const decodePreviewResponse = Schema.decodeUnknownSync(ContextPreviewResponse)
const decodeSaveRequest = Schema.decodeUnknownSync(ContextLayerSaveRequest)
const decodeSyncRequest = Schema.decodeUnknownSync(ContextSyncRequest)

describe("context dashboard contracts", () => {
  it("represents global, project, and workspace editable layers", () => {
    const parsed = decodeLayersResponse({
      operation: "load",
      projects: [
        {
          projectKey: "panopticon-cli",
          name: "Panopticon CLI",
          path: "/repo/panopticon-cli",
          issuePrefix: "PAN",
          tracker: "github",
          workspaceRoot: "/repo/panopticon-cli/workspaces",
        },
      ],
      workspaces: [
        {
          projectKey: "panopticon-cli",
          path: "/repo/panopticon-cli/workspaces/feature-pan-1201",
          name: "feature-pan-1201",
          issueId: "PAN-1201",
          branch: "feature/pan-1201",
        },
      ],
      layers: [
        {
          kind: "global",
          file: "/home/user/.panopticon/context/global.md",
          exists: true,
          content: "global context",
          editable: true,
        },
        {
          kind: "project",
          projectKey: "panopticon-cli",
          file: "/repo/panopticon-cli/.pan/context/project.md",
          exists: true,
          content: "project context",
          editable: true,
        },
        {
          kind: "workspace",
          projectKey: "panopticon-cli",
          workspacePath: "/repo/panopticon-cli/workspaces/feature-pan-1201",
          file: "/repo/panopticon-cli/workspaces/feature-pan-1201/.pan/context/workspace.md",
          exists: false,
          content: "",
          editable: true,
        },
      ],
      targets: [
        {
          harness: "claude-code",
          layerKind: "global",
          label: "Claude Code · global",
          path: "/home/user/.claude/CLAUDE.md",
          exists: true,
          hasManagedRegion: true,
          hasUserContent: true,
        },
        {
          harness: "pi",
          layerKind: "project",
          projectKey: "panopticon-cli",
          label: "panopticon-cli · AGENTS.md",
          path: "/repo/panopticon-cli/AGENTS.md",
          exists: false,
          hasManagedRegion: false,
          hasUserContent: false,
        },
      ],
    })

    expect(parsed.layers.map((layer) => layer.kind)).toEqual(["global", "project", "workspace"])
    expect(parsed.targets.map((target) => target.harness)).toEqual(["claude-code", "pi"])
    expect(parsed.targets[0].hasUserContent).toBe(true)
  })

  it("names harness previews with shared harness values and fullPrompt", () => {
    const harnesses: readonly Harness[] = CONTEXT_PREVIEW_HARNESSES
    expect(harnesses).toEqual(["claude-code", "pi"])

    const parsed = decodePreviewResponse({
      operation: "preview",
      previews: {
        "claude-code": "Claude Code rendered context",
        pi: "Pi rendered context",
        fullPrompt: "Panopticon injected prompt audit",
      },
      diagnostics: [],
    })

    expect(parsed.previews["claude-code"]).toBe("Claude Code rendered context")
    expect(parsed.previews.pi).toBe("Pi rendered context")
    expect(parsed.previews.fullPrompt).toBe("Panopticon injected prompt audit")
  })

  it("keeps preview, save, and sync operations distinct", () => {
    const preview = decodePreviewRequest({
      operation: "preview",
      selectedLayer: { kind: "project", projectKey: "panopticon-cli" },
      drafts: [
        {
          target: { kind: "project", projectKey: "panopticon-cli" },
          content: "draft only",
        },
      ],
    })
    expect(preview.operation).toBe("preview")

    const save = decodeSaveRequest({
      operation: "save",
      target: { kind: "project", projectKey: "panopticon-cli" },
      content: "persist this layer",
    })
    expect(save.operation).toBe("save")

    const sync = decodeSyncRequest({ operation: "sync" })
    expect(sync.operation).toBe("sync")

    expect(() => decodePreviewRequest({
      operation: "save",
      selectedLayer: { kind: "global" },
      drafts: [],
    })).toThrow()
    expect(() => decodeSaveRequest({
      operation: "preview",
      target: { kind: "global" },
      content: "wrong operation",
    })).toThrow()
    expect(() => decodeSyncRequest({ operation: "preview" })).toThrow()
  })

  it("requires project and workspace identifiers for targeted layers", () => {
    expect(() => decodeSaveRequest({
      operation: "save",
      target: { kind: "project" },
      content: "missing project key",
    })).toThrow()

    expect(() => decodeSaveRequest({
      operation: "save",
      target: { kind: "workspace", projectKey: "panopticon-cli" },
      content: "missing workspace path",
    })).toThrow()
  })
})

const previewRequest = {
  operation: "preview",
  selectedLayer: { kind: "global" },
  drafts: [],
} satisfies typeof ContextPreviewRequest.Encoded

void previewRequest
