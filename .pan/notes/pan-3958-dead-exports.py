# PAN-3958 dead-export scan (name index). Run from the repo root:
#   python3 .pan/notes/pan-3958-dead-exports.py [v]
# Approximate: same-named locals elsewhere hide some dead names, and names reached only through
# `export *` (src/index.ts) look dead here. Confirm every deletion with `tsc --noEmit`.
# Comments in JS/TS files are not uses: a doc or line comment that names an export does not keep it
# alive (PAN-3958 CH-8b). Strings still count, since config lists and dynamic lookups name exports.
import subprocess, re, sys, json
from collections import defaultdict, Counter
allf = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
code = [f for f in allf if re.search(r'\.(ts|tsx|mts|mjs|js|cjs|sh|json|yaml|yml)$', f) and 'node_modules' not in f and not f.startswith('dist/')]
is_test = lambda f: bool(re.search(r'(^|/)(tests?|__tests__|e2e)/', f) or re.search(r'\.(test|spec)\.tsx?$', f))
JS_TS = re.compile(r'\.(ts|tsx|mts|mjs|js|cjs)$')


def strip_comments(src):
    """Blank `//` and `/* */` comments, leaving strings, template literals and regex literals intact."""
    out = []
    i, n = 0, len(src)
    prev = ''  # last significant character, to tell a regex literal from division
    while i < n:
        c = src[i]
        if src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append('\n' * src.count('\n', i, j))
            i = j
            continue
        if c in '\'"`':
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == '\\':
                    j += 1
                elif c != '`' and src[j] == '\n':
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            prev = 'x'
            continue
        if c == '/' and prev in ('', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n'):
            j = i + 1
            in_class = False
            while j < n and src[j] != '\n':
                if src[j] == '\\':
                    j += 2
                    continue
                if src[j] == '[':
                    in_class = True
                elif src[j] == ']':
                    in_class = False
                elif src[j] == '/' and not in_class:
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            prev = 'x'
            continue
        out.append(c)
        if not c.isspace() or c == '\n':
            prev = c if not (c.isalnum() or c in '_$') else 'x'
        i += 1
    return ''.join(out)


words = defaultdict(set)
tok = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
texts = {}
for f in code:
    try:
        t = open(f, errors='ignore').read()
    except Exception:
        continue
    if JS_TS.search(f):
        t = strip_comments(t)
    texts[f] = t
    for w in set(tok.findall(t)):
        words[w].add(f)
exp = re.compile(r'^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|abstract class)\s+([A-Za-z_$][A-Za-z0-9_$]*)', re.M)
lib = [f for f in code if f.startswith('src/lib/') and re.search(r'\.tsx?$', f) and not is_test(f)]
dead = []; testonly = []
for f in lib:
    t = texts[f]
    for m in exp.finditer(t):
        n = m.group(1)
        others = words[n] - {f}
        prod = [o for o in others if not is_test(o)]
        if not others:
            dead.append((f, t[:m.start()].count('\n') + 1, n))
        elif not prod:
            testonly.append((f, t[:m.start()].count('\n') + 1, n))
# local-only use: check if used inside the defining file beyond its declaration
def self_used(f, n):
    return len(re.findall(r'\b' + re.escape(n) + r'\b', texts[f])) > 1
dead_unused = [(f, l, n) for f, l, n in dead if not self_used(f, n)]
dead_selfonly = [(f, l, n) for f, l, n in dead if self_used(f, n)]
to_unused = [(f, l, n) for f, l, n in testonly if not self_used(f, n)]
print('exports scanned', sum(len(exp.findall(texts[f])) for f in lib))
print('exported, referenced nowhere (not even own file):', len(dead_unused))
print('exported, referenced only inside own file (drop export keyword):', len(dead_selfonly))
print('exported, referenced only by tests (and not own file):', len(to_unused))
print('exported, referenced by tests + own file only:', len(testonly) - len(to_unused))
byfile = Counter(f for f, _, _ in dead_unused + to_unused)
print('top files (unused + test-only unused):')
for k, v in byfile.most_common(25): print('  ', v, k)
if len(sys.argv) > 1:
    for r in dead_unused: print('DEAD', *r)
    for r in to_unused: print('TESTONLY', *r)
