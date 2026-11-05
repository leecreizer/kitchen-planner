import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const [x, rot] of [[700, 90], [2000, 90], [2000, 270], [3000, 90], [3050, 90]] as const) {
  const d = { ...defaultDesign(), island: true, islandCfg: { len: 2400, over: 300, pos: { x, z: 1850, rot } } };
  const c = autoPlan(d, cat, 'EO')[0];
  const i = c?.island;
  console.log(`x=${x} rot=${rot}`, i ? `att=${i.attached} cx=${Math.round(i.cx)} cz=${Math.round(i.cz)} corner=${JSON.stringify(i.corner)}` : '없음', '|', c?.warnings.filter((w) => /아일랜드/.test(w)).join(' '));
  console.log('   wall0:', c?.items.filter((q) => q.wall === 0 && q.level !== 'wall').sort((a, b) => a.t - b.t).map((q) => `${q.key}:${q.t}+${q.w}`).join(' '));
}
