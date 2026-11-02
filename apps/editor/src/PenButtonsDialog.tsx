// 펜 버튼 설정: 버튼마다 받을 입력을 등록하고, 눌러 보며 확인한다.
import { useEffect, useSyncExternalStore } from 'react';
import { describeBinding, penState, resetBindings, SLOT_ACTIONS, SLOT_LABELS, startLearning, subscribePen, type PenSlot } from './penButtons.ts';

let snapshot = penState();
const sub = (l: () => void) =>
  subscribePen(() => {
    snapshot = penState();
    l();
  });

export function PenButtonsDialog({ onClose }: { onClose: () => void }) {
  const st = useSyncExternalStore(sub, () => snapshot);
  useEffect(() => () => startLearning(undefined), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !penState().learning && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label="펜 버튼" data-testid="pen-buttons">
        <header>
          <h2>펜 버튼</h2>
          <button className="btn icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        <p className="muted">
          펜 옆 버튼을 1번·2번·3번 빠르게 눌러 기능을 씁니다. 버튼이 브라우저에 어떻게 전달되는지는 태블릿 드라이버 설정에 따라 다르므로,
          아래 <b>등록</b>을 누르고 그 펜 버튼을 한 번 눌러 맞춰 주세요.
        </p>
        {(['far', 'near'] as PenSlot[]).map((slot) => (
          <section key={slot} className="pen-slot">
            <h3>{SLOT_LABELS[slot]}</h3>
            <ol className="muted">
              {SLOT_ACTIONS[slot].map((a, i) => (
                <li key={i}>{i + 1}번 누름: {a}</li>
              ))}
            </ol>
            <div className="row">
              <span className="grow">받는 입력: <b>{st.bindings[slot].map(describeBinding).join(' 또는 ')}</b></span>
              <button className={st.learning === slot ? 'btn small on' : 'btn small'} data-testid={`learn-${slot}`} onClick={() => startLearning(st.learning === slot ? undefined : slot)}>
                {st.learning === slot ? '지금 펜 버튼을 누르세요… (Esc 취소)' : '등록'}
              </button>
            </div>
          </section>
        ))}
        <div className="callout">
          <b>눌러 보기</b> -- {st.lastInput || '펜 버튼을 누르면 여기에 무엇을 받았는지 나옵니다'}
        </div>
        <p className="muted">
          VEIKK 드라이버에서 버튼이 "마우스 오른쪽/가운데 클릭"이나 "키보드 키"(예: F9, F10)로 되어 있으면 그대로 등록됩니다.
          "지우개 전환"·"펜/마우스 전환"처럼 드라이버 안에서만 쓰는 기능으로 되어 있으면 브라우저가 받지 못하니, 드라이버에서 키보드 키로 바꿔 주세요.
          등록은 이 브라우저에만 저장됩니다.
        </p>
        <footer className="row end">
          <button className="btn" onClick={resetBindings}>기본값으로</button>
          <button className="btn primary" onClick={onClose}>닫기</button>
        </footer>
      </div>
    </div>
  );
}
