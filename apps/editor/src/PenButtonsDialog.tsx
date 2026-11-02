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
        <h3>받은 입력 (최신이 위)</h3>
        <pre className="raw-log" data-testid="raw-log">{st.rawLog.length ? st.rawLog.join('\n') : '이 창을 연 채로 펜으로 누르거나 펜 버튼·마우스 버튼·키를 눌러 보세요.\n아무것도 안 나오면 그 입력은 이 브라우저까지 오지 않는 것입니다.'}</pre>
        <details className="remote-help">
          <summary>원격 데스크톱(mRemoteNG 등)으로 쓰는 경우</summary>
          <ul>
            <li>원격으로 쓰면 펜이 보통 <b>마우스</b>로 바뀌어 옵니다 (위 기록에 "마우스", 필압 없음). 펜 옆 버튼 신호는 원격 연결에서 빠지는 경우가 많습니다.</li>
            <li><b>가장 확실한 방법</b>: 태블릿이 꽂힌 컴퓨터의 VEIKK 드라이버에서 두 버튼을 <b>키보드 키</b>(예: F9, F10 또는 Ctrl+Alt+1)로 바꾸고, 여기서 <b>등록</b>하세요. 키보드는 원격 연결로도 그대로 전달됩니다.</li>
            <li>펜 필압·옆 버튼까지 쓰려면 원격 대신, 태블릿이 꽂힌 컴퓨터의 브라우저로 이 앱 주소를 직접 여세요.</li>
          </ul>
        </details>
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
