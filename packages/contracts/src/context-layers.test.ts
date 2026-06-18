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
          projectKey: "overdeck",
          name: "Overdeck CLI",
          path: "/repo/overdeck",
          issuePrefix: "PAN",
          tracker: "github",
          workspaceRoot: "/repo/overdeck/workspaces",
        },
      ],
      workspaces: [
        {
          projectKey: "overdeck",
          path: "/repo/overdeck/workspaces/feature-pan-1201",
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
          projectKey: "overdeck",
          file: "/repo/overdeck/.pan/context/project.md",
          exists: true,
          content: "project context",
          editable: true,
        },
        {
          kind: "workspace",
          projectKey: "overdeck",
          workspacePath: "/repo/overdeck/workspaces/feature-pan-1201",
          file: "/repo/overdeck/workspaces/feature-pan-1201/.pan/context/workspace.md",
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
          projectKey: "overdeck",
          label: "overdeck · AGENTS.md",
          path: "/repo/overdeck/AGENTS.md",
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
        fullPrompt: "Overdeck injected prompt audit",
      },
      diagnostics: [],
    })

    expect(parsed.previews["claude-code"]).toBe("Claude Code rendered context")
    expect(parsed.previews.pi).toBe("Pi rendered context")
    expect(parsed.previews.fullPrompt).toBe("Overdeck injected prompt audit")
  })

  it("keeps preview, save, and sync operations distinct", () => {
    const preview = decodePreviewRequest({
      operation: "preview",
      selectedLayer: { kind: "project", projectKey: "overdeck" },
      drafts: [
        {
          target: { kind: "project", projectKey: "overdeck" },
          content: "draft only",
        },
      ],
    })
    expect(preview.operation).toBe("preview")

    const save = decodeSaveRequest({
      operation: "save",
      target: { kind: "project", projectKey: "overdeck" },
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
      target: { kind: "workspace", projectKey: "overdeck" },
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
