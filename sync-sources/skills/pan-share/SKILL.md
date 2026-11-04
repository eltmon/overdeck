---
name: pan-share
description: "pan share <conversation> — share a conversation by link and print the join link and join code"
triggers:
  - pan share
  - share this conversation
  - share conversation link
allowed-tools:
  - Bash
---

# Share a Conversation

## Overview

`pan share <conversation>` creates the share for one conversation, or finds the one that is already
live, and prints the join link, the join code (`BCDF-GHJK`) and the two commands a viewer can run.
It calls the running dashboard with this machine's internal token. It never starts a dashboard: the
host side of a share lives in the full `pan up` stack.

## Before You Run It

- The dashboard must be running (`pan up`).
- The machine must be signed in to overdeck.ai (`pan account login`).

## Find the Conversation

Pass the conversation id or its name. The id is the number in a dashboard URL such as `/conv/2972`.
From inside a conversation, print your own:

```bash
pan conversations current --json
```

## Quick Command

```bash
pan share 2972
pan share 2972 --json   # the ShareView JSON only, for scripts
```

## What to Send the Other Person

Send the link, or the join code with one of the join commands the output prints:

- `pan join BCDF-GHJK` when they have Overdeck installed.
- `npx @overdeck/core join BCDF-GHJK` when they do not. It needs Node 22 or newer.

Joiners wait in the lobby. Let them in from the share dialog in the dashboard (⋮ → Share this
conversation). Admit, kick and revoke are not CLI commands.

## Errors

- **`The Overdeck dashboard is not running`** — start it with `pan up`, then run `pan share` again.
- **`Sign in with pan account login to share conversations.`** (`not_signed_in`) — run
  `pan account login` first.
- **`conversation_not_found`** — the name or id does not match a conversation on this machine.
- **HTTP 409 with a release message** — the conversation was released to another machine. Share it
  from the machine that holds it.
