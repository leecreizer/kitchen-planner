// 설비 계산(mepOf) — 공간 구조 · 아일랜드 · 쿡탑 종류 · 벽 너머 공간을 바꿔 가며, 끊긴 선 · 빠진 설비 · 벽 밖 인입점 · NaN · 빠진 확인 알림이 없는지.
// npx vite-node tools/probe-mep.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan, type Candidate } from '../src/autoplan';
import { defaultDesign, newOpening, type Design, type LayoutKind, type OpeningKind, type WallId } from '../src/plan';
import { mepOf, mountWalls, snapFloor, type MepInfo, type V3 } from '../src/mep';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let n = 0, cut = 0, miss = 0, offWall = 0, nan = 0, chk = 0, pin = 0, noMep = 0, falseWarn = 0, floating = 0, popupHit = 0;
const sample: string[] = [];
const note = (s: string) => { if (sample.length < 24) sample.push(s); };
const near3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1;
/** 점이 선분 위 */
const onSeg = (p: V3, a: V3, b: V3) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const k = L2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0; return Math.hypot(ap[0] - ab[0] * k, ap[1] - ab[1] * k, ap[2] - ab[2] * k) <= 1; };
const segDist = (x: number, z: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; const k = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0; return Math.hypot(x - a[0] - dx * k, z - a[1] - dz * k); };

function judge(tag: string, d: Design, c: Candidate, m: MepInfo) {
  n++;
  // NaN
  const all: V3[] = [...m.runs.flatMap((r) => r.pts), ...m.nodes.map((x) => x.p), ...m.inlets.map((x) => x.p), ...m.outlets.map((x) => x.p)];
  if (all.some((p) => p.some((v) => !Number.isFinite(v)))) { nan++; note(`NaN ${tag}`); }
  // 끊김 — 선 양 끝은 기기 점 · 인입점 · 콘센트 · 같은 종류 다른 선 위
  const anchors: V3[] = [...m.nodes.map((x) => x.p), ...m.inlets.map((x) => x.p), ...m.outlets.map((x) => x.p)];
  for (const r of m.runs) {
    if (r.pts.length < 2) { cut++; note(`점 하나 ${tag} ${r.sys} ${r.to}`); continue; }
    for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
      const ok = anchors.some((a) => near3(a, e)) || m.runs.some((q) => q !== r && q.sys === r.sys && q.pts.some((p, i) => i > 0 && onSeg(e, q.pts[i - 1], p)));
      if (!ok) { cut++; note(`끊김 ${tag} ${r.sys}${r.sub ? '/' + r.sub : ''} → ${r.to} 끝 ${e.map(Math.round).join(',')}`); break; }
    }
  }
  // 싱크 — 냉 · 온수가 수전에서 끝나고, 배수가 트랩에서 시작해 배수구로
  const faucet = m.nodes.find((x) => x.kind === 'faucet' && x.label.startsWith('싱크')), trap = m.nodes.find((x) => x.kind === 'trap' && x.label.startsWith('싱크'));
  const drainIn = m.inlets.find((x) => x.key === 'drain');
  const ends = (r: { pts: V3[] }, p?: V3) => !!p && near3(r.pts[r.pts.length - 1], p);
  if (!faucet || !trap || !drainIn) { miss++; note(`싱크 점 없음 ${tag}`); }
  else {
    for (const sub of ['cold', 'hot'] as const) if (!m.runs.some((r) => r.sys === 'water' && r.sub === sub && ends(r, faucet.p))) { cut++; note(`수전 ${sub} 없음 ${tag}`); }
    const dr = m.runs.find((r) => r.sys === 'drain' && near3(r.pts[0], trap.p));
    if (!dr || !ends(dr, drainIn.p)) { cut++; note(`싱크 배수 끊김 ${tag}`); }
  }
  // 빠짐
  const hobName = (d as { _hobName?: string })._hobName ?? '';
  if (/가스/.test(hobName)) { if (!m.runs.some((r) => r.sys === 'gas') || !m.nodes.some((x) => x.kind === 'valve' && /쿡탑/.test(x.label))) { miss++; note(`가스 쿡탑 설비 없음 ${tag}`); } }
  else if (!m.nodes.some((x) => x.kind === 'dedicated' && /쿡탑/.test(x.label))) { miss++; note(`쿡탑 전용 콘센트 없음 ${tag}`); }
  if (/후드일체형/.test(hobName) && !m.runs.some((r) => r.sys === 'vent' && /쿡탑/.test(r.to))) { miss++; note(`후드일체형 배기 없음 ${tag}`); }
  if (c.island && !m.nodes.some((x) => x.kind === 'popup')) { miss++; note(`팝업 없음 ${tag}`); }
  const kinds = new Set(d.openings.map((o) => o.kind));
  if (kinds.has('utility') && !m.nodes.some((x) => /세탁기/.test(x.label))) { miss++; note(`세탁기 없음 ${tag}`); }
  if (kinds.has('subkitchen') && !m.runs.some((r) => r.sys === 'water' && r.to === '서브주방 싱크')) { miss++; note(`서브주방 싱크 없음 ${tag}`); }
  if (kinds.has('pantry') && !m.nodes.some((x) => /팬트리/.test(x.label))) { miss++; note(`팬트리 없음 ${tag}`); }
  if (!m.inlets.some((x) => x.key === 'boiler') || !m.runs.some((r) => r.sys === 'heat')) { miss++; note(`보일러 · 난방 없음 ${tag}`); }
  // 떠 있는 관 — 급수 · 배수 · 난방이 바닥 위 0~400 높이로 부엌 한가운데(벽에서 650 넘게, 아일랜드 밖)를 700 넘게 가로지르면 통로를 막는다(바닥 속이어야)
  const islCt = c.counters.find((k) => k.island);
  const inIsl = (x: number, z: number) => !!islCt && (() => { const f = islCt.frame, t = (x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1], u = (x - f.o[0]) * f.n[0] + (z - f.o[1]) * f.n[1]; return t >= islCt.t0 - 100 && t <= islCt.t1 + 100 && u >= islCt.z0 - 100 && u <= islCt.z1 + 100; })();
  for (const r of m.runs) {
    if (r.sys !== 'water' && r.sys !== 'drain' && r.sys !== 'heat') continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      if (Math.abs(a[1] - b[1]) > 1 || a[1] <= 0 || a[1] >= 400 || Math.hypot(a[0] - b[0], a[2] - b[2]) <= 700) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[2] + b[2]) / 2;
      if (mx < 0 || mz < 0 || mx > d.room.w || mz > d.room.d || inIsl(mx, mz)) continue;
      if (Math.min(mx, mz, d.room.w - mx, d.room.d - mz) > 650) { floating++; note(`떠 있는 관 ${tag} ${r.sys} → ${r.to} 높이 ${Math.round(a[1])}`); break; }
    }
  }
  // 팝업 콘센트가 아일랜드의 싱크 · 쿡탑 · 식세 자리 위
  const pop = m.nodes.find((x) => x.kind === 'popup');
  if (pop && c.island) for (const it of c.items.filter((x) => x.frame === c.island!.frame && (x.tag === 'sink' || x.tag === 'hob' || x.tag === 'dish'))) {
    // 그 기기 장의 바닥 자리(길이 방향 t · 깊이 u 0~600) 위면 겹침 — 뒤로 내민 상판(u < 0)은 장 위가 아니다
    const f = it.frame, t = (pop.p[0] - f.o[0]) * f.dir[0] + (pop.p[2] - f.o[1]) * f.dir[1], u = (pop.p[0] - f.o[0]) * f.n[0] + (pop.p[2] - f.o[1]) * f.n[1];
    if (t >= it.t && t <= it.t + it.w && u >= 0 && u <= 600) { popupHit++; note(`팝업 겹침 ${tag} ${it.tag}`); break; }
  }
  // 벽 밖 인입점
  const segs = mountWalls(d);
  for (const i of m.inlets) {
    if (i.mount === 'wall') { const dmin = Math.min(...segs.map((s) => segDist(i.p[0], i.p[2], s.a, s.b))); if (dmin > 1) { offWall++; note(`벽 밖 ${tag} ${i.label} ${Math.round(dmin)}`); } }
    else { const q = snapFloor(d, i.p[0], i.p[2]); if (Math.hypot(q[0] - i.p[0], q[1] - i.p[2]) > 1) { offWall++; note(`바닥 밖 ${tag} ${i.label}`); } }
  }
}
const hobs: [string, string][] = [['CIR-KM7564FR', '밀레 인덕션 쿡탑 4구'], ['CTB-HS133P', '한샘 가스쿡탑 3구 플러그타입'], ['CTB-HS614MD', '한샘 올인원 후드일체형 인덕션 4구']];
const spaces: (OpeningKind | null)[] = [null, 'utility', 'subkitchen', 'pantry'];
const SPACE_WALL: Record<string, WallId> = { utility: 2, subkitchen: 2, pantry: 1 };
for (const layout of ['I', 'L', 'U', 'II'] as LayoutKind[]) for (const island of [false, true]) for (const [model, name] of hobs) for (const sp of spaces) {
  const d = { ...defaultDesign(), layout, island, appliance: { hob: model } } as Design;
  (d as { _hobName?: string })._hobName = name;
  if (sp) d.openings.push(newOpening(sp, d.room, SPACE_WALL[sp]));
  const c = autoPlan(d, cat, 'EO')[0];
  if (!c) { note(`배치 없음 ${layout}/${island}/${model}/${sp}`); continue; }
  try { judge(`${layout}${island ? '+섬' : ''}/${name.slice(3, 9)}/${sp ?? '-'}`, d, c, mepOf(d, c)); } catch (e) { cut++; note(`예외 ${layout}/${sp}: ${(e as Error).message}`); }
}
// 아일랜드 싱크 · 확인 알림이 떠야 하는 경우
const base = { ...defaultDesign(), island: true } as Design;
const want = (tag: string, d: Design, re: RegExp) => {
  const c = autoPlan(d, cat, 'EO')[0];
  if (!c) { chk++; note(`확인 — 배치 없음 ${tag}`); return null; }
  const m = mepOf(d, c);
  judge(tag, d, c, m);
  if (!m.checks.some((x) => re.test(x.text))) { chk++; note(`확인빠짐 ${tag} ${re} — ${m.checks.map((x) => x.text.slice(0, 30)).join(' | ')}`); }
  return { c, m };
};
want('아일랜드 → 골조', base, /골조/);
want('아일랜드 싱크 → 골조', { ...base, fix: { sink: { wall: 0, c: 700, island: true } } }, /골조/);
// 식기세척기를 싱크에서 먼 벽 끝으로
want('식세 멂', { ...defaultDesign(), fix: { dish: { wall: 1, c: 3000 } } } as Design, /식기세척기/);
// 식세가 싱크에서 장 하나(600) 건너 — 실제 길 2.2m 쯤이라 2.5m 경고가 뜨면 안 된다
{
  const d = defaultDesign(), c0 = autoPlan(d, cat, 'EO')[0], sk = c0?.items.find((x) => x.tag === 'sink');
  if (sk && sk.wall != null) {
    const d2 = { ...d, fix: { sink: { wall: sk.wall, c: sk.t + sk.w / 2 }, dish: { wall: sk.wall, c: sk.t + sk.w + 600 + 300 } } } as Design;
    const c2 = autoPlan(d2, cat, 'EO')[0];
    if (c2) { const m2 = mepOf(d2, c2); judge('식세 장 하나 건너', d2, c2, m2); if (m2.checks.some((x) => /식기세척기가 수전에서/.test(x.text))) { falseWarn++; note(`오경고 식세 장 하나 건너 — ${m2.checks.find((x) => /식기세척기/.test(x.text))!.text.slice(0, 40)}`); } }
  }
}
// 아일랜드 싱크 + 벽에 고정된 식세 · 바닥 인입점을 방 가운데로 — 떠 있는 관이 없어야
for (const [tag, d] of [
  ['섬 싱크 + 벽 식세', { ...defaultDesign(), island: true, fix: { sink: { wall: 0, c: 700, island: true }, dish: { wall: 0, c: 3000 } } }],
  ['섬 싱크 · 쿡탑', { ...defaultDesign(), island: true, islandCfg: { len: 3200, over: 300 }, fix: { sink: { wall: 0, c: 700, island: true }, hob: { wall: 0, c: 2400, island: true } } }],
  ['바닥 인입점 가운데', { ...defaultDesign(), mep: { inlets: { water: { x: 2100, z: 1800 }, manifold: { x: 2300, z: 2000 } } } }],
] as [string, Design][]) {
  const c = autoPlan(d, cat, 'EO')[0];
  if (c) judge(tag, d, c, mepOf(d, c)); else note(`배치 없음 ${tag}`);
}
// 분배기를 서랍장 밑으로 고정
{
  const d = defaultDesign();
  const c = autoPlan(d, cat, 'EO')[0];
  const dr = c?.items.find((x) => /^drawer/.test(x.key) && x.wall != null);
  if (dr) {
    const f = dr.frame, p = [f.o[0] + f.dir[0] * (dr.t + dr.w / 2) + f.n[0] * 300, f.o[1] + f.dir[1] * (dr.t + dr.w / 2) + f.n[1] * 300];
    want('분배기 서랍장 밑', { ...d, mep: { inlets: { manifold: { x: p[0], z: p[1] } } } } as Design, /분배기/);
  } else { chk++; note('서랍장 없음 — 분배기 확인 시험 못 함'); }
}
// 덕트를 쿡탑에서 먼 곳으로
{
  // 쿡탑에서 가장 먼 모서리 벽에 덕트(기본 냉장고가 4도어로 바뀌어 쿡탑 자리가 달라져도 먼 곳이 되게 — 2026-11-11)
  const d = defaultDesign(), c0 = autoPlan(d, cat, 'EO')[0], hb = c0?.items.find((x) => x.tag === 'hob');
  const hp = hb ? [hb.frame.o[0] + hb.frame.dir[0] * (hb.t + hb.w / 2), hb.frame.o[1] + hb.frame.dir[1] * (hb.t + hb.w / 2)] : [0, 0];
  const far = ([[0, 0], [d.room.w, 0], [d.room.w, d.room.d], [0, d.room.d]] as const).slice().sort((a, b) => Math.hypot(b[0] - hp[0], b[1] - hp[1]) - Math.hypot(a[0] - hp[0], a[1] - hp[1]))[0];
  want('덕트 멂', { ...d, mep: { inlets: { duct: { x: far[0], z: far[1], y: 2200 } } } } as Design, /덕트/);
}
// 고정 인입점 — 방 밖 · 다용도실 안 고정 뒤 다용도실 뺌
{
  const d = defaultDesign();
  const far = { x: 99999, z: 99999 };
  const d1 = { ...d, mep: { inlets: { drain: far, water: far, manifold: far, panel: far, gas: far, duct: far, boiler: far } } } as Design;
  const c1 = autoPlan(d1, cat, 'EO')[0];
  if (c1) { const before = offWall; judge('방 밖 고정', d1, c1, mepOf(d1, c1)); pin += offWall - before; offWall = before; }
  const ut = newOpening('utility', d.room, 2);
  const f = { o: [d.room.w, d.room.d], dir: [-1, 0], n: [0, -1] };
  const inside = { x: f.o[0] + f.dir[0] * (ut.t + ut.w / 2) + f.n[0] * -800, z: f.o[1] + f.dir[1] * (ut.t + ut.w / 2) + f.n[1] * -800 };
  const d2 = { ...d, openings: [...d.openings], mep: { inlets: { gas: { ...inside, y: 1900 }, boiler: { ...inside, y: 1500 }, drain: inside } } } as Design;
  const c2 = autoPlan(d2, cat, 'EO')[0];
  if (c2) { const before = offWall; judge('다용도실 뺀 뒤 고정', d2, c2, mepOf(d2, c2)); pin += offWall - before; offWall = before; }
}
// 거실 벽에 붙은 다용도실 · 서브주방(2026-11-10 거실 공간 요소) — 거실을 지나 부엌 인입점으로 이어지는지
for (const [kind, wall] of [['utility', 10], ['subkitchen', 11], ['pantry', 12]] as const) {
  const d = defaultDesign();
  d.openings.push({ id: `lv-${kind}`, kind, wall, t: 1200, w: 1200, h: 2100, sill: 0, depth: 1800 });
  const c = autoPlan(d, cat, 'EO')[0];
  if (c) judge(`거실 벽 ${kind}`, d, c, mepOf(d, c)); else note(`배치 없음 거실 벽 ${kind}`);
}
// 예전 설계(mep 없음)
try { const d = defaultDesign(); delete (d as { mep?: unknown }).mep; const c = autoPlan(d, cat, 'EO')[0]; if (c) mepOf(d, c); } catch (e) { noMep++; note(`mep 없음 예외 ${(e as Error).message}`); }
console.log(sample.join('\n'));
console.log(`설비 안 ${n} · 끊김 ${cut} · 빠짐 ${miss} · 벽밖 ${offWall} · NaN ${nan} · 확인빠짐 ${chk} · 고정어긋남 ${pin} · mep없음 ${noMep} · 오경고 ${falseWarn} · 떠있는관 ${floating} · 팝업겹침 ${popupHit}`);
