import { defineConfig } from 'vite';
import { realpathSync } from 'node:fs';
import { aiProxy } from './server/aiProxy';
// node_modules 는 다른 프로젝트 설치본을 연결(junction)해 쓸 수 있다 — 실제 위치도 읽기 허용. three 0.186 · vite 6
export default defineConfig(({ mode }) => ({
  base: './',
  server: { port: 5220, strictPort: true, host: '127.0.0.1', fs: { allow: ['.', realpathSync('node_modules')] } },
  build: { target: 'es2022' },
  // 의존성 캐시는 이 프로젝트 안에 — node_modules 를 다른 프로젝트와 같이 쓰므로 기본 위치면 서로 덮는다
  cacheDir: '.vite-cache',
  // MuTracer 는 노이즈 제거(OIDN) 가중치를 패키지 안에서 읽는다 — 미리 묶으면 경로가 바뀌어 못 읽는다(붙박이장 플래너와 같음)
  optimizeDeps: { exclude: ['@meimu/mutracer'] },
  // 프롬프트 AI 해석(Claude · Gemini · GPT) 중계 — 키는 .env.local(서버 쪽)에만
  plugins: [aiProxy(mode, process.cwd())],
}));
