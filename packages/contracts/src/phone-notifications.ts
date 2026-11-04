// Phone notification categories and preferences (PAN-5019 WI-1).
//
// Shared by the server (filtering a push before it is sent) and the phone app (Settings, local
// storage, and the preferences it sends to each paired machine). `muted` lists only the categories
// a phone does NOT want: a category unknown to an older phone defaults on, and an older machine
// parsing a newer phone's list drops categories it does not recognize.

export type PhoneNotificationCategory = "question" | "plan" | "permission" | "finished" | "failed" | "stopped"

export const PHONE_NOTIFICATION_CATEGORIES: readonly PhoneNotificationCategory[] = [
  "question",
  "plan",
  "permission",
  "finished",
  "failed",
  "stopped",
]

export interface PhoneNotificationPreferences {
  readonly v: 1
  /** null: not paused. `until: null`: paused until turned back on. `until`: ISO-8601 instant. */
  readonly pause: null | { readonly until: string | null }
  /** Categories this phone does not want. Unlisted categories are on. */
  readonly muted: readonly PhoneNotificationCategory[]
}

export const DEFAULT_PHONE_NOTIFICATION_PREFERENCES: PhoneNotificationPreferences = {
  v: 1,
  pause: null,
  muted: [],
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parsePause(value: unknown): null | { until: string | null } | undefined {
  if (value === null) return null
  if (!isPlainObject(value)) return undefined
  const until = value.until
  if (until === null) return { until: null }
  if (typeof until !== "string" || Number.isNaN(Date.parse(until))) return undefined
  return { until }
}

/** Null for anything that is not a v1 prefs object; drops unknown/duplicate `muted` entries; never throws. */
export function parsePhoneNotificationPreferences(value: unknown): PhoneNotificationPreferences | null {
  if (!isPlainObject(value)) return null
  if (value.v !== 1) return null
  const pause = parsePause(value.pause)
  if (pause === undefined) return null
  const rawMuted: unknown = value.muted
  if (!Array.isArray(rawMuted)) return null
  const muted = PHONE_NOTIFICATION_CATEGORIES.filter((category) => rawMuted.includes(category))
  return { v: 1, pause, muted }
}

/** Whether a notification of `category` may go to a phone with `prefs` at `nowMs` (D-3). */
export function notificationAllowed(
  prefs: PhoneNotificationPreferences | null,
  category: PhoneNotificationCategory | "summary" | "test",
  nowMs: number,
): boolean {
  if (prefs === null) return true
  if (category === "test") return true
  if (prefs.pause !== null && (prefs.pause.until === null || Date.parse(prefs.pause.until) > nowMs)) return false
  if (category === "summary") return true
  return !prefs.muted.includes(category)
}
