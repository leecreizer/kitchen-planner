// 설비 관이 묻혀야 할 곳에 묻혔나 — 사용자 2026-11-11 「바닥에 메몰되거나 벽에 메몰해야하는 설비들의 라인들을 체크해서 수정해 지금은 공간에 다 노출되어있어」.
//   급수 · 온수 · 난방 · 배수 · 전기는 바닥 속(높이 < 0) · 천장 위(> 천장) · 벽 속(붙일 벽 면 뒤 벽 두께 안) · 장 안(하부장 · 키큰장 · 상부장 부피)만 지나야 한다.
//   끝에서 150 까지는 기기에 닿는 꼭지(벽 · 바닥에서 나온 짧은 관)로 본다.
//   가스는 묻지 않고(가스 배관은 노출이 원칙) 벽 면에 붙어(앞 40 안) 가거나 장 안. 배기 덕트는 천장 속 · 장(후드) 안 · 끝 300 꼭지.
//   npx vite-node tools/probe-mepbury.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan, upperBottomOf, upperTopOf, type Candidate } from '../src/autoplan';
import { defaultDesign, newOpening, wallLine, WALL_THICK, type Design, type LayoutKind, type OpeningKind, type WallId } from '../src/plan';
import { mepOf, mountWalls, type Sys, type V3 } from '../src/mep';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let runs = 0, exposed = 0, gasBad = 0, ventBad = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 30) out.push(s); };
const BURY: Sys[] = ['water', 'drain', 'heat', 'power'];
function judge(tag: string, d: Design, c: Candidate) {
  const m = mepOf(d, c), H = d.room.h, segs = mountWalls(d);
  /** 붙일 벽 면 기준 — 벽 따라 0~1 안에서 면 앞(+)/뒤(−) 거리 */
  const wallU = (x: number, z: number) => {
    let best = Infinity;
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, k = L2 ? ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2 : -1;
      if (k < -0.001 || k > 1.001) continue;
      const u = (x - s.a[0]) * s.n[0] + (z - s.a[1]) * s.n[1];
      if (Math.abs(u) < Math.abs(best)) best = u;
    }
    return best;
  };
  const inWall = (p: V3) => { const u = wallU(p[0], p[2]); return u <= -1 && u >= -WALL_THICK - 1; };
  const upB = upperBottomOf(d.room), upT = upperTopOf(d.room);
  const inCab = (p: V3) => c.items.some((it) => {
    const f = it.frame, t = (p[0] - f.o[0]) * f.dir[0] + (p[2] - f.o[1]) * f.dir[1], u = (p[0] - f.o[0]) * f.n[0] + (p[2] - f.o[1]) * f.n[1];
    if (t < it.t - 1 || t > it.t + it.w + 1) return false;
    if (it.level === 'wall') return u >= -1 && u <= 400 && p[1] >= upB - 200 && p[1] <= H;   // 상부장 · 후드 (후드는 상부장 밑으로 내려온다) · 상부장 위 막음판 ~ 천장
    const D = it.wall == null ? 700 : 640;
    return u >= (it.wall == null ? -100 : -1) && u <= D && p[1] >= -1 && p[1] <= (it.level === 'tall' ? H : 950);
  });
  void upT;
  // 벽 너머 공간 가구(room3d — 세탁기 · 건조기 · 세탁 싱크장 · 서브주방 장 · 팬트리 선반) — 안쪽 벽(맞은편 · 양옆)에서 400 안은 모든 높이, 700 안은 장 높이(950)까지
  const inRoomFurn = (p: V3) => d.openings.some((o) => {
    const ln = o.depth ? wallLine(d, o.wall) : null;
    if (!ln) return false;
    const t = (p[0] - ln.o[0]) * ln.dir[0] + (p[2] - ln.o[1]) * ln.dir[1], u = (p[0] - ln.o[0]) * ln.n[0] + (p[2] - ln.o[1]) * ln.n[1];
    const x0 = o.t - 300, x1 = o.t + o.w + 300, ub = -WALL_THICK - o.depth!;
    if (t < x0 || t > x1 || u > -WALL_THICK || u < ub) return false;
    const near = Math.min(u - ub, t - x0, x1 - t);
    return near <= 400 || (near <= 700 && p[1] <= 950);
  });
  for (const r of m.runs) {
    runs++;
    // 길 따라 25 마다 점 — 끝에서 거리(길이)
    const pts: { p: V3; s: number }[] = [];
    let s = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(1, Math.ceil(L / 25));
      for (let k = 0; k < n; k++) { const q = k / n; pts.push({ p: [a[0] + (b[0] - a[0]) * q, a[1] + (b[1] - a[1]) * q, a[2] + (b[2] - a[2]) * q], s: s + L * q }); }
      s += L;
    }
    const total = s;
    const stub = r.sys === 'vent' ? 300 : 150;
    // 섬 천장형 후드 — 후드에서 천장까지는 후드 몸통 · 침니 · 매다는 봉 기둥 안(kitchen3d ceilingHood). 2026-11-11 옆 벽 줄이 어깨 두께만큼 길어져 「섬 싱크 · 쿡탑」 경우에 쿡탑이 처음 섬에 놓이며 드러났다
    const ih = r.to === '아일랜드 후드' ? r.pts[0] : null;
    const inIslandHood = (p: V3) => !!ih && Math.hypot(p[0] - ih[0], p[2] - ih[2]) <= 200 && p[1] >= ih[1] - 1 && p[1] <= H + 1;
    let bad = 0, where: V3 | null = null, gasIn = 0;
    for (const { p, s: at } of pts) {
      if (at <= stub || total - at <= stub) continue;
      let ok: boolean;
      if (BURY.includes(r.sys)) ok = p[1] < 0 || p[1] > H || inWall(p) || inCab(p) || inRoomFurn(p);
      else if (r.sys === 'gas') {
        // 가스 — 벽 면에 붙어(앞 40 안) · 장 안 · 바닥 속(아일랜드 슬리브) · 벽 뚫고 지나기(벽 속 연속 220 까지)
        // 입구(문) 구멍 위 — 문 윗선(몰딩 포함) 위는 벽이다(붙일 벽 목록은 문 자리를 통째로 뺀다)
        const overDoor = d.openings.some((o) => { const ln = o.depth ? wallLine(d, o.wall) : null; if (!ln) return false; const t = (p[0] - ln.o[0]) * ln.dir[0] + (p[2] - ln.o[1]) * ln.dir[1], uu = (p[0] - ln.o[0]) * ln.n[0] + (p[2] - ln.o[1]) * ln.n[1]; return t >= o.t - 60 && t <= o.t + o.w + 60 && p[1] > o.h + 50 && uu >= 0 && uu <= 40; });
        const u = overDoor ? 20 : wallU(p[0], p[2]), w = inWall(p);
        gasIn = w ? gasIn + 25 : 0;
        ok = inCab(p) || inRoomFurn(p) || p[1] < 0 || (u >= 0 && u <= 40) || (w && gasIn <= 220);
      } else { const u = wallU(p[0], p[2]); ok = p[1] > H || inCab(p) || inRoomFurn(p) || inIslandHood(p) || p[1] <= 80 || (u >= 0 && u <= 120); }   // 배기 — 천장 속 · 후드 · 장 밑(후드일체형) · 벽 면을 따라 오르내림
      if (!ok) { bad += 25; where ??= p; }
    }
    if (bad > 0) {
      if (BURY.includes(r.sys)) exposed++; else if (r.sys === 'gas') gasBad++; else ventBad++;
      note(`${tag} ${r.sys}${r.sub ? '/' + r.sub : ''} → ${r.to} 노출 ${bad}mm @ ${where!.map(Math.round).join(',')}`);
    }
  }
}
const hobs: [string, string][] = [['CIR-KM7564FR', '인덕션'], ['CTB-HS133P', '가스'], ['CTB-HS614MD', '후드일체형']];
const spaces: (OpeningKind | null)[] = [null, 'utility', 'subkitchen', 'pantry'];
const SPACE_WALL: Record<string, WallId> = { utility: 2, subkitchen: 2, pantry: 1 };
for (const layout of ['I', 'L', 'U', 'II'] as LayoutKind[]) for (const island of [false, true]) for (const [model, name] of hobs) for (const sp of spaces) {
  const d = { ...defaultDesign(), layout, island, appliance: { hob: model } } as Design;
  if (sp) d.openings.push(newOpening(sp, d.room, SPACE_WALL[sp]));
  const c = autoPlan(d, cat, 'EO')[0];
  if (c) judge(`${layout}${island ? '+섬' : ''}/${name}/${sp ?? '-'}`, d, c);
}
for (const [tag, d] of [
  ['섬 싱크 + 벽 식세', { ...defaultDesign(), island: true, fix: { sink: { wall: 0, c: 700, island: true }, dish: { wall: 0, c: 3000 } } }],
  ['섬 싱크 · 쿡탑', { ...defaultDesign(), island: true, islandCfg: { len: 3200, over: 300 }, fix: { sink: { wall: 0, c: 700, island: true }, hob: { wall: 0, c: 2400, island: true } } }],
] as [string, Design][]) { const c = autoPlan(d, cat, 'EO')[0]; if (c) judge(tag, d, c); }
for (const s of out) console.log(' ', s);
console.log(`설비 매몰 관 ${runs} · 노출 ${exposed} · 가스 벽에서 뜸 ${gasBad} · 배기 노출 ${ventBad}`);
