# Resume Overdeck conversations on any machine: optional accounts, and T3 Connect interop

**Date:** 2026-09-28 · **Scope:** research and design; recommendations approved by the operator on 2026-09-28. Resulting issues are tracked under PAN-2350.
**Inputs read from `origin/main`:** `.pan/drafts/pan-2350.md` (incl. 2026-09-28 rebaseline and pricing), `.pan/drafts/pan-2609.md` (rev 4), `.pan/drafts/pan-3762.md`, `.pan/drafts/pan-3863.md`, `.pan/drafts/pan-3700.md`, `anywhere.mdx`, `src/cli/index.ts` (`serve` default), issues #4293, #4294, #4297, #4307, #2356, #3762, #2609. Also the in-progress PAN-2609 workspace (`workspaces/feature-pan-2609/src/lib/vault/`) to check what Phase A already implements.

---

## 1. Verdict

**Build it as a thin, optional identity layer over Session Vault. Do not implement the T3 Connect protocol now.**

1. **The operator's scenario is a "move" problem, not a "reach" problem.** Dual-booting means the origin machine is *off* when you continue. Only Session Vault (PAN-2609, encrypted records + "Continue here" by CAS) works with the origin off. Federation (PAN-3762), the relay (PAN-2356) and **T3 Connect** all reach a machine that is running, so none of them can serve this case.
2. **The account is a convenience, never a requirement and never a key.** An overdeck.ai account (PAN-4293) does three things: it authorizes a device to the hosted vault (PAN-4297), it lists and revokes devices, and it tells a new device "you already have a vault, unlock it". Decryption still needs the user's own secret. Two changes make the dual-boot flow pleasant: (a) an **optional vault passphrase**, a scrypt-wrapped copy of the vault key stored on the backend, so a new machine needs no 24 words; (b) **encrypted WIP snapshots**, so "Continue here" also brings the uncommitted code. Both work on the self-hosted git backend with no account at all.
3. **Now, for the operator and testers:** an invite-only subset of PAN-4293 + PAN-4297. It is two Cloudflare Workers (account: GitHub sign-in, device tokens, allowlist; vault: R2 + Durable Object CAS), with a `tester` entitlement stub and no billing. The same flow already works on the git backend as soon as N1, N2 and PAN-4307 land, so the operator can test dual-boot before any hosted service exists.
4. **T3 Connect: defer protocol interop and take the patterns.** T3 Connect (pingdotgg/t3code, MIT, verified at `b21f3b7191` on 2026-09-28) is remote access to a *running* t3code server. Clerk handles sign-in, a relay on Cloudflare Workers brokers per-environment Cloudflare Tunnels, and push notifications ride along. It does **not** sync or store transcripts, has no end-to-end encryption, and its contracts are a private, fast-moving 0.0.x package. Acting as its client would mean pinning an unpublished RPC contract and using T3's production OAuth client, which does nothing for the origin-off case. **Smallest useful step:** users can already switch tools on the *harness-native transcript* level. t3code's Claude driver resumes by native session id (inferred from source) and t3code can import native Claude and Codex transcripts (lossy); the vault saves any native session (`pan vault save <path>`, FR-15). File one spike (N5) that proves the round trip both ways and documents it. Adopt Connect's good ideas in PAN-4293/PAN-2356: a fixed-port loopback PKCE callback, device-authorization grant for headless machines, the relay kept out of the hot path, and one-time bootstrap credentials the relay never sees. Revisit protocol interop only if t3code publishes its contracts or a stable session-export format.

---

## 2. The scenario this has to satisfy

Operator, 2026-09-28: *"I can click something to make sure that when I `npx @overdeck/core`, I am able to resume a conversation etc from there, whether it's the same physical hardware or not ... registration ... COMPLETELY optional."* Concrete case: dual-boot the same PC into Windows, run `npx @overdeck/core`, sign in, see the Linux install's conversations, continue one.

The dual-boot case is the hardest constraint and the design is built outward from it:

1. **The origin machine is off** at the moment of continuing. Anything that needs it online is out for this case: live federation (PAN-3762), the relay (PAN-2356), and approving the new device from an existing device.
2. So the new machine must get **three things with zero other devices online**: the encrypted conversation (the vault already does this), **the vault key** (today only the 24-word phrase), and **the code** (uncommitted work is on a disk that is not mounted).
3. Everything the new machine needs must be **captured before the origin goes off**: settled transcript chunks and a working-tree snapshot, on the origin's normal timers and hooks, never "on demand at continue time".
4. Same hardware, two OSes = **two environments**. Each OS has its own `OVERDECK_HOME`, so each gets its own `environmentId` under the shared identity contract (PAN-2609 / PAN-3762). That is correct: they are two installs with separate harness homes, separate native transcripts and separate paths.

`npx @overdeck/core` with no arguments runs `serve` (`src/cli/index.ts`: "Default action: no args → serve (npx overdeck)"), which starts the dashboard and opens a browser. So the "click something" surfaces are the dashboard (Home "Get set up" card, Settings) and the matching CLI verbs for the standalone path.

---

## 3. T3 Connect findings

Checked 2026-09-28 against **pingdotgg/t3code `b21f3b7191`** (origin/main, committed 2026-09-28 16:01 -0700), read from a local checkout (fetched, not modified) plus a fresh shallow clone. Everything below comes from source or the repo's docs unless marked **inferred** or **UNVERIFIED**.

### 3.1 What t3code is

- **Repo and license:** https://github.com/pingdotgg/t3code, about 23.8k stars, homepage https://t3.codes. MIT, "Copyright (c) 2026 T3 Tools Inc." (`LICENSE`). The README calls it an "agent harness control surface" with iOS, Android, web (app.t3.codes) and Electron desktop clients, and warns "very very early… Expect bugs".
- **Stack:**
  - pnpm monorepo. The server package is `t3`, runs on Node (`^22.16 || ^23.11 || >=24.10`), not Bun.
  - Effect 4: `effect/unstable/rpc` for RPC, `effect/unstable/sql` over `node:sqlite`.
  - Apps: `apps/{server,web,desktop,mobile,marketing}`. Packages: `packages/{contracts,client-runtime,effect-acp,effect-codex-app-server,shared,ssh,tailscale}`. Relay code is in `infra/relay`.
- **Harnesses:** drivers in `apps/server/src/provider/Drivers/` cover Codex (app-server), Claude (`@anthropic-ai/claude-agent-sdk`), Cursor, Grok, OpenCode and Antigravity. The Claude adapter resumes by native session id (`resume: <sessionId>` in `apps/server/src/provider/Layers/ClaudeAdapter.test.ts`), so its Claude threads are backed by native Claude Code transcripts (**inferred**; verified in N5).
- **Launch:** `npx t3@latest`, the `curl … | sh` installer, `t3 serve` / `t3 service install`, or the desktop app (README).
- **Storage:** `~/.t3` by default (`T3CODE_HOME` overrides; `apps/server/src/os-jank.ts:108`), holding `userdata/state.sqlite` (`apps/server/src/config.ts:131-150`). The model is event-sourced: an `orchestration_events` table plus projections for projects, threads, turns, messages and sessions (`docs/internals/overview.md`). Domain terms: Environment > Project > Thread > Turn (`docs/internals/glossary.md`). Checkpoints are hidden git refs.
- **Session interop that exists today:** t3code can import native Claude and Codex transcripts (`AgentSessionSource = ["claudeAgent","codex"]` in `packages/contracts/src/agentSessions.ts`; `thread.history.import`). The import is lossy: at most 200 messages and no tool activity (`docs/user/welcome-wizard.md`). I found no thread export.

### 3.2 What T3 Connect is

- **Open source, run as a hosted service.** Relay: `infra/relay` (a Cloudflare Worker deployed with Alchemy, PlanetScale Postgres, Cloudflare Tunnel). Server side: `apps/server/src/cloud/`. Client side: `packages/client-runtime/src/relay/`. Production service: `https://relay.t3.codes`, run by T3 Tools.
- **Off by default in a source build.** Copying `.env.example` to `.env` turns it on against production. That file carries the public Clerk publishable key, the JWT template name, the CLI OAuth client id and the relay URL (`docs/operations/connect-setup.md`). The relay can be self-hosted with your own Clerk instance.
- **History:** the relay landed 2026-06-04 (`5ae77c0d63`); "T3 Cloud" was renamed T3 Connect on 2026-06-09 (`22f9f3058b`). Changes since the `f2d5fc91e` baseline that PAN-3762 studied:
  - headless login through Clerk's device-authorization grant (`dc0869b605`, 09-14)
  - offline hosts' tunnels are reclaimed and the host recovers them itself (`8d7b5e998c`, 09-24)
  - HTTP credentials refresh without reconnecting (`363cde4114`, 09-04)
  - new threads load-balance across machines (`420fd76f60`, 09-06)
  - the connections page became one flat list (`5e961d3d7f`, 09-13)
- **What it does:** remote access to a *running* local t3code server from phone, web or another desktop without port forwarding, plus push notifications and Live Activities. **It is not transcript sync.** The relay "is intentionally not in the hot path" (relay README): after bootstrap, clients talk directly to the environment through a per-environment Cloudflare Tunnel hostname. The relay's jobs:
  - account-to-environment links
  - managed tunnel and DNS allocation (`DEFAULT_MANAGED_TUNNEL_LIMIT = 3` per account, `infra/relay/src/environments/ManagedTunnelLimits.ts`)
  - minting short-lived credentials
  - registering mobile devices for APNs/FCM
  - reclaiming idle tunnels
- **Auth:**
  - Identity is Clerk. The CLI is a public OAuth client doing PKCE on a fixed loopback callback, `http://127.0.0.1:34338/callback` (`apps/server/src/cloud/publicConfig.ts:21`). Headless and SSH machines use the device-authorization grant.
  - To log in to an environment, the relay asks it to mint a one-time bootstrap credential bound to the client's DPoP key, and the client redeems it directly. "The relay never receives that session token" (`docs/internals/t3-connect.md:15-16`). The docs admit a compromised relay signing key is not harmless (`:30`).
  - Each environment issues its own scoped sessions, and every RPC declares its required scope (`docs/internals/environment-auth.md`, `apps/server/src/auth/RpcAuthorization.ts`).
  - Which social providers are enabled is set in Clerk's dashboard, not in source: **UNVERIFIED**.
- **Privacy:**
  - I found no application-layer end-to-end encryption in the relay, cloud, auth or client-runtime source.
  - Cloudflare Tunnel terminates TLS at Cloudflare's edge (**inferred**).
  - The relay database stores links, endpoint URLs, credential hashes, DPoP nonces and push tokens. When activity publishing is on, it also stores `relay_agent_activity_rows.state_json`, which holds project title, thread title, phase, headline and model in plaintext (`packages/contracts/src/relay.ts:122-133`). Transcripts stay on the host.
- **Optional sign-in UX:**
  - Desktop: Settings → Connections → sign in → enable Connect per environment.
  - CLI: `t3 connect` (`status`, `unlink`, `logout`).
  - The welcome wizard shows Connect beside "Add a computer" (direct or Tailscale pairing); neither is required.
  - Mobile has a per-account "Don't show this again".
  - Signing out keeps local work (`docs/user/remote-access.md`, `docs/user/welcome-wizard.md`).
- **Price and terms:** free today. The ToS (effective 2026-07-15, https://t3.codes/terms-of-service) says: "You can use some T3 Code features without creating a T3 account. An account may be required for account-backed features, including T3 Connect."

### 3.3 The protocol

- **Environment protocol:** an Effect `RpcGroup` in `packages/contracts/src/rpc.ts` (about 1,500 lines), JSON over WebSocket with short-lived tickets.
- **Versioning:** `ORCHESTRATION_PROTOCOL_VERSION = 1` plus capability flags in the environment descriptor (`packages/contracts/src/environment.ts:13`). Relay schemas are in `packages/contracts/src/relay.ts`, some marked frozen.
- **Not a public API:** `@t3tools/contracts` is `"private": true`, version 0.0.42, not on npm. There is no third-party client spec. OpenAPI could be generated from `HttpApiBuilder` (**inferred**), but none is published.
- **Terms for third-party clients:** the ToS neither permits nor forbids them. Acceptable use forbids bypassing access controls and putting "unreasonable load on shared infrastructure". The ops docs treat the production CLI OAuth client id as "the maintainers' instance" (`docs/operations/android-notifications.md`). A third party should run its own Clerk and relay rather than ride theirs.

### 3.4 What "supporting their protocol" could mean for Overdeck

| Option | What it takes | Does it solve dual-boot? | Verdict |
| --- | --- | --- | --- |
| **A. Overdeck as a T3 Connect client** (show t3code machines in the Overdeck dashboard via relay.t3.codes) | Pin a private 0.0.x RPC contract, use T3's production Clerk client id or ask for our own, and track weekly changes | No: it reaches running t3code servers only | **Not now** |
| **B. Overdeck servers speak T3's environment RPC** (so t3code clients could drive Overdeck) | Implement a large, moving `RpcGroup` over Overdeck's own model | No | **No** |
| **C. Shared session format** | Neither side publishes one. T3's is an internal event log, Overdeck's is the vault's native-JSONL chunks | Only if both stores carried it | **Not needed**: the native harness transcript already is the shared format |
| **D. Native-transcript round trip** (start in t3code, continue in Overdeck, and back) | Mostly works today: the vault saves any native Claude/Codex session (FR-15), and t3code resumes or imports native sessions. Needs verification and docs | Yes, combined with the vault | **Do it now** (N5 spike) |
| **E. Overdeck as an ACP agent inside t3code** (PAN-3700 `pan acp serve`) | t3code would need a generic ACP-agent driver. I found only per-product drivers (Cursor, Grok, Antigravity), no user-configurable ACP agent: **UNVERIFIED** that one exists | No | **Revisit** when PAN-3700 lands |

The one part worth borrowing is the pattern, not the protocol. T3 Connect independently arrived at the shape PAN-3762 and PAN-2356 already chose: every machine is its own server, the account only brokers reachability, the relay is not in the hot path, and environment sessions are minted by the environment and never seen by the relay. Overdeck should copy three concrete choices into PAN-4293 and PAN-2356: a fixed loopback port for PKCE, a device-authorization grant for headless machines, and a one-time bootstrap credential redeemed directly with the environment. Overdeck's one deliberate difference is that its hosted storage is end-to-end encrypted, which Connect does not need because it stores no transcripts.

---

## 4. Other reference designs (what informs this design)

| Product | Pattern | What Overdeck takes from it |
| --- | --- | --- |
| **Zed** (https://zed.dev/docs/authentication, checked 2026-09-28) | "Signing in to Zed is not required." GitHub OAuth with only the `read:user` scope, used only for collaboration and Zed-hosted AI | Minimal OAuth scope (identity only, never repo access); sign-in unlocks hosted features and nothing else |
| **Atuin** (https://docs.atuin.sh/latest/guide/sync/) | "Use our server, host your own, or skip sync entirely." History is end-to-end encrypted with a locally generated key; a new machine needs **both** the password (account) and the key | The closest analogue. Account and key are separate secrets, and the server is self-hostable. Overdeck adds the optional passphrase-wrapped key so a user who keeps only one secret in their head still gets in |
| **Tailscale** (https://tailscale.com/kb/1013/sso-providers, https://tailscale.com/kb/1085/auth-keys) | "Tailscale is not an identity provider": it delegates to Google, GitHub and others. Devices join through browser login or pre-auth keys, with optional approval and node-key expiry | Delegate identity (GitHub), keep a per-device credential that is revocable and listed, and offer a headless join path (device code) |
| **Warp** (https://www.warp.dev/blog/lifting-login-requirement, 2024-11-22) | Required login from launch; developers refused to recommend it; Warp lifted the requirement | Never gate local use or first run on sign-in. The sign-in entry is a card, not a wall |
| **T3 Connect** (section 3) | Optional Clerk sign-in; the relay brokers tunnels and stays out of the hot path; welcome wizard offers it beside direct pairing; "Don't show this again" | Same UX placement: an optional card beside "use your own git remote", dismissible for good |

---

## 5. Two axes, kept apart

"Resume on another machine" mixes two problems that Overdeck already splits across issues:

| Axis | Question | Owner | Works with origin off? |
| --- | --- | --- | --- |
| **Move** | Get the conversation (and code) onto this machine and continue it here | PAN-2609 Session Vault (+ PAN-4297 hosted backend) | **Yes**: the only design that does |
| **Reach** | Operate a session that keeps running where it lives | PAN-3762 federation, PAN-3863 SSH, PAN-2352 tunnel, PAN-2356 relay | No |

The account is **not** a third axis. It is an identity that both axes can use: it authorizes a device to the hosted vault (move) and, later, to the relay (reach). The operator's request is primarily the **move** axis; "Open live on <machine>" is a later bonus when the other machine is on.

---

## 6. Design

### 6.1 Invariants

1. **No account is ever needed for local use**, for self-hosted vault (git or directory backend), for federation, or for SSH hosts. Nothing on first run nags; the sign-in entry is a quiet card, not a gate. (Warp required login from 2022 and lifted it on 2024-11-22 after developer pushback; see section 4.)
2. **Account ≠ decryption.** The account authenticates a device to overdeck.ai services. It never holds the vault key or plaintext. Signing in gets you ciphertext; unlocking needs the vault key, which only the user's devices and the user's own secret (phrase or passphrase) can produce.
3. **One vault format, three backends.** `git`, `dir`, `overdeck://` implement the same `VaultStore` (already true in the Phase A workspace: `src/lib/vault/store/types.ts`). The account only changes which backend is configured and how a device authenticates to it.
4. **One machine identity.** `environmentId` from `${OVERDECK_HOME}/environment-id.json` (shared contract). The account's device record references it; no second id is minted on the client.
5. **Overdeck stores no status it can derive.** The account service stores identity, device credentials and entitlements. It never stores conversation lists, titles, pipeline state or "which machine owns what"; those derive from the encrypted vault refs.

### 6.2 Tiers (all optional, each a strict superset)

| Tier | Needs | Backend | Who it is for | Status |
| --- | --- | --- | --- | --- |
| **0. Local** | nothing | none | everyone by default | today |
| **1. Self-hosted vault** | a private git remote (or a directory) | `git`, `dir` | people who own storage; free forever | PAN-2609 Phase A, in progress |
| **2. Signed in** | an overdeck.ai account (GitHub sign-in) | `overdeck://` | "just make it work on my other machine" | PAN-4293 + PAN-4297; **invite-only now** (6.9) |
| **3. Anywhere (paid, later)** | account + subscription | `overdeck://` with quota, relay, push | the priced plan in `anywhere.mdx` | PAN-4294, PAN-2356, PAN-2354 |

The same "click" (section 6.4) offers tier 2 as the one-button path and tier 1 as "Use my own git remote instead".

### 6.3 What lives where

| Data | Where | Readable by overdeck.ai? |
| --- | --- | --- |
| GitHub user id + login, email if granted, created-at | account service | yes (identity) |
| Device records: server-minted `deviceId`, token **hash**, platform (`linux-x64`, `win32-x64`), user-visible label, created/last-used | account service | yes (metadata only; label is user-chosen, defaults to "Linux device" / "Windows device", **not** the hostname) |
| Invite allowlist / entitlement (`tester`, later plan + quota) | account service | yes |
| Vault key `K` | user's devices only (`${OVERDECK_HOME}/vault/key`, 0600) | **never** |
| Recovery phrase (24 words = `K`) | user's paper/password manager | **never** |
| Passphrase-wrapped `K` (`keywrap` object, 6.5) | backend (hosted or git) | stored, not decryptable without the passphrase |
| Chunks, record refs (titles, cwd, project, harness, owner, lineage) | backend | ciphertext only (PAN-2609 NFR-1) |
| Machine records `machines/<hmac(K, environmentId)>`: hostname label, environmentId, OS, `deviceId`, last settlement time | backend (already PAN-2609 FR-2) | ciphertext only |
| WIP code snapshots (6.7) | backend | ciphertext only |
| Object sizes, counts, timestamps, request IPs | backend logs | yes (unavoidable metadata; documented) |

**Two device lists, one view.** The account's device list is the authority for **revocation** (which devices may talk to the hosted vault). The vault's encrypted machine records are the authority for **what machines exist and when each last synced**. The client joins them on `deviceId` (written inside the encrypted machine record) and shows one list. "Last seen" = last settlement/sync time from the vault, which is how the UI says "Linux desktop: last synced 2 h ago (offline)" without a relay or presence service. With the git backend there is no account list; the vault list is the whole list and "revoke" means "remove the machine record and rotate git credentials yourself".

### 6.4 The flows

#### A. First machine (Linux), opting in

Entry points (same flow behind each): Home "Get set up" card item **"Use your conversations on other machines"**; Settings → **Anywhere**; CLI `pan account login` then `pan vault setup overdeck://`, or one step `pan vault setup --hosted`.

1. **Sign in.** Dashboard: "Sign in with GitHub" opens `https://overdeck.ai/auth/start` with PKCE and a loopback redirect to the local dashboard (`http://localhost:3011/api/account/callback`); the server exchanges the code and stores the **device token** at `${OVERDECK_HOME}/account.json` (0600; never in browser storage, never in the frontend bundle). CLI/standalone: device authorization (RFC 8628) run by overdeck.ai itself: the CLI prints `overdeck.ai/activate` + an 8-character code, the user signs in with GitHub in any browser, the CLI polls and receives the device token. (Running our own RFC 8628 endpoint, rather than GitHub's device flow, keeps the identity provider swappable and lets headless and Windows terminals work the same way.)
2. **Invite check** (tier 2 now): the account service admits only allowlisted GitHub ids; others get "Overdeck accounts are invite-only right now. Everything local keeps working; you can use your own git remote for the vault." with a link to tier 1.
3. **Device registered**: `deviceId` minted server-side, bound to this install's `environmentId` (sent once at registration, stored as an opaque UUID) and platform; label defaults to "Linux device", editable.
4. **Vault setup**: if no vault exists for this account, create `K`, show the 24-word recovery phrase once (existing PAN-2609 FR-1 behavior), then offer **"Also unlock with a passphrase on new machines"** (6.5), on by default in the UI with a clear explanation, off-able. If a vault already exists (the user signed in on a second machine first), jump to flow B step 3.
5. **Settle and sync**: existing PAN-2609 / PAN-4307 behavior: automatic settlement 30 s after growth, sync at boot and every 300 s, plus the new WIP snapshots (6.7).
6. Done state on the card: "3 machines · last synced just now · 214 conversations saved".

#### B. Second machine (Windows, same hardware, Linux is off)

1. `npx @overdeck/core` → `serve` → dashboard opens. First run shows the normal empty home plus one optional card: **"Continue from another machine"** (and the tier-1 link "Use a git remote instead").
2. **Sign in** (as A.1; loopback PKCE because `serve` opened a browser). Device registered as "Windows device".
3. **Unlock the vault**: the account knows a vault exists. Screen: "Enter your vault passphrase" (if a keywrap exists) with "Use recovery phrase instead". Unwrap happens locally; `K` is written to `${OVERDECK_HOME}/vault/key`. Wrong passphrase = local GCM auth failure, no server round-trip to learn from.
4. **Pull**: sync cycle pulls refs; machine list shows **Linux desktop (offline, last synced 07:42)** and **Windows device (this machine)**.
5. **Conversations appear** as browse copies (PAN-4307 FR-4 behavior), grouped or badged by owner machine, read-only composer, excluded from cost totals.
6. **Continue here** on a Linux-owned conversation:
   1. **Where to run it.** The record has `gitOrigin`, branch and the saved cwd state. If a registered project matches `gitOrigin`, use its checkout (PAN-2609 materialization rule). On a fresh machine nothing is registered: offer **"Clone `github.com/eltmon/overdeck` into `C:\Users\<you>\Projects\overdeck`"**, which calls the one project-creation core (`src/lib/projects/create.ts` resolve, `create-perform.ts` perform; never a second registration path). Standalone CLI: `--cwd` or the same clone prompt.
   2. **Code.** If the record's latest settlement carries a WIP snapshot (6.7), check out its branch at the snapshot base and apply the snapshot; if the target checkout is dirty, refuse and offer a fresh worktree. If there is no snapshot, the existing drift prompt (FR-12) runs: continue / continue with a note / cancel.
   3. **Ownership.** CAS transfer (PAN-2609 FR-5). With the origin off this always succeeds unless another machine adopted it first.
   4. **Materialize and launch.** Claude Code: write the `VIEW` into `~/.claude/projects/<slug(cwd)>/<newId>.jsonl` with `sessionId`/`cwd` rewritten (the Phase A `materialize.ts` already does exact-string replacement via `JSON.stringify`, so Windows backslash paths serialize correctly); managed conversation via the fork pipeline in Overdeck mode. The injected drift note tells the model its earlier tool calls used Linux paths.
7. The conversation now settles from Windows, with WIP snapshots from Windows.

#### C. Round trip (reboot back to Linux)

1. Linux boots; the dashboard's boot sync pulls. The record's owner is now "Windows device": Linux's row turns into a browse copy badged **"continued on Windows device"** (FR-5).
2. **"Continue here"** on Linux moves it back: CAS, materialize the updated `VIEW` (which now contains the Windows turns) as a new native session, apply Windows's WIP snapshot to the Linux checkout (the Linux checkout is probably dirty with the *old* WIP: the drift prompt shows that and offers a fresh worktree or "discard is not offered; commit or move your local changes first").
3. If the user instead resumes the **stale** Linux native session directly (`claude --resume` outside Overdeck), Linux is not the owner, so settlement must not write the record (FR-8). The dashboard shows "This conversation was continued on Windows device. Local turns since then are not saved." with **"Save local turns as a fork"** (a new record whose `LOG` shares the parent's chunks, FR-10/FR-17). Nothing is discarded.

#### D. The other machine is on

Same as B, plus (later, once PAN-3762 federation or the PAN-2356 relay reaches it) a second button **"Open live on Linux desktop"** that operates the session where it runs instead of moving it. The account can help discover reachable endpoints later (relay), but for v1 "Continue here" is the only action and works regardless.

### 6.5 Getting the vault key onto a new machine

Three options, in the order the UI offers them:

| Option | Works with origin off? | Security | Default |
| --- | --- | --- | --- |
| **Vault passphrase** (keywrap object on the backend) | yes | offline-guessable if the wrapped blob leaks; strength rules below | offered at setup, on in the UI |
| **24-word recovery phrase** (= `K`, Phase A) | yes | 256-bit; no guessing | always available |
| **Approve from another device** (QR / code shown on an existing device, key sent over an E2E channel) | **no** | strongest UX for phones | later, rides the relay (PAN-2356) |

**Keywrap design** (new vault requirement; works on `git`, `dir` and `overdeck://` alike, so the no-account path gets the same UX):

- Object `keywrap/v1` stored through `VaultStore` like any object, content: `{ v:1, kdf:"scrypt", N:2^17, r:8, p:1, salt:<16B>, nonce:<12B>, ct:AES-256-GCM(KEK, K, ad="overdeck-vault-keywrap-v1") }`, where `KEK = scrypt(passphrase, salt, 32, {N,r,p, maxmem: 256 MiB})`. `node:crypto` only (PAN-2609 NFR-9; Node 22 has no argon2).
- **Strength floor:** the setup suggests a generated 6-word passphrase (EFF long list, ~77 bits); a user-typed passphrase must be at least 16 characters and not in a small blocklist. At N=2^17, r=8 each guess needs 128 MiB of memory plus a costly key derivation, so a generated 77-bit passphrase is far outside any practical offline search even for someone holding the blob; the length floor exists for typed passphrases.
- **Hosted release rule:** the Worker returns `keywrap/v1` only to an authenticated device token. That does not stop an offline attack after a server breach (hence the floor), but it means a leaked vault URL alone yields nothing.
- **Change / remove passphrase** rewrites or deletes the keywrap object; `K` is unchanged, so no re-encryption.
- **Rejected:** storing `K` or a server-held wrapping key (breaks "account ≠ decryption"); OPAQUE/PAKE (right idea, but a new protocol and dependency for marginal gain over a strong-passphrase floor); tying unlock to the GitHub login (a GitHub account takeover would become a vault takeover).
- **Revocation limit, stated plainly:** revoking a device stops it syncing, but it already knows `K`. Full protection after a lost device needs key rotation (re-encrypt refs under a new `K`, keep old chunks readable via a key ring). Out of scope for v1; a follow-up issue, documented in the key-loss section.

### 6.6 How this composes with the existing plans

- **PAN-2609 Phase A (in progress):** unchanged format and CLI. FR-1 ("Overdeck never provides or defaults a backend") still holds: the hosted backend is used only after the user explicitly chooses it (`pan vault setup --hosted` or the sign-in card), the vault stays off until then, and nothing selects `overdeck://` by default. Additions: the keywrap object and `pan vault passphrase set|remove`, a `join` path that tries the passphrase before the phrase, and a reserved `wip` field on settlements (filled by 6.7). `git` backend keeps working with no account: `pan vault join <git-url>` + passphrase or phrase is the complete tier-1 second-machine flow.
- **PAN-4297 hosted vault:** the `overdeck://` store is `VaultStore` over HTTPS with the device token as bearer; nothing about the format changes. It must also serve `keywrap/v1` and enforce "vault exists for this account" discovery (`GET /v1/vault` → `{ exists, vaultRef }`), so a newly signed-in device knows to ask for the passphrase instead of offering "create".
- **PAN-4293 account service:** GitHub sign-in, device tokens, revocation, deletion fan-out, exactly as filed; plus the RFC 8628 device flow, the loopback PKCE flow, the invite allowlist, and the device-record shape in 6.3.
- **PAN-3762 identity/federation:** account device record references `environmentId` (sent once at registration); PAN-3762 pairing and device sessions stay per-environment and do **not** go through the account in v1. Later, the relay can use the account to discover and reach environments (the "Open live" button); that is an endpoint provider per PAN-3762 decision 6.
- **PAN-4307 dashboard consumer:** gains the first-run "Continue from another machine" card, the merged machine list, the fresh-machine clone step on "Continue here", and the "continued on" / "save local turns as a fork" states.
- **PAN-4294 billing:** not needed now; a `tester` entitlement stub is the only thing the hosted vault calls (6.9).

### 6.7 Carrying the code: WIP snapshots

**Problem.** A conversation continued elsewhere without its uncommitted edits is half a continuation; with the origin off there is no way to fetch them later.

**Capture (origin side, only while it owns the record):**

- Triggers: each settlement **if the tree changed** (compare tree ids), at most every 5 minutes per record; always on session end, the Claude Code Stop hook (standalone), `pan vault save`, and dashboard shutdown.
- Mechanism, never touching the user's index, worktree or stash: `GIT_INDEX_FILE=<tmp> git add -A` (respects `.gitignore`), `git write-tree`, `git commit-tree <tree> -p HEAD -m "overdeck wip <vaultId>"`. Then `git bundle create - <wip> --not <remote-tracking refs>` so the bundle carries the WIP commit plus any local commits not on the remote, and nothing the remote already has. (A repo with no remote bundles its whole history; the size cap below then records `skipped: "too-large"` rather than uploading it.) All via async `execFile` (no `execSync`, no `git stash`).
- **Secret scan** the snapshot diff (`git diff --binary HEAD <wip>`) with the same `secret-redaction.ts` patterns as FR-13; a hit blocks the snapshot (not the transcript settlement) and offers the same per-record allow flow.
- **Size cap** (default 50 MB compressed, configurable). Over the cap: record `wip: { skipped: "too-large", bytes }` so the continuing machine says so instead of silently continuing without code.
- Storage: zstd + AES-GCM chunked objects through `VaultStore` (end-to-end encrypted like transcripts). **Not** pushed to the project's origin: pushing plaintext WIP refs to GitHub would leak unreviewed code and secrets into a place other people can read. (An opt-in "also push to `refs/overdeck/wip/*` on origin" can come later.)
- Settlement entry gains `wip: { base: <HEAD sha>, branch, tree, objects: [...], bytes, at }`. Keep the last 5 snapshots per record referenced; older ones become unreferenced objects (collection is a separate, operator-confirmed vault concern, like eviction).

**Apply (continuing side):**

1. Target checkout must be clean. If dirty, offer a fresh worktree (Overdeck mode: the normal workspace creation path) and never overwrite.
2. `git fetch` from origin; `git bundle unbundle` the snapshot into `refs/overdeck/wip/<vaultId>`; check out `branch` at `base` (creating it from the bundle if the base is unpushed).
3. Restore the snapshot as **unstaged** working-tree changes including untracked files (`git diff --binary base wip | git apply`), then delete the temporary ref. Staged-vs-unstaged distinction is not preserved in v1 (stated in docs).
4. The drift check then passes (HEAD, branch and dirty state match the saved cwd state).

### 6.8 Windows (the operator's concrete case): UNVERIFIED, needs a checkpoint

Not verified on 2026-09-28, and the design must not assume it:

- **Herdr on Windows.** Herdr is the strict default backend; launches fail without its binary/socket. I found no evidence Herdr runs natively on Windows. If it does not, `npx @overdeck/core` on Windows can render the dashboard and browse copies but cannot launch a managed conversation.
- **Honest Windows path today:** the standalone `pan vault` CLI (PAN-2609 FR-14 / NFR-7) needs neither the dashboard nor Herdr and launches `claude --resume` directly: `npx @overdeck/core vault join overdeck://` → `vault list` → `vault resume <id>`. WSL2 is the other path (then it is simply Linux).
- **Path checks:** Claude Code's project-dir slug for `C:\...` cwds (`src/lib/runtimes/storage/claude-code.ts`), `USERPROFILE` vs `HOME` in harness discovery, and `git` availability on a fresh Windows box.
- Recommendation: a small spike issue (N4 below) that runs the full B-flow on a Windows VM and records which steps work, before promising "dual-boot into Windows" in docs.

### 6.9 The minimal version for the operator and a few testers (now)

A strict subset of PAN-4293 + PAN-4297, same contracts, no second identity or backend shape:

- **Account Worker** (`overdeck.ai`, Cloudflare Workers, since the zone and the planned vault already live there): GitHub OAuth App; loopback PKCE + RFC 8628 device flow; **allowlist of GitHub numeric ids** in a Worker secret; device tokens `odd_<32 hex>` stored as SHA-256 hashes (epic D-6 stance); `GET /v1/me`, `GET/DELETE /v1/devices/:id`, `DELETE /v1/account` (fans out to the vault). Storage: one Durable Object or D1 table; no email, no password, no billing.
- **Vault Worker** (`vault.overdeck.ai`): R2 objects + one Durable Object per vault for CAS refs, exactly as PAN-4297; bearer = device token checked against the account; `keywrap/v1`; `GET /v1/vault` discovery.
- **Entitlement stub:** every allowlisted account is `tester` with a 10 GB cap and unlimited machines; the stub is the one function PAN-4294 later replaces.
- **Client:** `pan account login|logout|status|devices|revoke`, `pan vault setup --hosted`, `pan vault passphrase set|remove`, dashboard Settings → Anywhere + the first-run card.
- **Explicitly not in the minimal version:** billing, Creem, quotas beyond the stub, relay, push, "approve from another device", key rotation, web viewer.
- **Kill switch:** the hosted backend is a config value; `pan vault migrate <git-url>` (HB-4) moves a tester to self-hosted at any time.

### 6.10 CLI surface (summary)

| Verb | Tier | Notes |
| --- | --- | --- |
| `pan account login [--device-code]` | 2 | loopback PKCE when a browser can reach localhost, else RFC 8628 |
| `pan account status`, `logout` | 2 | logout removes the device token, never the vault key |
| `pan account devices`, `revoke <deviceId>` | 2 | merged view: account devices + vault machine records |
| `pan vault setup --hosted` | 2 | login if needed, then setup or join against `overdeck://` |
| `pan vault join <git-url or overdeck://>` | 1, 2 | tries passphrase (if a keywrap exists), else recovery phrase |
| `pan vault passphrase set|remove` | 1, 2 | writes/deletes `keywrap/v1`; `K` unchanged |
| `pan vault resume <id> [--clone <dir>] [--no-code]` | 1, 2 | applies the WIP snapshot unless `--no-code` |

Each verb ships with its wrapper skill in the same commit (repo rule).

---

## 7. Mapping onto existing issues

### Amend (comment + PRD edit; no new issue)

| Issue | Amendment |
| --- | --- |
| **PAN-2350** epic | Add the north-star acceptance scenario: "dual-boot / fresh machine: `npx @overdeck/core` → sign in (optional) → unlock → Continue here with code, origin off; and the round trip back". Add a line under D-7: account ≠ decryption; passphrase-wrapped key on the backend is user-keyed ciphertext and permitted. |
| **PAN-2609** Phase A | Reserve `wip` on settlement entries (reader tolerates absence) and `keywrap/v1` as a known object name, so N1/N2 land without a format bump. No scope increase for Phase A itself. |
| **PAN-4293** account service | Add: loopback PKCE for the dashboard, RFC 8628 device flow for CLI/headless, invite allowlist (tester mode), device-record shape (6.3: server-minted `deviceId`, platform, user label not hostname, `environmentId` stored opaque), "account ≠ decryption" as an AC, and "revocation is the account's list; machine existence/last-seen is the vault's". |
| **PAN-4297** hosted vault | Add: serve `keywrap/v1` only to authenticated devices; `GET /v1/vault` discovery; tester-mode entitlement stub so it can ship before PAN-4294; WIP snapshot objects count toward quota. |
| **PAN-4294** billing | Note that tester mode uses a stub entitlement function with the same signature; billing replaces it. No other change. |
| **PAN-4307** dashboard consumer | Add: first-run "Continue from another machine" card; merged machine list with last-synced; fresh-machine **clone and register through `create.ts`/`create-perform.ts`** when no registered project matches `gitOrigin`; "continued on <machine>" and "save local turns as a fork" states. |
| **PAN-2356** relay | Adopt T3 Connect's proven rules: relay out of the hot path, environment-minted sessions via a one-time bootstrap credential the relay never sees, offline-host tunnel reclaim. |
| **PAN-3762** federation | NFR-9: note dual-boot = two environments by design; state that Windows native dashboard + Herdr is unverified (link N4). Decision 6 addendum: the relay may later use the overdeck.ai account for environment discovery ("Open live"). |

### File new

| Id | Title | Depends on |
| --- | --- | --- |
| **N1** | Session Vault: optional passphrase unlock (keywrap) so a new machine needs no 24 words | PAN-2609 Phase A |
| **N2** | Session Vault: carry uncommitted work with a conversation (encrypted WIP snapshots) | PAN-2609 Phase A; apply side with PAN-4307 |
| **N3** | Optional sign-in client: `pan account`, Settings → Anywhere, "Continue from another machine" | PAN-4293 (tester mode), PAN-4297 |
| **N4** | Spike: `npx @overdeck/core` and Session Vault resume on native Windows | PAN-2609 Phase A |
| **N6** | Session Vault: key rotation after device loss (key ring, re-encrypt refs under a new key). Later; no body yet | N1, N3 |
| **N5** | Interop: continue t3code sessions in Overdeck and back, through native transcripts | PAN-2609 Phase A |

Suggested order (fits the PAN-2350 rebaseline): PAN-2609 Phase A → N1 + N2 (both usable with the git backend, no account) → N4 → PAN-4293 + PAN-4297 in tester mode → N3 + PAN-4307 additions → billing later. The operator can do the dual-boot flow on the **git backend** as soon as N1 + N2 + PAN-4307 land, before any hosted service exists.

---

## 8. Ready-to-file issue bodies

Each body below is ready to paste. Titles are on the `###` line. All are part of PAN-2350.

### N1: Session Vault: optional passphrase unlock so a new machine needs no 24 words

**Design note:** §6.5 of this document

## Problem

A second machine can join a vault only by typing the 24-word recovery phrase (`pan vault join`). For the "dual-boot into Windows and continue" case, no other device is online to approve the new one, so the phrase is the only way in. Most people will not have it at hand. Without a better unlock, the flow fails at the step that matters most.

## Design

- Add an optional object `keywrap/v1`, stored through `VaultStore` like any other object, so it works on the `git`, `dir` and hosted `overdeck://` backends alike. Its content: `{ v:1, kdf:"scrypt", N:131072, r:8, p:1, salt(16B), nonce(12B), ct }`. `ct` = AES-256-GCM(KEK, K) with associated data `"overdeck-vault-keywrap-v1"`, where KEK = `scrypt(passphrase, salt, 32, {N, r, p, maxmem: 256 MiB})`. Use `node:crypto` only (PAN-2609 NFR-9).
- **Setup:** after the recovery phrase is shown, offer "Also unlock with a passphrase on new machines". The default suggestion is a generated 6-word passphrase (EFF long wordlist). A typed passphrase must be at least 16 characters and not on a small blocklist.
- **Join:** `pan vault join <backend>` and the dashboard unlock screen try the passphrase first when `keywrap/v1` exists, with "Use recovery phrase instead" as the alternative. A wrong passphrase fails the local GCM check and sends nothing to any server.
- **Change and remove:** `pan vault passphrase set|remove` rewrites or deletes the object. `K` never changes, so nothing is re-encrypted.
- **Account ≠ decryption:** the hosted backend returns `keywrap/v1` only to an authenticated device (PAN-4297), and the server never sees the passphrase or `K`.
- **Rejected:** a server-held wrapping key; tying unlock to the GitHub login; OPAQUE/PAKE (a new protocol and dependency for little gain over a strength floor).

## Work items

1. `src/lib/vault/keywrap.ts`: wrap, unwrap, strength check, generated passphrase.
2. `pan vault passphrase set|remove`, the setup prompt, and passphrase-first `join`. Update the wrapper skill in the same commit.
3. Contract tests on `dir` and `git`: round trip; a wrong passphrase fails without writing anything; removing the passphrase leaves the vault usable through the phrase.
4. Fake timers for any retry. No `execSync`.

## Acceptance criteria

- [ ] Given a vault with a passphrase set, when a machine with an empty `OVERDECK_HOME` runs `pan vault join <git-url>` and enters the passphrase, then `pan vault list` shows the vault's records, and no recovery phrase was asked for.
- [ ] Given a wrong passphrase, when join runs, then it fails with "passphrase did not unlock this vault", no key file is written, and no request other than the object read reaches the backend.
- [ ] Given a 12-character typed passphrase, when setup runs, then it is refused with the length rule.
- [ ] A byte scan of the backend finds neither `K` nor the passphrase; `keywrap/v1` decodes only to the fields above.
- [ ] After `pan vault passphrase remove`, `keywrap/v1` is gone and join via the recovery phrase still works.

## Docs

`docs/SESSION-VAULT.md` and `configuration/session-vault.mdx`: a "Passphrase unlock" section covering the offline-guessing tradeoff, the strength rule, and the reminder that the recovery phrase is still the root of recovery.

---

### N2: Session Vault: carry uncommitted work with a conversation (encrypted WIP snapshots)

**Design note:** §6.7 of this document

## Problem

"Continue here" moves the conversation but not the code. If the conversation was mid-edit, the new machine continues against a checkout that lacks those edits; the drift prompt (FR-12) can only warn about it. When the origin machine is off, as in a dual boot, those edits cannot be fetched later.

## Design

- **Capture on the owner machine only:**
  - Triggers: at each settlement when the working tree changed (compare tree ids), at most every 5 minutes per record; always at session end, on the Stop hook, on `pan vault save`, and at dashboard shutdown.
  - Mechanism: `GIT_INDEX_FILE=<tmp> git add -A` (respects `.gitignore`), `git write-tree`, `git commit-tree -p HEAD`, then `git bundle create - <wip> --not <remote-tracking refs>`. The bundle carries the WIP commit plus any unpushed local commits. It never touches the user's index or worktree, never runs `git stash`, and uses async `execFile` only.
- **Safety:**
  - Secret-scan `git diff --binary HEAD <wip>` with the `secret-redaction.ts` patterns. A hit blocks the snapshot (not the transcript) and uses the same allow-secret flow as FR-13.
  - Size cap: 50 MB compressed by default. Over the cap, record `skipped: "too-large"`.
- **Storage:**
  - zstd, then AES-GCM, as chunked objects through `VaultStore`. The settlement entry gains `wip: { base, branch, tree, objects, bytes, at }`.
  - The last 5 snapshots per record stay referenced.
  - Snapshots are never pushed to the project's origin.
- **Apply on the continuing machine:**
  1. Require a clean checkout; otherwise offer a fresh worktree.
  2. Fetch origin, unbundle into `refs/overdeck/wip/<vaultId>`, and check out `branch` at `base`.
  3. `git diff --binary base wip | git apply` (the changes arrive unstaged, untracked files included).
  4. Delete the temporary ref.
  - Staged-vs-unstaged state is not preserved in v1.
  - `pan vault resume --no-code` skips all of this.

## Work items

1. `src/lib/vault/wip.ts` (capture, scan, bundle, apply) with the reserved `wip` settlement field.
2. Hook capture into `settle.ts` and the standalone triggers.
3. Apply in `pan vault resume`, and in the dashboard "Continue here" through PAN-4307.
4. Tests on a fixture repo with a bare remote: unpushed commit + staged + unstaged + untracked + deleted file round trip; an ignored file is excluded; a secret blocks the snapshot; the size cap is recorded; a dirty target is refused; the user's index and stash are untouched (assert `git stash list` and the index hash are unchanged).

## Acceptance criteria

- [ ] Given machine A with one unpushed commit and uncommitted edits, including an untracked file, when A settles and then goes offline, and machine B runs `pan vault resume <id>` in a clean clone, then B's working tree matches A's byte for byte (tracked and untracked, ignored files excluded), and B's HEAD equals A's HEAD.
- [ ] Given a snapshot whose diff contains a string matching a secret pattern, then no snapshot object is written, and the CLI names the file and pattern (never the value).
- [ ] Given a dirty target checkout, resume refuses and offers a fresh worktree; nothing in the dirty checkout changes.
- [ ] Across capture, A's index file, stash list and worktree are unchanged.
- [ ] A byte scan of the backend finds no plaintext file content from the snapshot.

## Docs

`docs/SESSION-VAULT.md` "Carrying your code": what is captured, what is excluded, the size cap, the fact that snapshots never go to your git host, and `--no-code`.

---

### N3: Optional sign-in client: `pan account`, Settings → Anywhere, and "Continue from another machine"

**Design note:** §6.4, §6.9, §6.10 of this document

## Problem

PAN-4293 builds the overdeck.ai account service and PAN-4297 builds the hosted vault. Neither covers the client: how a user signs in from `npx @overdeck/core` (dashboard) or from a terminal (standalone), where the device token lives, and the first-run path "Continue from another machine". Without this, the operator's scenario (sign in on a second machine and see and continue the other machine's conversations) has no entry point.

## Design

- **Sign in:**
  - Dashboard: PKCE with a loopback redirect to the local dashboard's `/api/account/callback`; the server exchanges the code.
  - CLI and headless: RFC 8628 device authorization served by overdeck.ai (`overdeck.ai/activate` + code).
  - The device token is stored at `${OVERDECK_HOME}/account.json` (0600), server-side only; never in browser storage or the frontend bundle.
- **Device registration:** send `environmentId` and platform once. The server mints `deviceId`. The label defaults to "<OS> device", not the hostname.
- **Unlock:** if the account already has a vault, show "Enter your vault passphrase" (N1) or the recovery phrase; never offer "create".
- **Machine list:** join the account's devices (the authority for revocation) with the vault's encrypted machine records (the authority for existence and last-synced time) on `deviceId`.
- **Surfaces:**
  - Home "Get set up" card item "Use your conversations on other machines".
  - A first-run card "Continue from another machine" beside "Use a git remote instead"; dismissible for good.
  - Settings → Anywhere: account, machines, revoke, passphrase, backend.
- **CLI:** `pan account login [--device-code] | status | logout | devices | revoke <deviceId>`, and `pan vault setup --hosted`. Logout removes the device token and never the vault key.
- **Invariants:**
  - No surface blocks local use; nothing prompts for sign-in unprompted after dismissal.
  - The account never receives `K`, the passphrase or plaintext.

## Work items

1. `src/lib/account/` (token store, PKCE, device-code client, `me`/`devices` API client). Imports only Node built-ins, so the standalone CLI stays light (PAN-2609 NFR-7).
2. Dashboard routes `/api/account/*`, each with a no-loss-matrix row; frontend Settings → Anywhere and the first-run card.
3. `pan account` verbs with wrapper skill; `pan vault setup --hosted`.
4. Tests: the PKCE state mismatch is rejected; the device-code poll respects `slow_down` (fake timers); the token file mode is 0600; logout keeps `vault/key`; the frontend never receives the token (route test); Playwright screenshots of the first-run card and Settings → Anywhere, inspected.

## Acceptance criteria

- [ ] Given a fresh `OVERDECK_HOME` and an allowlisted GitHub account, when the user clicks "Continue from another machine", signs in, and enters the vault passphrase, then the machine list shows the other machine with its last-synced time, and its conversations appear as browse copies.
- [ ] Given a non-allowlisted GitHub account, sign-in ends with the invite-only message and a link to the git-remote path; local features are unaffected.
- [ ] `pan account login --device-code` works over SSH with no browser on the machine.
- [ ] After `pan account revoke <deviceId>` from another machine, the revoked machine's next sync fails with "this device was revoked" within one sync interval, and its local data is untouched.
- [ ] With the first-run card dismissed, no sign-in prompt appears again on that machine.

## Docs

New `configuration/anywhere-sign-in.mdx`: optional sign-in, what the account holds, what it never holds, and revocation limits (a revoked device already knows `K`; key rotation is a follow-up). Link it from `anywhere.mdx`.

---

### N4: Spike: `npx @overdeck/core` and Session Vault resume on native Windows

## Problem

The operator's concrete case is to dual-boot into Windows, run `npx @overdeck/core`, and continue a Linux conversation. Nobody has verified that Overdeck runs on native Windows. Herdr is the strict default terminal backend, and there is no evidence it runs on Windows. Without it, managed conversations cannot launch there. The standalone `pan vault` path needs neither Herdr nor the dashboard, but it has not been run on Windows either.

## Design

Use a Windows 11 VM with Node 22 and Git for Windows, and run these steps in order, recording pass/fail and the exact error for each:

1. `npx @overdeck/core`: does `serve` start the dashboard, and does the browser open?
2. Dashboard with no Herdr: which pages work, and what does a conversation launch say?
3. Standalone: `npx @overdeck/core vault join <git-url>` → `vault list` → `vault resume <id>`: is the Claude Code project slug for a `C:\…` cwd right, does `claude --resume` pick up the materialized file, and are `USERPROFILE`/`HOME` resolved correctly in harness discovery?
4. The WIP apply (N2) on NTFS: line endings (`core.autocrlf`), file modes, symlinks.
5. WSL2 as the fallback: the same B-flow inside WSL2.

## Work items

1. Run the matrix and attach the results table to this issue.
2. File one issue per blocking failure, each with its own acceptance criteria.
3. Update PAN-3762 NFR-9 with the outcome.

## Acceptance criteria

- [ ] A results table covering steps 1–5 is posted on this issue, with an exact error for every failure.
- [ ] Every blocking failure has its own filed issue, linked here.
- [ ] `docs/SESSION-VAULT.md` states the supported Windows path (native standalone, WSL2, or both) as verified by this spike.

## Docs

The "Windows" section in `docs/SESSION-VAULT.md` and `configuration/anywhere-sign-in.mdx`, limited to what the spike verified.

---

### N5: Interop: continue t3code sessions in Overdeck and back, through native transcripts

**Design note:** §3.4 (option D) of this document

## Problem

Some users want to switch between Overdeck and t3code for different tasks. T3 Connect's protocol is a private, fast-moving 0.0.x contract for reaching running t3code servers; implementing it would not move a conversation between tools. Both tools already drive Claude Code and Codex natively. t3code's Claude adapter resumes by native session id and can import native Claude/Codex transcripts (lossy: 200 messages, no tool activity). Overdeck's vault saves any native session (`pan vault save <path>`). The native transcript is therefore probably already a working shared format, but nobody has verified it or written it down.

## Design

Verify both directions with Claude Code, then Codex, against t3code at a pinned commit:

1. **t3code → Overdeck:** start a Claude thread in t3code; locate its native JSONL under `~/.claude/projects/<slug>/`; `pan vault save <path>`; continue it on another machine with `pan vault resume` (or in the local dashboard through a plain fork).
2. **Overdeck → t3code:** start a conversation in Overdeck; import it with t3code's welcome-wizard import; note what is lost.
3. Record for each: whether native resume works, what is lossy, and whether either tool rewrites the other's files (neither may).
4. If both directions work, add a docs section and a `pan vault save --from t3code <thread>` convenience **only if** t3code exposes a stable thread → native-session mapping. Otherwise document the path lookup and stop.

No T3 Connect client, no use of T3's hosted relay or OAuth client, and no reading of `~/.t3/userdata/state.sqlite` (an internal schema that changes through migrations).

## Work items

1. Run the matrix and record the results on this issue (t3code commit, Claude Code version, Codex version).
2. A docs section with the verified steps.
3. Optional convenience flag per step 4, with tests using a fixture transcript.

## Acceptance criteria

- [ ] Given a Claude Code thread created in t3code, when its native transcript is saved with `pan vault save` and resumed on a second machine, then the resumed session contains the thread's turns, and t3code's own files are unmodified.
- [ ] Given an Overdeck conversation, when imported in t3code, the observed loss (message cap, tool activity) is recorded in the docs.
- [ ] The Codex result is recorded, whether it works or not.
- [ ] No code path contacts `relay.t3.codes` or reads `~/.t3`.

## Docs

`docs/SESSION-VAULT.md` "Using other tools (t3code)": the verified round trip, what is lossy, and a note that T3 Connect is remote access to running t3code servers and is not used by Overdeck.

---

### Amendment comments for existing issues (paste as comments)

**PAN-2350:**
> 2026-09-28 accounts design (`.pan/drafts/anywhere-accounts.md`). North-star scenario added: on a fresh or dual-booted machine, `npx @overdeck/core` → optional sign-in → unlock (passphrase or phrase) → Continue here with the uncommitted code, while the origin machine is off; then the round trip back. D-7 clarification: a passphrase-wrapped vault key stored on a backend is user-keyed ciphertext and is permitted; the account never gains decryption. New issues: N1 passphrase unlock, N2 WIP snapshots, N3 sign-in client, N4 Windows spike, N5 t3code native-transcript interop. T3 Connect protocol interop is deferred (it is remote access to running t3code servers, with no transcript sync).

**PAN-4293:**
> Additions from the 2026-09-28 accounts design: (1) PKCE with a loopback redirect for the dashboard (T3 Connect uses a fixed loopback port; do the same); (2) our own RFC 8628 device-authorization endpoint for CLI/headless/Windows terminals; (3) invite-only tester mode: allowlist of GitHub numeric ids in a Worker secret; (4) device record = server-minted `deviceId`, token hash, platform, user label (default "<OS> device", not the hostname), opaque `environmentId`, created/last-used; (5) AC: the account never receives the vault key, a passphrase or plaintext; (6) the account's device list is the authority for revocation, and the vault's encrypted machine records are the authority for existence and last-synced time. OAuth scope is identity only (`read:user`), never repo access.

**PAN-4297:**
> Additions: serve `keywrap/v1` (N1) only to authenticated devices; add `GET /v1/vault` discovery so a newly signed-in device knows a vault exists; ship first in tester mode behind a `tester` entitlement stub (10 GB, unlimited machines) whose signature PAN-4294 later implements; WIP snapshot objects (N2) count toward quota.

**PAN-4294:**
> Tester mode (PAN-4293/PAN-4297) calls one entitlement function returning `tester`; billing replaces its implementation, not its signature. No other change.

**PAN-4307:**
> Additions: first-run "Continue from another machine" card (the flow itself is N3); merged machine list with last-synced time; on "Continue here" when no registered project matches `gitOrigin`, offer to clone and register through `src/lib/projects/create.ts` / `create-perform.ts` (never a second registration path); apply the N2 WIP snapshot; the states "continued on <machine>" and "Save local turns as a fork" for a non-owner that resumed a stale native session.

**PAN-3762:**
> NFR-9 note: dual-booting the same hardware gives two environments (separate `OVERDECK_HOME`), by design. Native Windows with Herdr is unverified (N4). Decision 6 addendum: the relay may later use the overdeck.ai account for environment discovery ("Open live on <machine>"); environment sessions stay minted by the environment (T3 Connect's "relay never receives the session token" rule).

**PAN-2356:**
> From the 2026-09-28 accounts design, which studied T3 Connect: keep the relay out of the hot path after bootstrap (clients then talk to the environment directly). Environment sessions are minted by the environment through a one-time bootstrap credential that the client redeems directly, so the relay never sees the session token (T3 `docs/internals/t3-connect.md:15-16`, t3code `b21f3b7191`). The relay may use the overdeck.ai account (PAN-4293) to broker reachability, but it never holds instance scopes (FR-R4 unchanged). Reclaim tunnels and rooms for offline hosts, and let hosts recover them on reconnect (T3 `8d7b5e998c`).

**PAN-2609:**
> Reserve the `wip` field on settlement entries (readers tolerate its absence) and the object name `keywrap/v1`, so N1 and N2 land without a format bump. No Phase A scope change.
