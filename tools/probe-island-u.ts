// ㄷ자 · ㄱ자 + 아일랜드 — 아일랜드가 옆 장(팔)에 닿아 길이 막히는지(동선 막힘), 통로 900 이 남는지, 반도형 · 뺌이 몇 번인지. npx vite-node tools/probe-island-u.ts
// 2026-11-12 사용자 결정 「우린 추가하면 기본위치에 배치만한다」 — 자동 배치는 붙이지도(반도형) 빼지도 않는다: 반도형 0 · 뺌 0, 좁으면 알림
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan, COUNTER_D } from '../src/autoplan';
import { defaultDesign, type Design } from '../src/plan';
import { flowOf } from '../src/flow';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const P = (f: { o: [number, number]; dir: [number, number]; n: [number, number] }, t: number, u: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
let tightQuiet = 0, warned = 0, blockedWarned = 0, n = 0, blocked = 0, free = 0, pen = 0, none = 0, tight = 0, minPass = Infinity;
const sample: string[] = [];
for (const layout of ['U', 'L'] as const) for (const style of ['basic', 'storage', 'cafe'] as const)
  for (const w of [3000, 3300, 3600, 3900, 4200, 4500, 4800, 5400]) for (const dd of [3600, 4200, 5000]) {
    // 공간 크기 가로 = 정면 벽(방 d) · 세로 = 옆 벽(방 w) — 기본 방은 가로 3,600 · 세로 4,200
    const d = { ...defaultDesign(), layout, style, island: true, room: { w: dd, d: w, h: 2400 } } as Design;
    for (const series of ['EO', 'KB'] as const) {
      const c = autoPlan(d, cat, series)[0];
      if (!c) continue;
      n++;
      const fl = flowOf(d, c);
      const narrowWarn = c.warnings.some((x) => /둘레 통로가 좁습니다/.test(x));
      if (narrowWarn) warned++;
      if (fl.blocked) { blocked++; if (narrowWarn) blockedWarned++; if (sample.length < 16) sample.push(`막힘 ${layout}/${style} 가로${w}×세로${dd} ${series} 아일랜드 ${c.island ? c.island.len + (c.island.attached != null ? ' 붙임' : '') : '없음'}${narrowWarn ? ' (통로 좁음 알림)' : ''}`); }
      if (!c.island) { none++; continue; }
      if (c.island.attached != null) pen++; else free++;
      // 아일랜드 상판 끝과 옆 줄 상판(팔) 사이 — 아일랜드 축 방향으로 잰 가장 짧은 틈
      const I = c.island, f = I.frame, ends = [P(f, 0, 300), P(f, I.len, 300)];
      for (const [k, e] of ends.entries()) {
        if (I.attached != null && I.attachedEnd === k) continue;
        for (const it of c.items.filter((x) => x.level === 'base' && x.wall != null && x.tag !== 'ep')) {
          const g = it.frame, rel: [number, number] = [e[0] - g.o[0], e[1] - g.o[1]];
          const t = rel[0] * g.dir[0] + rel[1] * g.dir[1], u = rel[0] * g.n[0] + rel[1] * g.n[1];
          if (t < it.t || t > it.t + it.w || u < 0) continue;
          const gap = u - COUNTER_D;
          if (gap < 1500) { minPass = Math.min(minPass, gap); if (gap < 880) { tight++; if (!c.warnings.some((x) => /둘레 통로가 좁습니다/.test(x))) tightQuiet++; if (sample.length < 16) sample.push(`좁음 ${layout}/${style} 가로${w}×세로${dd} ${series} 틈 ${Math.round(gap)}`); } }
        }
      }
    }
  }
console.log(sample.join('\n'));
console.log(`알림 없이 막힘 ${blocked - blockedWarned} · 알림 없이 좁음 ${tightQuiet}`);
console.log(`안 ${n}개 · 동선 막힘 ${blocked}(통로 좁음 알림 있는 것 ${blockedWarned}) · 떠 있는 아일랜드 ${free} · 반도형 ${pen} · 뺌 ${none} · 끝 통로 880 미만 ${tight}(알림 없는 것 ${tightQuiet}) · 통로 좁음 알림 ${warned} · 가장 좁은 끝 통로 ${Math.round(minPass)}`);
