// 짧은 벽 — 쿡탑 조리장 자동으로 줄이기. npx vite-node tools/probe-hobw.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, viewWalls } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const L of [3600, 3300, 3000, 2800, 2600]) {
  const d = { ...defaultDesign(), layout: 'I' as const };
  const front = viewWalls(d.openWall).front;
  if (front % 2 === 0) d.room = { ...d.room, w: L }; else d.room = { ...d.room, d: L };
  const c = autoPlan(d, cat, 'EO')[0];
  const hob = c?.items.find((x) => x.tag === 'hob');
  console.log(L, c?.title, 'hob', hob && `${hob.key} ${hob.w}`, '|', c?.items.filter((x) => x.level === 'base' || x.level === 'tall').sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.w}`).join(' '), '|', c?.warnings.join(' / '));
}
