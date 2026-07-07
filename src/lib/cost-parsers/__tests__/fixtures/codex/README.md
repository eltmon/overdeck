# Codex Cost Parser Fixtures

- `rollout-nested-single-turn.jsonl` derives from a local Codex session captured on 2026-07-03. It exercises the nested cli >= 0.137 rollout schema with one usage-bearing `token_count` record.
- `rollout-nested-multi-turn.jsonl` derives from a local Codex session captured on 2026-05-31. It exercises the nested rollout schema with multiple usage-bearing `token_count` records.
- `rollout.jsonl` is the existing synthetic legacy flat-schema fixture. Local April 2026 rollout files were checked for a pre-wrapper flat schema, but they all carried `payload` wrappers, so no real April flat fixture was available.

Real prompt, response, reasoning, encrypted, and instruction text was replaced with short placeholders. Token usage structures and numeric usage values were preserved.
