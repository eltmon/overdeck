# RTK integration

PAN-1407 pins RTK at `v0.41.0` (`rtk 0.41.0`) from `rtk-ai/rtk` GitHub releases.

## Release URL pattern

Use GitHub release assets under:

```text
https://github.com/rtk-ai/rtk/releases/download/v0.41.0/<asset-name>
```

The installer should keep both constants explicit:

```ts
const RTK_VERSION = "0.41.0";
const RTK_RELEASE_TAG = "v0.41.0";
```

## Platform asset mapping

| Overdeck platform key | Release asset | SHA-256 |
| --- | --- | --- |
| `linux-x64` | `rtk-x86_64-unknown-linux-musl.tar.gz` | `90ae10f5c76de9bacaec5eeeefb6012f74dd47f4e280ec614295555b64da6b57` |
| `linux-arm64` | `rtk-aarch64-unknown-linux-gnu.tar.gz` | `68d6fedfd76f16437eb79cb659169ef8bc3994124486cc71d9479a1b241b7812` |
| `darwin-arm64` | `rtk-aarch64-apple-darwin.tar.gz` | `8b9751f927da4fb433be23f24f205bf1c22f9dd6949790c0980d2cc91b14658c` |
| `darwin-x64` | `rtk-x86_64-apple-darwin.tar.gz` | `b2729d9983b38af77824a5c7a3c23de415533be9fb022a5e473904ecc9620db9` |

The release also publishes `.deb`, `.rpm`, and Windows assets, but the Overdeck hook installer should use tarballs for the cross-platform `~/.panopticon/bin/rtk` install path. No supported Overdeck target is blocked by missing prebuilt binaries in `v0.41.0`.

## Checksum validation

The release publishes `checksums.txt` at:

```text
https://github.com/rtk-ai/rtk/releases/download/v0.41.0/checksums.txt
```

Validate downloads by calculating SHA-256 for the downloaded archive and comparing it to the table above, which is copied from `checksums.txt`. GitHub also exposes the same digest on each release asset as `sha256:<hash>`.

## CLI invocation contract

Use RTK's built-in Claude Code hook processor rather than a custom stdout pipe:

```bash
printf '%s' "$PRE_TOOL_USE_JSON" | ~/.panopticon/bin/rtk hook claude
```

The command reads the Claude Code `PreToolUse` JSON envelope from stdin. For a rewritable Bash tool call, it exits `0` and writes a JSON response on stdout with `hookSpecificOutput.updatedInput.command` set to the rewritten command. Example input:

```json
{"tool_name":"Bash","tool_input":{"command":"git status"}}
```

Example output:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecisionReason":"RTK auto-rewrite","updatedInput":{"command":"rtk git status"}}}
```

For non-Bash tools or unsupported Bash commands, `rtk hook claude` exits `0` and writes no stdout. Claude Code treats that as passthrough. The lower-level `rtk rewrite <command>` helper can be used for diagnostics: it exits `0` and prints a rewritten command such as `rtk git status` when supported; it exits nonzero when no rewrite exists.

The rewritten command then executes normally through Bash. RTK subcommands proxy the underlying command and print compact stdout/stderr for supported command families (`git`, `gh`, `find`, `grep`, `npm`, `vitest`, `tsc`, and others). `rtk --version` exits `0` and prints `rtk 0.41.0` for the pinned binary.

`rtk pipe --filter <name>` exists and reads raw stdin to stdout, but it is not the primary Overdeck PreToolUse integration because PreToolUse runs before Bash execution and cannot observe post-command output. The Overdeck wrapper should therefore gate config/binary availability itself, then delegate the JSON rewrite to `rtk hook claude`.

## Smoke observation: PAN-1410

On 2026-05-23, `agent-pan-1410` was spawned with `OVERDECK_RTK_ENABLED=true` and the work role's `Bash` PreToolUse matcher installed. The agent completed PAN-1410, produced commits through the normal bead workflow, passed `npm run typecheck`, `npm run lint`, and `npm test`, pushed `origin/feature/pan-1410`, and `pan done PAN-1410` moved the issue to In Review.

Representative Bash transcript entries showed large command outputs reduced to model-visible persisted previews: `npm run build` reported a 153.9KB persisted output with a 2KB preview, `npm run lint` reported a 41KB persisted output with a 2KB preview, and the final `npm test` completed successfully with `npm test exit 0`. No RTK hook errors or Bash execution corruption appeared in the tmux capture.

## Cost benchmark

Reproducible A/B steps:

1. Pick a representative command that emits enough Bash output to matter; for PAN-1407, use `git diff 47a8df418...HEAD` from the feature branch.
2. Capture the raw output with RTK disabled: `OVERDECK_RTK_ENABLED=0 git diff 47a8df418...HEAD > raw.txt`.
3. Capture the RTK output that the hook would execute: `~/.panopticon/bin/rtk git diff 47a8df418...HEAD > rtk.txt`.
4. Estimate output tokens as `ceil(bytes / 4)` for both files, then compute `(raw_tokens - rtk_tokens) / raw_tokens * 100`.

Captured measurement on 2026-05-23:

| Command | Variant | Bytes | Estimated output tokens |
| --- | --- | ---: | ---: |
| `git diff 47a8df418...HEAD` | RTK disabled/raw | 31,710 | 7,928 |
| `git diff 47a8df418...HEAD` | RTK enabled (`rtk git diff ...`) | 21,587 | 5,397 |

Reduction: `(7,928 - 5,397) / 7,928 = 31.9%`, clearing the ≥30% PAN-1407 acceptance bar. No follow-up issue is required for this measurement.
