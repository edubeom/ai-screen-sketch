#!/usr/bin/env python3
"""data-light -- easy data design for small systems (data-expert-framework-light).

One JSON file (data/model.light.json) describes your tables. From it this tool
checks the design, builds SQL / ERD / spec, tries it in SQLite, imports csv/xlsx,
and upgrades to the full data-expert-framework model.json.

Commands
  check   <model>                         check the design (exit 0 ok / 1 problems)
  split   <model> [--write]               move personal-info columns into pi_<table>
  build   <model> [--out DIR] [--db sqlite|postgresql]
                                          schema.sql, erd.md, spec.md, book.html (+ spec.xlsx if openpyxl)
  try     <model>                         run the schema + sample rows in SQLite and probe the rules
  import plan  <file> --table NAME [--label 한글] [--sheet S] [--out plan.json]
  import apply <plan.json> --model <model> --db data/app.db --approval "<사용자 답 그대로>"
  upgrade <model> [--out model.json] [--schema app] [--pi-schema pi] [--facts facts.json] [--blueprint blueprint.json]
                                          convert to the full framework's model.json (+ question ledger for product,
                                          + system blueprint for works)
  verify  <model> [--db app.db|--no-db] [--mutate]
                                          one pass/fail gate: check + goals + rules + out/ fresh + DB safety
  hook install [--repo .] [--no-ci] [--append]
                                          run `verify` on every commit that changes a model (+ CI workflow)
  hook status [--repo .]                  installed hook / tool version vs this one (exit 0 same, 1 differ)
  import schema <app.db> [--out data/model.light.json] [--force]
                                          draft a model from an existing SQLite DB (labels left empty)
  site    <model> [--out DIR]            development site (light: 5 pages) -- open data/outputs/site/index.html as a file
  publish [model] [--set service|pages|none --web-dir D --by user --quote Q] [--status]
                                         publish the site under the service (<service>/data-expert-framework-light/) or on GitHub Pages
  --version

Harness idea: decide "what counts as done" first (goals / not_doing in the model), turn it into
runnable checks (try / verify), and run them automatically at commit time (hook) and on push (CI).

Python standard library only (openpyxl is optional: xlsx import / spec.xlsx).
MIT License -- see LICENSE.
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import html
import io
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

FORMAT = "data-light/1"
__version__ = "0.10.1"
NAME = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
TYPES = ("id", "ref", "text", "long_text", "int", "number", "money", "bool", "date", "datetime", "owner")
ACCESS = ("members", "own", "read")
WIDE = {"read": 3, "members": 2, "own": 1}          # who may see: read (anyone) > members (signed in) > own (my rows)


def access_list(t: dict) -> list:
    a = t.get("access")
    return [] if a is None else ([a] if isinstance(a, str) else list(a))
RESERVED = {
    "all", "and", "any", "as", "asc", "between", "by", "case", "check", "column", "constraint", "create", "cross",
    "current_date", "current_time", "current_timestamp", "default", "delete", "desc", "distinct", "drop", "else", "end",
    "except", "exists", "false", "for", "foreign", "from", "full", "grant", "group", "having", "in", "index", "inner",
    "insert", "intersect", "into", "is", "join", "key", "left", "like", "limit", "natural", "not", "null", "offset", "on",
    "or", "order", "outer", "primary", "references", "right", "select", "set", "table", "then", "to", "true", "union",
    "unique", "update", "user", "using", "values", "view", "when", "where", "with",
}
ON_DELETE = {"keep": "RESTRICT", "delete": "CASCADE", "clear": "SET NULL"}
# what this data work hands over (subset of the full framework's data.product_type) -- asked, never guessed
PRODUCT_KINDS = {"design": ("설계까지", "modeling_files"), "load": ("파일·엑셀 넣기", "ingest_pipeline"),
                 "manage": ("데이터 관리 (찾고·고치기)", "data_management"), "analyze": ("알고 싶은 것 보기 (분석)", "analytics_bi")}
UNDETERMINED = "유형 미정"
OPS_KO = {"C": "만들기", "R": "읽기", "U": "고치기", "D": "지우기"}
WORKS_MAX = 7                                       # 하는 일은 3~7개 -- 더 많으면 묶는다
PERSONAL_KINDS = ("name", "phone", "email", "address", "birth", "id_number", "account", "health", "photo", "location", "other")


# ----------------------------------------------------------------- io helpers
def _utf8_stdio() -> None:
    """always print UTF-8 -- a Windows pipe defaults to cp1252/cp949 and Korean turns into ????"""
    for st in (sys.stdout, sys.stderr):
        try:
            st.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _write(path, text: str) -> None:
    """UTF-8 with \\n line ends on every OS (Path.write_text(newline=) needs Python 3.10)"""
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def load(path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(model: dict, path) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(model, f, ensure_ascii=False, indent=2)
        f.write("\n")


def tables(model: dict) -> dict:
    return {t["name"]: t for t in model.get("tables", [])}


def key_columns(t: dict) -> list[dict]:
    """primary key: the id column, or ref columns marked key (1:1 child / join table)"""
    ids = [c for c in t["columns"] if c.get("type") == "id"]
    return ids or [c for c in t["columns"] if c.get("type") == "ref" and c.get("key")]


def id_column(model: dict, table: str) -> str | None:
    t = tables(model).get(table)
    if not t:
        return None
    k = key_columns(t)
    return k[0]["name"] if len(k) == 1 else None


def ordered(model: dict) -> list[dict]:
    """tables so that every referenced table comes first"""
    tb = tables(model)
    done, out = set(), []

    def visit(n, stack=()):
        if n in done or n not in tb:
            return
        if n in stack:
            return  # cycle -- check() reports it
        for c in tb[n]["columns"]:
            if c.get("type") == "ref" and c.get("ref") != n:
                visit(c.get("ref"), stack + (n,))
        done.add(n)
        out.append(tb[n])

    for t in model.get("tables", []):
        visit(t["name"])
    return out


def all_columns(t: dict) -> list[dict]:
    cols = list(t["columns"])
    if t.get("timestamps", True):
        names = {c["name"] for c in cols}
        for n, lab in (("created_at", "만든 시각"), ("updated_at", "고친 시각")):
            if n not in names:
                cols.append({"name": n, "label": lab, "type": "datetime", "required": True, "auto": True})
    return cols


# ----------------------------------------------------------------- check
def check(model: dict) -> tuple[list[str], list[str]]:
    """returns (errors, warnings) -- messages are for beginners: what is wrong + how to fix"""
    err, warn = [], []
    if model.get("format", FORMAT) != FORMAT:
        warn.append(f"format 이 '{model.get('format')}' 입니다 -- 이 도구는 '{FORMAT}' 기준으로 검사합니다")
    if model.get("db", "sqlite") not in ("sqlite", "postgresql"):
        err.append("db 는 sqlite 또는 postgresql (Supabase 는 postgresql) 이어야 합니다")
    tb = model.get("tables") or []
    if not tb:
        err.append("tables 가 비어 있습니다 -- 저장할 대상(예: 회원·주문)을 하나 이상 적어 주세요")
    seen = set()
    names = {t.get("name") for t in tb}
    for t in tb:
        tn = t.get("name", "")
        where = f"테이블 {tn or '(이름 없음)'}"
        if not NAME.match(tn or ""):
            err.append(f"{where}: 이름은 영문 소문자·숫자·밑줄(_)만, 글자로 시작 (예: order_item)")
        elif tn in RESERVED:
            err.append(f"{where}: '{tn}' 은 SQL 예약어라 쓸 수 없습니다 -- 예: {tn}s, {tn}_info")
        if tn in seen:
            err.append(f"{where}: 같은 이름의 테이블이 둘 있습니다")
        seen.add(tn)
        if not t.get("label"):
            warn.append(f"{where}: 한글 이름표(label)가 없습니다 -- 정의서·ERD 에 보일 이름을 적어 주세요")
        cols = t.get("columns") or []
        if not cols:
            err.append(f"{where}: 칸(columns)이 없습니다")
            continue
        cn_seen = set()
        ids = [c for c in cols if c.get("type") == "id"]
        keyrefs = [c for c in cols if c.get("type") == "ref" and c.get("key")]
        if len(ids) > 1:
            err.append(f"{where}: id 칸은 하나만 둘 수 있습니다")
        if not ids and not keyrefs:
            err.append(f"{where}: 행을 구별할 칸이 없습니다 -- 첫 칸에 {{\"name\": \"{tn}_id\", \"type\": \"id\"}} 를 넣으세요")
        if ids and keyrefs:
            err.append(f"{where}: id 칸이 있으면 key 표시한 ref 칸을 함께 쓸 수 없습니다")
        if ids and ids[0]["name"] != f"{tn}_id":
            warn.append(f"{where}: id 칸 이름은 '{tn}_id' 로 하면 다른 테이블에서 찾기 쉽습니다 (지금 '{ids[0]['name']}')")
        for c in cols:
            cn = c.get("name", "")
            cw = f"{tn}.{cn or '?'}"
            if not NAME.match(cn or ""):
                err.append(f"{cw}: 칸 이름은 영문 소문자·숫자·밑줄(_)만, 글자로 시작")
            elif cn in RESERVED:
                err.append(f"{cw}: '{cn}' 은 SQL 예약어 -- 예: {cn}_value, {tn}_{cn}")
            if cn in ("created_at", "updated_at") and t.get("timestamps", True):
                warn.append(f"{cw}: created_at/updated_at 은 자동으로 붙습니다 -- 지워도 됩니다")
            if cn in cn_seen:
                err.append(f"{cw}: 같은 이름의 칸이 둘 있습니다")
            cn_seen.add(cn)
            ty = c.get("type")
            if ty not in TYPES:
                err.append(f"{cw}: type '{ty}' 은 쓸 수 없습니다 -- {', '.join(TYPES)} 중 하나")
                continue
            if not c.get("label") and ty != "id":
                warn.append(f"{cw}: 한글 이름표(label)가 없습니다")
            if ty == "ref":
                r = c.get("ref")
                if r not in names:
                    err.append(f"{cw}: ref '{r}' 테이블이 없습니다")
                elif r and id_column(model, r) is None:
                    err.append(f"{cw}: '{r}' 은 칸 하나로 된 키가 없어 가리킬 수 없습니다")
                if not cn.endswith("_id"):
                    warn.append(f"{cw}: 다른 테이블을 가리키는 칸은 이름 끝을 _id 로 (예: {r}_id)")
                od = c.get("on_delete", "keep")
                if od not in ON_DELETE:
                    err.append(f"{cw}: on_delete 는 keep(지우지 못하게)·delete(같이 지움)·clear(비움) 중 하나")
                if od == "clear" and (c.get("required") or c.get("key")):
                    err.append(f"{cw}: 꼭 있어야 하는 칸(required/key)은 on_delete 'clear' 를 쓸 수 없습니다")
            elif c.get("ref"):
                err.append(f"{cw}: ref 는 type 이 'ref' 인 칸에만 씁니다")
            if ty == "owner":
                if tn.startswith("pi_"):
                    err.append(f"{cw}: 개인정보 표에는 owner 칸을 두지 않습니다 -- 짝 테이블 {tn[3:]} 에 둡니다")
                if c.get("unique") or c.get("choices") or "default" in c:
                    err.append(f"{cw}: owner 칸은 로그인한 사람이 자동으로 들어갑니다 -- unique·choices·default 를 쓰지 않습니다")
            if c.get("key") and ty != "ref":
                err.append(f"{cw}: key 표시는 ref 칸에만 (1:1 짝 테이블·연결 테이블)")
            ch = c.get("choices")
            if ch is not None:
                if not isinstance(ch, list) or not ch or not all(isinstance(x, (str, int)) for x in ch):
                    err.append(f"{cw}: choices 는 값 목록이어야 합니다 (예: [\"일반\", \"VIP\"])")
                elif ty not in ("text", "int"):
                    err.append(f"{cw}: choices 는 text·int 칸에만")
            p = c.get("personal")
            if p:
                if p is not True and p not in PERSONAL_KINDS:
                    err.append(f"{cw}: personal 은 true 또는 {', '.join(PERSONAL_KINDS)} 중 하나")
                if not tn.startswith("pi_"):
                    err.append(f"{cw}: 개인정보 칸은 따로 둡니다 -- `datalight.py split <model> --write` 로 pi_{tn} 에 옮기세요")
        owners = [c for c in cols if c.get("type") == "owner"]
        if len(owners) > 1:
            err.append(f"{where}: owner 칸은 표마다 하나만")
        acc = t.get("access")
        if acc is not None:
            al = access_list(t) if isinstance(acc, (str, list)) else [None]
            base_t = next((x for x in tb if x.get("name") == tn[3:]), None) if tn.startswith("pi_") else t
            if not al or len(al) > 2 or len(set(al)) != len(al) or any(a not in ACCESS for a in al):
                err.append(f"{where}: access 는 {', '.join(ACCESS)} 중 하나, 또는 읽기·쓰기 두 개의 목록 (예: [\"read\", \"own\"] "
                           "= 누구나 읽고 쓰기는 자기 것만)")
            elif model.get("db", "sqlite") != "postgresql":
                warn.append(f"{where}: access 는 PostgreSQL(Supabase) 에서만 쓰입니다 -- 지금 db 는 {model.get('db', 'sqlite')}")
            else:
                if "members" in al and model.get("signup") != "closed":
                    err.append(f"{where}: access members(로그인한 사람 모두)는 새 가입을 끈 사이트에서만 안전합니다 -- "
                               "Supabase 에서 새 가입을 끄고 정본에 \"signup\": \"closed\" 를 적거나, own 을 쓰세요")
                if "read" in al and tn.startswith("pi_"):
                    err.append(f"{where}: 개인정보 표는 누구나 읽기(read)로 열 수 없습니다")
                if "own" in al and (not base_t or not any(c.get("type") == "owner" for c in base_t.get("columns", []))):
                    err.append(f"{where}: access own 은 " + ("짝 테이블에" if tn.startswith("pi_") else "이 표에")
                               + " owner 칸이 있어야 합니다 (예: {\"name\": \"owner_id\", \"label\": \"만든 사람\", \"type\": \"owner\"})")
        elif owners and model.get("db", "sqlite") == "postgresql":
            warn.append(f"{where}: owner 칸이 있는데 access 가 없습니다 -- 자기 행만 보게 하려면 \"access\": \"own\"")
        if tn.startswith("pi_") and model.get("db", "sqlite") == "postgresql" and t.get("access") is None:
            bt = next((x for x in tb if x.get("name") == tn[3:]), None)
            if bt and bt.get("access") is not None:
                warn.append(f"{where}: 짝 테이블 {tn[3:]} 에는 access 가 있는데 이 개인정보 표에는 없습니다 -- "
                            "Supabase 에서 아무도 읽을 수 없습니다 (own 또는 members 를 적거나, 일부러 막은 것이면 그대로)")
        if tn.startswith("pi_"):
            base = tn[3:]
            if base not in names:
                warn.append(f"{where}: pi_ 테이블은 짝 테이블 '{base}' 와 1:1 로 둡니다")
            if not any(c.get("type") == "ref" and c.get("key") and c.get("ref") == base for c in cols):
                err.append(f"{where}: 짝 테이블 '{base}' 를 가리키는 key ref 칸이 필요합니다 (split 이 만들어 줍니다)")
        combos = t.get("unique") or []
        if not isinstance(combos, list) or not all(isinstance(u, list) for u in combos):
            err.append(f"{where}: 표의 unique 는 칸 묶음 목록입니다 (예: [[\"member_id\", \"dues_month\"]])")
        else:
            for u in combos:
                if len(u) < 2:
                    err.append(f"{where}: unique 묶음 {u} -- 칸 하나면 그 칸에 \"unique\": true 를 씁니다")
                miss = [x for x in u if x not in cn_seen]
                if miss:
                    err.append(f"{where}: unique 묶음에 없는 칸 {miss}")
                if len(set(u)) != len(u):
                    err.append(f"{where}: unique 묶음 {u} 에 같은 칸이 두 번")
        for i, row in enumerate(t.get("sample") or [], 1):
            bad = [k for k in row if k not in cn_seen]
            if bad:
                err.append(f"{where}: 샘플 {i}번째 행에 없는 칸 {bad}")
    # what we hand over (product): asked in the user's words, never guessed
    err += product_errors(model)
    if model.get("product") is None:
        warn.append(f"만드는 것(product)을 정하지 않았습니다 ({UNDETERMINED}) -- 사용자에게 '설계까지 / 파일 넣기 / 데이터 관리 / 분석' 중 "
                    "무엇을 원하는지 묻고 그 말을 said 에 그대로 적으세요. 정하기 전에는 verify 가 통과하지 않습니다")
    # success criteria (harness layer 1): goals = questions the data must answer, not_doing = scope fence
    goals = model.get("goals")
    if goals is None:
        warn.append("성공 기준(goals)이 없습니다 -- '이 데이터로 무엇을 알 수 있어야 하나요?' 를 1~3개, 확인 SQL 과 함께 적어 두세요")
    elif not isinstance(goals, list):
        err.append("goals 는 목록이어야 합니다")
    else:
        for i, g in enumerate(goals, 1):
            gw = f"성공 기준 {i}"
            if not isinstance(g, dict) or not g.get("say") or not g.get("sql"):
                err.append(f"{gw}: say(한 문장)와 sql(확인 쿼리)이 필요합니다")
                continue
            q = g["sql"].strip().rstrip(";").strip()
            if ";" in q or not re.match(r"(?is)^(select|with)\b", q) or \
                    re.search(r"(?i)\b(insert|update|delete|drop|alter|create|attach|pragma)\b", q):
                err.append(f"{gw}: sql 은 조회(SELECT) 한 문장만 -- 데이터를 바꾸는 문장은 쓸 수 없습니다")
            ex = g.get("expect", "rows")
            if not (ex == "rows" or (isinstance(ex, int) and not isinstance(ex, bool) and ex >= 0) or isinstance(ex, list)):
                err.append(f"{gw}: expect 는 생략(1행 이상) · 행 수(숫자) · 기대 결과([[...]]) 중 하나")
    if goals and not any(t.get("sample") for t in tb):
        warn.append("성공 기준을 확인하려면 샘플 행(sample)이 필요합니다 -- 확인 쿼리가 볼 데이터를 몇 행 적어 두세요")
    nd = model.get("not_doing") or []
    if not isinstance(nd, list):
        err.append("not_doing 은 목록이어야 합니다 (예: [\"결제\", \"배송 추적\"])")
    else:
        for t in tb:
            for word in nd:
                w = str(word).strip()
                if w and (w == t.get("label") or w.lower() == str(t.get("name", "")).lower()):
                    err.append(f"테이블 {t.get('name')}: '{w}' 는 이번에 만들지 않기로 한 것(not_doing)입니다 -- 범위를 바꾸려면 사용자와 먼저 정하세요")
    if model.get("signup") not in (None, "open", "closed"):
        err.append("signup 은 open(누구나 가입) 또는 closed(새 가입을 끔)")
    outside = model.get("outside") or []
    if not isinstance(outside, list):
        err.append("outside 는 표 이름 목록입니다 (예: [\"log\"])")
    else:
        for o in outside:
            if o in names:
                err.append(f"outside 의 '{o}' 는 정본에도 있습니다 -- 둘 중 하나만")
    works = model.get("works")
    if works is not None:
        if not isinstance(works, list):
            err.append("works(하는 일)는 목록이어야 합니다 (예: [{\"name\": \"주문 받기\", \"who\": \"사장님\", \"uses\": {\"orders\": \"C\"}}])")
        else:
            used = set()
            for i, w in enumerate(works, 1):
                ww = f"하는 일 {i}"
                if not isinstance(w, dict) or not str(w.get("name") or "").strip():
                    err.append(f"{ww}: name(무슨 일인지 한 줄)이 필요합니다")
                    continue
                ww = f"하는 일 '{w['name']}'"
                uses = w.get("uses") or {}
                if not isinstance(uses, dict):
                    err.append(f"{ww}: uses 는 {{표 이름: \"CRUD 중 글자\"}} 입니다 (예: {{\"orders\": \"CR\"}})")
                    continue
                for tname, ops in uses.items():
                    if tname not in names:
                        err.append(f"{ww}: 없는 표 '{tname}' 를 씁니다")
                    elif not isinstance(ops, str) or not ops or set(ops.upper()) - set(OPS_KO):
                        err.append(f"{ww}: '{tname}' 에 하는 일은 C(만들기)·R(읽기)·U(고치기)·D(지우기) 글자로 (예: \"CR\")")
                    else:
                        used.add(tname)
                if not uses:
                    warn.append(f"{ww}: 어느 표를 쓰는지(uses)가 없습니다 -- 이 일이 만들고·읽고·고치고·지우는 표를 적어 주세요")
            if len(works) > WORKS_MAX:
                warn.append(f"하는 일이 {len(works)}개입니다 -- 7개 이하로 묶으면 사용자가 보기 쉽습니다")
            if works:
                for t in tb:
                    tn = t.get("name")
                    base = tn[3:] if isinstance(tn, str) and tn.startswith("pi_") else tn
                    if tn not in used and base not in used:
                        warn.append(f"테이블 {tn}: 이 표를 쓰는 일이 없습니다 -- 하는 일(works)의 uses 에 적거나, 필요 없는 표인지 사용자와 봅니다")
    # cycles in required refs
    tbm = tables(model)

    def reach(a, b, seen=()):
        for c in tbm.get(a, {}).get("columns", []):
            if c.get("type") == "ref" and c.get("required", c.get("key")) and c.get("ref") in tbm:
                if c["ref"] == b or (c["ref"] not in seen and reach(c["ref"], b, seen + (a,))):
                    return True
        return False

    for t in tb:
        if t.get("name") in tbm and reach(t["name"], t["name"]):
            err.append(f"테이블 {t['name']}: 꼭 있어야 하는 참조가 돌고 돕니다(순환) -- 한 칸을 required 에서 빼 주세요")
    return err, warn


def product_errors(model: dict) -> list[str]:
    """product = {"kinds": [design|load|manage|analyze ...], "main": <one of kinds, if more than one>, "said": "<user's words>"}"""
    p = model.get("product")
    if p is None:
        return []
    if not isinstance(p, dict):
        return ["product 는 {\"kinds\": [...], \"main\": ..., \"said\": \"사용자 말 그대로\"} 모양입니다"]
    err = []
    kinds = p.get("kinds")
    if not isinstance(kinds, list) or not kinds or not all(isinstance(k, str) for k in kinds) \
            or any(k not in PRODUCT_KINDS for k in kinds) or len(set(kinds)) != len(kinds):
        err.append(f"product.kinds 는 {list(PRODUCT_KINDS)} 중에서 하나 이상 (겹치지 않게)")
        kinds = []
    main = p.get("main")
    if main is not None and not isinstance(main, str):
        err.append("product.main 은 kinds 중 하나(글자)입니다")
    elif len(kinds) > 1 and main not in kinds:
        err.append("product.main -- 여러 개면 그중 주 목적 하나를 적습니다 (사용자에게 묻습니다)")
    elif main is not None and kinds and main not in kinds:
        err.append("product.main 은 kinds 중 하나입니다")
    for key in ("said", "main_said"):
        v = p.get(key)
        if (key == "said" or v is not None) and not (isinstance(v, str) and v.strip()):
            err.append(f"product.{key} -- 사용자가 한 말을 그대로 적습니다 (글자, Claude 가 짐작한 것은 적지 않습니다)")
    return err


def product_main(model: dict) -> str | None:
    p = model.get("product") or {}
    kinds = p.get("kinds") or []
    return p.get("main") or (kinds[0] if len(kinds) == 1 else None)


# ----------------------------------------------------------------- split
def split(model: dict) -> list[str]:
    """move personal columns of each table into pi_<table> (1:1, deleted together)"""
    done = []
    tb = tables(model)
    for t in list(model["tables"]):
        if t["name"].startswith("pi_"):
            continue
        pcols = [c for c in t["columns"] if c.get("personal")]
        if not pcols:
            continue
        idc = id_column(model, t["name"])
        if not idc:
            raise SystemExit(f"{t['name']}: 키 칸이 없어 개인정보를 나눌 수 없습니다 -- 먼저 check 오류를 고치세요")
        pn = "pi_" + t["name"]
        pt = tb.get(pn)
        if not pt:
            pt = {"name": pn, "label": (t.get("label") or t["name"]) + " 개인정보",
                  "about": f"{t.get('label') or t['name']}의 개인정보. 본 테이블과 1:1, 본 행을 지우면 같이 지워진다",
                  "columns": [{"name": idc, "label": next((c.get("label") for c in t["columns"] if c["name"] == idc), idc),
                               "type": "ref", "ref": t["name"], "key": True, "on_delete": "delete"}]}
            model["tables"].insert(model["tables"].index(t) + 1, pt)
            tb[pn] = pt
        if pt.get("access") is None and t.get("access") is not None:
            # personal data follows its table, but never opens wider than "own"/"members": read becomes own (if owner) or nothing
            acc = [a for a in access_list(t) if a != "read"]
            if not acc and "read" in access_list(t) and any(c.get("type") == "owner" for c in t["columns"]):
                acc = ["own"]
            if acc:
                pt["access"] = min(acc, key=lambda a: WIDE[a])
        for c in pcols:
            t["columns"].remove(c)
            pt["columns"].append(c)
        # samples follow their columns
        if t.get("sample"):
            moved = [c["name"] for c in pcols]
            prow = []
            for i, row in enumerate(t["sample"], 1):
                pr = {k: row.pop(k) for k in moved if k in row}
                if pr:
                    pr[idc] = row.get(idc, i)
                    prow.append(pr)
            if prow:
                pt.setdefault("sample", []).extend(prow)
        done.append(f"{t['name']} → {pn}: {', '.join(c['name'] for c in pcols)}")
    return done


# ----------------------------------------------------------------- build
def _q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def sql_type(c: dict, db: str) -> str:
    ty = c["type"]
    if db == "postgresql":
        return {"id": "bigint", "ref": "bigint", "text": "text", "long_text": "text", "int": "integer",
                "number": "numeric", "money": "numeric(15,2)", "bool": "boolean", "date": "date",
                "datetime": "timestamptz", "owner": "uuid"}[ty]
    return {"id": "INTEGER", "ref": "INTEGER", "text": "TEXT", "long_text": "TEXT", "int": "INTEGER", "number": "REAL",
            "money": "NUMERIC", "bool": "INTEGER", "date": "TEXT", "datetime": "TEXT", "owner": "TEXT"}[ty]


def ddl(model: dict, db: str | None = None, only: set | None = None) -> str:
    db = db or model.get("db", "sqlite")
    pg = db == "postgresql"
    out = [f"-- {model.get('project', '')} -- {db} schema (data-light)",
           "-- 이 파일은 model.light.json 에서 만들어졌습니다. 직접 고치지 말고 정본을 고친 뒤 다시 build 하세요."]
    if not pg:
        out.append("PRAGMA foreign_keys = ON;  -- SQLite 는 이 줄이 있어야 참조 규칙이 동작합니다")
    else:
        if any(c.get("type") == "owner" for t in model.get("tables", []) for c in t["columns"]):
            out.append("-- owner 칸이 auth.uid()(로그인한 사람)를 쓰므로 Supabase 용입니다.")
        out.append("BEGIN;")
    for t in ordered(model):
        tn = t["name"]
        if only is not None and tn not in only:
            continue
        lines = []
        keys = key_columns(t)
        for c in all_columns(t):
            ty = c["type"]
            s = f"  {c['name']} {sql_type(c, db)}"
            if ty == "id":
                s += " GENERATED ALWAYS AS IDENTITY PRIMARY KEY" if pg else " PRIMARY KEY AUTOINCREMENT"
            elif ty == "owner":
                # Supabase: the signed-in user. SQLite has no sign-in, so it stays a plain optional text there
                s += " NOT NULL DEFAULT auth.uid()" if pg else ""
            else:
                if c.get("required") or c.get("key"):
                    s += " NOT NULL"
                if c.get("auto"):
                    s += " DEFAULT " + ("now()" if pg else "CURRENT_TIMESTAMP")
                elif "default" in c:
                    s += " DEFAULT " + (_q(c["default"]) if not (ty == "bool" and not pg) else str(int(bool(c["default"]))))
                if c.get("unique"):
                    s += " UNIQUE"
                if ty == "ref":
                    rid = id_column(model, c["ref"])
                    s += f" REFERENCES {c['ref']} ({rid}) ON DELETE {ON_DELETE[c.get('on_delete', 'keep')]}"
                if c.get("choices"):
                    s += f" CHECK ({c['name']} IN ({', '.join(_q(x) for x in c['choices'])}))"
                elif ty == "bool" and not pg:
                    s += f" CHECK ({c['name']} IN (0, 1))"
                elif ty == "money":
                    s += f" CHECK ({c['name']} >= 0)"
            lines.append(s)
        if keys and keys[0]["type"] == "ref":
            lines.append(f"  PRIMARY KEY ({', '.join(k['name'] for k in keys)})")
        for u in t.get("unique") or []:
            lines.append(f"  UNIQUE ({', '.join(u)})")
        head = f"-- {t.get('label', tn)}" + (f": {t['about']}" if t.get("about") else "")
        out.append(f"\n{head}\nCREATE TABLE {tn} (\n" + ",\n".join(lines) + "\n);")
        for c in t["columns"]:
            if c["type"] == "ref" and not (c.get("key") and len(keys) == 1):
                out.append(f"CREATE INDEX ix_{tn}_{c['name']} ON {tn} ({c['name']});")
    if pg:
        out.append("")
        for t in ordered(model):
            out.append(f"COMMENT ON TABLE {t['name']} IS {_q(t.get('label', t['name']) + (' -- ' + t['about'] if t.get('about') else ''))};")
            for c in all_columns(t):
                lab = (c.get("label") or c["name"]) + (" [개인정보]" if c.get("personal") else "")
                out.append(f"COMMENT ON COLUMN {t['name']}.{c['name']} IS {_q(lab)};")
        out += rls_sql(model, only)
        out.append("COMMIT;")
    return "\n".join(out) + "\n"


def _who(model: dict, t: dict, kind: str) -> tuple[str, str]:
    """(roles, condition) for one access kind"""
    if kind == "read":
        return "anon, authenticated", "true"
    if kind == "members":
        return "authenticated", "true"
    tn = t["name"]
    own = next((c["name"] for c in t["columns"] if c["type"] == "owner"), None)
    if own:
        return "authenticated", f"{own} = auth.uid()"
    base = tables(model)[tn[3:]]                # pi_ table: owner lives on the paired table
    bo = next(c["name"] for c in base["columns"] if c["type"] == "owner")
    k = id_column(model, base["name"])
    return "authenticated", f"EXISTS (SELECT 1 FROM {base['name']} b WHERE b.{k} = {tn}.{k} AND b.{bo} = auth.uid())"


def _policies(model: dict, t: dict) -> list[str]:
    """real policies from the model's "access": one kind (read = select only, members/own = everything),
    or two kinds = the wider one reads, the narrower one writes (e.g. ["read", "own"]: a board)"""
    tn, al = t["name"], access_list(t)
    if not al:
        return []
    if len(al) == 1:
        kind = al[0]
        roles, cond = _who(model, t, kind)
        if kind == "read":
            return [f"CREATE POLICY {tn}_read ON {tn} FOR SELECT TO {roles} USING ({cond});"]
        return [f"CREATE POLICY {tn}_{kind} ON {tn} FOR ALL TO {roles} USING ({cond}) WITH CHECK ({cond});"]
    reader, writer = sorted(al, key=lambda a: -WIDE[a])
    rr, rc = _who(model, t, reader)
    wr, wc = _who(model, t, writer)
    return [f"-- {tn}: 읽기 = {reader}, 쓰기 = {writer}",
            f"CREATE POLICY {tn}_read_{reader} ON {tn} FOR SELECT TO {rr} USING ({rc});",
            f"CREATE POLICY {tn}_add_{writer} ON {tn} FOR INSERT TO {wr} WITH CHECK ({wc});",
            f"CREATE POLICY {tn}_edit_{writer} ON {tn} FOR UPDATE TO {wr} USING ({wc}) WITH CHECK ({wc});",
            f"CREATE POLICY {tn}_delete_{writer} ON {tn} FOR DELETE TO {wr} USING ({wc});"]


def rls_sql(model: dict, only=None) -> list[str]:
    """Supabase: the public (anon / publishable) key in the site can reach every table, so RLS goes on for all.
    No policy = nobody can read or write through that key (safe default)."""
    out = ["", "-- ===== 행 접근 규칙 (RLS) =====",
           "-- Supabase 에서는 사이트 코드에 넣는 공개용 키(anon · publishable)로 누구나 모든 표에 접근을 시도할 수 있습니다.",
           "-- 그래서 모든 표에 RLS 를 켭니다. 규칙(policy)이 없는 표는 공개용 키로 아무것도 읽고 쓸 수 없습니다 (안전한 기본값).",
           "-- 규칙은 정본의 표에 \"access\" 를 적고 다시 build 하면 아래에 만들어집니다 (권장: members · own · read).",
           "-- 틀만 있는 표는 이 파일을 고치지 말고, SQL 편집기에 붙여 넣은 뒤 고른 틀의 주석을 풀어 실행하고,",
           "-- 실행한 규칙은 data/supabase-policies.sql 에 적어 둡니다 (이 파일을 고치면 verify 가 '정본과 다릅니다'로 멈춥니다).",
           "-- 사이트 코드에는 공개용 키만. service_role · sb_secret_ 키는 절대 넣지 않습니다. 적용 뒤 Supabase 의 Security Advisor 를 확인하세요.",
           "-- (일반 PostgreSQL 에서는 표 주인 계정에는 RLS 가 적용되지 않아 동작이 바뀌지 않습니다.)"]
    if model.get("signup") == "closed":
        out += ["-- 이 사이트는 새 가입을 끈 것으로 정했습니다(signup: closed). Supabase 의 Authentication 설정에서",
                "--   · 새 가입(Allow new users to sign up)을 끄고, · 익명 로그인(Allow anonymous sign-ins)도 끕니다 (익명 사용자도 로그인한 사람으로 칩니다).",
                "--   · 계정은 Authentication → Users → Add user 로 만들어 줍니다. 사이트에는 가입 화면을 두지 않습니다."]
    for t in ordered(model):
        tn = t["name"]
        if only is not None and tn not in only:
            continue
        out.append(f"ALTER TABLE {tn} ENABLE ROW LEVEL SECURITY;")
        real = _policies(model, t)
        if real:
            out += real
            continue
        members = (f"--   [정해진 사람끼리 · 새 가입을 끈 경우에만] CREATE POLICY {tn}_members ON {tn} FOR ALL TO authenticated"
                   " USING (true) WITH CHECK (true);  -- 가입이 켜져 있으면 아무나 가입해 읽고 씁니다")
        own = (f"--   [가입형·자기 행] CREATE POLICY {tn}_own ON {tn} FOR ALL TO authenticated"
               " USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());  -- 정본에 owner 칸 + \"access\": \"own\" 이 더 쉽습니다")
        if tn.startswith("pi_"):
            out += [f"-- {tn} 는 개인정보: 누구나 읽기 규칙은 쓰지 않습니다. 본인 · 관리자 · (가입을 끈 경우) 정해진 사람만.",
                    own, members,
                    "--   [관리자만]     관리자를 구별하는 방법(관리자 표 또는 JWT claim)을 정한 뒤 USING 에 그 조건을 씁니다"]
        else:
            out += [members, own,
                    f"--   [누구나 읽기만]   CREATE POLICY {tn}_read ON {tn} FOR SELECT TO anon, authenticated USING (true);"]
    return out


def erd(model: dict) -> str:
    out = [f"# {model.get('project', '')} -- ERD", "", "```mermaid", "erDiagram"]
    for t in ordered(model):
        keys = {k["name"] for k in key_columns(t)}
        out.append(f"    {t['name']} {{")
        for c in all_columns(t):
            if c.get("auto"):
                continue
            mark = " PK" if c["name"] in keys else ""
            mark += (" FK" if mark == "" else ",FK") if c["type"] == "ref" else ""
            label = (c.get("label") or "").replace('"', "'") + (" (개인정보)" if c.get("personal") else "")
            out.append(f"        {c['type']} {c['name']}{mark} \"{label}\"")
        out.append("    }")
    for t in ordered(model):
        keys = key_columns(t)
        for c in t["columns"]:
            if c["type"] != "ref":
                continue
            one_to_one = c.get("key") and len(keys) == 1
            left = "||" if c.get("required") or c.get("key") else "|o"
            right = "||" if one_to_one else "o{"
            out.append(f"    {c['ref']} {left}--{right} {t['name']} : \"{(c.get('label') or c['name']).replace(chr(34), '')}\"")
    out += ["```", ""]
    return "\n".join(out)


TYPE_KO = {"id": "번호(자동)", "ref": "다른 표 가리킴", "owner": "만든 사람(로그인)", "text": "글자", "long_text": "긴 글", "int": "정수", "number": "숫자",
           "money": "금액", "bool": "예/아니오", "date": "날짜", "datetime": "날짜+시각"}


def spec_rows(model: dict):
    for t in ordered(model):
        keys = {k["name"] for k in key_columns(t)}
        for i, c in enumerate(all_columns(t), 1):
            rule = []
            if c.get("required") or c["name"] in keys:
                rule.append("필수")
            if c.get("unique"):
                rule.append("중복 금지")
            if c.get("choices"):
                rule.append("선택: " + "/".join(map(str, c["choices"])))
            if c["type"] == "ref":
                rule.append(f"→ {c['ref']} ({ {'keep': '지우지 못하게', 'delete': '같이 지움', 'clear': '비움'}[c.get('on_delete', 'keep')] })")
            yield (t["name"], t.get("label", ""), i, c["name"], c.get("label", ""), TYPE_KO[c["type"]],
                   "키" if c["name"] in keys else "", ", ".join(rule), str(c.get("personal") or "") if c.get("personal") else "",
                   c.get("about", "") or ("자동" if c.get("auto") else ""))


SPEC_HEAD = ("테이블", "테이블 이름표", "순번", "칸", "칸 이름표", "자료형", "키", "규칙", "개인정보", "설명")


def spec_md(model: dict) -> str:
    out = [f"# {model.get('project', '')} -- 테이블 정의서", "", f"DB: {model.get('db', 'sqlite')}", ""]
    p = model.get("product")
    if isinstance(p, dict) and p.get("kinds"):
        main = product_main(model)
        rest = [PRODUCT_KINDS[k][0] for k in p["kinds"] if k != main and k in PRODUCT_KINDS]
        out += [f"만드는 것: **{PRODUCT_KINDS.get(main, (main,))[0]}**" + (f" (함께: {', '.join(rest)})" if rest else "")
                + f" -- 사용자: \"{p.get('said', '')}\"", ""]
    if model.get("goals") or model.get("not_doing"):
        out += ["## 성공 기준 -- 이 데이터로 할 수 있어야 하는 것", "",
                "`datalight.py verify` 가 아래 확인 쿼리를 샘플 데이터로 실제로 돌려 봅니다.", ""]
        out += [f"{i}. {g.get('say')}  \n   `{g.get('sql')}`" for i, g in enumerate(model.get("goals") or [], 1)]
        if model.get("not_doing"):
            out += ["", "**이번에 만들지 않을 것:** " + ", ".join(map(str, model["not_doing"]))]
        out.append("")
    cur = None
    for r in spec_rows(model):
        if r[0] != cur:
            cur = r[0]
            t = tables(model)[cur]
            combo = "".join(f"\n\n함께 중복 금지: {' + '.join(u)}" for u in t.get("unique") or [])
            out += ["", f"## {r[1] or cur} (`{cur}`)", "", t.get("about", "") + combo, "",
                    "| " + " | ".join(SPEC_HEAD[2:]) + " |", "|" + "---|" * (len(SPEC_HEAD) - 2)]
        out.append("| " + " | ".join(str(x).replace("|", "/") for x in r[2:]) + " |")
    return "\n".join(out) + "\n"


def spec_xlsx(model: dict, path) -> bool:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill
    except ImportError:
        return False
    wb = Workbook()
    ws = wb.active
    ws.title = "정의서"
    ws.append(SPEC_HEAD)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill("solid", fgColor="E4E7F7")
    pink = PatternFill("solid", fgColor="FBE0E5")
    for r in spec_rows(model):
        ws.append(r)
        if r[8]:
            for c in ws[ws.max_row]:
                c.fill = pink
    ws.freeze_panes = "A2"
    for col, wdt in zip("ABCDEFGHIJ", (18, 16, 6, 18, 16, 12, 6, 36, 10, 40)):
        ws.column_dimensions[col].width = wdt
    wb.save(path)
    return True


BOOK_CSS = """body{margin:0;background:#f6f5f1;color:#1f2328;font:16px/1.7 "Pretendard","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 20px 80px}h1{font-size:28px;margin:0}h1+p{color:#5b636d;margin:4px 0 18px}
h2{font-size:20px;margin:34px 0 10px;padding-top:14px;border-top:1px solid #dcd9d0}h3{font-size:18px;margin:26px 0 4px}h3 small{font-weight:400;color:#6b7280;font-size:13px}
details{background:#fff;border:1px solid #dcd9d0;border-left:4px solid #2f7d6d;border-radius:6px;padding:8px 14px}summary{cursor:pointer;font-weight:600}
table{border-collapse:collapse;width:100%;background:#fff;margin:6px 0 10px;font-size:14px}th,td{border:1px solid #e3e0d8;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#efede6;font-weight:600}.mut{color:#6b7280}.say{font-size:17px}.tag{display:inline-block;font-size:12px;border:1px solid #c9c5ba;border-radius:10px;padding:0 8px;margin:0 4px 2px 0;background:#fff}
.pi{color:#a3332a}.miss{color:#9a6700}ul{padding-left:22px}@media print{details{border-left-width:1px}}"""


def _e(x) -> str:
    return html.escape("" if x is None else str(x))


def _cellv(c: dict, v):
    if c.get("type") == "bool" and isinstance(v, bool):
        return "예" if v else "아니오"
    return v


def _ops(s: str) -> str:
    return "·".join(OPS_KO[o] for o in "CRUD" if o in str(s).upper())


def book_html(model: dict) -> str:
    """쉬운 데이터 설명서 -- 무엇을 만들고, 어떤 일에 어느 표를 쓰고, 표마다 왜 있고 누가 쓰고 어떤 값이 들어가나 (전문판 시스템 설계서의 쉬운 부분집합).
    시각을 넣지 않는다 -- 정본이 같으면 같은 파일 (verify 가 낡은 out/ 을 찾는다)."""
    tb = ordered(model)
    T = tables(model)
    works = [w for w in model.get("works") or [] if isinstance(w, dict) and w.get("name")]
    lab = lambda n: (T.get(n) or {}).get("label") or n  # noqa: E731
    used_by: dict[str, list] = {}
    for w in works:
        for tn, ops in (w.get("uses") or {}).items():
            used_by.setdefault(tn, []).append((w, ops))
    o = [f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
         f"<title>{_e(model.get('project'))} -- 데이터 설명서</title><style>{BOOK_CSS}</style></head><body><main>",
         f"<h1>{_e(model.get('project'))}</h1><p>데이터 설명서 -- 무엇을 기록하고, 어떤 일에 쓰고, 실제로 어떤 값이 들어가나</p>",
         "<details open><summary>이 문서 읽는 법</summary><ul>",
         "<li><b>표</b>는 엑셀 시트 하나, <b>한 줄</b>은 기록 하나(손님 한 명, 주문 한 건), <b>칸</b>은 열입니다.</li>",
         "<li><b>다른 표를 가리키는 칸</b>은 표끼리 잇습니다 -- 예: 주문의 '손님' 칸은 손님 표의 한 줄을 가리킵니다.</li>",
         "<li><b>개인정보</b>(이름·전화 …)는 짝 표에 따로 둡니다. 본 줄을 지우면 같이 지워집니다.</li>",
         "<li><b>알고 싶은 것</b>은 이 데이터로 꼭 나와야 하는 답입니다. 검사가 예시 값으로 실제로 돌려 봅니다.</li>",
         "<li><b>예시 값은 만든 값</b>입니다 (실제 사람이 아닙니다).</li></ul>",
         "<p><b>확인할 것</b>: 빠진 기록이나 칸이 없나요? 하는 일과 표의 연결이 실제와 같나요? 예시를 보면 이상한 곳이 있나요?</p></details>"]
    p = model.get("product")
    if isinstance(p, dict) and p.get("kinds"):
        main = product_main(model)
        rest = [PRODUCT_KINDS[k][0] for k in p["kinds"] if k != main and k in PRODUCT_KINDS]
        o.append(f"<h2>무엇을 만드나</h2><p class='say'><b>{_e(PRODUCT_KINDS.get(main, (main,))[0])}</b>" + (f" (함께: {_e(', '.join(rest))})" if rest else "")
                 + f"</p><p class='mut'>사용자가 한 말: “{_e(p.get('said'))}”</p>")
    else:
        o.append(f"<h2>무엇을 만드나</h2><p class='miss'>{UNDETERMINED} -- 무엇을 만들어 드릴지 먼저 정합니다</p>")
    if model.get("not_doing"):
        o.append("<p><b>이번에 만들지 않을 것</b>: " + _e(", ".join(map(str, model["not_doing"]))) + "</p>")
    goals = model.get("goals") or []
    o.append("<h2>알고 싶은 것</h2>" + ("<ol>" + "".join(f"<li>{_e(g.get('say'))}</li>" for g in goals if isinstance(g, dict)) + "</ol>"
                                       if goals else "<p class='miss'>아직 없습니다 -- '이 데이터로 무엇을 알 수 있어야 하나요?'</p>"))
    o.append("<h2>하는 일</h2>")
    if works:
        o.append("<table><tr><th>일</th><th>누가</th><th>화면</th><th>쓰는 표</th></tr>")
        for w in works:
            scr = w.get("screen")
            scr = ", ".join(scr) if isinstance(scr, list) else (scr or "")
            uses = "<br>".join(f"{_e(lab(tn))} -- {_e(_ops(ops))}" for tn, ops in (w.get("uses") or {}).items())
            o.append(f"<tr><td><b>{_e(w['name'])}</b>" + (f"<div class='mut'>{_e(w.get('say'))}</div>" if w.get("say") else "")
                     + f"</td><td>{_e(w.get('who'))}</td><td>{_e(scr)}</td><td>{uses}</td></tr>")
        o.append("</table>")
    else:
        o.append("<p class='miss'>하는 일(works)이 적혀 있지 않습니다 -- 이 데이터를 쓰는 일 3~7개(누가 · 어느 화면에서 · 어느 표를)를 적으면 표마다 왜 있는지가 보입니다</p>")
    o.append("<h2>표</h2>")
    for t in tb:
        tn = t["name"]
        keys = {k["name"] for k in key_columns(t)}
        o.append(f"<h3>{_e(t.get('label') or tn)} <small>{_e(tn)}</small></h3>")
        if t.get("about"):
            o.append(f"<p><b>한 줄은</b> {_e(t['about'])}</p>")
        base = tn[3:] if tn.startswith("pi_") else None
        ub = used_by.get(tn) or (used_by.get(base) if base else None) or []
        if ub:
            o.append("<p><b>이 표를 쓰는 일</b>: " + " ".join(f"<span class='tag'>{_e(w['name'])} · {_e(_ops(ops))}</span>" for w, ops in ub) + "</p>")
            who = sorted({str(w.get("who")) for w, _ in ub if w.get("who")})
            if who:
                o.append(f"<p><b>누가 쓰나</b>: {_e(', '.join(who))}</p>")
        elif works:
            o.append("<p class='miss'>이 표를 쓰는 일이 적혀 있지 않습니다</p>")
        if base:
            o.append(f"<p class='pi'>개인정보 짝 표 -- {_e(lab(base))} 한 줄마다 하나, {_e(lab(base))} 줄을 지우면 같이 지워집니다</p>")
        rel = []
        for c in t["columns"]:
            if c.get("type") == "ref" and not (base and c.get("key")):
                od = {"keep": "지우지 못하게 막습니다", "delete": "이 줄도 같이 지워집니다", "clear": "이 칸을 비웁니다"}[c.get("on_delete", "keep")]
                rel.append(f"<li>{_e(t.get('label') or tn)} 한 줄은 <b>{_e(lab(c['ref']))}</b> 한 줄을 가리킵니다 "
                           f"({'꼭 있어야 함' if c.get('required') or c.get('key') else '비어도 됨'}). {_e(lab(c['ref']))} 줄을 지우려 하면 {_e(od)}.</li>")
        if rel:
            o.append("<ul>" + "".join(rel) + "</ul>")
        has_about = any(c.get("about") for c in all_columns(t))
        o.append("<table><tr><th>칸</th>" + ("<th>뜻</th>" if has_about else "") + "<th>종류</th><th>규칙</th></tr>")
        for c in all_columns(t):
            rule = []
            if c.get("required") or c["name"] in keys:
                rule.append("꼭 채움")
            if c.get("unique"):
                rule.append("같은 값 두 번 금지")
            if c.get("choices"):
                rule.append("고르기: " + "/".join(map(str, c["choices"])))
            if c.get("auto"):
                rule.append("자동")
            o.append(f"<tr><td>{_e(c.get('label') or c['name'])}" + (" <span class='pi'>(개인정보)</span>" if c.get("personal") else "") + "</td>"
                     + (f"<td>{_e(c.get('about'))}</td>" if has_about else "")
                     + f"<td>{_e(TYPE_KO.get(c['type'], c['type']))}</td><td>{_e(', '.join(rule))}</td></tr>")
        o.append("</table>")
        rows = t.get("sample") or []
        if rows:
            cols = [c for c in all_columns(t) if not c.get("auto")]
            o.append("<p class='mut'>예시 (만든 값)</p><table><tr>" + "".join(f"<th>{_e(c.get('label') or c['name'])}</th>" for c in cols) + "</tr>"
                     + "".join("<tr>" + "".join(f"<td>{_e(_cellv(c, r.get(c['name'], '')))}</td>" for c in cols) + "</tr>" for r in rows) + "</table>")
        else:
            o.append("<p class='miss'>예시가 없습니다 -- 들어갈 법한 값 몇 줄을 만들어 두면 빠진 칸이 잘 보입니다</p>")
    o.append(f"<p class='mut'>정본 data/model.light.json 에서 만들었습니다 (data-light). 그림은 <code>datalight.py view</code>.</p></main></body></html>")
    return "\n".join(o) + "\n"


def build(model: dict, out_dir, db: str | None = None) -> list[str]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    files = []
    for name, text in (("schema.sql", ddl(model, db)), ("erd.md", erd(model)), ("spec.md", spec_md(model)), ("book.html", book_html(model))):
        _write(out / name, text)
        files.append(name)
    if spec_xlsx(model, out / "spec.xlsx"):
        files.append("spec.xlsx")
    return files


# ----------------------------------------------------------------- try (SQLite probe)
def _fill(c: dict, n: int):
    ty = c["type"]
    if c.get("choices"):
        return c["choices"][0]
    return {"text": f"샘플{n}", "long_text": f"샘플 글 {n}", "int": n, "number": n + 0.5, "money": 1000 * n,
            "bool": 1, "date": "2026-01-0%d" % min(n, 9), "datetime": "2026-01-01 09:00:00"}.get(ty, f"v{n}")


def _norm(v):
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return float(v)
    return v


def run_goals(con, model: dict) -> tuple[bool, list[str]]:
    ok, lines = True, []
    for i, g in enumerate(model.get("goals") or [], 1):
        label = f"성공 기준 {i} '{g.get('say')}'"
        try:
            rows = [list(r) for r in con.execute(g["sql"].strip().rstrip(";")).fetchall()]
        except sqlite3.Error as e:
            ok = False
            lines.append(f"FAIL: {label} -- 쿼리 실패: {e}")
            continue
        ex = g.get("expect", "rows")
        if ex == "rows":
            good, why = bool(rows), "결과가 없습니다"
        elif isinstance(ex, int):
            good, why = len(rows) == ex, f"{ex}행이어야 하는데 {len(rows)}행"
        else:
            key = lambda r: json.dumps([_norm(x) for x in r], ensure_ascii=False)  # noqa: E731
            good = sorted(map(key, rows)) == sorted(map(key, ex))
            why = f"기대 {ex} / 실제 {rows}"
        lines.append(f"OK: {label}" if good else f"FAIL: {label} -- {why}")
        ok &= good
    return ok, lines


def try_sqlite(model: dict, ddl_text: str | None = None) -> tuple[bool, list[str]]:
    """create the SQLite schema in memory, insert samples, run the goals, then check each rule really blocks bad rows"""
    con = sqlite3.connect(":memory:")
    con.execute("PRAGMA foreign_keys = ON")
    lines, ok = [], True
    try:
        con.executescript(ddl_text if ddl_text is not None else ddl(model, "sqlite"))
        lines.append(f"OK: 테이블 {len(model['tables'])}개 만들기")
    except sqlite3.Error as e:
        con.close()
        return False, [f"FAIL: 스키마 만들기 실패 -- {e}"]
    first_ids: dict[str, int] = {}

    def insert(t, row):
        cols = list(row)
        if not cols:                                    # nothing required and no sample: let defaults fill the row
            return con.execute(f"INSERT INTO {t['name']} DEFAULT VALUES").lastrowid
        cur = con.execute(f"INSERT INTO {t['name']} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                          [int(v) if isinstance(v, bool) else v for v in row.values()])
        return cur.lastrowid

    def minimal_row(t, n=1):
        row = {}
        for c in t["columns"]:
            if c["type"] == "id":
                continue
            if c["type"] == "ref":
                if c.get("required") or c.get("key"):
                    row[c["name"]] = first_ids.get(c["ref"])
                continue
            if c.get("required") or c.get("unique"):
                row[c["name"]] = _fill(c, n)
        return row

    for t in ordered(model):
        rows = t.get("sample") or []
        try:
            for r in rows:
                rid = insert(t, r)
                first_ids.setdefault(t["name"], r.get(id_column(model, t["name"]) or "", rid) or rid)
            if not rows:
                rid = insert(t, minimal_row(t))
                kc = key_columns(t)
                first_ids.setdefault(t["name"], rid if kc and kc[0]["type"] == "id" else first_ids.get(kc[0]["ref"]) if kc else rid)
            lines.append(f"OK: {t['name']} 샘플 {len(rows) or 1}행 넣기")
        except sqlite3.Error as e:
            ok = False
            lines.append(f"FAIL: {t['name']} 샘플 넣기 실패 -- {e}")
    con.commit()
    gok, glines = run_goals(con, model)
    ok &= gok
    lines += glines

    def expect_block(label, fn):
        nonlocal ok
        con.execute("SAVEPOINT p")
        try:
            fn()
            ok = False
            lines.append(f"FAIL: {label} -- 막혀야 하는데 들어갔습니다")
        except sqlite3.Error:
            lines.append(f"OK: {label} 막힘")
        con.execute("ROLLBACK TO p")
        con.execute("RELEASE p")

    for t in ordered(model):
        base = minimal_row(t, 7)
        for c in t["columns"]:
            n = f"{t['name']}.{c['name']}"
            if c["type"] in ("id",) or (c["type"] == "ref" and c.get("key") and len(key_columns(t)) == 1):
                continue
            if c.get("required") and c["type"] != "ref":
                expect_block(f"{n} 비우기", lambda c=c: insert(t, {**base, c["name"]: None}))
            if c.get("choices"):
                expect_block(f"{n} 목록 밖 값", lambda c=c: insert(t, {**base, c["name"]: "__없는값__"}))
            if c["type"] == "money":
                expect_block(f"{n} 음수 금액", lambda c=c: insert(t, {**base, c["name"]: -1}))
            if c["type"] == "ref":
                expect_block(f"{n} 없는 대상 가리키기", lambda c=c: insert(t, {**base, c["name"]: 987654321}))
                if c.get("required"):
                    expect_block(f"{n} 비우기", lambda c=c: insert(t, {**base, c["name"]: None}))
        uq = [c for c in t["columns"] if c.get("unique")]
        for c in uq:
            def dup(c=c):
                r1 = {**base, c["name"]: _fill(c, 99)}
                for o in uq:
                    if o is not c:
                        r1[o["name"]] = _fill(o, 98)
                insert(t, r1)
                r2 = dict(r1)
                for o in uq:
                    if o is not c:
                        r2[o["name"]] = _fill(o, 97)
                insert(t, r2)
            expect_block(f"{t['name']}.{c['name']} 중복", dup)
        for u in t.get("unique") or []:
            cols_by = {c["name"]: c for c in t["columns"]}

            def dup_combo(u=u, cols_by=cols_by, uq=uq, base=base, t=t):
                r1 = dict(base)
                for x in u:
                    c = cols_by[x]
                    r1[x] = first_ids.get(c["ref"]) if c["type"] == "ref" else _fill(c, 55)
                for o in uq:
                    if o["name"] not in u:
                        r1[o["name"]] = _fill(o, 61)
                insert(t, r1)
                r2 = dict(r1)
                for o in uq:
                    if o["name"] not in u:
                        r2[o["name"]] = _fill(o, 62)
                insert(t, r2)
            expect_block(f"{t['name']} ({' + '.join(u)}) 함께 중복", dup_combo)
    # deleting a parent that children point to with on_delete keep
    for t in ordered(model):
        for c in t["columns"]:
            if c["type"] == "ref" and c.get("on_delete", "keep") == "keep" and c.get("ref") in first_ids:
                if con.execute(f"SELECT count(*) FROM {t['name']} WHERE {c['name']} = ?", (first_ids[c['ref']],)).fetchone()[0]:
                    rid = id_column(model, c["ref"])
                    expect_block(f"{c['ref']} 삭제(→ {t['name']} 가 가리키는 중)",
                                 lambda c=c, rid=rid: con.execute(f"DELETE FROM {c['ref']} WHERE {rid} = ?", (first_ids[c['ref']],)))
    con.close()
    return ok, lines


# ----------------------------------------------------------------- verify (harness gate)
def _mutants(model: dict, base: str):
    """one planted bug per rule kind, aimed at a column the model says is protected"""
    def first(pred):
        for t in ordered(model):
            for c in t["columns"]:
                if pred(t, c):
                    return t["name"], c["name"]
        return None

    def cut(target, rx_tail, keep_group=False):
        if not target:
            return None
        t, c = target
        start = base.index(f"CREATE TABLE {t} (")
        end = base.index("\n);", start)
        m = re.compile(rf"(\n  {c} \w+(?:\(\d+,\d+\))?[^\n]*?)" + rx_tail).search(base, start, end)
        if not m:
            return None
        return base[:m.start()] + m.group(1) + base[m.end():]

    single_key = lambda t, c: c.get("key") and len(key_columns(t)) == 1  # noqa: E731
    yield "필수값(NOT NULL) 하나 빼기", cut(first(lambda t, c: c.get("required") and c["type"] not in ("id", "ref")), " NOT NULL")
    yield "선택값 규칙(CHECK IN) 하나 빼기", cut(first(lambda t, c: c.get("choices")), r" CHECK \(\w+ IN \([^)]*\)\)")
    yield "금액 음수 금지 하나 빼기", cut(first(lambda t, c: c["type"] == "money"), r" CHECK \(\w+ >= 0\)")
    yield "중복 금지(UNIQUE) 하나 빼기", cut(first(lambda t, c: c.get("unique") and c["type"] != "id"), " UNIQUE")
    combo = next(((t["name"], u) for t in ordered(model) for u in (t.get("unique") or [])), None)
    if combo:
        line = f",\n  UNIQUE ({', '.join(combo[1])})"
        yield "함께 중복 금지(UNIQUE 묶음) 하나 빼기", base.replace(line, "", 1) if line in base else None
    yield "참조(REFERENCES) 하나 빼기", cut(first(lambda t, c: c["type"] == "ref" and not single_key(t, c)),
                                       r" REFERENCES \w+ \(\w+\) ON DELETE (?:RESTRICT|CASCADE|SET NULL)")


def mutation_check(model: dict) -> list[tuple[str, bool]]:
    """plant one bug at a time in the SQL and confirm `try` notices (does the safety device really catch?)"""
    base = ddl(model, "sqlite")
    out = []
    for label, broken in _mutants(model, base):
        if broken is None:
            continue
        ok, _ = try_sqlite(model, broken)
        out.append((label, not ok))
    return out


def stale_outputs(model: dict, out_dir) -> list[str]:
    """files in data/out that no longer match the model (someone edited the model but did not rebuild)"""
    out = Path(out_dir)
    if not out.is_dir():
        return []
    want = {"schema.sql": None, "erd.md": erd(model), "spec.md": spec_md(model), "book.html": book_html(model)}
    stale = []
    for name, text in want.items():
        f = out / name
        if not f.exists():
            continue
        if name == "schema.sql":
            first = f.read_text(encoding="utf-8").split("\n", 1)[0]
            db = "postgresql" if "postgresql" in first else "sqlite"
            text = ddl(model, db)
        if f.read_text(encoding="utf-8") != text:
            stale.append(name)
    return stale


def db_drift(model: dict, db_path) -> tuple[list[str], list[str]]:
    """compare a real SQLite DB with the model. (irreversible, notes)
    irreversible = tables/columns that hold data in the DB but are gone from the model"""
    con = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    bad, notes = [], []
    try:
        have = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        tb = tables(model)
        outside = set(model.get("outside") or [])
        for t in sorted(have):
            if t in outside:
                notes.append(f"{t} 는 정본 밖(outside)으로 둔 표 -- 검사하지 않습니다")
                continue
            n = con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0]
            if t not in tb:
                (bad if n else notes).append(f"DB 의 {t} 가 정본에서 빠졌습니다 ({n}행)" + (" -- 지우면 되돌릴 수 없습니다" if n else ""))
                continue
            cols = [r[1] for r in con.execute(f'PRAGMA table_info("{t}")')]
            want = {c["name"] for c in all_columns(tb[t])}
            for c in cols:
                if c not in want:
                    filled = con.execute(f'SELECT count(*) FROM "{t}" WHERE "{c}" IS NOT NULL').fetchone()[0]
                    (bad if filled else notes).append(f"DB 의 {t}.{c} 가 정본에서 빠졌습니다 (값 {filled}개)"
                                                      + (" -- 지우면 되돌릴 수 없습니다" if filled else ""))
            for c in sorted(want - set(cols)):
                notes.append(f"{t}.{c} 는 정본에만 있습니다 (DB 에 아직 반영 전)")
        for t in sorted(set(tb) - have):
            notes.append(f"{t} 는 정본에만 있습니다 (DB 에 아직 반영 전)")
    finally:
        con.close()
    return bad, notes


def verify(model_path, db_path=None, use_db=True, mutate=False) -> tuple[bool, list[str]]:
    """the single pass/fail gate. Used by people, by Claude before saying 'done', by the commit hook and by CI"""
    m = load(model_path)
    lines, ok = [], True
    errs, warns = check(m)
    lines += [f"FAIL: {e}" for e in errs] + [f"참고: {w}" for w in warns]
    if errs:
        return False, lines + ["결과: 설계 검사(check) 실패 -- 나머지 검사는 건너뜁니다"]
    lines.append("OK: 설계 검사")
    if m.get("product") is None:
        ok = False
        lines.append(f"FAIL: 만드는 것(product)이 {UNDETERMINED} -- 무엇을 만들어 넘기는지 사용자에게 묻고 정본에 적습니다 "
                     "(설계까지 · 파일 넣기 · 데이터 관리 · 분석)")
    else:
        kinds = m["product"]["kinds"]
        lines.append("OK: 만드는 것 -- " + ", ".join(PRODUCT_KINDS[k][0] for k in kinds) + f" (주: {PRODUCT_KINDS[product_main(m)][0]})")
        if "analyze" in kinds and not m.get("goals"):
            ok = False
            lines.append("FAIL: 분석이 목적인데 성공 기준(goals)이 없습니다 -- 알고 싶은 것을 확인 쿼리로 적어야 실제로 나오는지 볼 수 있습니다")
        if "manage" in kinds:
            lines.append("참고: 데이터 관리(찾고·고치기) 화면은 verify 가 보지 않습니다 -- 화면에서 찾고 고쳐 보는 것은 사용자와 함께 확인")
    tok, tlines = try_sqlite(m)
    ok &= tok
    lines += [l for l in tlines if l.startswith("FAIL") or "성공 기준" in l]
    if tok:
        lines.append("OK: 규칙 확인 (나쁜 값이 모두 막힘)")
    out = Path(model_path).parent / "out"
    stale = stale_outputs(m, out)
    if stale:
        ok = False
        lines.append(f"FAIL: {out} 의 {', '.join(stale)} 가 정본과 다릅니다 -- `build` 로 다시 만드세요")
    if use_db:
        dbp = Path(db_path) if db_path else Path(model_path).parent / "app.db"
        if dbp.exists():
            bad, notes = db_drift(m, dbp)
            ok &= not bad
            lines += [f"FAIL: {b}" for b in bad] + [f"참고: {n}" for n in notes]
            if not bad:
                lines.append(f"OK: {dbp.name} 와 비교 -- 데이터가 사라질 변경 없음")
    if mutate:
        res = mutation_check(m)
        for label, caught in res:
            lines.append(("OK: 장치 검증 -- " if caught else "FAIL: 장치 검증 -- ") + label + (" → 잡음" if caught else " → 못 잡음 (검사에 구멍)"))
            ok &= caught
    lines.append("결과: 통과" if ok else "결과: 실패 -- FAIL 줄을 고친 뒤 다시 verify")
    return ok, lines


HOOK_MARK = "# data-light pre-commit"
HOOK_END = "# data-light end"
HOOK_VER = "# data-light-version: "
HOOK = HOOK_MARK + """ (datalight.py hook install)
""" + HOOK_VER + __version__ + """
# 정본(model.light.json)이나 그 out/ 이 바뀐 커밋은 verify 를 통과해야 한다.
# 멈추면 FAIL 줄을 고친 뒤 다시 저장(커밋)하세요. 검사를 건너뛰지 않습니다.
# (괄호 안에서만 끝내므로 이 아래에 다른 훅 내용이 있어도 그대로 돕니다)
(
  models=$(git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMR | while IFS= read -r f; do
    # 패턴 앞의 "(" 는 꼭 둔다 -- macOS 의 /bin/sh(bash 3.2)는 $( ) 안의 case 패턴 ")" 를 치환의 끝으로 읽는다
    case "$f" in (.claude/skills/*|.agents/skills/*) continue ;; esac   # 설치된 스킬의 예제는 검사하지 않음
    case "$f" in
      (*model.light.json) printf '%s\\n' "$f" ;;
      (*/out/*) d=${f%/out/*}; [ -f "$d/model.light.json" ] && printf '%s\\n' "$d/model.light.json" ;;
      (out/*) [ -f model.light.json ] && printf '%s\\n' model.light.json ;;
    esac
  done | sort -u)
  [ -z "$models" ] && exit 0
  PY=""
  for c in python3 python py; do "$c" -c "import sys" >/dev/null 2>&1 && { PY=$c; break; }; done  # Windows: python3 can be a Store stub
  [ -z "$PY" ] && { echo "data-light: python 을 찾지 못해 검사를 건너뜁니다"; exit 0; }
  printf '%s\\n' "$models" | while IFS= read -r m; do
    "$PY" .data-light/datalight.py verify "$m" || { echo "data-light: $m 검사 실패 -- 커밋을 멈췄습니다"; exit 1; }
  done
) || exit 1
""" + HOOK_END + "\n"
CI = """name: data-light verify
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-python@v6
        with: { python-version: "3.12" }
      - name: verify every model.light.json (installed skill examples excluded)
        run: |
          git -c core.quotepath=false ls-files '*model.light.json' | grep -v -E '^(\\.claude|\\.agents)/skills/' > "$RUNNER_TEMP/models.txt" || true
          while IFS= read -r m; do python .data-light/datalight.py verify "$m" --no-db || exit 1; done < "$RUNNER_TEMP/models.txt"
"""


GITIGNORE_LINES = ("data/app.db", "data/backup/", "data/*.csv", "data/*.xlsx", "data/out/spec.xlsx",
                   "data/import_plan*.json", "import_plan*.json", ".env")


def _git(repo: Path, *args) -> str:
    import subprocess
    try:
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
        return r.stdout.strip() if r.returncode == 0 else ""
    except OSError:
        return ""


def _hooks_dir(repo: Path) -> tuple[Path, str]:
    """where git really runs hooks: core.hooksPath (husky, lefthook, shared folder) or the (worktree's common) .git/hooks"""
    gp = _git(repo, "rev-parse", "--git-path", "hooks")
    d = Path(gp) if gp else repo / ".git" / "hooks"
    if not d.is_absolute():
        d = repo / d
    try:
        shown = Path(os.path.relpath(d, repo)).as_posix()
    except ValueError:
        shown = d.as_posix()
    return d, shown


def _hook_label(repo: Path, shown: str) -> str:
    return f"{shown}/pre-commit" + (" (git 설정 core.hooksPath)" if _git(repo, "config", "--get", "core.hooksPath") else "")


def _hook_syntax_error(hook: Path) -> str:
    """'' if the system sh can parse the hook (or no sh to ask), else the error text"""
    import shutil
    import subprocess
    sh = shutil.which("sh")
    if not sh:
        return ""
    try:   # file name + cwd, never a Windows path: WSL's bash turns C:\\Users\\... into C:Users...
        r = subprocess.run([sh, "-n", hook.name], cwd=str(hook.parent), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=20)
    except (OSError, subprocess.SubprocessError):
        return ""
    err = r.stderr.strip()
    if r.returncode == 0 or "syntax" not in err.lower():   # only a real parse error counts; "cannot run sh" is not one
        return ""
    return (err.splitlines() or ["sh -n 실패"])[-1]


def _settings(repo: Path) -> dict:
    f = repo / ".data-light" / "settings.json"
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def hook_status(repo=".") -> tuple[bool, list[str]]:
    repo = Path(repo).resolve()
    hd, shown = _hooks_dir(repo)
    where = _hook_label(repo, shown)
    hook = hd / "pre-commit"
    tool = repo / ".data-light" / "datalight.py"
    lines, same = [f"이 도구: data-light {__version__}"], True
    if not hook.exists() or HOOK_MARK not in hook.read_text(encoding="utf-8", errors="replace"):
        return False, lines + [f"훅: 없음 ({where}) -- `hook install` 필요"]
    m = re.search(re.escape(HOOK_VER) + r"(\S+)", hook.read_text(encoding="utf-8", errors="replace"))
    hv = m.group(1) if m else "(0.2 이하)"
    lines.append(f"훅: {where} · {hv}")
    same &= hv == __version__
    if tool.exists():
        tm = re.search(r'__version__ = "([^"]+)"', tool.read_text(encoding="utf-8", errors="replace"))
        tv = tm.group(1) if tm else "(0.2 이하)"
        lines.append(f"도구 사본: .data-light/datalight.py · {tv}")
        same &= tv == __version__
    else:
        same = False
        lines.append("도구 사본: 없음")
    st = _settings(repo)
    asks = []                                  # 버전은 같아도 사용자가 고를 것 (직접 고친 CI 파일 · 지운 것)
    wf = repo / ".github" / "workflows" / "data-light.yml"
    if st.get("ci", True) and wf.exists():
        cur = _fp(wf.read_text(encoding="utf-8", errors="replace"))
        if cur != _fp(CI):
            if st.get("ci_keep") == cur:
                lines.append("CI 파일: 직접 고친 것을 둠 (사용자 결정)")
            elif cur == st.get("ci_fp") or cur in _OLD_CI:
                lines.append("CI 파일: 예전 판 -- `hook install` 이 새 판으로 바꾼다")
                same = False
            else:
                lines.append("CI 파일: 직접 고침 (새 판과 다름) -- `hook install` 이 물어볼 것을 알린다")
                asks.append("CI 파일")
    elif st.get("ci", True) and st.get("ci_fp"):
        lines.append("CI 파일: 지웠음 -- `hook install` 이 물어볼 것을 알린다")
        asks.append("지운 CI 파일")
    gi = repo / ".gitignore"
    have = set(gi.read_text(encoding="utf-8-sig", errors="replace").splitlines()) if gi.exists() else set()
    gone = sorted(x for x in GITIGNORE_LINES if x in set(st.get("gitignore") or []) and x not in have)
    if gone and not set(gone) <= set(st.get("gitignore_keep") or []):
        lines.append(".gitignore: data-light 줄을 지움 (" + ", ".join(gone) + ") -- `hook install` 이 물어볼 것을 알린다")
        asks.append(".gitignore 줄")
    if not same:
        lines.append("결과: 버전이 다릅니다 -- `hook install` 로 다시 설치")
    elif asks:
        lines.append("결과: 물어볼 것 있음 (" + " · ".join(asks) + ") -- `hook install` 이 내는 `물어볼 것:` 을 사용자에게 보이고 고른 대로")
    else:
        lines.append("결과: 최신")
    return same and not asks, lines


ASK = "물어볼 것: "                 # hook install 의 결과 줄 -- 직접 고친 CI 파일 · 지운 .gitignore 줄 (사용자가 고른다)
_OLD_CI = ("3f7fd500e44293e3", "ecf2a9a2cb1ef660")   # 예전 판 CI 파일의 지문 -- 손대지 않은 예전 판은 묻지 않고 새 판으로
_PRIOR = "(0.8 이하)"              # settings.json 의 ci_fp -- 0.8 이하가 CI 파일을 만들었다 (지문은 남기지 않았다)


def _prior_ignore_lines(text: str):
    """GITIGNORE_LINES of an installed copy of this tool (0.8 and before kept no record of what they added)"""
    import ast
    m = re.search(r"^GITIGNORE_LINES\s*=\s*(\([^)]*\))", text, re.M)
    try:
        v = ast.literal_eval(m.group(1)) if m else None
    except (ValueError, SyntaxError):
        v = None
    return [x for x in v if isinstance(x, str)] if isinstance(v, tuple) else ([] if text else None)   # 사본에 없으면 그 판은 넣지 않았다


def _fp(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.replace("\r", "").encode("utf-8")).hexdigest()[:16]


def hook_install(repo=".", ci=None, append=False, update=(), keep=()) -> list[str]:
    """ci: True/False/None(=remembered choice, default on). append: add our block to someone else's pre-commit.
    update/keep: ('ci', 'gitignore', 'all') -- 직접 고친 CI 파일 · 지운 .gitignore 줄을 사용자가 고른 대로 (소유자 원칙 2026-10-20:
    새 판 반영이 원칙, 다르면 말없이 정하지 않고 묻는다 -- 결과에 '물어볼 것:' 줄)."""
    repo = Path(repo).resolve()
    if _git(repo, "rev-parse", "--is-inside-work-tree") != "true":
        raise SystemExit(f"{repo} 는 git 저장소가 아닙니다 (git init 먼저)")
    done = []
    tool = repo / ".data-light" / "datalight.py"
    hd, shown = _hooks_dir(repo)
    hook = hd / "pre-commit"
    old_copy = tool.read_text(encoding="utf-8", errors="replace") if tool.is_file() else ""     # 덮어쓰기 전에: 예전에 설치했나
    prior = bool(old_copy) or (hook.is_file() and HOOK_MARK in hook.read_text(encoding="utf-8", errors="replace"))
    tool.parent.mkdir(exist_ok=True)
    tool.write_bytes(Path(__file__).read_bytes())
    done.append(f".data-light/datalight.py {__version__} (도구 사본 -- 커밋해 두면 CI 와 다른 사람도 같은 검사)")
    st = _settings(repo)
    ci_explicit = ci
    if ci is None:
        ci = st.get("ci", True)
    if st.get("ci", True) != ci:
        st["ci"] = ci
        _write(repo / ".data-light" / "settings.json", json.dumps(st, ensure_ascii=False, indent=2) + "\n")
    where = _hook_label(repo, shown)
    hd.mkdir(parents=True, exist_ok=True)
    old = hook.read_text(encoding="utf-8", errors="replace") if hook.exists() else ""
    if HOOK_MARK in old:                       # ours (alone or appended) -> replace only our block, keep before and after
        i = old.index(HOOK_MARK)
        j = old.find(HOOK_END, i)
        rest = old[j + len(HOOK_END):].lstrip("\n") if j >= 0 else ""      # 0.3 hooks had no end mark: ours ran to the end
        _write(hook, old[:i] + HOOK + (("\n" + rest) if rest else ""))
        done.append(f"{where} (다시 설치 · {__version__})")
    elif old.strip() and not append:
        done.append(f"{where} 이 이미 있어 건드리지 않았습니다 -- 끝에 덧붙이려면 `hook install --append`")
    elif old.strip():
        _write(hook, old.rstrip("\n") + "\n\n" + HOOK)
        done.append(f"{where} 끝에 덧붙임 -- 그 위에 `exit 0` 같은 줄이 있으면 여기까지 오지 않으니 확인하세요")
    else:
        _write(hook, "#!/bin/sh\n" + HOOK)
        done.append(f"{where} (커밋할 때 자동 검사)")
    try:
        hook.chmod(0o755)
    except OSError:
        pass
    bad = _hook_syntax_error(hook)
    if bad:                                    # never leave a hook that stops every commit
        text = hook.read_text(encoding="utf-8", errors="replace")
        i = text.find(HOOK_MARK)
        j = text.find(HOOK_END, i)
        rest = text[:i] + (text[j + len(HOOK_END):].lstrip("\n") if j >= 0 else "")
        if rest.strip() in ("", "#!/bin/sh"):
            hook.unlink()
        else:
            _write(hook, rest)
        done.append(f"주의: 이 컴퓨터의 sh 가 훅을 읽지 못해 설치하지 않았습니다 ({bad}) -- 커밋은 막지 않습니다. "
                    "verify 는 손으로 돌리고, data-expert-framework-light 저장소에 알려 주세요")
    wf = repo / ".github" / "workflows" / "data-light.yml"
    st = _settings(repo)
    if prior and "gitignore" not in st:       # 0.8 이하가 설치했다: 그때 넣은 줄 · 만든 CI 파일을 기록으로 (지운 것을 말없이 되살리지 않는다)
        old_lines = _prior_ignore_lines(old_copy)                    # 사본 없이 훅 표시만 있으면 알 수 없다 -- 넣었다고 보고 묻는다
        st["gitignore"] = sorted(set(GITIGNORE_LINES if old_lines is None else old_lines) & set(GITIGNORE_LINES))
    if prior and "ci_fp" not in st and st.get("ci", True) and (not old_copy or '\nCI = """' in old_copy):   # 그 판이 CI 파일을 만들었다
        st["ci_fp"] = _PRIOR
    up = lambda k: k in update or "all" in update      # noqa: E731
    kp = lambda k: k in keep or "all" in keep          # noqa: E731
    want = _fp(CI)
    if not ci:
        done.append("CI 파일은 만들지 않음 (--no-ci 를 기억해 두었습니다. 다시 켜려면 `hook install --ci`)")
    elif not wf.exists():
        if st.get("ci_fp") and kp("ci") and not up("ci") and ci_explicit is not True:   # 사용자: 지운 채로 -- '만들지 않기'로 기억
            st["ci"] = False
            st.pop("ci_fp", None)
            done.append("CI 파일: 지운 채로 둠 (사용자 결정 -- 만들지 않기로 기억. 다시 켜려면 `hook install --ci`)")
        elif st.get("ci_fp") and not up("ci") and ci_explicit is not True:     # 전에 만든 것을 지웠다 -- 말없이 되살리지 않는다
            done.append(ASK + "CI 파일(.github/workflows/data-light.yml)을 지웠습니다 -- 사용자에게 물어보고: 다시 만들기 `hook install --ci` · "
                        "만들지 않기 `hook install --no-ci` (권장: 다시 만들기 -- GitHub 에 올릴 때 자동 검사)")
        else:
            wf.parent.mkdir(parents=True, exist_ok=True)
            _write(wf, CI)
            st["ci_fp"] = want
            done.append(".github/workflows/data-light.yml (GitHub 에 올릴 때 자동 검사)")
    else:
        cur = _fp(wf.read_text(encoding="utf-8", errors="replace"))
        if cur == want:
            st["ci_fp"] = want
        elif cur == st.get("ci_fp") or cur in _OLD_CI or up("ci"):
            if cur not in (st.get("ci_fp"), *_OLD_CI):
                bk = repo / ".data-light" / "backup" / dt.datetime.now().strftime("%Y%m%d-%H%M%S") / "data-light.yml"
                bk.parent.mkdir(parents=True, exist_ok=True)
                bk.write_bytes(wf.read_bytes())
                done.append(f"CI 파일: 직접 고친 것은 {bk.relative_to(repo).as_posix()} 에 남김 (사용자 결정)")
            _write(wf, CI)
            st["ci_fp"] = want
            st.pop("ci_keep", None)
            done.append(".github/workflows/data-light.yml 을 새 판으로 (GitHub 에 올릴 때 자동 검사)")
        elif kp("ci") or st.get("ci_keep") == cur:
            st["ci_keep"] = cur
            done.append("CI 파일: 직접 고친 것을 둠 (사용자 결정 -- 새 판과 다름)")
        else:
            done.append(ASK + "CI 파일(.github/workflows/data-light.yml)을 직접 고쳤습니다 -- 새 판과 다릅니다. 사용자에게 물어보고: "
                        "새 판으로 `hook install --update ci` (지금 것은 .data-light/backup/ 에) · 그대로 `hook install --keep ci` (권장: 새 판으로)")
    gi = repo / ".gitignore"
    try:
        have = gi.read_text(encoding="utf-8-sig").splitlines() if gi.exists() else []
    except UnicodeDecodeError:                 # 다른 인코딩에 UTF-8 을 덧붙이면 깨진다 -- 고치지 않고 묻는다
        done.append(ASK + ".gitignore 가 UTF-8 이 아니라 data-light 줄을 넣지 못했습니다 -- 실제 데이터 · 비밀 값이 올라갈 수 있습니다. "
                    "사용자에게 물어보고 .gitignore 를 UTF-8 로 저장한 뒤 다시 `hook install`")
        if st != _settings(repo):
            _write(repo / ".data-light" / "settings.json", json.dumps(st, ensure_ascii=False, indent=2) + "\n")
        return done
    rec = set(st.get("gitignore") or [])
    gone = [x for x in GITIGNORE_LINES if x in rec and x not in have]          # 전에 넣었는데 지운 줄 -- 말없이 되살리지 않는다
    if gone and not up("gitignore") and (kp("gitignore") or set(gone) <= set(st.get("gitignore_keep") or [])):
        st["gitignore_keep"] = sorted(gone)          # 지금 지운 줄 -- 이 가운데 몇 줄만 남아도 다시 묻지 않는다 (다시 넣은 줄을 또 지우면 묻는다)
        done.append(".gitignore: 지운 줄을 그대로 둠 (사용자 결정): " + ", ".join(gone))
        gone_ask = []
    else:
        gone_ask = [] if up("gitignore") else gone
    add = [x for x in GITIGNORE_LINES if x not in have and x not in gone_ask and (x not in rec or up("gitignore"))]
    if add:
        with open(gi, "a", encoding="utf-8") as f:
            f.write(("\n" if have and have[-1] else "") + "# data-light: 실제 데이터·가져오기 계획·비밀 값은 올리지 않는다\n"
                    + "\n".join(add) + "\n")
        done.append(".gitignore 에 " + ", ".join(add))
        if up("gitignore"):
            st.pop("gitignore_keep", None)
    if gone_ask:
        done.append(ASK + ".gitignore 에서 data-light 줄을 지웠습니다 (" + ", ".join(gone_ask) + ") -- 실제 데이터 · 비밀 값이 올라갈 수 있습니다. "
                    "사용자에게 물어보고: 다시 넣기 `hook install --update gitignore` · 그대로 `hook install --keep gitignore` (권장: 다시 넣기)")
    now = set(gi.read_text(encoding="utf-8-sig", errors="replace").splitlines()) if gi.exists() else set()
    st["gitignore"] = sorted(rec | {x for x in GITIGNORE_LINES if x in now})
    if st != _settings(repo):
        _write(repo / ".data-light" / "settings.json", json.dumps(st, ensure_ascii=False, indent=2) + "\n")
    return done


# ----------------------------------------------------------------- import
PI_HINT = [("name", r"이름|성명|성함|^name$|full_?name|(회원|고객|학생|사원|직원|담당자|신청자|보호자|환자|학부모|손님)명|대표자"), ("phone", r"전화|휴대|핸드폰|연락처|phone|mobile|tel"),
           ("email", r"이메일|메일|e-?mail"), ("address", r"주소|address|addr"), ("birth", r"생년|생일|birth"),
           ("id_number", r"주민|여권|면허번호|passport"), ("account", r"계좌|카드번호|account_no|card")]
NOT_PI = re.compile(r"상호|가게|업체|회사|기관|시설|상품|제품|도로명|소재지|대표전화|팩스")
# English column names in an existing DB (import schema) -- person words only, so dish_name / hotel are not flagged
SCHEMA_PI = [("name", r"(customer|member|user|student|employee|staff|patient|parent|guest|contact|full|person|real)_?name|^name$"),
             ("phone", r"phone|mobile|(^|_)tel($|_)"), ("email", r"e_?mail"), ("address", r"addr"),
             ("birth", r"birth|(^|_)dob($|_)"), ("id_number", r"ssn|passport|resident_?(no|num)"),
             ("account", r"account_?no|card_?no|bank_?account")]


def _read_table(path: str, sheet=None) -> tuple[list[str], list[list]]:
    p = path.lower()
    if p.endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook
        except ImportError:
            raise SystemExit("엑셀 파일은 openpyxl 이 필요합니다: pip install openpyxl (또는 csv 로 저장해서 넣으세요)")
        wb = load_workbook(path, read_only=True, data_only=True)
        ws = wb[sheet] if sheet else wb.worksheets[0]
        rows = [[("" if v is None else v) for v in r] for r in ws.iter_rows(values_only=True)]
        wb.close()
        rows = [r for r in rows if any(str(v).strip() for v in r)]
        return [str(h).strip() for h in rows[0]], rows[1:]
    with open(path, "rb") as f:
        raw = f.read()
    for enc in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:20000], delimiters=",\t;|")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(x.strip() for x in r)]
    return [h.strip() for h in rows[0]], rows[1:]


def _infer(values: list) -> str:
    vs = [str(v).strip() for v in values if str(v).strip() != ""][:5000]
    if not vs:
        return "text"
    if all(v.lower() in ("y", "n", "true", "false", "예", "아니오", "o", "x") for v in vs) and len({v.lower() for v in vs}) <= 2:
        return "bool"
    if all(re.fullmatch(r"-?\d+", v) for v in vs) and not any(len(v) > 1 and v.startswith("0") for v in vs):
        return "int"
    if all(re.fullmatch(r"-?[\d,]+(\.\d+)?", v) for v in vs):
        return "number"
    if all(re.fullmatch(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}", v) for v in vs):
        return "date"
    if all(re.fullmatch(r"\d{4}[-./]\d{1,2}[-./]\d{1,2}[ T]\d{1,2}:\d{2}(:\d{2})?", v) for v in vs):
        return "datetime"
    return "long_text" if max(len(v) for v in vs) > 200 else "text"


def _slug(h: str) -> str | None:
    s = re.sub(r"[^a-z0-9]+", "_", h.lower()).strip("_")
    return s if s and NAME.match(s) and s not in RESERVED else None


def _project_path(path: str) -> tuple[str, bool]:
    """path relative to the project (cwd), so plans and logs never carry the user's own folder names.
    returns (path_to_store, inside_project)"""
    # realpath on both sides: macOS temp folders are /var -> /private/var symlinks and Windows may give
    # 8.3 short names (RUNNER~1) for one side only -- without this the path looked "outside" and lost its folder
    ab = Path(os.path.abspath(path))
    home = os.path.normcase(os.path.realpath(os.getcwd()))
    # the nearest folder of the path (as written) that IS the project folder once resolved -- so a link folder inside the
    # project keeps its name, and /var vs /private/var (macOS) or RUNNER~1 vs runneradmin (Windows) still match
    for anc in ab.parents:
        if os.path.normcase(os.path.realpath(anc)) == home:
            return ab.relative_to(anc).as_posix(), True
    try:
        rel = os.path.relpath(os.path.realpath(ab), home)
    except ValueError:                         # another drive on Windows
        return ab.name, False
    if rel.startswith(".."):
        return ab.name, False
    return Path(rel).as_posix(), True


def import_plan(path: str, table: str, label: str | None = None, sheet=None) -> dict:
    if not NAME.match(table) or table in RESERVED:
        raise SystemExit(f"--table '{table}': 영문 소문자·숫자·밑줄, 예약어 아님")
    head, rows = _read_table(path, sheet)
    cols = []
    for i, h in enumerate(head):
        vals = [r[i] if i < len(r) else "" for r in rows]
        ty = _infer(vals)
        if ty == "number" and re.search(r"금액|가격|원$|비용|매출|회비|요금|급여|price|amount|fee", h, re.I):
            ty = "money"
        pk = None
        if not NOT_PI.search(h):
            pk = next((k for k, rx in PI_HINT if re.search(rx, h, re.I)), None)
        filled = sum(1 for v in vals if str(v).strip())
        cols.append({"src": h, "name": _slug(h), "label": h, "type": ty,
                     "required": bool(rows) and filled == len(rows), "personal": pk,
                     "samples": ["(개인정보 -- 가림)"] if pk else [str(v) for v in vals[:3]]})
    stored, inside = _project_path(path)
    notes = []
    if not inside:
        notes.append("원본 파일이 프로젝트 밖에 있어 경로 대신 파일 이름만 적었습니다 -- apply 때 --file 로 위치를 알려 주세요")
    return {"format": "data-light-import/1", "file": stored, "sheet": sheet, "table": table,
            "label": label or Path(path).stem, "rows": len(rows), "columns": cols, "approved": False,
            "notes": notes + [
                      "이 계획 파일에는 원본의 실제 값 일부가 들어 있습니다 -- 저장소에 올리지 않습니다 (.gitignore: data/import_plan*.json)",
                      "name 이 null 인 칸은 영문 이름을 정해 채웁니다 (영문 소문자·숫자·밑줄)",
                      "personal 은 개인정보 종류 -- 아니면 null. 개인정보 칸은 pi_ 테이블로 따로 저장됩니다",
                      "사용자 확인 후 approved 를 true 로 바꾸고 import apply 에 사용자 답을 그대로 --approval 로 넘깁니다"]}


def _conv(ty: str, v):
    s = str(v).strip() if v is not None else ""
    if s == "":
        return None
    if ty in ("int",):
        return int(s.replace(",", ""))
    if ty in ("number", "money"):
        return float(s.replace(",", ""))
    if ty == "bool":
        return 1 if s.lower() in ("y", "true", "예", "o", "1") else 0
    if ty == "date":
        y, m, d = re.split(r"[-./]", s)[:3]
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    return s


def import_apply(plan: dict, model_path: str, db_path: str, approval: str, append: bool = False,
                 file: str | None = None, force_sqlite: bool = False) -> dict:
    if not plan.get("approved"):
        raise SystemExit("approved 가 false 입니다 -- 사용자에게 계획을 보여 주고 확인받은 뒤 true 로 바꾸세요")
    if not (approval or "").strip():
        raise SystemExit("--approval 에 사용자 답을 그대로 넣어 주세요 (확인 기록으로 남습니다)")
    miss = [c["src"] for c in plan["columns"] if not c.get("skip") and not c.get("name")]
    if miss:
        raise SystemExit(f"영문 이름이 없는 칸: {miss}")
    model = load(model_path) if os.path.exists(model_path) else {"format": FORMAT, "project": Path(model_path).parent.name, "db": "sqlite", "tables": []}
    if model.get("db", "sqlite") != "sqlite" and not force_sqlite:
        raise SystemExit("이 정본은 PostgreSQL(Supabase) 용입니다 -- 실제 값이 내 컴퓨터의 SQLite 파일로 남지 않도록 멈춥니다.\n"
                         "Supabase 에는 Table Editor 의 CSV 가져오기로 넣습니다 (개인정보 칸은 pi_ 표로 나눠서). "
                         "그래도 SQLite 에 넣으려면 --force-sqlite")
    src = file or plan["file"]
    if not os.path.exists(src):
        raise SystemExit(f"원본 파일을 찾지 못했습니다: {src} -- 프로젝트 맨 위 폴더에서 실행하거나 --file 로 알려 주세요")
    tn = plan["table"]
    if os.path.exists(db_path) and not append:             # stop before any backup / model change
        con = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
        try:
            if con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (tn,)).fetchone():
                have = con.execute(f'SELECT count(*) FROM "{tn}"').fetchone()[0]
                if have:
                    raise SystemExit(f"{tn} 에 이미 {have}행이 있습니다 -- 같은 파일을 두 번 넣지 않도록 멈춥니다. 더하려면 --append")
        finally:
            con.close()
    use = [c for c in plan["columns"] if not c.get("skip")]
    if tn not in tables(model):
        t = {"name": tn, "label": plan.get("label") or tn, "about": f"{Path(plan['file']).name} 에서 가져옴",
             "columns": [{"name": f"{tn}_id", "label": "번호", "type": "id"}]}
        for c in use:
            col = {"name": c["name"], "label": c.get("label") or c["src"], "type": c["type"]}
            if c.get("required"):
                col["required"] = True
            if c.get("personal"):
                col["personal"] = c["personal"]
            t["columns"].append(col)
        model["tables"].append(t)
        split(model)
        errs, _ = check(model)
        if errs:
            raise SystemExit("가져올 테이블 설계에 문제가 있습니다:\n- " + "\n- ".join(errs))
        save(model, model_path)
        created = True
    else:
        created = False
    tb = tables(model)
    main, pi = tb[tn], tb.get("pi_" + tn)
    main_cols = {c["name"] for c in main["columns"]}
    pi_cols = {c["name"] for c in pi["columns"]} if pi else set()
    missing = [c["name"] for c in use if c["name"] not in main_cols | pi_cols]
    if missing:
        raise SystemExit(f"{tn} 에 없는 칸: {missing} -- 정본에 칸을 더하는 것은 설계를 고친 뒤에")
    backup = None
    if os.path.exists(db_path) and os.path.getsize(db_path):
        bdir = Path(db_path).parent / "backup"
        bdir.mkdir(exist_ok=True)
        backup = bdir / f"{Path(db_path).stem}-{dt.datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
        bsrc, bdst = sqlite3.connect(db_path), sqlite3.connect(backup)
        try:
            bsrc.backup(bdst)
        finally:
            bsrc.close()
            bdst.close()
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = ON")
    try:
        exists = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        todo = {t["name"] for t in model["tables"]} - exists
        if todo:
            con.executescript(ddl(model, "sqlite", only=todo))
        head, rows = _read_table(src, plan.get("sheet"))
        idx = {h: i for i, h in enumerate(head)}
        idc = id_column(model, tn)
        bad, n = 0, 0
        with con:
            for r in rows:
                mrow, prow = {}, {}
                for c in use:
                    v = r[idx[c["src"]]] if idx.get(c["src"], 10 ** 9) < len(r) else None
                    try:
                        v = _conv(c["type"], v)
                    except (ValueError, TypeError):
                        bad += 1
                        v = None
                    (prow if c["name"] in pi_cols else mrow)[c["name"]] = v
                cur = con.execute(f"INSERT INTO {tn} ({', '.join(mrow) or idc}) VALUES ({', '.join('?' * len(mrow)) or 'NULL'})",
                                  list(mrow.values()))
                if pi and prow:
                    prow[idc] = cur.lastrowid
                    con.execute(f"INSERT INTO pi_{tn} ({', '.join(prow)}) VALUES ({', '.join('?' * len(prow))})", list(prow.values()))
                n += 1
    finally:
        con.close()
    log = {"at": dt.datetime.now().isoformat(timespec="seconds"), "file": _project_path(file or plan["file"])[0],
           "table": tn, "rows": n,
           "bad_values": bad, "created_table": created, "personal_to": f"pi_{tn}" if pi else None, "backup": _project_path(str(backup))[0] if backup else None,
           "approval": approval.strip()}
    with open(Path(model_path).parent / "import_log.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(log, ensure_ascii=False) + "\n")
    return log


# ----------------------------------------------------------------- import schema (existing SQLite DB -> draft model)
def _light_type(decl: str) -> str:
    d = (decl or "").upper()
    if "BOOL" in d:
        return "bool"
    if "DATETIME" in d or "TIMESTAMP" in d:
        return "datetime"
    if "DATE" in d:
        return "date"
    if "INT" in d:
        return "int"
    if any(k in d for k in ("REAL", "FLOA", "DOUB", "NUMERIC", "DECIMAL")):
        return "number"
    return "text"


def schema_to_model(db_path) -> tuple[dict, list[str]]:
    """read tables / keys / references / NOT NULL / UNIQUE from SQLite. labels stay empty for a person to fill"""
    con = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    issues, out = [], []
    od = {"CASCADE": "delete", "SET NULL": "clear"}
    try:
        names = [r[0] for r in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        for tn in names:
            create = con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (tn,)).fetchone()[0] or ""
            info = con.execute(f'PRAGMA table_info("{tn}")').fetchall()      # cid, name, type, notnull, dflt, pk
            fks = {r[3]: r for r in con.execute(f'PRAGMA foreign_key_list("{tn}")')}  # from -> (id,seq,table,from,to,upd,del,match)
            single_uq = set()
            combos = []
            for ix in con.execute(f'PRAGMA index_list("{tn}")'):            # seq, name, unique, origin, partial
                if ix[2] and ix[3] in ("u", "c"):
                    cols = [r[2] for r in con.execute(f'PRAGMA index_info("{ix[1]}")')]
                    (single_uq.update(cols) if len(cols) == 1 else combos.append(cols))
            pks = [r for r in info if r[5]]
            cols = []
            names_here = {r[1] for r in info}
            for cid, cn, decl, notnull, dflt, pk in info:
                if cn in ("created_at", "updated_at"):
                    continue
                col = {"name": cn, "label": ""}
                if pk and len(pks) == 1 and "INT" in (decl or "").upper() and cn not in fks:
                    col["type"] = "id"
                elif cn in fks:
                    f = fks[cn]
                    col.update({"type": "ref", "ref": f[2]})
                    if od.get(f[6]):
                        col["on_delete"] = od[f[6]]
                    if pk:
                        col["key"] = True
                    elif notnull:
                        col["required"] = True
                else:
                    col["type"] = _light_type(decl)
                    # SQLite keeps no date/bool/money types -- recover them from CHECK rules and names
                    q = rf'"?{re.escape(cn)}"?'
                    m_in = re.search(rf"CHECK\s*\(\s*{q}\s+IN\s*\(([^)]*)\)\s*\)", create, re.I)
                    if m_in:
                        vals = [v.strip().strip("'\"") for v in m_in.group(1).split(",")]
                        if col["type"] == "int" and sorted(vals) == ["0", "1"]:
                            col["type"] = "bool"
                        else:
                            col["choices"] = [int(v) if col["type"] == "int" and re.fullmatch(r"-?\d+", v) else v for v in vals]
                            if col["type"] not in ("int",):
                                col["type"] = "text"
                    elif re.search(rf"CHECK\s*\(\s*{q}\s*>=\s*0\s*\)", create, re.I) and col["type"] == "number":
                        col["type"] = "money"
                    elif col["type"] == "text" and re.search(r"(^|_)date$|_on$|_day$", cn):
                        col["type"] = "date"
                    elif col["type"] == "text" and re.search(r"_at$|_time$", cn):
                        col["type"] = "datetime"
                    if notnull or pk:
                        col["required"] = True
                    if pk and len(pks) > 1:
                        issues.append(f"{tn}.{cn}: 여러 칸으로 된 키는 다른 표를 가리키는 칸(ref)만 지원 -- 설계를 사람이 확인")
                if cn in single_uq and col["type"] != "id":
                    col["unique"] = True
                if dflt is not None and col["type"] not in ("id", "ref"):
                    v = dflt.strip("'\"")
                    if re.fullmatch(r"-?\d+(\.\d+)?", v):
                        v = float(v) if "." in v else int(v)
                    if col["type"] == "bool" and v in (0, 1):
                        v = bool(v)
                    if not (isinstance(v, str) and v.upper().startswith("CURRENT_")):
                        col["default"] = v
                cols.append(col)
            t = {"name": tn, "label": "", "columns": cols}
            if not ({"created_at", "updated_at"} <= names_here):
                t["timestamps"] = False
            if combos:
                t["unique"] = combos
            if not pks:
                issues.append(f"{tn}: 행을 구별할 키(PRIMARY KEY)가 없습니다 -- {tn}_id 를 더할지 사람이 정함")
            out.append(t)
    finally:
        con.close()
    for t in out:
        for c in t["columns"]:
            if c["type"] in ("text", "long_text", "date") and not NOT_PI.search(c["name"]):
                hints = SCHEMA_PI + (PI_HINT if re.search(r"[^\x00-\x7f]", c["name"]) else [])   # Korean hints only for Korean names
                k = next((k for k, rx in hints if re.search(rx, c["name"], re.I)), None)
                if t["name"].startswith("pi_"):          # already a personal-info table: mark every value column
                    c["personal"] = k or True
                elif k:
                    issues.append(f"{t['name']}.{c['name']}: 개인정보({k})로 보입니다 -- 맞으면 \"personal\": \"{k}\" 표시 후 split")
        bad = [t["name"]] if (not NAME.match(t["name"]) or t["name"] in RESERVED) else []
        bad += [f"{t['name']}.{c['name']}" for c in t["columns"] if not NAME.match(c["name"]) or c["name"] in RESERVED]
        for b in bad:
            issues.append(f"{b}: 이름이 규칙(영어 소문자·숫자·밑줄, 예약어 아님)에 맞지 않습니다 -- 바꾸려면 DB 도 함께 바꿔야 하니 사람이 결정")
    model = {"format": FORMAT, "project": Path(db_path).stem, "db": "sqlite",
             "goals": [], "not_doing": [], "tables": out}
    return model, issues


# ----------------------------------------------------------------- upgrade (to the full framework)
CLASS_TOKENS = {"id", "no", "nm", "cd", "yn", "at", "dt", "amt", "cnt", "val"}


def upgrade_facts(model: dict) -> dict | None:
    """product → the full framework's question ledger (data/facts.json): data.product_type / data.product_primary, source user"""
    p = model.get("product")
    if not isinstance(p, dict) or product_errors(model):
        return None
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    said = str(p["said"]).strip()
    base = {"source": "user", "quote": said, "asked_by": "data", "stage": "data_plan", "at": now}
    facts = {"data.product_type": dict(base, version=1, value=[PRODUCT_KINDS[k][1] for k in p["kinds"]])}
    if len(p["kinds"]) > 1 and str(p.get("main_said") or "").strip():
        # 주 목적은 사용자가 따로 말했을 때만 옮긴다 -- 없으면 전문판에서 data.product_primary 를 묻는다
        facts["data.product_primary"] = dict(base, version=1, value=PRODUCT_KINDS[product_main(model)][1],
                                             quote=str(p["main_said"]).strip(), derived_from=["data.product_type@1"])
    return {"facts_version": "1", "facts": facts, "history": []}


def upgrade_blueprint(model: dict) -> dict:
    """works → 전문판 시스템 청사진(blueprint.json)의 시작점: 역할(누가) · 화면 · 기능(하는 일). 업무 단계·요청·API 는 전문판에서 사용자와 정리한다."""
    works = [w for w in model.get("works") or [] if isinstance(w, dict) and w.get("name")]
    who = []
    for w in works:
        if w.get("who") and str(w["who"]) not in who:
            who.append(str(w["who"]))
    rid = {name: f"role-{i}" for i, name in enumerate(who, 1)}
    scr_names = []
    for w in works:
        for sname in (w.get("screen") if isinstance(w.get("screen"), list) else [w.get("screen")]):
            if sname and str(sname) not in scr_names:
                scr_names.append(str(sname))
    sid = {name: f"S-{i}" for i, name in enumerate(scr_names, 1)}
    screens = []
    for name in scr_names:
        users = [rid[str(w["who"])] for w in works if w.get("who") and name in (w.get("screen") if isinstance(w.get("screen"), list) else [w.get("screen")])]
        screens.append({"id": sid[name], "name": name, "for": list(dict.fromkeys(users)), "purpose": "", "origin": "user"})
    feats = []
    for i, w in enumerate(works, 1):
        sc = w.get("screen") if isinstance(w.get("screen"), list) else [w.get("screen")]
        uses = "; ".join(f"{t} {_ops(o)}" for t, o in (w.get("uses") or {}).items())
        feats.append({"id": f"F-{i}", "name": str(w["name"]), "description": " -- ".join(x for x in (str(w.get("say") or ""), f"쓰는 표: {uses}" if uses else "") if x),
                      "screens": [sid[str(x)] for x in sc if x], "apis": [], "jobs": [], "status": "designed", "origin": "user"})
    p = model.get("product") if isinstance(model.get("product"), dict) else {}
    return {"blueprint_version": "1",
            "system": {"name": model.get("project") or "", "summary": str(p.get("said") or ""), "problem": "",
                       "roles": [{"id": rid[n], "name": n} for n in who], "deliverables": [], "origin": "user",
                       "constraints": [f"만들지 않을 것: {x}" for x in model.get("not_doing") or []]},
            "requirements": [], "processes": [], "features": feats, "screens": screens, "implementation": {},
            "_from": "data-light upgrade -- 업무 단계·요청·화면이 보여 주는 정보·API 는 전문판에서 사용자와 정리한다 (systembook.py check 가 빈칸으로 보인다)"}


def upgrade(model: dict, schema: str = "app", pi_schema: str | None = None) -> dict:
    """light model → data-expert-framework model.json (passes its check_dictionary / export_all)"""
    errs, _ = check(model)
    if errs:
        raise SystemExit("먼저 check 오류를 고치세요:\n- " + "\n- ".join(errs))
    ty_dom = {"id": ("식별자", "bigint", None), "ref": ("식별자", "bigint", None), "text": ("문자", "text", None),
              "long_text": ("긴글", "text", None), "int": ("정수", "integer", None), "number": ("숫자", "numeric", None),
              "money": ("금액", "numeric(15,2)", ">= 0"), "bool": ("여부", "boolean", None), "date": ("일자", "date", None),
              "datetime": ("시각", "timestamptz", None), "owner": ("사용자ID", "uuid", None)}
    domains: dict[str, dict] = {}

    def dom_of(t, c):
        if c.get("choices"):
            nm = f"선택:{t['name']}.{c['name']}"[:50]
            base = "text" if c["type"] == "text" else "integer"
            domains.setdefault(nm, {"name": nm, "type": base, "check": "IN (" + ", ".join(_q(x) for x in c["choices"]) + ")",
                                    "example": str(c["choices"][0]), "desc": f"{c.get('label', c['name'])} 선택값"})
            return nm
        nm, typ, chk = ty_dom[c["type"]]
        domains.setdefault(nm, {"name": nm, "type": typ, "check": chk, "example": "", "desc": TYPE_KO[c["type"]]})
        return nm

    tbl_out, rels, terms, kor_used = [], [], {}, set()
    tokens: dict[str, None] = {}

    def term(phys, kor, domain, desc):
        if phys in terms:
            return
        k = kor or phys
        if k in kor_used:
            k = f"{k}({phys})"
        kor_used.add(k)
        terms[phys] = {"kor": k, "phys": phys, "word_path": ">".join(phys.split("_")), "domain": domain, "desc": desc or None}
        for tok in phys.split("_"):
            tokens[tok] = None

    for t in ordered(model):
        keys = key_columns(t)
        refs = [c for c in t["columns"] if c["type"] == "ref"]
        kind = "PI" if t["name"].startswith("pi_") else ("거래" if len(refs) >= 2 else "기준")
        cols = []
        for c in all_columns(t):
            d = dom_of(t, c)
            col = {"name": c["name"], "kor": c.get("label") or c["name"], "domain": d,
                   "nullable": not (c.get("required") or c.get("key") or c["type"] in ("id", "owner") or c.get("auto"))}
            if c["name"] in {k["name"] for k in keys}:
                col["pk"] = True
            if c["type"] == "id":
                col["identity"] = True
            if c.get("unique"):
                col["unique"] = True
            if c.get("auto"):
                col["default"] = "now()"
            elif "default" in c:
                col["default"] = _q(c["default"])
            if c["type"] == "ref":
                col["fk"] = {"table": c["ref"], "column": id_column(model, c["ref"]), "on_delete": ON_DELETE[c.get("on_delete", "keep")]}
                rels.append({"from": t["name"], "from_col": c["name"], "to": c["ref"], "to_col": col["fk"]["column"],
                             "type": "1:1" if c.get("key") and len(keys) == 1 else "N:1", "optional": col["nullable"],
                             "on_delete": col["fk"]["on_delete"], "meaning": c.get("label") or c["name"]})
            if c.get("personal"):
                col["pi"] = True
                col["pi_type"] = c["personal"] if isinstance(c["personal"], str) else "개인정보"
            if c.get("about"):
                col["description"] = c["about"]
            cols.append(col)
            term(c["name"], c.get("label"), d, c.get("about"))
        tt = {"name": t["name"], "kor": t.get("label") or t["name"], "kind": kind, "is_pi": t["name"].startswith("pi_"),
              "description": t.get("about") or (t.get("label") or t["name"]), "columns": cols}
        if t.get("unique"):
            tt["uniques"] = [list(u) for u in t["unique"]]
        tbl_out.append(tt)
        term(t["name"], t.get("label"), None, t.get("about"))
    words = [{"kor": tok, "abbr": tok, "full": tok, "is_class": tok in CLASS_TOKENS,
              "desc": "data-light 에서 자동 생성 -- 한글 단어·약어는 공통 사전 대조 때 정한다"} for tok in tokens]
    full = {"project": model.get("project", "data-light project"), "version": "1.0",
            "generated_at": dt.date.today().isoformat(), "db": "postgresql", "db_version": "16",
            "schema": schema, "meta_schema": "meta", "modeling_tool": "pgModeler 1.1",
            "assumptions": [f"data-expert-framework-light ({FORMAT}) 에서 upgrade 로 변환"],
            "open_questions": ["단어(words)의 한글명·약어를 공통 사전(bomiyang-glossary)과 대조해 정리"],
            "words": words, "domains": list(domains.values()), "terms": list(terms.values()),
            "tables": tbl_out, "relationships": rels,
            "pi_suggestions": ["개인정보 칸은 pi_ 테이블에 있음 -- 전문판에서 pi 스키마·암호화(crypto) 적용 검토"],
            "dq_notes": ["light 검사(키·참조·필수·선택값·금액 음수 금지) 통과 상태에서 변환"]}
    if model.get("goals"):
        full["success_goals"] = model["goals"]
        full["dq_notes"].append("성공 기준(success_goals) " + str(len(model["goals"])) + "개 -- 전문판 스모크 테스트로 옮겨 실제 Postgres 에서도 확인")
    if any(c.get("type") == "owner" for t in model["tables"] for c in t["columns"]):
        full["assumptions"].append("owner 칸(로그인한 사람, uuid): Supabase 에서는 DEFAULT auth.uid() -- 전문판의 인증 방식에 맞춰 기본값을 정함")
    if any(t.get("access") for t in model["tables"]):
        full["assumptions"].append("표의 access(members·own·read) 는 Supabase RLS 규칙 -- 전문판의 등급×분류 권한으로 옮길 때 다시 설계: "
                                   + ", ".join(f"{t['name']}={t['access']}" for t in model["tables"] if t.get("access")))
    if model.get("not_doing"):
        full["assumptions"].append("이번 범위 밖(만들지 않음): " + ", ".join(map(str, model["not_doing"])))
    if pi_schema:
        full["pi_schema"] = pi_schema
    return full


# ----------------------------------------------------------------- cli
# ----------------------------------------------------------------- site (개발 관리 사이트 -- 가벼운 판, 파일로 연다)
SITE_SHELL = Path(__file__).resolve().parents[1] / "site" / "shell"          # 전문판 화면 틀의 MIT 사본 (site/shell.lock.json)
SITE_PAGES = (("overview", 1, "개요", ""), ("business", 2, "업무 설명", "business/"), ("data", 4, "ERD · 데이터 설계", "data/"),
              ("progress", 9, "진행 상황", "progress/"), ("files", 10, "파일", "files/"))      # 사양 v1.1 의 가벼운 판 5쪽 (번호·주소는 전문판과 같다)
SITE_READ = {"overview": "무엇을 만드는지, 알고 싶은 것(성공 기준), 지금 할 일을 한 화면에 봅니다.",
             "business": "이 데이터를 쓰는 일(누가 · 어느 화면에서 · 어느 표를)과 일 × 표 연결을 봅니다.",
             "data": "표마다 한 줄이 무엇인지, 어떤 칸이 있는지, 실제로 어떤 값이 들어가는지(만든 예시 값)를 봅니다. 그림은 표 사이의 연결입니다.",
             "progress": "검사 결과 · 알고 싶은 것 · 만든 파일이 정본과 같은지 -- 어디까지 됐고 무엇이 남았는지 봅니다.",
             "files": "이 사이트를 만든 재료(정본)와 거기서 만든 파일을 봅니다. 사이트는 보기만 합니다 -- 고칠 때는 정본을 고칩니다."}


def _sha12(b: bytes) -> str:
    import hashlib
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()[:12]


def site_root(model_path) -> Path:
    """정본이 data/ 안이면 그 위가 프로젝트 뿌리."""
    mp = Path(model_path).resolve()
    return mp.parent.parent if mp.parent.name == "data" else mp.parent


def site_pages(model: dict, model_path, mark: str, now: str, *, framework: str = "data-light", framework_version: str | None = None) -> dict:
    """가벼운 판 5쪽의 쪽 JSON (사양 outputs_version 1 의 머리 + body.sections).
    dev-process-light 는 framework="dev-light" 로 불러 2 업무 설명 · 4 데이터를 쓰고 1 · 9 · 10 은 기록에서 만든다."""
    root = site_root(model_path)
    mp = Path(model_path).resolve()
    try:
        rel = mp.relative_to(root).as_posix()
    except ValueError:
        rel = mp.name
    src = [{"path": rel, "fingerprint": _sha12(mp.read_bytes()), "label": "정본", "missing": False}]
    T = tables(model)
    works = [w for w in model.get("works") or [] if isinstance(w, dict) and w.get("name")]
    goals = [g for g in model.get("goals") or [] if isinstance(g, dict)]
    lab = lambda n: (T.get(n) or {}).get("label") or n  # noqa: E731

    def chip(t, href=None, kind=None):
        return {"_": mark, "chip": True, "t": str(t), "href": href, "kind": kind}

    def badge(t, tone=""):
        return {"_": mark, "badge": True, "t": str(t), "tone": tone}

    def mono(t):
        return {"_": mark, "t": str(t), "mono": True}

    def tref(n):
        return chip(lab(n), "data/#t-" + n if n in T else None)

    def page(pid, secs, *, blanks=None, title=None, subtitle=None, sources=None, wide=False):
        return site_page(pid, secs, framework=framework, framework_version=framework_version or __version__, mark=mark, now=now,
                         source=src if sources is None else sources, blanks=blanks, title=title, subtitle=subtitle, wide=wide)
    out = {}
    errs, warns = check(model)
    # 1 개요
    prod = model.get("product") if isinstance(model.get("product"), dict) else {}
    main = product_main(model) if prod.get("kinds") else None
    blank1 = ([] if prod.get("kinds") else ["무엇을 만드는지(product) -- 사용자에게 묻고 한 말 그대로"]) + ([] if goals else ["알고 싶은 것(goals) -- 확인 쿼리로"])
    todo = [{"text": "고칠 것: " + e, "tone": "bad", "href": "progress/#check"} for e in errs] + [{"text": b, "tone": "warn"} for b in blank1]
    secs = [{"kind": "todo", "id": "todo", "title": "지금 할 일", "items": todo, "empty": "지금 고칠 것이 없습니다"}]
    kv = [["만드는 것", (PRODUCT_KINDS.get(main, (main,))[0] if main else UNDETERMINED)]]
    if prod.get("said"):
        kv.append(["사용자가 한 말", "“" + str(prod["said"]) + "”"])
    if model.get("not_doing"):
        kv.append(["이번에 만들지 않을 것", ", ".join(map(str, model["not_doing"]))])
    secs.append({"kind": "kv", "id": "system", "title": "이 시스템", "items": kv})
    secs.append({"kind": "list", "id": "goals", "title": "알고 싶은 것", "count": len(goals), "items": [str(g.get("say") or "") for g in goals],
                 "empty": "아직 없습니다 -- '이 데이터로 무엇을 알 수 있어야 하나요?'"})
    secs.append({"kind": "cards", "id": "counts", "title": "한눈에", "items": [
        {"label": "하는 일", "value": len(works), "href": "business/"}, {"label": "표", "value": len(T), "href": "data/"},
        {"label": "고칠 것", "value": len(errs), "href": "progress/#check", "tone": "bad" if errs else "ok"},
        {"label": "참고", "value": len(warns), "href": "progress/#check"}]})
    out["overview"] = page("overview", secs, blanks=blank1, title=str(model.get("project") or "개요"), subtitle="개요")
    # 2 업무 설명
    secs = []
    if works:
        secs.append({"kind": "table", "id": "works", "title": "하는 일", "count": len(works),
                     "columns": [{"key": "name", "label": "일"}, {"key": "who", "label": "누가", "nw": True}, {"key": "screen", "label": "화면"},
                                 {"key": "uses", "label": "쓰는 표"}],
                     "rows": [{"_id": "w-" + str(i + 1), "name": {"_": mark, "t": str(w["name"]), "sub": str(w.get("say")) if w.get("say") else None},
                               "who": str(w.get("who") or "") or None,
                               "screen": ", ".join(map(str, w["screen"])) if isinstance(w.get("screen"), list) else (str(w.get("screen")) if w.get("screen") else None),
                               "uses": [tref(tn) for tn in (w.get("uses") or {})]} for i, w in enumerate(works)]})
        cols = [n for n in (t["name"] for t in ordered(model)) if any(n in (w.get("uses") or {}) for w in works)]
        secs.append({"kind": "matrix", "id": "crud", "title": "일 × 표", "corner": "하는 일",
                     "lead": "일마다 어느 표를 만들고(C) 읽고(R) 고치고(U) 지우는지(D).",
                     "cols": [{"key": n, "label": lab(n), "sub": n, "href": "data/#t-" + n} for n in cols],
                     "rows": [{"label": str(w["name"]), "sub": str(w.get("who")) if w.get("who") else None,
                               "cells": {tn: "".join(o for o in "CRUD" if o in str(ops).upper()) for tn, ops in (w.get("uses") or {}).items()}} for w in works]})
        who = sorted({str(w.get("who")) for w in works if w.get("who")})
        secs.append({"kind": "list", "id": "roles", "title": "누가", "items": who, "empty": "누가 하는지 적혀 있지 않습니다"})
    else:
        secs.append({"kind": "empty", "id": "works", "title": "하는 일", "why": "하는 일(works)이 적혀 있지 않습니다 -- 표마다 왜 있고 누가 쓰는지가 여기서 나옵니다.",
                     "how": ["이 데이터를 쓰는 일 3~7개를 묻는다 (누가 · 어느 화면에서 · 어느 표를)", "정본의 works 에 적는다"], "cmd": None})
    unused = [t["name"] for t in T.values() if works and not t["name"].startswith("pi_") and not any(t["name"] in (w.get("uses") or {}) for w in works)]
    out["business"] = page("business", secs, blanks=(["하는 일(works)"] if not works else []) + [f"{lab(n)} 을 쓰는 일이 없다" for n in unused])
    # 4 데이터
    secs = []
    tb = ordered(model)
    nodes, edges, depth = [], [], {}
    for t in tb:
        refs = [c.get("ref") for c in t["columns"] if c.get("type") == "ref" and c.get("ref") in T and c.get("ref") != t["name"]]
        depth[t["name"]] = 1 + max([depth.get(r, 0) for r in refs] or [-1])
        nodes.append({"id": t["name"], "col": str(depth[t["name"]]), "label": lab(t["name"]), "sub": t["name"], "href": "#t-" + t["name"],
                      "cls": "ext" if t["name"].startswith("pi_") else None})
        edges += [{"from": t["name"], "to": r, "label": "가리킴"} for r in dict.fromkeys(refs)]
    if nodes:
        secs.append({"kind": "diagram", "id": "erd", "title": "표 사이 연결", "lead": "화살표는 '이 표의 한 줄이 저 표의 한 줄을 가리킨다'. 개인정보 짝 표는 점선 상자. 상자를 누르면 그 표로.",
                     "cols": [{"id": str(i), "label": "기본 표" if i == 0 else f"{i}단계"} for i in range(max(depth.values()) + 1)],
                     "nodes": nodes, "edges": edges, "w": 190})
    secs.append({"kind": "table", "id": "tables", "title": "표", "count": len(tb), "empty": "표가 없습니다",
                 "columns": [{"key": "name", "label": "표"}, {"key": "about", "label": "한 줄은"}, {"key": "cols", "label": "칸", "num": True},
                             {"key": "pi", "label": "개인정보", "nw": True}, {"key": "sample", "label": "예시", "num": True}],
                 "rows": [{"name": chip(lab(t["name"]), "#t-" + t["name"]), "about": str(t.get("about")) if t.get("about") else None,
                           "cols": len(all_columns(t)), "pi": badge("짝 표" if t["name"].startswith("pi_") else "있음", "bad")
                           if t["name"].startswith("pi_") or any(c.get("personal") for c in t["columns"]) else "없음",
                           "sample": len(t.get("sample") or [])} for t in tb]})
    blank4 = []
    for t in tb:
        keys = {k["name"] for k in key_columns(t)}
        rows = []
        for c in all_columns(t):
            rule = []
            if c.get("required") or c["name"] in keys:
                rule.append("꼭 채움")
            if c.get("unique"):
                rule.append("같은 값 두 번 금지")
            if c.get("choices"):
                rule.append("고르기: " + "/".join(map(str, c["choices"])))
            if c.get("auto"):
                rule.append("자동")
            if c.get("type") == "ref":
                rule.append("→ " + lab(c.get("ref")))
            rows.append({"col": {"_": mark, "t": str(c.get("label") or c["name"]), "sub": c["name"]}, "type": TYPE_KO.get(c["type"], c["type"]),
                         "about": str(c.get("about")) if c.get("about") else None, "rule": ", ".join(rule) or None,
                         "pi": badge("개인정보", "bad") if c.get("personal") else None})
        secs.append({"kind": "table", "id": "t-" + t["name"], "title": f"{lab(t['name'])} ({t['name']})", "lead": str(t.get("about")) if t.get("about") else None,
                     "columns": [{"key": "col", "label": "칸"}, {"key": "type", "label": "종류", "nw": True}, {"key": "about", "label": "뜻"},
                                 {"key": "rule", "label": "규칙"}, {"key": "pi", "label": "", "nw": True, "quiet": True}], "rows": rows})
        sample = t.get("sample") or []
        if sample:
            cols = [c for c in all_columns(t) if not c.get("auto")]
            secs.append({"kind": "table", "id": "s-" + t["name"], "title": f"{lab(t['name'])} -- 예시 (만든 값)", "count": len(sample),
                         "columns": [{"key": c["name"], "label": str(c.get("label") or c["name"])} for c in cols],
                         "rows": [{c["name"]: (None if r.get(c["name"]) is None else str(_cellv(c, r.get(c["name"])))) for c in cols} for r in sample if isinstance(r, dict)]})
        else:
            blank4.append(f"{lab(t['name'])} 의 예시 값 (sample)")
        if not t.get("about"):
            blank4.append(f"{lab(t['name'])} 의 한 줄 설명 (about)")
    out["data"] = page("data", secs, blanks=blank4, wide=True)
    # 9 진행 상황
    od = mp.parent / "out"
    stale = stale_outputs(model, od)
    secs = [{"kind": "cards", "id": "summary", "items": [
        {"label": "고칠 것", "value": len(errs), "tone": "bad" if errs else "ok", "href": "#check"}, {"label": "참고", "value": len(warns), "href": "#check"},
        {"label": "알고 싶은 것", "value": len(goals), "tone": "ok" if goals else "warn"},
        {"label": "낡은 설명서·SQL", "value": len(stale), "tone": "bad" if stale else "ok", "href": "files/"}]}]
    secs.append({"kind": "list", "id": "check", "title": "검사 (check)", "count": len(errs) + len(warns),
                 "items": [{"text": e, "badge": "고칠 것", "tone": "bad"} for e in errs] + [{"text": w, "badge": "참고"} for w in warns],
                 "empty": "고칠 것이 없습니다 -- 좋아요!"})
    secs.append({"kind": "table", "id": "goals", "title": "알고 싶은 것과 확인 쿼리", "count": len(goals), "empty": "알고 싶은 것(goals)이 없습니다",
                 "lead": "try · verify 가 예시 값으로 실제로 돌려 봅니다: python datalight.py verify data/model.light.json",
                 "columns": [{"key": "say", "label": "알고 싶은 것"}, {"key": "sql", "label": "확인 쿼리"}, {"key": "expect", "label": "기대", "nw": True}],
                 "rows": [{"say": str(g.get("say") or ""), "sql": mono(g.get("sql") or ""),
                           "expect": "1행 이상" if g.get("expect") is None else (f"{g['expect']}행" if isinstance(g.get("expect"), int) else "정해진 결과")} for g in goals]})
    if stale:
        secs.append({"kind": "list", "id": "stale", "title": "정본과 다른 파일", "items": [f"out/{x}" for x in stale],
                     "lead": "정본을 고친 뒤 다시 만들지 않았습니다: python datalight.py build data/model.light.json"})
    out["progress"] = page("progress", secs, blanks=[], subtitle="검사 · 알고 싶은 것 · 만든 파일")
    # 10 파일
    rows = [{"what": "정본", "path": mono(rel), "fp": mono(src[0]["fingerprint"]), "state": badge("있음", "ok")}]
    for name, what in (("schema.sql", "SQL (표 만들기)"), ("erd.md", "그림 (mermaid)"), ("spec.md", "정의서"), ("spec.xlsx", "정의서 (엑셀)"), ("book.html", "데이터 설명서")):
        f = od / name
        if f.is_file():
            try:
                fr = f.resolve().relative_to(root).as_posix()
            except ValueError:
                fr = f.name
            rows.append({"what": what, "path": mono(fr), "fp": mono(_sha12(f.read_bytes())),
                         "state": badge("정본과 다름", "bad") if name in stale else badge("있음", "ok")})
    secs = [{"kind": "text", "id": "how", "tone": "note", "text": "이 사이트는 정본에서 만듭니다. 보기만 하는 화면이라 여기서 고치지 않습니다 -- 정본을 고치고 "
             "python datalight.py site data/model.light.json 으로 다시 만듭니다 (파일로 열면 됩니다 -- 서버 · 포트가 없습니다)."},
            {"kind": "table", "id": "sources", "title": "재료와 만든 파일", "count": len(rows),
             "columns": [{"key": "what", "label": "무엇"}, {"key": "path", "label": "파일"}, {"key": "state", "label": "", "nw": True}, {"key": "fp", "label": "지문", "nw": True}],
             "rows": rows}]
    out["files"] = page("files", secs, sources=[], subtitle="재료 파일 · 만든 파일")
    return out


def _site_js(var: str, data: dict) -> str:
    j = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return f"window.OUTPUTS=window.OUTPUTS||{{}};window.OUTPUTS.{var}={j};\n"


SITE_SUB_RX = re.compile(r"^[A-Za-z0-9_~-][A-Za-z0-9_.~-]{0,119}(?:/[A-Za-z0-9_~-][A-Za-z0-9_.~-]{0,119}){0,3}$")
SITE_LABELS = {"data-light": "data-expert-framework-light", "dev-light": "dev-process-light"}      # 사양 frameworks 의 가벼운 판 둘


def _site_rel_ok(rel) -> bool:
    return (isinstance(rel, str) and bool(rel) and not rel.startswith("/") and "\\" not in rel and ":" not in rel
            and all(x not in ("", ".", "..") for x in rel.split("/")))


def site_page(pid: str, secs: list, *, framework: str, framework_version: str, mark: str, now: str, source: list, sub=None,
              blanks=None, title=None, subtitle=None, read=None, wide=False, crumb=None) -> dict:
    """쪽 JSON 하나 (사양 outputs_version 1 의 머리 + body.sections) -- 가벼운 판은 늘 '계산된 쪽'(확인 대상 아님)."""
    bl = [str(x) for x in (blanks or [])]
    lb = dict((x[0], x[2]) for x in SITE_PAGES)[pid]
    return {"outputs_version": 1, "page": pid, "sub": sub, "framework": framework, "framework_version": framework_version, "level": "light",
            "generated_at": now, "title": title or lb, "subtitle": subtitle, "read": {"text": read if read is not None else SITE_READ.get(pid, ""),
                                                                                       "check": [], "guides": []},
            "source": source, "confirm": {"state": "computed", "by": None, "at": None, "quote": None}, "basis": [],
            "blanks": {"count": len(bl), "total": max(len(bl), 1), "items": [{"id": None, "label": x} for x in bl[:60]]},
            "crumb": crumb or [], "wide": wide, "body": {"sections": secs}}


def write_site(site, root, pages: dict, *, framework: str, framework_version: str, project, mark: str, now: str, index=(), subs=(),
               menu_subs=None, default_site=None, hosting=None) -> dict:
    """가벼운 판 사이트 쓰기 (파일 모드 -- 서버 · 포트 없음). data-light 와 dev-process-light 가 같이 쓴다.

    pages: SITE_PAGES 의 쪽 id → 쪽 JSON (5쪽 모두). subs: (쪽 id, 부분 이름, 쪽 JSON) -- 주소 <쪽>/<부분>/.
    menu_subs: 쪽 id → 메뉴 아래 줄 [{id, label, href, n}]. index: 찾기 색인 [{label, sub, kind, href}].
    사이트 폴더는 이 도구만 쓰는 곳 -- 뿌리 · 뿌리를 품는 폴더 · git 저장소 · 남이 만든 폴더(manifest 없음)에는 쓰지 않는다.
    지난번에 쓴 파일 중 이번에 없는 것은 그때 쓴 내용 그대로일 때만 지운다 (사용자가 넣거나 고친 파일은 둔다).
    hosting="static": 공개본 (publish -- 서비스 주소 아래 · GitHub Pages) -- 화면이 사이트 서버를 찾지 않는다."""
    import hashlib
    if not (SITE_SHELL / "page.html").is_file():
        raise ValueError("화면 틀 사본이 없습니다 (data-light/site/shell) -- 스킬을 다시 설치합니다")
    if framework not in SITE_LABELS:
        raise ValueError(f"모르는 판: {framework}")
    root, site = Path(root).resolve(), Path(site).resolve()
    if site == root or site in root.parents:
        raise ValueError("사이트 폴더로 프로젝트 폴더(또는 그 위)를 쓸 수 없습니다 -- 비어 있는 따로 된 폴더를 줍니다")
    man_p = site / "manifest.json"
    try:
        old = json.loads(man_p.read_text(encoding="utf-8")) if man_p.is_file() else {}
    except ValueError:
        old = {}
    if not isinstance(old, dict):
        old = {}
    if site.is_dir() and any(x.name != ".gitignore" for x in site.iterdir()) and not old.get("outputs_site"):
        raise ValueError(f"{site} 가 비어 있지 않은데 이 도구가 만든 사이트가 아닙니다 -- 비어 있는 폴더를 줍니다")
    if (site / ".git").exists():
        raise ValueError("사이트 폴더가 git 저장소입니다 -- 따로 된 폴더를 줍니다")
    missing = [x[0] for x in SITE_PAGES if not isinstance(pages.get(x[0]), dict)]
    if missing:
        raise ValueError("쪽이 빠졌습니다: " + ", ".join(missing))
    site.mkdir(parents=True, exist_ok=True)
    dflt = Path(default_site).resolve() if default_site else None
    ign = site.parent if dflt is not None and site == dflt and site.parent.name == "outputs" else site
    gi = ign / ".gitignore"
    if not gi.is_file():
        _write(gi, "# 개발 관리 사이트 -- 커밋하지 않는다 (기록 · 정본에서 다시 만든다)\n*\n")
    written, hashes = [], {}

    def h12(b: bytes) -> str:
        return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()[:12]

    def put(rel: str, data):
        b = data.encode("utf-8") if isinstance(data, str) else data
        f = site / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        with open(f, "wb") as fh:
            fh.write(b)
        written.append(rel)
        hashes[rel] = h12(b)
    for f in sorted((SITE_SHELL / "assets").rglob("*")):
        if f.is_file():
            put("assets/" + f.relative_to(SITE_SHELL / "assets").as_posix(), f.read_bytes())
    tpl = (SITE_SHELL / "page.html").read_text(encoding="utf-8")
    sv = (SITE_SHELL / "VERSION").read_text(encoding="utf-8").strip()
    esc = lambda x: html.escape(str(x), quote=True)  # noqa: E731
    plist, errors = [], []
    paths = dict((x[0], x[3]) for x in SITE_PAGES)

    def emit(pid: str, sub, d: dict):
        path = paths[pid] + ((sub + "/") if sub else "")
        dkey = pid + (("/" + sub) if sub else "")
        put(f"data/{dkey}.json", json.dumps(d, ensure_ascii=False, indent=1) + "\n")
        put(f"data/{dkey}.js", _site_js("page", d))
        put(path + "index.html", tpl.replace("{{TITLE}}", esc(f"{d.get('title') or ''} · {project or ''}")).replace("{{BASE}}", esc("../" * path.count("/")))
            .replace("{{DATA}}", esc(f"data/{dkey}.js")).replace("{{JSON}}", esc(f"data/{dkey}.json")).replace("{{PAGE}}", esc(pid))
            .replace("{{SUB}}", esc(sub or "")).replace("{{SHELL}}", esc(sv)))
        plist.append({"page": pid, "sub": sub, "path": path, "data": f"data/{dkey}.json", "state": "computed", "blanks": d["blanks"]["count"]})
    for pid, _no, _label, _path in SITE_PAGES:
        emit(pid, None, pages[pid])
    taken = {w.casefold() for w in written}
    for pid, sub, d in subs:
        if pid not in paths or pid == "overview" or not isinstance(sub, str) or not SITE_SUB_RX.match(sub) or ".." in sub.split("/") \
                or (paths[pid] + sub + "/index.html").casefold() in taken or not isinstance(d, dict):
            errors.append(f"{pid}: 부분 쪽 이름이 맞지 않거나 다른 쪽과 겹친다 ({str(sub)[:60]})")
            continue
        emit(pid, sub, d)
        taken = {w.casefold() for w in written}
    menu = []
    for pid, no, label, path in SITE_PAGES:
        ms = [{"id": str(x["id"]), "label": str(x["label"]), "href": str(x["href"]), **({"n": x["n"]} if isinstance(x.get("n"), int) else {})}
              for x in (menu_subs or {}).get(pid) or [] if isinstance(x, dict) and x.get("id") and x.get("label") and isinstance(x.get("href"), str)]
        menu.append({"no": no, "id": pid, "label": label, "href": path, "state": "computed", "blanks": pages[pid]["blanks"]["count"], "subs": ms})
    idx = [{"label": label, "kind": "쪽", "href": path} for pid, no, label, path in SITE_PAGES] + [x for x in index if isinstance(x, dict)]
    site_obj = {"outputs_version": 1, "framework": framework, "framework_label": SITE_LABELS[framework], "framework_version": framework_version,
                "level": "light", "level_label": "가벼운 판", "project": project, "generated_at": now, "mark": mark, "shell_version": sv,
                "menu": menu, "index": idx, "links": [], **({"hosting": "static"} if hosting == "static" else {})}
    put("data/site.json", json.dumps(site_obj, ensure_ascii=False, indent=1) + "\n")
    put("data/site.js", _site_js("site", site_obj))
    now_cf = {w.casefold() for w in written}
    old_h = old.get("hashes") if isinstance(old.get("hashes"), dict) else {}
    for rel in old.get("files") or []:                     # 지난번에 쓴 것 중 이번에 없는 것 -- 사이트 안 · 그때 쓴 내용 그대로인 것만
        if not _site_rel_ok(rel) or rel in written or rel.casefold() in now_cf or not old_h.get(rel):
            continue
        f = site / rel
        try:
            if f.is_file() and not f.is_symlink() and site in f.resolve().parents and h12(f.read_bytes()) == old_h[rel]:
                f.unlink()
        except OSError:
            pass
    _write(man_p, json.dumps({"outputs_site": True, "outputs_version": 1, "generated_at": now, "framework": framework, "level": "light",
                              "shell_version": sv, "pages": plist, "files": sorted(set(written)), "hashes": hashes, "errors": errors},
                             ensure_ascii=False, indent=1) + "\n")
    return {"site": str(site), "index": str(site / "index.html"), "pages": len([x for x in plist if not x["sub"]]), "subs": len([x for x in plist if x["sub"]]),
            "blanks": sum(p["blanks"] for p in plist if not p["sub"]), "shell": sv, "errors": errors}


def site_index(model: dict) -> list:
    """찾기 색인 -- 표 · 하는 일."""
    idx = [{"label": t.get("label") or t["name"], "sub": t["name"], "kind": "표", "href": "data/#t-" + t["name"]} for t in ordered(model)]
    idx += [{"label": str(w["name"]), "sub": str(w.get("who") or ""), "kind": "일", "href": "business/#w-" + str(i + 1)}
            for i, w in enumerate(w for w in model.get("works") or [] if isinstance(w, dict) and w.get("name"))]
    return idx


def build_site(model_path, out=None, hosting=None) -> dict:
    """개발 관리 사이트 (가벼운 판) -- 정본에서 쪽 JSON 5개 + 공통 화면 틀(사본). 파일로 연다 (서버 · 포트 없음).
    사이트 폴더는 이 도구만 쓰는 곳 -- data/outputs/ 에 .gitignore 를 둔다 (커밋하지 않는다)."""
    import secrets
    model = load(model_path)
    root = site_root(model_path)
    dflt = root / "data" / "outputs" / "site"
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    mark = secrets.token_hex(8)
    pages = site_pages(model, model_path, mark, now)
    return write_site(Path(out) if out else dflt, root, pages, framework="data-light", framework_version=__version__, project=model.get("project"),
                      mark=mark, now=now, index=site_index(model), default_site=dflt, hosting=hosting)


# ----------------------------------------------------------------- 공개 (서비스 주소 아래 · GitHub Pages)
# 소유자 2026-10-20: "개발 결과가 웹페이지일 경우 '서비스주소/dev-process-framework/', '서비스주소/data-expert-framework/' 로 서비스되고
# 웹 페이지가 없을 경우에는 페이지를 만들어서 GitHub Pages 로 ... light 도 마찬가지고. 동일한 페이지를 중복해서 만들지 않도록 주의".
# 전문판 outputs.py publish 와 같은 규칙 (사양 publish) -- 판 이름 폴더 하나에만, 품은 판(dev-light 가 data-light 를)의 폴더에는 안내 쪽만.
PUBLISH_MODES = {"service": "서비스 주소 아래 (<서비스 주소>/<판 이름>/)", "pages": "GitHub Pages (gh-pages 가지)", "none": "공개하지 않음 (이 컴퓨터에서만)"}
PUBLISH_CONFIG = {"data-light": "data/outputs-publish.json", "dev-light": "dev-notes/outputs-publish.json"}
PUBLISH_INCLUDES = {"dev-light": ["data-light"]}
PUBLISH_HOME = {"data-light": "data/"}
PUBLISH_MARK = ".outputs-publish.json"
PAGES_BRANCH = "gh-pages"
PAGES_REF = "refs/dev-outputs/pages"
PORTAL_CMD = "python .claude/skills/light-portal/portal_tool.py publish"
# 사용자 답 원문에서 지우는 것 -- 주소 · 호스트:포트(호스트는 글자로 시작 · IP · [IPv6]) · 이 컴퓨터 · 포트 번호 글 · 이메일 · 비밀값 (시각 10:30 은 그대로)
_Q_URL = re.compile(r"(?i)\b(?:https?|ftp|wss?)://\S+")
_Q_HOSTPORT = re.compile(r"(?:\[[0-9A-Fa-f:]+\]|\b\d{1,3}(?:\.\d{1,3}){3}|\b[A-Za-z][\w-]*(?:\.[\w-]+)*):\d{2,5}\b")
_Q_LOCAL = re.compile(r"(?i)\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b(?:\s*:?\s*\d{2,5}\b)?")
_Q_PORT = re.compile(r"(?i)(?:포트\s*(?:번호\s*)?[:=]?\s*\d{2,5}(?:\s*번)?|\bport\s*[:=]?\s*\d{2,5}\b|\b\d{2,5}\s*번\s*포트)")
_Q_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_Q_SECRET = [re.compile(x) for x in (r"ghp_[A-Za-z0-9]{30,}", r"github_pat_[A-Za-z0-9_]{30,}", r"sk-[A-Za-z0-9_-]{20,}", r"AKIA[0-9A-Z]{16}",
                                     r"-----BEGIN [A-Z ]*PRIVATE KEY-----", r"xox[baprs]-[A-Za-z0-9-]{10,}")]   # 전문판 outputs_schema leaks.secret_patterns
# 공개본에 남기지 않는 내 네트워크 주소 -- 사설 IPv4 (10 · 172.16~31 · 192.168 · 169.254) · 이 컴퓨터 · .local/.lan/.internal/.home.arpa 이름 (포트가 붙어도)
_PRIVATE_RX = re.compile(rb"(?<![\w.])(?:(?:10|127)(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|169\.254(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}"
                         rb"|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:local|lan|internal|home\.arpa)|localhost)(?::\d{1,5})?(?![\w.])")


class PublishError(ValueError):
    pass


def scrub_quote(q: str) -> str:
    """사용자 답 원문을 커밋하는 설정에 남기기 전에 -- 주소 · 포트 · 이메일 · 비밀값을 자리표시로."""
    t = q.strip()
    for rx in _Q_SECRET:
        t = rx.sub("<비밀값>", t)
    t = _Q_URL.sub("<주소>", t)
    t = _Q_HOSTPORT.sub("<주소>", t)
    t = _Q_LOCAL.sub("<주소>", t)
    t = _Q_PORT.sub("포트 <번호>", t)
    return _Q_EMAIL.sub("<이메일>", t)


def owner_light(root) -> str | None:
    """이 프로젝트에 dev-process-light 가 깔려 있나 -- 있으면 그 사이트가 데이터 쪽을 함께 만든다 (데이터 판 사이트를 따로 만들지 않는다)."""
    r = Path(root)
    if (r / "dev-notes" / "NOW.md").is_file() and any((r / h / "skills" / "light-portal").is_dir() for h in (".claude", ".agents")):
        return "dev-light"
    return None


def guard_light(root, framework: str) -> None:
    if framework == "data-light" and owner_light(root) == "dev-light":
        raise PublishError("이 프로젝트는 dev-process-light 를 씁니다 -- 데이터 쪽(업무 설명 · 데이터)도 그 사이트(light-portal)에 함께 있으니 "
                           "데이터 판의 사이트를 따로 만들지 않습니다 (같은 쪽을 두 번 만들지 않게): " + PORTAL_CMD.replace(" publish", " build|publish"))


def _tops(framework: str) -> list:
    return [SITE_LABELS[framework]] + [SITE_LABELS[x] for x in PUBLISH_INCLUDES.get(framework, [])]


def _within(p: Path, base: Path) -> bool:
    """p 가 base 안에 있나 -- 둘 다 실제 경로로 (심링크 · Windows 정션을 따라간 뒤)."""
    try:
        Path(os.path.realpath(p)).relative_to(Path(os.path.realpath(base)))
        return True
    except (ValueError, OSError):
        return False


def publish_dirs(root) -> list:
    """서비스 폴더에 쓰는 공개본의 자리 (프로젝트 기준, 끝에 /) -- 표시(.outputs-publish.json)가 있는 폴더. 사이트의 '저장 목록 · 바뀐 파일'에서 뺀다
    (공개본을 저장할 때마다 다음 공개본이 또 바뀌지 않게)."""
    root = Path(root)
    out = []
    for fw, rel in PUBLISH_CONFIG.items():
        try:
            d = json.loads((root / rel).read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            continue
        if isinstance(d, dict) and d.get("mode") == "service" and isinstance(d.get("web_dir"), str):
            base = d["web_dir"].strip("/")
            pre = "" if base in ("", ".") else base + "/"
            out += [f"{pre}{t}/" for t in _tops(fw)]
    return list(dict.fromkeys(out))


def load_publish(root, framework: str) -> dict:
    f = Path(root).resolve() / PUBLISH_CONFIG[framework]
    if not f.is_file():
        return {}
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        raise PublishError(f"공개 설정 {f.name} 을 읽지 못했습니다 ({exc}) -- 고치거나 publish --set 으로 다시 정합니다")
    if not isinstance(d, dict) or d.get("mode") not in PUBLISH_MODES:
        raise PublishError(f"공개 설정 {f.name} 의 mode 가 {list(PUBLISH_MODES)} 중 하나가 아닙니다")
    return d


def _web_dir(root: Path, web_dir) -> Path:
    if not isinstance(web_dir, str) or not web_dir.strip():
        raise PublishError("--web-dir 가 필요합니다 -- 사이트가 주소 뿌리(/)로 그대로 내보내는 폴더, 프로젝트 기준 (예: public · docs · .)")
    if Path(web_dir).is_absolute() or re.match(r"^[A-Za-z]:", web_dir) or web_dir.startswith(("\\\\", "//")):
        raise PublishError("--web-dir 는 프로젝트 기준의 상대 경로로 줍니다")
    d = Path(os.path.realpath(root / web_dir))
    if not _within(d, root):
        raise PublishError("--web-dir 가 프로젝트 밖입니다 (링크를 따라가면 밖)")
    if ".git" in d.relative_to(Path(os.path.realpath(root))).parts:
        raise PublishError("--web-dir 가 .git 안입니다")
    for area in ("data/outputs", "dev-notes/outputs"):
        if _within(d, root / area):
            raise PublishError(f"--web-dir 가 개발 관리 사이트 자리({area}) 안입니다 -- 사이트가 내보내는 폴더를 줍니다")
    return d


def _nsha(b: bytes) -> str:
    """내용 지문 -- 줄 끝(CRLF/LF)은 같게 본다 (Windows 의 git 이 받으면서 바꾼다)."""
    import hashlib
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()


def _owned(folder: Path) -> dict:
    """공개 폴더의 표시 -- 이 도구가 쓴 폴더면 {파일: 받아들이는 지문들}, 새 폴더면 {}. 남의 폴더면 PublishError (덮지 않는다).
    표시에는 지난번 것(hashes)과 쓰다 멈춘 것(pending)이 함께 있다 -- 한 번 실패해도 다음에 이어서 쓴다."""
    if folder.is_symlink() or (folder.exists() and Path(os.path.realpath(folder)) != Path(os.path.realpath(folder.parent)) / folder.name):
        raise PublishError(f"{folder} 가 링크(또는 정션)입니다 -- 공개하지 않습니다")
    if not folder.exists():
        return {}
    if not folder.is_dir():
        raise PublishError(f"{folder} 가 폴더가 아닙니다")
    mark = folder / PUBLISH_MARK
    if mark.is_file() and not mark.is_symlink():
        try:
            d = json.loads(mark.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            raise PublishError(f"{mark} 가 깨졌습니다 -- 폴더를 비우고 다시 공개합니다")
        out: dict = {}
        for key in ("hashes", "pending"):
            h = d.get(key) if isinstance(d, dict) else None
            for k, v in (h.items() if isinstance(h, dict) else []):
                if isinstance(k, str) and isinstance(v, str) and _site_rel_ok(k):
                    out.setdefault(k, set()).add(v)
        return out
    if any(folder.iterdir()):
        raise PublishError(f"{folder} 는 이 도구가 공개한 폴더가 아닙니다 ({PUBLISH_MARK} 없음) -- 남의 파일을 덮지 않습니다. "
                           "다른 --web-dir 를 주거나 GitHub Pages(--set pages)로 공개합니다")
    return {}


def _git_run(root: Path, *args, data: bytes | None = None, env: dict | None = None, hooks: bool = False, timeout: int = 180):
    import subprocess
    safe = [] if hooks else ["-c", "core.fsmonitor=false", "-c", f"core.hooksPath={os.devnull}", "-c", "core.pager=cat"]
    e = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C", "LANGUAGE": "C", **(env or {})}   # 알림 글을 영어로 (읽어서 판단하는 곳이 있다)
    try:
        return subprocess.run(["git", *safe, "-C", str(root), *args], input=data, capture_output=True, env=e, timeout=timeout)
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(args, 124, b"", b"git timeout")
    except OSError as exc:
        return subprocess.CompletedProcess(args, 127, b"", str(exc).encode("utf-8"))


def _gs(r) -> str:
    return (r.stdout or b"").decode("utf-8", "replace").strip()


def _ge(r) -> str:
    return ((r.stderr or b"") + (r.stdout or b"")).decode("utf-8", "replace").strip()[-300:]


def _github(url: str):
    m = re.match(r"^(?:https?://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)([^/]+)/([^/]+?)(?:\.git)?/?$", url or "")
    return (m.group(1), m.group(2)) if m else None


def _pages_source(url: str):
    """GitHub 저장소의 Pages 가 지금 무엇을 보여 주나 -- ('branch', 가지, 폴더) · ('workflow', None, None) · None(꺼짐 · 비공개 · 모름). 토큰 없이."""
    import urllib.error
    import urllib.request
    gh = _github(url)
    if not gh:
        return None
    try:
        req = urllib.request.Request(f"https://api.github.com/repos/{gh[0]}/{gh[1]}/pages", headers={"User-Agent": "datalight", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=8) as r:  # noqa: S310 -- 정해진 주소
            d = json.loads(r.read(200_000).decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError):
        return None
    if d.get("build_type") == "workflow":
        return ("workflow", None, None)
    src = d.get("source") or {}
    return ("branch", src.get("branch"), src.get("path")) if src.get("branch") else None


def pages_url(remote_url: str, framework: str):
    gh = _github(remote_url)
    if not gh:
        return None
    owner, repo = gh[0].lower(), gh[1]
    return f"https://{owner}.github.io/" + ("" if repo.lower() == f"{owner}.github.io" else f"{repo}/") + SITE_LABELS[framework] + "/"


def set_publish(root, framework: str, mode: str, *, by, quote, web_dir=None, remote: str = "origin") -> dict:
    """공개 방식을 정합니다 -- 사용자 답 원문으로만 (공개는 대리로 정하지 않는다). 설정 파일은 커밋합니다."""
    root = Path(root).resolve()
    if mode not in PUBLISH_MODES:
        raise PublishError(f"--set 은 {list(PUBLISH_MODES)} 중 하나입니다")
    if by != "user":
        raise PublishError("공개는 사용자가 정합니다 -- --by user --quote \"<사용자 답 원문>\"")
    if not (quote or "").strip():
        raise PublishError("--quote 에 사용자 답 원문을 줍니다")
    d: dict = {"outputs_publish": 1, "framework": framework, "mode": mode, "by": "user", "quote": scrub_quote(quote),
               "at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    warnings = []
    if mode == "service":
        wd = _web_dir(root, web_dir)
        for t in _tops(framework):
            _owned(wd / t)
        d["web_dir"] = "." if wd == Path(os.path.realpath(root)) else wd.relative_to(Path(os.path.realpath(root))).as_posix()
    if mode == "pages":
        url = _gs(_git_run(root, "remote", "get-url", remote))
        if not url:
            raise PublishError(f"git 원격 '{remote}' 이 없습니다 -- GitHub 저장소를 원격으로 둔 뒤에 (git remote add {remote} <주소>)")
        src = _pages_source(url)
        if src and not (src[0] == "branch" and src[1] == PAGES_BRANCH and (src[2] or "/") == "/"):
            where = "GitHub Actions" if src[0] == "workflow" else f"{src[1]} 가지의 {src[2] or '/'}"
            raise PublishError(f"이 저장소의 GitHub Pages 는 이미 {where} 를 보여 줍니다 -- gh-pages 로 바꾸면 지금 사이트가 내려갑니다. "
                               "그 사이트 아래에 두려면 --set service --web-dir <그 폴더> 로 합니다")
        d.update({"remote": remote, "branch": PAGES_BRANCH})
        if not _github(url):
            warnings.append("원격이 GitHub 이 아닙니다 -- gh-pages 가지에는 올리지만 사이트로 보여 주는지는 그 서비스에 달렸습니다")
    f = root / PUBLISH_CONFIG[framework]
    f.parent.mkdir(parents=True, exist_ok=True)
    _write(f, json.dumps(d, ensure_ascii=False, indent=1) + "\n")
    return {**d, "config": str(f), "warnings": warnings}


def _pointer_html(href: str, inc: str, main: str) -> str:
    h, a, b = html.escape(href, quote=True), html.escape(SITE_LABELS[inc]), html.escape(SITE_LABELS[main])
    return ("<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
            "<meta name=\"robots\" content=\"noindex, nofollow\">\n<meta name=\"referrer\" content=\"no-referrer\">\n"
            f"<meta http-equiv=\"refresh\" content=\"0; url={h}\">\n<title>{a} → {b}</title>\n</head>\n<body>\n"
            f"<p>{a} 의 쪽은 <a href=\"{h}\">{b} 개발 관리 사이트</a>에 함께 있습니다 (같은 쪽을 두 번 만들지 않습니다).</p>\n</body>\n</html>\n")


_ASSET_REF = re.compile(r'((?:src|href)=")((?:\.\./)*(?:data|assets)/[^"?#]+\.(?:js|css))(")')


def _scrub_ok(rel: str, b: bytes) -> bool:
    """내 네트워크 주소를 지울 파일인가 -- 사이트 자료(.json · window.OUTPUTS 자료 .js)와 틀로 만든 쪽 HTML 만.
    화면 틀 프로그램(assets/*)은 건드리지 않는다 (v.local 같은 코드가 주소처럼 보여 프로그램이 깨진다)."""
    r = rel.lower()
    if r.endswith((".json", ".md", ".txt")):
        return True
    if r.endswith(".js"):
        return b.startswith(b"window.OUTPUTS=")
    if r.endswith(".html"):
        return b'data-base="' in b
    return False


def _published_bytes(rel: str, b: bytes, ver: str) -> bytes:
    """공개본으로 바꾼다 -- 내 네트워크 주소를 지우고, 쪽 HTML 은 공개본 표시(data-hosting)와 캐시를 피하는 꼬리표(?v=빌드)를 단다
    (GitHub Pages 는 10분 캐시 -- 예전 site.js 와 새 쪽이 섞이면 표시가 맞지 않는다)."""
    if _scrub_ok(rel, b):
        b = _PRIVATE_RX.sub("<내부 주소>".encode("utf-8"), b)
    if rel.lower().endswith(".html") and b'data-base="' in b:
        t = b.decode("utf-8")
        if ver:
            t = _ASSET_REF.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={ver}{m.group(3)}", t)
        t = t.replace("<body ", '<body data-hosting="static" ', 1)
        b = t.encode("utf-8")
    return b


def publish_files(site: Path, framework: str, ver: str = "") -> dict:
    """공개 묶음 {경로: 바이트} -- <판 이름>/ 에 사이트(manifest 의 파일만), 품은 판의 폴더에는 같은 주소로 가는 안내 쪽만.
    글 파일의 내 네트워크 주소(사설 IP · 이 컴퓨터 · .local 이름)는 <내부 주소> 로 지운다."""
    site = Path(site)
    name = SITE_LABELS[framework]
    try:
        man = json.loads((site / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        man = {}
    out = {}
    for rel in man.get("files") or []:
        if _site_rel_ok(rel) and (site / rel).is_file() and not (site / rel).is_symlink():
            out[f"{name}/{rel}"] = _published_bytes(rel, (site / rel).read_bytes(), ver)
    for inc in PUBLISH_INCLUDES.get(framework, []):
        iname, home = SITE_LABELS[inc], PUBLISH_HOME.get(inc, "")
        for _pid, _no, _label, path in SITE_PAGES:
            up = "../" * (path.count("/") + 1)
            out[f"{iname}/{path}index.html"] = _pointer_html(f"{up}{name}/{path or home}index.html", inc, framework).encode("utf-8")
    return out


def stable_digest(files: dict, volatile: list) -> str:
    """공개본의 내용 지문 -- 빌드마다 바뀌는 값(만든 때 · 빌드 표시)을 뺀다. 같으면 다시 올리지 않는다."""
    import hashlib
    vol = [v.encode("utf-8") for v in volatile if isinstance(v, str) and len(v) >= 8]
    h = hashlib.sha256()
    for rel in sorted(files):
        b = files[rel].replace(b"\r\n", b"\n")
        for v in vol:
            b = b.replace(v, b"<v>")
        h.update(rel.encode("utf-8") + b"\0" + hashlib.sha256(b).digest())
    return h.hexdigest()[:24]


def _write_mark(folder: Path, meta: dict, hashes: dict, pending: dict | None = None) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    body = {"outputs_publish": 1, **meta, "hashes": hashes}
    if pending:
        body["pending"] = pending
    _write(folder / PUBLISH_MARK, json.dumps(body, ensure_ascii=False, indent=1) + "\n")


def _write_tree(base: Path, files: dict, tops: list, meta: dict, dry_run: bool = False) -> dict:
    """사이트가 내보내는 폴더 아래 판 이름 폴더들에 쓴다 -- 폴더마다 표시의 지문 그대로인(이 도구가 쓴) 파일만 덮고 지운다.
    쓰기 전에 새 지문을 표시에 함께 적어 둔다(pending) -- 쓰다 멈춰도 다음 공개가 이어서 쓴다."""
    marks = {t: _owned(base / t) for t in tops}

    def cur(f: Path):
        try:
            return _nsha(f.read_bytes())
        except OSError:
            return None
    plan = []
    for rel, data in sorted(files.items()):
        top, _, inner = rel.partition("/")
        f = base / top / inner
        if not _site_rel_ok(inner) or not _within(f, base / top) or (f.exists() and f.is_symlink()):
            raise PublishError(f"{rel} 이 링크(또는 정션)를 거칩니다 -- 공개하지 않습니다")
        if f.exists() and (not f.is_file() or (cur(f) not in marks[top].get(inner, set()) and cur(f) != _nsha(data))):
            raise PublishError(f"{base.name}/{rel} 은 이 도구가 공개한 그대로가 아닙니다 (누가 고쳤거나 다른 파일) -- 덮지 않습니다")
        plan.append((top, inner, f, data))
    want = {(t, i) for t, i, _f, _d in plan}
    old_meta = {}
    try:
        old_meta = json.loads((base / tops[0] / PUBLISH_MARK).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError):
        pass
    if meta.get("stable") and isinstance(old_meta, dict) and old_meta.get("stable") == meta["stable"] and not old_meta.get("pending") and \
            want == {(t, i) for t, h in marks.items() for i in h} and all((base / t / i).is_file() for t, i in want):
        return {"changed": 0, "removed": 0, "files": len(plan)}
    gone = []
    for t, h in marks.items():
        for inner, shas in h.items():
            f = base / t / inner
            if (t, inner) not in want and _within(f, base / t) and f.is_file() and not f.is_symlink() and cur(f) in shas:
                gone.append(f)
    changed = [(t, i, f, d) for t, i, f, d in plan if cur(f) != _nsha(d)]
    if dry_run:
        return {"changed": len(changed), "removed": len(gone), "files": len(plan), "dry_run": True}
    def kept(t):                                             # 지금 폴더에 있는 그대로의 지문 (받아들이는 것 중) -- 쓰다 멈춘 파일도 다음에 알아보게
        out = {}
        for i, shas in marks[t].items():
            f = base / t / i
            c = cur(f) if _site_rel_ok(i) and _within(f, base / t) and f.is_file() and not f.is_symlink() else None
            if c in shas:
                out[i] = c
        return out
    for t in tops:                                           # 쓰기 전에: 새 지문도 받아들이게 (쓰다 멈추면 다음에 이어서)
        _write_mark(base / t, meta, kept(t), {i: _nsha(d) for tt, i, _f, d in plan if tt == t})
    for f in gone:
        f.unlink()
    for _t, _i, f, data in changed:
        f.parent.mkdir(parents=True, exist_ok=True)
        with open(f, "wb") as fh:
            fh.write(data)
    for t in tops:
        d = base / t
        for sub in sorted((x for x in d.rglob("*") if x.is_dir() and not x.is_symlink()), key=lambda x: len(x.parts), reverse=True):
            try:
                sub.rmdir()                                      # 지운 뒤 빈 폴더만
            except OSError:
                pass
        _write_mark(d, meta, {i: _nsha(dd) for tt, i, _f, dd in plan if tt == t})
    return {"changed": len(changed), "removed": len(gone), "files": len(plan)}


def _blob(root: Path, data: bytes):
    h = _git_run(root, "hash-object", "-w", "--stdin", data=data)
    if h.returncode != 0:
        raise PublishError(f"파일을 저장소에 넣지 못했습니다: {_ge(h)}")
    return _gs(h)


def _pages_commit(root: Path, files: dict, tops: list, *, remote: str, branch: str, project, msg: str, push: bool, stable: str) -> dict:
    """gh-pages 가지에 공개본을 올립니다 -- 작업 폴더 · HEAD · 색인을 건드리지 않고(임시 색인), 그 가지의 다른 파일은 둡니다.
    판 이름 폴더 안 · 뿌리의 index.html · .nojekyll 은 이 도구가 올린 그대로(표시의 blob 지문)일 때만 바꾸거나 뺍니다."""
    import tempfile
    ls = _git_run(root, "ls-remote", "--exit-code", remote, f"refs/heads/{branch}")
    if ls.returncode == 2:                                   # 가지가 아직 없다 (말글과 상관없이 끝난 코드로)
        _git_run(root, "update-ref", "-d", PAGES_REF)
        base = None
    elif ls.returncode != 0:
        return {"state": "offline", "reason": _ge(ls)}
    else:
        f = _git_run(root, "fetch", "--no-tags", "-q", remote, f"+refs/heads/{branch}:{PAGES_REF}")
        if f.returncode != 0:
            return {"state": "offline", "reason": _ge(f)}
        base = _gs(_git_run(root, "rev-parse", "--verify", "-q", PAGES_REF + "^{commit}")) or None
    have: dict = {}
    if base:
        for rec in _gs(_git_run(root, "ls-tree", "-r", "-z", base)).split("\0"):
            meta_, _, path = rec.partition("\t")
            parts = meta_.split()
            if path and len(parts) == 3:
                have[path] = parts[2]

    def mark_of(path: str) -> dict:
        if path not in have:
            return {}
        try:
            d = json.loads(_gs(_git_run(root, "cat-file", "blob", have[path])) or "{}")
            return d if isinstance(d, dict) else {}
        except ValueError:
            return {}
    root_mark = mark_of(PUBLISH_MARK)
    own_root = not have or bool(root_mark.get("outputs_publish"))
    drop, put = [], dict(files)
    for t in tops:
        inside = [p for p in have if p.startswith(t + "/")]
        tm = mark_of(f"{t}/{PUBLISH_MARK}")
        if inside and not tm.get("outputs_publish"):
            raise PublishError(f"gh-pages 의 {t}/ 는 이 도구가 올린 폴더가 아닙니다 -- 덮지 않습니다")
        if "blobs" in tm:
            blobs = tm["blobs"] if isinstance(tm["blobs"], dict) else {}
        else:                                                # 0.10.0 의 표시(파일 지문 없음) -- 그때 이 도구가 올린 그대로로 본다
            blobs = {p[len(t) + 1:]: have[p] for p in inside}
        foreign = [p for p in inside if p != f"{t}/{PUBLISH_MARK}" and blobs.get(p[len(t) + 1:]) != have[p]]
        if foreign:
            raise PublishError(f"gh-pages 의 {t}/ 에 이 도구가 올리지 않은(또는 고친) 파일이 있습니다 -- 덮거나 지우지 않습니다: " + ", ".join(foreign[:5]))
        if t == tops[0] and stable and tm.get("stable") == stable and all(k in have for k in files if k.startswith(t + "/")):
            return {"state": "same", "commit": base}
        drop += inside
    rows_blob: dict = {}
    for k, v in sorted(put.items()):
        rows_blob[k] = _blob(root, v)
    for t in tops:
        mine = {k[len(t) + 1:]: s for k, s in rows_blob.items() if k.startswith(t + "/")}
        mk = (json.dumps({"outputs_publish": 1, "folder": t, "blobs": mine, **({"stable": stable} if t == tops[0] else {})}, ensure_ascii=False) + "\n").encode("utf-8")
        rows_blob[f"{t}/{PUBLISH_MARK}"] = _blob(root, mk)
    if own_root:
        items = "\n".join(f"<li><a href=\"{html.escape(t, quote=True)}/index.html\">{html.escape(t)}</a></li>" for t in tops)
        title = html.escape(str(project or "개발 관리 사이트"))
        rf = {"index.html": ("<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"robots\" content=\"noindex, nofollow\">\n"
                             f"<title>{title}</title>\n</head>\n<body>\n<h1>{title}</h1>\n<p>개발 관리 사이트 (공개본)</p>\n<ul>\n{items}\n</ul>\n</body>\n</html>\n").encode("utf-8"),
              ".nojekyll": b""}
        if isinstance(root_mark.get("blobs"), dict):
            known = root_mark["blobs"]
        else:                                                # 0.10.0 의 표시 (이 도구가 둔 뿌리 파일의 이름만)
            known = {k: have[k] for k in (root_mark.get("files") or []) if isinstance(k, str) and k in have}
        mine = {}
        for k, v in rf.items():
            if k in have and known.get(k) != have[k]:
                continue                                     # 남이 두었거나 고친 뿌리 파일 -- 그대로
            mine[k] = rows_blob[k] = _blob(root, v)
        for k in known:
            if k in have and k not in mine and known.get(k) == have[k] and k not in rf:
                drop.append(k)                               # 예전에 이 도구가 둔 뿌리 파일(robots.txt 등) -- 그대로면 뺀다
        rows_blob[PUBLISH_MARK] = _blob(root, (json.dumps({"outputs_publish": 1, "blobs": mine}, ensure_ascii=False) + "\n").encode("utf-8"))
    with tempfile.TemporaryDirectory(prefix="light-pages-") as tmp:
        env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
        r = _git_run(root, "read-tree", *([base] if base else ["--empty"]), env=env)
        if r.returncode != 0:
            raise PublishError(f"gh-pages 를 읽지 못했습니다: {_ge(r)}")
        if drop:
            r = _git_run(root, "update-index", "-z", "--force-remove", "--stdin", data=("\0".join(drop) + "\0").encode("utf-8"), env=env)
            if r.returncode != 0:
                raise PublishError(f"gh-pages 의 예전 공개본을 빼지 못했습니다: {_ge(r)}")
        rows = [f"100644 {s}\t{k}" for k, s in sorted(rows_blob.items())]
        r = _git_run(root, "update-index", "-z", "--add", "--index-info", data=("\0".join(rows) + "\0").encode("utf-8"), env=env)
        if r.returncode != 0:
            raise PublishError(f"gh-pages 의 새 공개본을 넣지 못했습니다: {_ge(r)}")
        tree = _gs(_git_run(root, "write-tree", env=env))
        if not tree:
            raise PublishError("gh-pages 의 내용을 만들지 못했습니다 (write-tree)")
    if base and tree == _gs(_git_run(root, "rev-parse", base + "^{tree}")):
        return {"state": "same", "commit": base}
    ident = {}
    for k, eks in (("user.name", ("GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME")), ("user.email", ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"))):
        if not _gs(_git_run(root, "config", "--get", k)):
            for e in eks:
                ident[e] = "개발 관리 사이트" if k == "user.name" else "outputs@localhost"
    c = _git_run(root, "commit-tree", tree, *(["-p", base] if base else []), "-m", msg, env=ident)
    commit = _gs(c)
    if c.returncode != 0 or not commit:
        raise PublishError(f"gh-pages 커밋을 만들지 못했습니다: {_ge(c)}")
    if not push:
        return {"state": "ready", "commit": commit, "first": base is None}
    pr = _git_run(root, "push", "-q", remote, f"{commit}:refs/heads/{branch}", hooks=True)      # 사용자의 pre-push hook 은 그대로
    if pr.returncode != 0:
        err = _ge(pr)
        return {"state": "nonff" if ("non-fast-forward" in err or "fetch first" in err or "rejected" in err) else "push_failed", "reason": err, "commit": commit}
    _git_run(root, "update-ref", PAGES_REF, commit)
    return {"state": "pushed", "commit": commit, "first": base is None}


def publish(root, framework: str, build, *, push: bool = True) -> dict:
    """공개 설정대로 공개본을 만들어 올립니다. build(site_dir) -> write_site 의 결과 (hosting="static" 으로 그 폴더에 쓴다 -- 이 컴퓨터의 사이트는 그대로).
    service: <web_dir>/<판 이름>/ · pages: gh-pages 가지. 품은 판의 폴더에는 안내 쪽만 (같은 쪽을 두 번 만들지 않는다).
    push=False(--dry-run): 쓰거나 올리지 않고 무엇이 바뀌는지만."""
    import tempfile
    root = Path(root).resolve()
    conf = load_publish(root, framework)
    if not conf:
        return {"state": "unset"}
    if conf["mode"] == "none":
        return {"state": "off", "mode": "none"}
    tops = _tops(framework)
    with tempfile.TemporaryDirectory(prefix="light-publish-") as tmp:
        site = Path(tmp) / "site"
        r = build(site)
        if r.get("errors"):
            raise PublishError("사이트를 만들다 문제가 생겨 공개하지 않습니다: " + "; ".join(r["errors"][:3]))
        try:
            sj = json.loads((site / "data" / "site.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            sj = {}
        files = publish_files(site, framework, ver=re.sub(r"[^A-Za-z0-9]", "", str(sj.get("mark") or ""))[:24])
        stable = stable_digest(files, [sj.get("generated_at"), sj.get("mark")])
        meta = {"framework": framework, "framework_version": sj.get("framework_version"), "generated_at": sj.get("generated_at"), "stable": stable}
        name = SITE_LABELS[framework]
        if conf["mode"] == "service":
            base = _web_dir(root, conf.get("web_dir"))
            w = _write_tree(base, files, tops, meta, dry_run=not push)
            rr = Path(os.path.realpath(root))
            ign = _git_run(root, "check-ignore", "-q", "--", str(base / name / "index.html")).returncode == 0
            st = "ready" if not push else ("written" if (w["changed"] or w["removed"]) else "same")
            return {"state": st, "mode": "service", "dir": "." if base == rr else base.relative_to(rr).as_posix(), "path": f"/{name}/",
                    "folders": tops, "ignored": ign, **w}
        remote, branch = str(conf.get("remote") or "origin"), PAGES_BRANCH          # 설정 파일의 다른 가지(main 등)로는 올리지 않는다
        if not re.match(r"^[A-Za-z0-9._-]+$", remote):
            raise PublishError("공개 설정의 remote 가 원격 이름이 아닙니다 -- publish --set pages 로 다시 정합니다")
        url = _gs(_git_run(root, "remote", "get-url", remote))
        if not url:
            raise PublishError(f"git 원격 '{remote}' 이 없습니다")
        msg = f"pages: {name} 개발 관리 사이트 공개본 ({sj.get('framework_version')}, {str(sj.get('generated_at') or '')[:16]})"
        res = {}
        for _ in range(2):
            res = _pages_commit(root, files, tops, remote=remote, branch=branch, project=sj.get("project"), msg=msg, push=push, stable=stable)
            if res["state"] != "nonff":
                break
        return {**res, "mode": "pages", "remote": remote, "branch": branch, "folders": tops, "url": pages_url(url, framework),
                "github": bool(_github(url)), "files": len(files)}


def publish_lines(res: dict, framework: str, cmd: str = "datalight.py publish") -> list:
    st, name = res.get("state"), SITE_LABELS[framework]
    if st == "unset":
        return ["공개 방식을 아직 정하지 않았습니다 -- 사용자에게 묻습니다: 서비스 주소 아래(만드는 것이 웹 페이지일 때) · GitHub Pages(웹 페이지가 없을 때) · 공개 안 함",
                f"  답대로: {cmd} --set service --web-dir <사이트가 내보내는 폴더> --by user --quote \"<답 원문>\" · --set pages ... · --set none ..."]
    if st == "off":
        return ["공개하지 않기로 했습니다 (none) -- 이 컴퓨터의 개발 관리 사이트만"]
    inc = ", ".join(f"{x}/ (안내 쪽만)" for x in res.get("folders", [])[1:])
    if res.get("mode") == "service":
        verb = {"written": "썼습니다", "same": "그대로 두었습니다 (바뀐 것 없음)", "ready": "쓸 준비만 했습니다 (--dry-run -- 쓰지 않음)"}.get(st, st)
        out = [f"공개본을 {res['dir']}/{name}/ 에 {verb} -- 파일 {res['files']} · 바뀜 {res['changed']} · 지움 {res['removed']}" + (f" · {inc}" if inc else "")]
        if st in ("written", "same"):
            out.append(f"  사이트를 올리면(배포) <서비스 주소>/{name}/ 에서 보입니다 ({res['dir']} 를 주소 뿌리로 내보낼 때 -- 폴더 주소에서 index.html 을 "
                       f"열지 않는 서버면 <서비스 주소>/{name}/index.html)" + (" -- 이 폴더도 저장(커밋)합니다" if st == "written" else ""))
        if res.get("ignored"):
            out.append("  [알림] 이 폴더는 git 이 무시합니다 -- 저장소에서 가져가는 배포면 보이지 않습니다")
        return out
    if st in ("pushed", "same"):
        out = [f"공개본을 {res['remote']} 의 {res['branch']} 가지에 {'올렸습니다' if st == 'pushed' else '그대로 두었습니다 (바뀐 것 없음)'}" + (f" · {inc}" if inc else "")]
        if res.get("github"):
            out.append(f"  주소: {res.get('url')} -- 누구나 볼 수 있습니다")
            if res.get("first"):
                out.append(f"  처음이면 GitHub 저장소 Settings → Pages 에서 'Deploy from a branch' · {res['branch']} · / (root) 로 한 번 켭니다 "
                           "(이미 다른 곳을 보여 주고 있으면 바꾸지 않습니다 -- 그때는 그 사이트 폴더 아래로: --set service --web-dir <그 폴더>)")
        else:
            out.append("  원격이 GitHub 이 아닙니다 -- 그 서비스가 gh-pages 가지를 사이트로 보여 주는지 확인합니다")
        return out
    if st == "ready":
        return [f"올릴 준비만 했습니다 (gh-pages 커밋 {str(res.get('commit', ''))[:8]} -- 올리지 않음)"]
    return [f"공개하지 못했습니다 ({st}): {res.get('reason', '')}"]


VIEWER_DIR = Path(__file__).resolve().parents[1] / "viewer"


def view(model: str, *, port: int = 8820, open_browser: bool = True, watch: bool = True) -> int:
    """웹 ERD 뷰어(전문판 dataviewer 의 MIT 사본, skills/data-light/viewer)로 정본을 그린다. 옮긴 위치만 정본 옆 *.layout.json 에."""
    if not (VIEWER_DIR / "dataviewer" / "server.py").is_file():
        print("뷰어 사본이 없습니다 (skills/data-light/viewer) -- 정의서 그림은 data/out/erd.md 를 보세요")
        return 1
    if not Path(model).is_file():
        print(f"정본이 없습니다: {model}")
        return 1
    sys.dont_write_bytecode = True               # 설치된 스킬 폴더에 __pycache__ 를 남기지 않는다
    if str(VIEWER_DIR) not in sys.path:
        sys.path.insert(0, str(VIEWER_DIR))
    from dataviewer.__main__ import main as viewer_main  # noqa: E402 -- 표준 라이브러리만 쓰는 사본
    args = [model, "--port", str(port)] + ([] if open_browser else ["--no-open"]) + ([] if watch else ["--no-watch"])
    return viewer_main(args)


def main(argv=None) -> int:
    _utf8_stdio()
    ap = argparse.ArgumentParser(prog="datalight", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=f"data-light {__version__}")
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("check"); p.add_argument("model")
    p = sp.add_parser("split"); p.add_argument("model"); p.add_argument("--write", action="store_true")
    p = sp.add_parser("build"); p.add_argument("model"); p.add_argument("--out"); p.add_argument("--db", choices=["sqlite", "postgresql"])
    p = sp.add_parser("try"); p.add_argument("model")
    p = sp.add_parser("import"); isp = p.add_subparsers(dest="sub", required=True)
    q = isp.add_parser("plan"); q.add_argument("file"); q.add_argument("--table", required=True); q.add_argument("--label")
    q.add_argument("--sheet"); q.add_argument("--out", default="data/import_plan.json")
    q = isp.add_parser("apply"); q.add_argument("plan"); q.add_argument("--model", required=True); q.add_argument("--db", required=True)
    q.add_argument("--approval", required=True); q.add_argument("--append", action="store_true")
    q.add_argument("--file", help="원본 파일 위치 (계획에 파일 이름만 적혔을 때)")
    q.add_argument("--force-sqlite", action="store_true", help="정본이 PostgreSQL 이어도 SQLite 에 넣음")
    q = isp.add_parser("schema"); q.add_argument("db"); q.add_argument("--out", default="data/model.light.json")
    q.add_argument("--force", action="store_true")
    p = sp.add_parser("verify"); p.add_argument("model"); p.add_argument("--db"); p.add_argument("--no-db", action="store_true")
    p.add_argument("--mutate", action="store_true", help="일부러 규칙을 하나씩 빼 보고 검사가 잡는지 확인")
    p = sp.add_parser("hook"); hsp = p.add_subparsers(dest="sub", required=True)
    q = hsp.add_parser("install"); q.add_argument("--repo", default=".")
    g = q.add_mutually_exclusive_group(); g.add_argument("--no-ci", dest="ci", action="store_false", default=None)
    g.add_argument("--ci", dest="ci", action="store_true")
    q.add_argument("--append", action="store_true", help="이미 있는 pre-commit 끝에 덧붙임")
    q.add_argument("--update", action="append", default=[], choices=["ci", "gitignore", "all"],
                   help="직접 고친 CI 파일 · 지운 .gitignore 줄을 새 판으로 (사용자가 고른 것)")
    q.add_argument("--keep", action="append", default=[], choices=["ci", "gitignore", "all"],
                   help="직접 고친 CI 파일 · 지운 .gitignore 줄을 그대로 (사용자가 고른 것)")
    q = hsp.add_parser("status"); q.add_argument("--repo", default=".")
    p = sp.add_parser("view", help="웹 ERD 그림을 브라우저로 (보기 전용, 정본을 고치면 곧바로 다시 그림)")
    p.add_argument("model", nargs="?", default="data/model.light.json"); p.add_argument("--port", type=int, default=8820)
    p.add_argument("--no-open", action="store_true"); p.add_argument("--no-watch", action="store_true")
    p = sp.add_parser("site", help="개발 관리 사이트 (가벼운 판 5쪽) -- data/outputs/site/index.html 을 파일로 연다")
    p.add_argument("model"); p.add_argument("--out", default=None)
    p = sp.add_parser("publish", help="개발 관리 사이트 공개본 -- <서비스 주소>/data-expert-framework-light/ (사이트 폴더) 또는 GitHub Pages")
    p.add_argument("model", nargs="?", default="data/model.light.json")
    p.add_argument("--set", default=None, choices=list(PUBLISH_MODES), help="공개 방식을 정한다 (--by user --quote 와 함께)")
    p.add_argument("--web-dir", default=None, help="service: 사이트가 주소 뿌리(/)로 내보내는 폴더 (프로젝트 기준, 예 public · docs · .)")
    p.add_argument("--remote", default="origin")
    p.add_argument("--by", default=None, choices=["user"])
    p.add_argument("--quote", default=None)
    p.add_argument("--status", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p = sp.add_parser("upgrade"); p.add_argument("model"); p.add_argument("--out", default="model.json")
    p.add_argument("--schema", default="app"); p.add_argument("--pi-schema")
    p.add_argument("--facts", help="전문판 질문 대장(data/facts.json)으로 만드는 것(product)도 옮긴다")
    p.add_argument("--blueprint", help="전문판 시스템 청사진(data/blueprint.json)으로 하는 일(works)도 옮긴다")
    a = ap.parse_args(argv)

    if a.cmd == "view":
        return view(a.model, port=a.port, open_browser=not a.no_open, watch=not a.no_watch)
    if a.cmd == "publish":
        root = site_root(a.model)
        try:
            guard_light(root, "data-light")
            if a.set:
                d = set_publish(root, "data-light", a.set, by=a.by, quote=a.quote, web_dir=a.web_dir, remote=a.remote)
                print(f"공개 방식을 정했습니다: {PUBLISH_MODES[a.set]} -- 설정 {PUBLISH_CONFIG['data-light']} (저장(커밋)합니다)")
                for w in d["warnings"]:
                    print("  [주의] " + w)
                return 0
            if a.status:
                conf = load_publish(root, "data-light")
                print("공개: " + (PUBLISH_MODES.get(conf.get("mode")) or "아직 정하지 않음 -- 사용자에게 묻습니다")
                      + (f" · 폴더 {conf['web_dir']}/{SITE_LABELS['data-light']}/" if conf.get("mode") == "service" else ""))
                return 0
            r = publish(root, "data-light", lambda out: build_site(a.model, out, hosting="static"), push=not a.dry_run)
        except (PublishError, ValueError, OSError) as exc:
            print(f"공개하지 않았습니다: {exc}")
            return 1
        for line in publish_lines(r, "data-light", cmd=f"datalight.py publish {a.model}"):
            print(line)
        return 0 if r.get("state") in ("written", "same", "pushed", "ready", "off") else (2 if r.get("state") == "unset" else 1)
    if a.cmd == "site":
        try:
            guard_light(site_root(a.model), "data-light")         # dev-process-light 가 데이터 쪽을 함께 만든다 -- 같은 쪽을 두 번 만들지 않는다
            r = build_site(a.model, a.out)
        except ValueError as exc:
            print(f"사이트를 만들지 않았습니다: {exc}")
            return 1
        print(f"개발 관리 사이트 → {r['index']} (쪽 {r['pages']} · 빈칸 {r['blanks']} · 화면 틀 {r['shell']}) -- 브라우저로 이 파일을 엽니다")
        return 0
    if a.cmd == "check":
        errs, warns = check(load(a.model))
        for w in warns:
            print("참고  " + w)
        for e in errs:
            print("고칠것 " + e)
        print(f"결과: 고칠 것 {len(errs)}개 · 참고 {len(warns)}개" + (" -- 좋아요!" if not errs else ""))
        return 1 if errs else 0
    if a.cmd == "split":
        m = load(a.model)
        moved = split(m)
        print("\n".join(moved) if moved else "나눌 개인정보 칸이 없습니다")
        if a.write and moved:
            save(m, a.model)
            print(f"저장: {a.model}")
        elif moved:
            print("(미리보기 -- 저장하려면 --write)")
        return 0
    if a.cmd == "build":
        m = load(a.model)
        errs, _ = check(m)
        if errs:
            print("check 오류를 먼저 고치세요:\n- " + "\n- ".join(errs))
            return 1
        out = a.out or str(Path(a.model).parent / "out")
        files = build(m, out, a.db)
        print(f"만듦 → {out}: {', '.join(files)}")
        return 0
    if a.cmd == "try":
        m = load(a.model)
        errs, _ = check(m)
        if errs:
            print("check 오류를 먼저 고치세요:\n- " + "\n- ".join(errs))
            return 1
        ok, lines = try_sqlite(m)
        print("\n".join(lines))
        print("결과: " + ("규칙이 모두 제대로 막습니다" if ok else "실패한 줄을 확인하세요"))
        return 0 if ok else 1
    if a.cmd == "import":
        if a.sub == "plan":
            plan = import_plan(a.file, a.table, a.label, a.sheet)
            save(plan, a.out)
            print(f"계획 → {a.out}: {plan['rows']}행, 칸 {len(plan['columns'])}개")
            for c in plan["columns"]:
                print(f"  {c['src']:<16} → {c['name'] or '(이름 필요)':<16} {TYPE_KO[c['type']]:<8}"
                      + (f" 개인정보:{c['personal']}" if c['personal'] else ""))
            for n in plan["notes"][:2]:
                print("참고: " + n)
            return 0
        if a.sub == "schema":
            if os.path.exists(a.out) and not a.force:
                print(f"{a.out} 가 이미 있습니다 -- 덮어쓰려면 --force (다른 이름은 --out)")
                return 1
            m, issues = schema_to_model(a.db)
            save(m, a.out)
            print(f"초안 → {a.out}: 표 {len(m['tables'])}개. 한글 이름표(label)·성공 기준(goals)은 사람과 함께 채웁니다")
            for i in issues:
                print("확인: " + i)
            return 0
        log = import_apply(load(a.plan), a.model, a.db, a.approval, a.append, a.file, a.force_sqlite)
        print(json.dumps(log, ensure_ascii=False, indent=2))
        return 0
    if a.cmd == "verify":
        ok, lines = verify(a.model, a.db, not a.no_db, a.mutate)
        print("\n".join(lines))
        return 0 if ok else 1
    if a.cmd == "hook" and a.sub == "status":
        same, lines = hook_status(a.repo)
        print("\n".join(lines))
        return 0 if same else 1
    if a.cmd == "hook":
        res = hook_install(a.repo, a.ci, a.append, a.update, a.keep)
        for d in res:
            print(d if d.startswith(ASK) else "만듦: " + d)
        print("이제 정본을 고쳐 커밋하면 verify 가 자동으로 돕니다. 시험: 정본에 일부러 오류를 넣고 커밋해 보세요")
        if any(d.startswith(ASK) for d in res):
            print("위 '물어볼 것'은 사용자에게 물어 그 답대로 다시 실행한다 (답은 dev-notes/DECISIONS.md 에 [사용자] 로)")
            return 3
        return 0
    if a.cmd == "upgrade":
        if a.facts and os.path.exists(a.facts):
            print(f"{a.facts} 가 이미 있습니다 -- 덮어쓰지 않습니다 (전문판의 facts.py answer 로 넣으세요). 아무것도 만들지 않았습니다")
            return 1
        if a.blueprint and os.path.exists(a.blueprint):
            print(f"{a.blueprint} 가 이미 있습니다 -- 덮어쓰지 않습니다 (전문판에서 고칩니다). 아무것도 만들지 않았습니다")
            return 1
        full = upgrade(load(a.model), a.schema, a.pi_schema)
        save(full, a.out)
        print(f"전문판 정본 → {a.out}: 테이블 {len(full['tables'])}개 · 단어 {len(full['words'])}개 "
              "(단어의 한글명·약어는 전문판 공통 사전 대조에서 정리)")
        if a.facts:
            fx = upgrade_facts(load(a.model))
            if fx is None:
                print(f"만드는 것(product)이 {UNDETERMINED} 라 질문 대장은 만들지 않았습니다 -- 전문판에서 data.product_type 을 묻습니다")
            else:
                save(fx, a.facts)
                print(f"질문 대장 → {a.facts}: " + ", ".join(f"{k}@1" for k in fx["facts"]))
        if a.blueprint:
            bp = upgrade_blueprint(load(a.model))
            save(bp, a.blueprint)
            print(f"시스템 청사진 → {a.blueprint}: 기능(하는 일) {len(bp['features'])} · 화면 {len(bp['screens'])} · 역할 {len(bp['system']['roles'])}"
                  " (업무 단계·요청·API 는 전문판에서 사용자와 정리)")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
