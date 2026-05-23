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

| Panopticon platform key | Release asset | SHA-256 |
| --- | --- | --- |
| `linux-x64` | `rtk-x86_64-unknown-linux-musl.tar.gz` | `90ae10f5c76de9bacaec5eeeefb6012f74dd47f4e280ec614295555b64da6b57` |
| `linux-arm64` | `rtk-aarch64-unknown-linux-gnu.tar.gz` | `68d6fedfd76f16437eb79cb659169ef8bc3994124486cc71d9479a1b241b7812` |
| `darwin-arm64` | `rtk-aarch64-apple-darwin.tar.gz` | `8b9751f927da4fb433be23f24f205bf1c22f9dd6949790c0980d2cc91b14658c` |
| `darwin-x64` | `rtk-x86_64-apple-darwin.tar.gz` | `b2729d9983b38af77824a5c7a3c23de415533be9fb022a5e473904ecc9620db9` |

The release also publishes `.deb`, `.rpm`, and Windows assets, but the Panopticon hook installer should use tarballs for the cross-platform `~/.panopticon/bin/rtk` install path. No supported Panopticon target is blocked by missing prebuilt binaries in `v0.41.0`.

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

`rtk pipe --filter <name>` exists and reads raw stdin to stdout, but it is not the primary Panopticon PreToolUse integration because PreToolUse runs before Bash execution and cannot observe post-command output. The Panopticon wrapper should therefore gate config/binary availability itself, then delegate the JSON rewrite to `rtk hook claude`.
