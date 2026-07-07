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
require_grep 'Open the knowledge PR with `gh pr create`' "$SKILL" "sync opens PR through gh"
require_grep 'validate.py --strict' "$SKILL" "sync runs strict validation"
require_grep 'preserve non-matching concepts byte-identically' "$SKILL" "sync topic preserves non-matching concepts"
require_grep 'Append exactly one dated `log.md` entry' "$ROOT/references/workflow.md" "workflow sync appends one dated log entry"
require_grep 'Run `reindex.py`' "$ROOT/references/workflow.md" "workflow sync regenerates index"
require_grep 'never pushes directly to the default branch' "$ROOT/references/workflow.md" "workflow sync is PR-gated"
require_grep 'Infer exactly one concept ID and one concept type' "$SKILL" "author infers one concept and type"
require_grep 'Include `type`, `title`, `description`, `tags`, and `timestamp`' "$SKILL" "author requires recommended frontmatter"
require_grep 'Run `reindex.py`, append a dated `log.md` entry, then run `validate.py --strict`' "$SKILL" "author reindexes logs and validates"
require_grep 'dry-run conversion plan' "$SKILL" "convert starts with dry-run plan"
require_grep 'Apply renames only after explicit confirmation' "$SKILL" "convert gates renames on confirmation"
require_grep 'Never delete or rename a README' "$SKILL" "convert preserves README files"
require_grep 'After confirmed edits, run `reindex.py` and `validate.py --strict`' "$SKILL" "convert validates confirmed edits"
require_grep 'Never delete or rename a README or source document during conversion' "$ROOT/references/conversion.md" "conversion reference preserves README"
require_grep 'infer the narrowest useful type' "$ROOT/references/taxonomy.md" "taxonomy guides author type inference"
require_grep 'pan memory search --issue <id>' "$SKILL" "retro mines Overdeck observations when available"
require_grep 'never import Overdeck code' "$SKILL" "retro forbids Overdeck imports"
require_grep 'Without Overdeck, use `git diff` plus current transcript/session context' "$SKILL" "retro has standalone fallback"
require_grep 'Concepts created from them must cite the recorded decision' "$ROOT/references/overdeck.md" "overdeck retro cites recorded decisions"
require_grep 'The fallback path must still create validating concepts' "$ROOT/references/overdeck.md" "overdeck fallback validates without pan"
require_grep 'opens a PR' "$ROOT/references/overdeck.md" "overdeck retro is PR-gated"
require_grep 'tag produced concepts with it, for example `overtime-calculations`' "$SKILL" "study tags concepts with kebab focus"
require_grep 'Enumerate relevant code, tests, and docs before writing' "$SKILL" "study enumerates codebase evidence"
require_grep 'one concept per idea' "$SKILL" "study writes one concept per idea"
require_grep 'updates existing matching concepts in place' "$SKILL" "study rerun avoids duplicates"
require_grep 'open a knowledge-repo PR' "$SKILL" "study is PR-gated"

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
import os
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

python3 - "$ROOT" <<'PY'
from pathlib import Path
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
embed = root / "scripts" / "embed.py"
build_index = root / "scripts" / "build_index.py"
search = root / "scripts" / "search.py"

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

def run_json(*args, env=None):
    proc = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, check=False)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)

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
    write(bundle / "lexical.md", "---\ntype: Guide\ntitle: Lexical\ndescription: Alpha payroll words.\n---\n\nalpha alpha alpha payroll overtime ledger words\n")
    write(bundle / "semantic.md", "---\ntype: Guide\ntitle: Semantic\ndescription: Related policy.\n---\n\nzeta theta kappa benefits accrual policy\n")
    write(bundle / "tiny.md", "---\ntype: Guide\ntitle: Tiny\n---\n\nshort\n")

    bm25 = run_json(sys.executable, str(search), "alpha payroll", "--bundle", str(bundle), "--backend", "builtin", "--format", "json", "--limit", "3")
    assert bm25["tier"] == "bm25-only"
    assert bm25["results"][0]["id"] == "lexical"

    subprocess.run([sys.executable, str(embed), "--bundle", str(bundle), "--profile", "test"], text=True, check=True, stdout=subprocess.PIPE)
    subprocess.run([sys.executable, str(build_index), "--bundle", str(bundle), "--rebuild"], text=True, check=True, stdout=subprocess.PIPE)
    hybrid = run_json(sys.executable, str(search), "zeta theta", "--bundle", str(bundle), "--backend", "builtin", "--profile", "test", "--format", "json", "--limit", "3")
    assert hybrid["tier"] == "hybrid"
    assert hybrid["results"][0]["source"] in {"bm25+vector", "vector"}

    budgeted = run_json(sys.executable, str(search), "Guide", "--bundle", str(bundle), "--backend", "builtin", "--format", "json", "--budget", "2")
    assert sum(item["tokens"] for item in budgeted["results"]) <= 2

    shutil.rmtree(bundle / ".okf-index")
    rebuilt = run_json(sys.executable, str(search), "alpha payroll", "--bundle", str(bundle), "--backend", "builtin", "--format", "json")
    assert rebuilt["results"]
    assert (bundle / ".okf-index" / "okf.db").exists()

    no_mnemos_env = dict(os.environ)
    no_mnemos_env["PATH"] = tempfile.mkdtemp()
    builtin = run_json(sys.executable, str(search), "alpha payroll", "--bundle", str(bundle), "--format", "json", env=no_mnemos_env)
    assert builtin["tier"] in {"hybrid", "bm25-only"}

    stub_dir = Path(tempfile.mkdtemp())
    stub = stub_dir / "mnemos"
    stub.write_text(
        "#!/usr/bin/env python3\n"
        "import json\n"
        "print(json.dumps([{'citation':'semantic.md#Summary','title':'Semantic','description':'Stubbed','text':'stub result'}]))\n",
        encoding="utf-8",
    )
    stub.chmod(stub.stat().st_mode | stat.S_IXUSR)
    stub_env = dict(os.environ)
    stub_env["PATH"] = f"{stub_dir}{os.pathsep}{stub_env.get('PATH', '')}"
    mnemos = run_json(sys.executable, str(search), "anything", "--bundle", str(bundle), "--format", "json", env=stub_env)
    assert mnemos["tier"] == "mnemos"
    assert mnemos["results"][0]["id"] == "semantic"

print("ok - build_index.py/search.py BM25, hybrid fallback, budget, rebuild, and mnemos paths")
PY

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
search = root / "scripts" / "search.py"

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(bundle / "payroll.md", "---\ntype: Guide\ntitle: Payroll\ndescription: Payroll overtime policy.\n---\n\nOvertime payroll context.\n")
    write(bundle / "benefits.md", "---\ntype: Guide\ntitle: Benefits\ndescription: Benefits policy.\n---\n\nBenefits context.\n")
    proc = subprocess.run(
        [sys.executable, str(search), "overtime payroll", "--bundle", str(bundle), "--format", "prompt", "--budget", "500"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    output = proc.stdout
    assert output.startswith("tier: "), output
    assert len(output.split()) <= 500
    concept_ids = re.findall(r"^## ([A-Za-z0-9_./-]+)$", output, flags=re.MULTILINE)
    assert concept_ids, output
    for concept_id in concept_ids:
        assert (bundle / f"{concept_id}.md").exists(), concept_id

print("ok - extract prompt output states tier and cites existing concept IDs within budget")
PY

python3 - "$ROOT" <<'PY'
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
reindex = root / "scripts" / "reindex.py"

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    handwritten = "# Knowledge\n\nHand-written prose stays here.\n\n"
    write(bundle / "index.md", handwritten + "<!-- OKF:INDEX:BEGIN -->\nold\n<!-- OKF:INDEX:END -->\n\nFooter stays.\n")
    write(bundle / "alpha.md", "---\ntype: Guide\ntitle: Alpha\ndescription: Alpha desc.\n---\n\nAlpha body.\n")
    first = subprocess.run([sys.executable, str(reindex), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert first.returncode == 0, first.stderr
    after_first = (bundle / "index.md").read_text(encoding="utf-8")
    assert after_first.startswith(handwritten)
    assert "Footer stays." in after_first
    assert "* [Alpha](alpha.md) - Alpha desc." in after_first

    write(bundle / "beta.md", "---\ntype: Guide\ntitle: Beta\ndescription: Beta desc.\n---\n\nBeta body.\n")
    second = subprocess.run([sys.executable, str(reindex), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert second.returncode == 0, second.stderr
    after_second = (bundle / "index.md").read_text(encoding="utf-8")
    assert after_second.startswith(handwritten)
    assert "* [Beta](beta.md) - Beta desc." in after_second

    (bundle / "alpha.md").unlink()
    third = subprocess.run([sys.executable, str(reindex), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert third.returncode == 0, third.stderr
    after_third = (bundle / "index.md").read_text(encoding="utf-8")
    assert "* [Alpha](alpha.md)" not in after_third
    assert "* [Beta](beta.md) - Beta desc." in after_third

    log = subprocess.run(
        [sys.executable, str(reindex), "--bundle", str(bundle), "--date", "2026-07-07", "--log-entry", "**Update**: Added [Beta](/beta.md)."],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert log.returncode == 0, log.stderr
    log_text = (bundle / "log.md").read_text(encoding="utf-8")
    assert log_text.splitlines()[2] == "## 2026-07-07"
    assert "* **Update**: Added [Beta](/beta.md)." in log_text

print("ok - reindex.py preserves prose, refreshes marker entries, and appends newest log entries")
PY

python3 - "$ROOT" <<'PY'
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
validate = root / "scripts" / "validate.py"
diff_lint = root / "scripts" / "diff_lint.py"

def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(bundle / "missing.md", "---\ntitle: Missing type\n---\n\nBody.\n")
    proc = subprocess.run([sys.executable, str(validate), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.returncode == 2
    assert "E_TYPE_MISSING" in proc.stdout

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(bundle / "warn.md", "---\ntype: Guide\n---\n\nBody.\n")
    loose = subprocess.run([sys.executable, str(validate), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    strict = subprocess.run([sys.executable, str(validate), "--bundle", str(bundle), "--strict"], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert loose.returncode == 1
    assert strict.returncode == 2
    assert "L_DESCRIPTION_MISSING" in loose.stdout

with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp) / "base"
    head = Path(tmp) / "head"
    write(base / "warn.md", "---\ntype: Guide\n---\n\nBody.\n")
    shutil.copytree(base, head)
    same = subprocess.run([sys.executable, str(diff_lint), "--base", str(base), "--head", str(head)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert same.returncode == 0, same.stdout + same.stderr
    write(head / "bad.md", "---\ntitle: Bad\n---\n\nBody.\n")
    changed = subprocess.run([sys.executable, str(diff_lint), "--base", str(base), "--head", str(head)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert changed.returncode == 2
    assert "NEW ERROR E_TYPE_MISSING" in changed.stdout

with tempfile.TemporaryDirectory() as tmp:
    bundle = Path(tmp)
    write(
        bundle / "okf-embeddings.yaml",
        "okf_embeddings_version: \"0.1\"\ndefault_profile: local\nprofiles: {}\nchunking: {strategy: concept, max_tokens: 512}\nhash: sha256\nvectors_dir: embeddings\n",
    )
    write(bundle / "embeddings" / "local.okfe.jsonl", '{"id":"known#0","concept":"known","hash":"sha256:x","dim":2,"v":[0.6,0.8]}\n')
    write(bundle / "known.md", "---\ntype: Guide\ndescription: Known.\nx_embed: exclude\n---\n\nKnown body.\n")
    clean = subprocess.run([sys.executable, str(validate), "--bundle", str(bundle)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert clean.returncode == 0, clean.stdout + clean.stderr

print("ok - validate.py and diff_lint.py enforce deterministic two-tier conformance")
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
