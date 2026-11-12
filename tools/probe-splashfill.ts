// 벽 마감(타일 · 벽판넬) 채움 — 사용자 2026-11-12 「최초 벽길이에 맞게 벽판넬이나 타일도 맞춰서 적용해줘 상부장이 있으면 상부장 배치 높이까지는 다 채워주고
//   상부장이 없으면 벽면을 꽉 채워줘」. 장 줄이 있는 벽은 벽 길이 전체(거실 어깨 벽 두께까지)에 마감이 깔린다:
//   위 = 상부장이 있으면 상부장 몸통 아래까지 · 없으면 천장까지, 아래 = 하부장(상판)이 있으면 상판 위부터 · 없으면 바닥부터, 키큰장 · 냉장고 자리는 안 깐다(가려짐).
//   창 · 문 구멍(몰딩 포함)과는 겹치지 않는다. npx vite-node tools/probe-splashfill.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan, upperTopOf, BASE_D, COUNTER_D, WALL_D, type Item } from '../src/autoplan';
import { splashLayout, COUNTER_TOP } from '../src/splash';
import { CASING, cabSpan, defaultDesign, wallPoint, type Design, type LayoutKind, type StyleKind, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let cols = 0, holes = 0, spill = 0, overlap = 0, behind = 0, walls = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 14) out.push(s); };
type Iv = [number, number];
const sub = (a: Iv[], b: Iv): Iv[] => a.flatMap(([p, q]) => (b[1] <= p || b[0] >= q ? [[p, q]] : [[p, Math.min(q, b[0])], [Math.max(p, b[1]), q]].filter(([x, y]) => y - x > 0.5) as Iv[]));
for (const layout of ['I', 'L', 'U', 'II'] as LayoutKind[]) for (const style of ['basic', 'cafe', 'storage'] as StyleKind[]) for (const room of [{ w: 3600, d: 4200 }, { w: 4200, d: 3600 }])
  for (const win of [null, { t: 300, w: 900, h: 600, sill: 1250 }, { t: 1300, w: 1500, h: 1100, sill: 1050 }]) for (const wing of [{ a: 0, b: 0 }, { a: 600, b: 0 }]) {
    const d = { ...defaultDesign(), layout, style, wing, room: { ...room, h: 2400 } } as Design;
    const w0 = d.openings.find((o) => o.kind === 'window');
    if (w0 && win) Object.assign(w0, win); else if (w0 && !win) d.openings = d.openings.filter((o) => o !== w0);
    for (const series of ['EO', 'KB'] as const) {
      const c = autoPlan(d, cat, series)[0]; if (!c) continue;
      const segs = splashLayout(c, d), upTop = upperTopOf(d.room);
      const wallOf = new Map(c.items.filter((x) => x.wall != null).map((x) => [x.frame, x.wall!] as const));
      for (const wall of new Set(c.splashes.map((s) => wallOf.get(s.frame)).filter((w): w is WallId => w != null))) {
        walls++;
        const [lo, hi] = cabSpan(d, wall), its = c.items.filter((x) => x.wall != null && x.level !== 'shelf');
        // 벽에서 10 떨어진 점이 어느 장 바닥 자리 안에 드는가 — 이 벽 장 + 구석에서 옆면을 댄 옆 벽 장(구현과 다른 길로 잰다)
        const depOf = (i: Item) => (i.level === 'base' ? COUNTER_D : i.level === 'wall' ? WALL_D : BASE_D);
        const inside = (i: Item, x: number) => { const p = wallPoint(d.room, wall, x, 10), f = i.frame, rx = p[0] - f.o[0], rz = p[1] - f.o[1], t = rx * f.dir[0] + rz * f.dir[1], u = rx * f.n[0] + rz * f.n[1]; return t > i.t && t < i.t + i.w && u > -1 && u < depOf(i); };
        const tOn = (i: Item) => [[i.t, 0], [i.t + i.w, 0], [i.t, depOf(i)], [i.t + i.w, depOf(i)]].map(([t, u]) => { const f = i.frame, p0 = wallPoint(d.room, wall, 0, 0), p1 = wallPoint(d.room, wall, 1, 0); return (f.o[0] + f.dir[0] * t + f.n[0] * u - p0[0]) * (p1[0] - p0[0]) + (f.o[1] + f.dir[1] * t + f.n[1] * u - p0[1]) * (p1[1] - p0[1]); });
        const ctr = c.counters.filter((k) => !k.island);
        const underCounter = (x: number) => ctr.some((k) => { const p = wallPoint(d.room, wall, x, 10), f = k.frame, rx = p[0] - f.o[0], rz = p[1] - f.o[1], t = rx * f.dir[0] + rz * f.dir[1], u = rx * f.n[0] + rz * f.n[1]; return t > k.t0 && t < k.t1 && u > Math.min(k.z0, k.z1) - 1 && u < Math.max(k.z0, k.z1); });
        const kOn = (k: (typeof ctr)[number]) => [[k.t0, k.z0], [k.t1, k.z0], [k.t0, k.z1], [k.t1, k.z1]].map(([t, u]) => { const f = k.frame, p0 = wallPoint(d.room, wall, 0, 0), p1 = wallPoint(d.room, wall, 1, 0); return (f.o[0] + f.dir[0] * t + f.n[0] * u - p0[0]) * (p1[0] - p0[0]) + (f.o[1] + f.dir[1] * t + f.n[1] * u - p0[1]) * (p1[1] - p0[1]); });
        const pieces = segs.filter((s) => s.wall === wall).flatMap((s) => s.pieces.map(([x0, x1, ya, yb]) => ({ x0: s.r0 + x0, x1: s.r0 + x1, ya: s.y0 + ya, yb: s.y0 + yb })));
        const edges = [...its.flatMap(tOn), ...ctr.flatMap(kOn), ...d.openings.filter((o) => o.wall === wall).flatMap((o) => [o.t - CASING, o.t + o.w + CASING])];
        const tag = `${layout}/${style}/${series}/${room.w}×${room.d}/창${win ? win.t : '없음'}/날개${wing.a} 벽${wall}`;
        for (let x = lo + 25; x < hi; x += 50) {
          if (edges.some((e) => Math.abs(e - x) < 4)) continue;
          cols++;
          const at = pieces.filter((p) => p.x0 < x && p.x1 > x), on = (lv: string) => its.filter((i) => i.level === lv && inside(i, x));
          const ops = d.openings.filter((o) => o.wall === wall && o.t - CASING < x && o.t + o.w + CASING > x);
          const holesAt: Iv[] = ops.map((o) => (o.kind === 'window' ? [o.sill - CASING, o.sill + o.h + CASING] : [-1e9, o.h + CASING]));
          for (const p of at) if (holesAt.some(([a, b]) => p.yb > a + 1 && p.ya < b - 1)) { overlap++; note(`${tag} x${x} 구멍과 겹침 ${Math.round(p.ya)}~${Math.round(p.yb)}`); }
          if (on('tall').length) { if (at.length) { behind++; note(`${tag} x${x} 키큰장 뒤에 깔림`); } continue; }
          const base = on('base').length > 0 || underCounter(x), up = on('wall');
          const y0 = base ? COUNTER_TOP : 0, y1 = up.length ? Math.min(...up.map((i) => upTop - (Number(i.ov?.NSTD_H) || (i.key === 'fridgeTop' ? 315 : 720)))) : d.room.h;
          let want: Iv[] = y1 - y0 > 20 ? [[y0, y1]] : [];
          for (const h of holesAt) want = sub(want, h);
          want = want.filter(([a, b]) => b - a >= 20);
          let left = want;
          for (const p of at) left = sub(left, [p.ya - 1, p.yb + 1]);
          if (left.some(([a, b]) => b - a > 2)) { holes++; note(`${tag} x${x} 빈 곳 ${left.map(([a, b]) => `${Math.round(a)}~${Math.round(b)}`).join(' ')} (원하는 ${want.map(([a, b]) => `${Math.round(a)}~${Math.round(b)}`).join(' ')})`); }
          let extra: Iv[] = at.map((p) => [p.ya, p.yb]);
          for (const wv of want) extra = extra.flatMap((e) => sub([e], [wv[0] - 1, wv[1] + 1]));
          if (extra.some(([a, b]) => b - a > 2)) { spill++; note(`${tag} x${x} 넘침 ${extra.map(([a, b]) => `${Math.round(a)}~${Math.round(b)}`).join(' ')}`); }
        }
      }
    }
  }
for (const s of out) console.log(' ', s);
console.log(`벽 마감 채움 벽 ${walls} · 세로줄 ${cols} · 빈 곳 ${holes} · 넘침 ${spill} · 구멍 겹침 ${overlap} · 키큰장 뒤 ${behind}`);
