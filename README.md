# AI 화면 스케치 (ai-screen-sketch)

화면을 사각형·텍스트·필기·메모로 그리고, 요소마다 **동작(트리거 → 조건 → 결과 → 실패 상태 → 검증 기준)** 을 붙여
AI 개발자에게 넘길 **설계 묶음(ZIP)** 을 만드는 단독 실행 웹 도구입니다.
그림은 위치를, 동작 명세는 "누르면/끌어 놓으면 무엇이 되는지"를 설명합니다 -- AI 가 이름이나 손글씨만 보고 짐작하지 않게.

- 서버·로그인·Git·Python 없이 브라우저만으로 동작합니다 (단독 모드).
- 프로젝트는 브라우저(IndexedDB)에 자동 저장되고, ZIP/JSON 으로 내보내고 다시 가져올 수 있습니다.
- 같은 설계를 [dev-process-light](https://github.com/edubeom/dev-process-light) 작업 카드 초안이나 전문판 전달 초안으로도 내보낼 수 있습니다.

기준 문서: 기획서 v1.1 (2026-10-28) -- 이번 버전은 기획서 6장의 **단계 1(PC 스케치)·2(의도 전달)** 프로토타입입니다.

## 실행

Node.js 22 이상이 필요합니다.

```bash
npm install
npm run dev        # http://localhost:5173
```

정적 파일로 빌드해 아무 곳에서나 열 수 있습니다 (서버 불필요):

```bash
npm run build      # apps/editor/dist
npm run preview    # http://localhost:4173
```

### 다른 기기(노트북·태블릿)에서 열기 -- Windows + WSL

서버는 모든 주소에서 받도록 되어 있습니다(`vite.config.ts` 의 `host: true`). WSL 에서 띄웠다면 Windows 가 공유기 쪽으로 넘겨 줘야 합니다.
**관리자 PowerShell** 에서 한 번:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\lan-access.ps1
```

공유기 주소:5173 → `127.0.0.1:5173`(WSL localhost 전달)로 넘기고, 방화벽은 개인 네트워크에서만 엽니다. WSL 내부 주소가 재부팅으로 바뀌어도 그대로 됩니다.
Windows 에 로그인하면 서버가 저절로 켜지게 하려면 (관리자 필요 없음):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\autostart.ps1
```

둘 다 `-Remove` 로 되돌립니다. 로그인이 없는 도구라 같은 공유기의 누구나 열 수 있지만, 설계는 각 브라우저에만 저장되어 서로 보이지 않습니다.
원격 데스크톱(mRemoteNG 등)으로 쓰면 펜이 마우스로 바뀌어 필압·펜 옆 버튼이 전달되지 않습니다 -- 태블릿이 꽂힌 기기의 브라우저로 직접 여는 것을 권합니다.

처음 열면 빈 프로젝트가 만들어집니다. **프로젝트 ▾ → 예시 열기: AHNDA 할 일 및 일정** 으로 기획서의 인수 사례를 바로 볼 수 있습니다.
사용 방법은 [`manual/index.html`](manual/index.html) (브라우저로 열기 · `P` 발표 · `N` 대본).

## 할 수 있는 것

| 영역 | 기능 |
|---|---|
| 화면 | 여러 화면, 데스크톱 1440×900 · 태블릿 1024×768 · 모바일 390×844 · 직접 입력, 순서 변경, 복제(상태 화면) |
| 요소 | 영역 · 텍스트 · 버튼 · 입력창 · 목록 · 카드 · 이미지(PNG/JPEG/WebP/GIF 업로드) · 메모 · 연결선, 묶음 프리셋(캘린더 · 작업 목록 · 상세 패널) |
| 편집 | 선택 · 여러 개 선택(Shift, 영역 끌기) · 이동 · 크기 조절 · 복사/붙여넣기 · 복제 · 지우기 · 앞뒤 순서 · 묶기/풀기 · 잠금 · 정렬 · 격자 맞춤 · 실행 취소/다시 실행 |
| 필기 | 펜(색·굵기, 펜 필압) · 지우개. 확대·축소와 상관없이 화면 좌표로 저장 |
| 명세 | 동작(클릭 · 더블클릭 · 입력 · 선택 변경 · 드래그 앤 드롭 → 화면 이동 · 패널 열기 · 목록 펼치기 · 값 변경 · 항목 생성/삭제 · 외부 링크 · 사용자 정의), 사전 조건 · 결과 · 데이터 변경 · 예외 · 검증 기준, 상태(정상 · 빈 화면 · 불러오는 중 · 오류 · 비활성), 화면 메모(메모 · 반응형 · 미정), 역할(semanticRole) · 배치 의도 · 데이터 연결 |
| 검증 | 깨진 연결 · 필수 대상 없음 = 내보내기 차단 / 빈 결과 · 예외 · 검증 기준 = 경고("미정"으로 내보냄) / 빈 상태 없는 목록 = 경고 |
| 저장 | IndexedDB 자동 저장(저장 중 · 저장됨 · 저장 실패 표시), 프로젝트 목록, 실행 취소 히스토리와 저장 revision 분리 |
| 내보내기 | ZIP: `project.json` · `screens/NN-<id>.png` · `assets/` · `requirements.md` · `validation-report.json` · `manifest.json`(파일별 크기·sha256) + profile 전달물 |
| 가져오기 | ZIP/JSON. 스키마 · 참조 · 좌표 범위 · 버전 검사, 파일 수 · 크기 제한, 경로 탈출 차단, 해시 확인. 기본은 새 프로젝트 |

단축키: `V` 선택 · `P` 펜 · `E` 지우개 · `L` 동작 연결 · `Delete` · 방향키(Shift 10px) · `Ctrl/⌘+Z`, `Ctrl/⌘+Shift+Z` · `Ctrl/⌘+C/V/X/D` · `Ctrl/⌘+G`(Shift 풀기) · 스페이스+끌기 · `Ctrl/⌘+휠`

## 그림 가져오기와 AI 분석

**가져오기** 에서 화면 그림(PNG·JPEG·WebP·GIF -- 스크린샷, 손그림 사진)을 고르면 세 가지로 넣을 수 있습니다.

| 방법 | 토큰 | 하는 일 |
|---|---|---|
| 그림만 넣기 | 0 | 그림을 화면에 깔고 그 위에 그립니다 |
| 모양 찾기 | 0 | 브라우저가 네모·원·별·세모·칠한 상자·글 자리를 찾아 고칠 수 있는 요소로 만듭니다 (`packages/vision`, 원본은 잠근 채 뒤에) |
| AI 분석 | 약 1.3만/장 | 모양 찾기 결과에 서버의 AI 클라이언트가 요소 종류·글·역할을 붙입니다. 같은 그림은 캐시라 다시 0 |

AI 분석은 **이 서버 컴퓨터에 로그인된 Codex CLI**(ChatGPT 계정)를 씁니다 -- API 키가 필요 없고 ChatGPT 요금제 사용량에서 나갑니다.
`npm run dev`·`npm run preview` 서버에 붙는 선택 모듈(`apps/editor/server/aiBridge.ts`)이라, 정적 호스팅만 하면 꺼집니다.

- 켜기: `codex` 가 PATH 에 있으면 저절로 켜집니다. `SKETCH_AI=off` 로 끄고, `SKETCH_AI_MODEL=<모델>` 로 모델을 고릅니다.
- 토큰: 공유기 안 다른 기기에서도 열리므로 분석 요청에는 토큰이 필요합니다 -- 서버 컴퓨터에서 `npm run ai-token`, 브라우저에 한 번 넣으면 기억합니다.
- 안전: Codex 는 빈 임시 폴더에서 읽기 전용 샌드박스·셸 끔·기록 안 남김(`--ephemeral`)·정해진 JSON 모양(`--output-schema`)으로만 돌고, 한 번에 하나, 3분 제한.
- 캐시: `~/.config/ai-screen-sketch/ai-cache/` (그림·후보·모델이 같으면 다시 부르지 않음).

토큰을 줄이는 방법 (2026-11-03 측정, 802×524 와이어프레임 한 장):

| 방법 | 입력 토큰 |
|---|---|
| Codex 기본 | 15,175 |
| + 그림 분석에 필요 없는 Codex 기능 끄기 (도구 설명이 줄어듦) | **12,792** |
| 같은 그림 다시 (캐시) | **0** |

- 비용 대부분(약 1.19만)은 Codex 가 매 호출 붙이는 자체 지시문이라, 그림을 더 줄여도 크게 줄지 않습니다. 그래서 **안 부르는 것**이 가장 큽니다: 모양·자리는 브라우저가 찾고(0), AI 는 글·종류가 필요할 때만, 같은 그림은 캐시.
- 그림은 흑백·긴 변 1024px JPEG 로 보내고(약 900 토큰), 답은 정해진 짧은 JSON(약 480 토큰), 생각은 낮게(`model_reasoning_effort=low`).
- 더 줄이려면: 여러 화면을 한 번에 묶어 보내기(고정 비용을 나눔), 또는 API 키로 모델을 직접 부르기(고정 지시문이 없어 장당 약 1~2천 토큰 -- 대신 사용량 요금).

## 설계 묶음(ZIP)과 개발 흐름 연결

ZIP 을 풀면 그대로 설계 폴더가 됩니다. dev-process-light 프로젝트라면 `design/sketch/<project-id>/` 에 풀어 두는 것을 제안합니다.

| profile | 추가 파일 | 비고 |
|---|---|---|
| 단독 | `traceability.json` | 프레임워크 없이 AI 에게 그대로 전달 |
| dev-process-light | `exports/dev-light/task-card.md`, `exports/dev-light/traceability.json` | NOW.md 작업 카드 초안 · light-check 검증표 · FEATURES/NAMES 제안. **기존 기록을 덮지 않는 초안** |
| 전문판 (전달 초안) | `exports/dev-framework/task-draft.md`, `exports/dev-framework/traceability.json` | task-new · accept · verify · finish 개념 대응. 전문판 내부 계약은 미확인 -- 완전 호환 아님 |

`traceability.json` 은 공통 교환 계약입니다: `integration.profile/adapterVersion`, `hostProjectId/hostTaskId`, `designId/revision/digest`,
`featureRefs`(미확정) · `termRefs`(제안) · `acceptanceRefs`(동작 id → `AC-<동작 id>`) · `evidenceRefs`(모두 unverified) · `approval`(초안).
설계를 고치면 새 revision 이 되고, 이전 revision 의 승인·증거는 넘어오지 않습니다.

## 구조

```
apps/editor                     편집기 (React + Vite, 정적 웹앱) · server/aiBridge.ts 선택 AI 분석
packages/core                   설계 데이터 계약 · 편집 명령 · 가져오기/명세 검사
packages/exporters              요소 모양(화면·PNG 공용) · SVG · 구현 요청문 · ZIP 내보내기/가져오기 · traceability
packages/storage                IndexedDB 저장소
packages/vision                 그림에서 모양·글 자리 찾기 (토큰 0)
packages/adapters/standalone    단독 profile
packages/adapters/dev-light     dev-process-light profile
packages/adapters/dev-framework 전문판 전달 초안 profile
examples/ahnda-planner          인수 사례 (node examples/ahnda-planner/build.ts 로 다시 만듦)
e2e                             브라우저 시험 (Playwright)
dev-notes                       개발 기록 (dev-process-light)
manual                          사용설명서 (HTML 슬라이드)
```

## 시험

```bash
npm run typecheck
npm test            # 단위 시험 (Vitest)
npm run e2e         # 브라우저 시험 (Playwright) -- 빌드 후 preview 서버로 확인
npm run check       # 위 전부 + 빌드
```

브라우저 시험이 처음이면 Playwright 브라우저와 시스템 라이브러리가 필요합니다:

```bash
npx playwright install --with-deps chromium
```

## 아직 하지 않은 것 (기획서 후속 단계)

- 아이패드 · 노트북 동기화(서버 저장, QR, 단일 편집권), 손바닥 오입력 실기기 검증
- 전문판(dev-process-framework) 실제 계약 확인 후 어댑터 확정, 포털 생성기 연결, AHNDA 작업 연결
- 업로드 SVG, 외부 이미지 URL, 필기 인식, 자동 코드 생성
