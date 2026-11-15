# OKF Publish

`scripts/publish.py` builds a read-only static site from the public concepts of a bundle. It uses only the Python standard library and PyYAML. Deploying the site is outside the skill.

## Synopsis

```text
python3 scripts/publish.py [--bundle B] (--out DIR | --check) [--profile FILE]
```

- `--bundle B`: the bundle root. The default is the current directory.
- `--out DIR`: write the site to `DIR`.
- `--check`: scan published text for redaction matches. Write nothing.
- `--profile FILE`: use this redaction profile instead of `<bundle>/okf-publish.yaml`.

`--out` and `--check` are required and mutually exclusive. Run `--check` in CI before `--out`.

## Visibility

Each concept resolves to `public` or `private`. Only public concepts are published.

1. The bundle default comes from `x_visibility_default` in the frontmatter of root `schema.md`.
   - No `schema.md`: the default is `private`.
   - `schema.md` without `x_visibility_default`: the default is `private`.
   - `public` or `private`: that value.
   - Any other value: finding `P_VISIBILITY_INVALID`, and the default is `private`.
2. A concept's own `x_visibility` overrides the default.
   - Absent: the bundle default applies.
   - `public` or `private`: that value.
   - Any other value, including `Public`, `true` and `yes`: finding `P_VISIBILITY_INVALID`, and the concept is private.
3. `schema.md` is an ordinary concept. Its own `x_visibility`, or the default, decides whether it gets a page.

No input resolves to public by accident. When no concept is public, `publish.py` prints why the default is private.

A private concept appears nowhere on the site. It has no page, its index listing line is dropped, it has no search record and it appears in no "Linked from" list.

Index listings fail closed. Inside the generated `<!-- OKF:INDEX:BEGIN -->` … `<!-- OKF:INDEX:END -->` block of an `index.md`, a line is kept only when it is a listing line (`* ` or `- `) whose first link resolves to a public concept or a published directory. Every other line in the block is dropped: private entries, continuation lines of a multi-line description, and lines whose link cannot be parsed, such as a file name with a space. Outside the block, a hand-written listing line is dropped when its first link points at a private, missing or unpublished target; all other hand-written lines are kept, with links to unpublished targets rendered as text.

## Links

A link in published Markdown resolves this way:

| Target | Result |
| --- | --- |
| A public concept, with or without `#fragment` | A page-relative link to its page, keeping the fragment. |
| A published directory, or its `index.md` | A page-relative link to that directory's `index.html`. |
| `http:`, `https:` or `mailto:` | Kept as written. |
| `#fragment` only | Kept as written. |
| Anything else | Plain text: the link text stays and the link goes. |

"Anything else" covers private concepts, missing concepts, unpublished directories, `log.md`, non-Markdown files and every other scheme (`javascript:`, `data:`, `repo:` and so on). A private target and a missing target render identically, so the site does not reveal which private concepts exist. The link text itself is still published, so do not put secrets in link text.

A published directory is a directory that holds a public concept itself or in a subdirectory. The root is always published. Every href is page-relative (for example `../schema.html`), so the site works under a subpath such as a GitHub Pages project site.

## Concept pages

Each concept page shows the concept ID, title, type, status, trust tier, tags, description, rendered body, a "Sources" list and a "Linked from" list. "Linked from" lists public concepts only. Status is frontmatter `status`, or `stable` when absent.

The trust tier comes from `verified` frontmatter:

- `human-reviewed`: any `verified` entry has a `by` value that starts with `human:`.
- `machine-confirmed`: there is at least one `verified` entry, but none by `human:`.
- `unverified`: there are no `verified` entries.

A single mapping counts as a one-element list.

## Redaction profile

`okf-publish.yaml` at the bundle root adds rules. Start from `templates/okf-publish.yaml`.

```yaml
okf_publish_version: "0.1"      # required, must be the string "0.1"
disable_default_rules: []        # optional; ids from the built-in rules
rules:                           # optional; applied after built-in rules
  - id: stream-box-host          # required, unique, matches ^[a-z0-9][a-z0-9-]*$
    pattern: '\bstream-box\.lan\b'   # required, Python re syntax; inline flags such as (?i) allowed
    replace: '[internal-host]'   # optional, default "[redacted]"
private_strings:                 # optional; literal strings, matched case-insensitively
  - Alice Example
```

Rules apply in this order: enabled built-in rules, then `rules`, then `private_strings`. Private string *n* becomes rule `private-string-<n>` with replacement `[redacted]`. It matches case-insensitively, and any run of whitespace, including a line break, matches the spaces between its words, so a name wrapped across two lines is still caught. A replacement is literal text, so `\1` inserts a backslash and a one. Rules apply to every published string before rendering, including fenced code and link targets. A rule that rewrites a link target can turn that link into plain text.

An invalid profile stops the run with `P_PROFILE_INVALID`. That covers unreadable YAML, a top level that is not a mapping, an unknown key, a wrong `okf_publish_version`, an unknown id in `disable_default_rules`, a rule without `id` or `pattern`, an invalid or duplicate id, a pattern that does not compile, an empty private string and a non-string value.

### Built-in rules

Built-in rules apply even with no profile file.

| Id | Pattern | Replacement |
| --- | --- | --- |
| `home-path-unix` | `` /(?:home\|Users)/[^/\s'"`)\]>]+ `` | `~` |
| `home-path-windows` | `` [A-Za-z]:\\Users\\[^\\\s'"`)\]>]+ `` | `~` |
| `ipv4` | four dot-separated numbers from 0 to 255 | `[ip]` |
| `github-token` | `\bgh[pousr]_[A-Za-z0-9]{36,}\b` | `[token]` |
| `openai-style-key` | `\bsk-[A-Za-z0-9_-]{20,}` | `[token]` |
| `aws-access-key` | `\bAKIA[0-9A-Z]{16}\b` | `[token]` |
| `slack-token` | `\bxox[abprs]-[A-Za-z0-9-]{10,}` | `[token]` |
| `private-key-block` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` | `[private-key]` |

`scripts/publish_redact.py` holds the exact patterns in `DEFAULT_RULES`.

`ipv4` also matches `127.0.0.1` and four-part version numbers such as `1.2.3.4`. When that happens, rewrite the text or add `ipv4` to `disable_default_rules`. There is no per-match allow list.

## Output layout

`--out DIR` writes exactly these files, and nothing else:

- `<concept-id>.html` for each public concept, for example `rules/no-spoilers.html`.
- `index.html` for each published directory, the root included. A directory's `index.md` supplies the page, with private listing lines dropped. A directory without `index.md` gets a generated listing.
- `search.html`, `search-index.json`, `assets/style.css` and `assets/search.js`.
- `.okf-publish`, the output marker.

The site title is the first `# ` heading of the root `index.md`, or `Knowledge`. Two runs on the same bundle produce byte-identical files. Search runs in the browser and fetches `search-index.json`, so serve the site over HTTP (`python3 -m http.server --directory DIR`) rather than opening files directly.

## `--out` safety and rebuilds

`publish.py` refuses `--out` with `P_OUT_UNSAFE` when it:

- resolves to the bundle root or an ancestor of it;
- exists and is not a directory; or
- is a non-empty directory without the `.okf-publish` marker.

When the marker is present, every run deletes all entries in `--out` and rebuilds. So a page for a concept that has turned private never survives. An `--out` inside the bundle is allowed and is skipped when walking the bundle.

## Findings and exit codes

Each finding is one line: `ERROR <CODE> <location>: <message>`. The location is a file, a file and line (`rules/a.md:14`), or a directory. Findings never echo matched text, because CI logs of public repos are public.

| Code | Mode | Meaning |
| --- | --- | --- |
| `P_BUNDLE_MISSING` | both | The `--bundle` directory does not exist. |
| `P_PROFILE_INVALID` | both | The redaction profile is invalid. |
| `P_FRONTMATTER_PARSE` | both | A concept's frontmatter does not parse. |
| `P_VISIBILITY_INVALID` | both | `x_visibility` or `x_visibility_default` is not `public` or `private`. |
| `P_ID_REDACTION` | both | A rule matches a public concept ID or a published directory path. URLs cannot be redacted, so rename it or make it private. |
| `P_REDACTION` | `--check` | A rule matches published text. The message names the rule id and the field; body and index findings carry the file line. |
| `P_OUT_UNSAFE` | `--out` | The `--out` directory is unsafe to write (see above). |

| Exit | Meaning |
| --- | --- |
| 0 | `--out`: the site was written. `--check`: no rule matches published text. |
| 2 | Any finding above, or a usage error. With `--out`, nothing is written and the existing `--out` contents stay untouched. |

`--check` scans the source text of public concepts and published index pages. It also scans each body and index line as a reader sees it, with link syntax, backslash escapes and emphasis markers removed, so `**Alice** Example` or `/home\/alice` still fails the check. It passes only after the author removes the matching text. It never passes just because `--out` would redact the text.

## What is never published

- `log.md` files.
- Private concepts, and their titles in index listings, search and backlinks.
- Non-Markdown files such as images and PDFs. An image renders as its alt text.
- Anything under a path component that starts with `.` (for example `.git`, `.github`, `.okf-index`), or under `node_modules`.
- Frontmatter keys other than title, description, type, status, tags and sources. The `verified` entries show only as the derived trust tier.
- Raw HTML in Markdown. It renders as escaped text.
