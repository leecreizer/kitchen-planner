// 창 위 상부장 — 창 폭 · 위치 · 높이를 바꿔 상부장 줄 빈틈 · 높이 찾기. npx vite-node tools/probe-winup.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, wallLength, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let bad = 0;
for (const layout of ['L', 'I', 'U'] as const) for (const t of [300, 800, 1300, 2000]) for (const w of [900, 1500]) for (const h of [600, 800, 1000]) {
  const d = { ...defaultDesign(), layout } as Design;
  const win = d.openings.find((o) => o.kind === 'window')!;
  win.t = t; win.w = w; win.h = h; win.sill = 1050;
  const c = autoPlan(d, cat, 'EO')[0]; if (!c) continue;
  const L = wallLength(d.room, win.wall);
  // 냉장고 · 키큰장 묶음의 키큰 EP(바닥 ~ 천장)도 상부 줄 틈을 메운다 — 냉장고 윗장과 상부장 사이 20 은 빈틈이 아니다
  const up = c.items.filter((i) => i.wall === win.wall && (i.level === 'wall' || (i.tag === 'ep' && i.level === 'tall'))).sort((a, b) => a.t - b.t);
  const gaps: string[] = [];
  for (let i = 1; i < up.length; i++) { const g = up[i].t - (up[i - 1].t + up[i - 1].w); if (g > 1) gaps.push(`${Math.round(up[i - 1].t + up[i - 1].w)}~${Math.round(up[i].t)}`); }
  const hs = [...new Set(up.filter((i) => i.tag !== 'ep').map((i) => i.ov?.NSTD_H ?? '720'))];
  if (gaps.length) { bad++; console.log(layout, `창 t${t} w${w} h${h}`, '빈틈', gaps.join(' '), '| 높이', hs.join(','), '|', up.map((i) => `${i.key}:${Math.round(i.t)}+${i.w}${i.ov?.NSTD_H ? 'h' + i.ov.NSTD_H : ''}`).join(' ')); }
}
console.log('빈틈 있는 경우', bad);
