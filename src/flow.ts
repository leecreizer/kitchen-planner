// 동선 정보 — 평면도에 겹쳐 그린다(사용자 2026-11-06 「구간 거리 · 통로 폭 · 이동 경로 다 보여줘」).
//  ① 작업 삼각형(싱크 · 쿡탑 · 냉장고) 변 길이 — 권장 각 변 1,200~2,700 · 합 4,000~7,900(NKBA 4~9ft · 26ft)
//  ② 통로 폭 — 상판 · 아일랜드 · 키큰장 사이, 앞에 아무것도 없으면 벽까지 빈 간격. 기준(clearOf)으로 판정:
//     장 앞면이 마주 보는 통로(정면 장 ↔ 아일랜드 · 마주 보는 줄 · 장 앞 ↔ 벽)는 작업 통로(기본 1,200), 아일랜드 끝 같은 옆면 통로는 끝 통로(기본 900).
//     끝 통로보다 좁으면 좁음(빨강), 그 통로 기준보다 좁으면 모자람(주황)
//  ③ 이동 경로 — 거실 입구 → 냉장고(꺼내기) → 싱크(씻기) → 쿡탑(조리). 장 · 아일랜드를 피해 걷는 길(격자 100mm, 사람 반지름 200)
//  ④ 상판 여유 — 쿡탑 양옆 · 싱크볼 좌우(clearance.ts)
import { BASE_D, type Candidate, type Frame } from './autoplan';
import { sideGaps, type SideGap } from './clearance';
import { clearOf, livingOf, wallFrame, wallLength, type Design, type WallId } from './plan';

export type Pt = [number, number];
export interface Leg { a: Pt; b: Pt; len: number; ok: boolean }
/** 통로 — need = 그 통로의 기준(작업 통로 · 끝 통로), wall = 벽까지 잰 것 */
export interface Aisle { a: Pt; b: Pt; w: number; need: number; wall?: boolean; grade: 'narrow' | 'walk' | 'work' }
export interface FlowInfo {
  legs: Leg[]; triTotal: number; triOk: boolean;
  aisles: Aisle[]; minAisle: number | null;
  path: Pt[]; pathLen: number; stops: { p: Pt; label: string }[]; blocked: boolean;
  sides: SideGap[];
}

const LEG = [1200, 2700] as const, TRI = [4000, 7900] as const;
const CELL = 100, BODY = 200;
/** ax = 앞면이 향한 축(장 앞면 · 아일랜드 앞뒤가 그 축 방향 통로를 만든다). 벽은 null. isl = 아일랜드 상판 */
type Rect = { x0: number; z0: number; x1: number; z1: number; ax: 'x' | 'z' | null; isl?: boolean };

const P = (f: Frame, t: number, u: number): Pt => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
function rectOf(f: Frame, t0: number, t1: number, u0: number, u1: number): Rect {
  const ps = [P(f, t0, u0), P(f, t1, u0), P(f, t1, u1), P(f, t0, u1)];
  return { x0: Math.min(...ps.map((p) => p[0])), z0: Math.min(...ps.map((p) => p[1])), x1: Math.max(...ps.map((p) => p[0])), z1: Math.max(...ps.map((p) => p[1])), ax: Math.abs(f.n[0]) > 0.5 ? 'x' : 'z' };
}
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 바닥을 막는 것 — 상판(아일랜드 포함) · 키큰장 · 냉장고 자리 */
function obstacles(c: Candidate): Rect[] {
  const out = c.counters.map((k) => ({ ...rectOf(k.frame, k.t0, k.t1, k.z0, k.z1), ...(k.island ? { isl: true } : {}) }));
  for (const it of c.items) if (it.level === 'tall' || it.key === 'fridge' || it.key === 'pantryCorner') out.push(rectOf(it.frame, it.t, it.t + it.w, 0, it.key === 'pantryCorner' ? 1000 : it.key === 'fridge' ? 720 : BASE_D));
  return out;
}
/** 벽 — 방 안쪽 면 바깥 두께 100. 트인 벽은 날개벽 자리만 */
function wallRects(d: Design): Rect[] {
  const out: Rect[] = [];
  for (const w of [0, 1, 2, 3] as WallId[]) {
    const f = wallFrame(d.room, w) as Frame, L = wallLength(d.room, w);
    const segs = w === d.openWall ? [[0, d.wing.a], [L - d.wing.b, L]] : [[0, L]];
    for (const [a, b] of segs) if (b - a > 1) out.push({ ...rectOf(f, a, b, -100, 0), ax: null });
  }
  return out;
}

const gradeOf = (w: number, need: number, end: number): Aisle['grade'] => (w < end ? 'narrow' : w < need ? 'walk' : 'work');

/** 통로 — 각 상판 · 장 면에서 바깥쪽으로 가장 가까운 다른 면까지(투영이 300 이상 겹칠 때). 300 미만(붙어 있음) · 2,500 넘음(트인 공간)은 뺀다.
 *  벽은 장 · 아일랜드 앞에 다른 것이 없을 때만(장 끝과 옆 벽 사이 틈은 통로가 아니다 — 앞면 축 방향만) */
function aislesOf(rs: Rect[], walls: Rect[], front: number, end: number): Aisle[] {
  const out: Aisle[] = [], seen = new Set<string>();
  const add = (a: Pt, b: Pt, w: number, need: number, wall: boolean) => {
    const k = [a, b].map((p) => p.map((v) => Math.round(v / 50)).join(':')).sort().join('|');
    if (seen.has(k)) return; seen.add(k);
    out.push({ a, b, w, need, ...(wall ? { wall } : {}), grade: gradeOf(w, need, end) });
  };
  const all = [...rs, ...walls];
  all.forEach((A, i) => all.forEach((B, j) => {
    if (i === j || (A.ax == null && B.ax == null)) return;
    // 벽과는 앞면 축으로만 — 장 앞 ↔ 벽(작업 통로). 장 끝 ↔ 옆 벽은 통로가 아니다
    const toWall = A.ax == null || B.ax == null;
    // x 방향(A 의 오른쪽 면 → B 의 왼쪽 면) · z 방향(A 의 아래 면 → B 의 위 면)
    const ox0 = Math.max(A.x0, B.x0), ox1 = Math.min(A.x1, B.x1), oz0 = Math.max(A.z0, B.z0), oz1 = Math.min(A.z1, B.z1);
    for (const ax of ['x', 'z'] as const) {
      if (toWall && (A.ax ?? B.ax) !== ax) continue;
      const over = ax === 'x' ? oz1 - oz0 : ox1 - ox0, g = ax === 'x' ? B.x0 - A.x1 : B.z0 - A.z1;
      if (over < 300 || g < 300 || g > 2500) continue;
      // 사이에 다른 것이 끼어 있으면 그 쪽이 가장 가까운 면이다
      const between = all.some((C, k) => k !== i && k !== j && (ax === 'x'
        ? C.x0 >= A.x1 && C.x1 <= B.x0 && Math.min(C.z1, oz1) - Math.max(C.z0, oz0) > 0
        : C.z0 >= A.z1 && C.z1 <= B.z0 && Math.min(C.x1, ox1) - Math.max(C.x0, ox0) > 0));
      if (between) continue;
      // 어느 한쪽이라도 앞면이 이 축을 보면 작업 통로, 둘 다 옆면이면 끝 통로. 자동 배치와 같게 — 아일랜드 끝(옆면)이 낀 통로와
      //   아일랜드 ↔ 벽은 지나다니는 통로(끝 통로)
      const islEnd = (A.isl && A.ax !== ax) || (B.isl && B.ax !== ax);
      const need = toWall ? ((A.ax == null ? B : A).isl ? end : front) : islEnd ? end : A.ax === ax || B.ax === ax ? front : end;
      const m = ax === 'x' ? (oz0 + oz1) / 2 : (ox0 + ox1) / 2;
      if (ax === 'x') add([A.x1, m], [B.x0, m], Math.round(g), need, toWall); else add([m, A.z1], [m, B.z0], Math.round(g), need, toWall);
    }
  }));
  return out;
}

/** 걸을 수 있는 바닥 — 부엌 · 트인 쪽 통로 · 거실 */
function walkable(d: Design) {
  const r = d.room, ow = d.openWall;
  const f = ow != null ? wallFrame(r, ow) : null, L = ow != null ? wallLength(r, ow) : 0, lv = livingOf(d), T = 150;
  const inside = (x: number, z: number) => {
    if (x >= 0 && x <= r.w && z >= 0 && z <= r.d) return true;
    if (!f) return false;
    const t = (x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1], u = (x - f.o[0]) * f.n[0] + (z - f.o[1]) * f.n[1];
    if (u <= 0 && u >= -T && t >= d.wing.a && t <= L - d.wing.b) return true;          // 트인 벽 자리
    return u <= -T && u >= -T - lv.depth && t >= -lv.a && t <= L + lv.b;              // 거실
  };
  // 벽에서 사람 반지름만큼 떨어진 자리만
  return (x: number, z: number) => inside(x, z) && inside(x - 150, z) && inside(x + 150, z) && inside(x, z - 150) && inside(x, z + 150);
}

export function flowOf(d: Design, c: Candidate): FlowInfo {
  // ① 작업 삼각형
  const tri: [Pt | undefined, Pt | undefined][] = [[c.sink, c.hob], [c.hob, c.fridge], [c.fridge, c.sink]];
  const legs: Leg[] = tri.filter((x): x is [Pt, Pt] => !!x[0] && !!x[1]).map(([a, b]) => { const len = Math.round(dist(a, b) / 10) * 10; return { a, b, len, ok: len >= LEG[0] && len <= LEG[1] }; });
  const triTotal = legs.length === 3 ? legs.reduce((s, l) => s + l.len, 0) : 0;
  // ② 통로 — 기준은 오른쪽 패널(clearOf)
  const cl = clearOf(d);
  const rs = obstacles(c);
  const aisles = aislesOf(rs, wallRects(d), cl.front, cl.end);
  // ③ 이동 경로 — 격자 A*
  const free = walkable(d);
  const blockedAt = (x: number, z: number) => !free(x, z) || rs.some((q) => x > q.x0 - BODY && x < q.x1 + BODY && z > q.z0 - BODY && z < q.z1 + BODY);
  const r = d.room, lv = livingOf(d);
  const pad = lv.depth + Math.max(lv.a, lv.b) + 600;
  const gx0 = -pad, gz0 = -pad, nx = Math.ceil((r.w + 2 * pad) / CELL), nz = Math.ceil((r.d + 2 * pad) / CELL);
  const ix = (x: number) => Math.round((x - gx0) / CELL), iz = (z: number) => Math.round((z - gz0) / CELL);
  const cx = (i: number) => gx0 + i * CELL, cz = (j: number) => gz0 + j * CELL;
  const block = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) block[j * nx + i] = blockedAt(cx(i), cz(j)) ? 1 : 0;
  const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nz && !block[j * nx + i];
  /** 그 점에서 가장 가까운 설 자리(장 앞) */
  const stand = (p: Pt): [number, number] | null => {
    const i0 = ix(p[0]), j0 = iz(p[1]);
    for (let rr = 0; rr < 30; rr++) {
      let best: [number, number] | null = null, bd = Infinity;
      for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rr || !ok(i0 + di, j0 + dj)) continue;
        const dd = di * di + dj * dj; if (dd < bd) { bd = dd; best = [i0 + di, j0 + dj]; }
      }
      if (best) return best;
    }
    return null;
  };
  const astar = (s: [number, number], g: [number, number]): [number, number][] | null => {
    const N = nx * nz, gs = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (i: number, j: number) => { const dx = Math.abs(i - g[0]), dz = Math.abs(j - g[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
    const open: [number, number][] = [[s[1] * nx + s[0], h(s[0], s[1])]];
    gs[s[1] * nx + s[0]] = 0;
    while (open.length) {
      let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][1] < open[bi][1]) bi = k;
      const [cur] = open.splice(bi, 1)[0];
      if (closed[cur]) continue; closed[cur] = 1;
      const i = cur % nx, j = (cur - i) / nx;
      if (i === g[0] && j === g[1]) { const out: [number, number][] = []; for (let k = cur; k >= 0; k = from[k]) out.push([k % nx, Math.floor(k / nx)]); return out.reverse(); }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = i + di, b = j + dj; if (!ok(a, b) || (di && dj && (!ok(i + di, j) || !ok(i, j + dj)))) continue;
        const n = b * nx + a, ng = gs[cur] + (di && dj ? 1.414 : 1);
        if (ng < gs[n]) { gs[n] = ng; from[n] = cur; open.push([n, ng + h(a, b)]); }
      }
    }
    return null;
  };
  /** 격자 길 → 꺾이는 곳만(가리는 것 없이 곧게 갈 수 있으면 건너뛴다) */
  const sight = (a: Pt, b: Pt) => { const n = Math.ceil(dist(a, b) / 50); for (let k = 1; k < n; k++) { const t = k / n; if (blockedAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false; } return true; };
  const smooth = (ps: Pt[]) => { if (ps.length < 3) return ps; const out = [ps[0]]; let k = 0; while (k < ps.length - 1) { let m = ps.length - 1; while (m > k + 1 && !sight(ps[k], ps[m])) m--; out.push(ps[m]); k = m; } return out; };

  const stops: { p: Pt; label: string }[] = [];
  const f = d.openWall != null ? wallFrame(r, d.openWall) : null, L = d.openWall != null ? wallLength(r, d.openWall) : 0;
  if (f) stops.push({ p: [f.o[0] + f.dir[0] * L / 2 - f.n[0] * (150 + Math.min(900, lv.depth / 2)), f.o[1] + f.dir[1] * L / 2 - f.n[1] * (150 + Math.min(900, lv.depth / 2))], label: '거실' });
  if (c.fridge) stops.push({ p: c.fridge, label: '냉장고' });
  if (c.sink) stops.push({ p: c.sink, label: '싱크' });
  if (c.hob) stops.push({ p: c.hob, label: '쿡탑' });
  const cells = stops.map((s) => stand(s.p));
  const path: Pt[] = []; let blocked = false;
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = cells[k], b = cells[k + 1];
    const seg = a && b ? astar(a, b) : null;
    const pts: Pt[] = seg ? smooth(seg.map(([i, j]) => [cx(i), cz(j)] as Pt)) : (blocked = true, [a ? [cx(a[0]), cz(a[1])] as Pt : stops[k].p, b ? [cx(b[0]), cz(b[1])] as Pt : stops[k + 1].p]);
    path.push(...(path.length ? pts.slice(1) : pts));
  }
  const pathLen = Math.round(path.reduce((s, p, k) => (k ? s + dist(path[k - 1], p) : 0), 0) / 10) * 10;
  return {
    legs, triTotal, triOk: legs.every((l) => l.ok) && triTotal >= TRI[0] && triTotal <= TRI[1],
    aisles, minAisle: aisles.length ? Math.min(...aisles.map((a) => a.w)) : null,
    path, pathLen, stops: stops.map((s, k) => ({ p: cells[k] ? [cx(cells[k]![0]), cz(cells[k]![1])] : s.p, label: s.label })), blocked,
    sides: sideGaps(d, c),
  };
}
