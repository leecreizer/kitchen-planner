import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const fa of [undefined, { wall: 0, end: 'start' }, { wall: 0, end: 'end' }, { wall: 1, end: 'start' }, { wall: 1, end: 'end' }] as const) {
  const d = { ...defaultDesign(), layout: 'L' as const, fridgeAt: fa as never };
  const c = autoPlan(d, cat, 'EO')[0];
  const fr = c?.items.find((x) => x.key === 'fridge');
  console.log('\n##', JSON.stringify(fa), c?.title, 'fridge', fr && `${fr.wall}:${fr.t}`);
  for (const w of c?.walls ?? []) console.log(' wall', w, c!.items.filter((x) => x.wall === w && x.level !== 'wall').sort((a, b) => a.t - b.t).map((x) => `${x.key}:${x.t}+${x.w}`).join(' '));
}
