import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const layout of ['I', 'L', 'U'] as const) for (const ow of [3, null] as const) {
  const c = autoPlan({ ...defaultDesign(), layout, openWall: ow }, cat, 'EO')[0];
  console.log('\n##', layout, 'open', ow, c?.title);
  for (const w of c?.walls ?? []) for (const lv of ['base', 'wall']) console.log(` w${w} ${lv}:`, c!.items.filter((x) => x.wall === w && x.level === lv).sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
}
