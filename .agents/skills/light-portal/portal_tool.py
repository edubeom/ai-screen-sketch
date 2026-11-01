"""개발 관리 사이트 (가벼운 판) -- dev-notes 기록과 저장(git) 목록, 데이터 설계(data-light 정본이 있으면)를 5쪽으로 보는 사이트.
쪽과 주소는 전문판(dev-process-framework)과 같다: 1 개요 · 2 업무 설명 · 4 데이터 · 9 진행 상황 · 10 파일. 파일로 연다 (서버 · 포트 없음).

    python portal_tool.py build [--root .] [--out <폴더>]          # dev-notes/outputs/site/index.html
    python portal_tool.py build --legacy [--out dev-notes/portal.html]   # 예전 기록 보기 페이지 (HTML 파일 하나)
    python portal_tool.py where "<오류 글·파일 이름·화면·표 이름>" [--root .]   # 고칠 곳 -- 기능 지도에서 기능·파일·표를 찾는다

10 파일 쪽(내 시스템 한눈에): 기능 → 파일 → 표, 구성(어디서 돌고 무엇을 쓰나), 쓰는 도구와 버전(package.json·requirements.txt 등에서 읽음),
기능 지도에 없는 파일·지도에는 있는데 없는 파일. 문제가 생기면 코드 전체를 훑지 않고 여기서(where) 고칠 곳부터 찾는다.
화면 틀과 사이트 쓰기 · 2 업무 설명 · 4 데이터 쪽은 짝 스킬 data-light 의 것을 그대로 쓴다 (다시 만들지 않는다).

- 서버·로그인·포트 없이 브라우저로 파일을 연다. 인터넷에 올리지 않는다. 사이트에 실제 주소·포트·이메일을 찍지 않는다.
- dev-notes/outputs/ 에 .gitignore(*) 를 둔다 (기록에서 다시 만들 수 있는 파일이라 저장할 필요가 없다).
- 파이썬 표준 라이브러리만 쓴다 (Windows·macOS·Linux).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
import html as _html
from pathlib import Path

try:   # Windows 콘솔에서 한글이 깨지지 않게
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

HERE = Path(__file__).resolve().parent
NOTES = ["NOW", "FEATURES", "DECISIONS", "LOG", "NAMES", "LEARNED"]
KINDS = ["기능", "수정", "모양", "정리", "데이터", "중간 저장", "되돌리기", "준비"]
DEFAULT_OUT = "dev-notes/portal.html"
MAX_FEATURE_FILES = 400
MODEL = "data/model.light.json"          # 짝 스킬 data-light 의 정본
COL_KEYS = ("name", "label", "type", "required", "unique", "choices", "ref", "on_delete", "key", "personal", "about")


def _git(root: Path, *args: str) -> str:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    try:
        r = subprocess.run(["git", "-c", "core.quotepath=false", "-C", str(root), *args], capture_output=True, text=True, encoding="utf-8",
                           errors="replace", env=env)
    except FileNotFoundError:
        return ""
    return r.stdout.rstrip() if r.returncode == 0 else ""      # 앞 공백은 남긴다 (git status 의 " M 파일")


PUB_NAMES = ("dev-process-light", "data-expert-framework-light")      # 공개본 폴더 이름 (판 이름)


def _pub_dirs(root: Path) -> list:
    """서비스 방식으로 공개한 폴더 (공개 설정에서) -- 사이트의 저장 목록 · 저장 안 한 변경에서 뺀다 (공개본을 저장할 때마다 다음 공개본이 또 바뀌지 않게)."""
    out = []
    for rel, tops in (("dev-notes/outputs-publish.json", PUB_NAMES), ("data/outputs-publish.json", PUB_NAMES[1:])):
        try:
            d = json.loads((root / rel).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
        if isinstance(d, dict) and d.get("mode") == "service" and isinstance(d.get("web_dir"), str):
            base = d["web_dir"].strip("/")
            out += [("" if base in ("", ".") else base + "/") + t + "/" for t in tops]
    return list(dict.fromkeys(out))


def _saves_and_dirty(root: Path) -> tuple:
    """저장 목록(최근 80)과 저장 안 한 변경 -- 공개본 폴더만 바꾼 저장 · 공개본 폴더의 변경은 뺀다."""
    pub = _pub_dirs(root)
    spec = (["--", "."] + [f":(exclude){x}" for x in pub]) if pub else []
    saves = []
    for line in _git(root, "log", "-80", "--format=%h%x00%cI%x00%s", *spec).splitlines():
        h, when, msg = (line.split("\x00") + ["", ""])[:3]
        saves.append({"hash": h, "at": when, "msg": msg, "kind": next((k for k in KINDS if msg.startswith(k + ":")), "")})
    dirty = [ln[3:] for ln in _git(root, "status", "--porcelain", *spec).splitlines()
             if ln[3:] and not ln[3:].startswith(("dev-notes/portal", "dev-notes/outputs", *pub))]
    return saves, dirty


def _project_name(now: str, root: Path) -> str:
    m = re.search(r"## 이 프로젝트는\s*\n+([^\n#<][^\n]*)", now or "")
    line = (m.group(1).strip() if m else "") or root.name
    return line if len(line) <= 60 else line[:58] + "…"


def _rel(target: Path, out: Path) -> str:
    try:
        return Path(os.path.relpath(target, out.parent)).as_posix()
    except ValueError:            # Windows 에서 드라이브가 다르면
        return target.resolve().as_uri()


def _access(v):
    """표의 access: 한 값("members") 또는 읽기·쓰기 두 개 목록(["read", "own"], data-light 0.4.1)."""
    if isinstance(v, list):
        return [str(x) for x in v if isinstance(x, str)]
    return str(v) if v else ""


def _works(v) -> list[dict]:
    """하는 일 (data-light 0.7.0): 일 · 누가 · 화면 · 쓰는 표와 그 표에 하는 일(C·R·U·D)."""
    out = []
    for w in v if isinstance(v, list) else []:
        if not isinstance(w, dict) or not w.get("name"):
            continue
        scr = w.get("screen")
        scr = [str(x) for x in scr if x] if isinstance(scr, list) else ([str(scr)] if scr else [])
        uses = {str(k): str(o) for k, o in (w.get("uses") or {}).items()} if isinstance(w.get("uses"), dict) else {}
        out.append({"name": str(w["name"]), "who": str(w.get("who") or ""), "say": str(w.get("say") or ""), "screen": scr, "uses": uses})
    return out


def _product(v) -> dict | None:
    if not isinstance(v, dict):
        return None
    kinds = [str(x) for x in v.get("kinds") or [] if isinstance(x, str)] if isinstance(v.get("kinds"), list) else []
    return {"kinds": kinds, "main": str(v.get("main") or ""), "said": str(v.get("said") or ""), "main_said": str(v.get("main_said") or "")}


def data_summary(root: Path, out: Path) -> dict | None:
    """data-light 정본의 구조만 (샘플 행·기본값 밖의 값은 담지 않는다 -- 페이지는 구조를 보여 주는 곳)."""
    p = root / MODEL
    if not p.is_file():
        return None
    try:
        m = json.loads(p.read_text(encoding="utf-8"))
        tables = []
        for t in m.get("tables") or []:
            cols = [{k: c[k] for k in COL_KEYS if k in c} for c in (t.get("columns") or []) if isinstance(c, dict)]
            uniq = [[str(x) for x in u] for u in (t.get("unique") or []) if isinstance(u, list)]   # 두 칸 이상 묶은 중복 금지
            tables.append({"name": t.get("name", ""), "label": t.get("label", ""), "about": t.get("about", ""),
                           "timestamps": t.get("timestamps", True) is not False, "columns": cols, "unique": uniq,
                           "access": _access(t.get("access"))})     # 누가 이 표를 쓰나 (Supabase 규칙)
        goals = [{"say": g.get("say", ""), "sql": g.get("sql", "")} for g in (m.get("goals") or []) if isinstance(g, dict)]
        info = {"file": MODEL, "project": m.get("project", ""), "db": m.get("db", "sqlite"), "tables": tables,
                "goals": goals, "not_doing": [str(x) for x in (m.get("not_doing") or [])],   # 성공 기준의 기대 결과(샘플 값)는 담지 않는다
                "signup": str(m["signup"]) if m.get("signup") else "",
                "product": _product(m.get("product")),          # 만드는 것 (data-light 0.5.0, 사용자 말 그대로)
                "works": _works(m.get("works")),                # 하는 일 (data-light 0.7.0)
                "outside": [str(x) for x in m["outside"] if isinstance(x, str)] if isinstance(m.get("outside"), list) else []}
    except (ValueError, AttributeError, TypeError) as e:
        info = {"file": MODEL, "error": f"정본을 읽지 못함: {e}", "tables": []}
    info["links"] = {n: _rel(root / "data" / "out" / n, out) for n in ("book.html", "erd.md", "spec.md", "schema.sql")
                     if (root / "data" / "out" / n).is_file()}
    return info


# ---------------------------------------------------------------- 내 시스템 한눈에 (기능 지도 FEATURES.md + 데이터 정본 + 매니페스트)
CODE_EXT = (".html", ".htm", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".py", ".sql", ".php", ".rb", ".go", ".json")
SKIP_DIRS = ("dev-notes/", "manual/", "data/out/", ".claude/", ".agents/", ".data-light/", ".github/", "node_modules/", "examples/", "tests/", "test/")
PRUNE = frozenset({"node_modules", ".git", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".nuxt", "vendor", "site-packages", "coverage"})
MAX_WALK = 5000
SKIP_FILES = ("package-lock.json", "package.json", "tsconfig.json", "data/model.light.json", "data/model.light.json.layout.json", "data/import_plan.json")


def _cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def _section(text: str, title: str) -> str:
    m = re.search(r"\n##\s*" + re.escape(title) + r"[^\n]*\n([\s\S]*?)(?=\n##\s|$)", "\n" + (text or ""))
    return m.group(1) if m else ""


def _rows(block: str) -> list[list[str]]:
    out = []
    for ln in block.splitlines():
        if not ln.strip().startswith("|") or re.match(r"^\s*\|[\s:|-]+\|\s*$", ln) or "(예)" in ln:
            continue
        out.append(_cells(ln))
    return out[1:] if out else out                     # 첫 줄은 머리


FILE_RX = re.compile(r"[\w.\-/]*\w\.[A-Za-z0-9]{1,6}\b|[\w.\-]+(?:/[\w.\-]+)*/(?=\s|$|[,)])")


def _files(cell: str) -> list[str]:
    """칸 글에서 파일·폴더 이름만 (설명 괄호는 뺀다): 'index.html (화면 틀), store.js' → index.html, store.js"""
    got = [m.group(0) for m in FILE_RX.finditer((cell or "").replace("`", " "))]
    return list(dict.fromkeys(x for x in got if not re.match(r"^v?\d+(\.\d+)+$", x)))


def feature_map(text: str) -> dict:
    """FEATURES.md -- 기능 표(기능·상태·쓰는 파일) · 함께 쓰는 파일 · 구성 · 데이터(표 → 쓰는 기능)."""
    text = re.sub(r"<!--[\s\S]*?-->", "", text or "")
    head = text.split("\n## ", 1)[0]
    feats = []
    for c in _rows(head):
        if len(c) >= 3 and c[0] and c[0] != "기능":
            feats.append({"name": c[0], "state": c[1], "files": _files(c[2]), "check": c[3] if len(c) > 3 else "",
                          "manual": _files(c[4]) if len(c) > 4 else []})
    shared = []
    for ln in _section(text, "함께 쓰는 파일").splitlines():
        if ln.strip().startswith("-") and "(예)" not in ln:
            shared += _files(ln.strip()[1:])
    parts = [{"part": c[0], "what": c[1] if len(c) > 1 else "", "where": c[2] if len(c) > 2 else "", "files": _files(c[3]) if len(c) > 3 else []}
             for c in _rows(_section(text, "구성")) if c and c[0] and c[0] != "부분"]
    tables = [{"name": c[0].strip("`"), "label": c[1] if len(c) > 1 else "", "features": [x.strip() for x in re.split(r"[,、]\s*", c[2]) if x.strip()] if len(c) > 2 else []}
              for c in _rows(_section(text, "데이터")) if c and c[0] and c[0] != "표"]
    return {"features": feats, "shared": shared, "parts": parts, "tables": tables}


def _ver(spec) -> str:
    m = re.search(r"(\d+(?:\.\d+)*)", str(spec or ""))
    return m.group(1) if m else str(spec or "")


def tools(root: Path) -> list[dict]:
    """쓰는 도구와 버전 -- 프로젝트의 파일에서 직접 읽는다 (AI 가 적은 글이 아니라). 많으면 앞의 40개."""
    out = []

    def add(name, ver, f):
        if len(out) < 40:
            out.append({"name": str(name), "version": _ver(ver), "file": f})
    p = root / "package.json"
    if p.is_file():
        try:
            d = json.loads(p.read_text(encoding="utf-8-sig"))
            for k, v in (d.get("engines") or {}).items():
                add(k, v, "package.json")
            for sect in ("dependencies", "devDependencies"):
                for k, v in (d.get(sect) or {}).items():
                    add(k, v, "package.json")
        except (ValueError, AttributeError):
            pass
    for name in ("requirements.txt", "requirements-dev.txt"):
        p = root / name
        if p.is_file():
            for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
                m = re.match(r"^([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|~=|<=|>|<)\s*([^\s,;#]+)", ln.split("#", 1)[0].strip())
                if m:
                    add(m.group(1), m.group(2), name)
    p = root / "pyproject.toml"
    if p.is_file():
        t = p.read_text(encoding="utf-8", errors="replace")
        m = re.search(r'(?m)^\s*requires-python\s*=\s*"([^"]+)"', t)
        if m:
            add("python", m.group(1), "pyproject.toml")
        for m in re.finditer(r'"\s*([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|~=)\s*([^",;\s]+)', t):
            add(m.group(1), m.group(2), "pyproject.toml")
    for name, tool in ((".python-version", "python"), (".nvmrc", "node"), (".node-version", "node")):
        p = root / name
        if p.is_file():
            add(tool, p.read_text(encoding="utf-8", errors="replace").strip(), name)
    p = root / "supabase" / "config.toml"
    if p.is_file():
        m = re.search(r"(?m)^\s*major_version\s*=\s*(\d+)", p.read_text(encoding="utf-8", errors="replace"))
        if m:
            add("postgres (Supabase)", m.group(1), "supabase/config.toml")
    for f in sorted(root.glob("*.html"))[:20]:                   # CDN 으로 불러오는 라이브러리 (예: @supabase/supabase-js@2.45.0)
        for src in re.findall(r"""src=["']([^"']+)["']""", f.read_text(encoding="utf-8", errors="replace")):
            m = re.search(r"(@[\w.\-]+/[\w.\-]+|[\w.\-]+)@(\d+(?:\.\d+)*)", src)
            if m:
                add(m.group(1), m.group(2), f.name)
    seen, uniq = set(), []
    for t in out:
        k = (t["name"].lower(), t["file"])
        if k not in seen:
            seen.add(k)
            uniq.append(t)
    return uniq


def _project_files(root: Path) -> list:
    """프로젝트 파일 (git 이 추적하는 것 + 아직 저장 안 한 새 파일, git 이 아니면 폴더를 걷는다).
    node_modules · .venv · dist 같은 폴더는 어느 깊이에 있어도 들어가지 않는다 (걷지도 않는다 -- 큰 폴더에서 느려지지 않게)."""
    out = _git(root, "ls-files", "--cached", "--others", "--exclude-standard").splitlines()
    if not out:
        for dp, dirs, files in os.walk(root):
            dirs[:] = sorted(d for d in dirs if d not in PRUNE and not d.startswith("."))
            rel = Path(dp).relative_to(root).as_posix()
            out += [f if rel == "." else f"{rel}/{f}" for f in sorted(files)]
            if len(out) >= MAX_WALK:
                break
    # 공개본 폴더 (사이트가 만든 파일 -- 기능 지도 밖): 공개 설정의 폴더 + 판 이름 폴더의 표시. 다른 이름의 폴더는 표시가 있어도 숨기지 않는다
    pub = tuple(_pub_dirs(root)) + tuple(f[: -len(".outputs-publish.json")] for f in out if f.endswith("/.outputs-publish.json")
                                         and f.split("/")[-2] in PUB_NAMES)
    return sorted(f for f in out if f and not any(part in PRUNE for part in f.split("/")) and not (pub and f.startswith(pub)))[:MAX_WALK]


def system_map(root: Path, notes: dict, data: dict | None) -> dict:
    """내 시스템 한눈에 -- 기능 → 파일 → 표, 구성, 쓰는 도구와 버전, 기능 지도에 없는 파일 · 지도에는 있는데 없는 파일."""
    fm = feature_map(notes.get("FEATURES") or "")
    listed = {f for x in fm["features"] for f in x["files"]} | set(fm["shared"]) | {f for p in fm["parts"] for f in p["files"]}
    tracked = _project_files(root)
    have = set(tracked) | {Path(f).name for f in tracked}
    missing = sorted(f for f in listed if not f.endswith("/") and "*" not in f and not (root / f).exists() and f not in have
                     and not any(t.endswith("/" + f) for t in tracked))
    names = {Path(f).name for f in listed}
    unlisted = sorted(f for f in tracked if f.lower().endswith(CODE_EXT) and not f.startswith(SKIP_DIRS) and f not in SKIP_FILES
                      and f not in listed and Path(f).name not in names and not f.startswith("."))[:40]
    works = (data or {}).get("works") or []
    return dict(fm, tools=tools(root), missing=missing, unlisted=unlisted,
                works=[{"name": w["name"], "screen": w["screen"], "uses": sorted(w["uses"])} for w in works])


def where(root: Path, query: str) -> dict:
    """고칠 곳 찾기 (light) -- 오류 글·파일 이름·화면·표 이름에서 기능 지도의 기능 · 파일 · 표로. 먼저 볼 파일을 준다."""
    notes = {n: ((root / "dev-notes" / f"{n}.md").read_text(encoding="utf-8") if (root / "dev-notes" / f"{n}.md").is_file() else None) for n in NOTES}
    data = data_summary(root, root / DEFAULT_OUT)
    m = system_map(root, notes, data)
    q = (query or "").strip()
    ql = q.lower()
    toks = [t for t in re.split(r"[\s,;:()\[\]{}'\"=<>]+", ql) if len(t) >= 2]
    hits, read = [], []

    def score_text(*xs):
        # names inside the query count too: Korean particles ("메모가", "가계부는") keep the token from matching the name
        names = [str(x).lower() for x in xs if x]
        s = " ".join(names)
        return (3 if ql and ql in s else 0) + sum(1 for t in toks if t in s) + sum(4 for n in names if len(n) >= 2 and n in ql)
    files_in_q = {Path(x).name.lower() for x in re.findall(r"[\w./\\-]+\.[A-Za-z0-9]{1,5}", q)}
    for f in m["features"]:
        sc = score_text(f["name"]) + (5 if any(Path(x).name.lower() in files_in_q for x in f["files"]) else 0)
        if sc:
            hits.append({"kind": "기능", "name": f["name"], "state": f["state"], "files": f["files"], "score": sc,
                         "tables": [t["name"] for t in m["tables"] if f["name"] in t["features"]]})
    for t in m["tables"]:
        sc = score_text(t["name"], t["label"])
        if sc:
            hits.append({"kind": "표", "name": t["name"], "label": t["label"], "features": t["features"], "score": sc,
                         "files": [x for f in m["features"] if f["name"] in t["features"] for x in f["files"]]})
    for w in m["works"]:
        sc = score_text(w["name"], " ".join(w["screen"]))
        if sc:
            hits.append({"kind": "하는 일", "name": w["name"], "screen": w["screen"], "tables": w["uses"], "score": sc, "files": []})
    for p in m["parts"]:
        sc = score_text(p["part"], p["what"], p["where"]) + (5 if any(Path(x).name.lower() in files_in_q for x in p["files"]) else 0)
        if sc:
            hits.append({"kind": "구성", "name": p["part"], "what": p["what"], "where": p["where"], "files": p["files"], "score": sc})
    sh = [x for x in m["shared"] if Path(x).name.lower() in files_in_q]
    if sh:
        hits.append({"kind": "함께 쓰는 파일", "name": ", ".join(sh), "files": sh, "score": 4,
                     "note": "여러 기능이 같이 쓰는 파일 -- 고치면 모든 기능(" + ", ".join(f["name"] for f in m["features"]) + ")을 점검한다"})
    hits.sort(key=lambda h: -h["score"])
    for h in hits[:5]:
        read += h.get("files") or []
    if (root / MODEL).is_file() and any(h["kind"] in ("표", "하는 일") for h in hits[:5]):
        read.append(MODEL)
    return {"query": q, "found": hits[:5], "read": list(dict.fromkeys(read))[:8],
            "unlisted": m["unlisted"][:10], "note": "" if hits else "찾지 못했다 -- 기능 이름·화면 이름·파일 이름·표 이름으로 다시 찾거나, 기능 지도(FEATURES.md)를 채운다"}


# ---------------------------------------------------------------- 개발 관리 사이트 (가벼운 판 5쪽 -- 파일로 연다, 서버 · 포트 없음)
VERSION = "0.17.1"                       # dev-process-light 판 (CHANGELOG 맨 위와 같다 -- check_kit 가 본다)
SITE_OUT = "dev-notes/outputs/site"      # 사양 v1.1 의 dev-light 자리 -- dev-notes/outputs/ 에 .gitignore(*) 를 둔다
MAX_LOG_PAGES = 60                       # 기능별 기록 쪽은 최근 것만 (나머지는 목록에 이름만)
MAX_FLOW = 400
LOOP_RX = re.compile(r"(?i)(?:https?://)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}\b")
EMAIL_RX = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
NOTE_LABEL = {"NOW": "지금 상황", "FEATURES": "기능 지도", "DECISIONS": "결정 기록", "LOG": "작업 기록 (흐름)", "NAMES": "이름표", "LEARNED": "배운 것"}
STATE_TONE = (("✅", "ok"), ("⚠", "bad"), ("🚧", "warn"), ("💤", ""))
SITE_READ_DEV = {
    "overview": "지금 하는 작업, 확인할 것, 다음에 할 일을 한 화면에 봅니다. 숫자를 누르면 자세한 쪽으로 갑니다.",
    "business": "이 프로그램이 하는 일 -- 기능 지도(FEATURES.md)의 기능과, 데이터 설계가 있으면 데이터를 쓰는 일(누가 · 어느 화면에서 · 어느 표를)을 봅니다.",
    "data": "표마다 한 줄이 무엇인지, 어떤 칸이 있는지, 어떤 값이 들어가는지(만든 예시 값)를 봅니다. 그림은 표 사이의 연결입니다.",
    "progress": "어디까지 됐고 무엇이 남았는지 -- 지금 작업의 완료 기준, 작업 기록(흐름 → 기능별 기록), 결정(누가 정했나), 저장 목록을 봅니다.",
    "files": "기능 → 쓰는 파일 → 표(기능 지도), 구성, 쓰는 도구와 버전, 기록 파일을 봅니다. 사이트는 보기만 합니다 -- 고칠 때는 기록 · 정본을 고칩니다."}


class SiteError(Exception):
    pass


def _datalight():
    """짝 스킬 data-light 의 도구 (설치하면 같은 스킬 폴더의 형제). 사이트 쓰기와 2 업무 설명 · 4 데이터 쪽을 빌린다 -- 다시 만들지 않는다."""
    p = HERE.parent / "data-light" / "scripts"
    if not (p / "datalight.py").is_file():
        raise SiteError("짝 스킬 data-light 가 없습니다 -- dev-process-light 를 다시 설치합니다")
    sys.dont_write_bytecode = True                  # 설치된 스킬 폴더에 __pycache__ 를 남기지 않는다
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
    import datalight  # noqa: E402 -- 표준 라이브러리만 쓰는 짝 스킬
    if not hasattr(datalight, "write_site"):
        raise SiteError("짝 스킬 data-light 가 오래됐습니다 (0.8.0 부터 사이트) -- dev-process-light 를 다시 설치합니다")
    return datalight


def _scrub(v):
    """사이트에 실제 주소 · 포트 · 이메일을 찍지 않는다 (사양 v1.1 -- 가벼운 판도 같다)."""
    if isinstance(v, str):
        return EMAIL_RX.sub("<이메일>", LOOP_RX.sub("<서비스 주소>", v))
    if isinstance(v, list):
        return [_scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: _scrub(x) for k, x in v.items()}
    return v


def _nocomment(text: str) -> str:
    return re.sub(r"<!--[\s\S]*?-->", "", text or "")


def _bullets(block: str) -> list:
    out = []
    for ln in (block or "").splitlines():
        s = ln.strip()
        if re.match(r"^[-*]\s+", s) and "(예)" not in s:
            out.append(re.sub(r"^[-*]\s+", "", s))
    return out


def now_info(text: str) -> dict:
    """NOW.md -- 이 프로젝트는(설명 + 다섯 줄), 지금 작업 카드, 다음에 할 일, 마지막 저장, 설정."""
    t = _nocomment(text)
    about = _section(t, "이 프로젝트는")
    desc = next((ln.strip() for ln in about.splitlines() if ln.strip() and not ln.strip().startswith(("-", ">", "#"))), "")
    if desc.startswith("(") and "무엇을 만드는지" in desc:
        desc = ""
    answers = [tuple(x.split(":", 1)) for x in _bullets(about) if ":" in x]
    card = _section(t, "지금 작업")
    task = None
    m = re.search(r"###\s*작업\s*:\s*([^\n]+)", card)
    if m:
        task = {"title": m.group(1).strip(), "goal": "", "criteria": [], "features": "", "state": "", "manual": "", "data": ""}
        for ln in card.splitlines():
            s = ln.strip()
            cm = re.match(r"^[-*]\s*\[([ xX✓])\]\s*(.+)$", s)
            if cm:
                task["criteria"].append({"text": cm.group(2).strip(), "done": cm.group(1) != " "})
                continue
            for key, label in (("goal", "목표"), ("features", "건드릴 기능"), ("state", "진행"), ("manual", "설명서"), ("data", "데이터")):
                km = re.match(r"^[-*]\s*" + label + r"\s*:\s*(.*)$", s)
                if km:
                    task[key] = km.group(1).strip()
    last = next((ln.strip() for ln in _section(t, "마지막 저장").splitlines() if ln.strip()), "")
    return {"desc": desc, "answers": [(k.strip(), v.strip()) for k, v in answers], "task": task,
            "next": _bullets(_section(t, "다음에 할 일")), "last": last, "settings": _bullets(_section(t, "설정"))}


def flow_rows(root: Path) -> list:
    """작업 기록 흐름 -- LOG.md (+ 지난달 dev-notes/log/_흐름/, 예전 dev-notes/log/*.md). 형식: 날짜 시각 · 단계 · 기능 · 무엇을 · 결과 · 누가."""
    files = [root / "dev-notes" / "LOG.md"]
    logdir = root / "dev-notes" / "log"
    if logdir.is_dir():
        files += sorted([*logdir.glob("_흐름/*.md"), *logdir.glob("*.md")], key=lambda p: p.stem, reverse=True)
    rows = []
    for f in files:
        if not f.is_file():
            continue
        for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
            s = ln.strip()
            if not s.startswith("- ") or " · " not in s:
                continue
            p = [x.strip() for x in s[2:].split(" · ")]
            if len(p) > 6:
                p = p[:3] + [" · ".join(p[3:-2])] + p[-2:]
            p += [""] * (6 - len(p))
            rows.append({"when": p[0], "step": p[1], "feature": p[2], "what": p[3], "result": p[4], "who": p[5], "file": f.relative_to(root).as_posix()})
            if len(rows) >= MAX_FLOW:
                return rows
    return rows


def feature_logs(root: Path) -> list:
    """기능별 기록 dev-notes/log/<기능>/<날짜>.md -- 최신이 위."""
    logdir = root / "dev-notes" / "log"
    if not logdir.is_dir():
        return []
    out = []
    for p in sorted(logdir.glob("*/*.md"), key=lambda p: (p.stem, p.parent.name), reverse=True)[:MAX_FEATURE_FILES]:
        if p.parent.name.startswith("_"):
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        out.append({"feature": p.parent.name, "date": p.stem, "file": p.relative_to(root).as_posix(), "items": _bullets(_section(text, "목록")),
                    "detail": _section(text, "자세히").strip(), "text": text})
    return out


def decisions(text: str) -> list:
    """DECISIONS.md -- '- 날짜 [사용자|AI] 무엇 -- 원문 또는 이유'."""
    out = []
    for s in _bullets(_nocomment(text)):
        m = re.match(r"^(\d{4}-\d{2}-\d{2})?\s*(?:\[([^\]]+)\])?\s*(.*)$", s)
        if not m or not (m.group(1) or m.group(2)) or s.startswith("YYYY"):
            continue
        what, _, why = m.group(3).partition(" -- ")
        out.append({"date": m.group(1) or "", "by": (m.group(2) or "").strip(), "what": what.strip(), "why": why.strip()})
    return out


def _short_name(name: str) -> str:
    """사이트 머리의 이름 -- 첫 문장만 (길면 자른다). 전체 설명은 개요의 '이 프로젝트는'에."""
    name = (name or "").strip()
    m = re.match(r"^(.{4,40}?)(?:[.。!?](?:\s|$)|$)", name)
    if m:
        return m.group(1).rstrip(" .")
    return name[:38].rstrip() + "…" if len(name) > 40 else name


def _sha12(b: bytes) -> str:
    import hashlib
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()[:12]


def _tone(state: str) -> str:
    return next((t for k, t in STATE_TONE if k in (state or "")), "")


def site_pages(root: Path, dl, mark: str, now: str) -> tuple:
    """dev-light 5쪽 + 기능별 기록 부분 쪽 + 메뉴 아래 줄 + 찾기 색인. 1 · 9 · 10 은 dev-notes 기록에서, 2 · 4 는 data-light 에서."""
    notes = {n: ((root / "dev-notes" / f"{n}.md").read_text(encoding="utf-8", errors="replace") if (root / "dev-notes" / f"{n}.md").is_file() else None)
             for n in NOTES}
    src = [{"path": f"dev-notes/{n}.md", "fingerprint": _sha12(notes[n].encode("utf-8")) if notes[n] is not None else None,
            "label": NOTE_LABEL[n], "missing": notes[n] is None} for n in NOTES if notes[n] is not None or n in ("NOW", "FEATURES")]
    now_ = now_info(notes["NOW"] or "")
    fm = feature_map(notes["FEATURES"] or "")
    data = data_summary(root, root / SITE_OUT / "index.html")
    smap = system_map(root, notes, data)
    flows = flow_rows(root)
    flogs = feature_logs(root)
    decs = decisions(notes["DECISIONS"] or "")
    saves, dirty = _saves_and_dirty(root)
    project = _short_name(_project_name(notes["NOW"] or "", root))
    fw = dict(framework="dev-light", framework_version=VERSION, mark=mark, now=now)

    def chip(t, href=None, kind=None):
        return {"_": mark, "chip": True, "t": str(t), "href": href, "kind": kind}

    def badge(t, tone=""):
        return {"_": mark, "badge": True, "t": str(t), "tone": tone}

    def mono(t, href=None):
        return {"_": mark, "t": str(t), "mono": True, "href": href}

    def txt(t, sub=None, href=None, tone=None):
        return {"_": mark, "t": str(t), "sub": sub or None, "href": href, "tone": tone}

    def page(pid, secs, *, blanks=None, title=None, subtitle=None, sources=None, wide=False, sub=None, read=None, crumb=None):
        return dl.site_page(pid, secs, source=src if sources is None else sources, blanks=blanks, title=title, subtitle=subtitle, wide=wide,
                            sub=sub, read=SITE_READ_DEV.get(pid, "") if read is None else read, crumb=crumb, **fw)
    feats = fm["features"]
    ftables = {f["name"]: [t for t in fm["tables"] if f["name"] in t["features"]] for f in feats}
    log_slug = {(x["feature"], x["date"]): f"log/{i + 1}" for i, x in enumerate(flogs[:MAX_LOG_PAGES])}
    log_by_feature = {}
    for x in flogs:
        log_by_feature.setdefault(x["feature"], x)
    model, model_err, dpages, derrs, dwarns = None, None, {}, [], []
    if (root / MODEL).is_file():
        try:
            model = dl.load(root / MODEL)
            dpages = dl.site_pages(model, root / MODEL, mark, now, framework="dev-light", framework_version=VERSION)
            derrs, dwarns = dl.check(model)
        except (ValueError, KeyError, TypeError, AttributeError) as e:     # 정본이 깨져도 나머지 쪽은 만든다
            model, model_err = None, f"정본({MODEL})을 읽지 못함: {type(e).__name__}: {e}"
    tdone = sum(1 for c in (now_["task"] or {}).get("criteria", []) if c["done"])
    ttot = len((now_["task"] or {}).get("criteria", []))
    pages, subs = {}, []

    # 1 개요 -----------------------------------------------------------------
    todo = []
    if now_["task"]:
        tk = now_["task"]
        todo.append({"text": f"지금 작업: {tk['title']}" + (f" -- {tk['state']}" if tk["state"] else ""), "href": "progress/#task"})
        todo += [{"text": "확인 전: " + c["text"], "tone": "warn", "href": "progress/#task"} for c in tk["criteria"] if not c["done"]]
    if dirty:
        todo.append({"text": f"저장하지 않은 변경 {len(dirty)}개 -- 확인이 끝나면 저장(light-save)", "tone": "warn", "href": "progress/#dirty"})
    todo += [{"text": f"문제 있는 기능: {f['name']}", "tone": "bad", "href": "business/#features"} for f in feats if _tone(f["state"]) == "bad"]
    if model_err:
        todo.append({"text": model_err, "tone": "bad", "href": "data/"})
    todo += [{"text": "데이터 설계 고칠 것: " + e, "tone": "bad", "href": "progress/#data-check"} for e in derrs]
    if smap["missing"]:
        todo.append({"text": f"기능 지도에는 있는데 없는 파일 {len(smap['missing'])}개", "tone": "bad", "href": "files/#missing"})
    if smap["unlisted"]:
        todo.append({"text": f"기능 지도에 없는 파일 {len(smap['unlisted'])}개 -- FEATURES.md 에 넣는다", "tone": "warn", "href": "files/#unlisted"})
    todo += [{"text": "다음: " + x} for x in now_["next"][:3]]
    secs = [{"kind": "todo", "id": "todo", "title": "지금 할 일", "items": todo, "empty": "지금 할 일이 없습니다"}]
    bars = [{"label": "기능", "sub": "동작", "done": sum(1 for f in feats if _tone(f["state"]) == "ok"), "total": len(feats), "href": "business/#features"}]
    if now_["task"]:
        bars.insert(0, {"label": "이번 작업", "sub": "완료 기준 확인", "done": tdone, "total": ttot, "href": "progress/#task"})
    secs.append({"kind": "bars", "id": "progress", "title": "진행", "items": bars})
    kv = [["무엇을 만드나", now_["desc"] or "(아직 적지 않음)"]] + [[k, v] for k, v in now_["answers"]]
    if now_["last"]:
        kv.append(["마지막 저장", now_["last"]])
    secs.append({"kind": "kv", "id": "system", "title": "이 프로젝트는", "items": kv})
    secs.append({"kind": "list", "id": "next", "title": "다음에 할 일", "count": len(now_["next"]), "items": now_["next"], "empty": "적힌 것이 없습니다"})
    secs.append({"kind": "cards", "id": "counts", "title": "한눈에", "items": [
        {"label": "기능", "value": len(feats), "href": "business/#features"},
        {"label": "표", "value": len((model or {}).get("tables") or []), "href": "data/"},
        {"label": "결정", "value": len(decs), "sub": f"사용자 {sum(1 for d in decs if d['by'] == '사용자')}", "href": "progress/#decisions"},
        {"label": "저장", "value": len(saves), "href": "progress/#saves"},
        {"label": "저장 안 한 변경", "value": len(dirty), "tone": "warn" if dirty else "ok", "href": "progress/#dirty"}]})
    secs.append({"kind": "table", "id": "recent", "title": "최근 작업 기록", "count": min(len(flows), 6), "empty": "작업 기록(LOG.md)이 아직 없습니다",
                 "lead": "전체는 진행 상황 쪽에 있습니다.",
                 "columns": [{"key": "when", "label": "언제", "nw": True}, {"key": "step", "label": "단계", "nw": True}, {"key": "feature", "label": "기능", "nw": True},
                             {"key": "what", "label": "무엇을"}, {"key": "result", "label": "결과"}],
                 "rows": [{"when": r["when"], "step": r["step"], "feature": r["feature"], "what": r["what"], "result": r["result"]} for r in flows[:6]]})
    blank1 = ([] if now_["desc"] else ["무엇을 만드는지 (NOW.md 의 '이 프로젝트는')"]) + ([] if feats else ["기능 지도 (FEATURES.md 의 기능 표)"])
    pages["overview"] = page("overview", secs, blanks=blank1, title=project, subtitle="개요")

    # 2 업무 설명 ---------------------------------------------------------------
    frows = []
    for i, f in enumerate(feats):
        lg = log_by_feature.get(f["name"])
        frows.append({"_id": f"f-{i + 1}", "_tone": "bad" if _tone(f["state"]) == "bad" else None, "name": txt(f["name"]),
                      "state": badge(f["state"] or "모름", _tone(f["state"])), "check": f["check"] or None,
                      "tables": [chip(t["label"] or t["name"], "data/#t-" + t["name"] if model and t["name"] in {x.get("name") for x in model.get("tables") or []} else None)
                                 for t in ftables.get(f["name"]) or []],
                      "log": chip(lg["date"], "progress/" + log_slug[(lg["feature"], lg["date"])] + "/") if lg and (lg["feature"], lg["date"]) in log_slug else None})
    secs = [{"kind": "table", "id": "features", "title": "기능", "count": len(feats), "empty": "기능 지도(FEATURES.md)에 기능이 아직 없습니다",
             "lead": "상태: ✅ 동작 · 🚧 만드는 중 · ⚠️ 문제 있음 · 💤 쉬는 중. 기능마다 쓰는 파일은 파일 쪽의 기능 지도에.",
             "columns": [{"key": "name", "label": "기능"}, {"key": "state", "label": "상태", "nw": True}, {"key": "check", "label": "확인 방법"},
                         {"key": "tables", "label": "쓰는 표"}, {"key": "log", "label": "최근 기록", "nw": True}], "rows": frows}]
    blank2 = [] if feats else ["기능 (FEATURES.md)"]
    if dpages:
        secs += dpages["business"]["body"]["sections"]
        blank2 += [b["label"] for b in dpages["business"]["blanks"]["items"]]
    else:
        secs.append({"kind": "empty", "id": "works", "title": "데이터를 쓰는 일",
                     "why": model_err or "데이터 설계(data/model.light.json)가 아직 없습니다 -- 저장할 데이터가 없는 프로그램이면 비어 있는 것이 맞습니다.",
                     "how": ["회원 · 글 · 예약 · 주문처럼 저장할 데이터가 생기면 화면 · 코드보다 먼저 data-light 로 설계한다 (규칙 12)",
                             "정본 data/model.light.json 의 works 에 하는 일(누가 · 어느 화면에서 · 어느 표를)을 적는다"], "cmd": None})
    pages["business"] = page("business", secs, blanks=blank2,
                             sources=src[:2] + (dpages["business"]["source"] if dpages else []))

    # 4 데이터 ------------------------------------------------------------------
    if dpages:
        d4 = dpages["data"]
        d4["read"]["text"] = SITE_READ_DEV["data"]
        pages["data"] = d4
    else:
        pages["data"] = page("data", [{"kind": "empty", "id": "tables", "title": "표",
                                       "why": model_err or "데이터 설계(data/model.light.json)가 아직 없습니다.",
                                       "how": ["저장할 데이터가 생기면 data-light 로 정본을 만든다: 표 · 칸 · 표 사이 연결 · 예시 값(만든 값)",
                                               "그림(ERD)과 표로 사용자에게 확인받은 뒤 화면 · 코드를 만든다"], "cmd": None}],
                             sources=[], blanks=["데이터 설계 (data/model.light.json)"] if not model_err else [model_err])

    # 9 진행 상황 ---------------------------------------------------------------
    nuser = sum(1 for d in decs if d["by"] == "사용자")
    secs = [{"kind": "cards", "id": "summary", "items": [
        {"label": "이번 작업 완료 기준", "value": f"{tdone}/{ttot}" if now_["task"] else "—", "tone": "ok" if now_["task"] and tdone == ttot else ("warn" if now_["task"] else None), "href": "#task"},
        {"label": "기능 동작", "value": f"{sum(1 for f in feats if _tone(f['state']) == 'ok')}/{len(feats)}", "href": "business/#features"},
        {"label": "작업 기록", "value": len(flows), "href": "#flow"},
        {"label": "결정", "value": len(decs), "sub": f"사용자 {nuser} · AI {len(decs) - nuser}", "href": "#decisions"},
        {"label": "저장", "value": len(saves), "href": "#saves"},
        {"label": "저장 안 한 변경", "value": len(dirty), "tone": "warn" if dirty else "ok", "href": "#dirty"}]}]
    if now_["task"]:
        tk = now_["task"]
        secs.append({"kind": "kv", "id": "task", "title": "지금 작업: " + tk["title"],
                     "items": [[k, v] for k, v in (("목표", tk["goal"]), ("건드릴 기능", tk["features"]), ("진행", tk["state"]),
                                                   ("데이터", tk["data"]), ("설명서", tk["manual"])) if v]})
        secs.append({"kind": "list", "id": "criteria", "title": "완료 기준", "count": ttot, "empty": "완료 기준이 적혀 있지 않습니다",
                     "items": [{"text": c["text"], "badge": "확인함" if c["done"] else "아직", "tone": "ok" if c["done"] else "warn"} for c in tk["criteria"]]})
    else:
        secs.append({"kind": "text", "id": "task", "tone": "note", "text": "지금 하는 작업이 없습니다 -- 새 작업은 목표와 완료 기준을 먼저 정합니다 (light-start)."})
    secs.append({"kind": "table", "id": "flow", "title": "작업 기록 (흐름)", "count": len(flows), "filter": True, "empty": "작업 기록(LOG.md)이 아직 없습니다",
                 "lead": "최신이 위. 기능을 누르면 그 기능 · 날짜의 기록(목록 · 자세히)으로 갑니다.",
                 "columns": [{"key": "when", "label": "언제", "nw": True}, {"key": "step", "label": "단계", "nw": True}, {"key": "feature", "label": "기능", "nw": True},
                             {"key": "what", "label": "무엇을"}, {"key": "result", "label": "결과"}, {"key": "who", "label": "누가", "nw": True}],
                 "rows": [{"_tone": "warn" if r["step"] == "되돌리기" else None, "when": r["when"], "step": r["step"],
                           "feature": (chip(r["feature"], "progress/" + log_slug[(r["feature"], r["when"][:10])] + "/")
                                       if (r["feature"], r["when"][:10]) in log_slug else r["feature"]),
                           "what": r["what"], "result": r["result"], "who": r["who"]} for r in flows]})
    secs.append({"kind": "table", "id": "logs", "title": "기능별 기록", "count": len(flogs), "filter": len(flogs) > 10,
                 "empty": "기능별 기록(dev-notes/log/<기능>/<날짜>.md)이 아직 없습니다",
                 "columns": [{"key": "feature", "label": "기능", "nw": True}, {"key": "date", "label": "날짜", "nw": True},
                             {"key": "items", "label": "목록", "num": True}, {"key": "first", "label": "첫 줄"}],
                 "rows": [{"feature": chip(x["feature"], "progress/" + log_slug[(x["feature"], x["date"])] + "/") if (x["feature"], x["date"]) in log_slug else x["feature"],
                           "date": x["date"], "items": len(x["items"]), "first": x["items"][0] if x["items"] else None} for x in flogs]})
    secs.append({"kind": "table", "id": "decisions", "title": "결정", "count": len(decs), "filter": len(decs) > 10, "empty": "결정 기록이 아직 없습니다",
                 "lead": "[사용자] 는 사용자가 한 말 그대로, [AI] 는 AI 가 정한 이유와 다른 안.",
                 "columns": [{"key": "date", "label": "날짜", "nw": True}, {"key": "by", "label": "누가", "nw": True}, {"key": "what", "label": "무엇을"},
                             {"key": "why", "label": "원문 · 이유"}],
                 "rows": [{"date": d["date"], "by": badge(d["by"] or "?", "ok" if d["by"] == "사용자" else ""), "what": d["what"], "why": d["why"] or None} for d in decs]})
    secs.append({"kind": "table", "id": "saves", "title": "저장 (되돌아올 수 있는 지점)", "count": len(saves), "filter": len(saves) > 10,
                 "empty": "아직 저장(git)이 없습니다",
                 "columns": [{"key": "at", "label": "언제", "nw": True}, {"key": "kind", "label": "종류", "nw": True}, {"key": "msg", "label": "내용"},
                             {"key": "hash", "label": "번호", "nw": True}],
                 "rows": [{"_tone": "warn" if s["kind"] == "되돌리기" else None, "at": s["at"][:16].replace("T", " "), "kind": s["kind"] or None,
                           "msg": s["msg"], "hash": mono(s["hash"])} for s in saves]})
    secs.append({"kind": "list", "id": "dirty", "title": "저장하지 않은 변경", "count": len(dirty), "items": [{"text": mono(x)} for x in dirty[:80]],
                 "empty": "모두 저장했습니다"})
    if model is not None or model_err:
        secs.append({"kind": "list", "id": "data-check", "title": "데이터 설계 검사", "count": len(derrs) + len(dwarns) + (1 if model_err else 0),
                     "items": ([{"text": model_err, "badge": "고칠 것", "tone": "bad"}] if model_err else []) +
                     [{"text": e, "badge": "고칠 것", "tone": "bad"} for e in derrs] + [{"text": w, "badge": "참고"} for w in dwarns],
                     "empty": "고칠 것이 없습니다"})
    if notes["LEARNED"]:
        secs.append({"kind": "list", "id": "learned", "title": "배운 것", "items": _bullets(_nocomment(notes["LEARNED"])), "empty": "없음"})
    pages["progress"] = page("progress", secs, subtitle="작업 · 기록 · 결정 · 저장")
    for x in flogs[:MAX_LOG_PAGES]:
        ss = [{"kind": "kv", "id": "about", "items": [["기능", x["feature"]], ["날짜", x["date"]], ["파일", mono(x["file"])]]}]
        if x["items"]:
            ss.append({"kind": "list", "id": "items", "title": "목록", "count": len(x["items"]), "items": x["items"]})
        body = x["detail"] if x["items"] or x["detail"] else x["text"]
        if body:
            ss.append({"kind": "code", "id": "detail", "title": "자세히" if x["detail"] else "기록", "wrap": True,
                       "text": body if len(body) <= 60000 else body[:60000] + "\n\n… (잘림 -- 파일을 열어 봅니다)"})
        subs.append(("progress", log_slug[(x["feature"], x["date"])],
                     page("progress", ss, sub=log_slug[(x["feature"], x["date"])], title=f"{x['feature']} · {x['date']}", subtitle="기능별 기록",
                          sources=[{"path": x["file"], "fingerprint": _sha12(x["text"].encode("utf-8")), "label": "기능별 기록", "missing": False}],
                          read="이 기능 · 날짜의 기록 -- 목록(한 줄씩)과 자세히(고친 파일 · 함수, 확인 결과 · 오류 · 해결).",
                          crumb=[{"t": "진행 상황", "href": "progress/#logs"}])))

    # 10 파일 ------------------------------------------------------------------
    tracked = set(_project_files(root))
    have = tracked | {Path(f).name for f in tracked}

    def frow(f):
        ok = f.endswith("/") or "*" in f or (root / f).exists() or f in have or any(t.endswith("/" + f) for t in tracked)
        return mono(f) if ok else {"_": mark, "t": f, "mono": True, "tone": "bad", "title": "없는 파일"}
    rows = []
    for i, f in enumerate(feats):
        miss = [x for x in f["files"] if x in smap["missing"]]
        rows.append({"_id": f"m-{i + 1}", "_tone": "bad" if miss else None, "name": txt(f["name"], href=f"business/#f-{i + 1}"),
                     "state": badge(f["state"] or "모름", _tone(f["state"])), "files": [frow(x) for x in f["files"]] or None,
                     "tables": [chip(t["label"] or t["name"], "data/#t-" + t["name"] if model else None) for t in ftables.get(f["name"]) or []] or None,
                     "manual": [mono(x) for x in f.get("manual") or []] or None})
    secs = [{"kind": "text", "id": "how", "tone": "note",
             "text": "이 사이트는 dev-notes 기록 · 기능 지도 · 데이터 설계(정본)에서 만듭니다. 보기만 하는 화면이라 여기서 고치지 않습니다 -- 기록을 고치고 "
                     "python .claude/skills/light-portal/portal_tool.py build 로 다시 만듭니다 (저장할 때마다 저절로). 파일로 열면 됩니다 -- 서버 · 포트가 없습니다."},
            {"kind": "table", "id": "map", "title": "기능 지도 (기능 → 쓰는 파일 → 표)", "count": len(feats), "filter": True, "filter_bad": "없는 파일이 있는 기능만",
             "empty": "기능 지도(FEATURES.md)에 기능이 아직 없습니다",
             "lead": "문제가 나면 코드 전체를 훑지 않고 여기서 고칠 곳부터 찾습니다: portal_tool.py where \"<오류 글 · 화면 · 파일 이름>\"",
             "columns": [{"key": "name", "label": "기능"}, {"key": "state", "label": "상태", "nw": True}, {"key": "files", "label": "쓰는 파일"},
                         {"key": "tables", "label": "쓰는 표"}, {"key": "manual", "label": "설명서"}], "rows": rows},
            {"kind": "list", "id": "shared", "title": "함께 쓰는 파일", "count": len(fm["shared"]), "lead": "여러 기능이 같이 쓰는 파일 -- 고치면 모든 기능을 점검합니다.",
             "items": [{"text": frow(x)} for x in fm["shared"]], "empty": "적힌 것이 없습니다"},
            {"kind": "table", "id": "parts", "title": "구성 -- 어디서 돌고 무엇을 쓰나", "count": len(fm["parts"]), "empty": "기능 지도의 '구성' 절이 비어 있습니다",
             "columns": [{"key": "part", "label": "부분", "nw": True}, {"key": "what", "label": "무엇으로"}, {"key": "where", "label": "어디서"}, {"key": "files", "label": "파일 · 설정"}],
             "rows": [{"part": p["part"], "what": p["what"] or None, "where": p["where"] or None, "files": [frow(x) for x in p["files"]] or None} for p in fm["parts"]]},
            {"kind": "table", "id": "tools", "title": "쓰는 도구와 버전", "count": len(smap["tools"]), "empty": "package.json · requirements.txt 같은 파일이 없습니다",
             "lead": "프로젝트의 파일에서 직접 읽습니다 (손으로 적지 않습니다).",
             "columns": [{"key": "name", "label": "도구"}, {"key": "version", "label": "버전", "nw": True}, {"key": "file", "label": "읽은 파일"}],
             "rows": [{"name": t["name"], "version": mono(t["version"]), "file": mono(t["file"])} for t in smap["tools"]]},
            {"kind": "list", "id": "missing", "title": "기능 지도에는 있는데 없는 파일", "count": len(smap["missing"]),
             "items": [{"text": x, "badge": "없음", "tone": "bad"} for x in smap["missing"]], "empty": "없습니다"},
            {"kind": "list", "id": "unlisted", "title": "기능 지도에 없는 파일", "count": len(smap["unlisted"]),
             "lead": "FEATURES.md 의 기능('쓰는 파일') · 함께 쓰는 파일 · 구성 중 맞는 곳에 넣습니다.",
             "items": [{"text": x, "badge": "넣기", "tone": "warn"} for x in smap["unlisted"]], "empty": "없습니다 -- 모든 파일이 지도에 있습니다"}]
    names = _rows(_nocomment(notes["NAMES"] or ""))
    secs.append({"kind": "table", "id": "names", "title": "이름표", "count": len(names), "empty": "이름표(NAMES.md)가 비어 있습니다",
                 "columns": [{"key": "a", "label": "화면에 보이는 말"}, {"key": "b", "label": "코드 이름"}, {"key": "c", "label": "메모"}],
                 "rows": [{"a": c[0] if c else None, "b": mono(c[1]) if len(c) > 1 and c[1] else None, "c": c[2] if len(c) > 2 and c[2] else None} for c in names]})
    rec = [{"what": NOTE_LABEL[n], "path": mono(f"dev-notes/{n}.md"), "lines": len(notes[n].splitlines()),
            "fp": mono(_sha12(notes[n].encode("utf-8")))} for n in NOTES if notes[n] is not None]
    rec += [{"what": f"기능별 기록 · {x['feature']}", "path": mono(x["file"]), "lines": len(x["text"].splitlines()), "fp": mono(_sha12(x["text"].encode("utf-8")))}
            for x in flogs[:40]]
    secs.append({"kind": "table", "id": "records", "title": "기록 파일", "count": len(rec), "lead": "편집기로 열어 봅니다. 줄을 지어내지 않습니다 -- 모르면 '기록 없음'.",
                 "columns": [{"key": "what", "label": "무엇"}, {"key": "path", "label": "파일"}, {"key": "lines", "label": "줄", "num": True},
                             {"key": "fp", "label": "지문", "nw": True}], "rows": rec})
    made = []
    if (root / "manual" / "index.html").is_file():
        made.append({"what": "사용설명서", "path": mono("manual/index.html"), "state": badge("있음", "ok")})
    for n, w in (("book.html", "데이터 설명서"), ("erd.md", "데이터 그림 (mermaid)"), ("spec.md", "데이터 정의서"), ("schema.sql", "SQL (표 만들기)")):
        if (root / "data" / "out" / n).is_file():
            made.append({"what": w, "path": mono(f"data/out/{n}"), "state": badge("있음", "ok")})
    if (root / MODEL).is_file():
        made.insert(0, {"what": "데이터 설계 (정본)", "path": mono(MODEL), "state": badge("읽지 못함", "bad") if model_err else badge("있음", "ok")})
    secs.append({"kind": "table", "id": "outputs", "title": "만든 파일", "count": len(made), "empty": "아직 없습니다 (사용설명서 · 데이터 설계)",
                 "lead": "브라우저로 여는 파일은 탐색기에서 두 번 누릅니다.",
                 "columns": [{"key": "what", "label": "무엇"}, {"key": "path", "label": "파일"}, {"key": "state", "label": "", "nw": True}], "rows": made})
    pages["files"] = page("files", secs, subtitle="기능 지도 · 구성 · 도구 · 기록 파일",
                          blanks=(["기능 지도의 '구성' 절"] if not fm["parts"] else []) + [f"기능 지도에 없는 파일: {x}" for x in smap["unlisted"][:20]])

    menu_subs = {"progress": [{"id": "logs", "label": "기능별 기록", "href": "progress/#logs", "n": len(flogs)},
                              {"id": "decisions", "label": "결정", "href": "progress/#decisions", "n": len(decs)}],
                 "files": [{"id": "map", "label": "기능 지도", "href": "files/#map", "n": len(feats)}]}
    index = [{"label": f["name"], "sub": f["state"], "kind": "기능", "href": f"business/#f-{i + 1}"} for i, f in enumerate(feats)]
    index += dl.site_index(model) if model else []
    index += [{"label": f"{x['feature']} {x['date']}", "kind": "기록", "href": "progress/" + log_slug[(x["feature"], x["date"])] + "/"}
              for x in flogs[:MAX_LOG_PAGES]]
    pages = {k: _scrub(v) for k, v in pages.items()}
    subs = [(p, s, _scrub(d)) for p, s, d in subs]
    return pages, subs, menu_subs, _scrub(index), project


def build_site(root: Path, out=None, hosting=None) -> dict:
    """개발 관리 사이트 (가벼운 판 5쪽) -- dev-notes/outputs/site/index.html 을 파일로 연다. 서버 · 포트 · 로그인 없음.
    화면 틀과 쓰기는 짝 스킬 data-light 의 것 (전문판 화면 틀의 MIT 사본), 2 · 4쪽은 data-light 의 생성기."""
    import secrets
    root = Path(root).resolve()
    dl = _datalight()
    dflt = root / SITE_OUT
    site = (Path(out) if Path(out).is_absolute() else root / out).resolve() if out else dflt
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    mark = secrets.token_hex(8)
    pages, subs, menu_subs, index, project = site_pages(root, dl, mark, now)
    try:
        r = dl.write_site(site, root, pages, framework="dev-light", framework_version=VERSION, project=project, mark=mark, now=now,
                          index=index, subs=subs, menu_subs=menu_subs, default_site=dflt, **({"hosting": hosting} if hosting else {}))
    except ValueError as e:
        raise SiteError(str(e)) from None
    r["uri"] = (site / "index.html").as_uri()
    return r


def publish(root: Path, push: bool = True) -> dict:
    """공개본 -- 정한 방식(dev-notes/outputs-publish.json)대로: <서비스 주소>/dev-process-light/ (사이트 폴더) 또는 GitHub Pages.
    5쪽은 dev-process-light/ 에 한 번, data-expert-framework-light/ 에는 안내 쪽만 (같은 쪽을 두 번 만들지 않는다). 쓰기는 짝 스킬 data-light 의 것."""
    root = Path(root).resolve()
    dl = _datalight()
    if not hasattr(dl, "publish"):
        raise SiteError("짝 스킬 data-light 가 오래됐습니다 (0.10.0 부터 공개) -- dev-process-light 를 다시 설치합니다")
    try:
        return dl.publish(root, "dev-light", lambda out: build_site(root, out, hosting="static"), push=push)
    except ValueError as e:
        raise SiteError(str(e)) from None


def _shortcut(root: Path, file: Path, site: Path) -> str | None:
    """예전 설정(기록 보기 페이지: dev-notes/portal.html)을 지킨다 -- 그 파일을 열면 사이트로 간다."""
    t = _html.escape(_rel(site / "index.html", file), quote=True)
    file.parent.mkdir(parents=True, exist_ok=True)
    with open(file, "w", encoding="utf-8", newline="\n") as fh:
        fh.write('<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=' + t + '">'
                 "<title>개발 관리 사이트로</title></head>\n<body><p>기록 보기 페이지는 이제 개발 관리 사이트입니다: <a href=\"" + t + "\">" + t
                 + "</a></p></body></html>\n")
    return _ensure_ignored(root, file)


def collect(root: Path, out: Path) -> dict:
    notes = {}
    for n in NOTES:
        p = root / "dev-notes" / f"{n}.md"
        notes[n] = p.read_text(encoding="utf-8") if p.is_file() else None
    logdir = root / "dev-notes" / "log"
    archive = sorted([*logdir.glob("_흐름/*.md"), *logdir.glob("*.md")], key=lambda p: p.stem, reverse=True) if logdir.is_dir() else []
    feature_logs = []
    if logdir.is_dir():
        for p in sorted(logdir.glob("*/*.md"), key=lambda p: (p.stem, p.parent.name), reverse=True)[:MAX_FEATURE_FILES]:
            if p.parent.name.startswith("_"):
                continue
            text = p.read_text(encoding="utf-8", errors="replace")
            feature_logs.append({"feature": p.parent.name, "date": p.stem,
                                 "text": text if len(text) <= 60000 else text[:60000] + "\n\n… (잘림 -- 파일을 열어 본다)"})
    saves, dirty = _saves_and_dirty(root)
    manual = root / "manual" / "index.html"
    manual_href = _rel(manual, out) if manual.is_file() else None
    data = data_summary(root, out)
    return {"project": _project_name(notes["NOW"], root), "folder": str(root), "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            "notes": notes, "archive": [{"name": p.stem, "text": p.read_text(encoding="utf-8")} for p in archive[:24]],
            "feature_logs": feature_logs,
            "saves": saves, "dirty": dirty, "remote": bool(_git(root, "remote")), "manual": manual_href,
            "data": data, "map": system_map(root, notes, data)}


def _ensure_ignored(root: Path, out: Path) -> str | None:
    try:
        rel = out.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return None
    gi = root / ".gitignore"
    have = gi.read_text(encoding="utf-8").splitlines() if gi.is_file() else []
    if rel in have or "/" + rel in have:
        return None
    gi.write_text("\n".join([*have, "# 기록 보기 페이지 (dev-notes 에서 다시 만든다)", rel]) + "\n", encoding="utf-8")
    return rel


def build_page(root: Path, out: Path) -> dict:
    """예전 기록 보기 페이지 (HTML 파일 하나 -- 기록 원문 전체). build --legacy."""
    root, out = root.resolve(), (out if out.is_absolute() else root / out).resolve()
    data = collect(root, out)
    html = (HERE / "templates" / "portal.html").read_text(encoding="utf-8")
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    title = (data["project"] + " -- 기록").replace("&", "&amp;").replace("<", "&lt;")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html.replace("__TITLE__", title).replace("__DATA__", blob), encoding="utf-8")
    return {"out": str(out), "uri": out.as_uri(), "ignored": _ensure_ignored(root, out), "saves": len(data["saves"])}


def build(root: Path, out=None) -> dict:
    """개발 관리 사이트를 만든다. out: 폴더면 그곳, '.html' 파일이면(예전 설정 dev-notes/portal.html) 사이트는 정한 자리에 두고 그 파일은 사이트로 가는 바로가기."""
    root = Path(root).resolve()
    shortcut = None
    if out is not None and str(out).lower().endswith((".html", ".htm")):
        shortcut, out = (Path(out) if Path(out).is_absolute() else root / out).resolve(), None
    r = build_site(root, out)
    r["shortcut"] = str(shortcut) if shortcut else None
    r["ignored"] = _shortcut(root, shortcut, Path(r["site"])) if shortcut else None
    return r


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="기록 보기 페이지 만들기")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="개발 관리 사이트 (가벼운 판 5쪽) -- dev-notes/outputs/site/index.html 을 파일로 연다")
    b.add_argument("--root", default=".")
    b.add_argument("--out", help="사이트 폴더 (기본 dev-notes/outputs/site). 예전 설정처럼 .html 파일이면 그 파일은 사이트로 가는 바로가기")
    b.add_argument("--legacy", action="store_true", help="예전 기록 보기 페이지 (HTML 파일 하나, 기본 dev-notes/portal.html)")
    q = sub.add_parser("publish", help="공개본 -- <서비스 주소>/dev-process-light/ (만드는 사이트 아래) 또는 GitHub Pages. 방식은 사용자 답으로 (--set)")
    q.add_argument("--root", default=".")
    q.add_argument("--set", default=None, choices=["service", "pages", "none"])
    q.add_argument("--web-dir", default=None, help="service: 사이트가 주소 뿌리(/)로 그대로 올리는 폴더 (프로젝트 기준, 예 . · public · docs)")
    q.add_argument("--remote", default="origin")
    q.add_argument("--by", default=None, choices=["user"])
    q.add_argument("--quote", default=None)
    q.add_argument("--status", action="store_true")
    q.add_argument("--dry-run", action="store_true")
    w = sub.add_parser("where", help="고칠 곳 찾기 -- 오류 글·파일·화면·표 이름 → 기능 · 파일 · 표")
    w.add_argument("query", nargs="+")
    w.add_argument("--root", default=".")
    w.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "publish":
        root = Path(a.root).resolve()
        try:
            dl = _datalight()
            if not hasattr(dl, "set_publish"):
                raise SiteError("짝 스킬 data-light 가 오래됐습니다 (0.10.0 부터 공개) -- dev-process-light 를 다시 설치합니다")
            if a.set:
                d = dl.set_publish(root, "dev-light", a.set, by=a.by, quote=a.quote, web_dir=a.web_dir, remote=a.remote)
                print(f"[OK] 공개 방식: {dl.PUBLISH_MODES[a.set]} -- 설정 dev-notes/outputs-publish.json (다음 저장에 넣습니다)")
                for x in d["warnings"]:
                    print(f"[주의] {x}")
                return 0
            if a.status:
                conf = dl.load_publish(root, "dev-light")
                print("공개: " + (dl.PUBLISH_MODES.get(conf.get("mode")) or "아직 정하지 않음 -- 사용자에게 묻습니다")
                      + (f" · 폴더 {conf['web_dir']}/dev-process-light/" if conf.get("mode") == "service" else ""))
                return 0
            r = publish(root, push=not a.dry_run)
        except (SiteError, ValueError, OSError) as e:
            print(f"[멈춤] 공개하지 않았습니다: {e}")
            return 1
        for line in dl.publish_lines(r, "dev-light", cmd="portal_tool.py publish"):
            print(line)
        return 0 if r.get("state") in ("written", "same", "pushed", "ready", "off") else (2 if r.get("state") == "unset" else 1)
    if a.cmd == "where":
        r = where(Path(a.root).resolve(), " ".join(a.query))
        if a.json:
            print(json.dumps(r, ensure_ascii=False, indent=1))
            return 0 if r["found"] else 1
        print(f"[찾기] {r['query']}")
        for h in r["found"]:
            extra = " · ".join(x for x in [h.get("state", ""), ("표 " + ", ".join(h["tables"])) if h.get("tables") else "",
                                           ("쓰는 기능 " + ", ".join(h["features"])) if h.get("features") else "",
                                           ("화면 " + ", ".join(h["screen"])) if h.get("screen") else "", h.get("what", ""), h.get("where", ""),
                                           h.get("note", "")] if x)
            print(f"- {h['kind']} {h['name']}" + (f" -- {extra}" if extra else ""))
        if r["found"]:
            print("먼저 볼 파일: " + (", ".join(r["read"]) if r["read"] else "(기능 지도에 파일이 없다 -- FEATURES.md 의 '쓰는 파일'을 채운다)"))
        if r["unlisted"]:
            print("기능 지도에 없는 파일: " + ", ".join(r["unlisted"]) + " -- FEATURES.md 의 기능·함께 쓰는 파일·구성에 넣는다")
        if r["note"]:
            print(r["note"])
        return 0 if r["found"] else 1
    if a.legacy:
        rep = build_page(Path(a.root), Path(a.out or DEFAULT_OUT))
        print(f"[OK] 기록 보기 페이지 (예전 모양): {rep['out']}")
        print(f"     브라우저로 열기: {rep['uri']}")
        if rep["ignored"]:
            print(f"[OK] .gitignore 에 {rep['ignored']} 추가 (저장하지 않는 파일)")
        return 0
    try:
        rep = build(Path(a.root), a.out)
    except SiteError as e:
        print(f"[멈춤] 개발 관리 사이트를 만들지 않았습니다: {e}")
        return 1
    print(f"[OK] 개발 관리 사이트: {rep['index']} (쪽 {rep['pages']} · 기능별 기록 {rep['subs']} · 빈칸 {rep['blanks']})")
    print(f"     브라우저로 열기: {rep['uri']}")
    if rep["shortcut"]:
        print(f"     예전 위치 {rep['shortcut']} 도 이 사이트로 갑니다")
    if rep["ignored"]:
        print(f"[OK] .gitignore 에 {rep['ignored']} 추가 (저장하지 않는 파일)")
    for e in rep["errors"]:
        print(f"[참고] {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
