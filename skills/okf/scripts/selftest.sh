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
require_grep 'provider: ollama' "$ROOT/templates/okf-embeddings.yaml" "embedding manifest template uses ollama default"
require_grep 'model: nomic-embed-text' "$ROOT/templates/okf-embeddings.yaml" "embedding manifest template uses nomic-embed-text"

python3 - "$ROOT" <<'PY'
import importlib.util
from pathlib import Path
import json
import math
import subprocess
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

python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import math
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
embed = root / "scripts" / "embed.py"

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

def run_embed(bundle):
    return subprocess.run(
        [sys.executable, str(embed), "--bundle", str(bundle), "--profile", "test"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(
        bundle / "okf-embeddings.yaml",
        """okf_embeddings_version: "0.1"
default_profile: test
profiles:
  test:
    provider: fake
    model: fake-embed
    dim: 4
    share: true
chunking:
  strategy: concept
  max_tokens: 512
hash: sha256
vectors_dir: embeddings
""",
    )
    write(bundle / "a.md", "---\ntype: Guide\ntitle: A\n---\n\nAlpha body.\n")
    write(bundle / "b.md", "---\ntype: Guide\ntitle: B\n---\n\nBeta body.\n")
    write(bundle / "skip.md", "---\ntype: Guide\ntitle: Skip\nx_embed: exclude\n---\n\nSkip body.\n")

    first = run_embed(bundle)
    assert first.returncode == 0, first.stderr
    shard = bundle / "embeddings" / "test.okfe.jsonl"
    first_lines = shard.read_text(encoding="utf-8").splitlines()
    first_records = [json.loads(line) for line in first_lines]
    assert [record["id"] for record in first_records] == ["a#0", "b#0"]
    for record in first_records:
        assert all(round(value, 6) == value for value in record["v"])
        assert math.isclose(sum(value * value for value in record["v"]), 1.0, rel_tol=0, abs_tol=0.000002)

    write(bundle / "b.md", "---\ntype: Guide\ntitle: B\n---\n\nBeta body changed.\n")
    second = run_embed(bundle)
    assert second.returncode == 0, second.stderr
    second_lines = shard.read_text(encoding="utf-8").splitlines()
    assert first_lines[0] == second_lines[0], "unchanged concept line changed"
    assert first_lines[1] != second_lines[1], "edited concept line did not change"

    roundtrip = [json.dumps(json.loads(line), sort_keys=True, separators=(",", ":")) for line in second_lines]
    assert roundtrip == second_lines

    write(bundle / "skip.md", "---\ntype: Guide\ntitle: Skip\n---\n\nSkip body.\n")
    third = run_embed(bundle)
    assert third.returncode == 0, third.stderr
    third_records = [json.loads(line) for line in shard.read_text(encoding="utf-8").splitlines()]
    assert [record["id"] for record in third_records] == ["a#0", "b#0", "skip#0"]

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(
        bundle / "okf-embeddings.yaml",
        """okf_embeddings_version: "0.1"
default_profile: bad
profiles:
  bad:
    provider: ollama
    model: nomic-embed-text
    dim: 768
    endpoint: http://example.com:11434
chunking:
  strategy: concept
  max_tokens: 512
hash: sha256
vectors_dir: embeddings
""",
    )
    write(bundle / "a.md", "---\ntype: Guide\n---\n\nAlpha body.\n")
    bad = subprocess.run([sys.executable, str(embed), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert bad.returncode == 2
    assert "ollama endpoint must be localhost" in bad.stderr
    assert not (bundle / "embeddings").exists()

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(
        bundle / "okf-embeddings.yaml",
        """okf_embeddings_version: "0.1"
default_profile: bad
profiles:
  bad:
    provider: fake
    dim: 4
chunking:
  strategy: concept
  max_tokens: 512
hash: sha256
vectors_dir: embeddings
""",
    )
    missing = subprocess.run([sys.executable, str(embed), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert missing.returncode == 2
    assert "missing model" in missing.stderr

print("ok - embed.py fake-provider incremental shards, exclusions, ollama guard, and manifest errors")
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
