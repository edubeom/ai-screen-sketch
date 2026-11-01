import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { boot, startAutosave } from './persistence.ts';
import { installKeyboard } from './keyboard.ts';
import { getState } from './store.ts';
import './styles.css';

// 읽기 전용 확인용 (브라우저 시험·문제 찾기)
(window as unknown as { __sketch: unknown }).__sketch = { getState };

installKeyboard();
void boot().then(startAutosave);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
