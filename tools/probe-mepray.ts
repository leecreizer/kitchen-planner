// 3D 에서 설비(인입점 · 콘센트) 끌기 — 마우스 광선(mm)이 가리키는 자리(mepAim). 사용자 2026-11-11 「설비를 선택해서 실시간으로 위치 변경 가능하게해」.
//   ① 벽에 붙는 것: 카메라를 마주 보는 벽 면 위 그 점(높이 포함). 카메라 쪽(뒤에서 뚫고 지나는) 벽은 건너뛴다 — 3D 는 카메라 쪽 벽을 숨긴다
//   ② 벽을 안 가리키면(바닥 쪽) 지금 높이 수평면에서 가장 가까운 벽으로 ③ 높이는 100 ~ 천장 − 100
//   ④ 바닥에 놓는 것: 바닥 면 위 그 점, 바닥 밖이면 가장 가까운 바닥으로. npx vite-node tools/probe-mepray.ts
import { defaultDesign, newOpening, type Design, type LayoutKind, type WallId } from '../src/plan';
import { mepAim, mountWalls, type V3 } from '../src/mep';
let cases = 0, wrongWall = 0, through = 0, offWall = 0, badH = 0, floorBad = 0, nan = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 20) out.push(s); };
const segDist = (x: number, z: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; const k = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k); };
const onMount = (d: Design, p: V3) => mountWalls(d).some((s) => segDist(p[0], p[2], s.a, s.b) <= 1);
const ray = (o: V3, t: V3): [V3, V3] => { const v: V3 = [t[0] - o[0], t[1] - o[1], t[2] - o[2]], L = Math.hypot(...v); return [o, [v[0] / L, v[1] / L, v[2] / L]]; };
const bad = (p: V3 | null) => !p || p.some((v) => !Number.isFinite(v));
for (const layout of ['I', 'L', 'U'] as LayoutKind[]) for (const open of [null, 2, 3] as (WallId | null)[]) for (const side of [false, true]) {
  const d = { ...defaultDesign(), layout, openWall: open } as Design;
  if (side) d.openings.push(newOpening('utility', d.room, 1, 600));
  const H = d.room.h, cx = d.room.w / 2, cz = d.room.d / 2;
  // ① 부엌 벽 — 부엌 가운데(높이 1,600)에서 벽 위 점을 겨누면 그 점
  for (const w of [0, 1, 2, 3] as WallId[]) {
    if (w === open) continue;
    for (const k of [0.2, 0.5, 0.8]) for (const y of [400, 1200, 2000]) {
      const L = w % 2 ? d.room.d : d.room.w, t = L * k;
      const tgt: V3 = w === 0 ? [t, y, 0] : w === 1 ? [d.room.w, y, t] : w === 2 ? [d.room.w - t, y, d.room.d] : [0, y, d.room.d - t];
      if (!onMount(d, tgt)) continue;   // 문 자리 등 붙일 수 없는 곳
      cases++;
      const [o, dir] = ray([cx, 1600, cz], tgt), p = mepAim(d, 'wall', o, dir, 1500);
      if (bad(p)) { nan++; note(`NaN 벽${w} ${layout}`); continue; }
      if (Math.hypot(p![0] - tgt[0], p![1] - tgt[1], p![2] - tgt[2]) > 2) { wrongWall++; note(`${layout} 트임${open} 벽${w} k${k} y${y} → ${p!.map(Math.round)} (기대 ${tgt.map(Math.round)})`); }
      // 카메라 쪽 벽 뒤(밖)에서 겨눠도 — 그 벽을 뚫고 맞은편 벽의 그 점
      const back: V3 = w === 0 ? [cx, 1600, d.room.d + 2500] : w === 1 ? [-2500, 1600, cz] : w === 2 ? [cx, 1600, -2500] : [d.room.w + 2500, 1600, cz];
      const [o2, dir2] = ray(back, tgt), p2 = mepAim(d, 'wall', o2, dir2, 1500);
      cases++;
      if (bad(p2) || Math.hypot(p2![0] - tgt[0], p2![1] - tgt[1], p2![2] - tgt[2]) > 2) { through++; note(`${layout} 트임${open} 밖에서 벽${w} k${k} y${y} → ${p2?.map(Math.round)} (기대 ${tgt.map(Math.round)})`); }
    }
  }
  // ② 바닥 쪽을 가리켜도 벽 위(지금 높이) · ③ 천장 가까이 겨누면 천장 − 100
  for (const [x, z] of [[cx, cz], [cx * 0.5, cz * 0.5], [cx * 1.6, cz * 1.4]]) {
    cases++;
    const [o, dir] = ray([cx, 2200, cz + 300], [x, 0, z]), p = mepAim(d, 'wall', o, dir, 1500);
    if (bad(p)) { nan++; continue; }
    if (!onMount(d, p!)) { offWall++; note(`${layout} 트임${open} 바닥 겨눔 → 벽 밖 ${p!.map(Math.round)}`); }
    if (Math.abs(p![1] - 1500) > 1) { badH++; note(`${layout} 바닥 겨눔 높이 ${Math.round(p![1])} (기대 1500)`); }
  }
  {
    cases++;
    const tgt: V3 = [d.room.w * 0.5, H - 20, 0], [o, dir] = ray([cx, 1600, cz], tgt), p = mepAim(d, 'wall', o, dir, 1500);
    if (bad(p) || Math.abs(p![1] - (H - 100)) > 1) { badH++; note(`${layout} 천장 가까이 → 높이 ${p && Math.round(p[1])} (기대 ${H - 100})`); }
  }
  // ④ 바닥 — 부엌 바닥 점은 그대로, 바닥 밖(거실 · 벽 밖)은 바닥 안 가장 가까운 점
  for (const [x, z] of [[cx, cz], [300, 300], [d.room.w - 200, d.room.d - 400]]) {
    cases++;
    const [o, dir] = ray([cx + 500, 2400, cz + 900], [x, 0, z]), p = mepAim(d, 'floor', o, dir, 0);
    if (bad(p) || Math.hypot(p![0] - x, p![2] - z) > 2) { floorBad++; note(`${layout} 바닥 (${x},${z}) → ${p?.map(Math.round)}`); }
  }
  {
    cases++;
    const [o, dir] = ray([cx, 2400, cz], [d.room.w + 1500, 0, cz]), p = mepAim(d, 'floor', o, dir, 0);
    const inKitchen = p && p[0] >= -1 && p[0] <= d.room.w + 1 && p[2] >= -1 && p[2] <= d.room.d + 1;
    const inRoom = p && d.openings.some((op) => op.depth && op.wall === 1);
    if (bad(p) || !(inKitchen || inRoom)) { floorBad++; note(`${layout} 트임${open} 바닥 밖 → ${p?.map(Math.round)}`); }
  }
}
for (const s of out) console.log(' ', s);
console.log(`설비 끌기 경우 ${cases} · 다른 벽 ${wrongWall} · 카메라쪽 벽에 걸림 ${through} · 벽 밖 ${offWall} · 높이 ${badH} · 바닥 ${floorBad} · NaN ${nan}`);
