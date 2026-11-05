import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const base = defaultDesign();
for (const [layout, style, island] of [['I', 'basic', false], ['L', 'basic', false], ['L', 'cafe', true], ['U', 'storage', false], ['II', 'basic', false], ['L', 'storage', true]] as const) {
  const d: Design = { ...base, layout, style, island, room: layout === 'U' || island ? { w: 4800, d: 4400, h: 2400 } : base.room };
  const t = performance.now();
  const cs = autoPlan(d, cat, 'EO');
  console.log(`== ${layout} ${style} island=${island} → ${cs.length}안 ${(performance.now() - t) | 0}ms`);
  for (const c of cs) {
    console.log(`  [${c.score}] ${c.title} ${JSON.stringify(c.metrics)}`);
    const byWall = new Map<string, string[]>();
    for (const it of c.items) { const k = `${it.wall ?? 'island'}:${it.level}`; byWall.set(k, [...(byWall.get(k) ?? []), `${it.key}@${it.t}+${it.w}`]); }
    for (const [k, v] of byWall) console.log('     ', k, v.join(' '));
    c.reasons.forEach((r) => console.log('      ·', r)); c.warnings.forEach((r) => console.log('      !', r));
  }
}
