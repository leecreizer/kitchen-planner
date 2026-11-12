// 휠라 폭 — 자동 배치가 30 미만(원본 휠라 모델이 깨지는 폭) · 150 초과 휠라를 내는지, 휠라가 옆 장과 겹치는지,
// 휠라가 벽 끝이 아닌 곳(장 사이 · 코너 · EP 옆 · 아일랜드)에 있는지(사용자 2026-11-09 「휠라는 장사이에 배치하는게 아니야」). npx vite-node tools/probe-fillw.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, nextWall, prevWall, wallLength, type Design } from '../src/plan';
import { FILL_MAX, FILL_MIN } from '../src/reorder';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const cases: [string, Partial<Design>][] = [];
// 방 크기를 10 단위로 조금씩 바꿔 끝맞춤 · 고정 장 사이 틈이 여러 폭으로 남게
for (const layout of ['I', 'L', 'U', 'II'] as const) for (const style of ['basic', 'storage', 'cafe'] as const)
  for (const [w, dd] of [[4200, 3600], [3610, 3020], [4730, 3380], [5150, 4270], [3290, 2960]] as const) for (const island of [false, true]) {
    const room = { w, d: dd, h: 2400 }, tag = `${layout}/${style}/${w}x${dd}${island ? '/island' : ''}`;
    cases.push([tag, { layout, style, room, island }]);
    cases.push([`${tag}/fR`, { layout, style, room, island, fridgeAt: { wall: 1, end: 'start' } }]);
  }
let n = 0, thin = 0, wide = 0, over = 0, mid = 0, minW = Infinity;
for (const [name, p] of cases) {
  const d = { ...defaultDesign(), ...p } as Design;
  for (const series of ['EO', 'KB'] as const) for (const c of autoPlan(d, cat, series)) {
    for (const f of c.items) {
      if (!/fill/.test(f.key)) continue;
      n++; minW = Math.min(minW, f.w);
      if (f.w < FILL_MIN) { thin++; if (thin <= 20) console.log('좁음', name, series, c.title, f.key, `t${f.t}`, `w${f.w}`); }
      if (f.w > FILL_MAX) { wide++; if (wide <= 10) console.log('넓음', name, series, c.title, f.key, `t${f.t}`, `w${f.w}`); }
      // 휠라를 넓히거나 뺀 뒤 자리를 다시 이었는지 — 같은 줄(틀 · 층) 장과 겹침
      const hit = c.items.some((x) => x !== f && x.frame === f.frame && x.level === f.level && x.tag !== 'ep' && !/^corner|^wallCorner/.test(x.key) && x.t < f.t + f.w - 1 && x.t + x.w > f.t + 1);
      if (hit) { over++; if (over <= 10) console.log('겹침', name, series, c.title, f.key, `t${f.t}`, `w${f.w}`); }
      // 벽 끝 — 줄 처음(t 0)이나 끝(벽 길이)이고 그쪽이 벽(열린 벽이 아니거나 날개벽이 장 깊이 이상). 아일랜드(벽 없음) · FIX 판 조각은 따로
      if (f.key === 'fixFill') continue;
      const wl = f.wall, L = wl != null ? wallLength(d.room, wl) : 0;
      const atS = wl != null && f.t <= 1 && (prevWall(wl) !== d.openWall || d.wing.b >= 600), atE = wl != null && f.t + f.w >= L - 1 && (nextWall(wl) !== d.openWall || d.wing.a >= 600);
      if (!atS && !atE) { mid++; if (mid <= 10) console.log('장 사이', name, series, c.title, f.key, f.level, wl ?? '아일랜드', `t${f.t}`, `w${f.w}`); }
    }
  }
}
console.log(`휠라 ${n}개 · 최소 폭 ${minW} · ${FILL_MIN} 미만 ${thin} · ${FILL_MAX} 초과 ${wide} · 겹침 ${over} · 벽 끝 아닌 곳 ${mid}`);
