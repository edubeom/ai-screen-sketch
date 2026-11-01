import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 정적 웹앱: 빌드 결과(dist)를 아무 정적 호스팅에 올리거나 `npm run preview` 로 연다. 서버가 필요 없다.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: false },
  preview: { port: 4173 },
});
