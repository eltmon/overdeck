import { Schema } from "effect"
import { describe, expect, it } from "vitest"

import {
  EXPLORER_ERROR_CODES,
  ExplorerBeginEditInput,
  ExplorerCopyInput,
  ExplorerCreateInput,
  ExplorerDeleteInput,
  ExplorerGitStageInput,
  ExplorerGitStatusInput,
  ExplorerListDirInput,
  ExplorerReadFileInput,
  ExplorerRenameInput,
  ExplorerRestoreInput,
  ExplorerSearchContentInput,
  ExplorerSearchFilesInput,
  ExplorerWatchInput,
  ExplorerWriteFileInput,
} from "../explorer"
import { PanRpcGroup, WS_METHODS } from "../rpc"

const ROOT = "project:overdeck"

// One valid and one invalid payload per input schema. Each invalid payload
// has a wrong literal or a missing required field.
const CASES: ReadonlyArray<{
  readonly name: string
  readonly schema: Schema.Top
  readonly valid: unknown
  readonly invalid: unknown
}> = [
  { name: "ExplorerListDirInput", schema: ExplorerListDirInput, valid: { rootId: ROOT, path: "src" }, invalid: { rootId: ROOT } },
  { name: "ExplorerReadFileInput", schema: ExplorerReadFileInput, valid: { rootId: ROOT, path: "a.ts", ref: "HEAD" }, invalid: { rootId: ROOT, path: "a.ts", ref: "main" } },
  {
    name: "ExplorerWriteFileInput",
    schema: ExplorerWriteFileInput,
    valid: { rootId: ROOT, path: "a.ts", text: "x", expectedSignature: null, allowMissing: true },
    invalid: { rootId: ROOT, path: "a.ts", text: "x", allowMissing: true },
  },
  { name: "ExplorerCreateInput", schema: ExplorerCreateInput, valid: { rootId: ROOT, path: "b", kind: "dir" }, invalid: { rootId: ROOT, path: "b", kind: "symlink" } },
  { name: "ExplorerRenameInput", schema: ExplorerRenameInput, valid: { rootId: ROOT, from: "a", to: "b" }, invalid: { rootId: ROOT, from: "a" } },
  { name: "ExplorerCopyInput", schema: ExplorerCopyInput, valid: { rootId: ROOT, from: "a", to: "b" }, invalid: { rootId: ROOT, to: "b" } },
  { name: "ExplorerDeleteInput", schema: ExplorerDeleteInput, valid: { rootId: ROOT, paths: ["a", "b"] }, invalid: { rootId: ROOT, paths: "a" } },
  { name: "ExplorerRestoreInput", schema: ExplorerRestoreInput, valid: { rootId: ROOT, trashId: "t1" }, invalid: { rootId: ROOT } },
  { name: "ExplorerGitStatusInput", schema: ExplorerGitStatusInput, valid: { rootId: ROOT }, invalid: {} },
  {
    name: "ExplorerGitStageInput",
    schema: ExplorerGitStageInput,
    valid: { rootId: ROOT, paths: ["a"], action: "discard" },
    invalid: { rootId: ROOT, paths: ["a"], action: "reset" },
  },
  { name: "ExplorerSearchFilesInput", schema: ExplorerSearchFilesInput, valid: { rootId: ROOT, query: "rpc", limit: 50 }, invalid: { rootId: ROOT, query: "rpc" } },
  {
    name: "ExplorerSearchContentInput",
    schema: ExplorerSearchContentInput,
    valid: { rootId: ROOT, query: "foo", scopePath: "src", regex: false, caseSensitive: true, limit: 100 },
    invalid: { rootId: ROOT, query: "foo", regex: "no", caseSensitive: true, limit: 100 },
  },
  { name: "ExplorerWatchInput", schema: ExplorerWatchInput, valid: { rootId: ROOT }, invalid: { rootId: 7 } },
  { name: "ExplorerBeginEditInput", schema: ExplorerBeginEditInput, valid: { projectKey: "overdeck", forceNew: false }, invalid: { projectKey: "overdeck" } },
]

describe("explorer input schemas", () => {
  for (const { name, schema, valid, invalid } of CASES) {
    it(`${name} accepts a valid payload and rejects an invalid one`, () => {
      const decode = Schema.decodeUnknownSync(schema as Schema.Codec<unknown, unknown>)
      expect(decode(valid)).toEqual(valid)
      expect(() => decode(invalid)).toThrow()
    })
  }
})

describe("explorer contract surface", () => {
  it("defines 14 error codes", () => {
    expect(EXPLORER_ERROR_CODES).toHaveLength(14)
    expect(new Set(EXPLORER_ERROR_CODES).size).toBe(14)
    expect(EXPLORER_ERROR_CODES).toContain("INVALID_TARGET")
  })

  it("adds 14 pan.explorer* methods to WS_METHODS and PanRpcGroup", () => {
    const methods = Object.values(WS_METHODS).filter((v) => v.startsWith("pan.explorer"))
    expect(methods).toHaveLength(14)
    const groupTags = new Set(PanRpcGroup.requests.keys())
    for (const method of methods) expect(groupTags.has(method)).toBe(true)
  })
})
