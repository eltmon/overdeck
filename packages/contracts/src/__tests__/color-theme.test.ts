import { describe, expect, it } from "vitest"
import {
  BUILTIN_COLOR_THEMES,
  builtinFor,
  effectiveTerminalPalette,
  normalizeColorTheme,
  readableForeground,
  slugifyThemeId,
  toOpaqueHex,
} from "../color-theme"

describe("normalizeColorTheme", () => {
  it("drops an invalid hex with a warning naming the key and keeps the rest", () => {
    const result = normalizeColorTheme(
      { name: "Test", type: "dark", terminal: { background: "#000000", red: "not-a-color" } },
      "test",
    )
    if ("errors" in result) throw new Error("expected a theme")
    expect(result.theme.terminal).toEqual({ background: "#000000" })
    expect(result.warnings).toContainEqual(expect.stringContaining("terminal.red"))
  })

  it("rejects a theme missing type", () => {
    const result = normalizeColorTheme({ name: "Test" }, "test")
    expect("errors" in result).toBe(true)
    if (!("errors" in result)) throw new Error("expected errors")
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it("drops an unknown terminal key with a warning", () => {
    const result = normalizeColorTheme(
      { name: "Test", type: "dark", terminal: { bogus: "#ffffff" } },
      "test",
    )
    if ("errors" in result) throw new Error("expected a theme")
    expect(result.theme.terminal).toBeUndefined()
    expect(result.warnings).toContainEqual(expect.stringContaining("terminal.bogus"))
  })

  it("rejects a theme missing name", () => {
    const result = normalizeColorTheme({ type: "dark" }, "test")
    expect("errors" in result).toBe(true)
  })

  it("passes through a well-formed vscode-import source", () => {
    const result = normalizeColorTheme(
      { name: "Test", type: "dark", source: { kind: "vscode-import", fileName: "ayu-dark.json", importedAt: "2026-11-01T00:00:00.000Z" } },
      "test",
    )
    if ("errors" in result) throw new Error("expected a theme")
    expect(result.theme.source).toEqual({ kind: "vscode-import", fileName: "ayu-dark.json", importedAt: "2026-11-01T00:00:00.000Z" })
  })

  it("accepts a minimal valid theme with no optional groups", () => {
    const result = normalizeColorTheme({ name: "Minimal", type: "light" }, "minimal")
    if ("errors" in result) throw new Error("expected a theme")
    expect(result.theme).toEqual({ id: "minimal", builtin: false, name: "Minimal", type: "light" })
    expect(result.warnings).toEqual([])
  })

  it("keeps a valid ui.overlay and warns on none", () => {
    const result = normalizeColorTheme(
      { name: "Test", type: "dark", ui: { overlay: "#141821" } },
      "test",
    )
    if ("errors" in result) throw new Error("expected a theme")
    expect(result.theme.ui?.overlay).toBe("#141821")
    expect(result.warnings.some((w) => w.includes("unknown ui key"))).toBe(false)
  })
})

describe("effectiveTerminalPalette", () => {
  it("returns exactly the built-in overdeck-dark palette for a dark theme with no terminal group", () => {
    const palette = effectiveTerminalPalette({ type: "dark" })
    expect(palette).toEqual(BUILTIN_COLOR_THEMES["overdeck-dark"].terminal)
    expect(palette.background).toBe("#1a1a2e")
  })

  it("overlays the theme's own terminal colors on top of the built-in", () => {
    const palette = effectiveTerminalPalette({ type: "dark", terminal: { background: "#0d1017" } })
    expect(palette.background).toBe("#0d1017")
    expect(palette.foreground).toBe(BUILTIN_COLOR_THEMES["overdeck-dark"].terminal!.foreground)
  })
})

describe("toOpaqueHex", () => {
  it("drops an alpha channel from an 8-digit hex", () => {
    expect(toOpaqueHex("#0d1017cc")).toBe("#0d1017")
  })

  it("expands a 3-digit hex to 6 digits", () => {
    expect(toOpaqueHex("#abc")).toBe("#aabbcc")
  })
})

describe("slugifyThemeId", () => {
  it("slugifies a title-cased name", () => {
    expect(slugifyThemeId("Ayu Dark")).toBe("ayu-dark")
  })

  it("falls back to \"theme\" when nothing survives", () => {
    expect(slugifyThemeId("!!!")).toBe("theme")
  })
})

describe("readableForeground", () => {
  it("returns black text on a light background", () => {
    expect(readableForeground("#ffffff")).toBe("#000000")
  })

  it("returns white text on a dark background", () => {
    expect(readableForeground("#000000")).toBe("#ffffff")
  })

  it("picks the higher-contrast color by ratio, not a flat luminance cutoff (#888888 -> black, ~5.9:1 beats white's ~3.5:1)", () => {
    expect(readableForeground("#888888")).toBe("#000000")
  })
})

describe("builtinFor", () => {
  it("returns overdeck-dark for dark and overdeck-light for light", () => {
    expect(builtinFor("dark").id).toBe("overdeck-dark")
    expect(builtinFor("light").id).toBe("overdeck-light")
  })
})
