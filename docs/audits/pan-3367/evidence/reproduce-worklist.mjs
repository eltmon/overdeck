import { DatabaseSync } from 'node:sqlite';
import { writeFileSync, mkdirSync } from 'node:fs';
const HOME = process.env.HOME;
const db = new DatabaseSync(`${HOME}/.overdeck/overdeck.db`, { readOnly: true });
const rows = db.prepare(
  "SELECT sequence, timestamp, payload FROM events WHERE type='review.status_changed' ORDER BY sequence ASC",
).all();
const byIssue = new Map();
for (const r of rows) {
  let p; try { p = JSON.parse(r.payload); } catch { continue; }
  if (!p.issueId || !p.status) continue;
  const rs = p.status.reviewStatus, ts = p.status.testStatus;
  if (!rs || !ts) continue;
  const t = typeof r.timestamp === 'number' ? r.timestamp : Date.parse(r.timestamp);
  if (!byIssue.has(p.issueId)) byIssue.set(p.issueId, []);
  byIssue.get(p.issueId).push({ t, state: `${rs}/${ts}`, raw: r });
}
const HOUR = 3600e3;
const NEG = (s) => { const [a, b] = s.split('/'); return ['failed','blocked'].includes(a) || ['failed','blocked'].includes(b); };
// Confidentiality allowlist: this script writes into a PUBLIC repository
// (eltmon/overdeck). Only dump raw event payloads for issue prefixes whose
// underlying source repository is also public. Every other prefix (e.g.
// MIN- for the private mind-your-now/mind-your-now-backend repos) gets its
// candidate metadata recorded but NOT a raw payload dump — raw payloads can
// embed private source paths, diff snippets, and review commentary. This
// was a real disclosure (PAN-3367 review cycle 1/2, 2026-08-01): the
// original version of this script dumped MIN-* payloads unconditionally.
const PUBLIC_ISSUE_PREFIXES = ['PAN-'];
const isPublicIssue = (issueId) => PUBLIC_ISSUE_PREFIXES.some((p) => issueId.startsWith(p));
const candidates = [];
mkdirSync('docs/audits/pan-3367/evidence', { recursive: true });
for (const [id, evs] of byIssue) {
  const seq = evs.filter((e, i) => i === 0 || e.state !== evs[i - 1].state); // collapse consecutive dupes
  let hit = null;
  for (let i = 0; i < seq.length && !hit; i++) {
    if (!NEG(seq[i].state)) continue;
    let sawPending = false;
    let resetAtT = null;
    for (let j = i + 1; j < seq.length; j++) {
      if (seq[j].t - seq[i].t > HOUR) break;
      if (seq[j].state === 'pending/pending') {
        if (!sawPending) resetAtT = seq[j].t; // first reset-to-pending after the negative verdict
        sawPending = true;
        continue;
      }
      if (seq[j].state === 'passed/passed' && sawPending) {
        const isPublic = isPublicIssue(id);
        // Non-public issues get a minimal, content-free stub: no notes, no
        // per-issue raw dump. Notes/reviewNotes/testNotes can themselves
        // embed private source paths, diff snippets, and endpoint names —
        // stripping them here (not just skipping the raw dump below) is
        // required, not optional; a prior version of this script recorded
        // notes for every issue regardless of visibility.
        hit = { issueId: id, negState: seq[i].state, negAt: new Date(seq[i].t).toISOString(),
                resetAt: new Date(resetAtT).toISOString(),
                passAt: new Date(seq[j].t).toISOString(), minutes: Math.round((seq[j].t - seq[i].t) / 60e3),
                negNotes: isPublic
                  ? (JSON.parse(seq[i].raw.payload).status.reviewNotes ?? JSON.parse(seq[i].raw.payload).status.testNotes ?? null)
                  : null,
                evidenceDumped: isPublic };
        break;
      }
    }
  }
  if (!hit) continue;
  candidates.push(hit);
  if (!isPublicIssue(id)) {
    console.error(`${id}: SKIPPED raw payload dump and notes — not a public-repo issue prefix (confidentiality allowlist)`);
    continue;
  }
  // Dump the issue's full raw event series verbatim — this is the forensic evidence.
  writeFileSync(`docs/audits/pan-3367/evidence/events-${id.toLowerCase()}.json`,
    JSON.stringify(evs.map((e) => e.raw), null, 1));
}
candidates.sort((a, b) => a.negAt.localeCompare(b.negAt));
writeFileSync('docs/audits/pan-3367/evidence/candidates.json', JSON.stringify(candidates, null, 1));
console.log(`candidates: ${candidates.length}`);
// A handful of issues (review-thrash cases like MIN-891/MIN-901) generate thousands of
// review.status_changed events, producing multi-MB per-issue dumps. Before committing,
// gzip them: `gzip -9 docs/audits/pan-3367/evidence/events-*.json` (repetitive JSON
// compresses ~50-100x; verified 19.6MB -> 201KB for MIN-891). The committed evidence
// files are `events-<issue>.json.gz`, not `.json`.
