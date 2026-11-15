// UI commands (PAN-5349 O-D4): short-lived server-to-browser instructions,
// such as "open this path". Streamed on `pan.subscribeUiCommands` and never
// stored, unlike domain events.
import { Schema } from "effect"

/** The server's answer for a path: which deck, root and file or folder to show. */
export const UiOpenResolution = Schema.Struct({
  projectKey: Schema.String,
  rootId: Schema.String,
  /** POSIX path relative to the root folder; `''` for the root itself. */
  relPath: Schema.String,
  kind: Schema.Literals(["file", "dir"]),
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
})
export type UiOpenResolution = typeof UiOpenResolution.Type

/** One UI command. `id` is a random UUID that tabs use to dedupe handling. */
export const UiCommand = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("open-path"),
  resolution: UiOpenResolution,
})
export type UiCommand = typeof UiCommand.Type
