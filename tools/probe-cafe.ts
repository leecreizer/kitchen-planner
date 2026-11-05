import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const [lay, ser] of [['L', 'EO'], ['I', 'EO'], ['U', 'KB'], ['L', 'KB']] as const) {
  const d = { ...defaultDesign(), layout: lay, style: 'cafe' } as Design;
  const c = autoPlan(d, cat, ser)[0];
  console.log('==', lay, ser, c.warnings.join('/'));
  for (const w of c.walls) for (const lv of ['tall', 'wall', 'shelf']) { const xs = c.items.filter((i) => i.wall === w && i.level === lv).sort((a, b) => a.t - b.t); if (xs.length) console.log(' ', w, lv, xs.map((i) => `${i.key}:${Math.round(i.t)}+${Math.round(i.w)}`).join(' ')); }
}
