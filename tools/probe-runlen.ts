import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type Design, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const show = (title: string, d: Design) => {
  const c = autoPlan(d, cat, 'EO')[0];
  console.log('==', title, 'walls', c?.walls, c?.warnings.join(' / '));
  if (!c) return;
  for (const w of c.walls) for (const lv of ['base', 'wall', 'tall']) {
    const xs = c.items.filter((i) => i.wall === w && i.level === lv).sort((a, b) => a.t - b.t);
    if (!xs.length) continue;
    let gaps = ''; for (let i = 1; i < xs.length; i++) { const g = xs[i].t - (xs[i - 1].t + xs[i - 1].w); if (Math.abs(g) > 0.5) gaps += ` [빈 ${Math.round(xs[i - 1].t + xs[i - 1].w)}~${Math.round(xs[i].t)}]`; }
    console.log(' ', w, lv, `${Math.round(xs[0].t)}~${Math.round(xs[xs.length - 1].t + xs[xs.length - 1].w)}`, xs.map((i) => `${i.key}:${Math.round(i.t)}+${i.w}`).join(' '), gaps);
  }
  for (const ct of c.counters.filter((x) => !x.island)) console.log('  상판', Math.round(ct.t0), '~', Math.round(ct.t1));
  console.log(' ', c.reasons.filter((r) => r.includes('배치 길이')).join(' / '));
};
const base = () => ({ ...defaultDesign(), layout: 'L' } as Design);
show('ㄱ자 기본', base());
let d = base(); const c0 = autoPlan(d, cat, 'EO')[0];
for (const w of c0.walls) { d = base(); d.runLen = { [w]: { len: 2400 } } as Design['runLen']; show(`ㄱ자 벽${w} 2400`, d); }
d = { ...defaultDesign(), layout: 'I' } as Design; show('ㅡ자 기본', d);
const fw = autoPlan(d, cat, 'EO')[0].walls[0] as WallId;
d = { ...defaultDesign(), layout: 'I' } as Design; d.runLen = { [fw]: { len: 3000 } } as Design['runLen']; show('ㅡ자 3000 왼쪽부터', d);
d = { ...defaultDesign(), layout: 'I' } as Design; d.runLen = { [fw]: { len: 3000, from: 'end' } } as Design['runLen']; show('ㅡ자 3000 오른쪽부터', d);
