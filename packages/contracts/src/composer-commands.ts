export interface ComposerCommandArgument {
  readonly name: string
  readonly required: boolean
  readonly variadic: boolean
}

export interface ComposerCommandOption {
  readonly flags: string
  readonly description: string
  readonly required: boolean
  readonly valueHint: string | null
}

export interface ComposerCommandManifestEntry {
  readonly id: string
  readonly path: readonly string[]
  readonly display: string
  readonly description: string
  readonly args: readonly ComposerCommandArgument[]
  readonly options: readonly ComposerCommandOption[]
  readonly aliases: readonly string[]
  readonly category: string
}

export type ComposerExecutionMode = "captured" | "detached" | "ui" | "terminal-only"
export type ComposerSafety = "safe" | "dialog" | "destructive"

export interface ComposerCommandPolicy {
  readonly mode: ComposerExecutionMode
  readonly safety: ComposerSafety
  readonly confirmationText?: string
  readonly typedConfirmation?: string
  readonly uiAction?: "handoff" | "fork"
}

export type ComposerCommandResult =
  | {
    readonly kind: "captured"
    readonly status: "completed" | "failed"
    readonly command: string
    readonly output: string
    readonly truncated: boolean
  }
  | {
    readonly kind: "activity"
    readonly status: "accepted"
    readonly command: string
    readonly activityId: string
    readonly message: string
  }
  | {
    readonly kind: "ui"
    readonly status: "requires_ui"
    readonly action: "handoff" | "fork"
    readonly args: Readonly<Record<string, string>>
  }
  | {
    readonly kind: "confirmation"
    readonly status: "confirmation_required"
    readonly nonce: string
    readonly consequence: string
    readonly typedText?: string
  }
  | {
    readonly kind: "terminal-only"
    readonly status: "rejected"
    readonly message: string
  }

export { COMPOSER_COMMAND_MANIFEST } from "./composer-commands.generated"
