import { describe, expect, it } from "vitest"
import { projectDeckKey, uiOpenSummary } from "../ui-commands"

describe("projectDeckKey", () => {
  it("returns the name when the project has one", () => {
    expect(projectDeckKey({ key: "panopticon-cli", name: "overdeck" })).toBe("overdeck")
  })

  it("falls back to the key when there is no name", () => {
    expect(projectDeckKey({ key: "demo" })).toBe("demo")
  })

  it("falls back to the key when the name is null", () => {
    expect(projectDeckKey({ key: "demo", name: null })).toBe("demo")
  })
})

describe("uiOpenSummary", () => {
  it("names the file when relPath is non-empty", () => {
    expect(
      uiOpenSummary({ deckKey: "overdeck", rootId: "project:panopticon-cli", relPath: "features/mission-control.mdx" }),
    ).toBe("Opened features/mission-control.mdx in overdeck")
  })

  it("names the issue workspace when relPath is empty and rootId is an issue root", () => {
    expect(uiOpenSummary({ deckKey: "overdeck", rootId: "issue:PAN-5295", relPath: "" })).toBe(
      "Opened the PAN-5295 workspace in overdeck",
    )
  })

  it("names the root folder when relPath is empty and rootId is not an issue root", () => {
    expect(uiOpenSummary({ deckKey: "overdeck", rootId: "project:panopticon-cli", relPath: "" })).toBe(
      "Opened root folder in overdeck",
    )
  })
})
