# 기능 지도

> 이 사이트에 어떤 기능이 있고, 각 기능이 어떤 파일을 쓰는지 적습니다.
> AI는 고치기 전에 이 표를 보고 "다른 기능을 건드리는지" 확인하고, 고친 뒤에는 모든 기능을 한 번씩 점검합니다.

| 기능 | 상태 | 쓰는 파일 | 확인 방법 (한 줄) | 설명서 |
|---|---|---|---|---|
| 설계 코어 | ✅ 동작 | packages/core/src/types.ts, labels.ts, factory.ts, ops.ts, validate.ts, digest.ts, geometry.ts | `npm test` 의 core.test.ts 통과 | (내부 모듈) |
| 작업판 편집 | ✅ 동작 | apps/editor/src/Canvas.tsx, ElementView.tsx, actions.ts, LeftPanel.tsx, TopBar.tsx, keyboard.ts, packages/exporters/src/shapes.ts | 요소를 놓고 끌어 옮기고 핸들로 크기를 바꾼 뒤 Ctrl+Z 로 되돌아간다 (e2e 기준 1) | manual/sketch.html |
| 필기 | ✅ 동작 | apps/editor/src/Canvas.tsx (펜·지우개), ElementView.tsx (StrokeView), packages/exporters/src/shapes.ts (strokePath) | 확대해서 그린 선이 축소해도 같은 요소 위에 있다 (e2e 기준 2) | manual/sketch.html |
| 동작·상태 명세 | ✅ 동작 | apps/editor/src/Inspector.tsx, IssuesPanel.tsx, Canvas.tsx (동작 연결·동작선), packages/core/src/validate.ts (checkSpec) | 카드를 시간 칸으로 동작 연결하고 예외·검증 기준을 적고, 목록에 빈 상태를 붙이면 경고가 사라진다 (e2e 기준 3) | manual/interaction.html |
| 로컬 저장 | ✅ 동작 | apps/editor/src/persistence.ts, store.ts, packages/storage/src/index.ts | 고친 뒤 창을 닫았다 열어도 그대로이고 상단에 "저장됨 r번호" (e2e 기준 4) | manual/index.html |
| 내보내기·가져오기 | ✅ 동작 | apps/editor/src/exportFlow.ts, Dialogs.tsx, packages/exporters/src/bundle.ts, requirements.ts, svg.ts, trace.ts | ZIP 을 내보내고 다시 가져오면 화면·필기·동작이 같고, 깨진 연결이 있으면 내보내기가 막힌다 (e2e 기준 5) | manual/export.html |
| 전달 어댑터 | ✅ 동작 | packages/adapters/standalone, dev-light, dev-framework (src/index.ts) | Light 로 내보낸 ZIP 에 exports/dev-light/task-card.md·traceability.json 이 있다 (exporters.test.ts) | manual/export.html |
| AHNDA 예시 | ✅ 동작 | examples/ahnda-planner/build.ts, project.json, apps/editor/src/Dialogs.tsx (예시 열기) | 프로젝트 ▾ → 예시 열기 → 화면 2개·동작 8개 | manual/index.html |

상태: ✅ 동작 · 🚧 만드는 중 · ⚠️ 문제 있음 · 💤 쉬는 중

## 구성 -- 어디서 돌고 무엇을 쓰나
AI 가 채웁니다 (사용자에게 묻지 않고 프로젝트에서 읽어서). 문제가 생기면 위의 기능 표와 이 절에서 고칠 곳을 먼저 찾습니다.
쓰는 도구의 버전은 개발 관리 사이트(기록 보기)의 '10 파일' 쪽이 `package.json`·`requirements.txt` 같은 파일에서 직접 읽어 보여 줍니다.

| 부분 | 무엇으로 | 어디서 | 파일·설정 |
|---|---|---|---|
| 화면 | React 19 + Vite 8 정적 웹앱 (SVG 작업판) | 브라우저 (`npm run dev` · 빌드한 apps/editor/dist) | apps/editor/index.html, vite.config.ts, src/main.tsx, App.tsx, src/vite-env.d.ts |
| 저장 | 브라우저 IndexedDB | 사용자의 브라우저 | NAMES.md 의 저장 이름 (`ai-screen-sketch`) |
| 파일 | ZIP (JSZip) · JSON | 내려받기 · 올리기 | packages/exporters/src/bundle.ts |
| 코드 구성 | npm 워크스페이스 (TypeScript 7) | 내 컴퓨터 | package.json, tsconfig.json |
| 시험 | Vitest (단위) · Playwright (브라우저) | 내 컴퓨터 | vitest.config.ts, packages/core/test/core.test.ts, packages/exporters/test/exporters.test.ts, packages/storage/test/storage.test.ts, playwright.config.ts, e2e/acceptance.spec.ts, e2e/smoke.spec.ts |

## 함께 쓰는 파일
여러 기능이 같이 쓰는 파일입니다. 이 파일을 고치면 **모든 기능**을 점검합니다.
- packages/core/src/types.ts (데이터 계약 -- 바꾸면 모든 기능 점검, 이전 JSON 가져오기도 확인)
- apps/editor/src/store.ts (편집 상태·실행 취소), styles.css, App.tsx, main.tsx
- packages/exporters/src/shapes.ts (요소 모양 -- 작업판과 PNG 가 같이 씀)

## 데이터 (표)
`data/model.light.json`(data-light 정본)의 표를 어느 기능이 쓰는지 적습니다. 표·칸을 바꾸면 그 표를 쓰는 **모든 기능**을 점검합니다.
하는 일 · 표 · 예시를 한 번에 보려면 `data/out/book.html`(데이터 설명서), 표와 칸의 자세한 설명은 `data/out/spec.md`, 관계 그림은 `data/out/erd.md` 에 있습니다. 정본이 없으면 이 절은 비워 둡니다.

| 표 | 이름표 | 쓰는 기능 |
|---|---|---|
