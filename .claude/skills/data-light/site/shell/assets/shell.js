/* 개발 관리 사이트 -- 공통 화면 틀 (outputs-shell). 원본: data-expert-framework runtime/outputs-shell -- 사본은 고치지 않는다.
   data/site.js (메뉴·프로젝트) 와 data/<쪽>.js (쪽 머리 + body.sections) 를 읽어 그린다. 서버 모드(http)와 파일 모드(file://) 둘 다.
   공개본(site.hosting = "static" -- 서비스 주소 아래 · GitHub Pages 에 올린 것)은 http 로 열어도 사이트 서버가 없다: 실시간 반영 · 로컬 설정 · 불러 보기를 하지 않는다.
   모든 글은 textContent 로 넣는다 (HTML 문자열로 넣지 않음). 링크는 사이트 안 상대 주소와 http(s) 만. */
(function () {
  "use strict";
  var O = window.OUTPUTS || {};
  var SITE = O.site || null;
  var PAGE = O.page || null;
  var B = document.body;
  var BASE = B.getAttribute("data-base") || "";
  var FILE = location.protocol === "file:";
  var STATIC = !FILE && (B.getAttribute("data-hosting") === "static" || (!!SITE && SITE.hosting === "static"));   // 공개본 -- 사이트 서버(/__outputs/*)가 없다 (쪽에도 표시: 자료를 못 읽어도 안다)
  var MARK = SITE ? SITE.mark : null;
  var STATES = {
    user: "사용자 확인", ai_draft: "AI 초안 · 확인 전", proxy: "대리 확인 · 사용자 확인 필요",
    changed: "확인 뒤 바뀜", empty: "재료 없음", computed: "계산한 쪽"
  };

  // ------------------------------------------------------------ 작은 도구
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k) || attrs[k] == null || attrs[k] === false) continue;
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = String(attrs[k]);
        else if (k === "style") n.style.cssText = String(attrs[k]);   // CSSOM 으로 -- 서버의 CSP(style-src 'self')가 style 속성을 막는다
        else n.setAttribute(k, attrs[k] === true ? "" : String(attrs[k]));
      }
    }
    add(n, kids);
    return n;
  }
  function add(n, kids) {
    if (kids == null) return n;
    if (!Array.isArray(kids)) kids = [kids];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i];
      if (c == null || c === false) continue;
      n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return n;
  }
  function safeHref(p) {
    // 생성기가 만드는 링크 모양만: 사이트 안 상대 경로(영문·숫자·_.~-) + #앵커, 또는 http(s) 주소.
    // 공백·제어 문자·역슬래시가 하나라도 있으면 쓰지 않는다 -- 브라우저는 그것을 지운 뒤 'javascript:' 등으로 읽는다.
    if (p == null) return null;
    p = String(p);
    if (/[\x00-\x20\x7f\\]/.test(p)) return null;
    if (/^https?:\/\/[^\/]/i.test(p)) return p;
    var i = p.indexOf("#"), path = i >= 0 ? p.slice(0, i) : p;
    if (!/^(?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]*$/.test(path)) return null;   // 조각/ 의 되풀이 -- 되짚기가 폭발하지 않게
    if (path.split("/").indexOf("..") >= 0 || path.split("/").indexOf(".") >= 0) return null;
    return p;
  }
  function href(p) {
    p = safeHref(p);
    if (p == null) return null;
    if (/^https?:/i.test(p)) return p;
    if (p.charAt(0) === "#") return p;
    var hash = "", i = p.indexOf("#");
    if (i >= 0) { hash = p.slice(i); p = p.slice(0, i); }
    if ((FILE || STATIC) && (p === "" || p.charAt(p.length - 1) === "/")) p += "index.html";   // 파일 · 공개본: 폴더 주소가 index.html 을 열지 않는 곳이 있다
    return BASE + p + hash;
  }
  function link(p, kids, cls) {
    var h = href(p);
    if (!h) return el("span", { "class": cls }, kids);
    var a = el("a", { href: h, "class": cls }, kids);
    if (/^https?:/i.test(h)) { a.setAttribute("rel", "noopener noreferrer"); a.setAttribute("target", "_blank"); }
    return a;
  }
  function when(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    function z(x) { return (x < 10 ? "0" : "") + x; }
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + " " + z(d.getHours()) + ":" + z(d.getMinutes());
  }
  function store(k, v) {
    try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  }

  // ------------------------------------------------------------ 값 하나 (표 칸·이름-값)
  function ops(s) {
    var f = document.createDocumentFragment();
    String(s || "").split("").forEach(function (c) {
      if ("CRUD".indexOf(c) >= 0) f.appendChild(el("span", { "class": "op op-" + c, title: { C: "만든다", R: "읽는다", U: "고친다", D: "지운다" }[c], text: c }));
    });
    return f;
  }
  function inl(v) {
    if (v == null || v === "") return el("span", { "class": "nul", text: "—" });
    if (typeof v === "boolean") return document.createTextNode(v ? "예" : "아니오");
    if (typeof v !== "object") return document.createTextNode(String(v));
    if (!Array.isArray(v) && (MARK == null || v._ !== MARK)) return document.createTextNode(JSON.stringify(v));   // 이번 빌드의 표시가 있는 값만 링크·배지로 (정본의 글은 글로)
    if (Array.isArray(v)) {
      var f = document.createDocumentFragment();
      if (!v.length) return el("span", { "class": "nul", text: "—" });
      var objs = v.every(function (x) { return x && typeof x === "object"; });
      v.forEach(function (x, i) {
        if (i) f.appendChild(document.createTextNode(objs ? " " : ", "));
        f.appendChild(inl(x));
      });
      return f;
    }
    if (v.op != null) return ops(v.op);
    if (v.img != null) {                                   // 그림 -- 사이트 안 파일만 (생성기가 함께 쓴 캡처)
      var src = href(v.img);
      if (!src || /^https?:/i.test(src)) return el("span", { "class": "nul", text: v.alt || "—" });
      var im = el("img", { src: src, alt: v.alt || "", loading: "lazy", "class": "o-img" });
      return v.href != null ? link(v.href, im) : im;
    }
    if (v.local != null)                                   // 이 컴퓨터에서 연 화면에서만 채워지는 값 (로컬 설정의 주소·포트)
      return el("span", { "class": "o-localv", "data-local": String(v.local), title: "로컬 설정의 값 -- 이 컴퓨터에서 서버로 연 화면에서만 보입니다",
        text: v.t == null ? "<서비스 주소>" : String(v.t) });
    if (v.list) {
      if (v.list.length === 1) return inl(v.list[0]);
      var ul = el("ul", { "class": "o-lines" });
      v.list.forEach(function (x) { ul.appendChild(el("li", null, inl(x))); });
      return ul;
    }
    var label = v.t == null ? "" : String(v.t);
    var node;
    if (v.chip) {
      node = link(v.href, [v.kind ? el("i", { text: v.kind }) : null, label], "o-chip");
    } else if (v.badge) {
      node = el("span", { "class": "o-badge " + (v.tone || ""), text: label });
    } else {
      var inner = v.mono ? el("code", { text: label }) : document.createTextNode(label);
      node = v.href != null ? link(v.href, inner) : el("span", { "class": v.tone ? "tone-" + v.tone : null }, inner);
    }
    if (v.title) node.setAttribute("title", String(v.title));
    if (v.sub) {
      var f2 = document.createDocumentFragment();
      f2.appendChild(node);
      f2.appendChild(document.createTextNode(" "));
      f2.appendChild(el("small", { "class": "tone-mute", text: v.sub }));
      return f2;
    }
    return node;
  }

  // ------------------------------------------------------------ 절 그리기
  var R = {};
  R.text = function (s) { return el("p", { "class": "o-text " + (s.tone || "") }, inl(s.text)); };
  R.cards = function (s) {
    var g = el("div", { "class": "o-cards" });
    (s.items || []).forEach(function (c) {
      var kids = [el("b", { text: c.value == null ? "—" : c.value }), el("span", { text: c.label }), c.sub ? el("small", { text: c.sub }) : null];
      g.appendChild(c.href != null ? link(c.href, kids, "o-card " + (c.tone || "")) : el("div", { "class": "o-card " + (c.tone || "") }, kids));
    });
    return g;
  };
  R.kv = function (s) {
    var dl = el("dl", { "class": "o-kv" });
    (s.items || []).forEach(function (it) {
      dl.appendChild(el("dt", { text: it[0] }));
      dl.appendChild(el("dd", null, inl(it[1])));
    });
    return dl;
  };
  var TONES = { bad: 1, warn: 1, ok: 1 };
  R.table = function (s) {
    var cols = s.columns || [], rows = s.rows || [];
    if (!rows.length) return el("div", { "class": "o-tw" }, el("div", { "class": "o-empty-row", text: s.empty || "없음" }));
    var thead = el("tr");
    cols.forEach(function (c) { thead.appendChild(el("th", { "class": c.num ? "num" : null, scope: "col", text: c.label })); });
    var tb = el("tbody"), last = null, grp = null, trs = [];
    rows.forEach(function (r) {
      if (s.group && r[s.group] !== last) {
        last = r[s.group];
        grp = el("tr", { "class": "grp" }, el("td", { colspan: cols.length }, inl(last)));
        grp._rows = [];
        tb.appendChild(grp);
      }
      var tr = el("tr", { id: r._id || null, "class": TONES[r._tone] ? "row-" + r._tone : null });   // 줄 색 -- 끊긴 곳(bad) · 손볼 곳(warn)
      cols.forEach(function (c) {
        var v = r[c.key];
        tr.appendChild(el("td", { "class": (c.num ? "num" : "") + (c.nw ? " nw" : "") || null }, c.quiet && (v == null || v === "") ? null : inl(v)));
      });
      if (grp) grp._rows.push(tr);
      trs.push(tr);
      tb.appendChild(tr);
    });
    var hd = el("thead", null, thead);
    var table = el("div", { "class": "o-tw" }, el("table", { "class": "o-t" }, [hd, tb]));
    if (!s.filter) return table;
    // 거르기 -- 칸마다 글자로 (어느 칸에서 시작해도), 끊긴 줄만
    var fr = el("tr", { "class": "o-filter" }), inputs = [];
    cols.forEach(function (c) {
      var inp = el("input", { type: "search", placeholder: "거르기", "aria-label": (c.label || "칸") + " 거르기", autocomplete: "off" });
      inputs.push(inp);
      fr.appendChild(el("th", { "class": c.num ? "num" : null }, inp));
    });
    hd.appendChild(fr);
    var texts = trs.map(function (tr) { return [].map.call(tr.children, function (td) { return (td.textContent || "").toLowerCase(); }); });
    var hasBad = trs.some(function (tr) { return tr.classList.contains("row-bad"); });
    var only = hasBad ? el("input", { type: "checkbox" }) : null;
    var count = el("span", { "class": "o-fcount", "aria-live": "polite" });
    function apply() {
      var qs = inputs.map(function (x) { return x.value.trim().toLowerCase(); }), n = 0;
      trs.forEach(function (tr, k) {
        var ok = qs.every(function (q, i) { return !q || (texts[k][i] || "").indexOf(q) >= 0; }) && !(only && only.checked && !tr.classList.contains("row-bad"));
        tr.hidden = !ok;
        if (ok) n += 1;
      });
      [].forEach.call(tb.querySelectorAll("tr.grp"), function (g) { g.hidden = !(g._rows || []).some(function (tr) { return !tr.hidden; }); });
      count.textContent = n === trs.length ? "줄 " + n : n + " / " + trs.length + " 줄";
    }
    inputs.forEach(function (x) { x.addEventListener("input", apply); });
    if (only) only.addEventListener("change", apply);
    apply();
    return el("div", null, [el("div", { "class": "o-fbar" }, [count, only ? el("label", null, [only, " " + (s.filter_bad || "끊긴 줄만")]) : null]), table]);
  };
  R.shots = function (s) {                                 // 화면 캡처 -- 사이트 안 그림 파일 (없으면 '캡처 없음')
    var g = el("div", { "class": "o-shots" });
    (s.items || []).forEach(function (it) {
      var src = it.img ? href(it.img) : null;
      var pic = src && !/^https?:/i.test(src) ? el("a", { href: src, target: "_blank", rel: "noopener" }, el("img", { src: src, alt: it.alt || it.caption || "", loading: "lazy" }))
        : el("div", { "class": "o-shot-none", text: it.none || "캡처 없음" });
      g.appendChild(el("figure", { "class": "o-shot", id: it.id || null }, [pic,
        el("figcaption", null, [it.href != null ? link(it.href, el("b", { text: it.caption || "" })) : el("b", { text: it.caption || "" }),
          it.sub ? el("small", null, inl(it.sub)) : null])]));
    });
    if (!(s.items || []).length) g.appendChild(el("div", { "class": "o-empty-row", text: s.empty || "없음" }));
    return g;
  };
  R.list = function (s) {
    var ul = el("ul", { "class": "o-list" });
    (s.items || []).forEach(function (it) {
      if (typeof it !== "object" || it === null || Array.isArray(it)) { ul.appendChild(el("li", null, inl(it))); return; }
      ul.appendChild(el("li", null, [it.badge ? el("span", { "class": "o-badge " + (it.tone || ""), text: it.badge }) : null,
        it.href != null ? link(it.href, it.text) : el("span", null, inl(it.text)), it.sub ? el("small", null, inl(it.sub)) : null]));
    });
    if (!(s.items || []).length) ul.appendChild(el("li", { "class": "nul", text: s.empty || "없음" }));
    return ul;
  };
  R.todo = function (s) {
    var ul = el("ul", { "class": "o-todo" });
    (s.items || []).forEach(function (it) {
      ul.appendChild(el("li", { "class": it.tone || null }, [it.href != null ? link(it.href, it.text) : el("span", null, inl(it.text)),
        it.sub ? el("small", { "class": "tone-mute" }, inl(it.sub)) : null]));
    });
    if (!(s.items || []).length) ul.appendChild(el("li", { "class": "ok", text: s.empty || "지금 할 일이 없습니다" }));
    return ul;
  };
  R.bars = function (s) {
    var g = el("div", { "class": "o-bars" });
    (s.items || []).forEach(function (b) {
      var tot = Number(b.total) || 0, done = Number(b.done) || 0;
      var pct = tot ? Math.round(done * 100 / tot) : 0;
      var kids = [el("span", { "class": "lab" }, [b.label, b.sub ? el("small", { "class": "tone-mute", text: " " + b.sub }) : null]),
        el("span", { "class": "track", role: "img", "aria-label": done + " / " + tot }, el("i", { style: "width:" + pct + "%" })),
        el("span", { "class": "num", text: tot ? done + " / " + tot : "—" })];
      var cls = "o-bar" + (tot && done < tot ? " part" : "");
      g.appendChild(b.href != null ? link(b.href, kids, cls) : el("div", { "class": cls }, kids));
    });
    return g;
  };
  R.flow = function (s) {
    var g = el("div", { "class": "o-flow" });
    (s.rows || []).forEach(function (r) {
      var steps = el("div", { "class": "o-steps" });
      (r.steps || []).forEach(function (st) {
        steps.appendChild(el("div", { "class": "o-step" + (st.manual ? " manual" : ""), id: st.id || null },
          [st.href != null ? link(st.href, el("b", { text: st.name })) : el("b", { text: st.name }), st.who ? el("div", { "class": "who", text: st.who }) : null,
            st.sub ? el("div", null, inl(st.sub)) : null]));
      });
      g.appendChild(el("div", { "class": "row", id: r.id || null }, [
        el("div", { "class": "pn" }, [r.href != null ? link(r.href, el("b", { text: r.name })) : el("b", { text: r.name }), r.sub ? el("span", null, inl(r.sub)) : null]),
        steps]));
    });
    return g;
  };
  R.matrix = function (s) {
    var cols = s.cols || [], rows = s.rows || [];
    if (!rows.length || !cols.length) return el("div", { "class": "o-tw" }, el("div", { "class": "o-empty-row", text: s.empty || "없음" }));
    var head = el("tr", null, el("th", { scope: "col", text: s.corner || "" }));
    cols.forEach(function (c) { head.appendChild(el("th", { "class": "col", scope: "col" }, [c.href != null ? link(c.href, c.label) : c.label, c.sub ? el("small", { text: c.sub }) : null])); });
    var tb = el("tbody"), last = null;
    rows.forEach(function (r) {
      if (r.group != null && r.group !== last) { last = r.group; tb.appendChild(el("tr", { "class": "grp" }, el("td", { colspan: cols.length + 1 }, inl(r.group)))); }
      var tr = el("tr", null, el("td", { "class": "first" }, [r.href != null ? link(r.href, r.label) : el("span", { text: r.label }), r.sub ? el("small", { "class": "tone-mute", text: " " + r.sub }) : null]));
      cols.forEach(function (c) {
        var v = (r.cells || {})[c.key];
        tr.appendChild(el("td", { "class": "c" }, v == null || v === "" ? null : (s.text ? inl(v) : ops(v))));
      });
      tb.appendChild(tr);
    });
    var wrap = el("div");
    if (s.legend) wrap.appendChild(el("div", { "class": "o-legend" }, s.legend.map(function (x) { return el("span", null, inl(x)); })));
    else if (!s.text) wrap.appendChild(el("div", { "class": "o-legend" }, [ops("C"), " 만든다", ops("R"), " 읽는다", ops("U"), " 고친다", ops("D"), " 지운다"]));
    wrap.appendChild(el("div", { "class": "o-tw" }, el("table", { "class": "o-t o-mx" }, [el("thead", null, head), tb])));
    return wrap;
  };
  // 업무 레인 -- 업무마다 역할 줄 × 단계 칸 (누가 어느 차례에 무엇을)
  R.lanes = function (s) {
    var box = el("div", { "class": "o-lanes" });
    (s.rows || []).forEach(function (r) {
      var n = Math.max(1, r.cols || 1);
      var grid = el("div", { "class": "o-lane-grid", style: "--n:" + n });
      grid.appendChild(el("div", { "class": "o-lane-head" }, ""));
      for (var i = 0; i < n; i++) grid.appendChild(el("div", { "class": "o-lane-head", text: (i + 1) + "" }));
      (r.lanes || []).forEach(function (ln) {
        grid.appendChild(el("div", { "class": "o-lane-who" + (ln.system ? " sys" : "") }, [el("b", { text: ln.who || "" }), ln.sub ? el("small", { text: ln.sub }) : null]));
        for (var k = 0; k < n; k++) {
          var st = (ln.cells || [])[k];
          if (!st) { grid.appendChild(el("div", { "class": "o-lane-cell empty" })); continue; }
          grid.appendChild(el("div", { "class": "o-lane-cell" }, el("div", { "class": "o-step" + (st.manual ? " manual" : ""), id: st.id || null }, [
            st.href != null ? link(st.href, el("b", { text: st.name })) : el("b", { text: st.name }),
            st.sub ? el("div", null, inl(st.sub)) : null,
            st.io ? el("div", { "class": "who" }, inl(st.io)) : null,
            st.parts && st.parts.length ? el("div", { "class": "parts" }, inl(st.parts)) : null])));
        }
      });
      box.appendChild(el("div", { "class": "o-lane", id: r.id || null }, [
        el("div", { "class": "o-lane-title" }, [r.href != null ? link(r.href, el("b", { text: r.name })) : el("b", { text: r.name }), r.sub ? el("span", null, inl(r.sub)) : null]),
        el("div", { "class": "o-tw" }, grid)]));
    });
    if (!(s.rows || []).length) box.appendChild(el("div", { "class": "o-empty-row", text: s.empty || "없음" }));
    return box;
  };

  // 층 그림 -- cols: [{id,label}] · nodes: [{id,col,label,sub,sub2,cls,href,title}] · edges: [{from,to,label,cls,title}] · dir: right|down
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, kids) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null && attrs[k] !== false) n.setAttribute(k, String(attrs[k]));
    (kids || []).forEach(function (c) { if (c != null && c !== "") n.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); });
    return n;
  }
  function textW(t, fs) { var w = 0; String(t || "").split("").forEach(function (ch) { w += /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff]/.test(ch) ? fs : fs * 0.58; }); return w; }
  function fit(t, px, fs) { t = String(t || ""); if (textW(t, fs) <= px) return t; var out = ""; for (var i = 0; i < t.length; i++) { if (textW(out + t[i] + "…", fs) > px) break; out += t[i]; } return out + "…"; }
  R.diagram = function (s) {
    var W0 = s.w || 200, GAP = s.gap || 70, VG = 14, down = s.dir === "down";
    var cols = s.cols || [], nodes = s.nodes || [], edges = s.edges || [];
    var colIx = {}; cols.forEach(function (c, i) { colIx[String(c.id)] = i; });
    var by = {}, used = [];
    nodes.forEach(function (n) { var ci = colIx[String(n.col)]; if (ci == null) return; (by[ci] = by[ci] || []).push(n); });
    cols.forEach(function (c, i) { if (by[i]) used.push(i); });
    if (!used.length) return el("div", { "class": "o-tw" }, el("div", { "class": "o-empty-row", text: s.empty || "그릴 것이 없습니다" }));
    function h(n) { return 30 + (n.sub ? 16 : 0) + (n.sub2 ? 16 : 0); }
    var pos = {}, LBL = down ? 96 : 0;
    function place() {
      if (!down) {
        used.forEach(function (ci, k) { var y = 44; by[ci].forEach(function (n) { pos[n.id] = { x: 20 + k * (W0 + GAP), y: y, h: h(n), n: n, layer: k }; y += h(n) + VG; }); });
        return;
      }
      var widest = Math.max.apply(null, used.map(function (ci) { return by[ci].length; })), y = 16;
      used.forEach(function (ci, k) {
        var rh = Math.max.apply(null, by[ci].map(h)), off = (widest - by[ci].length) * (W0 + GAP) / 2;
        by[ci].forEach(function (n, i) { pos[n.id] = { x: LBL + 20 + off + i * (W0 + GAP), y: y, h: rh, n: n, layer: k }; });
        y += rh + GAP;
      });
    }
    place();
    for (var it = 0; it < 4; it++) {                                  // 이어진 상자끼리 가깝게 (무게 중심 정렬)
      used.forEach(function (ci) {
        by[ci] = by[ci].map(function (n, i) {
          var me = pos[n.id], ps = [];
          edges.forEach(function (e) { var o = e.from === n.id ? e.to : (e.to === n.id ? e.from : null); if (o && pos[o] && pos[o].layer !== me.layer) ps.push(pos[o]); });
          var c = ps.length ? ps.reduce(function (a, p) { return a + (down ? p.x + W0 / 2 : p.y + p.h / 2); }, 0) / ps.length : (down ? me.x : me.y);
          return [n, c, i];
        }).sort(function (a, b) { return a[1] - b[1] || a[2] - b[2]; }).map(function (x) { return x[0]; });
      });
      place();
    }
    var P = Object.keys(pos).map(function (k) { return pos[k]; });
    // 층을 건너뛰는 선은 상자를 가로지르지 않게 바깥으로 돌린다 (아래로: 오른쪽 · 오른쪽으로: 아래쪽)
    var maxR = Math.max.apply(null, P.map(function (p) { return p.x + W0; })), maxB = Math.max.apply(null, [80].concat(P.map(function (p) { return p.y + p.h; })));
    var nLong = edges.filter(function (e) { return pos[e.from] && pos[e.to] && Math.abs(pos[e.from].layer - pos[e.to].layer) > 1; }).length, kLong = 0;
    var W = maxR + 60 + (down && nLong ? 30 + nLong * 16 : 0), H = maxB + 24 + (!down && nLong ? 30 + nLong * 16 : 0);
    var svg = sv("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, "class": "o-dia-svg", role: "img", "aria-label": s.title || "그림" }, [
      sv("defs", null, [sv("marker", { id: "o-ah", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, [sv("path", { d: "M0,0 L10,5 L0,10 z", "class": "o-ah" })])])]);
    used.forEach(function (ci) {
      var first = pos[by[ci][0].id];
      svg.appendChild(down ? sv("text", { x: 10, y: first.y + first.h / 2 + 4, "class": "o-dia-col" }, [cols[ci].label]) : sv("text", { x: first.x, y: 26, "class": "o-dia-col" }, [cols[ci].label]));
    });
    var eg = sv("g"), lab = sv("g"), taken = [];
    var boxes = P.map(function (p) { return [p.x - 4, p.y - 4, p.x + W0 + 4, p.y + p.h + 4]; });
    function free(r) { return !boxes.concat(taken).some(function (b) { return r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]; }); }
    function bez(p0, p1, p2, p3, t) { var u = 1 - t; return [u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]; }
    edges.forEach(function (e) {
      var a = pos[e.from], b = pos[e.to], p0, p1, p2, p3;
      if (!a || !b) return;
      if (Math.abs(a.layer - b.layer) > 1) {
        var g = 30 + (kLong++) * 16;
        if (down) { p0 = [a.x + W0, a.y + a.h / 2]; p3 = [b.x + W0 + 2, b.y + b.h / 2]; p1 = [maxR + g, p0[1]]; p2 = [maxR + g, p3[1]]; }
        else { p0 = [a.x + W0 / 2, a.y + a.h]; p3 = [b.x + W0 / 2, b.y + b.h + 2]; p1 = [p0[0], maxB + g]; p2 = [p3[0], maxB + g]; }
      } else if (down) {
        if (a.layer !== b.layer) {
          var up = a.layer > b.layer;
          p0 = [a.x + W0 / 2, up ? a.y : a.y + a.h]; p3 = [b.x + W0 / 2, up ? b.y + b.h + 2 : b.y - 2];
          var c = (p3[1] - p0[1]) / 2; p1 = [p0[0], p0[1] + c]; p2 = [p3[0], p3[1] - c];
        } else { var l = a.x < b.x; p0 = [l ? a.x + W0 : a.x, a.y + a.h / 2]; p3 = [l ? b.x - 2 : b.x + W0 + 2, b.y + b.h / 2]; p1 = [(p0[0] + p3[0]) / 2, p0[1]]; p2 = [(p0[0] + p3[0]) / 2, p3[1]]; }
      } else {
        var y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
        if (a.x < b.x) { p0 = [a.x + W0, y1]; p3 = [b.x - 2, y2]; var cc = (p3[0] - p0[0]) / 2; p1 = [p0[0] + cc, y1]; p2 = [p3[0] - cc, y2]; }
        else if (a.x > b.x) { p0 = [a.x, y1]; p3 = [b.x + W0 + 2, y2]; var cb = (p0[0] - p3[0]) / 2 + 30; p1 = [p0[0] - cb, y1]; p2 = [p3[0] + cb, y2]; }
        else { var kk = 26 + Math.min(40, Math.abs(y2 - y1) / 6); p0 = [a.x + W0, y1]; p3 = [a.x + W0 + 2, y2]; p1 = [p0[0] + kk, y1]; p2 = [p0[0] + kk, y2]; }
      }
      var g = sv("g", { "class": "o-edge " + (e.cls || "") }, [sv("path", { d: "M" + p0 + " C" + p1 + " " + p2 + " " + p3, "marker-end": "url(#o-ah)" })]);
      if (e.title || e.label) g.appendChild(sv("title", null, [e.title || e.label]));
      eg.appendChild(g);
      if (e.label) {
        var t = fit(e.label, 110, 11), w = textW(t, 11) + 10, ts = [0.5, 0.35, 0.65, 0.22, 0.78];
        for (var q = 0; q < ts.length; q++) {
          var m = bez(p0, p1, p2, p3, ts[q]), r = [m[0] - w / 2, m[1] - 9, m[0] + w / 2, m[1] + 7];
          if (free(r)) { taken.push(r); lab.appendChild(sv("rect", { x: r[0], y: r[1], width: w, height: 16, rx: 3, "class": "o-elab-bg" })); lab.appendChild(sv("text", { x: m[0], y: m[1] + 3.5, "class": "o-elab" }, [t])); break; }
        }
      }
    });
    svg.appendChild(eg);
    P.forEach(function (p) {
      var n = p.n, hh = href(n.href);
      var g = sv(hh ? "a" : "g", { href: hh, "class": "o-node " + (n.cls || "") }, [
        sv("rect", { x: p.x, y: p.y, width: W0, height: p.h, rx: 6 }),
        sv("text", { x: p.x + 10, y: p.y + 20, "class": "o-nl" }, [fit(n.label, W0 - 20, 13)]),
        n.sub ? sv("text", { x: p.x + 10, y: p.y + 37, "class": "o-ns" }, [fit(n.sub, W0 - 20, 11.5)]) : null,
        n.sub2 ? sv("text", { x: p.x + 10, y: p.y + 53, "class": "o-ns" }, [fit(n.sub2, W0 - 20, 11.5)]) : null,
        sv("title", null, [[n.label, n.sub, n.sub2, n.title].filter(Boolean).join("\n")])]);
      svg.appendChild(g);
    });
    svg.appendChild(lab);
    var wrap = el("div");
    var lg = (s.edge_legend || []).map(function (x) { return el("span", null, [el("span", { "class": "sw " + String(x.cls || "") }), String(x.label || "")]); });
    (s.legend || []).forEach(function (x) { lg.push(el("span", null, inl(x))); });
    if (lg.length) wrap.appendChild(el("div", { "class": "o-legend" }, lg));
    wrap.appendChild(el("div", { "class": "o-dia" }, svg));
    return wrap;
  };

  R.tree = function (s) {
    function node(n) {
      var li = el("li", null, el("span", { "class": "node" }, [n.kind ? el("i", { text: n.kind }) : null, n.href != null ? link(n.href, n.label) : el("b", { text: n.label }),
        n.sub ? el("small", { text: n.sub }) : null, n.badge ? el("span", { "class": "o-badge " + (n.tone || ""), text: n.badge }) : null]));
      if (n.children && n.children.length) {
        var ul = el("ul");
        n.children.forEach(function (c) { ul.appendChild(node(c)); });
        li.appendChild(ul);
      }
      return li;
    }
    var ul = el("ul", { "class": "o-tree" });
    (s.roots || (s.root ? [s.root] : [])).forEach(function (r) { ul.appendChild(node(r)); });
    return ul;
  };
  R.frame = function (s) {
    var h = href(s.src);
    var wrap = el("div");
    wrap.appendChild(el("div", { "class": "o-frame-bar" }, [h ? el("a", { href: h, target: "_blank", rel: "noopener", text: "새 창으로 열기" }) : null, s.note ? el("span", { text: s.note }) : null]));
    if (h) wrap.appendChild(el("iframe", { "class": "o-frame", src: h, title: s.frame_title || s.title || "", style: "height:" + (Number(s.height) || 640) + "px", loading: "lazy" }));
    return wrap;
  };
  // ------------------------------------------------------------ 불러 보기 (서버로 연 사이트에서만 -- 사이트 서버가 그 환경의 실제 주소로 대신 보낸다)
  var TARGETS = [["runtime", "런타임 데이터 API (/v1/q)"], ["app", "앱 (계약의 경로)"]];
  R.try = function (s) {
    var box = el("div", { "class": "o-try" });
    box.appendChild(el("p", { "class": "o-try-kind" }, [el("span", { "class": "o-badge " + (s.write ? "warn" : "ok"), text: s.write ? "쓰기 API" : "읽기 API" }), " ",
      s.write ? "환경마다 쓰기를 켜야 보냅니다 -- 보낼 때마다 확인합니다." : "운영 환경은 조회도 따로 켜야 보냅니다."]));
    var ul = el("ul", { "class": "o-lines" });
    TARGETS.forEach(function (t) {
      var why = (s.locks || {})[t[0]];
      ul.appendChild(el("li", null, [el("b", { text: t[1] }), " ", why ? el("span", { "class": "tone-mute", text: "-- " + why }) : el("span", { "class": "tone-ok", text: "-- 보낼 수 있음" })]));
    });
    box.appendChild(ul);
    if (FILE) {
      box.appendChild(el("p", { "class": "o-text warn", text: "파일로 연 사이트에서는 보내지 않습니다 -- 서버로 엽니다 (python outputs.py serve --root .). 아래 curl 예시는 그대로 쓸 수 있습니다." }));
      return box;
    }
    if (STATIC) {
      box.appendChild(el("p", { "class": "o-text note", text: "공개한 사이트에서는 보내지 않습니다 -- 개발하는 컴퓨터의 개발 관리 사이트(서버로 연 것)에서 불러 봅니다. 아래 curl 예시는 그대로 쓸 수 있습니다." }));
      return box;
    }
    var btn = el("button", { type: "button", "class": "o-btn primary", text: "불러 보기 열기" });
    btn.addEventListener("click", function () { openTry(s); });
    box.appendChild(btn);
    if (location.hash === "#try") setTimeout(function () { openTry(s); }, 0);
    return box;
  };

  function openTry(s) {
    var dlg = el("dialog", { "class": "o-dialog", "aria-label": "불러 보기 -- " + s.api });
    var close = el("button", { type: "button", "class": "o-btn", text: "닫기" });
    close.addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("close", function () { if (dlg.parentNode) dlg.parentNode.removeChild(dlg); });   // 토큰 칸도 함께 사라진다
    dlg.appendChild(el("div", { "class": "o-dlg-head" }, [el("h2", null, [s.api, el("small", { text: [s.method, s.path].filter(Boolean).join(" ") })]), close]));
    var body = el("div", { "class": "o-dlg-body" }, el("p", { "class": "o-text note", text: "환경을 읽는 중…" }));
    dlg.appendChild(body);
    document.body.appendChild(dlg);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    fetch(BASE + "__outputs/envs", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      body.textContent = "";
      if (!d || !d.nonce || !(d.envs || []).length) {
        body.appendChild(el("p", { "class": "o-text warn", text: (d && d.why) || "불러 보기를 할 수 없습니다 -- 서버로 연 사이트인지 봅니다" }));
        return;
      }
      tryForm(s, d, body);
    }).catch(function () { body.textContent = ""; body.appendChild(el("p", { "class": "o-text bad", text: "서버에 닿지 못했습니다" })); });
  }

  function field(label, input, hint) {
    return el("label", { "class": "o-field" }, [el("span", { "class": "o-field-l" }, label), input, hint ? el("small", { "class": "tone-mute" }, hint) : null]);
  }

  function tryForm(s, d, body) {
    var envSel = el("select", { "aria-label": "환경" });
    d.envs.forEach(function (e, i) { envSel.appendChild(el("option", { value: String(i), text: e.name + " (" + e.kind_label + ")" })); });
    var tgtSel = el("select", { "aria-label": "대상" });
    var where = el("code", { "class": "o-try-url" });
    var gate = el("div", { "class": "o-try-gate" });
    var inputs = {};
    var pbox = el("div", { "class": "o-try-params" });
    (s.params || []).forEach(function (p) {
      var inp = el("input", { type: "text", autocomplete: "off", spellcheck: "false", value: p.example == null ? "" : String(p.example) });
      inputs[p.name] = inp;
      pbox.appendChild(field([el("b", { text: p.name }), " ", el("small", { "class": "tone-mute", text: p["in"] + " · " + p.type + (p.required ? " · 꼭" : "") })], inp,
        [p.why, p.constraints].filter(Boolean).join(" -- ") || null));
    });
    if (!(s.params || []).length) pbox.appendChild(el("p", { "class": "tone-mute", text: "받는 값이 없습니다" }));
    var authSel = el("select", { "aria-label": "인증" });
    [["bearer", "Bearer 토큰 (Authorization)"], ["apikey", "API 키 (X-API-Key)"], ["none", "없음"]].forEach(function (o) { authSel.appendChild(el("option", { value: o[0], text: o[1] })); });
    var secret = el("input", { type: "password", autocomplete: "new-password", spellcheck: "false", "data-lpignore": "true", placeholder: "토큰 -- 이 창에만 (저장 · 기록하지 않습니다)" });
    var send = el("button", { type: "button", "class": "o-btn primary", text: "보내기" });
    var out = el("div", { "class": "o-try-out", "aria-live": "polite" });
    body.appendChild(el("div", { "class": "o-try-grid" }, [field("환경", envSel), field("대상", tgtSel)]));
    body.appendChild(el("p", { "class": "o-try-where" }, [el("span", { "class": "tone-mute", text: "보낼 곳 " }), where]));
    body.appendChild(el("h3", { text: "입력" }));
    body.appendChild(pbox);
    if ((s.headers || []).length) body.appendChild(el("p", { "class": "tone-mute", text: "계약의 머리글: " + s.headers.join(", ") + " -- 인증 머리글은 아래에서" }));
    body.appendChild(el("h3", { text: "인증" }));
    body.appendChild(el("div", { "class": "o-try-grid" }, [field("방식", authSel), field("값", secret, "인증·인가를 건너뛰지 않습니다 -- API 가 이 토큰의 권한으로 판정합니다")]));
    body.appendChild(gate);
    body.appendChild(el("div", { "class": "o-try-actions" }, send));
    body.appendChild(out);
    var confirmBox = null;

    function env() { return d.envs[Number(envSel.value) || 0]; }
    function fillTargets() {
      var e = env(), keep = tgtSel.value;
      tgtSel.textContent = "";
      TARGETS.forEach(function (t) {
        var why = (s.locks || {})[t[0]] || (e[t[0]] ? null : "이 환경에 주소가 없다");
        var o = el("option", { value: t[0], text: t[1] + (why ? " -- " + why : "") });
        if (why) o.disabled = true;
        tgtSel.appendChild(o);
      });
      var ok = [].filter.call(tgtSel.options, function (o) { return !o.disabled; });
      tgtSel.value = ok.some(function (o) { return o.value === keep; }) ? keep : (ok[0] ? ok[0].value : "");
      update();
    }
    function showWhere() {
      var e = env(), t = tgtSel.value, path = s.path || "";
      (s.params || []).forEach(function (p) {
        if (p["in"] === "path" && inputs[p.name].value !== "") path = path.split("{" + p.name + "}").join(encodeURIComponent(inputs[p.name].value));
      });
      where.textContent = !t ? "--" : (t === "runtime" ? e.runtime + "/v1/q/" + s.api : e.app + path);
    }
    function update() {
      var e = env(), t = tgtSel.value;
      showWhere();
      out.textContent = "";                              // 다른 환경·대상의 결과를 남기지 않는다
      gate.textContent = "";
      confirmBox = null;
      var why = null;
      if (!t) why = "보낼 수 있는 대상이 없습니다";
      else if (s.write && !e.allow_write) why = e.name + " 환경은 쓰기 시험을 켜지 않았습니다 -- 사용자에게 묻고 outputs.py env --name " + e.name + " --allow-write --quote \"<답 원문>\"";
      else if (!s.write && e.kind === "prod" && !e.allow_read) why = "운영 환경은 조회도 따로 켭니다 -- 사용자에게 묻고 outputs.py env --name " + e.name + " --allow-read --quote \"<답 원문>\"";
      if (why) { gate.appendChild(el("p", { "class": "o-text warn", text: why })); send.disabled = true; return; }
      if (e.kind === "prod" && s.write) {
        confirmBox = el("input", { type: "text", autocomplete: "off", placeholder: e.name });
        gate.appendChild(field([el("span", { "class": "o-badge bad", text: "운영" }), " 실제 데이터를 바꿉니다 -- 환경 이름을 그대로 칩니다"], confirmBox));
      } else if (e.kind === "prod" || s.write) {
        confirmBox = el("input", { type: "checkbox" });
        gate.appendChild(el("label", { "class": "o-check" }, [confirmBox, " ", e.kind === "prod" ? el("span", { "class": "o-badge bad", text: "운영" }) : null, " ",
          (e.kind === "prod" ? "운영 데이터를 조회합니다" : e.name + " 의 데이터를 바꿉니다") + " -- 확인했습니다"]));
      }
      send.disabled = false;
    }
    envSel.addEventListener("change", function () { secret.value = ""; fillTargets(); });   // 다른 환경으로 바꾸면 토큰을 비운다 (그 환경의 토큰을 다시)
    tgtSel.addEventListener("change", update);
    Object.keys(inputs).forEach(function (k) { inputs[k].addEventListener("input", showWhere); });
    fillTargets();

    send.addEventListener("click", function () {
      var e = env(), values = {};
      Object.keys(inputs).forEach(function (k) { if (inputs[k].value !== "") values[k] = inputs[k].value; });
      var confirm = confirmBox ? (confirmBox.type === "checkbox" ? confirmBox.checked : confirmBox.value) : null;
      if (confirmBox && (confirm === false || confirm === "")) { out.textContent = ""; out.appendChild(el("p", { "class": "o-text warn", text: "확인을 먼저 합니다" })); return; }
      send.disabled = true;
      out.textContent = "";
      out.appendChild(el("p", { "class": "o-text note", text: "보내는 중…" }));
      fetch(BASE + "__outputs/try", { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Outputs-Nonce": d.nonce },
        body: JSON.stringify({ api: s.api, env: e.name, target: tgtSel.value, values: values, auth: { scheme: authSel.value, value: secret.value }, confirm: confirm }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: { error: "응답을 읽지 못했습니다 (" + r.status + ")" } }; }); })
        .then(function (x) { send.disabled = false; showResult(out, x); })
        .catch(function () { send.disabled = false; out.textContent = ""; out.appendChild(el("p", { "class": "o-text bad", text: "사이트 서버에 닿지 못했습니다" })); });
    });
  }

  function showResult(out, x) {
    out.textContent = "";
    if (!x.ok) { out.appendChild(el("p", { "class": "o-text bad", text: (x.j && x.j.error) || "보내지 못했습니다" })); return; }
    var j = x.j, st = Number(j.status) || 0;
    var tone = st >= 200 && st < 300 ? "ok" : (st >= 500 ? "bad" : "warn");
    out.appendChild(el("div", { "class": "o-try-head" }, [el("span", { "class": "o-badge " + tone, text: "HTTP " + st }), " ",
      el("span", { text: j.elapsed_ms + "ms" }), " ", el("span", { "class": "tone-mute", text: j.request ? j.request.method + " " + j.request.url : "" }),
      j.env_seen ? el("span", { "class": "o-badge", text: "응답 환경 " + j.env_seen }) : null]));
    (j.warnings || []).forEach(function (w) { out.appendChild(el("p", { "class": "o-text warn", text: w })); });
    if (j.judge && j.judge.checks) {
      var ul = el("ul", { "class": "o-lines o-judge" });
      j.judge.checks.forEach(function (c) {
        ul.appendChild(el("li", null, [el("span", { "class": "o-badge " + (c.ok ? "ok" : (c.level === "warn" ? "warn" : "bad")), text: c.ok ? "맞음" : "다름" }), " ",
          el("b", { text: c.check || "" }), c.detail ? el("span", { "class": "tone-mute", text: " -- " + c.detail }) : null]));
      });
      out.appendChild(el("h3", { text: "계약과 견주기 -- " + (j.judge.verdict === "pass" ? "맞음" : "다른 곳 있음") }));
      out.appendChild(ul);
    }
    var txt = typeof j.body === "string" ? j.body : JSON.stringify(j.body, null, 2);
    if (txt && txt.length > 30000) txt = txt.slice(0, 30000) + "\n… (잘림)";
    out.appendChild(el("h3", { text: "응답" + (j.truncated ? " (1MB 에서 잘림)" : "") }));
    out.appendChild(el("pre", { "class": "o-code" }, el("code", { text: txt == null ? "(본문 없음)" : txt })));
  }

  R.code = function (s) { return el("pre", { "class": "o-code" + (s.wrap ? " cmd" : "") }, el("code", { text: s.text || "" })); };
  R.empty = function (s) {
    var box = el("div", { "class": "o-empty" }, [el("b", { text: s.title_inner || "아직 재료가 없습니다" }), s.why ? el("p", null, inl(s.why)) : null]);
    if (s.how && s.how.length) {
      box.appendChild(el("p", { text: "만드는 법" }));
      var ol = el("ol");
      s.how.forEach(function (h) { ol.appendChild(el("li", null, inl(h))); });
      box.appendChild(ol);
    }
    if (s.cmd) box.appendChild(el("code", { text: s.cmd }));
    return box;
  };

  function section(s) {
    var sec = el("section", { "class": "o-sec", id: s.id || null });
    if (s.title) sec.appendChild(el("h2", null, [s.title, s.count != null ? el("small", { text: String(s.count) }) : null, s.badge ? el("span", { "class": "o-badge " + (s.tone || ""), text: s.badge }) : null]));
    if (s.lead) sec.appendChild(el("p", { "class": "lead" }, inl(s.lead)));
    var r = R[s.kind];
    sec.appendChild(r ? r(s) : el("p", { "class": "o-text note", text: "이 화면 틀이 모르는 절: " + s.kind }));
    return sec;
  }

  // ------------------------------------------------------------ 쪽 머리
  function head(p) {
    var h = el("div", { "class": "o-head" });
    if (p.crumb && p.crumb.length) {
      var cr = el("div", { "class": "o-crumb" });
      p.crumb.forEach(function (c, i) { if (i) cr.appendChild(document.createTextNode(" › ")); cr.appendChild(c.href != null ? link(c.href, c.t) : el("span", { text: c.t })); });
      h.appendChild(cr);
    }
    var cf = p.confirm || {};
    var conf = el("span", { "class": "o-conf " + (cf.state || ""), tabindex: "0" }, [STATES[cf.state] || cf.state || "",
      cf.by ? el("small", { text: cf.by + (cf.at ? " · " + when(cf.at) : "") }) : null]);
    if (cf.quote) conf.setAttribute("title", "확인 원문: " + cf.quote);
    h.appendChild(el("div", { "class": "o-title" }, [el("h1", null, [p.title || "", p.subtitle ? el("small", { text: p.subtitle }) : null]), conf]));

    var meta = el("div", { "class": "o-meta" });
    if (p.read) {
      var pop = el("div", { "class": "pop" }, el("p", { text: p.read.text || p.read }));
      if (p.read.check && p.read.check.length) {
        pop.appendChild(el("p", { text: "확인할 때 볼 것" }));
        var ul = el("ul");
        p.read.check.forEach(function (q) { ul.appendChild(el("li", { text: q })); });
        pop.appendChild(ul);
      }
      if (p.read.guides && p.read.guides.length) {
        var g = el("p", null, "안내: ");
        p.read.guides.forEach(function (x, i) { if (i) g.appendChild(document.createTextNode(" · ")); g.appendChild(link(x.href, x.t)); });
        pop.appendChild(g);
      }
      meta.appendChild(el("details", null, [el("summary", { text: "이 쪽 읽는 법" }), pop]));
    }
    var src = p.source || [];
    var sp = el("div", { "class": "pop" });
    if (src.length) {
      var su = el("ul");
      src.forEach(function (s) { su.appendChild(el("li", null, [el("code", { text: s.path }), " ", el("small", { "class": "tone-mute", text: s.fingerprint ? "지문 " + s.fingerprint : (s.missing ? "없음" : "") })])); });
      sp.appendChild(su);
    } else sp.appendChild(el("p", { text: "다른 쪽에서 계산한 쪽입니다." }));
    if (p.basis && p.basis.length) {
      sp.appendChild(el("p", { text: "확인 상태의 근거 (설계서의 쪽)" }));
      var bl = el("ul", { "class": "o-basis" });
      p.basis.forEach(function (b) { bl.appendChild(el("li", null, [el("span", { "class": "o-badge " + ({ user: "ok", changed: "bad", ai_draft: "warn", proxy: "warn" }[b.state] || ""), text: STATES[b.state] || b.state }), b.label, b.by ? el("small", { "class": "tone-mute", text: b.by + (b.at ? " · " + when(b.at) : "") }) : null])); });
      sp.appendChild(bl);
    }
    meta.appendChild(el("details", null, [el("summary", null, ["만든 재료 ", el("span", { text: String(src.length) })]), sp]));
    var bk = p.blanks || {};
    var bt = el("span", null, ["빈칸 ", el("b", { text: String(bk.count || 0) }), bk.total != null ? " / " + bk.total : ""]);
    meta.appendChild(bk.count ? link(p.page === "improve" ? "#errors" : "improve/#page-" + p.page, bt, "blank has") : el("span", { "class": "blank" }, bt));
    meta.appendChild(el("span", { "class": "when", text: "만든 때 " + when(p.generated_at) }));
    h.appendChild(meta);
    return h;
  }

  // ------------------------------------------------------------ 틀
  function nav() {
    var n = el("nav", { "class": "o-nav", id: "o-nav", "aria-label": "쪽 메뉴" });
    var cur = B.getAttribute("data-page"), sub = B.getAttribute("data-sub") || "";
    (SITE.menu || []).forEach(function (m) {
      var on = m.id === cur && !sub;
      var a = link(m.href, [el("span", { "class": "no", text: m.no }), el("span", { text: m.label }),
        m.blanks ? el("span", { "class": "gap", title: "빈칸", text: m.blanks }) : null,
        m.state && m.state !== "computed" ? el("span", { "class": "dot " + m.state, title: STATES[m.state] || m.state }) : null]);
      if (on) a.setAttribute("aria-current", "page");
      n.appendChild(a);
      (m.subs || []).forEach(function (s) {
        var sa = link(s.href, [el("span", { text: s.label }), s.n != null ? el("span", { "class": "n", text: s.n }) : null], "sub");
        if (m.id === cur && sub && sub.indexOf(s.id) === 0) sa.setAttribute("aria-current", "page");
        n.appendChild(sa);
      });
    });
    if ((SITE.links || []).length) {
      n.appendChild(el("hr"));
      var f = el("div", { "class": "foot" });
      SITE.links.forEach(function (l, i) { if (i) f.appendChild(document.createTextNode(" · ")); f.appendChild(link(l.href, l.t)); });
      n.appendChild(f);
    }
    n.appendChild(el("div", { "class": "foot o-local", id: "o-local" }));
    n.appendChild(el("hr"));
    n.appendChild(el("div", { "class": "foot", text: (SITE.framework_label || SITE.framework) + " " + (SITE.framework_version || "") + " · " + (SITE.level_label || SITE.level || "") }));
    return n;
  }

  function finder() {
    var box = el("div", { "class": "o-find" });
    var inp = el("input", { type: "search", placeholder: "찾기 -- 쪽·테이블·API·업무 이름", "aria-label": "찾기", autocomplete: "off" });
    var hits = el("div", { "class": "o-hits", role: "listbox" });
    box.appendChild(inp); box.appendChild(hits);
    var idx = SITE.index || [], cur = -1, shown = [];
    function draw() {
      var q = inp.value.trim().toLowerCase();
      hits.textContent = ""; cur = -1; shown = [];
      if (!q) { hits.classList.remove("on"); return; }
      for (var i = 0; i < idx.length && shown.length < 30; i++) {
        var it = idx[i];
        if ((it.label + " " + (it.sub || "") + " " + (it.kind || "")).toLowerCase().indexOf(q) >= 0) shown.push(it);
      }
      shown.forEach(function (it) { hits.appendChild(link(it.href, [el("i", { text: it.kind || "" }), el("span", { text: it.label }), it.sub ? el("small", { text: it.sub }) : null])); });
      if (!shown.length) hits.appendChild(el("div", { "class": "o-empty-row", text: "맞는 것이 없습니다" }));
      hits.classList.add("on");
    }
    inp.addEventListener("input", draw);
    inp.addEventListener("keydown", function (e) {
      var as = hits.querySelectorAll("a");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!as.length) return;
        cur = (cur + (e.key === "ArrowDown" ? 1 : as.length - 1)) % as.length;
        for (var i = 0; i < as.length; i++) as[i].classList.toggle("cur", i === cur);
      } else if (e.key === "Enter" && as.length) {
        e.preventDefault(); (as[cur >= 0 ? cur : 0]).click();
      } else if (e.key === "Escape") { inp.value = ""; draw(); }
    });
    document.addEventListener("click", function (e) { if (!box.contains(e.target)) hits.classList.remove("on"); });
    return box;
  }

  function themeButton() {
    var order = ["auto", "light", "dark"], names = { auto: "화면: 자동", light: "화면: 밝게", dark: "화면: 어둡게" };
    var cur = store("outputs.theme") || "auto";
    function apply() { if (cur === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", cur); btn.textContent = names[cur] || names.auto; }
    var btn = el("button", { type: "button", "class": "o-btn o-hide-s" });
    btn.addEventListener("click", function () { cur = order[(order.indexOf(cur) + 1) % order.length]; store("outputs.theme", cur); apply(); });
    apply();
    return btn;
  }

  // 서버로 열었을 때만 -- 이 컴퓨터의 로컬 설정에 있는 도구(참조 콘솔)로 가는 링크. 사이트 파일에는 담지 않는다 (포트는 로컬 설정에만).
  function localLinks() {
    if (FILE || STATIC) return;
    fetch(BASE + "__outputs/local", { cache: "no-store", credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var vals = (d && d.values) || {};                   // 자리표시(<서비스 주소>)를 이 컴퓨터의 로컬 설정 값으로 -- 사이트 파일에는 없다
        [].forEach.call(document.querySelectorAll("[data-local]"), function (n) {
          var v = vals[n.getAttribute("data-local")];
          if (typeof v === "string" && v) { n.textContent = v; n.classList.add("on"); }
        });
        var box = document.getElementById("o-local"), c = d && d.console;
        if (!box || !c || !safeHref(c.url) || !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(c.url)) return;
        box.appendChild(link(c.url, ["참조 콘솔 (조회·적재·감사)", el("small", { "class": "tone-mute", text: c.running ? " · 켜짐" : " · 꺼짐 -- python -m dataconsole --project ." })]));
      }).catch(function () { return null; });
  }

  function live() {
    if (STATIC) return el("span", { "class": "o-live", title: "공개본은 다시 올릴 때 바뀝니다", text: "공개본 · " + String(SITE.generated_at || "").replace("T", " ").slice(0, 16) });
    if (FILE || !SITE.generated_at) return null;
    var tag = el("span", { "class": "o-live", text: "실시간 반영" });
    var seen = SITE.generated_at, fails = 0;
    function tick() {
      fetch(BASE + "__outputs/state", { cache: "no-store", credentials: "same-origin" }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }).then(function (st) {
        fails = 0;
        if (st && st.generated_at && st.generated_at !== seen) {
          document.body.appendChild(el("div", { "class": "o-toast", role: "status", text: "재료가 바뀌어 새로 만들었습니다 -- 다시 읽는 중" }));
          setTimeout(function () { location.reload(); }, 400);
          return;
        }
        setTimeout(tick, 2500);
      }).catch(function () {
        fails += 1;
        tag.textContent = "서버와 연결이 끊김";
        if (fails < 40) setTimeout(tick, 5000);
      });
    }
    setTimeout(tick, 2500);
    return tag;
  }

  function render() {
    if (!SITE || !PAGE) {
      add(B, el("p", { "class": "o-text bad", text: STATIC
        ? "공개본의 자료(data/site.js · 쪽 자료)를 읽지 못했습니다 -- 방금 다시 올렸으면 잠시 뒤 새로 고칩니다."
        : "사이트 자료(data/site.js · 쪽 자료)를 읽지 못했습니다 -- outputs build 로 다시 만듭니다." }));
      if (!FILE && !STATIC) {                               // 사이트 서버로 연 경우 -- 다시 만드는 중이었을 수 있다: 잠시 뒤 다시 읽는다 (몇 번만)
        var n = Number(store("outputs.retry") || 0);
        store("outputs.retry", String(n + 1));
        if (n < 5 && Number(store("outputs.retry") || 0) === n + 1) {   // 저장이 막힌 브라우저에서는 다시 읽지 않는다 (끝없이 돌지 않게)
          setTimeout(function () { location.reload(); }, 1500);
        }
      }
      return;
    }
    store("outputs.retry", "0");
    document.title = (PAGE.title || "") + " · " + (SITE.project || "개발 관리 사이트");
    var app = el("div", { "class": "o-app" });
    var menuBtn = el("button", { type: "button", "class": "o-menu-btn", "aria-controls": "o-nav", "aria-expanded": "false", text: "메뉴" });
    menuBtn.addEventListener("click", function () {
      var open = app.classList.toggle("menu-open");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    var top = el("header", { "class": "o-top" }, [menuBtn,
      link("", [el("b", { text: SITE.project || "개발 관리 사이트" }), el("span", { text: "개발 관리 사이트" })], "o-brand"),
      finder(), el("span", { "class": "o-sp" }), live(), themeButton()]);
    var main = el("main", { "class": "o-main", id: "o-main", tabindex: "-1" });
    var pg = el("div", { "class": "o-page" + (PAGE.wide ? " wide" : "") });
    pg.appendChild(head(PAGE));
    var secs = (PAGE.body && PAGE.body.sections) || [];
    secs.forEach(function (s) { pg.appendChild(section(s)); });
    main.appendChild(pg);
    add(app, [top, nav(), main]);
    B.appendChild(el("a", { "class": "skip", href: "#o-main", text: "본문으로" }));
    B.appendChild(app);
    localLinks();
    if (location.hash) {
      var t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (t) t.scrollIntoView();
    }
  }
  render();
})();
