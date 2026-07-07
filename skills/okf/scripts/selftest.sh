#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL="$ROOT/SKILL.md"
SPEC="$ROOT/references/spec.md"
README="$ROOT/README.md"
OKFE="$ROOT/references/okf-embeddings.md"

require_grep() {
  local pattern="$1"
  local file="$2"
  local label="$3"

  if grep -Eq "$pattern" "$file"; then
    printf 'ok - %s\n' "$label"
    return 0
  fi

  printf 'not ok - %s\n' "$label" >&2
  printf 'missing pattern: %s in %s\n' "$pattern" "$file" >&2
  return 1
}

for command in init author convert sync study retro extract validate lint embed; do
  require_grep "^## \`/okf ${command}" "$SKILL" "SKILL.md documents /okf ${command}"
done

require_grep 'read `index.md` first' "$SKILL" "reading rule: read index first"
require_grep 'load only relevant concepts' "$SKILL" "reading rule: load only relevant concepts"
require_grep 'answer only from loaded concepts' "$SKILL" "reading rule: answer only from loaded concepts"
require_grep 'cite concept IDs' "$SKILL" "reading rule: cite concept IDs"
require_grep 'never invent missing knowledge' "$SKILL" "reading rule: never invent"

require_grep 'ee67a5ca27044ebe7c38385f5b6cffc2305a9c1a' "$SPEC" "spec includes upstream source commit SHA"
require_grep 'Apache-2.0' "$SPEC" "spec includes Apache-2.0 attribution"
require_grep '^# Open Knowledge Format \(OKF\)' "$SPEC" "spec includes vendored OKF text"

python3 - "$SKILL" "$README" <<'PY'
import re
import sys
from pathlib import Path

skill = Path(sys.argv[1]).read_text(encoding="utf-8")
readme = Path(sys.argv[2]).read_text(encoding="utf-8")

command_re = re.compile(r"\| `(/okf [^`]+)` \|")
skill_commands = command_re.findall(skill)
readme_commands = command_re.findall(readme)

if skill_commands != readme_commands:
    raise SystemExit(f"README command drift: SKILL={skill_commands!r} README={readme_commands!r}")

mutated = "\n".join(line for line in readme.splitlines() if "`/okf lint`" not in line)
mutated_commands = command_re.findall(mutated)
if skill_commands == mutated_commands:
    raise SystemExit("README command drift negative check did not detect a mismatch")

print("ok - README command names match SKILL.md table and drift check detects mismatch")
PY

require_grep 'mkdir -p ~/.claude/skills' "$README" "README includes standalone copy-install path"
require_grep 'git, gh, Python 3, and PyYAML' "$README" "README names standalone requirements"
require_grep 'okf_embeddings_version: "0.1"' "$OKFE" "okf-embeddings doc includes manifest schema"
require_grep '"id":"tables/orders#0"' "$OKFE" "okf-embeddings doc includes shard line format"
require_grep 'Lines are sorted by `id`' "$OKFE" "okf-embeddings doc includes sorting rule"
require_grep 'okf_embeddings_version` controls compatibility' "$OKFE" "okf-embeddings doc includes succession clause"

python3 - "$ROOT" <<'PY'
import importlib.util
from pathlib import Path
import sys
import tempfile

root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("okf_common", root / "scripts" / "okf_common.py")
okf_common = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules["okf_common"] = okf_common
spec.loader.exec_module(okf_common)

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    concept = bundle / "systems" / "payroll.md"
    concept.parent.mkdir()
    concept.write_text(
        """---
type: Module
title: Payroll
description: Payroll rules.
x_custom: keep-me
timestamp: 2026-07-07T00:00:00Z
---

# Payroll

See [overtime](/policies/overtime.md).

```markdown
[ignored](ignored.md)
```
""",
        encoding="utf-8",
    )

    parsed = okf_common.parse_concept(concept, bundle)
    assert parsed.concept_id == "systems/payroll"
    serialized = okf_common.serialize_concept(parsed.frontmatter, parsed.body)
    reparsed_frontmatter, reparsed_body = okf_common.split_frontmatter(serialized)
    assert reparsed_frontmatter["x_custom"] == "keep-me"
    assert reparsed_frontmatter["type"] == "Module"
    assert "# Payroll" in reparsed_body

    changed_timestamp = dict(parsed.frontmatter)
    changed_timestamp["timestamp"] = "2026-07-08T00:00:00Z"
    assert okf_common.normalized_content_hash(parsed.frontmatter, parsed.body) == okf_common.normalized_content_hash(
        changed_timestamp, parsed.body
    )

    links = okf_common.resolved_concept_links(concept, parsed.body, bundle)
    assert links == ["policies/overtime"], links

    fenced_only = "```markdown\n[ignored](other.md)\n```\n"
    assert okf_common.markdown_links(fenced_only) == []

print("ok - okf_common.py fixture round-trip, timestamp-stable hash, and fenced-link behavior")
PY

if grep -InE '^(from|import) ' "$ROOT/scripts/okf_common.py" | grep -Ev ' (annotations|dataclasses|hashlib|pathlib|re|typing|yaml)( |$)|^.*from __future__ import annotations$'; then
  printf 'not ok - okf_common.py imports only stdlib and yaml\n' >&2
  exit 1
fi
printf 'ok - okf_common.py imports only stdlib and yaml\n'

if grep -RInE 'from +(overdeck|pan)|import +(overdeck|pan)|require\(["'\''](overdeck|pan)' "$ROOT" --include='*.py' --include='*.js' --include='*.ts' --include='*.sh'; then
  printf 'not ok - no Overdeck code dependency under skills/okf\n' >&2
  exit 1
fi
printf 'ok - no Overdeck code dependency under skills/okf\n'

printf 'ok - okf scaffold selftest complete\n'
