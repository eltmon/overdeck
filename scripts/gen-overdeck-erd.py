#!/usr/bin/env python3
"""
Generate docs/overdeck-db-erd.excalidraw (+ .mmd) from
drizzle/overdeck/0000_overdeck_init.sql.

Idiom matches docs/overdeck-db-erd.excalidraw: rounded domain-colored
rectangle per table + title text + monospaced columns text. Adds explicit
TYPE / PK / FK / NN markers + indexes (the old ERD listed names only; this
one renders types because types are the point of the review).
"""
import json, re, os, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SQL_PATH = os.path.join(ROOT, "drizzle/overdeck/0000_overdeck_init.sql")
OUT_EX = os.path.join(ROOT, "docs/overdeck-db-erd.excalidraw")
OUT_MMD = os.path.join(ROOT, "docs/overdeck-db-erd.mmd")

sql = open(SQL_PATH).read()

# ---------- parse CREATE TABLE blocks ----------
tables = {}          # name -> {cols:[...], pk:set(), fks:[(col,ref_table,ref_col)], indexes_implicit:set()}
table_order = []

def split_top(s):
    """split on commas not inside parens"""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1; cur += ch
        elif ch == ")":
            depth -= 1; cur += ch
        elif ch == "," and depth == 0:
            out.append(cur); cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur)
    return out

for m in re.finditer(r"CREATE TABLE `(\w+)` \(\n(.*?)\n\);", sql, re.S):
    name = m.group(1); body = m.group(2)
    cols = []
    pk_cols = set()
    fks = []
    for raw in split_top(body):
        piece = raw.strip()
        if not piece:
            continue
        up = piece.upper()
        # composite PRIMARY KEY clause
        cm = re.match(r"^PRIMARY KEY\s*\((.*)\)\s*$", piece, re.S)
        if cm:
            for c in cm.group(1).split(","):
                pk_cols.add(re.sub(r"[` ]", "", c))
            continue
        # table-level FOREIGN KEY
        fm = re.match(r"^FOREIGN KEY\s*\(\s*`?(\w+)`?\s*\)\s+REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)", piece, re.I)
        if fm:
            fks.append((fm.group(1), fm.group(2), fm.group(3)))
            continue
        # column definition
        nm = re.match(r"^`?(\w+)`?\s+(\w+)(.*)$", piece, re.S)
        if not nm:
            continue
        colname = nm.group(1)
        coltype = nm.group(2).lower()
        rest = nm.group(3)
        is_pk = "PRIMARY KEY" in rest.upper()
        is_nn = "NOT NULL" in rest.upper()
        is_auto = "AUTOINCREMENT" in rest.upper()
        is_uniq = re.search(r"\bUNIQUE\b", rest.upper()) is not None
        ref = re.search(r"REFERENCES\s+`?(\w+)`?\s*\(\s*`?(\w+)`?\s*\)", rest, re.I)
        if ref:
            fks.append((colname, ref.group(1), ref.group(2)))
        dm = re.search(r"DEFAULT\s+('([^']*)'|TRUE|FALSE|\d+(?:\.\d+)?)", rest, re.I)
        default = dm.group(1) if dm else None
        cols.append({
            "name": colname, "type": coltype,
            "pk": is_pk, "nn": is_nn, "auto": is_auto, "uniq": is_uniq,
            "ref": (ref.group(1), ref.group(2)) if ref else None,
            "default": default,
        })
    tables[name] = {"cols": cols, "pk": pk_cols, "fks": fks}
    table_order.append(name)

# mark composite PK cols
for t, d in tables.items():
    if d["pk"]:
        for c in d["cols"]:
            if c["name"] in d["pk"]:
                c["pk"] = True

# ---------- parse indexes ----------
indexes = {}   # table -> list of {name, cols, unique, partial}
for m in re.finditer(r"CREATE\s+(UNIQUE\s+)?INDEX\s+`?(\w+)`?\s+ON\s+`?(\w+)`?\s*\(([^)]*)\)(\s+WHERE\s+[^;]+)?", sql, re.I):
    unique = bool(m.group(1))
    idx_name = m.group(2)
    tbl = m.group(3)
    cols = [re.sub(r"[` ]", "", c) for c in m.group(4).split(",")]
    partial = bool(m.group(5))
    indexes.setdefault(tbl, []).append({"name": idx_name, "cols": cols, "unique": unique, "partial": partial})

# ---------- domain grouping ----------
DOMAINS = [
    ("ISSUES & AGENTS", "#ffec99", ["issues", "agents", "status_history", "issue_policy"]),
    ("REVIEW", "#d0bfff", ["review_runs", "review_run_agents", "review_status"]),
    ("MERGE", "#a5d8ff", ["merge_sets", "merge_queue", "merge_set_repos", "pending_auto_merges"]),
    ("CONVERSATIONS", "#b2f2bb", ["conversations", "conversation_files", "favorites"]),
    ("COST", "#ffe8cc", ["cost_events"]),
    ("DISCOVERED SESSIONS", "#ffdeeb",
        ["discovered_sessions", "discovered_session_tags", "discovered_session_tools",
         "discovered_session_files", "session_embeddings"]),
    ("UAT", "#f3d9fa", ["uat_generations", "uat_generation_members", "uat_generation_resolutions"]),
    ("EVENTS & MEMORY", "#c3fae8", ["events", "health_events", "observation_index", "reset_markers"]),
    ("RECONSTRUCTION", "#e9ecef", ["transcripts", "transcript_checkpoints"]),
    ("INFRA & CONTROL", "#fff3bf", ["app_settings", "git_operations", "flywheel_substrate_bugs"]),
]

# sanity: all 32 tables grouped exactly once
grouped = [t for _, _, ts in DOMAINS for t in ts]
assert len(grouped) == 32, f"grouped {len(grouped)}"
assert set(grouped) == set(table_order), f"missing: {set(table_order)-set(grouped)} extra: {set(grouped)-set(table_order)}"

# ---------- column line rendering ----------
CHARW = 7.2      # mono px per char @ fontSize 12
LINEH = 15       # fontSize 12 * 1.25
PADX = 12

def table_lines(t):
    d = tables[t]
    maxlen = max(len(c["name"]) for c in d["cols"])
    typelen = max(len(c["type"]) for c in d["cols"])
    lines = []
    for c in d["cols"]:
        pre = ("PK" if c["pk"] else "") + ("FK" if c["ref"] else "")
        pre = (pre + "    ")[:4]
        line = f"{pre} {c['name']:<{maxlen}}  {c['type']:<{typelen}}"
        line += "  NN" if c["nn"] else ""
        if c["uniq"]:
            line += "  UQ"
        if c["auto"]:
            line += "  AUTO"
        lines.append((line, c))
    # indexes section
    idxs = indexes.get(t, [])
    if idxs:
        lines.append(("─" * 12, None))
        for ix in idxs:
            tag = "UQ" if ix["unique"] else "IX"
            extra = " *" if ix["partial"] else ""
            lines.append((f"{tag} {ix['name']} ({', '.join(ix['cols'])}){extra}", None))
    return lines

# ---------- layout ----------
HEADER_Y = 0
BOX_TOP_Y = 46
GAP_Y = 30
COL_GAP = 64
MIN_W = 260

# compute box geometry per table
box = {}   # t -> {x,y,w,h, cx, top, bottom, lines, nlines, color}
col_x = 0
col_meta = []   # (title, color, x, width, height)
for title, color, members in DOMAINS:
    col_w = 0
    placed = []
    y = BOX_TOP_Y
    for t in members:
        lines = table_lines(t)
        nlines = len(lines)
        content_w = max(len(ln) for ln, _ in lines) * CHARW
        # title (fontSize 13 ~7.8px/char) must fit on one line too
        title_str = f"{t}  ·  {len(tables[t]['cols'])} cols"
        title_w = len(title_str) * 7.8
        w = max(MIN_W, int(max(content_w, title_w) + 2 * PADX))
        h = 8 + 18 + 8 + nlines * LINEH + 12
        placed.append({"t": t, "x": col_x, "y": y, "w": w, "h": h, "lines": lines, "nlines": nlines})
        box[t] = {"x": col_x, "y": y, "w": w, "h": h,
                  "cx": col_x + w / 2,
                  "top": y, "bottom": y + h,
                  "lines": lines, "nlines": nlines, "color": color}
        col_w = max(col_w, w)
        y += h + GAP_Y
    col_h = y - BOX_TOP_Y
    col_meta.append((title, color, col_x, col_w, col_h))
    col_x += col_w + COL_GAP

TOTAL_W = col_x - COL_GAP

# ---------- element factory ----------
elements_out = []
_seed = [100]
def nxt():
    _seed[0] += 17
    return _seed[0]

def base(x, y, w, h, type_, **kw):
    e = {
        "id": "e" + str(nxt()),
        "x": x, "y": y, "width": w, "height": h, "angle": 0,
        "strokeColor": "#1e1e1e", "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 0, "opacity": 100, "groupIds": [], "frameId": None,
        "roundness": None, "seed": nxt(), "version": 1, "versionNonce": nxt(),
        "isDeleted": False, "boundElements": None, "updated": 1,
        "link": None, "locked": False, "type": type_,
    }
    e.update(kw)
    return e

def text_el(x, y, w, text, size, color="#343a40", align="left"):
    h = max(size, round(size * 1.25 * (text.count("\n") + 1)))
    if "\n" not in text:
        h = round(size * 1.25)
    return base(x, y, w, h, "text",
        strokeColor=color, text=text, fontSize=size, fontFamily="3",
        textAlign=align, verticalAlign="top", containerId=None,
        originalText=text, lineHeight=1.25, baseline=h - 4)

# diagram title block (above everything, negative y)
elements_out.append(text_el(0, -104, 900,
    "OVERDECK DATABASE SCHEMA — ERD", 26, "#0b7285"))
elements_out.append(text_el(0, -64, 1100,
    "drizzle/overdeck/0000_overdeck_init.sql  ·  32 tables  ·  types shown (PK / FK / NN / UQ) for review",
    14, "#495057"))
elements_out.append(text_el(0, -40, 1100,
    "solid arrow = declared FOREIGN KEY   ·   dashed arrow = logical *_id reference   ·   box color = domain",
    12, "#868e96"))

# domain headers
for title, color, x, w, h in col_meta:
    elements_out.append(text_el(x, HEADER_Y, w + 40, title, 18, "#0b7285"))

# tables
for title, color, members in DOMAINS:
    for t in members:
        b = box[t]
        # rectangle
        elements_out.append(base(b["x"], b["y"], b["w"], b["h"], "rectangle",
            strokeColor="#1e1e1e", backgroundColor=color, roundness={"type": 3}))
        # title
        elements_out.append(text_el(b["x"] + PADX, b["y"] + 8, b["w"] - 2 * PADX,
            f"{t}  ·  {len(tables[t]['cols'])} cols", 13, "#000"))
        # columns
        coltext = "\n".join(ln for ln, _ in b["lines"])
        elements_out.append(text_el(b["x"] + PADX, b["y"] + 8 + 18 + 8,
            b["w"] - 2 * PADX, coltext, 12, "#343a40"))

# ---------- arrows ----------
# declared FKs (solid) + curated logical refs (dashed).
# self-refs (conversations handoff/cleared) are documented, not drawn.
declared = []
for t, d in tables.items():
    for col, rt, rc in d["fks"]:
        if t == rt:  # self-ref
            continue
        declared.append((t, col, rt, rc, True))

logical = [
    ("cost_events", "issue_id", "issues", "id"),
    ("conversations", "issue_id", "issues", "id"),
    ("review_status", "issue_id", "issues", "id"),
    ("git_operations", "issue_id", "issues", "id"),
    ("transcripts", "pan_issue_id", "issues", "id"),
    ("discovered_sessions", "pan_issue_id", "issues", "id"),
    ("flywheel_substrate_bugs", "discovered_in_issue_id", "issues", "id"),
    ("agents", "review_run_id", "review_runs", "run_id"),
]
arrows = [(s, c, rt, rc, False) for (s, c, rt, rc) in logical] + declared

TOP_LANE = -16          # above headers (headers at y=0)
lane_step = 16
_fan = {}
def fan_x(target):
    _fan[target] = _fan.get(target, 0) + 1
    return box[target]["x"] + 30 + _fan[target] * 10

arrow_count = 0
for i, (s, col, rt, rc, is_decl) in enumerate(arrows):
    if s not in box or rt not in box:
        continue
    sb, tb = box[s], box[rt]
    solid = is_decl
    color = "#868e96" if solid else "#adb5bd"
    style = "solid" if solid else "dashed"
    same_col = abs(sb["x"] - tb["x"]) < 1
    if same_col:
        # vertical elbow; enter target top (if target above) else bottom
        if tb["top"] <= sb["top"]:
            ex, ey = fan_x(rt), tb["top"]
            sx, sy = sb["cx"], sb["top"]
            pts = [(0, 0), (ex - sx, 0), (ex - sx, ey - sy)]
        else:
            ex, ey = fan_x(rt), tb["bottom"]
            sx, sy = sb["cx"], sb["bottom"]
            pts = [(0, 0), (ex - sx, 0), (ex - sx, ey - sy)]
        ax, ay = sx, sy
    else:
        # cross-column via top lane
        lane_y = TOP_LANE - (i % 8) * lane_step
        sx, sy = sb["cx"], sb["top"]
        ex = fan_x(rt)
        ey = tb["top"]
        pts = [(0, 0), (0, lane_y - sy), (ex - sx, lane_y - sy), (ex - sx, ey - sy)]
        ax, ay = sx, sy
    elements_out.append(base(ax, ay, 0, 0, "arrow",
        strokeColor=color, strokeWidth=1.5, strokeStyle=style,
        points=pts, lastCommittedPoint=None, startBinding=None, endBinding=None,
        startArrowhead=None, endArrowhead="triangle"))
    arrow_count += 1

# ---------- write excalidraw ----------
doc = {
    "type": "excalidraw", "version": 2, "source": "overdeck-erd-gen",
    "elements": elements_out,
    "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
    "files": {},
}
with open(OUT_EX, "w") as f:
    json.dump(doc, f, indent=2)

# ---------- write mermaid ----------
def mtype(t): return t if t in ("text", "integer", "real", "blob", "numeric") else "text"
mm = ["erDiagram"]
for t in table_order:
    mm.append(f"  {t.upper()} {{")
    for c in tables[t]["cols"]:
        flags = []
        if c["pk"]: flags.append("PK")
        if c["ref"]: flags.append("FK")
        if c["uniq"]: flags.append("UK")
        flagstr = " ".join(flags)
        mm.append(f"    {mtype(c['type'])} {c['name']} {flagstr}".rstrip())
    mm.append("  }")
mm.append("")
seen = set()
for t, d in tables.items():
    for col, rt, rc in d["fks"]:
        if t == rt: 
            mm.append(f"  %% self-ref: {t}.{col} -> {rt}.{rc}")
            continue
        key = (t, rt, col)
        if key in seen: continue
        seen.add(key)
        mm.append(f"  {t.upper()} }}o--|| {rt.upper()} : {col}")
for (s, col, rt, rc) in logical:
    mm.append(f"  {s.upper()} }}o--o{{ {rt.upper()} : {col}  %% logical")
with open(OUT_MMD, "w") as f:
    f.write("\n".join(mm) + "\n")

# ---------- stats + inconsistency analysis (printed for the notes file) ----------
n_tables = len(table_order)
n_cols = sum(len(tables[t]["cols"]) for t in table_order)
n_idx = sum(len(v) for v in indexes.values())
n_uniq_idx = sum(1 for v in indexes.values() for i in v if i["unique"])
n_fk_decl = sum(len([1 for d in tables[t]["fks"]]) for t in table_order)

print(f"TABLES: {n_tables}")
print(f"COLUMNS: {n_cols}")
print(f"INDEXES: {n_idx} (unique: {n_uniq_idx})")
print(f"DECLARED FK: {n_fk_decl}")
print(f"ARROWS DRAWN: {arrow_count}  (logical dashed: {len(logical)})")
print(f"ELEMENTS: {len(elements_out)}")
print(f"CANVAS W x H(approx): {int(TOTAL_W)} x {int(max(h for *_, h in col_meta)+BOX_TOP_Y)}")

# timestamp-column type audit
TIME_RE = re.compile(r"(_at|_ts|timestamp|_time|_date)$", re.I)
print("\n=== TIMESTAMP-LIKE COLUMNS BY TYPE ===")
by_type = {"integer": [], "text": [], "other": []}
for t in table_order:
    for c in tables[t]["cols"]:
        if TIME_RE.search(c["name"]):
            by_type.get(c["type"], by_type["other"]).append(f"{t}.{c['name']}")
for k, v in by_type.items():
    print(f"-- {k} ({len(v)}) --")
    for x in v: print("   ", x)

print("\n=== PARALLEL FIELDS WITH DIFFERING TYPES ===")
pairs = [
    ("conversations", "ended_at", "text"),
    ("conversations", "last_attached_at", "text"),
    ("conversations", "created_at", "integer"),
    ("review_runs", "review_spawned_at", "integer"),
    ("review_status", "review_spawned_at", "text"),
    ("review_runs", "conflict_resolution_dispatched_at", "integer"),
    ("review_status", "conflict_resolution_dispatched_at", "text"),
    ("review_runs", "recovery_started_at", "integer"),
    ("review_status", "recovery_started_at", "text"),
    ("transcripts", "first_ts", "integer"),
    ("discovered_sessions", "first_ts", "text"),
    ("transcripts", "last_ts", "integer"),
    ("discovered_sessions", "last_ts", "text"),
    ("transcripts", "file_mtime", "integer"),
    ("discovered_sessions", "file_mtime", "text"),
    ("transcripts", "scanned_at", "integer"),
    ("discovered_sessions", "scanned_at", "text"),
    ("cost_events", "ts", "integer"),
    ("events", "timestamp", "integer"),
    ("git_operations", "ts", "text"),
]
for t, c, ty in pairs:
    actual = next((x["type"] for x in tables[t]["cols"] if x["name"] == c), "?")
    flag = "" if actual == ty else "  <-- MISMATCH expected " + ty
    print(f"  {t}.{c} = {actual}{flag}")

print("\n=== BOOLEAN DEFAULTS ON INTEGER COLUMNS ===")
for t in table_order:
    for c in tables[t]["cols"]:
        if c["default"] and c["default"].upper() in ("TRUE", "FALSE"):
            print(f"  {t}.{c['name']} {c['type']} DEFAULT {c['default']}")

print("\n=== ID COLUMN TYPES (PK) ===")
for t in table_order:
    pk = [c for c in tables[t]["cols"] if c["pk"]]
    for c in pk:
        print(f"  {t}.{c['name']} = {c['type']}{' AUTO' if c['auto'] else ''}")

print("\nWROTE", OUT_EX)
print("WROTE", OUT_MMD)
