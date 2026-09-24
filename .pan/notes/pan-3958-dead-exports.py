# PAN-3958 dead-export scan (name index). Run from the repo root:
#   python3 .pan/notes/pan-3958-dead-exports.py [v]
# Approximate: same-named locals elsewhere hide some dead names, and names reached only through
# `export *` (src/index.ts) look dead here. Confirm every deletion with `tsc --noEmit`.
# Comments in JS/TS files are not uses: a doc or line comment that names an export does not keep it
# alive (PAN-3958 CH-8b). Strings still count, since config lists and dynamic lookups name exports.
# Comments are found by the TypeScript parser (pan-3958-strip-comments.mjs, CH-9), so regex literals
# after keywords and nested template literals cannot hide or invent a comment.
import subprocess, re, sys, json
from collections import defaultdict, Counter
allf = subprocess.run(['git', 'ls-files'], capture_output=True, text=True).stdout.split()
code = [f for f in allf if re.search(r'\.(ts|tsx|mts|mjs|js|cjs|sh|json|yaml|yml)$', f) and 'node_modules' not in f and not f.startswith('dist/')]
is_test = lambda f: bool(re.search(r'(^|/)(tests?|__tests__|e2e)/', f) or re.search(r'\.(test|spec)\.tsx?$', f))
JS_TS = re.compile(r'\.(ts|tsx|mts|mjs|js|cjs)$')


def strip_comments_all(files):
    """Blank every comment in the JS/TS files, using the TypeScript parser's trivia ranges.

    pan-3958-strip-comments.mjs keeps strings, template literals (nested ones too), regex literals
    (after keywords too) and type positions intact, and keeps newlines so line numbers hold.
    """
    helper = __file__.rsplit('/', 1)[0] + '/pan-3958-strip-comments.mjs' if '/' in __file__ else 'pan-3958-strip-comments.mjs'
    out = subprocess.run(['node', helper], input=json.dumps(files), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)

words = defaultdict(set)
tok = re.compile(r'[A-Za-z_$][A-Za-z0-9_$]*')
texts = {}
stripped = strip_comments_all([f for f in code if JS_TS.search(f)])
for f in code:
    if f in stripped:
        t = stripped[f]
    else:
        try:
            t = open(f, errors='ignore').read()
        except Exception:
            continue
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
    for r in dead_selfonly: print('OWNFILE', *r)
