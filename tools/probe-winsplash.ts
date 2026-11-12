// 창 위 벽 마감(타일) — 사용자 2026-11-10 「창문위에 타일은 메꿔지지 않네」. 창 자리(창 몰딩 바깥 폭)는 창 아래만 깔고 창 위는 비어 있었다.
//   양옆이 상부장(키큰장) · 벽 끝으로 막힌 창 자리는 창 몰딩 위 ~ 천장까지 메운다. 한쪽이라도 트였으면(장 없는 벽) 평소 벽 마감 높이까지만.
//   창 구멍(몰딩 포함)과는 겹치지 않는다. npx vite-node tools/probe-winsplash.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { splashLayout } from '../src/splash';
import { CASING, defaultDesign, wallLength, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let cases = 0, holes = 0, overlap = 0, spill = 0;
const near = (a: number, b: number) => Math.abs(a - b) <= 60;
for (const layout of ['L', 'I', 'U'] as const) for (const t of [300, 800, 1300, 2000]) for (const w of [900, 1500]) for (const h of [600, 800, 1100]) for (const sill of [1050, 1250]) {
  const d = { ...defaultDesign(), layout } as Design;
  const win = d.openings.find((o) => o.kind === 'window')!;
  win.t = t; win.w = w; win.h = h; win.sill = sill;
  const c = autoPlan(d, cat, 'EO')[0]; if (!c) continue;
  const segs = splashLayout(c, d).filter((s) => s.wall === win.wall);
  if (!segs.length) continue;
  const L = wallLength(d.room, win.wall);
  const c0 = win.t - CASING, c1 = win.t + win.w + CASING, top = win.sill + win.h + CASING, hole0 = win.sill - CASING;
  // 창 자리가 상판 줄(벽 마감 구간) 안에 걸쳐 있어야 따진다
  const span = segs.flatMap((s) => s.pieces.map((p) => [s.r0 + p[0], s.r0 + p[1]] as const));
  const lo = Math.max(c0, Math.min(...span.map((p) => p[0]))), hi = Math.min(c1, Math.max(...span.map((p) => p[1])));
  if (hi - lo < 100) continue;
  cases++;
  const ups = c.items.filter((i) => i.wall === win.wall && (i.level === 'wall' || i.level === 'tall'));
  const closedL = near(c0, 0) || c0 <= 0 || ups.some((i) => near(i.t + i.w, c0));
  const closedR = near(c1, L) || c1 >= L || ups.some((i) => near(i.t, c1));
  const want = closedL && closedR ? d.room.h : Math.max(...segs.map((s) => s.y0 + s.H));
  const pieces = segs.flatMap((s) => s.pieces.map(([x0, x1, ya, yb]) => ({ x0: s.r0 + x0, x1: s.r0 + x1, ya: s.y0 + ya, yb: s.y0 + yb })));
  const tag = `${layout} 창 t${t} w${w} h${h} 창턱${sill}`;
  for (const p of pieces) {
    if (p.x1 > c0 + 1 && p.x0 < c1 - 1 && p.yb > hole0 + 1 && p.ya < top - 1) { overlap++; console.log(tag, '창 구멍과 겹침', JSON.stringify(p)); }
    if (p.yb > want + 1) { spill++; console.log(tag, `막히지 않은 창 위로 넘침(${closedL ? '' : '왼쪽 '}${closedR ? '' : '오른쪽 '}트임)`, JSON.stringify(p)); }
  }
  // 창 위 — 창 자리 가운데 세로줄이 몰딩 위 ~ want 까지 덮였나
  if (want - top >= 20) {
    const mid = (lo + hi) / 2;
    const cov = pieces.filter((p) => p.x0 <= mid && p.x1 >= mid && p.yb > top).sort((a, b) => a.ya - b.ya);
    let y = top;
    for (const p of cov) if (p.ya <= y + 1) y = Math.max(y, p.yb);
    if (y < want - 1) { holes++; console.log(tag, `창 위 빈 곳 ${Math.round(y)}~${want}`, closedL && closedR ? '(양옆 막힘)' : '(트임)'); }
  }
}
console.log(`창 위 타일 경우 ${cases} · 빈 곳 ${holes} · 겹침 ${overlap} · 넘침 ${spill}`);
