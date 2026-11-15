import { describe, expect, it } from "vitest"
import { resolvePathRoot } from "../path-root"

const projects = [
  { key: "overdeck", path: "/home/u/Projects/overdeck" },
  { key: "docs", path: "/home/u/Projects/overdeck/docs-site/" },
]

describe("resolvePathRoot", () => {
  it("prefers a scratch workspace over the project that contains it", () => {
    const scratch = [{ id: "ws-1", path: "/home/u/Projects/overdeck/scratch/a" }]
    expect(resolvePathRoot("/home/u/Projects/overdeck/scratch/a/src/x.ts", projects, scratch)).toEqual({
      kind: "root",
      projectKey: "overdeck",
      rootId: "workspace:ws-1",
    })
  })

  it("picks the longest scratch path when two contain the target", () => {
    const scratch = [
      { id: "outer", path: "/s" },
      { id: "inner", path: "/s/inner/" },
    ]
    expect(resolvePathRoot("/s/inner/f", [], scratch)).toMatchObject({ kind: "root", rootId: "workspace:inner" })
  })

  it("maps a feature workspace to its issue root", () => {
    expect(resolvePathRoot("/home/u/Projects/overdeck/workspaces/feature-pan-12/x", projects, [])).toEqual({
      kind: "root",
      projectKey: "overdeck",
      rootId: "issue:PAN-12",
    })
  })

  it("answers no-root for another folder under workspaces/", () => {
    expect(resolvePathRoot("/home/u/Projects/overdeck/workspaces/other/x", projects, [])).toEqual({
      kind: "no-root",
      projectKey: "overdeck",
    })
  })

  it("returns the longer of two nested projects", () => {
    expect(resolvePathRoot("/home/u/Projects/overdeck/docs-site/page.mdx", projects, [])).toEqual({
      kind: "root",
      projectKey: "docs",
      rootId: "project:docs",
    })
    expect(resolvePathRoot("/home/u/Projects/overdeck/src", projects, [])).toMatchObject({ rootId: "project:overdeck" })
  })

  it("answers outside for a path outside every project", () => {
    expect(resolvePathRoot("/home/u/elsewhere", projects, [])).toEqual({ kind: "outside" })
    expect(resolvePathRoot("/home/u/Projects/overdeck-other", projects, [])).toEqual({ kind: "outside" })
  })

  it("maps the project root itself, with or without a trailing slash", () => {
    expect(resolvePathRoot("/home/u/Projects/overdeck/", projects, [])).toEqual({
      kind: "root",
      projectKey: "overdeck",
      rootId: "project:overdeck",
    })
  })
})
