// 설비 3D 실물 크기 — 사용자 2026-11-11 「각 설비의 실물 크기를 인터넷으로 검색해서 실제 사이즈로적용해」. 수치 · 출처는 mep.ts MEP_SIZE.
//   인입점(보일러 · 분전반 · 가스 계량기 · 덕트 · 분배기 · 배수 · 급수) · 콘센트 판이 그 크기로 그려지는지(벽 따라 · 높이 · 벽에서 나온 깊이),
//   벽에 붙는 것은 뒷면이 벽 면에, 바닥에 서는 것은 밑면이 바닥에 닿는지. npx vite-node tools/probe-mepsize.ts
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, newOpening, type Design, type LayoutKind } from '../src/plan';
import { MEP_SIZE, SYS_LIST, mepOf } from '../src/mep';
import { buildMep3d } from '../src/mep3d';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const S = 0.001;
let cases = 0, size = 0, place = 0, missing = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 16) out.push(s); };
for (const layout of ['I', 'L', 'U'] as LayoutKind[]) for (const util of [false, true]) {
  const d = { ...defaultDesign(), layout } as Design;
  if (util) d.openings.push(newOpening('utility', d.room, 1, 600));
  d.mep = { outlets: [{ id: 'mo1', x: d.room.w / 2, z: 0, y: 1100 }] };
  const c = autoPlan(d, cat, 'EO')[0]; if (!c) continue;
  const m = mepOf(d, c), { group } = buildMep3d(m, new Set(SYS_LIST), null);
  const bodies = new Map<string, THREE.Mesh>();
  group.traverse((o) => { if (o.userData.mepBody) bodies.set(o.userData.mepBody, o as THREE.Mesh); });
  const check = (ref: string, p: [number, number, number], n: [number, number] | undefined, spec: { w: number; h: number; d: number }, floor: boolean) => {
    cases++;
    const b = bodies.get(ref);
    if (!b) { missing++; note(`${layout}${util ? '+다용도실' : ''} ${ref} 몸체 없음`); return; }
    b.geometry.computeBoundingBox();
    const bb = b.geometry.boundingBox!.clone().applyMatrix4(b.matrixWorld);
    const sx = (bb.max.x - bb.min.x) / S, sy = (bb.max.y - bb.min.y) / S, sz = (bb.max.z - bb.min.z) / S;
    const nn = n ?? [0, 1], alongX = Math.abs(nn[1]) > 0.5;   // 법선이 z 쪽이면 벽은 x 를 따라
    const W = alongX ? sx : sz, D = alongX ? sz : sx;
    if (Math.abs(W - spec.w) > 1 || Math.abs(sy - spec.h) > 1 || Math.abs(D - spec.d) > 1) { size++; note(`${ref} 크기 ${Math.round(W)}×${Math.round(sy)}×${Math.round(D)} (기대 ${spec.w}×${spec.h}×${spec.d})`); }
    if (floor) { if (Math.abs(bb.min.y / S) > 1) { place++; note(`${ref} 바닥에서 뜸 ${Math.round(bb.min.y / S)}`); } }
    else {
      // 벽에서 나온 쪽 — 몸체가 벽 면(p)부터 법선 쪽 깊이만큼
      const lo = Math.min(...[bb.min, bb.max].map((v) => (v.x / S - p[0]) * nn[0] + (v.z / S - p[2]) * nn[1]));
      if (Math.abs(lo) > 1) { place++; note(`${ref} 뒷면이 벽 면에서 ${Math.round(lo)}mm`); }
      if (Math.abs((bb.min.y + bb.max.y) / 2 / S - p[1]) > 1) { place++; note(`${ref} 높이 가운데 ${Math.round((bb.min.y + bb.max.y) / 2 / S)} (기대 ${Math.round(p[1])})`); }
    }
  };
  for (const i of m.inlets) {
    const k = i.key, z = MEP_SIZE.inlet[k];
    check(k, i.p, i.n, { w: z.w, h: z.h, d: z.d }, i.mount === 'floor');
  }
  for (const o of m.outlets) check(`out:${o.id}`, o.p, o.n, MEP_SIZE.outlet, false);
}
for (const s of out) console.log(' ', s);
console.log(`설비 크기 경우 ${cases} · 크기 틀림 ${size} · 자리 틀림 ${place} · 몸체 없음 ${missing}`);
