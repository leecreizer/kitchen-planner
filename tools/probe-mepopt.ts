// 설비 시공 방식 반영 — 사용자 2026-11-11 「보통 설비 공사시 전기 배관 등은 어떻게 공사하는지 자료 수집해서 최적화된 내용으로 적용해봐」.
//   ① 전선관(2026-11-11 개정 「직각으로 꺾어」 · 「깔끔한 구조로」) — 분전반 위에서 회로마다 따로(가운데 51 이상) 벽 속으로 오르내려, 슬래브 속은 직각으로만 꺾고
//      회로끼리 겹치지 않게(나란한 관 사이 30 이상). 전용 회로(쿡탑 · 식세 · 오븐)는 분전반에서 한 줄, 일반 콘센트는 회로로 묶어 박스에서 박스로.
//      벽에 붙은 기기는 천장(반자 속) → 벽 타고 내려오기, 바닥 슬래브는 아일랜드만(2026-11-11 개정)
//   ② 관 굵기 — 쿡탑(인덕션 · 하이브리드 · 전기레인지) 전용 회로는 CD22(바깥 27.5), 그 밖 CD16(21)
//   ③ 가스 노출 배관 고정 장치 — 2m 안마다(호칭 13 ~ 33mm, 도시가스사업법 시행규칙 별표 7)
//   ④ 가스관 ↔ 전기 이격 — 분전반 60cm · 콘센트 30cm 안이면 확인 알림, 아니면 알림 없음. npx vite-node tools/probe-mepopt.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, newOpening, type Design, type LayoutKind, type OpeningKind, type WallId } from '../src/plan';
import { MEP_SIZE, gasClamps, mepOf, type V3 } from '../src/mep';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let longest = 0, cases = 0, slabBad = 0, circBad = 0, levelBad = 0, lapBad = 0, spaceBad = 0, odBad = 0, clampBad = 0, gasWarnBad = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 24) out.push(s); };
const segDist = (p: V3, a: V3, b: V3) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]; const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2; const k = L2 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0; return Math.hypot(ap[0] - ab[0] * k, ap[1] - ab[1] * k, ap[2] - ab[2] * k); };
const hobs: [string, string][] = [['CIR-KM7564FR', '인덕션'], ['CTB-HS133P', '가스'], ['CTB-HS614MD', '후드일체형 인덕션']];
const spaces: (OpeningKind | null)[] = [null, 'utility', 'subkitchen', 'pantry'];
const SPACE_WALL: Record<string, WallId> = { utility: 2, subkitchen: 2, pantry: 1 };
const designs: [string, Design][] = [];
for (const layout of ['I', 'L', 'U'] as LayoutKind[]) for (const island of [false, true]) for (const [model, name] of hobs) for (const sp of spaces) {
  const d = { ...defaultDesign(), layout, island, appliance: { hob: model } } as Design;
  if (sp) d.openings.push(newOpening(sp, d.room, SPACE_WALL[sp]));
  designs.push([`${layout}${island ? '+섬' : ''}/${name}/${sp ?? '-'}`, d]);
}
// 가스관 가까이 분전반 · 콘센트를 둔 설계 — 알림이 떠야
for (const [model] of [hobs[1]]) {
  const d = { ...defaultDesign(), appliance: { hob: model } } as Design;
  const c0 = autoPlan(d, cat, 'EO')[0], m0 = c0 && mepOf(d, c0), g = m0?.runs.find((r) => r.sys === 'gas' && r.to === '쿡탑');
  if (g) {
    const mid = g.pts[Math.floor(g.pts.length / 2)];
    designs.push(['분전반 가스관 옆', { ...d, mep: { inlets: { panel: { x: mid[0], z: mid[2], y: mid[1] - 200 } } } } as Design]);
    designs.push(['콘센트 가스관 옆', { ...d, mep: { outlets: [{ id: 'mo-g', x: mid[0], z: mid[2], y: mid[1] - 150 }] } } as Design]);
    // 가스 인입을 먼 벽 끝에 — 2m 넘는 곧은 가스관(고정 장치 간격 시험)
    for (const [x, z] of [[0, d.room.d - 200], [d.room.w, d.room.d - 200], [200, 0]]) designs.push([`가스 인입 먼 곳 ${x},${z}`, { ...d, mep: { inlets: { gas: { x, z, y: 1900 } } } } as Design]);
  }
}
for (const [tag, d] of designs) {
  const c = autoPlan(d, cat, 'EO')[0];
  if (!c) continue;
  const m = mepOf(d, c), H = d.room.h;
  cases++;
  // ① 슬래브 속 — 가로 구간은 직각(x 또는 z 축)으로만
  const pwr = m.runs.filter((x) => x.sys === 'power'), pnl = m.inlets.find((i) => i.key === 'panel')!;
  const same = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1;
  const hseg = (r: typeof pwr[number]) => r.pts.slice(1).map((b, i) => [r.pts[i], b] as [V3, V3]).filter(([a, b]) => Math.abs(a[1] - b[1]) < 1 && (a[1] < 0 || a[1] > H) && Math.hypot(a[0] - b[0], a[2] - b[2]) > 1);
  for (const r of pwr) {
    const diag = hseg(r).find(([a, b]) => Math.abs(a[0] - b[0]) > 1 && Math.abs(a[2] - b[2]) > 1);
    if (diag) { slabBad++; note(`${tag} ${r.to} 슬래브 속 사선 ${diag[0].map(Math.round)} → ${diag[1].map(Math.round)}`); }
  }
  // ② 회로 — 회로마다 분전반에서 나가는 줄은 하나, 나머지는 앞 기기 박스에서 이어짐. 전용 회로는 한 줄
  const circ = new Map<string, typeof pwr>();
  for (const r of pwr) { if (!r.circuit) { circBad++; note(`${tag} ${r.to} 회로 이름 없음`); continue; } (circ.get(r.circuit) ?? circ.set(r.circuit, []).get(r.circuit)!).push(r); }
  for (const [name, rs] of circ) {
    const home = rs.filter((r) => same(r.pts[0], pnl.p));
    if (home.length !== 1) { circBad++; note(`${tag} 회로 ${name} 분전반에서 ${home.length}줄`); continue; }
    if (rs[0].sub === 'dedicated' && rs.length !== 1) { circBad++; note(`${tag} 전용 회로 ${name} ${rs.length}줄`); }
    for (const r of rs) if (r !== home[0] && !rs.some((q) => q !== r && same(q.pts[q.pts.length - 1], r.pts[0]))) { circBad++; note(`${tag} 회로 ${name} ${r.to} 앞 박스에서 안 이어짐`); }
  }
  // ③ 높이(2026-11-11 개정 「배선은 대부분 천장이나 벽을 타고 … 바닥에 심으면 관리가 어렵」) — 벽에 붙은 기기는 천장(반자 속)으로 가서 벽을 타고 내려오고,
  //    바닥 슬래브는 벽에 닿지 않는 아일랜드 기기(… 전원 · 팝업 콘센트)만
  for (const r of pwr) {
    const end = r.pts[r.pts.length - 1], hs = hseg(r), island = /전원$|팝업/.test(r.to);
    if (hs.some(([a]) => (island ? a[1] > H : a[1] < 0))) { levelBad++; note(`${tag} ${r.to}(높이 ${Math.round(end[1])}) ${island ? '바닥' : '천장'}으로 가야`); }
  }
  // ④ 겹침 — 다른 줄의 가로 구간이 같은 축 · 40 안 · 50 넘게 겹치면
  const segs = pwr.flatMap((r) => hseg(r).map((sg) => ({ r, a: sg[0], b: sg[1] })));
  lap: for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const A = segs[i], B = segs[j];
    if (A.r === B.r || Math.abs(A.a[1] - B.a[1]) > 40) continue;
    const ax = Math.abs(A.a[0] - A.b[0]) > 1 ? 0 : 2, bx = Math.abs(B.a[0] - B.b[0]) > 1 ? 0 : 2;
    if (ax !== bx) continue;
    const o = ax === 0 ? 2 : 0;
    if (Math.abs(A.a[o] - B.a[o]) >= 40) continue;
    const lo = Math.max(Math.min(A.a[ax], A.b[ax]), Math.min(B.a[ax], B.b[ax])), hi = Math.min(Math.max(A.a[ax], A.b[ax]), Math.max(B.a[ax], B.b[ax]));
    if (hi - lo > 50) { lapBad++; note(`${tag} ${A.r.to} · ${B.r.to} 슬래브 속 겹침 ${Math.round(hi - lo)}mm`); break lap; }
  }
  // 분전반 위 — 분전반에서 나가는 줄들의 첫 세로 구간 자리
  const risers: { to: string; p: [number, number] }[] = [];
  for (const r of pwr.filter((x) => same(x.pts[0], pnl.p))) {
    const v = r.pts.findIndex((p, i) => i > 0 && Math.abs(p[0] - r.pts[i - 1][0]) < 1 && Math.abs(p[2] - r.pts[i - 1][2]) < 1 && Math.abs(p[1] - r.pts[i - 1][1]) > 100);
    if (v > 0) risers.push({ to: r.to, p: [r.pts[v][0], r.pts[v][2]] });
  }
  for (let i = 0; i < risers.length; i++) for (let j = i + 1; j < risers.length; j++) {
    const dd = Math.hypot(risers[i].p[0] - risers[j].p[0], risers[i].p[1] - risers[j].p[1]);
    if (dd < 50) { spaceBad++; note(`${tag} 분전반 위 ${risers[i].to} · ${risers[j].to} 관 사이 ${Math.round(dd)}(가운데 51 이상)`); i = risers.length; break; }
  }
  // ② 관 굵기
  for (const r of m.runs.filter((x) => x.sys === 'power')) {
    const want = r.sub === 'dedicated' && /쿡탑/.test(r.to) && !/가스/.test(tag) ? MEP_SIZE.conduit.hob : MEP_SIZE.conduit.general;
    if (r.od !== want) { odBad++; note(`${tag} ${r.to} 관 바깥지름 ${r.od} (기대 ${want})`); break; }
  }
  // ③ 가스 고정 장치 — 드러난 가스 구간 길이 따라 2m 안마다
  for (const r of m.runs.filter((x) => x.sys === 'gas')) {
    const cl = gasClamps(r);
    let gap = 0, worst = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (r.hid[i - 1]) { gap = 0; continue; }
      for (let s = 0; s < L; s += 50) {
        const q: V3 = [a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L, a[2] + (b[2] - a[2]) * s / L];
        gap = cl.some((x) => Math.hypot(x[0] - q[0], x[1] - q[1], x[2] - q[2]) < 30) ? 0 : gap + 50;
        worst = Math.max(worst, gap);
      }
    }
    longest = Math.max(longest, ...r.pts.slice(1).map((q, i) => (r.hid[i] ? 0 : Math.hypot(q[0] - r.pts[i][0], q[1] - r.pts[i][1], q[2] - r.pts[i][2]))));
    if (worst > 2000) { clampBad++; note(`${tag} 가스 ${r.to} 고정 장치 사이 ${worst}mm`); }
  }
  // ④ 가스 ↔ 전기 이격
  const gas = m.runs.filter((r) => r.sys === 'gas');
  const near = (p: V3, half: number) => Math.min(Infinity, ...gas.flatMap((r) => r.pts.slice(1).map((b, i) => segDist(p, r.pts[i], b)))) - half;
  const panel = m.inlets.find((i) => i.key === 'panel')!;
  const pv = near(panel.p, MEP_SIZE.inlet.panel.w / 2) < 600;
  const ov = [...m.outlets.map((o) => o.p), ...m.nodes.filter((x) => x.kind === 'outlet' || x.kind === 'dedicated').map((x) => x.p)].some((p) => near(p, MEP_SIZE.outlet.w / 2) < 300);
  const pw = m.checks.some((x) => x.sys === 'gas' && /분전반/.test(x.text)), ow = m.checks.some((x) => x.sys === 'gas' && /콘센트/.test(x.text));
  if (pv !== pw || ov !== ow) { gasWarnBad++; note(`${tag} 가스 이격 — 분전반 ${pv ? '가까움' : '멂'}/알림 ${pw} · 콘센트 ${ov ? '가까움' : '멂'}/알림 ${ow}`); }
  if ((tag === '분전반 가스관 옆' && !pw) || (tag === '콘센트 가스관 옆' && !ow)) { gasWarnBad++; note(`${tag} 알림 없음`); }
}
for (const s of out) console.log(' ', s);
console.log(`  (가장 긴 곧은 가스관 ${Math.round(longest)})`);
console.log(`시공 방식 경우 ${cases} · 슬래브 사선 ${slabBad} · 회로 ${circBad} · 높이 ${levelBad} · 겹침 ${lapBad} · 분전반 위 간격 ${spaceBad} · 관 굵기 ${odBad} · 가스 고정 ${clampBad} · 가스 이격 알림 ${gasWarnBad}`);
