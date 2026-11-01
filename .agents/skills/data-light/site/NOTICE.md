# 개발 관리 사이트 화면 틀 (사본)

`shell/` 은 data-expert-framework(전문판)의 `runtime/outputs-shell` 을 정해 둔 커밋 그대로 담은 사본입니다
(`shell.lock.json` 에 커밋 · 파일 지문 · 틀 지문). 저작권자(edubeom)의 결정(2026-10-20, 개발 관리 사이트 사양 검토 D5 "권장 대로 진행하자")으로
**이 사본은 이 저장소의 MIT 라이선스**로 공개합니다. 전문판의 다른 부분은 공개 대상이 아닙니다.

- 쓰는 법: `python skills/data-light/scripts/datalight.py site data/model.light.json` → `data/outputs/site/index.html` 을 브라우저로 엽니다
  (파일로 엽니다 -- 서버 · 포트가 없습니다. 사이트 폴더는 git 에 올리지 않습니다).
- 쪽은 전문판 사양(outputs_version 1)의 가벼운 판 5쪽: 1 개요 · 2 업무 설명 · 4 ERD·데이터 설계 · 9 진행 상황 · 10 파일 (번호 · 주소는 전문판과 같습니다).
- 고치지 않습니다. 원본에서 고치고 `python tools/update_shell.py --from ../data-expert-framework --ref <커밋>` 으로 다시 받습니다.
