#!/usr/bin/env python3
"""Build the derived OKF SQLite search index."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sqlite3
import sys
from typing import Any

from okf_common import iter_concept_paths, parse_concept


INDEX_DIR = ".okf-index"
INDEX_NAME = "okf.db"


def index_path(bundle_root: Path) -> Path:
    return bundle_root / INDEX_DIR / INDEX_NAME


def concept_title(frontmatter: dict[str, Any], concept_id: str) -> str:
    return str(frontmatter.get("title") or concept_id.rsplit("/", 1)[-1].replace("-", " ").title())


def concept_description(frontmatter: dict[str, Any]) -> str:
    return str(frontmatter.get("description") or "")


def token_estimate(*parts: str) -> int:
    return sum(len(part.split()) for part in parts)


def read_vector_shards(bundle_root: Path, vectors_dir: str = "embeddings") -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    shard_dir = bundle_root / vectors_dir
    if not shard_dir.exists():
        return records
    for path in sorted(shard_dir.glob("*.okfe.jsonl")):
        profile = path.name.removesuffix(".okfe.jsonl")
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            record["profile"] = profile
            records.append(record)
    return records


def rebuild_index(bundle_root: Path) -> Path:
    db_path = index_path(bundle_root)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(
            """
            CREATE TABLE concepts (
              id TEXT PRIMARY KEY,
              path TEXT NOT NULL,
              type TEXT NOT NULL,
              title TEXT NOT NULL,
              description TEXT NOT NULL,
              body TEXT NOT NULL,
              tokens INTEGER NOT NULL
            );
            CREATE VIRTUAL TABLE concepts_fts USING fts5(id, title, description, body);
            CREATE TABLE vectors (
              id TEXT PRIMARY KEY,
              concept TEXT NOT NULL,
              profile TEXT NOT NULL,
              hash TEXT NOT NULL,
              dim INTEGER NOT NULL,
              vector_json TEXT NOT NULL
            );
            """
        )

        for path in iter_concept_paths(bundle_root):
            concept = parse_concept(path, bundle_root)
            title = concept_title(concept.frontmatter, concept.concept_id)
            description = concept_description(concept.frontmatter)
            concept_type = str(concept.frontmatter.get("type") or "")
            tokens = token_estimate(title, description, concept.body)
            cursor = conn.execute(
                "INSERT INTO concepts (id, path, type, title, description, body, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (concept.concept_id, path.relative_to(bundle_root).as_posix(), concept_type, title, description, concept.body, tokens),
            )
            rowid = cursor.lastrowid
            conn.execute(
                "INSERT INTO concepts_fts (rowid, id, title, description, body) VALUES (?, ?, ?, ?, ?)",
                (rowid, concept.concept_id, title, description, concept.body),
            )

        for record in read_vector_shards(bundle_root):
            conn.execute(
                "INSERT OR REPLACE INTO vectors (id, concept, profile, hash, dim, vector_json) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    record["id"],
                    record["concept"],
                    record["profile"],
                    record["hash"],
                    int(record["dim"]),
                    json.dumps(record["v"], separators=(",", ":")),
                ),
            )

        conn.commit()
    finally:
        conn.close()
    return db_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the OKF derived search index")
    parser.add_argument("--bundle", default=".", help="bundle root")
    parser.add_argument("--rebuild", action="store_true", help="accepted for explicit rebuild calls")
    args = parser.parse_args(argv)

    path = rebuild_index(Path(args.bundle).resolve())
    print(f"ok - built {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
