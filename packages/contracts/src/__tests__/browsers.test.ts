import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { BROWSERS, BrowserIdSchema, EDITORS, EditorIdSchema, OpenInBrowserInput } from "../editor"

describe("BROWSERS", () => {
  it("has exactly the specified ids in order", () => {
    expect(BROWSERS.map((b) => b.id)).toEqual([
      "default-browser",
      "chrome",
      "chromium",
      "firefox",
      "brave",
      "edge",
      "vivaldi",
    ])
    const chromium = BROWSERS.find((b) => b.id === "chromium")
    expect(chromium?.linuxCommands).toEqual(["chromium", "chromium-browser"])
  })
})

describe("EDITORS and BROWSERS disjointness", () => {
  it("shares no id between EDITORS and BROWSERS", () => {
    const editorIds = new Set(EDITORS.map((e) => e.id))
    const browserIds = BROWSERS.map((b) => b.id)
    for (const id of browserIds) {
      expect(editorIds.has(id as unknown as (typeof EDITORS)[number]["id"])).toBe(false)
    }
    expect(() => Schema.decodeUnknownSync(EditorIdSchema)("firefox")).toThrow()
  })
})

describe("OpenInBrowserInput", () => {
  it("decodes a valid input", () => {
    const value = Schema.decodeUnknownSync(OpenInBrowserInput)({ path: "/tmp/a.html", browser: "chrome" })
    expect(value).toEqual({ path: "/tmp/a.html", browser: "chrome" })
  })

  it("rejects a browser id that is really an editor id", () => {
    expect(() =>
      Schema.decodeUnknownSync(OpenInBrowserInput)({ path: "/tmp/a.html", browser: "cursor" }),
    ).toThrow()
  })
})

describe("BrowserIdSchema", () => {
  it("decodes a valid browser id", () => {
    expect(Schema.decodeUnknownSync(BrowserIdSchema)("firefox")).toBe("firefox")
  })
})
