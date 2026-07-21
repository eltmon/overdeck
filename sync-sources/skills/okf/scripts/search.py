#!/usr/bin/env python3
"""Search an OKF bundle with BM25, optional vectors, and RRF."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
from typing import Any

import yaml

import build_index
from embed import EmbedError, profile_config, provider_embed


RRF_K = 60


def ensure_index(bundle_root: Path) -> Path:
    path = build_index.index_path(bundle_root)
    if not path.exists():
        return build_index.rebuild_index(bundle_root)
    return path


def fts_query(query: str) -> str:
    terms = re.findall(r"[A-Za-z0-9_]+", query)
    return " OR ".join(terms) if terms else query


def load_manifest(bundle_root: Path) -> dict[str, Any] | None:
    path = bundle_root / "okf-embeddings.yaml"
    if not path.exists():
        return None
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else None


def bm25_results(conn: sqlite3.Connection, query: str, limit: int) -> list[dict[str, Any]]:
    match = fts_query(query)
    rows = conn.execute(
        """
        SELECT c.id, c.path, c.type, c.title, c.description, c.body, c.tokens, bm25(concepts_fts) AS score
        FROM concepts_fts
        JOIN concepts c ON c.rowid = concepts_fts.rowid
        WHERE concepts_fts MATCH ?
        ORDER BY score ASC
        LIMIT ?
        """,
        (match, limit),
    ).fetchall()
    return [row_to_result(row, "bm25", index + 1) for index, row in enumerate(rows)]


def row_to_result(row: sqlite3.Row, source: str, rank: int) -> dict[str, Any]:
    return {
        "id": row["id"],
        "path": row["path"],
        "type": row["type"],
        "title": row["title"],
        "description": row["description"],
        "body": row["body"],
        "tokens": int(row["tokens"]),
        "source": source,
        "rank": rank,
    }


def dot(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def vector_results(conn: sqlite3.Connection, bundle_root: Path, query: str, profile_name: str | None, limit: int) -> list[dict[str, Any]]:
    manifest = load_manifest(bundle_root)
    if not manifest:
        return []
    try:
        resolved_profile, profile = profile_config(manifest, profile_name)
        query_vector = provider_embed(profile, [query])[0]
    except EmbedError:
        return []

    rows = conn.execute(
        """
        SELECT v.concept, v.vector_json, c.id, c.path, c.type, c.title, c.description, c.body, c.tokens
        FROM vectors v
        JOIN concepts c ON c.id = v.concept
        WHERE v.profile = ?
        """,
        (resolved_profile,),
    ).fetchall()
    scored: list[tuple[float, sqlite3.Row]] = []
    for row in rows:
        vector = [float(value) for value in json.loads(row["vector_json"])]
        if len(vector) == len(query_vector):
            scored.append((dot(query_vector, vector), row))
    scored.sort(key=lambda item: item[0], reverse=True)
    return [row_to_result(row, "vector", index + 1) for index, (_score, row) in enumerate(scored[:limit])]


def index_guided_results(conn: sqlite3.Connection, limit: int) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT id, path, type, title, description, body, tokens FROM concepts ORDER BY id LIMIT ?",
        (limit,),
    ).fetchall()
    return [row_to_result(row, "index", index + 1) for index, row in enumerate(rows)]


def rrf_merge(bm25: list[dict[str, Any]], vectors: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    scores: dict[str, float] = {}
    sources: dict[str, set[str]] = {}
    for result_set in (bm25, vectors):
        for rank, result in enumerate(result_set, start=1):
            by_id.setdefault(result["id"], result)
            scores[result["id"]] = scores.get(result["id"], 0.0) + (1.0 / (RRF_K + rank))
            sources.setdefault(result["id"], set()).add(result["source"])
    ordered = sorted(scores, key=lambda concept_id: (-scores[concept_id], concept_id))
    merged: list[dict[str, Any]] = []
    for concept_id in ordered[:limit]:
        result = dict(by_id[concept_id])
        result["source"] = "+".join(sorted(sources[concept_id]))
        result["score"] = round(scores[concept_id], 6)
        merged.append(result)
    return merged


def apply_budget(results: list[dict[str, Any]], budget: int | None) -> list[dict[str, Any]]:
    if not budget:
        return results
    selected: list[dict[str, Any]] = []
    used = 0
    for result in results:
        if used + result["tokens"] > budget:
            continue
        selected.append(result)
        used += result["tokens"]
    return selected


def mnemos_results(bundle_root: Path, query: str, limit: int) -> list[dict[str, Any]] | None:
    if not shutil.which("mnemos"):
        return None
    proc = subprocess.run(
        ["mnemos", "search", str(bundle_root), query, "--json", "--limit", str(limit)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        return None
    data = json.loads(proc.stdout or "[]")
    results: list[dict[str, Any]] = []
    for index, item in enumerate(data, start=1):
        citation = str(item.get("citation") or item.get("file") or "")
        concept_id = citation.split("#", 1)[0].removesuffix(".md")
        results.append(
            {
                "id": concept_id,
                "path": f"{concept_id}.md",
                "type": item.get("type", ""),
                "title": item.get("title", concept_id),
                "description": item.get("description", ""),
                "body": item.get("text", ""),
                "tokens": len(str(item.get("text", "")).split()) or 1,
                "source": "mnemos",
                "rank": index,
            }
        )
    return results


def search(bundle_root: Path, query: str, profile: str | None, limit: int, budget: int | None, backend: str) -> dict[str, Any]:
    if backend in {"auto", "mnemos"}:
        mnemos = mnemos_results(bundle_root, query, limit)
        if mnemos is not None:
            return {"tier": "mnemos", "results": apply_budget(mnemos, budget)}
        if backend == "mnemos":
            return {"tier": "mnemos-unavailable", "results": []}

    db_path = ensure_index(bundle_root)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        bm25 = bm25_results(conn, query, limit)
        vectors = vector_results(conn, bundle_root, query, profile, limit)
        if bm25 and vectors:
            return {"tier": "hybrid", "results": apply_budget(rrf_merge(bm25, vectors, limit), budget)}
        if bm25:
            return {"tier": "bm25-only", "results": apply_budget(bm25, budget)}
        return {"tier": "index-guided", "results": apply_budget(index_guided_results(conn, limit), budget)}
    finally:
        conn.close()


def prompt_output(payload: dict[str, Any]) -> str:
    lines = [f"tier: {payload['tier']}"]
    for result in payload["results"]:
        lines.append("")
        lines.append(f"## {result['id']}")
        if result.get("description"):
            lines.append(str(result["description"]))
        lines.append(f"citation: {result['path']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Search an OKF bundle")
    parser.add_argument("query")
    parser.add_argument("--bundle", default=".", help="bundle root")
    parser.add_argument("--profile", help="embedding profile")
    parser.add_argument("--format", choices=("prompt", "json"), default="prompt")
    parser.add_argument("--budget", type=int)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--backend", choices=("auto", "builtin", "mnemos"), default="auto")
    args = parser.parse_args(argv)

    payload = search(Path(args.bundle).resolve(), args.query, args.profile, args.limit, args.budget, args.backend)
    if args.format == "json":
        print(json.dumps(payload, sort_keys=True))
    else:
        print(prompt_output(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
