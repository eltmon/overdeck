# Overdeck Remodel — Investigations

Evidence base for the Panopticon → **Overdeck** data-architecture remodel
([PAN-1938](https://github.com/eltmon/panopticon-cli/issues/1938)). This directory
collects the **detailed audits**; the high-level rollups feed the orchestrating
design conversation.

## What this remodel is

Not a DB refactor — a **complexity amputation**. We rebuild on a fresh, empty
`overdeck.db` (the old `panopticon.db` stays untouched as a backup, so this is a
*low-risk* big-bang, not a dangerous migration). Because we start empty, we keep
only what we genuinely **NEED**.

## The three locked principles

1. **Reduce complexity — delete a LOT of code.** Every field, table, endpoint,
   and transition must justify itself by a concrete decision it drives. "Nice to
   have" is a delete.
2. **One controller per domain; all data access goes through it.** No code, agent,
   CLI, hook, or route touches a store directly. Reads go through one resolver per
   domain; writes through one write surface. ("State" is not a domain.)
3. **A tiny set of legal moves.** An issue/agent can change pipeline stage in only
   a few sanctioned ways, each behind the domain API — replacing the sprawl of
   ad-hoc transition sites we have today.

## Investigations

| Doc | Question | Status |
|---|---|---|
| [`investigations/review-state-audit.md`](investigations/review-state-audit.md) | Of all the review/verification/merge state fields, which do we actually NEED? | in progress |
| [`investigations/pipeline-transitions.md`](investigations/pipeline-transitions.md) | What are the canonical pipeline stages, and every way an agent moves between them? | done |
| [`investigations/agents-state-audit.md`](investigations/agents-state-audit.md) | Of all the agent runtime fields (table + `state.json`), which do we actually NEED? Does `state.json` survive? | in progress |
