"""Audit of Overdeck's TLDR read hook from local Claude Code transcripts.

The hook (tldr-read-enforcer) denied a Read of a code file over 3 KB and injected an
outline instead. For every denial this script checks what the agent did in its next
tool calls, how much of the file came back, and what the extra model turns cost.

Read-only over ~/.claude/projects/**/*.jsonl. Prints and writes aggregate numbers only
(no file paths or content). Usage: python3 audit.py [window_days]  (default 30)
Output: tldr_audit_<days>d.json in the current directory.

Method notes:
- "Came back": a Read of the same path, or a Bash cat/sed/head/tail/awk/less/nl/bat
  naming the file, within the next 8 tool calls (outcome) / 15 calls (bytes).
  Read results are stripped of their line-number prefixes before counting.
- Extra turns: assistant messages from the denial up to and including the one that
  issued the re-read. Their usage fields give the real context each turn re-read.
- Cost weights (Anthropic list ratios, in input-token equivalents): input 1x,
  cache read 0.1x, cache write 1.25x, output 5x.
- Savings (upper bound): bytes kept out of context (withheld minus re-read minus the
  injected summary) / 4 chars per token, charged once as a cache write and then as a
  cache read on every later turn in the session. Compaction and session end are
  ignored, which overstates savings.
"""
import json, glob, os, time, re, collections, statistics, sys
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
cut = time.time() - DAYS*86400
CPT = 4.0  # chars per token estimate
files = [f for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True)
         if os.path.exists(f) and os.path.getmtime(f) > cut]
LN = re.compile(r'^\d+\t', re.M)
BASH_READ = re.compile(r'\b(cat|sed|head|tail|awk|less|nl|bat)\b')
rows = []
denial_files = set(); sessions_all = len(files); denial_ts = []
for f in files:
    txt = open(f, errors='replace').read()
    if 'TLDR summary provided' not in txt: continue
    ev = []  # ordered events: ('use', id, name, input) | ('res', id, text, is_err) | ('asst', usage, model) | ('ctx', text)
    for l in txt.splitlines():
        try: r = json.loads(l)
        except: continue
        a = r.get('attachment')
        if a and a.get('type') == 'hook_additional_context':
            ev.append(('ctx', ''.join(a.get('content') or []), r.get('timestamp'))); continue
        m = r.get('message') or {}
        c = m.get('content')
        if r.get('type') == 'assistant' and m.get('usage'):
            ev.append(('asst', m['usage'], m.get('model'), m.get('id')))
        if not isinstance(c, list): continue
        for b in c:
            if b.get('type') == 'tool_use': ev.append(('use', b['id'], b['name'], b.get('input') or {}))
            elif b.get('type') == 'tool_result':
                t = b.get('content'); t = t if isinstance(t, str) else json.dumps(t)
                ev.append(('res', b.get('tool_use_id'), t, bool(b.get('is_error')), r.get('timestamp')))
    # dedupe assistant messages (streamed chunks share message id)
    seen = set(); ev2 = []
    for e in ev:
        if e[0] == 'asst':
            if e[3] in seen: continue
            seen.add(e[3])
        ev2.append(e)
    ev = ev2
    uses = {e[1]: e for e in ev if e[0] == 'use'}
    results = {e[1]: e for e in ev if e[0] == 'res'}
    for i, e in enumerate(ev):
        if e[0] != 'res' or 'TLDR summary provided' not in e[2]: continue
        u = uses.get(e[1])
        if not u or u[2] != 'Read': continue
        path = u[3].get('file_path', ''); base = os.path.basename(path)
        mm = re.search(r'\((\d+) bytes', e[2]); size = int(mm.group(1)) if mm else 0
        if e[4]: denial_ts.append(e[4])
        # summary size: nearest preceding ctx attachment
        summ = 0
        for j in range(i-1, max(-1, i-6), -1):
            if ev[j][0] == 'ctx' and 'TLDR Summary' in ev[j][1]: summ = len(ev[j][1]); break
        # walk forward
        later = ev[i+1:]
        tool_calls = 0; outcome = None; extra_asst = []; reread_chars = 0; bash_chars = 0
        asst_seen = []
        first_reread_idx = None
        for k, x in enumerate(later):
            if x[0] == 'asst': asst_seen.append(x)
            if x[0] == 'use':
                tool_calls += 1
                s = json.dumps(x[3])
                is_read = x[2] == 'Read' and x[3].get('file_path') == path
                is_bash = x[2] == 'Bash' and base and base in s and BASH_READ.search(s)
                if tool_calls <= 8 and outcome is None and (is_read or is_bash):
                    outcome = ('bash' if is_bash else ('partial' if ('offset' in x[3] or 'limit' in x[3]) else 'full'))
                    first_reread_idx = k
                    extra_asst = list(asst_seen)
                if tool_calls <= 15 and (is_read or is_bash):
                    r = results.get(x[1])
                    if r and not r[3]:
                        if is_read: reread_chars += len(LN.sub('', r[2]))
                        else: bash_chars += len(r[2])
            if tool_calls > 15: break
        if outcome is None: outcome = 'summary_only'
        remaining_turns = sum(1 for x in later if x[0] == 'asst')
        def tok_in(u): return (u.get('input_tokens') or 0), (u.get('cache_read_input_tokens') or 0), (u.get('cache_creation_input_tokens') or 0), (u.get('output_tokens') or 0)
        ex = [tok_in(a[1]) for a in extra_asst]
        model = extra_asst[0][2] if extra_asst else (asst_seen[0][2] if asst_seen else None)
        denial_files.add(f)  # a session counts only if it produced a denial row
        rows.append(dict(size=size, summ=summ, outcome=outcome, extra_turns=len(ex),
            extra_in=sum(a for a,b,c,d in ex), extra_cr=sum(b for a,b,c,d in ex), extra_cw=sum(c for a,b,c,d in ex), extra_out=sum(d for a,b,c,d in ex),
            reread=reread_chars, bash=bash_chars, remaining=remaining_turns, model=model or '?'))
n = len(rows)
out = collections.OrderedDict()
out['window_days'] = DAYS; out['transcripts_scanned'] = sessions_all; out['sessions_with_denials'] = len(denial_files); out['denials'] = n
out['first_denial'] = min(denial_ts) if denial_ts else None; out['last_denial'] = max(denial_ts) if denial_ts else None
oc = collections.Counter(r['outcome'] for r in rows)
out['outcomes'] = {k: oc[k] for k in ['partial','bash','full','summary_only']}
out['outcome_pct'] = {k: round(100*oc[k]/n,1) for k in out['outcomes']}
W = sum(r['size'] for r in rows); RR = sum(r['reread'] for r in rows); BR = sum(r['bash'] for r in rows); S = sum(r['summ'] for r in rows)
out['bytes_withheld'] = W; out['bytes_reread_via_read_stripped'] = RR; out['bytes_reread_via_bash'] = BR; out['bytes_summary_injected'] = S
out['pct_withheld_that_came_back'] = round(100*min(W, RR+BR)/W, 1)
out['denials_reread_ge_80pct'] = sum(1 for r in rows if (r['reread']+r['bash']) >= 0.8*r['size'])
out['median_file_bytes'] = statistics.median(r['size'] for r in rows)
# token accounting in input-token-equivalents (Anthropic list ratios: cache read 0.1x, cache write 1.25x, output 5x)
extra_cost = sum(r['extra_in'] + 0.1*r['extra_cr'] + 1.25*r['extra_cw'] + 5*r['extra_out'] for r in rows)
# savings: tokens kept out of context, held for every later turn (upper bound: ignores compaction/session end)
save = 0.0; save_immediate = 0.0
for r in rows:
    held = max(0.0, (r['size'] - r['reread'] - r['bash'] - r['summ']) / CPT)
    save += held * 1.25 + held * 0.1 * r['remaining']
    save_immediate += held
out['extra_turns_total'] = sum(r['extra_turns'] for r in rows)
out['extra_turns_mean_per_reread'] = round(out['extra_turns_total'] / max(1, n - oc['summary_only']), 2)
out['extra_turn_context_tokens_mean'] = round(statistics.mean([(r['extra_in']+r['extra_cr']+r['extra_cw'])/r['extra_turns'] for r in rows if r['extra_turns']]))
tr_in = sum(r['extra_in'] + r['extra_cr'] + r['extra_cw'] for r in rows)
out['extra_turn_cache_read_share'] = round(sum(r['extra_cr'] for r in rows) / tr_in, 3) if tr_in else None
out['cost_extra_turns_input_equiv_tokens'] = round(extra_cost)
out['saving_upper_bound_input_equiv_tokens'] = round(save)
out['net_input_equiv_tokens'] = round(save - extra_cost)
out['net_tokens_kept_out_of_context'] = round(save_immediate)
out['summary_tokens_injected'] = round(S / CPT)
pm = collections.Counter(r['model'] for r in rows); out['denials_by_model'] = dict(pm.most_common())
print(json.dumps(out, indent=2))
json.dump(out, open(f'tldr_audit_{DAYS}d.json', 'w'), indent=2)
