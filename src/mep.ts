// 설비 — 장 배치를 따라 급수 · 배수 · 전기 · 가스 · 배기 · 난방을 잡는다(설계 docs/superpowers/specs/2026-11-09-mep-view-design.md).
// 평면도(plan2d) · 3D(mep3d) 는 이 결과를 그리기만 한다. 단위 mm, 평면 (x, z), 높이 y(바닥 = 0, 바닥 속 = 음수).
// 기준 원문을 확인하지 못한 수치(조사 문서 docs/설비-설치-기준-조사.md 「확인 못 한 것」)는 MEP_ASSUME 에만 두고, 판정 문구에 「가정」 · 「확인 필요」를 붙인다.
//
// 길 잡기 — ① 부엌 벽을 따라: 부엌 둘레(뒷벽 시작 0 → 시계 방향)에서 트인 쪽 열린 구간(날개벽 사이)을 지나지 않는 쪽으로, 종류마다 벽에서 띄운 거리(inset)로
//   나란히. ② 벽 너머 공간(다용도실 · 서브주방 · 팬트리)은 입구를 지나 부엌 둘레로. ③ 아일랜드 · 거실 쪽은 꺾은 선(ㄱ), 아일랜드로는 바닥 속으로
import { applianceOf, hoodKindOf } from './catalog';
import { upperBottomOf, type Candidate, type Item } from './autoplan';
import {
  CASING, WALL_THICK, viewWalls, nextWall, prevWall, wallFrame, wallLength, wallLine, wallPoint,
  type AnyWall, type Design, type InletKey, type Opening, type OpeningKind, type Room, type WallId,
} from './plan';

export type Sys = 'water' | 'drain' | 'power' | 'gas' | 'vent' | 'heat';
export const SYS_LIST: Sys[] = ['water', 'drain', 'power', 'gas', 'vent', 'heat'];
export const SYS_LABEL: Record<Sys, string> = { water: '급수', drain: '배수', power: '전기', gas: '가스', vent: '배기', heat: '난방' };
/** 종류 색 — 냉수 파랑 · 배수 갈색 · 전기 주황 · 가스 노랑(국내 가스관 색) · 배기 회청 · 난방 보라. 온수 · 환수는 따로 */
export const SYS_COLOR: Record<Sys, string> = { water: '#2f7bf6', drain: '#8b5e3c', power: '#f08c00', gas: '#d4a800', vent: '#64748b', heat: '#9b4dff' };
export const HOT_COLOR = '#ef4444', RETURN_COLOR = '#c99bff';
export type V3 = [number, number, number];
export interface Run { sys: Sys; sub?: 'cold' | 'hot' | 'supply' | 'return' | 'dedicated' | 'general'; pts: V3[]; to: string; /** 구간마다 묻혔나(바닥 속 · 천장 위 · 벽 속) — 3D 가 비쳐 보이게 그린다 */ hid: boolean[]; /** 관 바깥지름(mm) — 없으면 종류 기본(MEP_SIZE.pipe) */ od?: number; /** 전기 회로 이름(같은 회로는 분전반 → 박스 → 박스로 이어짐) */ circuit?: string }
export interface MepNode { sys: Sys; kind: 'faucet' | 'trap' | 'outlet' | 'dedicated' | 'popup' | 'valve' | 'hood' | 'device' | 'junction' | 'light'; p: V3; label: string; /** 붙은 벽 · 장 뒤판 법선(콘센트 판을 그 방향으로) */ n?: [number, number] }
export interface Inlet { key: InletKey; sys: Sys; label: string; mount: 'wall' | 'floor'; p: V3; pinned: boolean; n?: [number, number] }
export interface MepCheck { level: 'warn' | 'info'; sys: Sys; text: string; at?: [number, number] }
export interface MepInfo { runs: Run[]; nodes: MepNode[]; inlets: Inlet[]; outlets: { id: string; p: V3; n: [number, number] }[]; checks: MepCheck[] }

export const INLET_INFO: Record<InletKey, { label: string; sys: Sys; mount: 'wall' | 'floor' }> = {
  drain: { label: '배수구', sys: 'drain', mount: 'floor' },
  water: { label: '급수 인입', sys: 'water', mount: 'floor' },
  manifold: { label: '난방 분배기', sys: 'heat', mount: 'floor' },
  panel: { label: '분전반', sys: 'power', mount: 'wall' },
  gas: { label: '가스 인입', sys: 'gas', mount: 'wall' },
  duct: { label: '공용 배기 덕트', sys: 'vent', mount: 'wall' },
  boiler: { label: '보일러', sys: 'heat', mount: 'wall' },
};
export const INLET_KEYS = Object.keys(INLET_INFO) as InletKey[];

/** 가정값 — 기준 원문 미확인. 그림과 「확인 필요」 판정에만 쓴다 */
export const MEP_ASSUME = {
  /** 바닥 속 배관 높이 — 층상 배관(조사 1절 [블로그]) */
  floorY: -50,
  /** 바닥 속 배관 여유(가정) — 배수 기울기 판정 */
  floorRoom: 80,
  /** 권장 배수 기울기 1/50(조사 1절 [블로그] kahwa-house) */
  drainSlope: 1 / 50,
  /** 하부장 뒤 급수 · 난방관 높이(가정) */
  lowY: 150,
  /** 천장에서 내린 배선 · 덕트 높이(천장 − 100, 가정) */
  ceilGap: 100,
  /** 벽을 따라가는 가스관 높이(가정) */
  gasY: 1900,
  /** 일반 콘센트 처음 높이(가정) */
  outletY: 1100,
  /** 인입점 처음 높이(가정) */
  panelY: 1700, boilerY: 1500, gasInY: 1900, manifoldY: 60,
  /** 후드 덕트 확인 한도(가정 — 기준 원문 미확인) */
  ductMax: 3000, ductBends: 3,
  /** 수전 ~ 식기세척기(삼성 설치 가이드 — 2.5m 이내 권장) */
  dishMax: 2500,
  /** 묻는 관(사용자 2026-11-11 「바닥 · 벽에 매몰」) — 전선관은 천장 위 슬래브(천장 + 60), 배기 덕트는 천장 속(천장 + 150), 벽 속 오르내림은 벽 면 뒤 25 */
  slabUp: 60, ductUp: 150, wallIn: 25,
  /** 가스관은 묻지 않고(노출이 원칙) 벽 면에 붙여 — 관 가운데가 벽 면에서 20 */
  gasInset: 20,
} as const;
const A = MEP_ASSUME;
/** 실물 크기(mm) — 3D(mep3d)가 이 크기로 그린다(사용자 2026-11-11 「각 설비의 실물 크기를 인터넷으로 검색해서 실제 사이즈로」).
 *  w = 벽 따라 가로 · h = 높이 · d = 벽에서 나온 깊이(바닥에 서는 원통은 w = d = 지름). 출처 · 확인 정도는 docs/설비-설치-기준-조사.md 「설비 실물 크기」 */
export const MEP_SIZE = {
  /** 관 바깥지름 — 급수 · 온수 · 난방 15A XL/PB 20, 배수 PVC 50A 60, 전선관 CD 16 21, 가스 강관 15A 21.7, 배기 덕트 Ø100 */
  pipe: { water: 20, drain: 60, power: 21, gas: 21.7, vent: 100, heat: 20 } as Record<Sys, number>,
  inlet: {
    /** 벽걸이 콘덴싱 보일러 — 경동나비엔 NCB354 · 귀뚜라미 L20(400×660×240) · 린나이 RC620(400×600×255) */
    boiler: { w: 400, h: 660, d: 250 },
    /** 세대 분전반 12분기 커버(레그랑 HPB) — 가로 380 · 세로 300.5, 매입 상자 깊이 100(벽 속) · 커버 두께 15 만 벽 밖 */
    panel: { w: 380, h: 300, d: 15 },
    /** 가정용 가스 계량기 G1.6 · G2.5 막식 — 약 208 × 210 × 160(제조사마다 다름) */
    gas: { w: 208, h: 210, d: 160 },
    /** 공용 배기 덕트 연결구 Ø100(아파트 벽 구멍이 대개 100 — 후드 배출구가 150 이면 줄여 잇는다) · 벽에서 80 나온 짧은 관 */
    duct: { w: 100, h: 100, d: 80 },
    /** 난방 분배기 6구 황동 — 309 × 325 × 87(SiGMA-Li RM-6) */
    manifold: { w: 310, h: 325, d: 87 },
    /** 배수 PVC 50A(바깥지름 60) — 바닥에서 100 올라온 관 */
    drain: { w: 60, h: 100, d: 60 },
    /** 급수 15A(바깥지름 20) — 바닥에서 150 올라온 관 */
    water: { w: 20, h: 150, d: 20 },
  } as Record<InletKey, { w: number; h: number; d: number }>,
  /** 매입 콘센트 2구 판(KS 인증품 75 × 122 × 8.5) */
  outlet: { w: 75, h: 122, d: 8.5 },
  /** 전선관(CD관) 바깥지름 — 일반 회로 2.5mm² 는 CD16(21), 쿡탑(인덕션 약 7kW · 32A · 6mm²) 전용 회로는 CD22(27.5). 파나소닉 CD관 표 · 회로 조합은 KEC 원문 미확인 */
  conduit: { general: 21, hob: 27.5 },
} as const;
/** 상판 윗면 · 싱크볼 가운데(장 뒤에서) · 수전(장 뒤에서) — kitchen3d 와 같은 값(그 모듈은 three 를 끌어와 여기서 쓰지 않는다) */
const COUNTER_TOP = 910, SINK_Z = 330, FAUCET_Z = 55;

type P2 = [number, number];
const P = (ln: { o: P2; dir: P2; n: P2 }, t: number, u: number): P2 => [ln.o[0] + ln.dir[0] * t + ln.n[0] * u, ln.o[1] + ln.dir[1] * t + ln.n[1] * u];
const at = (it: Item, dt: number, u: number) => P(it.frame, it.t + dt, u);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const len2 = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ───────── 붙일 벽 · 바닥 ───────── */
export interface WallSeg { a: P2; b: P2; n: P2; space: 'kitchen' | 'living' | OpeningKind; wall?: AnyWall; op?: string }
function subtract(a: number, b: number, cuts: P2[]): P2[] {
  let out: P2[] = [[a, b]];
  for (const [c0, c1] of cuts) out = out.flatMap(([s0, s1]) => (c1 <= s0 || c0 >= s1 ? [[s0, s1] as P2] : [[s0, c0] as P2, [c1, s1] as P2].filter(([x, y]) => y - x > 1)));
  return out;
}
/** 벽 인입점 · 콘센트를 붙일 수 있는 벽 — 부엌 벽(입구 자리 빼고) · 날개벽 · 거실 벽 · 벽 너머 공간 안쪽 세 벽(room3d sideRoom 과 같은 자리) */
export function mountWalls(d: Design): WallSeg[] {
  const out: WallSeg[] = [];
  const doors = (w: AnyWall): P2[] => d.openings.filter((o) => o.wall === w && o.depth).map((o) => [o.t, o.t + o.w]);
  const line = (w: AnyWall, space: WallSeg['space']) => {
    const ln = wallLine(d, w);
    if (ln) for (const [t0, t1] of subtract(0, ln.L, doors(w))) out.push({ a: P(ln, t0, 0), b: P(ln, t1, 0), n: ln.n, space, wall: w });
  };
  for (const w of [0, 1, 2, 3] as WallId[]) line(w, 'kitchen');
  if (d.openWall != null) {
    const f = wallFrame(d.room, d.openWall) as unknown as { o: P2; dir: P2; n: P2 }, L = wallLength(d.room, d.openWall);
    const wa = Math.min(d.wing.a, L / 2), wb = Math.min(d.wing.b, L / 2);
    if (wa > 1) out.push({ a: P(f, 0, 0), b: P(f, wa, 0), n: f.n, space: 'kitchen', wall: d.openWall });
    if (wb > 1) out.push({ a: P(f, L - wb, 0), b: P(f, L, 0), n: f.n, space: 'kitchen', wall: d.openWall });
    for (const w of [10, 11, 12] as AnyWall[]) line(w, 'living');
  }
  for (const o of d.openings) {
    const ln = o.depth ? wallLine(d, o.wall) : null;
    if (!ln) continue;
    const t0 = o.t - 300, t1 = o.t + o.w + 300, u0 = -WALL_THICK, u1 = -WALL_THICK - o.depth!;
    out.push({ a: P(ln, t0, u1), b: P(ln, t1, u1), n: ln.n, space: o.kind, op: o.id });
    out.push({ a: P(ln, t0, u0), b: P(ln, t0, u1), n: ln.dir, space: o.kind, op: o.id });
    out.push({ a: P(ln, t1, u0), b: P(ln, t1, u1), n: [-ln.dir[0], -ln.dir[1]], space: o.kind, op: o.id });
  }
  return out;
}
/** 평면 점 → 가장 가까운 붙일 벽 위 점 */
export function snapWall(d: Design, x: number, z: number): { p: P2; n: P2; seg: WallSeg } {
  let best: { p: P2; n: P2; seg: WallSeg } | null = null, bd = Infinity;
  for (const s of mountWalls(d)) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz;
    const k = L2 ? clamp(((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2, 0, 1) : 0;
    const p: P2 = [s.a[0] + dx * k, s.a[1] + dz * k], dd = len2(p, [x, z]);
    if (dd < bd) { bd = dd; best = { p, n: s.n, seg: s }; }
  }
  return best!;
}
type Floor = { x0: number; z0: number; x1: number; z1: number; space: 'kitchen' | OpeningKind; op?: Opening };
/** 바닥 인입점을 둘 수 있는 바닥 — 부엌 · 벽 너머 공간 */
function floors(d: Design): Floor[] {
  const out: Floor[] = [{ x0: 0, z0: 0, x1: d.room.w, z1: d.room.d, space: 'kitchen' }];
  for (const o of d.openings) {
    const ln = o.depth ? wallLine(d, o.wall) : null;
    if (!ln) continue;
    const a = P(ln, o.t - 300, -WALL_THICK), b = P(ln, o.t + o.w + 300, -WALL_THICK - o.depth!);
    out.push({ x0: Math.min(a[0], b[0]), z0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), z1: Math.max(a[1], b[1]), space: o.kind, op: o });
  }
  return out;
}
/** 평면 점 → 가장 가까운 바닥 위 점(안이면 그대로) */
export function snapFloor(d: Design, x: number, z: number): P2 {
  let best: P2 = [x, z], bd = Infinity;
  for (const f of floors(d)) { const q: P2 = [clamp(x, f.x0, f.x1), clamp(z, f.z0, f.z1)], dd = len2(q, [x, z]); if (dd < bd) { bd = dd; best = q; } }
  return best;
}
/** 3D 에서 끌 때 마우스 광선(원점 o · 방향 dir, mm)이 가리키는 설비 자리(사용자 2026-11-11 「설비를 선택해서 실시간으로 위치 변경」).
 *  벽(wall) — 카메라를 마주 보는 붙일 벽 면 중 가장 가까운 점(높이 포함). 카메라 쪽 벽은 3D 가 숨기므로 뒤에서 뚫고 지나는 면은 건너뛴다.
 *  벽을 안 가리키면(바닥 쪽) 높이 y0 수평면 점에서 가장 가까운 벽으로. 높이는 100 ~ 천장 − 100.
 *  바닥(floor) — 바닥 면 점, 바닥 밖이면 가장 가까운 바닥(부엌 · 벽 너머 공간). 광선이 위를 향해 면을 못 만나면 null */
export function mepAim(d: Design, mount: 'wall' | 'floor', o: V3, dir: V3, y0: number): V3 | null {
  const H = d.room.h;
  const plane = (y: number): P2 | null => { if (Math.abs(dir[1]) < 1e-9) return null; const t = (y - o[1]) / dir[1]; return t > 0 ? [o[0] + dir[0] * t, o[2] + dir[2] * t] : null; };
  if (mount === 'floor') { const q = plane(0); if (!q) return null; const f = snapFloor(d, q[0], q[1]); return [f[0], 0, f[1]]; }
  let best: V3 | null = null, bt = Infinity;
  for (const s of mountWalls(d)) {
    const den = dir[0] * s.n[0] + dir[2] * s.n[1];
    if (den > -1e-9) continue;   // 면 뒤에서(같은 쪽으로) 지나는 광선
    const t = ((s.a[0] - o[0]) * s.n[0] + (s.a[1] - o[2]) * s.n[1]) / den;
    if (t <= 0 || t >= bt) continue;
    const x = o[0] + dir[0] * t, y = o[1] + dir[1] * t, z = o[2] + dir[2] * t;
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, k = L2 ? ((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2 : -1;
    if (k < -1e-6 || k > 1 + 1e-6 || y < 0 || y > H) continue;
    bt = t; best = [x, clamp(y, 100, H - 100), z];
  }
  if (best) return best;
  const q = plane(y0);
  if (!q) return null;
  const w = snapWall(d, q[0], q[1]);
  return [w.p[0], clamp(y0, 100, H - 100), w.p[1]];
}

/* ───────── 부엌 둘레 ───────── */
const offs = (r: Room) => [0, r.w, r.w + r.d, 2 * r.w + r.d];
const perLen = (r: Room) => 2 * (r.w + r.d);
const norm = (r: Room, s: number) => { const L = perLen(r); return ((s % L) + L) % L; };
/** 트인 쪽 열린 구간(날개벽 사이) — 벽이 없어 벽 따라 갈 수 없다 */
function openSpan(d: Design): P2 | null {
  if (d.openWall == null) return null;
  const L = wallLength(d.room, d.openWall), o = offs(d.room)[d.openWall];
  const a = o + Math.min(d.wing.a, L / 2), b = o + L - Math.min(d.wing.b, L / 2);
  return b - a > 1 ? [a, b] : null;
}
/** 부엌 벽(날개벽 포함) 가까이 있는 평면 점 → 둘레 위치 s. 멀거나 열린 구간이면 null */
function sOf(d: Design, x: number, z: number, tol = 400): number | null {
  const r = d.room;
  if (x < -1 || x > r.w + 1 || z < -1 || z > r.d + 1) return null;
  const c = [{ w: 0, t: x, dist: Math.abs(z) }, { w: 1, t: z, dist: Math.abs(r.w - x) }, { w: 2, t: r.w - x, dist: Math.abs(r.d - z) }, { w: 3, t: r.d - z, dist: Math.abs(x) }].sort((p, q) => p.dist - q.dist)[0];
  if (c.dist > tol) return null;
  const s = offs(r)[c.w] + clamp(c.t, 0, wallLength(r, c.w as WallId)), op = openSpan(d);
  return op && s > op[0] + 1 && s < op[1] - 1 ? null : s;
}
/** 둘레 s → 벽에서 inset 만큼 안쪽 점(모서리 근처는 모서리 안쪽 점으로 모은다) */
function perimPt(r: Room, s: number, inset: number): P2 {
  s = norm(r, s);
  const o = offs(r), w = (s >= o[3] ? 3 : s >= o[2] ? 2 : s >= o[1] ? 1 : 0) as WallId, L = wallLength(r, w);
  return wallPoint(r, w, clamp(s - o[w], inset, L - inset), inset);
}
/** 둘레 s0 → s1 벽을 따라가는 점들(양 끝 포함) — 짧은 쪽, 단 열린 구간을 지나면 반대쪽 */
/** 둘레 s0 → s1 으로 갈 방향(+1 = s 가 커지는 쪽) · 길이 — 짧은 쪽, 단 열린 구간을 지나면 반대쪽 */
function perimRoute(d: Design, s0: number, s1: number): { dir: 1 | -1; len: number } {
  const r = d.room;
  s0 = norm(r, s0); s1 = norm(r, s1);
  const fwd = norm(r, s1 - s0), back = norm(r, s0 - s1), op = openSpan(d);
  const hits = (dir: 1 | -1, len: number) => { if (!op) return false; const m = (op[0] + op[1]) / 2, k = dir > 0 ? norm(r, m - s0) : norm(r, s0 - m); return k > 0 && k < len; };
  let dir: 1 | -1 = fwd <= back ? 1 : -1;
  if (hits(dir, dir > 0 ? fwd : back)) dir = dir > 0 ? -1 : 1;
  return { dir, len: dir > 0 ? fwd : back };
}
function alongWalls(d: Design, s0: number, s1: number, inset: number): P2[] {
  const r = d.room, L = perLen(r), o = offs(r);
  s0 = norm(r, s0); s1 = norm(r, s1);
  const { dir, len } = perimRoute(d, s0, s1);
  const pts: P2[] = [perimPt(r, s0, inset)];
  const cs = [o[1], o[2], o[3], L].map((c) => ({ c, k: dir > 0 ? norm(r, c - s0) : norm(r, s0 - c) })).filter((x) => x.k > 0.5 && x.k < len - 0.5).sort((a, b) => a.k - b.k);
  for (const { c } of cs) { const n = norm(r, c); pts.push(n === 0 ? [inset, inset] : n === o[1] ? [r.w - inset, inset] : n === o[2] ? [r.w - inset, r.d - inset] : [inset, r.d - inset]); }
  pts.push(perimPt(r, s1, inset));
  return pts;
}

/* ───────── 길 ───────── */
/** 길 끝 — 점 · 부엌 둘레 위치(벽에 붙은 것) · 벽 너머 공간에서 입구까지 지나는 점들(pre, 기기 쪽부터) */
interface Port { p: V3; s: number | null; pre: P2[]; room?: string; /** 벽 너머 공간 안 ㄷ자 둘레(평면) · 그 위 이 끝의 자리(길이) — 같은 공간 안끼리 벽 따라 */ ru?: { pts: P2[]; at: number } }
const xz = (p: V3): P2 => [p[0], p[2]];
/** 같은 점이 이어진 것을 뺀다 */
function clean(pts: V3[]): V3[] {
  const out: V3[] = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) > 0.5) out.push(p); }
  return out;
}
/** 평면 길 → 3D — 끝마다 제 높이에서 첫 · 끝 점까지 가로로, 거기서 길 높이 y 로 오르내린다 */
function lift(a: V3, plan: P2[], y: number, b: V3): V3[] {
  if (!plan.length) return clean([a, [a[0], y, a[2]], [b[0], y, b[2]], b]);
  const f = plan[0], l = plan[plan.length - 1];
  return clean([a, [f[0], a[1], f[1]], [f[0], y, f[1]], ...plan.slice(1, -1).map((q): V3 => [q[0], y, q[1]]), [l[0], y, l[1]], [l[0], b[1], l[1]], b]);
}
/** 점 바로 앞(벽 면에서 0 ~ reach)에 있는 붙일 벽 — 벽 면 위 점 · 법선 */
function wallBehind(d: Design, e: V3, reach: number): { p: P2; n: P2 } | null {
  let best: { p: P2; n: P2 } | null = null, bu = Infinity;
  for (const s of mountWalls(d)) {
    const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, k = L2 ? ((e[0] - s.a[0]) * dx + (e[2] - s.a[1]) * dz) / L2 : -1;
    if (k < 0 || k > 1) continue;
    const u = (e[0] - s.a[0]) * s.n[0] + (e[2] - s.a[1]) * s.n[1];
    if (u < -0.5 || u > reach || u >= bu) continue;
    bu = u; best = { p: [s.a[0] + dx * k, s.a[1] + dz * k], n: s.n };
  }
  return best;
}
/** 묻은 길 — 높이 y(바닥 속 · 천장 위)의 평면 길(plan)로 간다. 끝마다 오르내림:
 *  벽 면 바로 앞(150 안) 기기는 벽 속(면 뒤 wallIn)으로 짧게 꽂아 벽 속으로 오르내리고, 바닥 속 길이면 그 자리에서 곧장 내려가고(장 · 기기 밑),
 *  천장 위 길이면 장 안 높이(950 아래)의 기기는 뒤 벽(650 안)까지 장 안으로 가서 벽 속으로 오른다. 그 밖은 그 자리에서 곧장.
 *  예전엔 끝 높이 그대로 첫 점까지 가로로 가고, 길도 벽 앞 공중(벽에서 20 ~ 160)이었다 — 사용자 2026-11-11 「공간에 다 노출되어있어」.
 *  front > 0 이면 벽 속이 아니라 벽 면 앞 front 에서 오르내린다(덕트 · 가스) */
function bury(d: Design, a: V3, plan: P2[], y: number, b: V3, front = 0): V3[] {
  const riser = (e: V3): V3[] => {
    const near = wallBehind(d, e, 150) ?? (y > d.room.h && e[1] < 950 ? wallBehind(d, e, 650) : null);
    if (near) {
      const k = front > 0 ? front : -A.wallIn, q: P2 = [near.p[0] + near.n[0] * k, near.p[1] + near.n[1] * k];
      return [e, [q[0], e[1], q[1]], [q[0], y, q[1]]];
    }
    return [e, [e[0], y, e[2]]];
  };
  return clean([...riser(a), ...plan.map((q): V3 => [q[0], y, q[1]]), ...riser(b).reverse()]);
}
/** ㄱ자 — first: 먼저 움직일 축 */
const elbow = (a: P2, b: P2, first: 'x' | 'z' = 'x'): P2[] => (Math.abs(a[0] - b[0]) < 1 || Math.abs(a[1] - b[1]) < 1 ? [a, b] : [a, first === 'x' ? [b[0], a[1]] : [a[0], b[1]], b]);
/** 벽 따라(둘 다 부엌 둘레에 있으면) 아니면 꺾은 선 — 높이 y, 벽에서 inset */
function wallPath(d: Design, a: Port, b: Port, inset: number): P2[] {
  const r = d.room;
  // 같은 벽 너머 공간 안끼리 — 입구로 나갔다 들어오지 않고 그 안에서 꺾어 간다
  if (a.room && a.room === b.room) return a.ru && b.ru ? polySub(a.ru.pts, a.ru.at, b.ru.at) : elbow(xz(a.p), xz(b.p));
  if (a.s != null && b.s != null) return [...a.pre, ...alongWalls(d, a.s, b.s, inset), ...b.pre.slice().reverse()];
  const ea = a.s != null ? perimPt(r, a.s, inset) : a.pre.length ? a.pre[a.pre.length - 1] : xz(a.p);
  const eb = b.s != null ? perimPt(r, b.s, inset) : b.pre.length ? b.pre[b.pre.length - 1] : xz(b.p);
  return [...a.pre, ...elbow(ea, eb), ...b.pre.slice().reverse()];
}
const routeWall = (d: Design, a: Port, b: Port, y: number, inset: number) => lift(a.p, wallPath(d, a, b, inset), y, b.p);
/** 바닥 속 — a 에서 내려가 ㄱ자로 b 아래까지 가서 올라간다. toWall = b 쪽 벽 법선(그 벽 쪽으로 먼저 곧게) */
function routeFloor(d: Design, a: V3, b: V3, toWall?: P2, preA: P2[] = [], preB: P2[] = []): V3[] {
  const s = preA.length ? preA[preA.length - 1] : xz(a), e = preB.length ? preB[preB.length - 1] : xz(b);
  const first = toWall ? (Math.abs(toWall[0]) > 0.5 ? 'x' : 'z') : 'x';
  return bury(d, a, [...preA, ...elbow(s, e, first), ...preB.slice().reverse()], A.floorY, b);
}
/** 묻은 길 — 벽 따라(벽 속 inset < 0) 또는 꺾은 선, 높이 y */
const routeBury = (d: Design, a: Port, b: Port, y: number, inset: number, front = 0) => bury(d, a.p, wallPath(d, a, b, inset), y, b.p, front);
/** 길이 · 꺾임 수(가로 · 세로 방향이 바뀐 곳) */
function measure(pts: V3[]): { len: number; bends: number } {
  let len = 0, bends = 0, prev: V3 | null = null;
  for (let i = 1; i < pts.length; i++) {
    const v: V3 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]], l = Math.hypot(...v);
    if (l < 1) continue;
    len += l;
    const u: V3 = [v[0] / l, v[1] / l, v[2] / l];
    if (prev && u[0] * prev[0] + u[1] * prev[1] + u[2] * prev[2] < 0.99) bends++;
    prev = u;
  }
  return { len, bends };
}
/** 바닥 속 가로 길이 */
const floorLen = (pts: V3[]) => pts.reduce((s, p, i) => (i && p[1] < 0 && pts[i - 1][1] < 0 ? s + len2(xz(p), xz(pts[i - 1])) : s), 0);

/* ───────── 벽 너머 공간 ───────── */
/** 꺾은 선 위 길이 at 자리의 점 */
function polyAt(pts: P2[], at: number): P2 {
  for (let i = 1; i < pts.length; i++) { const L = len2(pts[i - 1], pts[i]); if (at <= L || i === pts.length - 1) { const k = L ? clamp(at / L, 0, 1) : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k]; } at -= L; }
  return pts[pts.length - 1];
}
/** 꺾은 선 위 가장 가까운 자리(길이) */
function polyProj(pts: P2[], q: P2): number {
  let best = 0, bd = Infinity, acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = len2(a, b), k = L ? clamp(((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / (L * L), 0, 1) : 0;
    const dd = len2([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], q);
    if (dd < bd) { bd = dd; best = acc + L * k; }
    acc += L;
  }
  return best;
}
/** 꺾은 선 a → b 자리 사이 점들(양 끝 포함) */
function polySub(pts: P2[], a: number, b: number): P2[] {
  const out: P2[] = [polyAt(pts, a)];
  let acc = 0;
  const vs = pts.map((q, i) => { if (i) acc += len2(pts[i - 1], q); return { q, at: acc }; }).slice(1, -1);
  for (const v of a <= b ? vs : vs.slice().reverse()) if ((v.at - a) * (v.at - b) < 0) out.push(v.q);
  out.push(polyAt(pts, b));
  return out;
}
/** 벽 너머 공간 안 점(그 벽 기준 t, u) → 길 끝. 공간 안에서는 입구 벽을 뺀 세 벽(ㄷ자)을 벽 면에서 gasInset 띄워 따라 가까운 앞 모서리까지 가고,
 *  거기서 입구 옆 벽(문 자리 밖)을 뚫고 부엌 둘레로 — 예전엔 공간 한가운데를 가로질러 입구 가운데로 나왔다(문 구멍을 지나는 관 · 사용자 2026-11-11 「공간에 다 노출」).
 *  거실 벽이면 거실로 200 나와서 */
function roomPort(d: Design, o: Opening, t: number, u: number, y: number, k: number = A.gasInset): Port | null {
  const ln = wallLine(d, o.wall);
  if (!ln) return null;
  const x0 = o.t - 300 + k, x1 = o.t + o.w + 300 - k, ub = -WALL_THICK - o.depth! + k, uf = -WALL_THICK - k, q = P(ln, t, u);
  const U: P2[] = [P(ln, x0, uf), P(ln, x0, ub), P(ln, x1, ub), P(ln, x1, uf)];
  const total = U.slice(1).reduce((sum, v, i) => sum + len2(U[i], v), 0), at = polyProj(U, [q[0], q[1]]);
  const left = at <= total - at, exitT = left ? x0 : x1;
  const pre = polySub(U, at, left ? 0 : total);
  const kitchen = o.wall < 4;
  if (!kitchen) pre.push(P(ln, exitT, 200));
  return { p: [q[0], y, q[1]], s: kitchen ? offs(d.room)[o.wall as WallId] + exitT : null, pre, room: o.id, ru: { pts: U, at } };
}

/* ───────── 인입점 ───────── */
function placeInlets(d: Design, c: Candidate): { inlets: Inlet[]; ports: Record<InletKey, Port> } {
  const r = d.room, H = r.h;
  const sink = c.items.find((x) => x.tag === 'sink'), hob = c.items.find((x) => x.tag === 'hob');
  const util = d.openings.find((o) => o.kind === 'utility' && wallLine(d, o.wall));
  const kitchenSnap = (x: number, z: number) => {
    // 부엌 벽(날개벽 포함)만
    const segs = mountWalls(d).filter((s) => s.space === 'kitchen');
    let best = { p: [x, z] as P2, n: [0, 1] as P2 }, bd = Infinity;
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, k = L2 ? clamp(((x - s.a[0]) * dx + (z - s.a[1]) * dz) / L2, 0, 1) : 0;
      const p: P2 = [s.a[0] + dx * k, s.a[1] + dz * k];
      if (len2(p, [x, z]) < bd) { bd = len2(p, [x, z]); best = { p, n: s.n }; }
    }
    return best;
  };
  const auto: Partial<Record<InletKey, { p: P2; y: number }>> = {};
  // 배수구 · 급수 — 싱크가 있는 벽 아래(아일랜드 싱크면 가장 가까운 부엌 벽 아래)
  if (sink && sink.wall != null) {
    auto.drain = { p: at(sink, sink.w / 2 - 150, 80), y: A.floorY };
    auto.water = { p: at(sink, sink.w / 2 + 150, 80), y: A.floorY };
  } else {
    const sc = sink ? at(sink, sink.w / 2, 300) : [r.w / 2, 0] as P2, k = kitchenSnap(sc[0], sc[1]);
    const along: P2 = [-k.n[1], k.n[0]];
    auto.drain = { p: [k.p[0] + k.n[0] * 80, k.p[1] + k.n[1] * 80], y: A.floorY };
    auto.water = { p: [k.p[0] + k.n[0] * 80 + along[0] * 300, k.p[1] + k.n[1] * 80 + along[1] * 300], y: A.floorY };
  }
  // 난방 분배기 — 싱크장 밑(아일랜드 싱크면 배수구에서 가장 가까운 벽 여닫이 하부장 밑)
  if (sink && sink.wall != null) auto.manifold = { p: at(sink, 150, 300), y: A.manifoldY };
  else {
    const dp = auto.drain!.p;
    const cand = c.items.filter((x) => x.level === 'base' && x.wall != null && !x.tag && !/fill|corner/.test(x.key));
    const best = cand.sort((a, b) => (/^cook/.test(a.key) ? 0 : 1) - (/^cook/.test(b.key) ? 0 : 1) || len2(at(a, a.w / 2, 300), dp) - len2(at(b, b.w / 2, 300), dp))[0];
    auto.manifold = { p: best ? at(best, best.w / 2, 300) : [dp[0], dp[1]], y: A.manifoldY };
  }
  // 분전반 — 날개벽 → 트인 쪽과 맞닿은 옆 벽 끝(300 안쪽) → 트인 쪽이 없으면 정면 맞은편 벽
  if (d.openWall != null) {
    const f = wallFrame(r, d.openWall) as unknown as { o: P2; dir: P2; n: P2 }, L = wallLength(r, d.openWall);
    const wa = Math.min(d.wing.a, L / 2), wb = Math.min(d.wing.b, L / 2);
    if (wa > 1 || wb > 1) auto.panel = { p: wa >= wb ? P(f, wa / 2, 0) : P(f, L - wb / 2, 0), y: A.panelY };
    else {
      const ka = prevWall(d.openWall), kb = nextWall(d.openWall);
      const busy = (w: WallId, t0: number, t1: number) => c.items.some((x) => x.wall === w && x.level === 'tall' && x.t < t1 && x.t + x.w > t0);
      const La = wallLength(r, ka);
      auto.panel = busy(ka, La - 700, La) && !busy(kb, 0, 700) ? { p: wallPoint(r, kb, 300), y: A.panelY } : { p: wallPoint(r, ka, La - 300), y: A.panelY };
    }
  } else { const w = ((viewWalls(null).front + 2) % 4) as WallId; auto.panel = { p: wallPoint(r, w, 300), y: A.panelY }; }
  // 가스 인입 — 다용도실 맞은편 벽(창 옆), 없으면 쿡탑 벽 쿡탑 옆(아일랜드 쿡탑이면 가장 가까운 부엌 벽)
  const hobWall = hob && hob.wall != null;
  if (util) { const ln = wallLine(d, util.wall)!; auto.gas = { p: P(ln, util.t + util.w + 300 - 250, -WALL_THICK - util.depth!), y: A.gasInY }; }
  else if (hob && hobWall) auto.gas = { p: P(hob.frame, clamp(hob.t + hob.w + 300, 50, wallLength(r, hob.wall!) - 50), 0), y: A.gasInY };
  else { const hc = hob ? at(hob, hob.w / 2, 300) : [r.w / 2, 0] as P2; auto.gas = { p: kitchenSnap(hc[0], hc[1]).p, y: A.gasInY }; }
  // 공용 배기 덕트 — 쿡탑 위 천장 가까운 벽(아일랜드 쿡탑이면 가장 가까운 부엌 벽)
  if (hob && hobWall) auto.duct = { p: P(hob.frame, hob.t + hob.w / 2, 0), y: H - A.ceilGap - 50 };
  else { const hc = hob ? at(hob, hob.w / 2, 300) : [r.w / 2, 0] as P2; auto.duct = { p: kitchenSnap(hc[0], hc[1]).p, y: H - A.ceilGap - 50 }; }
  // 보일러 — 다용도실 옆 벽, 없으면 가스 인입 옆 600
  if (util) { const ln = wallLine(d, util.wall)!; auto.boiler = { p: P(ln, util.t - 300, -WALL_THICK - util.depth! / 2), y: A.boilerY }; }
  else {
    const g = snapWall(d, auto.gas!.p[0], auto.gas!.p[1]), dir: P2 = [g.seg.b[0] - g.seg.a[0], g.seg.b[1] - g.seg.a[1]], L = Math.hypot(dir[0], dir[1]) || 1;
    const k = ((g.p[0] - g.seg.a[0]) * dir[0] + (g.p[1] - g.seg.a[1]) * dir[1]) / L, k2 = k + 600 <= L - 50 ? k + 600 : Math.max(50, k - 600);
    auto.boiler = { p: [g.seg.a[0] + dir[0] / L * k2, g.seg.a[1] + dir[1] / L * k2], y: A.boilerY };
  }
  const pins = d.mep?.inlets ?? {};
  const inlets: Inlet[] = [], ports = {} as Record<InletKey, Port>;
  const fl = floors(d);
  for (const key of Object.keys(INLET_INFO) as InletKey[]) {
    const info = INLET_INFO[key], pin = pins[key], a = auto[key]!;
    let p: P2, n: P2 | undefined, y: number, port: Port;
    if (info.mount === 'wall') {
      const sw = snapWall(d, pin ? pin.x : a.p[0], pin ? pin.z : a.p[1]);
      p = sw.p; n = sw.seg.n;
      y = clamp(pin?.y ?? a.y, 100, H - 100);
      const room = sw.seg.op ? d.openings.find((o) => o.id === sw.seg.op) : undefined;
      if (room) { const ln = wallLine(d, room.wall)!; const t = (p[0] - ln.o[0]) * ln.dir[0] + (p[1] - ln.o[1]) * ln.dir[1], u = (p[0] - ln.o[0]) * ln.n[0] + (p[1] - ln.o[1]) * ln.n[1]; port = roomPort(d, room, t, u, y)!; }
      else port = { p: [p[0], y, p[1]], s: sw.seg.space === 'kitchen' ? sOf(d, p[0], p[1], 5) : null, pre: [] };
    } else {
      p = pin ? snapFloor(d, pin.x, pin.z) : a.p;
      y = a.y;
      n = kitchenSnap(p[0], p[1]).n;   // 가장 가까운 부엌 벽 쪽 — 바닥 속 길이 그 벽으로 먼저 곧게 간다
      const room = fl.find((f) => f.op && p[0] >= f.x0 - 1 && p[0] <= f.x1 + 1 && p[1] >= f.z0 - 1 && p[1] <= f.z1 + 1)?.op;
      if (room) { const ln = wallLine(d, room.wall)!; const t = (p[0] - ln.o[0]) * ln.dir[0] + (p[1] - ln.o[1]) * ln.dir[1], u = (p[0] - ln.o[0]) * ln.n[0] + (p[1] - ln.o[1]) * ln.n[1]; port = roomPort(d, room, t, u, y)!; }
      else port = { p: [p[0], y, p[1]], s: sOf(d, p[0], p[1], 400), pre: [] };
    }
    inlets.push({ key, sys: info.sys, label: info.label, mount: info.mount, p: [p[0], y, p[1]], pinned: !!pin, ...(n ? { n } : {}) });
    ports[key] = port;
  }
  return { inlets, ports };
}

/** 구간이 묻혔나 — 가운데 점이 바닥 속(높이 < 0) · 천장 위(> 천장) · 붙일 벽 면 뒤 벽 두께 안 */
export function buriedTest(d: Design): (a: V3, b: V3) => boolean {
  const segs = mountWalls(d), H = d.room.h;
  return (a, b) => {
    const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    if (m[1] < 0 || m[1] > H) return true;
    for (const s of segs) {
      const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, k = L2 ? ((m[0] - s.a[0]) * dx + (m[2] - s.a[1]) * dz) / L2 : -1;
      if (k < -0.01 || k > 1.01) continue;
      const u = (m[0] - s.a[0]) * s.n[0] + (m[2] - s.a[1]) * s.n[1];
      if (u <= -1 && u >= -WALL_THICK) return true;
    }
    return false;
  };
}
/** 가스 노출 배관 고정 장치 자리 — 꺾인 곳마다, 곧은 구간은 1,800 안마다(호칭 13 ~ 33mm 는 2m 마다 · 도시가스사업법 시행규칙 별표 7). 묻힌 구간(바닥 속 슬리브 · 벽 관통)은 빼고 */
export function gasClamps(r: Run, every = 1800): V3[] {
  const out: V3[] = [];
  for (let i = 1; i < r.pts.length; i++) {
    if (r.hid[i - 1]) continue;
    const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (L < 1) continue;
    const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L, a[2] + (b[2] - a[2]) * t / L];
    if (i > 1) out.push(a); else out.push(at(Math.min(150, L / 2)));
    const n = Math.ceil(L / every);
    for (let k = 1; k < n; k++) out.push(at(L * k / n));
  }
  return out;
}
/* ───────── 설비 계산 ───────── */
const KIND_NAME: Record<string, string> = { drawer3: '3단 서랍장', drawer2: '2단 서랍장', dish: '식기세척기장', oven: '오븐장' };
export function mepOf(d: Design, c: Candidate): MepInfo {
  const r = d.room, H = r.h;
  const runs: Run[] = [], nodes: MepNode[] = [], checks: MepCheck[] = [];
  const hobName = applianceOf('hob', d.appliance?.hob)?.name ?? '';
  const gasHob = /가스/.test(hobName), downdraft = /후드일체형/.test(hobName);
  const hobKind = gasHob ? '가스' : /인덕션/.test(hobName) ? '인덕션' : /하이브리드/.test(hobName) ? '하이브리드' : /하이라이트/.test(hobName) ? '하이라이트' : '전기레인지';
  const sink = c.items.find((x) => x.tag === 'sink'), dish = c.items.find((x) => x.tag === 'dish'), hob = c.items.find((x) => x.tag === 'hob');
  const oven = c.items.find((x) => x.key === 'oven'), hood = c.items.find((x) => x.key === 'hood'), fridge = c.items.find((x) => x.tag === 'fridge');
  const isl = c.island;
  const { inlets, ports } = placeInlets(d, c);
  const IN = Object.fromEntries(inlets.map((i) => [i.key, i])) as Record<InletKey, Inlet>;
  const node = (sys: Sys, kind: MepNode['kind'], p: V3, label: string, n?: P2) => { nodes.push({ sys, kind, p, label, ...(n ? { n } : {}) }); return p; };
  const buried = buriedTest(d);
  /** 가스관 높이 — 문 · 창 · 입구 윗선(몰딩 포함)보다 50 위, 적어도 gasY(1,900) · 천장 − 100 까지. 예전엔 1,900 으로 가다 다용도실 문 구멍을 가로질렀다(2026-11-11) */
  const gasY = clamp(Math.max(A.gasY, ...d.openings.map((o) => (o.kind === 'window' ? o.sill + o.h : o.h) + CASING + 50)), 0, H - 100);
  const run = (sys: Sys, sub: Run['sub'], pts: V3[], to: string, od?: number, circuit?: string) => { const q = clean(pts); if (q.length > 1) runs.push({ sys, sub, pts: q, to, hid: q.slice(1).map((b, i) => buried(q[i], b)), ...(od ? { od } : {}), ...(circuit ? { circuit } : {}) }); return q; };
  const port = (it: Item, dt: number, u: number, y: number): Port => { const q = at(it, dt, u); return { p: [q[0], y, q[1]], s: it.wall != null ? offs(r)[it.wall] + it.t + dt : null, pre: [] }; };
  const pt = (p: V3): Port => ({ p, s: sOf(d, p[0], p[2], 5), pre: [] });
  /** 바닥을 가로지르는 길(아일랜드 · 방 가운데 · 거실 쪽) — 「골조 단계 배관 홈」 확인에 이름을 올린다 */
  const islandFloor: string[] = [];
  const kitchenWallNear = (q: P2) => { const segs = mountWalls(d).filter((s) => s.space === 'kitchen'); let best: { p: P2; n: P2 } | null = null, bd = Infinity; for (const s of segs) { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L2 = dx * dx + dz * dz, kk = L2 ? clamp(((q[0] - s.a[0]) * dx + (q[1] - s.a[1]) * dz) / L2, 0, 1) : 0; const p: P2 = [s.a[0] + dx * kk, s.a[1] + dz * kk]; if (len2(p, q) < bd) { bd = len2(p, q); best = { p, n: s.n }; } } return best!; };
  /** 급수 · 온수 · 난방 길 — 바닥 속(층상 배관), 벽 따라 가는 구간은 벽 줄 밑(벽 속 inset). 끝에서는 벽 속 · 장 밑으로 오르내린다(bury).
   *  둘 다 부엌 벽(둘레)이 아니면(아일랜드 · 방 가운데 · 거실 쪽) 「골조 단계 배관 홈」 확인에 이름을 올린다 */
  const pipe = (a: Port, b: Port, inset: number, label: string): V3[] => {
    if (!(a.s != null && b.s != null) && !(a.room && a.room === b.room) && !(!a.pre.length && !b.pre.length && len2(xz(a.p), xz(b.p)) < 1500)) islandFloor.push(label);
    return routeBury(d, a, b, A.floorY, -inset);
  };
  /** 장 안 짧은 관(식기세척기 급수 · 배수 호스) — 하부장 뒤 · 밑을 따라 그 높이로(묻지 않음) */
  const cabPipe = (a: Port, b: Port, y: number, inset: number): V3[] => routeWall(d, a, b, y, inset);
  const toIsland = (sys: Sys, sub: Run['sub'], from: Port, to: V3, inset: number, label: string, front = 0) => {
    islandFloor.push(label);
    return run(sys, sub, routeBury(d, from, { p: to, s: null, pre: [] }, A.floorY, front > 0 ? inset : -inset, front), label);
  };
  /** 전기 부하 — 먼저 모았다가 끝에서 회로로 짠다(wirePower). group = 일반 콘센트를 묶을 회로(주방 · 벽 너머 공간 이름 · 전등) */
  interface Load { port: Port; label: string; sub: 'dedicated' | 'general'; group: string; island: boolean }
  const loads: Load[] = [];
  const conduit = (label: string, sub: 'dedicated' | 'general') => (sub === 'dedicated' && /쿡탑/.test(label) ? MEP_SIZE.conduit.hob : MEP_SIZE.conduit.general);
  const power = (to: Port, label: string, sub: 'dedicated' | 'general', group = '주방') => { loads.push({ port: to, label, sub, group, island: false }); };
  const powerIsland = (to: V3, label: string, sub: 'dedicated' | 'general') => { islandFloor.push(label); loads.push({ port: { p: to, s: null, pre: [] }, label, sub, group: '주방', island: true }); };

  /* 싱크 — 냉 · 온수 · 배수 · 식기세척기 */
  let coldTap: V3 | null = null;
  if (sink) {
    const onWall = sink.wall != null;
    const fq = at(sink, sink.w / 2, FAUCET_Z), tq = at(sink, sink.w / 2, SINK_Z);
    const faucet = node('water', 'faucet', [fq[0], COUNTER_TOP - 30, fq[1]], '싱크 수전');
    const trap = node('drain', 'trap', [tq[0], 450, tq[1]], '싱크 배수(트랩)');
    const coldB = port(sink, sink.w / 2 + 100, 60, A.lowY), hotB = port(sink, sink.w / 2 - 100, 60, A.lowY);
    coldTap = coldB.p;
    if (onWall) {
      run('water', 'cold', [...pipe(ports.water, coldB, 30, '싱크 급수'), faucet], '싱크');
      run('water', 'hot', [...pipe(ports.boiler, hotB, 55, '싱크 온수'), faucet], '싱크');
      run('drain', undefined, routeFloor(d, trap, IN.drain.p, IN.drain.n, [], ports.drain.pre), '싱크');
    } else {
      run('water', 'cold', [...routeFloor(d, IN.water.p, coldB.p, undefined, ports.water.pre), faucet], '싱크');
      islandFloor.push('싱크 급수');
      toIsland('water', 'hot', ports.boiler, hotB.p, 55, '싱크 온수').push(faucet);
      run('drain', undefined, routeFloor(d, trap, IN.drain.p, IN.drain.n, [], ports.drain.pre), '싱크');
      islandFloor.push('싱크 배수');
    }
    // 식기세척기 — 냉수 분기 · 배수는 싱크 트랩으로 · 전용 콘센트(싱크장 안)
    if (dish) {
      const dv = port(dish, dish.w / 2, 60, A.lowY);
      node('water', 'valve', dv.p, '식기세척기 급수');
      const br = run('water', 'cold', onWall ? cabPipe(coldB, dv, A.lowY, 40) : pipe(coldB, dv, 30, '식기세척기 급수'), '식기세척기');
      const dd = port(dish, dish.w / 2, 300, 200);
      node('drain', 'device', dd.p, '식기세척기 배수');
      run('drain', undefined, onWall ? cabPipe(dd, { p: trap, s: coldB.s, pre: [] }, 200, 100) : pipe(dd, { p: trap, s: null, pre: [] }, 100, '식기세척기 배수'), '식기세척기');
      const out = port(sink, 120, 60, 400);
      node('power', 'dedicated', out.p, '식기세척기 전용 콘센트 16A (싱크장 안)', sink.frame.n);
      if (onWall) power(out, '식기세척기', 'dedicated'); else powerIsland(out.p, '식기세척기 전원', 'dedicated');
      const m = measure([faucet, ...br]);
      if (m.len > A.dishMax) checks.push({ level: 'warn', sys: 'water', text: `식기세척기가 수전에서 ${(m.len / 1000).toFixed(1)}m — 2.5m 안을 권장합니다(삼성 설치 가이드) · 확인 필요`, at: xz(dv.p) });
    }
  }

  /* 쿡탑 — 가스 중간밸브 또는 전용 콘센트, 후드일체형이면 배기도 쿡탑에서 */
  if (hob) {
    const onWall = hob.wall != null;
    if (gasHob) {
      const v = port(hob, hob.w / 2, 60, 500);
      node('gas', 'valve', v.p, '쿡탑 가스 중간밸브');
      if (onWall) run('gas', undefined, routeWall(d, ports.gas, v, gasY, A.gasInset), '쿡탑'); else toIsland('gas', undefined, ports.gas, v.p, A.gasInset, '쿡탑 가스', A.gasInset);
    } else {
      const o = port(hob, hob.w / 2, 60, 300);
      node('power', 'dedicated', o.p, `쿡탑 전용 콘센트 16A (${hobKind})`, hob.frame.n);
      if (onWall) power(o, '쿡탑', 'dedicated'); else powerIsland(o.p, '쿡탑 전원', 'dedicated');
    }
    if (downdraft) {
      const h = port(hob, hob.w / 2, 300, 600);
      node('vent', 'hood', h.p, '후드일체형 쿡탑 배기');
      // 쿡탑에서 걸레받이 높이(60)로 내려가 벽 · 하부장 밑을 따라 덕트 아래까지, 거기서 덕트로
      if (onWall) run('vent', undefined, routeWall(d, h, ports.duct, 60, 40), '후드일체형 쿡탑');
      else { const fl = routeFloor(d, h.p, ports.duct.p, IN.duct.n); run('vent', undefined, fl, '후드일체형 쿡탑'); islandFloor.push('쿡탑 배기'); }
    }
  }
  /* 후드 — 벽 후드(후드장 · 침니)는 위로 천장 쪽까지 올라 덕트로, 아일랜드 쿡탑은 천장형 후드에서 천장을 따라 */
  let ductRun: V3[] | null = null;
  if (!downdraft) {
    if (hood && hood.wall != null) {
      const ub = upperBottomOf(r);
      const h = port(hood, hood.w / 2, 170, ub + 150);
      node('vent', 'hood', h.p, hoodKindOf(applianceOf('hood', d.appliance?.hood)) === 'chimney' ? '침니 후드' : '후드');
      ductRun = run('vent', undefined, routeBury(d, h, ports.duct, H + A.ductUp, 150, 60), '후드');
      const o = port(hood, Math.min(hood.w - 60, hood.w / 2 + 250), 40, ub + 450);
      node('power', 'outlet', o.p, '후드 콘센트', hood.frame.n);
      power(o, '후드', 'general');
    } else if (hob && hob.wall == null) {
      const hc = at(hob, hob.w / 2, 300), h: V3 = [hc[0], H - 700, hc[1]];
      node('vent', 'hood', h, '아일랜드 천장형 후드');
      ductRun = run('vent', undefined, bury(d, h, elbow(hc, perimPt(r, ports.duct.s ?? sOf(d, IN.duct.p[0], IN.duct.p[2], 5000) ?? 0, 150)), H + A.ductUp, IN.duct.p, 60), '아일랜드 후드');
      const o: V3 = [hc[0] + 150, H - 60, hc[1]];
      node('power', 'outlet', o, '천장형 후드 전원');
      power(pt(o), '천장형 후드', 'general');
    }
  }
  if (ductRun) {
    const m = measure(ductRun);
    if (m.len > A.ductMax || m.bends > A.ductBends) checks.push({ level: 'warn', sys: 'vent', text: `후드 덕트 ${(m.len / 1000).toFixed(1)}m · 꺾임 ${m.bends}번 — 짧고 곧게가 좋습니다(한도 가정 3m · 3번, 기준 원문 미확인) · 확인 필요`, at: xz(ductRun[0]) });
  }
  /* 오븐 · 냉장고 */
  if (oven) { const o = port(oven, oven.w / 2, 60, 200); node('power', 'dedicated', o.p, '오븐 전용 콘센트', oven.frame.n); power(o, '오븐', 'dedicated'); }
  if (fridge) { const o = port(fridge, fridge.w / 2, 40, 300); node('power', 'outlet', o.p, '냉장고 콘센트', fridge.frame.n); power(o, '냉장고', 'general'); }
  /* 아일랜드 — 팝업 콘센트는 늘 */
  if (isl) {
    const busy: P2[] = c.items.filter((x) => x.frame === isl.frame && (x.tag === 'sink' || x.tag === 'hob' || x.tag === 'dish')).map((x) => [x.t - 100, x.t + x.w + 100]);
    const free = subtract(150, isl.len - 150, busy).sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    const ict = c.counters.find((k) => k.island && k.frame === isl.frame);
    const q = free && free[1] - free[0] >= 200 ? P(isl.frame, (free[0] + free[1]) / 2, 300) : P(isl.frame, isl.len / 2, (ict?.z0 ?? -320) + 120), popup: V3 = [q[0], COUNTER_TOP, q[1]];
    node('power', 'popup', popup, '아일랜드 팝업 콘센트');
    powerIsland(popup, '아일랜드 팝업 콘센트', 'general');
  }
  /* 일반 콘센트 — 사용자가 따로 놓은 것 */
  const outlets: { id: string; p: V3; n: [number, number] }[] = [];
  for (const o of d.mep?.outlets ?? []) {
    const sw = snapWall(d, o.x, o.z), y = clamp(o.y ?? A.outletY, 100, H - 100), p: V3 = [sw.p[0], y, sw.p[1]];
    outlets.push({ id: o.id, p, n: sw.seg.n });
    node('power', 'outlet', p, '콘센트', sw.seg.n);
    const room = sw.seg.op ? d.openings.find((x) => x.id === sw.seg.op) : undefined;
    let to: Port = { p, s: sw.seg.space === 'kitchen' ? sOf(d, p[0], p[2], 5) : null, pre: [] };
    if (room) { const ln = wallLine(d, room.wall)!; to = roomPort(d, room, (p[0] - ln.o[0]) * ln.dir[0] + (p[2] - ln.o[1]) * ln.dir[1], (p[0] - ln.o[0]) * ln.n[0] + (p[2] - ln.o[1]) * ln.n[1], y) ?? to; }
    power(to, '콘센트', 'general');
  }
  /* 난방 — 보일러 → 분배기(공급 · 환수), 분배기에서 방 쪽 바닥 난방관(방향만 짧게), 구동기 전원 */
  {
    const mp = ports.manifold;
    run('heat', 'supply', pipe(ports.boiler, mp, 85, '난방 공급'), '난방 분배기');
    run('heat', 'return', pipe(ports.boiler, mp, 110, '난방 환수'), '난방 분배기');
    const m = IN.manifold.p, cx = r.w / 2, cz = r.d / 2, a0 = Math.atan2(cz - m[2], cx - m[0]);
    for (const da of [-0.5, 0, 0.5]) {
      const e: V3 = [m[0] + Math.cos(a0 + da) * 700, -40, m[2] + Math.sin(a0 + da) * 700];
      run('heat', 'supply', [m, [m[0], -40, m[2]], e], '방 바닥 난방');
      node('heat', 'device', e, '바닥 난방관(방 쪽)');
    }
    const o: V3 = [m[0], 250, m[2]];
    node('power', 'outlet', o, '분배기 구동기 전원');
    power({ p: o, s: mp.s, pre: mp.pre }, '분배기 구동기', 'general');
    // 분배기가 있는 하부장 — 서랍 · 식세 · 오븐이면 바닥판을 열기 어렵다
    const cab = c.items.find((x) => x.level === 'base' && x.wall != null && (() => { const t = (m[0] - x.frame.o[0]) * x.frame.dir[0] + (m[2] - x.frame.o[1]) * x.frame.dir[1], u = (m[0] - x.frame.o[0]) * x.frame.n[0] + (m[2] - x.frame.o[1]) * x.frame.n[1]; return t >= x.t && t <= x.t + x.w && u >= 0 && u <= 620; })());
    const kn = cab && (KIND_NAME[cab.key] ?? (/^drawer/.test(cab.key) ? '서랍장' : null));
    if (kn) checks.push({ level: 'warn', sys: 'heat', text: `난방 분배기가 ${kn} 밑에 있습니다 — 점검하려면 바닥판을 열 수 있는 여닫이장이 좋습니다 · 확인 필요`, at: xz(m) });
  }
  /* 보일러 — 가스 */
  run('gas', undefined, routeWall(d, ports.gas, ports.boiler, gasY, A.gasInset), '보일러');

  /* 벽 너머 공간 — 다용도실 · 서브주방 · 팬트리. 부엌과 같은 인입점에서 만나는 자리를 표시 */
  const shared = new Map<InletKey, Set<string>>();
  const share = (k: InletKey, who: string) => { if (!shared.has(k)) shared.set(k, new Set()); shared.get(k)!.add(who); };
  for (const o of d.openings) {
    const ln = o.depth ? wallLine(d, o.wall) : null;
    if (!ln) continue;
    const x0 = o.t - 300, Wd = o.w + 600, ub = -WALL_THICK - o.depth!, name = o.kind === 'utility' ? '다용도실' : o.kind === 'subkitchen' ? '서브주방' : '팬트리';
    const rp = (t: number, u: number, y: number) => roomPort(d, o, t, u, y)!;
    if (o.kind === 'utility') {
      // room3d 와 같은 자리 — 세탁기(건조기 위) 왼쪽 · 세탁 싱크장 오른쪽, 맞은편 벽에 붙음
      const wT = x0 + 400, sw = Math.max(600, Wd - 950), sT = x0 + 800 + sw / 2, back = ub + 40;
      const wc = rp(wT, back, 1000), lc = rp(sT, back + 55, COUNTER_TOP - 60);
      node('water', 'faucet', wc.p, '세탁기 급수');
      run('water', 'cold', pipe(ports.water, wc, 30, '세탁기 급수'), '다용도실 세탁기'); share('water', name);
      run('water', 'hot', pipe(ports.boiler, { ...wc, p: [wc.p[0] + 80, 1000, wc.p[2]] }, 55, '세탁기 온수'), '다용도실 세탁기');
      node('water', 'device', [wc.p[0] + 80, 1000, wc.p[2]], '세탁기 온수');
      const wd = rp(wT + 200, back + 60, A.floorY);
      node('drain', 'device', wd.p, '세탁기 배수');
      run('drain', undefined, routeFloor(d, wd.p, IN.drain.p, IN.drain.n, wd.pre, ports.drain.pre), '다용도실 세탁기'); share('drain', name);
      const wo = rp(wT - 200, back, 1100); node('power', 'outlet', wo.p, '세탁기 콘센트', ln.n); power(wo, '다용도실 세탁기', 'general', name); share('panel', name);
      const dO = rp(wT - 200, back, 1900); node('power', 'outlet', dO.p, '건조기 콘센트', ln.n); power(dO, '다용도실 건조기', 'general', name);
      node('water', 'faucet', lc.p, '세탁 싱크 수전');
      run('water', 'cold', pipe(ports.water, lc, 30, '세탁 싱크 급수'), '다용도실 세탁 싱크');
      run('water', 'hot', pipe(ports.boiler, { ...lc, p: [lc.p[0] - 80, lc.p[1], lc.p[2]] }, 55, '세탁 싱크 온수'), '다용도실 세탁 싱크');
      node('water', 'device', [lc.p[0] - 80, lc.p[1], lc.p[2]], '세탁 싱크 온수');
      const ld = rp(sT, back + 250, 450); node('drain', 'trap', ld.p, '세탁 싱크 배수');
      run('drain', undefined, routeFloor(d, ld.p, IN.drain.p, IN.drain.n, ld.pre, ports.drain.pre), '다용도실 세탁 싱크');
    } else if (o.kind === 'subkitchen') {
      // room3d 는 맞은편 벽에 하부장 · 상판 · 상부장만 — 싱크(왼쪽) · 쿡탑(오른쪽) 자리는 가정. 쿡탑 종류는 부엌 쿡탑을 따른다
      const sT = x0 + Wd * 0.3, hT = x0 + Wd * 0.72, cab = ub + 300;
      const fc = rp(sT, ub + 55, COUNTER_TOP - 30), tr = rp(sT, cab, 450);
      node('water', 'faucet', fc.p, '서브주방 싱크 수전'); node('drain', 'trap', tr.p, '서브주방 싱크 배수');
      run('water', 'cold', pipe(ports.water, fc, 30, '서브주방 급수'), '서브주방 싱크'); share('water', name);
      run('water', 'hot', pipe(ports.boiler, { ...fc, p: [fc.p[0] + 80, fc.p[1], fc.p[2]] }, 55, '서브주방 온수'), '서브주방 싱크');
      node('water', 'device', [fc.p[0] + 80, fc.p[1], fc.p[2]], '서브주방 싱크 온수');
      run('drain', undefined, routeFloor(d, tr.p, IN.drain.p, IN.drain.n, tr.pre, ports.drain.pre), '서브주방 싱크'); share('drain', name);
      if (gasHob) { const v = rp(hT, ub + 60, 500); node('gas', 'valve', v.p, '서브주방 쿡탑 가스 밸브'); run('gas', undefined, routeWall(d, ports.gas, v, gasY, A.gasInset), '서브주방 쿡탑'); share('gas', name); }
      else { const v = rp(hT, ub + 60, 300); node('power', 'dedicated', v.p, '서브주방 쿡탑 전용 콘센트', ln.n); power(v, '서브주방 쿡탑', 'dedicated'); share('panel', name); }
      const hv = rp(hT, ub + 170, 1650); node('vent', 'hood', hv.p, '서브주방 후드');
      run('vent', undefined, routeBury(d, hv, ports.duct, H + A.ductUp, 150, 60), '서브주방 후드'); share('duct', name);
      const ho = rp(hT + 250, ub + 40, 1900); node('power', 'outlet', ho.p, '서브주방 후드 콘센트', ln.n); power(ho, '서브주방 후드', 'general', name);
    } else {
      const po = rp(x0 + Wd / 2, ub + 20, A.outletY); node('power', 'outlet', po.p, '팬트리 콘센트', ln.n); power(po, '팬트리', 'general', name); share('panel', name);
      const lt = rp(x0 + Wd / 2, ub / 2, H - 20);
      node('power', 'light', lt.p, '팬트리 조명');
      power(lt, '팬트리 조명', 'general', '전등');
    }
  }
  for (const [k, who] of shared) {
    const i = IN[k];
    node(i.sys, 'junction', i.p, `${[...who].join(' · ')} ${INLET_INFO[k].label}에서 부엌과 만남`);
  }
  if (shared.size) checks.push({ level: 'info', sys: 'water', text: `${[...new Set([...shared.values()].flatMap((s) => [...s]))].join(' · ')} — 부엌과 같은 ${[...shared.keys()].map((k) => INLET_INFO[k].label).join(' · ')}에서 만납니다(만나는 자리 표시)` });

  /* 전기 회로 — 공동주택 매입 배관(CD관) 방식(사용자 2026-11-11 「보통 설비 공사시 전기 배관 등은 어떻게 …」 · 「분전반에서 나가는 라인들이 저렇게 다이렉트로 연결되는게 맞아?」
   *  · 「직각으로 꺾어」 · 「깔끔한 구조로 바꿔」):
   *  - 전용 회로(쿡탑 · 식기세척기 · 오븐 · 서브주방 쿡탑)는 분전반에서 그 기기까지 한 줄. 일반 콘센트는 묶음(주방 · 벽 너머 공간마다 · 전등)과 높이마다 한 회로로,
   *    분전반 → 가까운 기기 박스 → 다음 박스 순으로 잇는다(둘레 방향이 갈리면 방향마다 한 회로)
   *  - 벽에 붙은 기기는 천장(반자 속)으로 가서 벽 속을 세로로 타고 내려온다, 바닥 슬래브는 아일랜드 기기만(2026-11-11 「바닥에 심으면 관리가 어렵」)
   *  - 슬래브 속은 벽과 나란한 차선(회로마다 벽에서 120 + 45k)을 따라 직각으로만 꺾고, 기기 앞에서 벽 쪽으로 직각으로 빠진다 — 회로끼리 겹치지 않는다
   *  - 분전반 위(아래)는 회로마다 55 씩 옆으로 나란히(나란한 관 사이 30 이상), 7개 넘으면 벽 속 한 줄 더 안쪽 */
  {
    const pp = IN.panel.p, pn = IN.panel.n ?? [0, 1], pal: P2 = [-pn[1], pn[0]];
    // 벽에 붙은 기기는 천장(반자 속)으로 가서 벽을 타고 내려온다 — 바닥 슬래브에 묻으면 콘크리트 · 난방층 속이라 고치기 어렵다(사용자 2026-11-11 「배선은 대부분 천장이나 벽을타고 … 바닥에 심으면 관리가 어렵」).
    // 바닥 슬래브는 벽에 닿지 않는 아일랜드 기기만(골조 단계 배관 홈 확인 알림)
    const levelOf = (l: Load): 'floor' | 'ceil' => (l.island ? 'floor' : 'ceil');
    const yOf = (lv: 'floor' | 'ceil') => (lv === 'floor' ? A.floorY : H + A.slabUp);
    /** 부엌 둘레 자리 — 가장 가까운 부엌 벽(트인 쪽 열린 구간 빼고)에 내린 자리 */
    const op = openSpan(d), o4 = offs(r);
    const projS = (x: number, z: number): number => {
      let best = 0, bd = Infinity;
      for (const w of [0, 1, 2, 3] as WallId[]) {
        const L = wallLength(r, w), f = wallFrame(r, w) as unknown as { o: P2; dir: P2; n: P2 };
        const t = clamp((x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1], 0, L), q = P(f, t, 0), sv = o4[w] + t;
        if (op && sv > op[0] + 1 && sv < op[1] - 1) continue;
        const dd = len2(q, [x, z]);
        if (dd < bd) { bd = dd; best = sv; }
      }
      return best;
    };
    /** 기기 박스에서 슬래브 높이 y 까지 — 벽 면 바로 앞(150) · 장 안 낮은 기기(뒤 벽 650)는 벽 속(면 뒤 wallIn)으로 꽂아 세로로, 그 밖(아일랜드 · 천장 가운데)은 그 자리에서 세로로.
     *  slide = 같은 박스에서 다음 박스로 나가는 관은 벽 따라 45 옆에서(들어온 관과 겹치지 않게) */
    /** 높이별 이미 쓴 오르내림 자리 — 51 안에 또 세우지 않고 벽 따라 55 씩 비킨다(나란한 관 사이 30 이상). 예전엔 싱크장 안 식세 콘센트 · 분배기 구동기 전원(30 차이)의 관이 붙었다 */
    const used = { floor: [] as P2[], ceil: [] as P2[] };
    const take = (lv: 'floor' | 'ceil', q: P2, step: P2): P2 => { for (let k = 0; k < 12 && used[lv].some((u) => len2(u, q) < 51); k++) q = [q[0] + step[0] * 55, q[1] + step[1] * 55]; used[lv].push(q); return q; };
    /** out = 박스에서 다음 박스로 나가는 관(진행 방향으로 45 옆), 아니면 들어오는 관. 이미 쓴 자리와 가까우면 나가는 관은 진행 방향으로, 들어오는 관은 반대로 비킨다
     *  (거꾸로 비키면 다음 차선이 들어온 관 위를 되돌아가 겹쳤다). travel = 슬래브 속 진행 방향(평면) */
    const riser = (e: V3, y: number, lv: 'floor' | 'ceil', out: boolean, travel: P2 | null, island = false): V3[] => {
      // 아일랜드 기기는 그 자리에서 바닥으로(뒤 벽 650 규칙은 벽 줄 장 안 기기만 — 아일랜드 식세 콘센트가 통로를 가로질러 벽으로 갔다)
      const w = island ? null : wallBehind(d, e, 150) ?? (e[1] < 950 ? wallBehind(d, e, 650) : null);
      // 들어오는 관 · 나가는 관 모두 진행 방향으로 비킨다 — 같은 자리 두 기기(세탁기 · 건조기 콘센트)에서 거꾸로 비키면 다음 길이 되돌아가 겹쳤다
      const step = (v: P2): P2 => { const k = travel && v[0] * travel[0] + v[1] * travel[1] < 0 ? -1 : 1; return [v[0] * k, v[1] * k]; };
      if (w) { const st = step([-w.n[1], w.n[0]]), sl = out ? 45 : 0, q = take(lv, [w.p[0] - w.n[0] * A.wallIn + st[0] * sl, w.p[1] - w.n[1] * A.wallIn + st[1] * sl], st); return [e, [q[0], e[1], q[1]], [q[0], y, q[1]]]; }
      const st = step(travel ?? [1, 0]), sl = out ? 45 : 0, q = take(lv, [e[0] + st[0] * sl, e[2] + st[1] * sl], st);
      return Math.abs(q[0] - e[0]) < 0.5 && Math.abs(q[1] - e[2]) < 0.5 ? [e, [e[0], y, e[2]]] : [e, [q[0], e[1], q[1]], [q[0], y, q[1]]];
    };
    /** 둘레 자리 s 에서 s 가 커지는 쪽 평면 방향 */
    const dirAt = (sv: number): P2 => { const a = lanePt(sv, 0, 0), b = lanePt(sv + 1, 0, 0), L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / L, (b[2] - a[2]) / L]; };
    /** 둘레 자리 s 의 차선 점(벽에서 inset) — 모서리로 당기지 않는다 */
    const lanePt = (sv: number, inset: number, y: number): V3 => {
      sv = norm(r, sv);
      const w = (sv >= o4[3] ? 3 : sv >= o4[2] ? 2 : sv >= o4[1] ? 1 : 0) as WallId, q = wallPoint(r, w, sv - o4[w], inset);
      return [q[0], y, q[1]];
    };
    /** 슬래브 속 가로 구간을 직각으로 — 두 축이 다 바뀌는 구간엔 많이 바뀌는 축부터 꺾는 점을 넣는다(모서리 가까운 기기에서 차선 점이 모서리로 당겨질 때) */
    const ortho = (pts: V3[]): V3[] => pts.flatMap((b, i) => {
      const a = pts[i - 1];
      if (!a || Math.abs(a[1] - b[1]) > 0.5 || Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[2] - b[2]) < 0.5) return [b];
      return Math.abs(b[2] - a[2]) >= Math.abs(b[0] - a[0]) ? [[a[0], b[1], b[2]] as V3, b] : [[b[0], b[1], a[2]] as V3, b];
    });
    /** 슬래브 속 길 끝 — 오르내림 꼭대기(top) 자리로 다시 잡은 길 끝(벽 너머 공간은 그 안 ㄷ자 위 자리, 그 밖은 부엌 둘레에 내린 자리) */
    const endAt = (port: Port, top: V3): Port => {
      if (port.ru) { const at = polyProj(port.ru.pts, [top[0], top[2]]); return { p: top, s: port.s, pre: port.pre.length ? [polyAt(port.ru.pts, at), ...port.pre.slice(1)] : [], room: port.room, ru: { pts: port.ru.pts, at } }; }
      if (port.pre.length) return { p: top, s: port.s, pre: port.pre };
      return { p: top, s: projS(top[0], top[2]), pre: [] };
    };
    // 회로 목록
    type Circ = { name: string; sub: 'dedicated' | 'general'; level: 'floor' | 'ceil'; loads: Load[]; dir: 1 | -1 };
    const circs: Circ[] = [];
    const panelS = ports.panel.s ?? projS(pp[0], pp[2]);
    for (const l of loads.filter((x) => x.sub === 'dedicated')) circs.push({ name: `${l.label} 전용 회로`, sub: 'dedicated', level: levelOf(l), loads: [l], dir: perimRoute(d, panelS, l.port.s ?? projS(l.port.p[0], l.port.p[2])).dir });
    const groups = new Map<string, { level: 'floor' | 'ceil'; group: string; ls: Load[] }>();
    for (const l of loads.filter((x) => x.sub === 'general')) {
      const lv = levelOf(l), k = `${l.group}|${lv}`;
      (groups.get(k) ?? groups.set(k, { level: lv, group: l.group, ls: [] }).get(k)!).ls.push(l);
    }
    for (const g of groups.values()) {
      // 둘레 방향마다 — 분전반에서 그 방향으로 가까운 순서
      const byDir = new Map<number, { l: Load; len: number }[]>();
      for (const l of g.ls) { const sl = l.port.s ?? projS(l.port.p[0], l.port.p[2]), pr = perimRoute(d, panelS, sl); (byDir.get(pr.dir) ?? byDir.set(pr.dir, []).get(pr.dir)!).push({ l, len: pr.len }); }
      const two = byDir.size > 1;
      // 같은 둘레 자리(같은 벽 너머 공간)끼리는 입구에서 가까운 순(공간 안 ㄷ자 위 거리)
      const fromExit = (l: Load) => (l.port.ru ? Math.min(l.port.ru.at, l.port.ru.pts.slice(1).reduce((a2, v, i2) => a2 + len2(l.port.ru!.pts[i2], v), 0) - l.port.ru.at) : 0);
      for (const xs of byDir.values()) xs.sort((a, b) => a.len - b.len || fromExit(a.l) - fromExit(b.l));
      for (const [dir, xs] of byDir) circs.push({ name: `${g.group === '전등' ? '전등' : `${g.group} 콘센트`} 회로 · ${g.level === 'floor' ? '바닥' : '천장'}${two ? (dir > 0 ? ' 1' : ' 2') : ''}`, sub: 'general', level: g.level, loads: xs.map((x) => x.l), dir: dir as 1 | -1 });
    }
    // 차선 — 층마다 회로 순서대로 벽에서 120 + 45k. 벽 너머 공간 안은 그 공간 벽에서 20 + 45k(같은 공간으로 들어가는 회로끼리 겹치지 않게)
    const laneOf = new Map<Circ, number>();
    { const n = { floor: 0, ceil: 0 }; for (const c of circs) laneOf.set(c, n[c.level]++); }
    const inRoom = (l: Load, k: number): Port => {
      const o = l.port.ru ? d.openings.find((x) => x.id === l.port.room) : undefined, ln = o && wallLine(d, o.wall);
      if (!o || !ln) return l.port;
      const p = l.port.p, t = (p[0] - ln.o[0]) * ln.dir[0] + (p[2] - ln.o[1]) * ln.dir[1], u = (p[0] - ln.o[0]) * ln.n[0] + (p[2] - ln.o[1]) * ln.n[1];
      return roomPort(d, o, t, u, p[1], A.gasInset + 45 * k) ?? l.port;
    };
    // 벽 너머 공간으로 들어가는 관이 부엌 벽을 뚫는 자리 — 먼저 잡아 두어 다른 기기의 오르내림이 그 줄에 서지 않게
    for (const c of circs) for (const l of c.loads) if (l.port.ru) { const pr = inRoom(l, laneOf.get(c)!); if (pr.s != null) { const q = lanePt(pr.s, -A.wallIn, 0); used[c.level].push([q[0], q[2]]); } }
    // 분전반 — 회로마다 55 씩 옆으로 벽 속에서 오르내림(7개 넘으면 한 줄 안쪽). 모든 회로 자리를 먼저 잡아 두어 기기 쪽 오르내림이 그 옆에 서지 않게
    const sides = circs.map((c, i) => {
      const off = ((i % 7) - 3) * 55, dep = A.wallIn + (Math.floor(i / 7) % 2) * 55;
      const inw: V3 = [pp[0] - pn[0] * dep, pp[1], pp[2] - pn[1] * dep], side: V3 = [inw[0] + pal[0] * off, pp[1], inw[2] + pal[1] * off];
      used[c.level].push([side[0], side[2]]);
      return { inw, side };
    });
    for (const [ci, c] of circs.entries()) {
      const y = yOf(c.level), inset = 120 + 45 * laneOf.get(c)!;
      const { inw, side } = sides[ci], top: V3 = [side[0], y, side[2]];
      let from: { pts: V3[]; port: Port } = { pts: [pp, inw, side, top], port: endAt(ports.panel, top) };
      for (const l0 of c.loads) {
        const l: Load = l0.port.ru ? { ...l0, port: inRoom(l0, laneOf.get(c)!) } : l0;
        const sl = l.port.ru ? null : projS(l.port.p[0], l.port.p[2]), dv = sl != null ? dirAt(sl) : null;
        // 벽 너머 공간 안 — 입구 쪽 모서리에서 안쪽으로(ㄷ자 위 자리가 커지는 쪽이 안쪽이면 +)
        let travel: P2 | null = dv ? [dv[0] * c.dir, dv[1] * c.dir] : null;
        if (l.port.ru) { const U = l.port.ru.pts, at = l.port.ru.at, total = U.slice(1).reduce((a2, v, i2) => a2 + len2(U[i2], v), 0), a0 = polyAt(U, at), a1 = polyAt(U, Math.min(total, at + 1)), L1 = len2(a0, a1) || 1, inward = at <= total - at ? 1 : -1; travel = [(a1[0] - a0[0]) / L1 * inward, (a1[1] - a0[1]) / L1 * inward]; }
        const up = riser(l.port.p, y, c.level, false, travel, l.island), to = endAt(l.port, up[up.length - 1]);
        const plan = wallPath(d, from.port, to, inset).map((q): V3 => [q[0], y, q[1]]);
        // 차선 끝점은 기기 자리 그대로(모서리 가까운 기기는 둘레 점이 모서리로 당겨져 들어온 관 · 나간 관이 같은 차선을 겹쳐 갔다)
        if (plan.length && !from.port.pre.length) plan[0] = lanePt(from.port.s!, inset, y);
        if (plan.length && !to.pre.length) plan[plan.length - 1] = lanePt(to.s!, inset, y);
        run('power', c.sub, ortho([...from.pts, ...plan, ...up.slice().reverse()]), l.label, conduit(l.label, c.sub), c.name);
        const out = riser(l.port.p, y, c.level, true, travel, l.island);
        from = { pts: out, port: endAt(l.port, out[out.length - 1]) };
      }
    }
  }
  /* 가스관 ↔ 전기 설비 이격 — 배관 이음부와 전기계량기 · 개폐기 60cm, 점멸기 · 접속기(콘센트) 30cm(15cm 로 줄이는 개정안 있음). KGS FU551 관련 논문 · 원문 미확인.
   *  이음부 자리를 따로 두지 않아 관 전체로 본다(보수적) */
  const gasRuns = runs.filter((x) => x.sys === 'gas');
  if (gasRuns.length) {
    const sd = (p: V3, a: V3, b: V3) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, k = L2 ? clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2, 0, 1) : 0; return Math.hypot(ap[0] - ab[0] * k, ap[1] - ab[1] * k, ap[2] - ab[2] * k); };
    const near = (p: V3, half: number) => Math.min(...gasRuns.flatMap((x) => x.pts.slice(1).map((b, i) => sd(p, x.pts[i], b)))) - half;
    const pg = near(IN.panel.p, MEP_SIZE.inlet.panel.w / 2);
    if (pg < 600) checks.push({ level: 'warn', sys: 'gas', text: `가스관이 분전반에서 ${Math.max(0, Math.round(pg / 10))}cm — 전기계량기 · 개폐기와 60cm 이상 띄웁니다(KGS FU551 배관 이음부 기준) · 확인 필요`, at: xz(IN.panel.p) });
    const outs = [...outlets.map((o) => o.p), ...nodes.filter((x) => x.kind === 'outlet' || x.kind === 'dedicated').map((x) => x.p)].filter((q) => near(q, MEP_SIZE.outlet.w / 2) < 300);
    if (outs.length) checks.push({ level: 'warn', sys: 'gas', text: `가스관이 콘센트 ${new Set(outs.map((q) => q.map(Math.round).join())).size}곳에서 30cm 안 — 점멸기 · 콘센트와 30cm 이상 띄웁니다(15cm 로 줄이는 개정안 있음 · KGS FU551 확인) · 확인 필요`, at: xz(outs[0]) });
  }
  /* 확인 — 배수 기울기 · 전용 회로 · 아일랜드 바닥 경로 */
  for (const rr of runs) {
    if (rr.sys !== 'drain') continue;
    const fl = floorLen(rr.pts), drop = fl * A.drainSlope;
    if (drop > A.floorRoom) checks.push({ level: 'warn', sys: 'drain', text: `배수(${rr.to}) 바닥 속 ${(fl / 1000).toFixed(1)}m — 기울기 1/50 이면 ${Math.round(drop)}mm 낮아져야 합니다(바닥 속 여유 ${A.floorRoom}mm 가정) · 확인 필요`, at: xz(rr.pts[0]) });
  }
  const ded = [hob && !gasHob ? `쿡탑(${hobKind})` : '', oven ? '오븐' : '', dish ? '식기세척기' : ''].filter(Boolean);
  if (ded.length) checks.push({ level: 'info', sys: 'power', text: `전용 회로 필요 — ${ded.join(' · ')}(고출력 기기는 회로를 따로)` });
  if (islandFloor.length) checks.push({ level: 'warn', sys: 'drain', text: `바닥을 가로지르는 배관 · 배선(${[...new Set(islandFloor)].join(' · ')}) — 골조 단계에서 배관 홈이 필요하고 바닥 난방관 위로 지나가야 합니다 · 확인 필요`, at: isl ? [isl.cx, isl.cz] : undefined });
  return { runs, nodes, inlets, outlets, checks };
}
