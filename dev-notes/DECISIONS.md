# 결정 기록

> "왜 이렇게 했지?"를 나중에 찾을 수 있게, 중요한 결정만 한 줄씩 남깁니다. 최신이 위.
> **누가 정했는지** 앞에 적습니다: `[사용자]` 는 사용자의 답을 따옴표로, `[AI]` 는 이유와 다른 안을 함께.

- 2026-11-02 [AI] 묶음은 `type: "group"` 요소 + 자식의 `parentId` 로 표현 -- 기획서 Element 계약의 parentId 를 그대로 쓰고 풀기 쉬움 (다른 안: 별도 groups 배열)
- 2026-11-02 [AI] 필기는 화면마다 `strokes` 배열, 상태·메모는 객체 배열(`{id, kind, ...}`) -- 기획서 Screen 필드(notes·states)를 구체화. 기획서 예시처럼 strokes 가 없는 JSON 도 받음
- 2026-11-02 [AI] 구조: npm 워크스페이스 -- apps/editor, packages/core·exporters·storage, packages/adapters/{standalone,dev-light,dev-framework}, examples/ahnda-planner (기획서 7장 제안 그대로 + storage)
- 2026-11-02 [AI] 기술: React 19 + Vite 8 + TypeScript, 작업판은 SVG(요소·필기 모두), ZIP 은 JSZip, 시험은 Vitest·Playwright -- 정적 웹앱으로 빌드돼 단독 모드 조건(설치·서버 없음)을 지키고, SVG 는 확대·축소 좌표 변환과 PNG 출력이 쉬움 (다른 안: Canvas 단독 렌더러, 프레임워크 없는 JS)

- 2026-11-02 [AI] 기획서 원본(docx)은 git 에 넣지 않음 (`.gitignore`) -- 저장소가 공개라서, 원본 문서 공개 여부는 사용자가 정하게 남김 (다른 안: 함께 올리기)
- 2026-11-02 [AI] 개발 페이지 공개: 안 함 -- 공개(배포)는 묻고 해야 하는 일이라 기본값은 안 함 (다른 안: GitHub Pages)
- 2026-11-02 [AI] 저장은 브라우저(IndexedDB)에만 -- 기획서 5장 "최초 버전은 브라우저 IndexedDB 에 자동 저장"과 단독 모드(서버·로그인 없음). 표가 이어지는 업무 데이터가 아니므로 data-light 정본은 만들지 않음 (다른 안: data-light 로 설계 정본 작성)
- 2026-11-02 [사용자] 저장할 때마다 GitHub 저장소에 올림 -- "https://github.com/edubeom/ai-screen-sketch 깃허브와 연동한다."
- 2026-11-02 [사용자] 작업 카드 합의·확인을 자동 승인으로 진행 -- "아침이 되면 확인이 가능하도록 모든 진행과정을 자동 승인으로 개발을 진행한다. 최초 프로토타입을 개발할 때 까지 모든 과정을 막힘없이 진행한다."
- 2026-11-02 [사용자] dev-process-light 와 기획서 기준으로 개발 -- "https://github.com/edubeom/dev-process-light 프레임워크를 기반으로 개발을 진행한다. ./doc/PRD/AI_Screen_Sketch_Tool_Plan_v1.docx 기획서를 기반으로 개발을 진행한다."
