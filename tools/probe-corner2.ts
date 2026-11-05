import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const layout of ['L', 'U'] as const) {
  const c = autoPlan({ ...defaultDesign(), layout }, cat, 'EO')[0];
  console.log('\n##', c.title);
  for (const w of c.walls) console.log(' wall', w, c.items.filter((x) => x.wall === w && x.level !== 'wall').sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
}
