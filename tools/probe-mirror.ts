import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
// 왼쪽(0)+정면(1) 과 정면(1)+오른쪽(2) — 벽마다 모드로 같은 조건
for (const walls of [[0, 1], [1, 2], [0, 1, 2]] as WallId[][]) {
  const cs = autoPlan({ ...defaultDesign(), layout: 'walls', walls }, cat, 'EO');
  const c = cs[0];
  console.log('\n##', walls.join('+'), c?.title, cs.length);
  for (const w of c?.walls ?? []) for (const lv of ['base', 'wall', 'tall']) console.log(` w${w} ${lv}:`, c!.items.filter((x) => x.wall === w && x.level === lv).sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
  console.log('  skips', JSON.stringify(c?.skips), 'counters', c?.counters.filter((k) => !k.island).map((k) => `${Math.round(k.t0)}-${Math.round(k.t1)}`).join(' '));
}
