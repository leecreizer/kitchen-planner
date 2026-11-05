import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, wallLength, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const style of ['basic', 'storage', 'cafe'] as const) {
  const d = { ...defaultDesign(), layout: 'U', style } as Design;
  for (const c of autoPlan(d, cat, 'EO').slice(0, 2)) {
    console.log('==', style, c.title, c.walls);
    for (const w of c.walls) {
      const L = wallLength(d.room, w);
      for (const lv of ['base', 'wall', 'tall']) {
        const xs = c.items.filter((i) => i.wall === w && i.level === lv).sort((a, b) => a.t - b.t);
        if (!xs.length) continue;
        console.log(`  ${w}(L${L}) ${lv} ${Math.round(xs[0].t)}~${Math.round(xs[xs.length - 1].t + xs[xs.length - 1].w)}: ${xs.map((i) => `${i.key}:${Math.round(i.t)}+${i.w}`).join(' ')}`);
      }
    }
  }
}
