// 코너장 좌 · 우 바꾸기 — 코너장은 코너 자리에 묶여 끌어 옮길 수 없다. 대신 코너를 맡는 벽을 뒤집는다(d.cornerFlip['앞벽-뒷벽']).
// 사용자 2026-11-11 「코너장은 이동이안되면 좌코너 우코너 변경 가능하게해」. 뒤집으면 코너장이 옆 벽 줄로 가고(L ↔ R), 장끼리 안 겹친다.
// npx vite-node tools/probe-cornerflip.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { cabSpan, defaultDesign, nextWall, type Design, type LayoutKind, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let cases = 0, same = 0, bad = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 14) out.push(s); };
const cornerOf = (c: { items: { key: string; wall?: WallId | null; level: string }[] }, a: WallId, b: WallId) =>
  c.items.filter((x) => x.level === 'base' && ((x.key === 'cornerR' && x.wall === a) || (x.key === 'cornerL' && x.wall === b))).map((x) => `${x.key}@벽${x.wall}`).join(',');
for (const layout of ['L', 'Lr', 'U'] as LayoutKind[]) for (const ow of [3, 2, null] as (WallId | null)[]) for (const room of [{ w: 4200, d: 3600 }, { w: 3600, d: 4200 }, { w: 5000, d: 4000 }]) {
  const d0 = { ...defaultDesign(), layout, openWall: ow, room: { ...room, h: 2400 }, openings: [] } as Design;
  const c0 = autoPlan(d0, cat, 'EO')[0];
  if (!c0) continue;
  for (const a of c0.walls) {
    const b = nextWall(a);
    if (!c0.walls.includes(b)) continue;
    const k0 = cornerOf(c0, a, b);
    if (!k0) continue;   // 이 코너엔 코너장이 없다(냉장고 · 팬트리 · 입구)
    cases++;
    const d1 = { ...d0, cornerFlip: { [`${a}-${b}`]: true } } as Design;
    const c1 = autoPlan(d1, cat, 'EO')[0];
    const k1 = c1 ? cornerOf(c1, a, b) : '';
    const tag = `${layout}/트인벽${ow}/${room.w}×${room.d} 코너 ${a}-${b}`;
    if (!c1 || !k1 || k1 === k0) { same++; note(`${tag} — 안 바뀜 (${k0} → ${k1 || '없음'})`); continue; }
    // 같은 벽 같은 층 겹침 · 구간 밖
    const its = c1.items.filter((x) => x.wall != null && x.level !== 'shelf');
    let hit = '';
    for (let i = 0; i < its.length && !hit; i++) for (let j = i + 1; j < its.length && !hit; j++) {
      const p = its[i], q = its[j];
      if (p.wall !== q.wall) continue;
      const zone = p.level === 'tall' || q.level === 'tall' ? true : p.level === q.level;
      if (!zone || (p.key === 'fridgeTop' && q.level === 'tall') || (q.key === 'fridgeTop' && p.level === 'tall')) continue;
      if (Math.min(p.t + p.w, q.t + q.w) - Math.max(p.t, q.t) > 1) hit = `${p.key}(${Math.round(p.t)}) · ${q.key}(${Math.round(q.t)}) 벽${p.wall}`;
    }
    const outside = its.find((x) => { const [lo, hi] = cabSpan(d1, x.wall as WallId); return x.t < lo - 1 || x.t + x.w > hi + 1; });
    if (hit || outside) { bad++; note(`${tag} — ${hit ? '겹침 ' + hit : '구간 밖 ' + outside!.key}`); }
  }
}
for (const s of out) console.log(' ', s);
console.log(`코너 뒤집기 경우 ${cases} · 안 바뀜 ${same} · 겹침 ${bad}`);
