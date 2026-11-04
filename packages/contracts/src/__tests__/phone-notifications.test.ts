import { describe, expect, it } from "vitest"
import {
  DEFAULT_PHONE_NOTIFICATION_PREFERENCES,
  notificationAllowed,
  parsePhoneNotificationPreferences,
  PHONE_NOTIFICATION_CATEGORIES,
  type PhoneNotificationPreferences,
} from "../index"

describe("parsePhoneNotificationPreferences", () => {
  it("accepts a valid v1 object", () => {
    const value = { v: 1, pause: null, muted: ["question", "failed"] }
    expect(parsePhoneNotificationPreferences(value)).toEqual({ v: 1, pause: null, muted: ["question", "failed"] })
  })

  it("accepts the default preferences", () => {
    expect(parsePhoneNotificationPreferences(DEFAULT_PHONE_NOTIFICATION_PREFERENCES)).toEqual(
      DEFAULT_PHONE_NOTIFICATION_PREFERENCES,
    )
  })

  it("accepts an indefinite pause", () => {
    const value = { v: 1, pause: { until: null }, muted: [] }
    expect(parsePhoneNotificationPreferences(value)).toEqual(value)
  })

  it("accepts a timed pause with a Date.parse-able until", () => {
    const value = { v: 1, pause: { until: "2026-11-05T08:00:00.000Z" }, muted: [] }
    expect(parsePhoneNotificationPreferences(value)).toEqual(value)
  })

  it.each([
    ["v: 2", { v: 2, pause: null, muted: [] }],
    ["a non-array muted", { v: 1, pause: null, muted: "question" }],
    ["an unparseable until", { v: 1, pause: { until: "not-a-date" }, muted: [] }],
    ["a non-object pause", { v: 1, pause: "soon", muted: [] }],
    ["null", null],
    ["an array", [1, 2, 3]],
    ["a string", "not an object"],
    ["missing v", { pause: null, muted: [] }],
  ])("returns null for %s", (_name, value) => {
    expect(parsePhoneNotificationPreferences(value)).toBeNull()
  })

  it("drops unknown muted entries, deduplicates, and orders by category order", () => {
    const value = { v: 1, pause: null, muted: ["stopped", "bogus", "question", "stopped"] }
    expect(parsePhoneNotificationPreferences(value)).toEqual({ v: 1, pause: null, muted: ["question", "stopped"] })
  })

  it("never throws on hostile input", () => {
    expect(() => parsePhoneNotificationPreferences(undefined)).not.toThrow()
    expect(() => parsePhoneNotificationPreferences(Symbol("x"))).not.toThrow()
    expect(() => parsePhoneNotificationPreferences(42)).not.toThrow()
  })
})

describe("notificationAllowed", () => {
  const nowMs = Date.parse("2026-11-04T12:00:00.000Z")
  const future = "2026-11-04T13:00:00.000Z"
  const past = "2026-11-04T11:00:00.000Z"

  function prefs(overrides: Partial<PhoneNotificationPreferences>): PhoneNotificationPreferences {
    return { v: 1, pause: null, muted: [], ...overrides }
  }

  it("returns true for every category when prefs is null", () => {
    for (const category of [...PHONE_NOTIFICATION_CATEGORIES, "summary", "test"] as const) {
      expect(notificationAllowed(null, category, nowMs)).toBe(true)
    }
  })

  it("returns true for test even while indefinitely paused", () => {
    expect(notificationAllowed(prefs({ pause: { until: null } }), "test", nowMs)).toBe(true)
  })

  it("returns false for a non-test category while indefinitely paused", () => {
    for (const category of [...PHONE_NOTIFICATION_CATEGORIES, "summary"] as const) {
      expect(notificationAllowed(prefs({ pause: { until: null } }), category, nowMs)).toBe(false)
    }
  })

  it("returns false for a non-test category while paused with a future until", () => {
    expect(notificationAllowed(prefs({ pause: { until: future } }), "question", nowMs)).toBe(false)
    expect(notificationAllowed(prefs({ pause: { until: future } }), "summary", nowMs)).toBe(false)
  })

  it("returns true once until is earlier than nowMs", () => {
    expect(notificationAllowed(prefs({ pause: { until: past } }), "question", nowMs)).toBe(true)
    expect(notificationAllowed(prefs({ pause: { until: past } }), "summary", nowMs)).toBe(true)
  })

  it("returns false for a muted category", () => {
    expect(notificationAllowed(prefs({ muted: ["failed"] }), "failed", nowMs)).toBe(false)
  })

  it("returns true for every other category while one is muted", () => {
    expect(notificationAllowed(prefs({ muted: ["failed"] }), "question", nowMs)).toBe(true)
  })

  it("returns true for summary and test while that category is muted", () => {
    expect(notificationAllowed(prefs({ muted: ["failed"] }), "summary", nowMs)).toBe(true)
    expect(notificationAllowed(prefs({ muted: ["failed"] }), "test", nowMs)).toBe(true)
  })
})
