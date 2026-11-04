import { describe, expect, it } from "vitest"

import { presenceForPaneState } from "../backend-pane"

describe("presenceForPaneState", () => {
  it("maps idle to idle", () => {
    expect(presenceForPaneState("idle")).toBe("idle")
  })

  it("maps working to active", () => {
    expect(presenceForPaneState("working")).toBe("active")
  })

  it("maps blocked to active", () => {
    expect(presenceForPaneState("blocked")).toBe("active")
  })

  it("maps done to idle, not ended", () => {
    expect(presenceForPaneState("done")).toBe("idle")
  })

  it("maps exited to ended", () => {
    expect(presenceForPaneState("exited")).toBe("ended")
  })

  it("maps unknown to idle", () => {
    expect(presenceForPaneState("unknown")).toBe("idle")
  })
})
