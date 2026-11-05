import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const [rw, rd] of [[3600, 4200], [4200, 3600]]) for (const h of [300, 400, 480, 500, 600, 700]) {
  const d = { ...defaultDesign(), layout: 'L' } as Design;
  d.room = { ...d.room, w: rw, d: rd };
  const win = d.openings.find((o) => o.kind === 'window')!; win.h = h; win.w = 1500; win.t = 1300;
  const c = autoPlan(d, cat, 'EO')[0];
  const xs = c.items.filter((i) => i.wall === win.wall && i.level === 'wall').sort((a, b) => a.t - b.t);
  let gaps = ''; for (let i = 1; i < xs.length; i++) { const g = xs[i].t - (xs[i - 1].t + xs[i - 1].w); if (Math.abs(g) > 0.5) gaps += ` [gap ${Math.round(xs[i-1].t + xs[i-1].w)}~${Math.round(xs[i].t)}]`; }
  console.log(rw, rd, 'h', h, 'top', win.sill + h, xs.map((i) => `${i.key}:${Math.round(i.t)}+${i.w}${i.ov?.NSTD_H ? 'H' + i.ov.NSTD_H : ''}`).join(' '), gaps);
}
