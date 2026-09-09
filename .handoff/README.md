Computer handoff snapshot of an unfinished merge.

The source worktree and merge index remain untouched. Files with conflict markers
are preserved intentionally. merge-index.txt records all index stages; referenced
blobs are reachable through this branch and its original merge parents.
