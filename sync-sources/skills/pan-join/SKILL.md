---
name: pan-join
description: "pan join <link-or-code> — join a shared conversation: sign in, start Overdeck, open the lobby"
triggers:
  - pan join
  - join shared conversation
  - join code
allowed-tools:
  - Bash
---

# Join a Shared Conversation

## Overview

`pan join <link-or-code>` takes a join link (`https://share.overdeck.ai/s/<code>`) or a join code
(`BCDF-GHJK`, dashes and case do not matter) and does the whole join:

1. When the machine is not signed in to overdeck.ai, it runs the device-flow sign-in and prints the
   URL and code to approve.
2. When no dashboard answers on the configured API port, it starts the bundled dashboard in the
   background. It logs to `~/.overdeck/logs/dashboard.log`; a later `pan up` replaces it.
3. It tells the dashboard to join, waits up to 15 seconds for the share service to answer, and opens
   `/#/shared/<CODE>` in the browser, where you wait in the lobby until the host lets you in.

Viewers must be on the overdeck.ai invite list, or the sign-in is refused.

## Quick Command

```bash
pan join BCDF-GHJK
pan join https://share.overdeck.ai/s/BCDFGHJK
pan join BCDF-GHJK --no-open   # headless machine: print the URL instead
```

With `--no-open` the join closes after about 60 seconds with no page open. Opening the printed URL
later rejoins automatically.

## Without Overdeck Installed

On a computer with only Node 22 or newer:

```bash
npx @overdeck/core join BCDF-GHJK
```

It needs no tmux, Herdr or global install.

## When the Join Fails

| Message | What to do |
| --- | --- |
| `This share has ended, or the code is wrong.` | Ask the host for a new link. |
| `overdeck.ai rejected this sign-in.` | Run `pan account login`, then join again. |
| `The host blocked you from this share.` | Ask the host to unblock you. |
| `This share is full.` | Ask the host to make room. |
| `You are the host of this share.` | Open the conversation in your own dashboard. |
| `Cannot reach the share service (...)` | Check the network, then join again. |
| `No Overdeck dashboard answers at <url>. Start it with pan up.` | The API URL is not a local `http://` address, so `pan join` cannot start it. Run `pan up`. |
