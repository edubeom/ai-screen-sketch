# 이름표

> 같은 것을 여러 이름으로 부르면 AI도 사람도 헷갈립니다. 화면에 보이는 말과 코드 이름을 짝지어 둡니다.
> 새 이름이 필요하면 AI가 여기에 먼저 적고 알려 줍니다.
> 데이터의 표·칸 이름은 `data/model.light.json`(data-light 정본)의 `label` 이 이름표입니다 -- 여기에 옮겨 적지 않고
> `data/out/spec.md` 에서 봅니다. 브라우저에만 저장하는 데이터는 저장 이름(예: `localStorage` 의 `memos`)을 여기에 적습니다.

| 화면에 보이는 말 | 코드 이름 | 메모 |
|---|---|---|
| 프로젝트 | project (`Project`) | 설계 정본 = project.json |
| 화면 | screen (`Screen`) | |
| 요소 | element (`SketchElement`) | 종류는 아래 9가지 + 묶음 |
| 영역 · 텍스트 · 버튼 · 입력창 · 목록 · 카드 · 이미지 · 메모 · 연결선 | region · text · button · input · list · card · image · note · connector | `ElementType` |
| 묶음 | group | 자식은 `parentId` 로 가리킴 |
| 묶음 프리셋 (캘린더 · 작업 목록 · 상세 패널) | preset (calendar · task_list · detail_panel) | |
| 필기 | stroke (`Stroke`, points `[x,y,pressure?]`) | |
| 동작 | interaction (`Interaction`) | "이벤트"·"액션"이라고 따로 부르지 않는다 |
| 트리거 | trigger | click · double_click · input · change · drag_drop |
| 결과 종류 | action | navigate · open_panel · expand_list · set_value · create_item · delete_item · external_link · custom |
| 결과 · 사전 조건 · 데이터 변경 · 예외·실패 상태 · 검증 기준 | effect · condition · dataChange · errorState · acceptance | 빈 칸은 "미정" 으로 내보냄 |
| 검증 기준 id | `AC-<동작 id>` | requirements.md · traceability.json 공통 |
| 깨진 연결 | (대상 요소·화면이 없는 동작) | `interactionTargetProblem` |
| 상태 | state (`ScreenState`) | normal · empty · loading · error · disabled = 정상 · 빈 화면 · 불러오는 중 · 오류 · 비활성 |
| 화면 메모 | notes (`ScreenNote`) | general · responsive · undecided = 메모 · 반응형 · 미정 |
| 역할 · 배치 의도 · 데이터 연결 | semanticRole · props.layoutIntent · props.dataBinding | |
| 설계 묶음 | bundle (ZIP) | |
| 전달 방식 | profile | standalone · dev-light · dev-framework = 단독 · dev-process-light · 전문판(전달 초안) |
| 검증 결과 | issues (`SpecIssue`) | 차단 error · 경고 warning · 안내 info |
| 저장 번호 | revision (`savedRevision`) | 실행 취소 히스토리와 따로 |
| 브라우저 저장소 | IndexedDB `ai-screen-sketch` (저장소 projects · assets · meta, 열쇠 lastProjectId) | **이름을 바꾸면 쓰던 프로젝트가 안 보인다 -- 바꾸기 전에 말한다** |
