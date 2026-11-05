// 옆 벽 코너 쪽 냉장고 — 정면 줄이 코너장까지 다 차고, 냉장고는 옆 줄 비운 코너 바로 뒤. npx vite-node tools/probe-rfridge.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, newOpening } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const d = defaultDesign();
d.layout = 'L';
const win = d.openings.find((o) => o.kind === 'window')!; win.wall = 1; win.t = 1700; win.w = 1500;
const u = newOpening('utility', d.room, 0); u.t = d.room.w - 710 - u.w; d.openings.push(u);
for (const fa of [{ wall: 2, end: 'start' }, { wall: 0, end: 'end' }] as const) {
  const cs = autoPlan({ ...d, fridgeAt: fa }, cat, 'EO');
  console.log(fa, cs.map((c) => c.title + " " + c.score));
  for (const c of cs.filter((x) => x.walls.includes(fa.wall))) {
    console.log('\n##', JSON.stringify(fa), c.title, c.score);
    for (const w of c.walls) for (const lv of ['base', 'tall', 'wall']) console.log(` w${w} ${lv}:`, c.items.filter((x) => x.wall === w && x.level === lv).sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
  }
}
