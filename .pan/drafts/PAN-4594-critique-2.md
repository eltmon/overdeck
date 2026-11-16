plan-digest: 80135fd8495d8880756459fa24d09e698b18824a3f94a7a88f06b9d930e8dfce

## blocks-the-design: Trimming can persist a rejected rule config

PRD WI-1 validates the raw candidate before writing trimmed `configs` (`.pan/drafts/PAN-4594.md`, lines 259–268). The existing validator checks `!entry.startsWith('-')` before it trims entries (`src/lib/config-yaml/semgrep.ts`, lines 92–99). I ran `normalizeSecurityConfig({ semgrep: { configs: [' -bad'] } }, DEFAULT_NORMALIZED_SECURITY)`: it accepted the input and returned `['-bad']`; validating that returned value threw `config.yaml: security.semgrep.configs must be a non-empty list of rule ids or paths`. WI-1 would write `-bad`, then fail in `viewFromDocument`, leaving `config.yaml` with a value the loader rejects. Validate the exact trimmed candidate before writing, and add a no-write regression case for `configs: [' -bad']` (or reject it in the shared validator before trimming).
