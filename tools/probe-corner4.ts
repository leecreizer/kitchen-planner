import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, newOpening } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const t of [100, 500, 900, 1600]) {
  const d = { ...defaultDesign(), layout: 'U' as const };
  d.openings.push(newOpening('utility', d.room, 2, t));
  const c = autoPlan(d, cat, 'EO')[0];
  console.log(`\n## 다용도실 오른쪽 벽 t=${t}`, c?.title, c?.reasons.filter((r) => /코너|벽까지/.test(r)).join(' / '));
  for (const w of c?.walls ?? []) console.log(' wall', w, c!.items.filter((x) => x.wall === w && x.level !== 'wall').sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
}
