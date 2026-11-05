import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const layout of ['I', 'L', 'U', 'II'] as const) for (const style of ['basic', 'storage'] as const) {
  const d = { ...defaultDesign(), layout, style, island: true };
  const c = autoPlan(d, cat, 'EO')[0];
  console.log(layout, style, c?.title, 'island', c?.island ? `${Math.round(c.island.cx)},${Math.round(c.island.cz)} len ${c.island.len}` : '없음', c?.warnings.filter((w) => /아일랜드/.test(w)).join(''));
}
