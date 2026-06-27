# PAN-2086 Cold-Boot Breakdown

Source: `/home/eltmon/.overdeck/logs/dashboard.log` on 2026-06-27.

The log contains the original long cold-start incident and several later warm
starts with `[boot-timing]` anchors. The cold incident is the 02:36 start:

| Phase | Timestamp / anchor | Elapsed from process start | Notes |
| --- | ---: | ---: | --- |
| Module graph loaded | `2026-06-27T02:36:02.483Z` | `+367ms` | First server log line after module evaluation. |
| Conversation search startup index completed | `2026-06-27T02:37:21.300Z` | about `+79.2s` | Indexed `0` chunks across `7920` files. This owns almost all of the cold delay. |
| ReadModel local database bootstrap completed | `2026-06-27T02:37:21.989Z` | about `+79.9s` | Loaded `128` agents, `9` review statuses, `10` in-flight issues, `seq=125893`. |
| ReadModel issue merge | `2026-06-27T02:37:21.990Z` to listen | about `17ms` | Merged `86` new issues. |
| HTTP server listening | `2026-06-27T02:37:22.007Z` | `+79891ms` | `/api/health` became reachable here. |

Warm comparison windows:

| Start | Listen elapsed | Conversation search | ReadModel bootstrap / merge |
| --- | ---: | --- | --- |
| `2026-06-27T01:22:21Z` | `+4045ms` | Completed at about `+2443ms`, `0` chunks / `7907` files | Bootstrap completed at about `+4019ms`; merge-to-listen about `26ms` for `1611` issues. |
| `2026-06-27T10:48:08Z` | `+8435ms` | Completed at about `+4838ms`, `0` chunks / `8002` files | Bootstrap completed at about `+8408ms`; merge-to-listen about `27ms` for `1639` issues. |
| `2026-06-27T12:59:15Z` | `+7543ms` | `1` chunk / `8003` files | Merged `1642` issues; no per-line timestamp on this segment, but listen was `+7543ms`. |

Attribution:

- The 79.9s cold incident is not caused by the ReadModel issue merge. The merge
  line appears 17ms before the HTTP-listening anchor.
- The dominant cold delay occurs before the conversation-search startup-index
  completion line. The log does not separate filesystem scan time from
  conversation-search database open/FTS setup for that historical run, so that
  sub-attribution is inferred from startup ordering rather than directly
  timestamped.
- The current source now has more detailed probes for future runs:
  `src/dashboard/server/services/cache-service.ts` logs `cache.db opened (WAL replay)`,
  `src/dashboard/server/services/conversation-search-watcher.ts` logs
  `conversation-search startup index completed`, and
  `src/dashboard/server/read-model.ts` logs `ReadModel bootstrap merge completed`.

Decision for Task 4 (`defer-readmodel-merge`): **no-go** for this issue. The
captured long cold boot is dominated by pre-ReadModel work, especially the
conversation-search startup window. Deferring the ReadModel merge would not
recover the observed 79.9s cold path, and the logged merge cost is far below
the plan's `~2s+` go threshold.
