# Flywheel Order Books

Order books turn an operator-curated Flywheel campaign into durable, mechanically enforced state. A book names the issues in scope, divides them between a parallel lane and a serial lane, records prerequisites and planning checks, and binds that scope to one Flywheel run.

Use this document for implementation details. The operator guide is [`configuration/order-books.mdx`](../configuration/order-books.mdx).

## Entity model

Order books live on the project's `overdeck-state` branch under `orders/`:

```text
orders/
├── index.json
├── 2026-07-18-refactor-p3-remainder.json
└── 2026-07-18-release-hardening.json
```

`index.json` owns queue order and status snapshots. Each book file contains the full entity:

| Field | Meaning |
| --- | --- |
| `id` | Immutable `<yyyy-mm-dd>-<kebab-name>` identifier. Duplicate names receive a numeric suffix. |
| `name` | Mutable display name. |
| `status` | `draft`, `ready`, `running`, `drained`, or `complete`. |
| `settings.laneAConcurrency` | Maximum number of Lane A issues allowed in flight. |
| `settings.briefOverlay` | Optional markdown overlay added to the standard Flywheel brief. |
| `settings.posture` | `open` permits eligible dispatch; `drain` blocks new book dispatch. |
| `settings.postureSetAt`, `postureSetBy`, `postureReason` | Attribution for the current posture. |
| `items` | Ordered Lane A and Lane B entries. |
| `runId` | The Flywheel run bound to a running or completed book. |

Each item records:

- `issue`, normalized to uppercase;
- `lane`, either `A` or `B`;
- a one-based `order` within that lane;
- `prereqs`, whose issues must be terminal before dispatch;
- `reVerify`, which blocks dispatch until cleared;
- optional `planAtPickup`, which downgrades a missing Lane B PRD from a start block to a warning; and
- `addedAt` and `addedBy` provenance.

An issue may belong to only one non-complete book. Completed books remain as campaign history and no longer reserve their issues.

## The two doors

Order books follow Overdeck's single-read-door, single-write-door rule:

- [`src/lib/orders/resolver.ts`](../src/lib/orders/resolver.ts) is the only read door. It lists and resolves books, builds non-complete membership, returns ranked backlog candidates, and derives progress.
- [`src/lib/orders/writer.ts`](../src/lib/orders/writer.ts) is the only write door. It creates books, edits items and settings, advances status, and keeps each book aligned with `index.json`.

[`src/lib/orders/io.ts`](../src/lib/orders/io.ts) owns the physical files and state-branch commit. Routes, CLI commands, services, scripts, and UI code call the resolver or writer; they never read or edit `orders/*.json` directly. `scripts/lint-state-writes.sh` enforces this boundary and fails on direct access outside `src/lib/orders/`.

The writer uses the canonical state write door, so each successful mutation commits and pushes the concrete state files from the dedicated state worktree. Callers must not add a second git or filesystem write path.

## Lifecycle

```text
draft → ready → running → drained → complete → next ready book
                                  └──────────→ backlog mode
                                  └──────────→ needs-you stop
```

1. **Draft.** The operator assembles lanes, prerequisites, flags, and run settings.
2. **Ready.** The book joins the queue in `orders/index.json`. The dashboard's **Queue book** action and `pan orders queue <id>` both move a valid draft to this state through the write door; a book that is not a draft is refused with `Order book <id> must be draft before it can be queued`.
3. **Running.** `pan orders start <id>` or `pan flywheel start --orders <id>` validates the ready book, acquires the singleton Flywheel run gate, writes `launch.json.orders.bookId`, and then marks the book running. A failed validation or gate acquisition leaves the book ready.
4. **Drained.** Progress is drained when every item is closed or parked. The issues resolver supplies this state; the orchestrator cannot self-report it.
5. **Complete.** `pan flywheel complete` writes the report, includes the retrospective result, clears the active-run gate, marks the book complete, and advances the queue.

`pan flywheel stop` keeps its manual-stop semantics. It does not perform the order-book completion and continuation sequence.

## Validation before start

Before validation, the shared Flywheel order-start resolver used by both `pan orders start <id>` and `pan flywheel start --orders <id>` calls `ensureOrderIssueStore()`. It initializes the shared issue service with `skipPolling: true`, loading the existing issue cache without making tracker API calls or starting a polling loop. The cache is not refreshed during the start operation.

`validateBookForStart()` returns separate `blocks` and `warns` arrays. Start refuses a book with any block and names every finding.

Validation blocks when:

- the order issue store is unavailable or empty;
- an item is closed or cannot be resolved as open;
- an issue belongs to another non-complete book;
- a prerequisite cannot be resolved;
- prerequisites form a cycle; or
- a Lane B item has no draft PRD or canonical spec.

A Lane B item with `planAtPickup: true` converts the missing-PRD finding to a warning. Warnings remain visible but do not disable **Queue book** or **Start run**.

The dashboard route `POST /api/orders/:id/start` and both CLI start commands use the same asynchronous order-start resolver, issue-store prime, validator, and Flywheel start function. If the shared issue service did not start or its cache contains no issues, validation emits one `issue-store-unavailable` block and omits the misleading per-issue `issue-not-open` and `unresolved-prerequisite` findings. Run `pan up` once to populate the shared issue cache, then retry the start command.

## Dispatch enforcement

The server-side work-agent spawn route is the enforcement chokepoint. [`src/lib/orders/dispatch-gate.ts`](../src/lib/orders/dispatch-gate.ts) resolves the active run and its book, then applies the pure predicate in [`src/lib/orders/eligibility.ts`](../src/lib/orders/eligibility.ts).

For an orders-bound run, dispatch requires all of these conditions:

- the issue belongs to the active book, unless the operator supplied `--off-book`;
- pickup posture is OPEN;
- the lane has capacity;
- every prerequisite is closed or parked; and
- PRD re-verification is no longer pending.

Lane A admits up to `settings.laneAConcurrency` in-flight issues. Lane B admits exactly one. A refusal returns HTTP 409 with a stable code, a complete operator-facing message, and the condition list used by the Progress view.

Book membership counts as operator release for the pickup gate. This applies even when `flywheel.auto_pickup_backlog=false`; the setting still holds every off-book issue.

## Off-book overrides

Off-book work is blocked during an orders-bound run unless the operator explicitly dispatches it:

```bash
pan start PAN-1234 --off-book
```

Every accepted override appends one JSON object to:

```text
${OVERDECK_HOME}/flywheel/runs/<runId>/orders-overrides.jsonl
```

The entry records the timestamp, run id, book id, issue id, actor, and `override: "off-book"`. The flag is a narrow audited exception, not a way to turn backlog pickup back on.

## Progress and drain detection

Orders-bound status snapshots add `FlywheelStatus.orders`:

| Field | Meaning |
| --- | --- |
| `bookId`, `bookName` | Bound book identity. |
| `landed`, `total` | Closed count and total item count. |
| `laneAInFlight` | Lane A issues currently in flight. |
| `laneBInFlight` | The current Lane B issue, when present. |
| `drained` | `true` when every item is closed or parked. |

The `/orders` Progress view renders the same mechanical eligibility conditions that the dispatch route enforces. The lane editor resolves each item's issue title at render time from the dashboard issues read model, falls back to the bare ID when the issue is unavailable, and never persists titles in the stored book. Flywheel and issue-tree widgets are read-only projections that link back to `/orders`; they do not create another editing surface.

## Retrospective and continuation

When `orders.drained` becomes true, the orchestrator may write `${OVERDECK_HOME}/flywheel/runs/<runId>/retro.md` if the run produced a concrete doctrine, substrate, or brief improvement. `pan flywheel complete` adds that content under `## Retrospective`. Without a finding, the report contains exactly:

```text
Retrospective: no findings recognized.
```

After completion, continuation is deterministic:

| Condition | Result |
| --- | --- |
| A ready book remains in `index.json` | Start the first ready book in queue order, in-process. |
| No ready book locally, but a ready book in another tracked project | Scan every project in `projects.yaml` registry order, skipping the project that just drained, and start the first ready book found. The run starts in that project's own primary root with no brief argument, so `requireFlywheelBrief` resolves the target project's `docs/flywheel-brief.md` rather than carrying the previous project's brief over. `pan flywheel complete` names the project in its output: `started <runId> with order book <bookId> (project: <key>)`. |
| No ready book in any project and `flywheel.auto_pickup_backlog=true` | Start a bookless backlog-mode run. |
| No ready book in any project and auto-pickup is off | Stay stopped and emit `needs-you: pipeline idle — no order book queued and auto-pickup is off`. |

Cross-project continuation is deliberately not gated on the completing run's scope. Marking a book ready is an explicit operator release, so a ready book anywhere is work the operator has already authorized; run scope governs backlog pickup only.

## CLI surface

```bash
pan orders create "Campaign name"
pan orders list
pan orders show <id>
pan orders add <id> <issue...> [--lane B] [--after <issue>] [--reverify]
pan orders remove <id> <issue>
pan orders move <id> <issue> [--lane A] [--order 2]
pan orders queue <id>
pan orders start <id>
```

`queue` is the CLI equivalent of the dashboard's **Queue book** action: it moves a draft to ready through the write door so the Flywheel can pick the book up from the ready queue.

Every verb accepts `--project <key>` to resolve the book in another registered project instead of the one containing the current directory. Omitting it keeps resolving from cwd. An unregistered key exits non-zero with `Unknown project: <key>`.

```bash
pan orders list --project mind-your-now
pan orders queue 2026-08-01-frontend-sweep --project mind-your-now
```

## HTTP surface

All routes are under `/api/orders` and delegate to the two doors:

- `GET /api/orders`
- `POST /api/orders`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id`
- `POST /api/orders/:id/items`
- `PATCH /api/orders/:id/items/:issue`
- `DELETE /api/orders/:id/items/:issue`
- `GET /api/orders/backlog-candidates?limit=10`
- `GET /api/orders/:id/preview-brief`
- `POST /api/orders/:id/start`

Mutation routes use the dashboard's normal CSRF protection. Server-reachable code remains async and does not use `execSync`.

### Project scoping

Order books are per-project state, so every route above accepts an optional `project=<key>` query parameter naming a key from `projects.yaml`. The key is resolved through the projects registry to that project's state read home, and the resolved key is echoed back on each response — `GET /api/orders` returns it as a top-level `project` field, and every single-book projection carries it as `project`.

- **Omitted.** The route resolves the project containing the dashboard server's own working directory, which is the historical behavior. Existing callers keep working unchanged.
- **Unknown key.** The route answers HTTP 400 naming the key (`Unknown project: <key>`), never a 404 for the book. A bad key is a caller error, not a missing book.
- **Single-book miss.** `GET /api/orders/:id` with no `project=` falls back to scanning the other registered projects' state roots in registry order and returns the first match, so a deep link or the Flywheel-page widget still resolves a book that lives in another project. An explicit `project=` never scans — it either finds the book in that project or 404s.
- **`POST /api/orders/:id/start`** launches the Flywheel in the book's own project root rather than the server's cwd, so a cross-project book runs against the right repo.

The `/orders` page carries the resolved key on every fetch it makes and mirrors the selection into the URL as `/orders?project=<key>`, which is also the deep link the Flywheel order-book widget points at.

## Verification

The focused suites live under:

- `packages/contracts/src/__tests__/orders.test.ts`
- `tests/unit/lib/orders/`
- `tests/unit/cli/orders.test.ts`
- `tests/unit/cli/flywheel-orders.test.ts`
- `tests/unit/cli/flywheel-complete.test.ts`
- `src/dashboard/server/routes/__tests__/orders.test.ts`
- `src/dashboard/frontend/src/components/orders/__tests__/`
- `src/dashboard/frontend/src/pages/__tests__/OrderBookPage.test.tsx`

Because dispatch and Flywheel completion cross Cloister-adjacent paths, changes to order-book enforcement require the full `npm test` suite before completion.
