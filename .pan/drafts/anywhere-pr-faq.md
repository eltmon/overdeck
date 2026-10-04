# PR-FAQ: Overdeck Anywhere (draft, internal)

Status: draft for review. Not for publication until the operator approves the wording. Every claim below was checked against `main` at `8a82dad552b` (2026-10-01). Anything not in that tree is marked **planned**.

---

## Press release

### Overdeck Anywhere: your agent conversations follow you to your next machine, encrypted with a key only you hold

*Session Vault and device pairing ship free and open source in Overdeck. Save every Claude Code and Codex conversation to a git repository you own, continue it on another machine with your uncommitted code, and reach your dashboard from a laptop or tablet with its own revocable session.*

**The problem.** Overdeck runs your coding agents on one machine. The conversations, the half-finished code and the context that took an afternoon to build all live on that machine's disk. Walk away from the desk and the work stays behind. Move to the laptop and you start a new conversation from nothing, re-explain the task, and hope you committed the right files. Cloud tools that sync sessions ask you to hand them your transcripts, which often contain your code, your infrastructure and your mistakes.

**The solution.** Overdeck Anywhere is the set of features that let your work leave that machine without leaving your control. The first parts are available today:

- **Session Vault.** `pan vault setup <git-url>` turns any empty private git repository you own into an encrypted store for agent conversations. Every conversation is encrypted on your machine before it is written; the repository holds ciphertext, and Overdeck never sees the contents. With the dashboard running, conversations are saved 30 seconds after they go quiet and synced every 5 minutes, with no hook to install.
- **Your uncommitted code comes along.** Each save also captures an encrypted snapshot of the working tree: tracked and untracked files plus local commits you have not pushed. It lives only in your vault, never on your git host, so you can continue while the first machine is switched off.
- **Continue on another machine.** Join a second machine with the 24-word recovery phrase or a vault passphrase. Its dashboard lists the conversations your other machines saved, marked "from `<machine>`", readable in place. Click **Continue here** and Overdeck checks out the saved commit, applies the snapshot (into a new workspace if your checkout has uncommitted changes), and resumes the conversation natively in Claude Code or Codex. If the machine has no checkout of the project, the dialog offers to clone and register it first. From a terminal, `pan vault resume <id>` does the same, and `<id>@<version>` forks from any earlier version.
- **Pair a device with your dashboard.** In **Settings → Anywhere**, click **Pair a device**, pick the address your other device can reach (for example your Tailscale name), and scan the QR code. That device gets its own session, which you can revoke from the same page; revoking closes its open connections at once. The machine's root token never leaves the machine.
- **Scoped API tokens.** Give a script or sidecar a token that can only read events, read conversations, or send messages, instead of full access. Create and revoke them in **Settings → Access Tokens** or with `pan token`.

**Customer quote.** **[PLACEHOLDER: customer quote. Do not publish until a real user has given a real quote and approved its use.]**

**Getting started.** Install or upgrade Overdeck (`npm install -g @overdeck/core`). Create an empty private repository, then on your main machine run `pan vault setup git@github.com:you/session-vault.git` and write down the recovery phrase. On your second machine run `pan vault join git@github.com:you/session-vault.git`. To reach this machine's dashboard from another device, open **Settings → Anywhere → Pair a device**, or run `pan pair --url <address>`. Docs: Session Vault (`/configuration/session-vault`) and Remote access (`/configuration/remote-access`).

Session Vault and pairing are free and open source and need no account. A hosted vault and a paid Anywhere plan are **planned** and not yet available; see the Internal FAQ.

---

## External FAQ

**What exactly is free today?**
Everything described in the press release: `pan vault` (setup, join, passphrase unlock, save, sync, list, show, resume, exclude, key rotation, opt-in eviction and restore), code snapshots, the dashboard's automatic saving, browse copies and **Continue here**, pairing and device revocation, the Anywhere status card, and scoped API tokens. None of it requires an account or a subscription.

**Where is my data stored?**
In a git repository you choose and own (GitHub, GitLab, a NAS, your own server). Overdeck provides no backend and sets no default. Your machine also keeps its key and a local clone under `~/.overdeck/vault/`.

**Can Overdeck, or my git host, read my conversations?**
No. Conversations and code snapshots are encrypted on your machine before they are written, with a vault key that only your machines and your recovery phrase hold. Record names are keyed hashes, so the backend cannot even link records to conversations. `pan vault` commands send no telemetry.

**What if I lose my recovery phrase?**
If you lose every device and the 24 words, the vault is gone. There is no recovery on any server, by design. A vault passphrase makes joining a new machine easier, but the recovery phrase remains the root of recovery.

**How strong is the passphrase option?**
The backend stores your vault key wrapped under the passphrase, so anyone who can read your repository can try to guess it offline. Each guess is deliberately slow and memory-hungry, which puts a generated six-word passphrase out of reach but not a weak one. Setup suggests a generated passphrase and requires 16 characters if you type your own.

**I lost a laptop. What do I do?**
Run `pan vault rotate-key` on a machine you still have, re-join your other machines with the new phrase, and revoke the lost machine's git credentials. Rotation protects what you save afterwards; the lost machine can still read what was saved before. In the dashboard, revoke the laptop under **Settings → Anywhere** if it was paired.

**Which agents can I continue on another machine?**
Claude Code and Codex resume natively, and only their conversations appear as browse rows in the dashboard. Other harnesses receive a markdown digest of the conversation to paste into a new session.

**What if a conversation contains a secret?**
A save that adds a line that looks like a credential is blocked, and the output names the line number and pattern, never the value. The same applies to code snapshots. You decide whether to allow it, exclude the conversation, or rotate the secret.

**Can I keep some projects out of the vault?**
Yes: `pan vault exclude <path>`, `--origin <git-url>` or `--session <id>`.

**Does it work on Windows?**
Under WSL2, yes: join, list, resume and the code snapshot were verified on a Windows Server 2022 runner. Native Windows is not supported yet.

**Can I use my phone?**
A phone browser can pair with your dashboard like any other device, provided it can reach the machine (for example over Tailscale). A mobile web app built for phones is **planned**.

**Can I "send" the conversation I am looking at to my other machine right now?**
Not as a single button yet. Today the dashboard saves a conversation 30 seconds after it goes quiet, and your other machine sees it after its next sync (every 5 minutes by default, or immediately with `pan vault sync`). A one-click hand-off from the conversation is **planned**.

**What will it cost?**
Self-hosted Session Vault and pairing are free, forever, with no feature gate. Hosted plans are **planned and not yet available**. The published plan (the "Overdeck Anywhere: plans and pricing" page) lists: Vault Free (hosted), $0 with 1 GB and 2 machines; Anywhere, $96 a year or $10 month-to-month, with 100 GB, unlimited machines, and the relay and hosted push notifications as they ship; a founding price of $60 a year, annual only, for the first 500 subscribers or until the relay ships; and extra storage at $3 a month or $30 a year per 100 GB. Hosted agent compute would be billed separately by usage. There is no team plan at launch. Payments are planned through Creem as merchant of record.

---

## Internal FAQ

**What is not done?**

| Area | State | Issue |
| --- | --- | --- |
| Native Windows: `vault join` breaks under `core.autocrlf=true`; `resume` cannot spawn Claude Code; dashboard pages 404 | Open | #4418, #4419, #4420 |
| Vault setup, join, unlock and "Sync now" from the dashboard (today the Settings panel prints the `pan vault` command to run) | Open | #4446 |
| "Continued on `<machine>`" and "saved as a fork" states on the original machine | Open | #4447 |
| Per-conversation "Continue on another device" (hand off now, QR link to this conversation) | Draft | `.pan/drafts/anywhere-push-conversation-issue.md` |
| Desktop connection catalog and machine switcher, advertised endpoints, SSH launch, cross-machine overview | Open | #4402, #4403, #4404, #4405 |
| Terminal WebSocket heartbeat for proxies with short idle timeouts | Open | #4434 |
| Needs-you push notifications | Open | #2354 |
| Remote access through a tunnel you control | Open | #2352 |
| Mobile web app | Open | #2355 |
| Relay | Open | #2356 |
| overdeck.ai account, subscription and billing (Creem), hosted vault | Not built | #4293, #4294, #4297 |
| `pan vault migrate` (moving a vault between backends) | Not built; the pricing page describes it in the present tense and needs correcting | none yet |

**Why announce before the paid tier exists?**
The free, self-hosted part is the product's promise and is complete enough to use daily. Announcing it first builds the user base the hosted tier depends on and gives us real data on vault sizes, which the pricing page says we still need.

**What are the biggest risks?**

- **Lost keys.** Users who lose every device and the recovery phrase lose the vault. Support cannot help. Mitigation: the phrase is shown once with a warning, passphrase unlock exists, and the docs say this plainly.
- **Weak passphrases.** An attacker with read access to the repository can guess offline. Mitigation: slow key derivation, a generated default, and a 16-character minimum.
- **Silent divergence.** If the original machine keeps working after another machine continues a conversation, its new turns become a separate fork. The engine handles it safely, but the UI does not show it yet (#4447).
- **Repository growth.** Encrypted records do not delta-compress, so heavy users outgrow free git hosts' recommended repository sizes within months. This is also the hosted vault's opportunity.
- **Exposed dashboards.** A dashboard reached through a local reverse proxy sees every visitor as local unless `require_token_mint` is on. The docs and the Access Tokens settings cover it, but it is easy to miss.
- **Windows expectations.** Users will assume native Windows works. The docs state WSL2 only.

**How do we know it works?**
Each shipped piece merged through the review and test pipeline with its own tests (PAN-2609, PAN-4328, PAN-4329, PAN-3762, PAN-4333, PAN-2351, PAN-4307, PAN-4445, PAN-4436, PAN-4435, PAN-4437). The Windows result comes from the `windows-smoke` workflow run cited in the Session Vault docs. We have no usage telemetry from the vault by design; size data will come from a planned local `pan vault stats` command that users choose to share.

**What has to happen before launch copy goes out?**

1. Fix the stale docs found in the 2026-10-01 audit: the pricing page's "planned and not yet available" banner and `pan vault migrate` claim, and the remote-access line saying the Session Vault settings unlock the vault.
2. Add the six post-v0.64.0 merges to the changelog.
3. Replace the customer quote placeholder with a real, approved quote, or remove it.
4. Operator approval of the final text before any external post.
