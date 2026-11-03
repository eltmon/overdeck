// The phone app pair link (PAN-4823 W-MAC2, PAN-4836): the text of the QR a machine shows in
// Settings → Anywhere → Set up a phone → Overdeck app. The phone app (PAN-4837) parses it.

/** The phone app's bundle id and private-use URI scheme (RFC 8252 §7.1). */
export const PHONE_APP_SCHEME = "ai.overdeck.app"
export const PHONE_PAIR_LINK_VERSION = 1
/** Everything before the fragment. Single slash after the colon. */
export const PHONE_PAIR_LINK_PREFIX = `${PHONE_APP_SCHEME}:/pair#`

export const PHONE_PAIR_ENVIRONMENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const PHONE_PAIR_MACHINE_KEY_RE = /^[0-9a-f]{64}$/
export const PHONE_PAIR_CODE_RE = /^odp_[0-9a-f]{64}$/

export interface PhonePairLinkInput {
  environmentId: string
  machineKeyHex: string
  code: string
}

/** `ai.overdeck.app:/pair#v=1&e=<environmentId>&k=<machineKeyHex>&c=<code>`; throws on a malformed input. */
export function buildPhonePairLink(input: PhonePairLinkInput): string {
  if (!PHONE_PAIR_ENVIRONMENT_ID_RE.test(input.environmentId)) throw new Error("environmentId must be a lowercase UUID v4")
  if (!PHONE_PAIR_MACHINE_KEY_RE.test(input.machineKeyHex)) throw new Error("machineKeyHex must be 64 lowercase hex characters")
  if (!PHONE_PAIR_CODE_RE.test(input.code)) throw new Error("code must be an odp_ pairing code")
  return `${PHONE_PAIR_LINK_PREFIX}v=${PHONE_PAIR_LINK_VERSION}&e=${input.environmentId}&k=${input.machineKeyHex}&c=${input.code}`
}

/** The inverse of `buildPhonePairLink`: the link's fields, or null unless every part is well formed. Surrounding whitespace is ignored. */
export function parsePhonePairLink(text: string): PhonePairLinkInput | null {
  const link = text.trim()
  if (!link.startsWith(PHONE_PAIR_LINK_PREFIX)) return null
  const params = new URLSearchParams(link.slice(PHONE_PAIR_LINK_PREFIX.length))
  const environmentId = params.get("e")
  const machineKeyHex = params.get("k")
  const code = params.get("c")
  if (params.get("v") !== String(PHONE_PAIR_LINK_VERSION)) return null
  if (environmentId === null || !PHONE_PAIR_ENVIRONMENT_ID_RE.test(environmentId)) return null
  if (machineKeyHex === null || !PHONE_PAIR_MACHINE_KEY_RE.test(machineKeyHex)) return null
  if (code === null || !PHONE_PAIR_CODE_RE.test(code)) return null
  return { environmentId, machineKeyHex, code }
}
