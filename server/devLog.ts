// 개발 서버 전용 기록 — 브라우저가 보낸 오류 · WebGPU 장치 끊김 · 3D 상태를 .devlog/client.log 에 쌓는다.
// 사용자가 쓰는 브라우저의 콘솔은 밖에서 볼 수 없어서(2026-11-09 「3D 캔버스가 계속 날아간다」 — 헤드리스 시험에선 재현 안 됨) 그 브라우저가 직접 보낸다
import type { Plugin } from 'vite';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function devLog(root: string): Plugin {
  const dir = join(root, '.devlog');
  return {
    name: 'kitchen-dev-log',
    apply: 'serve',
    configureServer(s) {
      mkdirSync(dir, { recursive: true });
      s.middlewares.use('/api/devlog', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c: Buffer) => { body += c; if (body.length > 200_000) req.destroy(); });
        req.on('end', () => {
          try { appendFileSync(join(dir, 'client.log'), `${new Date().toISOString()} ${body.replace(/\r?\n/g, ' ')}\n`); } catch { /* 기록 실패는 화면과 무관 */ }
          res.statusCode = 204; res.end();
        });
      });
    },
  };
}
