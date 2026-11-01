import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 정적 웹앱: 빌드 결과(dist)를 아무 정적 호스팅에 올리거나 `npm run preview` 로 연다. 서버가 필요 없다.
export default defineConfig({
  base: './',
  plugins: [react()],
  // WSL 에서 띄워도 Windows 브라우저로 열 수 있게 모든 주소에서 받는다 (localhost 만 받으면 IPv6(::1)로 묶여 안 열릴 수 있다)
  server: { host: true, port: 5173, strictPort: false },
  preview: { host: true, port: 4173 },
});
