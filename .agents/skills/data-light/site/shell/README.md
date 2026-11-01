# outputs-shell -- 개발 관리 사이트의 공통 화면 틀

사양: `skills/data-modeling/references/outputs_schema.json` (`outputs_version: 1`). 만드는 곳: `skills/data-modeling/scripts/outputs.py`.

- **원본은 여기 하나**다. dev-process-framework 는 고정한 서브모듈의 이 폴더를 그대로 쓰고(고정한 지문과 맞는지 검사), light 판은 이 폴더를 복사해 쓴다 --
  둘 다 지문(`outputs.py shell-fingerprint`)으로 같은지 본다. 사본을 고치지 않는다.
- `page.html` -- 쪽마다 쓰는 틀 (`{{BASE}}` 등 자리표시). 글자를 담지 않고 `data/site.js` · `data/<쪽>.js` · `assets/shell.js` 를 읽는다 (인라인 스크립트 없음 -- 서버의 CSP 가 `script-src 'self'`).
- `assets/shell.js` -- 쪽 머리(읽는 법 · 재료 · 확인 상태 · 빈칸)와 절(`body.sections`)을 그린다. 모든 글은 textContent 로.
- `assets/shell.css` -- 종이(밝음) · 밤(어두움), 휴대폰 폭. 외부 글꼴·CDN 없음.
- 서버(http)로 열면 재료가 바뀔 때 다시 읽고, 파일(file://)로 열어도 같은 화면이 나온다.
- 1.1.0 (0.16): 절 `lanes`(업무 레인) · `diagram`(층 그림, SVG 를 createElementNS 로 -- 링크는 같은 안전 규칙) · `matrix` 의 `text`(글·배지 칸)와 `legend` · `code` 의 `wrap`.
  서버로 열었을 때만 `/__outputs/local` 에서 참조 콘솔 링크를 받아 메뉴 아래에 붙인다 (포트는 로컬 설정에만 -- 사이트 파일에는 없다).
- 1.3.0 (0.18): 표의 `filter`(칸마다 거르기 · 끊긴 줄만)와 줄 색 `_tone` · 절 `shots`(화면 캡처 -- 사이트 안 그림만) · 값 `img` · 값 `local`(자리표시 --
  서버로 연 화면에서만 `/__outputs/local` 의 `values` 로 채운다: 구성 요소 · 연결 · 서비스 주소. 사이트 파일 · 내보내기에는 자리표시만).
- 1.3.1 (0.18.1): 링크 모양 검사(safeHref)가 긴 경로에서 오래 걸리지 않게 (조각/ 의 되풀이)
- 1.4.0 (0.19): 공개본(`site.hosting: "static"` -- `outputs.py publish` 가 서비스 주소 아래 · GitHub Pages 에 올린 것). http 로 열어도 사이트 서버가 없으니
  실시간 반영 · 로컬 설정(`/__outputs/local`) · 불러 보기를 하지 않고, 머리줄에 '공개본 · 만든 때'. 모든 쪽에 `robots: noindex, nofollow`.
- 1.4.1 (0.19.1): 공개본 표시를 쪽에도 (`<body data-hosting="static">` -- 자료를 못 읽어도 다시 읽기를 되풀이하지 않는다) ·
  공개본의 폴더 링크는 `.../index.html` 로 (폴더 주소에서 index.html 을 열지 않는 서버) · 저장이 막힌 브라우저에서 다시 읽기를 되풀이하지 않는다.
