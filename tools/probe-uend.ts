// 상부장 끝처리 — 벽 · 옆 장 · 키큰장 · EP 아무것도 안 닿은 상부장 끝 찾기. npx vite-node tools/probe-uend.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, wallLength, prevWall, nextWall, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const cases: [string, Partial<Design>][] = [];
for (const layout of ['I', 'L', 'U', 'II'] as const) for (const style of ['basic', 'storage'] as const) for (const openWall of [3, 2, null] as const) {
  cases.push([`${layout}/${style}/open${openWall}`, { layout, style, openWall }]);
  cases.push([`${layout}/${style}/open${openWall}/fR`, { layout, style, openWall, fridgeAt: { wall: 1, end: 'start' } }]);
  cases.push([`${layout}/${style}/open${openWall}/fF`, { layout, style, openWall, fridgeAt: { wall: 0, end: 'end' } }]);
}
let bad = 0;
for (const [name, p] of cases) {
  const d = { ...defaultDesign(), ...p } as Design;
  for (const series of ['EO', 'KB'] as const) for (const c of autoPlan(d, cat, series)) {
    for (const it of c.items) {
      if (it.level !== 'wall' || it.tag === 'ep' || it.wall == null) continue;
      const L = wallLength(d.room, it.wall);
      const same = c.items.filter((x) => x !== it && x.wall === it.wall && (x.level === 'wall' || x.level === 'tall'));
      const touch = (x: number) => same.some((o) => Math.abs(o.t - x) < 2 || Math.abs(o.t + o.w - x) < 2);
      const wallS = it.t <= 1 && prevWall(it.wall) !== d.openWall, wallE = it.t + it.w >= L - 1 && nextWall(it.wall) !== d.openWall;
      // 코너 비운 쪽(340) — 옆 벽 상부장이 막는다
      const cornerS = Math.abs(it.t - 340) < 2, cornerE = Math.abs(it.t + it.w - (L - 340)) < 2;
      const miss = [!wallS && !cornerS && !touch(it.t) ? 'start' : '', !wallE && !cornerE && !touch(it.t + it.w) ? 'end' : ''].filter(Boolean);
      if (miss.length) { bad++; if (bad < 40) console.log(name, series, c.title, `w${it.wall}`, it.key, it.t, it.w, 'L', L, miss.join(',')); }
    }
  }
}
console.log('open ends', bad);
