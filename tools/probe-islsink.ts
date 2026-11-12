// 아일랜드 싱크 — 싱크장을 아일랜드로 옮긴 설계(fix.sink.island)가 아일랜드에 놓이는지, 식기세척기가 옆에 붙는지, 아일랜드를 끄면 벽으로 돌아가는지.
// npx vite-node tools/probe-islsink.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan, BASE_D, type Candidate, type Item } from '../src/autoplan';
import { defaultDesign, type Design, type LayoutKind } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const P = (f: Item['frame'], t: number, u: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
let n = 0, none = 0, onWall = 0, overlap = 0, dishFar = 0, ptOff = 0, offStay = 0, dishWith = 0, hobWall = 0;
const sample: string[] = [];
const note = (s: string) => { if (sample.length < 14) sample.push(s); };
const sinkOf = (c: Candidate) => c.items.find((x) => x.tag === 'sink');
for (const layout of ['I', 'L', 'U', 'II'] as LayoutKind[]) for (const style of ['basic', 'storage'] as const)
  for (const [w, dd] of [[4200, 3600], [4800, 4200], [3600, 3600]]) for (const series of ['EO', 'KB'] as const) {
    const base = { ...defaultDesign(), layout, style, island: true, room: { w, d: dd, h: 2400 } } as Design;
    const cases: [string, Design][] = [
      ['①', { ...base, fix: { sink: { wall: 0, c: 700, island: true } } }],
      ['②', { ...base, fix: { sink: { wall: 0, c: 700, island: true }, hob: { wall: 0, c: 2000, island: true } } }],
      ['③', { ...base, islandCfg: { ...base.islandCfg, pos: { x: w / 2, z: dd / 2, rot: 90 } }, fix: { sink: { wall: 0, c: 700, island: true } } }],
    ];
    for (const [k, d] of cases) {
      const c = autoPlan(d, cat, series)[0];
      const tag = `${k} ${layout}/${style} ${w}×${dd} ${series}`;
      if (!c) { none++; note(`없음 ${tag}`); continue; }
      n++;
      const sk = sinkOf(c);
      if (!sk || !c.island || sk.wall != null || sk.frame !== c.island.frame) { onWall++; note(`벽싱크 ${tag} — ${c.island ? `아일랜드 ${c.island.len}` : '아일랜드 없음'} · 싱크 ${sk ? (sk.wall != null ? `벽 ${sk.wall}` : '다른 줄') : '없음'}`); continue; }
      // 아일랜드 앞 줄(같은 frame · 하부장 · EP 빼고) 장끼리 겹침
      const row = c.items.filter((x) => x.frame === sk.frame && x.level === 'base' && x.tag !== 'ep').sort((a, b) => a.t - b.t);
      for (let i = 1; i < row.length; i++) if (row[i].t < row[i - 1].t + row[i - 1].w - 1) { overlap++; note(`겹침 ${tag} ${row[i - 1].key}@${row[i - 1].t}+${row[i - 1].w} · ${row[i].key}@${row[i].t}`); }
      const dish = c.items.find((x) => x.tag === 'dish');
      if (dish && dish.frame === sk.frame) dishWith++;
      if (k === '②' && c.items.some((x) => x.tag === 'hob' && x.wall != null)) hobWall++;
      if (dish && dish.frame === sk.frame && Math.abs(dish.t - (sk.t + sk.w)) > 1 && Math.abs(sk.t - (dish.t + dish.w)) > 1) { dishFar++; note(`식세떨어짐 ${tag} 싱크 ${sk.t}+${sk.w} 식세 ${dish.t}`); }
      const sp = P(sk.frame, sk.t + sk.w / 2, BASE_D / 2);
      if (!c.sink || Math.hypot(c.sink[0] - sp[0], c.sink[1] - sp[1]) > 1) { ptOff++; note(`점어긋남 ${tag}`); }
    }
    // ④ 아일랜드를 끈 설계에 아일랜드 싱크 고정이 남음 → 벽 자동 배치로
    const off = { ...base, island: false, fix: { sink: { wall: 0, c: 700, island: true } } } as Design;
    const c4 = autoPlan(off, cat, series)[0];
    const s4 = c4 && sinkOf(c4);
    if (!s4 || s4.wall == null) { offStay++; note(`끈섬남음 ④ ${layout}/${style} ${w}×${dd} ${series} — ${c4 ? (s4 ? '벽 아님' : '싱크 없음') : '배치 없음'}`); }
  }
console.log(sample.join('\n'));
console.log(`아일랜드 싱크 안 ${n} · 없음 ${none} · 벽싱크 ${onWall} · 겹침 ${overlap} · 식세떨어짐 ${dishFar} · 점어긋남 ${ptOff} · 끈섬남음 ${offStay} (참고: 식세 같이 ${dishWith} · ②에서 쿡탑 벽으로 ${hobWall})`);
