---
name: light-portal
description: 지금까지의 기록(지금 작업·다음 할 일·기능·데이터 설계·작업 기록·결정·저장 목록·기능 지도·쓰는 도구)을 개발 관리 사이트(5쪽)로 보여 줄 때, 문제가 났을 때 고칠 곳(기능·파일·표)을 찾을 때 쓴다. 사용자가 "기록 보여 줘", "지금까지 뭐 했어?", "어디까지 됐어?"라고 하거나, 저장(light-save) 뒤 다시 만든다. 서버·로그인·포트 없이 브라우저로 파일을 연다.
---

# light-portal — 개발 관리 사이트 (기록 보기)

`dev-notes/` 의 기록, git 저장 목록, 데이터 설계(`data/model.light.json`)로 **개발 관리 사이트**를 만든다.
쪽과 주소는 전문판(dev-process-framework)과 같고, 가벼운 판은 그중 5쪽이다. 서버도 로그인도 포트도 없고, 내 컴퓨터에서 브라우저로
`dev-notes/outputs/site/index.html` 파일을 연다. 이 사이트는 인터넷에 올리지 않는다 -- 밖에서도 보게 하려면 사용자에게 묻고 **공개본**을 따로 만든다
(아래 '공개'). 화면 틀은 짝 스킬 `data-light` 에 들어 있는 것을 같이 쓴다.

## 어디에 만들지 (처음 한 번만 묻는다)
`dev-notes/NOW.md` 의 `## 설정` 에서 `기록 보기 페이지:` 를 본다.

- 정해져 있으면 그대로 만든다. 예전 설정(`dev-notes/portal.html`)이면 사이트는 `dev-notes/outputs/site/` 에 만들고
  그 파일은 사이트로 가는 바로가기가 된다 -- 설정을 바꾸지 않는다 (예전 결정을 뒤집지 않는다).
- `(아직 정하지 않음)` 이면 만들기 전에 이렇게 묻는다 (작업 합의와 별개인 준비 질문):
  ```
  지금까지의 기록을 한눈에 보는 사이트를 만들 수 있어요. 내 컴퓨터에서 브라우저로 여는 파일이고, 인터넷에 올라가지 않아요.
   1. 이 폴더 안 dev-notes/outputs/site 에 만들기 (추천 -- 잘 모르겠으면 이것)
   2. 다른 폴더에 만들기 (경로를 알려 주세요)
   3. 만들지 않기
  ```
  답을 `## 설정` 에 적고(`- 기록 보기 페이지: dev-notes/outputs/site` 또는 `만들지 않음`),
  `DECISIONS.md` 에 `[사용자]` 결정으로 답 그대로 한 줄 남긴다.
- **사이트로 공개되는 폴더(예: GitHub Pages 로 올리는 폴더) 안에는 만들지 않는다.** 기록이 인터넷에 보이게 된다 (공개는 아래 '공개'로만).

## 만들기
```
python .claude/skills/light-portal/portal_tool.py build                      # dev-notes/outputs/site
python .claude/skills/light-portal/portal_tool.py build --out <설정의 위치>   # 설정이 다른 곳이면
```
(Codex 는 `.agents/skills/...`. Windows 에서 `python` 이 없으면 `py`.)
- `dev-notes/outputs/` 에 `.gitignore`(`*`)를 두어 저장하지 않는다 -- 기록에서 언제든 다시 만들 수 있다. 다른 폴더면 그 폴더 안에 둔다.
  프로젝트 뿌리의 `.gitignore` 는 건드리지 않는다 (예전 바로가기 파일만 넣는다).
- 사이트 폴더는 이 도구만 쓰는 곳이다 -- 비어 있지 않은 남의 폴더 · 프로젝트 폴더 자체에는 만들지 않는다 (도구가 멈춘다).
- 사이트에는 실제 주소 · 포트(`localhost:번호` 같은 것) · 이메일을 찍지 않는다 (`<서비스 주소>` · `<이메일>` 로 바꾼다).
- 파이썬이 없으면 만들지 않고, "기록은 `dev-notes/` 의 파일을 열어 보면 된다"고 알려 준다.
- 끝나면 열 주소(`file://...`)를 알려 준다.
- 예전 모양(HTML 파일 하나에 기록 원문 전체)이 필요하면 `build --legacy [--out dev-notes/portal.html]`.

## 사이트에 있는 것
| 쪽 | 내용 |
|---|---|
| 1 개요 | 지금 할 일(지금 작업 · 확인 전인 완료 기준 · 저장 안 한 변경 · 문제 있는 기능 · 데이터 설계 고칠 것 · 기능 지도에 없는 파일 · 다음 할 일), 진행 막대(이번 작업 완료 기준 · 동작하는 기능), 이 프로젝트는(`NOW.md` 다섯 줄), 숫자 카드, 최근 작업 기록 |
| 2 업무 설명 | 기능(`FEATURES.md` -- 상태 · 확인 방법 · 쓰는 표 · 최근 기록), 데이터 설계가 있으면 하는 일(누가 · 어느 화면에서 · 어느 표를)과 일 × 표 |
| 4 데이터 | `data-light` 의 쪽 그대로 -- 표 사이 연결 그림, 표마다 칸 · 규칙 · 개인정보, 예시 값(만든 값). 없으면 '만드는 법' |
| 9 진행 상황 | 지금 작업과 완료 기준, 작업 기록 흐름(`LOG.md` + 지난달, 칸마다 거르기), 기능별 기록(`dev-notes/log/<기능>/<날짜>.md` -- 누르면 목록 · 자세히), 결정(사용자 / AI), 저장 목록, 저장 안 한 변경, 데이터 설계 검사, 배운 것 |
| 10 파일 | 기능 지도(기능 → 쓰는 파일 → 표, 없는 파일은 빨간 줄), 함께 쓰는 파일, 구성, 쓰는 도구와 버전(`package.json`·`requirements.txt`·`pyproject.toml`·`.python-version`·`.nvmrc`·HTML 의 CDN 주소에서 직접 읽음), 지도에 있는데 없는 파일 · 지도에 없는 파일, 이름표, 기록 파일, 만든 파일(설명서 · 데이터 설명서) |

사이트는 **보기만** 한다. 고칠 때는 기록(`dev-notes/`) · 정본(`data/model.light.json`)을 고치고 다시 만든다.

## 공개 -- 내 사이트 아래 · GitHub Pages (처음 한 번 묻는다)
`## 설정` 의 `개발 페이지 공개:` 를 본다. `(아직 정하지 않음)` 이거나 그 줄이 없으면(예전에 설치한 프로젝트) 사이트를 처음 만든 뒤 한 번 묻고
그 줄을 더한다 (인터넷에 올리는 일 -- 규칙 7):
```
이 기록 사이트를 인터넷에서도 볼 수 있게 할까요? 공개하면 주소를 아는 누구나 기능 · 데이터 설계 · 작업 기록 · 결정을 봐요
(비밀번호 · 실제 데이터 · 이메일 · 내 컴퓨터 주소는 담지 않아요).
 1. 만드는 홈페이지 아래에 -- <내 사이트 주소>/dev-process-light/ (만드는 것이 웹 페이지일 때). 사이트로 올라가는 폴더를 알려 주세요 (맨 위 폴더면 . , 아니면 public · docs 등)
 2. GitHub Pages 로 -- https://<계정>.github.io/<저장소>/dev-process-light/ (웹 페이지가 없을 때, GitHub 저장소가 있어야 해요.
    홈페이지를 이미 GitHub Pages 로 올리고 있으면 1번이에요 -- 그 홈페이지 폴더 아래에 둬요)
 3. 공개하지 않기 (잘 모르겠으면 이것 -- 나중에 바꿀 수 있어요)
```
답대로 정하고(`--quote` 에 답 그대로), `## 설정` 에 `- 개발 페이지 공개: 홈페이지 아래 (<폴더>)` · `GitHub Pages` · `안 함`, `DECISIONS.md` 에 `[사용자]` 로:
```
python .claude/skills/light-portal/portal_tool.py publish --set service --web-dir <폴더> --by user --quote "<사용자 답 그대로>"
python .claude/skills/light-portal/portal_tool.py publish --set pages --by user --quote "<사용자 답 그대로>"
python .claude/skills/light-portal/portal_tool.py publish --set none --by user --quote "<사용자 답 그대로>"
python .claude/skills/light-portal/portal_tool.py publish            # 정한 대로 올린다 (light-save 가 저장할 때마다)
```
- **같은 쪽을 두 번 만들지 않는다**: 5쪽은 `dev-process-light/` 에 한 번만, `data-expert-framework-light/` 에는 같은 주소로 가는 안내 쪽만 생긴다
  (`datalight.py site` · `publish` 는 이 프로젝트에서 멈춘다 -- 데이터 쪽은 이 사이트에 함께 있다).
- 1번: 그 폴더의 `dev-process-light/` · `data-expert-framework-light/` 에 쓴다 -- 사이트를 올리면(배포) `<내 사이트 주소>/dev-process-light/`. 이 두 폴더도 저장한다.
  같은 이름의 남의 폴더가 있으면 덮지 않고 멈춘다.
- 2번: 저장소의 `gh-pages` 가지에 올린다 (지금 폴더 · 저장은 그대로). 처음 한 번 GitHub 저장소 **Settings → Pages** 에서 'Deploy from a branch' · `gh-pages` · `/ (root)`
  로 켜도록 안내한다. 비공개 저장소는 유료 요금제에서만 되고, 켜면 누구나 본다. 이 저장소의 Pages 가 이미 다른 곳(홈페이지)을 보여 주면 도구가 멈추고
  1번(그 홈페이지 폴더 아래)을 권한다 -- 그대로 1번으로 다시 묻는다.
- 주소는 `.../dev-process-light/index.html` 로 열어도 된다 (폴더 주소에서 index.html 을 열지 않는 사이트). 쓰다 멈추면 다음 공개가 이어서 쓴다.
- 바뀐 것이 없으면 아무것도 쓰지 않는다. 공개본에는 '공개본 · 만든 때' 가 보이고, 검색 엔진에는 나오지 않게 한다 (noindex).

## 고칠 곳 찾기 (`where`)
문제가 나면 코드 전체를 훑기 전에 기능 지도에서 고칠 곳부터 찾는다 -- 읽는 파일이 줄어 빠르고 다른 기능을 덜 건드린다.
```
python .claude/skills/light-portal/portal_tool.py where "가계부 합계가 틀려요"
python .claude/skills/light-portal/portal_tool.py where "budget.js:12 TypeError"
```
- 오류 글·화면 이름·기능 이름·파일 이름·표 이름으로 찾는다. 기능 · 쓰는 파일 · 표 · 구성 · 함께 쓰는 파일과 **먼저 볼 파일**을 알려 준다
  (함께 쓰는 파일이면 "모든 기능을 점검"이라고 함께 알려 준다). `--json` 은 같은 내용을 JSON 으로.
- 찾지 못하면 종료 코드 1 -- 다른 말로 다시 찾거나, 기능 지도(`FEATURES.md`)가 비어 있으면 채운다.
- "기능 지도에 없는 파일"이 나오면 그 파일을 `FEATURES.md` 의 기능('쓰는 파일')·함께 쓰는 파일·구성 중 맞는 곳에 넣는다 (`light-check` 의 '기능 지도').

## 언제 다시 만드나
- `light-save` 가 저장할 때마다 (설정이 `만들지 않음` 이 아니면)
- 사용자가 "기록 보여 줘" · "어디까지 됐어?" 라고 할 때
