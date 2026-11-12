// 거실과 이어진 쪽 — 부엌 옆 벽 장 줄은 트인 쪽 끝에서 거실 어깨 벽 두께(150)까지 더 간다(날개벽이면 그 끝은 날개벽에서 끝).
// 사용자 2026-11-11 「거실과 부엌 연결되는 곳의 두께많금 장도 추가로 배치가 되도록해야해」 — 벽 길이(평면도 4,350)는 두께를 넣었는데 장은 방 안쪽(4,200)까지만 놓였다.
// 트인 쪽 끝 가까이(200 안)까지 간 하부 · 상부 줄이 그 두께 끝에서 멈추는지, 두께 밖으로 나가지 않는지. npx vite-node tools/probe-shoulder.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, nextWall, prevWall, wallLength, WALL_THICK, type Design, type LayoutKind, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const T = WALL_THICK;
let rows = 0, short = 0, over = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 16) out.push(s); };
// 사용자 2026-11-11 「벽이 돌출된 상태가 아니면 이 전체 공간 길이로 보고 자동배치」 — 날개벽만 아니면 거실 벽이 이어진(어깨 0) 쪽도 두께까지.
// 장 배치 길이를 전체 길이(두께 포함)로 넣으면 자르지 않는다
for (const ow of [0, 1, 2, 3] as WallId[]) for (const layout of ['I', 'L', 'Lr', 'U', 'II'] as LayoutKind[]) for (const wing of [{ a: 0, b: 0 }, { a: 600, b: 0 }])
  for (const room of [{ w: 4200, d: 3600 }, { w: 3600, d: 4200 }]) for (const living of [{ a: 1500, b: 1500 }, { a: 0, b: 0 }]) for (const fullLen of [false, true]) {
    const d = { ...defaultDesign(), openWall: ow, layout, wing, living: { depth: 4000, ...living }, room: { ...room, h: 2400 }, openings: [] } as Design;
    if (fullLen) d.runLen = Object.fromEntries([prevWall(ow), nextWall(ow)].map((w) => [w, { len: wallLength(d.room, w) + T }]));
    for (const c of autoPlan(d, cat, 'EO').slice(0, 2)) {
      for (const [w, atEnd, wingHere] of [[prevWall(ow), true, wing.a > 0], [nextWall(ow), false, wing.b > 0]] as [WallId, boolean, boolean][]) {
        const L = wallLength(d.room, w), band = wingHere ? 0 : T, lo = atEnd ? 0 : -band, hi = atEnd ? L + band : L;
        for (const lv of ['base', 'wall'] as const) {
          const its = c.items.filter((x) => x.wall === w && (x.level === lv || x.level === 'tall'));
          if (!its.some((x) => x.level === lv)) continue;
          const edge = atEnd ? Math.max(...its.map((x) => x.t + x.w)) : Math.min(...its.map((x) => x.t));
          const tag = `트인벽${ow}/${layout}/날개${wing.a}/어깨${living.a}/${fullLen ? '길이입력' : '-'}/${room.w}×${room.d} 벽${w} ${lv} ${atEnd ? '끝' : '시작'}`;
          if (its.some((x) => x.t < lo - 1 || x.t + x.w > hi + 1)) { over++; note(`${tag} — 두께 밖으로 나감 (${Math.round(edge)}, 범위 ${lo}~${hi})`); continue; }
          const nearOpen = atEnd ? edge >= L - 200 : edge <= 200;
          if (!nearOpen) continue;
          rows++;
          if (Math.abs(edge - (atEnd ? hi : lo)) > 1) { short++; note(`${tag} — 줄 끝 ${Math.round(edge)}, 두께 끝 ${atEnd ? hi : lo}`); }
        }
      }
    }
  }
for (const s of out) console.log(' ', s);
console.log(`어깨 두께 줄 ${rows} · 덜 감 ${short} · 넘침 ${over}`);
