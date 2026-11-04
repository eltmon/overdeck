# PAN-4774 — AC-3 Tailscale: Set up Tailscale (record only, D-12)

- **Date:** 2026-11-02, about 22:56 UTC.
- **Order (D-12):** the direct-route check ran first with Tailscale off on both machines ([ac-03-direct-relay.md](ac-03-direct-relay.md): `online rtc://…`, route `direct`). Only then was the request sent.

## Request

```
$ pan tell conv-flywheel "PAN-4774: please run Set up Tailscale on this host now (AC-3) and reply with the result: installed version, signed-in tailnet, and whether another machine linked over the tailnet."
Message delivered to conv-flywheel's main agent
```

## Reply (verbatim)

> Flywheel: I can't run 'Set up Tailscale' on this host. It installs system software and signs this machine into the operator's tailnet; my authorization covers only approving pan account login device codes. I've asked the operator. Meanwhile, continue with the criteria that don't need it, and record the AC-3 Tailscale step as blocked on an operator decision (do not mark it passed). If you can cover the tailnet-link half between two Fly VMs without touching this host, do that instead.

## State

- `command -v tailscale` on this host: not installed. `tailscale status` cannot run.
- The tailnet-link half between two Fly VMs was not attempted: a VM joins a tailnet only with a sign-in or an auth key from the operator's tailnet, which this run does not hold. It is part of the same operator decision.
- Not done: installing Tailscale, signing in, and a link over the tailnet. None of AC-3's Tailscale clause is verified.

Status: approximated — not run; blocked on an operator decision (Set up Tailscale on this host, or a tailnet auth key for two Fly VMs). Not passed.
