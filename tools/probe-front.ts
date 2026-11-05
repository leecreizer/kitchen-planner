import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const walls of [[0], [1], [2]] as const) {
  const d = { ...defaultDesign(), layout: 'walls' as const, walls: [...walls] };
  const cs = autoPlan(d, cat, 'EO');
  console.log(walls, d.room, cs.length, cs[0]?.title, cs[0]?.items.filter((x) => x.level !== 'wall').map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
}
