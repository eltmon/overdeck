#!/usr/bin/env python3
"""Hash-gated OKF embedding shard writer."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import sys
from typing import Any
from urllib import request
from urllib.parse import urlparse

import yaml

from okf_common import iter_concept_paths, normalized_content, normalized_content_hash, parse_concept


LOCALHOST_NAMES = {"localhost", "127.0.0.1", "::1"}


class EmbedError(RuntimeError):
    pass


def load_manifest(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise EmbedError(f"missing manifest: {path}")
    manifest = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict):
        raise EmbedError("manifest must be a mapping")
    if manifest.get("okf_embeddings_version") != "0.1":
        raise EmbedError("okf_embeddings_version must be 0.1")
    if manifest.get("hash") != "sha256":
        raise EmbedError("hash must be sha256")
    chunking = manifest.get("chunking")
    if not isinstance(chunking, dict) or chunking.get("strategy") != "concept":
        raise EmbedError("chunking.strategy must be concept")
    if "profiles" not in manifest or not isinstance(manifest["profiles"], dict):
        raise EmbedError("manifest missing profiles")
    return manifest


def profile_config(manifest: dict[str, Any], requested_profile: str | None) -> tuple[str, dict[str, Any]]:
    profile_name = requested_profile or manifest.get("default_profile")
    if not profile_name:
        raise EmbedError("manifest missing default_profile")
    profile = manifest["profiles"].get(profile_name)
    if not isinstance(profile, dict):
        raise EmbedError(f"profile not found: {profile_name}")
    for field in ("provider", "model", "dim"):
        if field not in profile or profile[field] in ("", None):
            raise EmbedError(f"profile {profile_name} missing {field}")
    return profile_name, profile


def ensure_ollama_localhost(profile: dict[str, Any]) -> None:
    endpoint = profile.get("endpoint", "http://localhost:11434")
    host = urlparse(endpoint).hostname
    if host not in LOCALHOST_NAMES:
        raise EmbedError(f"ollama endpoint must be localhost, got {endpoint}")


def l2_normalize(vector: list[float]) -> list[float]:
    length = math.sqrt(sum(value * value for value in vector))
    if length == 0:
        raise EmbedError("provider returned a zero vector")
    return [round(value / length, 6) for value in vector]


def fake_embed(texts: list[str], dim: int) -> list[list[float]]:
    vectors: list[list[float]] = []
    for text in texts:
        seed = sum((index + 1) * ord(char) for index, char in enumerate(text))
        raw = [float(((seed + i * 37) % 101) + 1) for i in range(dim)]
        vectors.append(l2_normalize(raw))
    return vectors


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=body, headers={"content-type": "application/json", **headers}, method="POST")
    with request.urlopen(req, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def provider_embed(profile: dict[str, Any], texts: list[str]) -> list[list[float]]:
    provider = profile["provider"]
    model = profile["model"]
    dim = int(profile["dim"])

    if provider == "fake":
        return fake_embed(texts, dim)

    if provider == "ollama":
        ensure_ollama_localhost(profile)
        endpoint = profile.get("endpoint", "http://localhost:11434").rstrip("/")
        data = post_json(f"{endpoint}/api/embed", {"model": model, "input": texts}, {})
        embeddings = data.get("embeddings")
    elif provider == "openai":
        api_key = os.environ.get(profile.get("api_key_env", "OPENAI_API_KEY"))
        if not api_key:
            raise EmbedError("openai profile requires OPENAI_API_KEY or api_key_env")
        endpoint = profile.get("endpoint", "https://api.openai.com/v1/embeddings").rstrip("/")
        data = post_json(endpoint, {"model": model, "input": texts}, {"authorization": f"Bearer {api_key}"})
        embeddings = [item["embedding"] for item in data.get("data", [])]
    elif provider == "voyage":
        api_key = os.environ.get(profile.get("api_key_env", "VOYAGE_API_KEY"))
        if not api_key:
            raise EmbedError("voyage profile requires VOYAGE_API_KEY or api_key_env")
        endpoint = profile.get("endpoint", "https://api.voyageai.com/v1/embeddings").rstrip("/")
        data = post_json(endpoint, {"model": model, "input": texts}, {"authorization": f"Bearer {api_key}"})
        embeddings = [item["embedding"] for item in data.get("data", [])]
    elif provider == "custom":
        endpoint = profile.get("endpoint")
        if not endpoint:
            raise EmbedError("custom profile missing endpoint")
        api_key_env = profile.get("api_key_env")
        headers = {}
        if api_key_env:
            api_key = os.environ.get(api_key_env)
            if not api_key:
                raise EmbedError(f"custom profile requires {api_key_env}")
            headers["authorization"] = f"Bearer {api_key}"
        data = post_json(endpoint.rstrip("/"), {"model": model, "input": texts}, headers)
        embeddings = [item["embedding"] for item in data.get("data", [])]
    else:
        raise EmbedError(f"unsupported provider: {provider}")

    if not isinstance(embeddings, list) or len(embeddings) != len(texts):
        raise EmbedError(f"{provider} returned {0 if not isinstance(embeddings, list) else len(embeddings)} embeddings for {len(texts)} texts")
    vectors = [l2_normalize([float(value) for value in embedding]) for embedding in embeddings]
    for vector in vectors:
        if len(vector) != dim:
            raise EmbedError(f"provider returned dim {len(vector)}, expected {dim}")
    return vectors


def shard_path(bundle_root: Path, vectors_dir: str, profile_name: str) -> Path:
    return bundle_root / vectors_dir / f"{profile_name}.okfe.jsonl"


def read_shard(path: Path) -> dict[str, tuple[str, dict[str, Any]]]:
    if not path.exists():
        return {}
    records: dict[str, tuple[str, dict[str, Any]]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        records[record["id"]] = (line, record)
    return records


def shard_line(record: dict[str, Any]) -> str:
    rounded = {**record, "v": [round(float(value), 6) for value in record["v"]]}
    return json.dumps(rounded, sort_keys=True, separators=(",", ":"))


def write_shard(path: Path, lines_by_id: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "".join(f"{lines_by_id[key]}\n" for key in sorted(lines_by_id))
    path.write_text(content, encoding="utf-8")


def concept_text(frontmatter: dict[str, Any], body: str, max_tokens: int) -> str:
    text = normalized_content(frontmatter, body)
    tokens = text.split()
    if len(tokens) <= max_tokens:
        return text
    return " ".join(tokens[:max_tokens])


def update_shard(bundle_root: Path, manifest: dict[str, Any], profile_name: str, profile: dict[str, Any]) -> tuple[int, int, Path]:
    vectors_dir = manifest.get("vectors_dir", "embeddings")
    chunking = manifest["chunking"]
    max_tokens = int(chunking.get("max_tokens", 512))
    dim = int(profile["dim"])
    path = shard_path(bundle_root, vectors_dir, profile_name)
    existing = read_shard(path)
    lines_by_id: dict[str, str] = {}
    pending: list[tuple[str, str, str, str]] = []

    for concept in (parse_concept(path, bundle_root) for path in iter_concept_paths(bundle_root)):
        if concept.frontmatter.get("x_embed") == "exclude":
            continue
        chunk_id = f"{concept.concept_id}#0"
        digest = normalized_content_hash(concept.frontmatter, concept.body)
        existing_line = existing.get(chunk_id)
        if existing_line and existing_line[1].get("hash") == digest and existing_line[1].get("dim") == dim:
            lines_by_id[chunk_id] = existing_line[0]
            continue
        pending.append((chunk_id, concept.concept_id, digest, concept_text(concept.frontmatter, concept.body, max_tokens)))

    if pending:
        vectors = provider_embed(profile, [item[3] for item in pending])
        for (chunk_id, concept_id, digest, _text), vector in zip(pending, vectors):
            lines_by_id[chunk_id] = shard_line(
                {
                    "id": chunk_id,
                    "concept": concept_id,
                    "hash": digest,
                    "dim": dim,
                    "v": vector,
                }
            )

    write_shard(path, lines_by_id)
    return len(pending), len(lines_by_id), path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Update OKF embedding shards")
    parser.add_argument("--bundle", default=".", help="bundle root")
    parser.add_argument("--profile", help="embedding profile name")
    args = parser.parse_args(argv)

    try:
        bundle_root = Path(args.bundle).resolve()
        manifest = load_manifest(bundle_root / "okf-embeddings.yaml")
        profile_name, profile = profile_config(manifest, args.profile)
        if profile["provider"] == "ollama":
            ensure_ollama_localhost(profile)
        rewritten, total, output = update_shard(bundle_root, manifest, profile_name, profile)
    except EmbedError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    print(f"ok - profile={profile_name} rewritten={rewritten} total={total} shard={output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
