// 자동 배치 — 공간 · 공간 요소 · 공간 구조 · 스타일을 받아 배치안 여러 개를 만들고 점수를 매겨 고른다.
//
// 순서: ① 공간 구조별로 장을 놓을 벽 후보 → ② 벽마다 장 구간(코너 · 문 · 통로 · 창 피하기) → ③ 기능 위치(싱크 · 쿡탑 · 냉장고)
//       변형 → ④ 구간을 원본 모듈 폭으로 채우기(남는 폭은 휠라) → ⑤ 상부장 · 키큰장 · 선반 · 아일랜드 → ⑥ 점수(작업 삼각형 ·
//       조리 공간 · 수납 · 채광 · 동선)와 설명.
// 모든 길이 mm. 모듈 폭 선택지는 원본 W 변수(catalog.modules[].W)를 따른다.
import type { KitchenCatalog, ModuleDef, Series } from './kjlLib';
import { byPriority, nudge, rowGroup } from './reorder';
import { applianceOf, hoodKindOf } from './catalog';
import {
  OPENING_INFO, nextWall, prevWall, viewWalls, wallFrame, wallLength, wallName, wallPoint,
  WANT_LABEL, type Design, type LayoutKind, type Opening, type Room, type StyleKind, type WallId, ISLAND_TABLE, type IslandStyle,
} from './plan';

export interface Frame { o: [number, number]; dir: [number, number]; n: [number, number] }
export type Level = 'base' | 'wall' | 'tall' | 'shelf';
export interface Item {
  key: string; level: Level; frame: Frame; t: number; w: number;
  /** 바닥에서 위로 (선반 · 상부장) — 없으면 층의 기본 높이 */
  y?: number;
  tag?: 'sink' | 'hob' | 'fridge' | 'dish' | 'island' | 'ep' | 'fix';
  wall?: WallId;
  /** 원본 변수 덮어쓰기 (비규격 높이 · 폭 등) */
  ov?: Record<string, string>;
  /** 로봇청소기장 — 하부장 아래 걸레받이 자리를 로봇청소기 대기 공간으로(걸레받이 빼고 안쪽 마감 · 기기 · 충전대) */
  robot?: boolean;
}
/** 상판 — 프레임 기준 t 구간 · 뒤(0)에서 앞쪽으로 z0~z1 */
export interface Counter { frame: Frame; t0: number; t1: number; z0: number; z1: number; island?: boolean }
export interface Splash { frame: Frame; t0: number; t1: number }
export interface Candidate {
  id: string; title: string; layout: LayoutKind; walls: WallId[];
  items: Item[]; counters: Counter[]; splashes: Splash[];
  sink?: [number, number]; hob?: [number, number]; fridge?: [number, number];
  island?: IslandInfo;
  /** 벽 코너에서 코너장 깊이만큼 비우고 시작한 줄 끝 (걸레받이 · 서라운딩을 옆 줄까지 이을 때) */
  skips?: { wall: WallId; end: 0 | 1 }[];
  score: number; metrics: Record<string, number>; reasons: string[]; warnings: string[];
}

export const BASE_D = 600, WALL_D = 340, COUNTER_D = 620;
/** 코너장 틀 깊이 — 몸통 600 + 휠라 꺾임판(도어 면에서 50 앞으로). 코너장이 선 코너는 옆 줄을 이만큼 비운다(600 이면 꺾임판과 옆 장이 겹쳤다) */
export const CORNER_D = 650;
const CORNER_W = 1000, WCORNER_W = 700;
/** 도어 앞면 깊이(벽에서) — 키큰장 · 냉장고 윗장 593 · 상부장 343 (원본 몸통 570 · 320 + 도어 23). EP 를 이 면에 맞춘다 */
const TALL_FRONT = 593, WALL_FRONT = 343;

/* ───────── 모듈 폭 ───────── */
export function widthsOf(m: ModuleDef | undefined): number[] {
  if (!m?.W) return [];
  if (m.W.options?.length) return m.W.options;
  if (m.W.min != null && m.W.max != null) { const o: number[] = []; for (let x = Math.ceil(m.W.min / 50) * 50; x <= m.W.max; x += 50) o.push(x); return o; }
  return m.W.value ? [Number(m.W.value)] : [];
}

type Mods = (key: string) => ModuleDef | undefined;

/* ───────── 벽 구간 ───────── */
interface Run {
  wall: WallId; frame: Frame; L: number;
  a: number; b: number; wa: number; wb: number;
  cornerStart?: 'cab' | 'skip'; cornerEnd?: 'cab' | 'skip';
  /** 코너에 냉장고장 — 그 끝은 옆 줄이 냉장고 깊이만큼 비운다(코너장 · 코너 상판 없음) */
  fridgeCornerStart?: boolean; fridgeCornerEnd?: boolean;
  /** 옆 벽 냉장고 — 코너는 정면(맡은) 줄이 코너장으로 채우고, 냉장고 묶음은 이 줄의 비운 코너 바로 뒤(코너장 막힌 쪽 앞)에 선다 */
  fridgeAfterCornerStart?: boolean; fridgeAfterCornerEnd?: boolean;
  /** 코너장을 코너 쪽에서 더 띄우는 폭 — 옆 줄 냉장고(깊이 700 + EP)가 코너장 도어 앞을 막지 않게 */
  cornerGapStart?: number; cornerGapEnd?: number;
  /** 상부 코너장 없이 상부장을 옆 줄 냉장고 윗장 앞에서 끊음 (wa · wb 까지) */
  noWallCornerStart?: boolean; noWallCornerEnd?: boolean;
  /** 코너 팬트리장(원본 EO T코너팬트리 1000×1000 ㄱ자 키큰장) — 이 줄 끝(pantryEnd)에 서고 다음 줄 시작(pantryStart)을 같이 차지 */
  pantryEnd?: boolean; pantryStart?: boolean;
}
/** 코너 팬트리장 — 두 벽 각각 1000 + EP 20 */
export const PANTRY_W = 1000;
const frameOf = (r: Room, w: WallId): Frame => { const f = wallFrame(r, w); return { o: f.o as [number, number], dir: f.dir as [number, number], n: f.n as [number, number] }; };

function makeRuns(room: Room, walls: WallId[], openings: Opening[] = [], notes: string[] = [], fridgeAt?: Design['fridgeAt'], openWall?: WallId | null, fridgeD = 720, pantry = false, runLen?: Design['runLen']): Run[] {
  const front = viewWalls(openWall).front;
  const viewName = (w: WallId) => wallName(openWall, w);
  const set = new Set(walls);
  const runs = new Map<WallId, Run>();
  for (const w of walls) {
    const L = wallLength(room, w);
    runs.set(w, { wall: w, frame: frameOf(room, w), L, a: 0, b: L, wa: 0, wb: L });
  }
  let pantryLeft = pantry;
  for (const w of walls) {
    const n = nextWall(w);
    if (!set.has(n)) continue;
    const A = runs.get(w)!, B = runs.get(n)!;
    // 냉장고장을 이 코너 쪽 끝으로 골랐으면 — 냉장고가 코너에 서고 옆 줄은 냉장고 깊이(+EP)만큼 비움 (빌트인 냉장고장은 장 깊이 600 + EP)
    const FD = fridgeD;
    // 코너는 정면 벽 줄이 맡는다(정면장 우선) — 정면이 아닌 코너만 긴 벽 쪽. 옆 벽은 코너 깊이만큼 비우고 시작
    const onA = A.wall === front ? true : B.wall === front ? false : A.L >= B.L;
    // 냉장고장을 이 코너 쪽 끝으로 골랐으면 —
    //  · 코너를 맡은 줄(정면)이면 냉장고가 코너에 서고 옆 줄은 냉장고 깊이(+EP)만큼 비움
    //  · 옆 줄이면 코너는 그대로 정면 줄 코너장, 냉장고는 옆 줄의 비운 코너 바로 뒤 (정면 배치 → 코너장 → 측면, 사용자 원칙)
    //    예전엔 옆 줄이어도 냉장고가 코너를 차지해 정면 줄이 720 앞에서 끊겼다
    const fA = !!fridgeAt && fridgeAt.wall === A.wall && fridgeAt.end === 'end', fB = !!fridgeAt && fridgeAt.wall === B.wall && fridgeAt.end === 'start';
    if (fA && onA) { B.cornerStart = 'skip'; B.a = FD; B.wa = FD; B.fridgeCornerStart = true; A.fridgeCornerEnd = true; continue; }
    if (fB && !onA) { A.cornerEnd = 'skip'; A.b = A.L - FD; A.wb = A.L - FD; A.fridgeCornerEnd = true; B.fridgeCornerStart = true; continue; }
    if (fB) { B.fridgeAfterCornerStart = true; A.cornerGapEnd = Math.max(0, FD - BASE_D); A.noWallCornerEnd = true; A.wb = A.L - FD; }
    if (fA) { A.fridgeAfterCornerEnd = true; B.cornerGapStart = Math.max(0, FD - BASE_D); B.noWallCornerStart = true; B.wa = FD; }
    // 옆 벽이 코너에서 입구(다용도실 · 팬트리 · 서브주방 · 낮은 창)까지 짧으면(코너 깊이 + 장 하나 600 미만) 그쪽엔 장을 두지 않는다 —
    // 코너가 아니게 되므로 정면(맡은) 줄은 일반장으로 벽까지, 옆 줄은 입구 너머부터
    {
      const side = onA ? B : A, sb = blocks(openings, side.wall).base;
      const free = onA ? Math.min(side.L, ...sb.map(([c0]) => c0).filter((c0) => c0 >= 0)) : side.L - Math.max(0, ...sb.map(([, c1]) => c1).filter((c1) => c1 <= side.L));
      if (sb.length && free < BASE_D + 600) {
        if (onA) { B.a = Math.max(BASE_D, free); B.wa = Math.max(WALL_D, free); }
        else { A.b = Math.min(A.L - BASE_D, A.L - free); A.wb = Math.min(A.L - WALL_D, A.L - free); }
        const who = openings.filter((o) => o.wall === side.wall).map((o) => OPENING_INFO[o.kind].label);
        notes.push(`${viewName(side.wall)}은 코너에서 ${[...new Set(who)].join(' · ')}까지 ${Math.round(free)}mm 라 장을 두지 않고 ${viewName(onA ? A.wall : B.wall)} 장을 벽까지`);
        continue;
      }
    }
    // 코너 팬트리장 — 한 코너만. 두 벽 모두 코너에서 1020 이 문 · 창(키큰장 높이) 없이 비어 있고 남는 벽이 1200 이상일 때
    if (pantryLeft) {
      const tallHit = (r: Run, t0: number, t1: number) => { const b = blocks(openings, r.wall); return [...b.base, ...b.upper].some(([c0, c1]) => c1 > t0 && c0 < t1); };
      const PW = PANTRY_W + 20;
      if (!tallHit(A, A.L - PW, A.L) && !tallHit(B, 0, PW) && A.L - PW >= 1200 && B.L - PW >= 1200) {
        pantryLeft = false;
        A.pantryEnd = true; A.b = A.L - PW; A.wb = A.L - PW;
        // 옆 줄은 팬트리 깊이만큼 비우고 시작 — 코너 상판 규칙(skip)은 냉장고 코너와 같이 쓰지 않는다
        B.cornerStart = 'skip'; B.a = PW; B.wa = PW; B.pantryStart = true; B.fridgeCornerStart = true;
        notes.push(`${viewName(A.wall)}과 ${viewName(B.wall)} 코너에 코너 팬트리장 — 코너장 · 상부 코너장 대신 바닥부터 천장까지 수납`);
        continue;
      }
    }
    // 코너장 자리(코너장 폭 + 100)가 다용도실 · 서브주방 · 팬트리 입구 · 낮은 창과 겹치면 코너장을 빼고 일반장으로.
    // 코너 사각(깊이 600)은 막히지 않은 쪽 벽 줄이 일반장으로 채우고(앞이 트인 입구 쪽이라 문을 열 수 있다) 막힌 쪽은 그만큼 비운다
    const hit = (r: Run, t0: number, t1: number) => blocks(openings, r.wall).base.some(([c0, c1]) => c1 > t0 && c0 < t1);
    const span = CORNER_W + 100;
    const cabBlocked = onA ? hit(A, A.L - span, A.L) : hit(B, 0, span);
    if (!cabBlocked) {
      if (onA) { A.cornerEnd = 'cab'; B.cornerStart = 'skip'; B.a = CORNER_D; B.wa = WALL_D; }
      else { B.cornerStart = 'cab'; A.cornerEnd = 'skip'; A.b = A.L - CORNER_D; A.wb = A.L - WALL_D; }
      continue;
    }
    const aSq = !hit(A, A.L - BASE_D, A.L), bSq = !hit(B, 0, BASE_D);
    // 사각을 맡는 줄 — 코너장 자리가 막힌 쪽의 반대편이 먼저, 그쪽 사각도 막혔으면 이쪽
    const ownA = onA ? !bSq && aSq : aSq || !bSq;
    if (ownA) { B.cornerStart = 'skip'; B.a = BASE_D; B.wa = WALL_D; }
    else { A.cornerEnd = 'skip'; A.b = A.L - BASE_D; A.wb = A.L - WALL_D; }
    const [w0, w1] = onA ? [A.L - span, A.L] : [0, span];
    const who = openings.filter((o) => o.wall === (onA ? A.wall : B.wall) && o.t + o.w + 50 > w0 && o.t - 50 < w1).map((o) => OPENING_INFO[o.kind].label);
    const names = [...new Set(who)].join(' · '), last = names.charCodeAt(names.length - 1);
    const josa = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 ? '과' : '와';
    notes.push(`${names}${josa} 코너장 자리가 겹쳐 코너장을 빼고 일반장으로 채움`);
  }
  // 장 배치 길이 — 사용자가 준 길이(벽 끝에서)만큼만. 코너가 이어진 쪽이 기준이고 반대쪽(트인 끝)을 자른다. 잘린 끝은 벽이 아니라 EP 로 마감된다
  if (runLen) for (const w of walls) {
    const cfg = runLen[w], r = runs.get(w)!;
    if (!cfg?.len) continue;
    const cS = set.has(prevWall(w)), cE = set.has(nextWall(w));
    if (cS && cE) continue;                          // 양 끝이 코너 — 자를 쪽이 없다
    const fromEnd = cS ? false : cE ? true : cfg.from === 'end';
    if (!fromEnd) { const len = Math.max(r.a + 600, Math.min(r.L, cfg.len)); if (len < r.b) { r.b = len; r.wb = Math.min(r.wb, len); } }
    else { const len = Math.max(r.L - r.b + 600, Math.min(r.L, cfg.len)); if (r.L - len > r.a) { r.a = r.L - len; r.wa = Math.max(r.wa, r.L - len); } }
    if (r.b - r.a < r.L - 1) notes.push(`${viewName(w)} 장은 벽 ${r.L}mm 중 ${Math.round(fromEnd ? r.L - r.a : r.b)}mm 까지만 — 입력한 장 배치 길이`);
  }
  return walls.map((w) => runs.get(w)!);
}

/** 벽 구간에서 막힌 곳 — 문·통로는 위아래 전부, 창은 상부장·키큰장만(창대가 낮으면 하부장도) */
function blocks(op: Opening[], wall: WallId) {
  const base: [number, number][] = [], upper: [number, number][] = [];
  for (const o of op) {
    if (o.wall !== wall) continue;
    const span: [number, number] = [o.t - 50, o.t + o.w + 50];
    upper.push(span);
    if (o.kind !== 'window' || o.sill < 930) base.push(span);
  }
  return { base, upper };
}
function subtract(a: number, b: number, cut: [number, number][]): [number, number][] {
  let segs: [number, number][] = [[a, b]];
  for (const [c0, c1] of cut) {
    const next: [number, number][] = [];
    for (const [s0, s1] of segs) {
      if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
      if (c0 > s0) next.push([s0, c0]);
      if (c1 < s1) next.push([c1, s1]);
    }
    segs = next;
  }
  return segs.filter(([s0, s1]) => s1 - s0 >= 300);
}

/* ───────── 폭 채우기 (원본 폭 조합 + 휠라) ───────── */
function fillWidths(g: number, opts: number[], fill: number[]): number[] {
  if (g < 10) return [];
  const U = 10, n = Math.floor(g / U);
  // best[i] = 최소 조각 수로 i*10 을 만든 조합
  const best: (number[] | null)[] = new Array(n + 1).fill(null);
  best[0] = [];
  const all = [...new Set([...opts, ...fill])].sort((x, y) => y - x);
  for (let i = 1; i <= n; i++) {
    for (const w of all) {
      const k = w / U;
      if (k > i || !Number.isInteger(k)) continue;
      const p = best[i - k];
      if (!p) continue;
      const cost = p.length + 1 + (fill.includes(w) ? 3 : 0) + p.filter((x) => fill.includes(x)).length * 3;
      const cur = best[i];
      const cc = cur ? cur.length + cur.filter((x) => fill.includes(x)).length * 3 : Infinity;
      if (cost < cc) best[i] = [...p, w];
    }
  }
  for (let i = n; i >= 0; i--) if (best[i]) return best[i]!.slice().sort((x, y) => (fill.includes(x) ? 1 : 0) - (fill.includes(y) ? 1 : 0) || y - x);
  return [];
}

/** 틈 채우기 — 원본 규격 폭 조합 + 남는 폭은 가장 큰 조각을 비규격으로 늘려 흡수(maxOf 까지), 그래도 남으면 휠라 1개.
 *  fillMax 이하의 틈은 휠라 하나(원본 휠라는 비규격 50~150). 예전에는 남는 폭을 휠라로만 채워 휠라가 줄줄이 들어갔다 */
function fillGap(g: number, opts: number[], maxOf: (w: number) => number, fillMax = 150): number[] {
  if (g < 10) return [];
  if (g <= fillMax) return [g];
  const base = fillWidths(g, opts, []);
  const r = g - base.reduce((a, b) => a + b, 0);
  if (!r) return base;
  const order = base.map((w, i) => ({ w, i })).sort((a, b) => b.w - a.w);
  for (const { w, i } of order) if (w + r <= maxOf(w)) { base[i] = w + r; return base; }
  return [...base, r];
}

/* ───────── 스타일 ───────── */
const STYLE: Record<StyleKind, { label: string; uppers: 'full' | 'cafe'; talls: number; drawers: number; dish: boolean; oven: boolean }> = {
  basic: { label: '일반', uppers: 'full', talls: 1, drawers: 0.4, dish: true, oven: false },
  cafe: { label: '카페 스타일', uppers: 'cafe', talls: 0, drawers: 0.3, dish: true, oven: false },
  storage: { label: '수납 많이', uppers: 'full', talls: 3, drawers: 0.7, dish: true, oven: true },
};
export const STYLE_LABEL = Object.fromEntries(Object.entries(STYLE).map(([k, v]) => [k, v.label])) as Record<StyleKind, string>;

/* ───────── 한 안 만들기 ───────── */
interface Variant { walls: WallId[]; sinkRun: number; hobRun: number; fridgeEnd: 'start' | 'end'; fridgeRun: number; sinkAtWindow: boolean; flip: boolean; pantry?: boolean }

/** 쿡탑 조리장 폭 — 기본 900, 줄이 짧으면 차례로 줄인다. 600 은 1도어(쿡탑 기기 폭) */
const HOB_W = [900, 800, 700, 600];
/** 고른 쿡탑(가전 카탈로그) 폭이 들어갈 최소 조리장 폭 — 650 이하 600 · 800 이하 800 · 그 이상 900 */
const hobMinW = (d: Design) => { const w = applianceOf('hob', d.appliance?.hob)?.size?.[0] ?? 600; return w <= 650 ? 600 : w <= 800 ? 800 : 900; };
const hobKey = (w: number) => (w >= 700 ? 'cook2' : 'cook1');
/** 냉장고 종류별 크기 — 삼성 비스포크 상품 실측(폭 × 높이 × 깊이, mm). 기기는 kitchen3d bespokeFridge 가 직접 그린다(n = 대수). 자리 폭 = 기기 + 양옆 틈, 자리 높이 = 기기 + 위 틈 27(냉장고 윗장 밑선),
 *  줄 깊이 = 기기 깊이 + 뒤 틈(옆 줄을 그만큼 비운다). 빌트인(원본 T콤비 fridgeTall)은 원본 모델 크기를 그대로 쓴다 */
export const FRIDGE_SPEC = {
  twin: { label: '1도어 2대', n: 2, unitW: 595, h: 1853, d: 688, w: 1200 }, // 비스포크 1도어 SRB000269 · 270
  sbs: { label: '양문형', n: 1, unitW: 1044, h: 2083, d: 694, w: 1100 },             // 양문형 SRB000285
  // 4도어 — 가전 카탈로그 「삼성 비스포크 냉장고 4도어」 912×683×1853
  quad: { label: '4도어', n: 1, unitW: 912, h: 1853, d: 683, w: 960 },
} as const;
export type FridgeSpec = (typeof FRIDGE_SPEC)[keyof typeof FRIDGE_SPEC];
export const fridgeSpec = (d: Pick<Design, 'fridgeKind'>): FridgeSpec => (d.fridgeKind === 'sbs' ? FRIDGE_SPEC.sbs : d.fridgeKind === 'quad' ? FRIDGE_SPEC.quad : FRIDGE_SPEC.twin);
export const FRIDGE_GAP_TOP = 27, FRIDGE_GAP_BACK = 32;
/** 냉장고 윗장이 이보다 낮으면 넣지 않는다(양문형 · 낮은 천장 — 위는 서라운딩이 막는다) */
const FRIDGE_TOP_MIN = 150;
/** 상부장 윗선 — 상판 910 + 타일 620 + 상부장 720 (천장이 낮으면 천장 40 아래) */
export const upperTopOf = (r: Room) => Math.min(r.h - 40, 910 + 620 + 720);
/** 상부장 도어 아랫선(원본 도어가 몸통보다 14 내려옴) */
export const upperBottomOf = (r: Room) => upperTopOf(r) - 720 - 14;
/** 키큰장 윗선 — 걸레받이 112 + 원본 키큰장 2227 · 상부장 높이(도어 포함) */
export const TALL_TOP = 112 + 2227, UPPER_H = 720 + 14 + 14;

const ROT_N: Record<number, [number, number]> = { 0: [0, -1], 90: [1, 0], 180: [0, 1], 270: [-1, 0] };
export const rotOfN = (n: [number, number]): 0 | 90 | 180 | 270 => (Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? 90 : 270) : (n[1] > 0 ? 180 : 0));
/** 아일랜드 프레임 — 가운데 · 회전 · 길이. 원점 = 뒤 왼쪽, 장 뒤 = 로컬 z 0, 앞 = 600 */
export function islandFrame(cx: number, cz: number, rot: number, len: number): Frame {
  const n = ROT_N[rot] ?? ROT_N[0];
  const dir: [number, number] = [n[1], -n[0]];
  return { o: [cx - dir[0] * len / 2 - n[0] * BASE_D / 2, cz - dir[1] * len / 2 - n[1] * BASE_D / 2], dir, n };
}
export interface IslandInfo {
  cx: number; cz: number; rot: 0 | 90 | 180 | 270; len: number; frame: Frame;
  /** 장 줄에 붙였을 때 — 붙인 벽 · 붙인 끝(0 = t 0 쪽) · 그 줄에 넣은 코너장 */
  attached?: WallId; attachedEnd?: 0 | 1; corner?: { wall: WallId; t0: number; w: number };
  /** T자로 붙었을 때 뒤쪽 — 양면 아일랜드는 반대 방향 코너장 */
  corner2?: { wall: WallId; t0: number; w: number };
  /** 형태 — 통판 마감 · 연계형 식탁 · 원형 식탁은 3D 에서 끝에 붙인다(식탁은 붙지 않은 끝) */
  style?: IslandStyle;
}

/** 아일랜드를 붙인 자리 — 그 줄에서 코너장(앞 · 뒤) · 뒤 휠라가 차지하는 구간 */
function islandSpan(I: IslandInfo | null | undefined, wall: WallId): [number, number] | null {
  if (!I?.corner || I.corner.wall !== wall) return null;
  const cs = [I.corner, I.corner2].filter((c): c is { wall: WallId; t0: number; w: number } => !!c);
  return [Math.min(...cs.map((c) => c.t0)), Math.max(...cs.map((c) => c.t0 + c.w + 100))];
}
function planOne(d: Design, cat: KitchenCatalog, series: Series, v: Variant, useFix = true, noAttach = false): Candidate | null {
  const room = d.room;
  const st = STYLE[d.style];
  const mods: Mods = (k) => cat.modules.find((m) => m.key === k && (m.series === series || m.series === '*'));
  const W = (k: string) => widthsOf(mods(k));
  const items: Item[] = [], counters: Counter[] = [], splashes: Splash[] = [];
  const reasons: string[] = [], warnings: string[] = [];
  const runs = makeRuns(room, v.walls, d.openings, reasons, useFix ? d.fridgeAt : undefined, d.openWall, d.fridgeKind === 'builtin' ? BASE_D + 20 : fridgeSpec(d).d + FRIDGE_GAP_BACK, !!v.pantry && !!mods('pantryCorner'), d.runLen);
  const P = (f: Frame, t: number, u: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
  const dot = (a: [number, number], b: [number, number]) => a[0] * b[0] + a[1] * b[1];
  const near = (x: number, y: number) => Math.abs(x - y) < 1;
  // EP 높이 = 장 높이 — 키큰장 · 냉장고 옆은 키큰장 윗선, 상부장 옆은 상부장(도어 포함 748). 그 위 천장까지는 서라운딩이 덮는다
  // EP 높이 — 키큰장 · 냉장고 옆은 바닥부터 천장까지, 상부장 옆은 상부장 도어 아랫선부터 천장까지 (사용자: EP 는 천장까지 높이를 다 쓴다)
  const epH = String(room.h);
  const epWH = String(room.h - upperBottomOf(room));

  const baseOpts = [...new Set([...W('cook1'), ...W('drawer3'), ...W('cook2')])].filter((x) => x >= 400);
  // 비규격 흡수 한도 — 600 이하는 1도어 · 서랍(~600), 넘으면 조리장(~1200). 상부장은 1도어(~600) · 2도어(~900)
  const baseMax = (w: number) => (w > 600 ? 1200 : 600), wallMax = (w: number) => (w > 600 ? 900 : 600);
  const pickBase = (w: number, i: number): string => {
    // 300 미만은 장으로 만들지 않는다 — 휠라로 두면 뒤 휠라 정리에서 옆 장이 흡수한다 (예전엔 150~180 짜리 1도어 막대장)
    if (w < 300) return w === 75 ? 'bfill75' : 'bfill50';
    if (!baseOpts.includes(w)) return w > 600 ? 'cook2' : w >= 300 && st.drawers > 0.5 && i % 2 === 0 ? 'drawer3' : 'cook1';
    if (W('drawer3').includes(w) && (i % 3 === 0 ? st.drawers > 0.3 : st.drawers > 0.6)) return 'drawer3';
    if (W('drawer2').includes(w) && st.drawers > 0.5 && i % 2 === 1) return 'drawer2';
    if (W('cook2').includes(w)) return 'cook2';
    if (W('cook1').includes(w)) return 'cook1';
    return W('drawer3').includes(w) ? 'drawer3' : 'cook2';
  };
  /** EP — 원본 EP 모델. 키큰장 · 상부장용은 비규격 높이(장 높이) · 깊이는 옆 장 도어 앞면까지
   *  (원본 깊이 키큰장용 595 · 냉장고용 800 · 상부장용 345 — 냉장고용은 냉장고 윗장 앞보다 207 튀어나왔다) */
  const ep = (key: 'epB' | 'epT' | 'epTx' | 'epW', f: Frame, t: number, wall?: WallId): Item => ({
    key, level: key === 'epB' ? 'base' : key === 'epW' ? 'wall' : 'tall', frame: f, t, w: 20, wall, tag: 'ep',
    ov: key === 'epB' ? undefined : { STD_YN: 'true', NSTD_H: key === 'epW' ? epWH : epH, NSTD_D: String(key === 'epW' ? WALL_FRONT : TALL_FRONT) },
  });

  let sinkP: [number, number] | undefined, hobP: [number, number] | undefined, fridgeP: [number, number] | undefined;
  let storageMM = 0, counterMM = 0, hobUnderWindow = false, sinkUnderWindow = false;

  /* 아일랜드 자리 — 사용자가 옮긴 자리 또는 자동. 끝을 장 줄 앞에 붙이면 그 줄에 코너장을 넣어 ㄱ자로 잇는다 */
  const cfg = d.islandCfg;
  // 아일랜드 형태 — 고르지 않았으면 스타일 따라(수납 많이 = 양면)
  const islStyle: IslandStyle = d.islandCfg.style ?? (d.style === 'storage' ? 'double' : 'basic');
  const twoSided = islStyle === 'double';
  const aisle = 1100;
  // 연계형 · 원형 식탁 — 붙지 않은 끝(기본 t = len 쪽)에 이만큼 더 나간다. 자리 잡을 때 그 길이까지 방 안 · 줄 안으로
  const tableExt = islStyle === 'table' ? ISLAND_TABLE.len : islStyle === 'round' ? ISLAND_TABLE.round - ISLAND_TABLE.overlap : 0;
  let island: IslandInfo | undefined;
  /** 아일랜드 가운데를 방 안으로 — 상판 · 의자 자리까지 */
  const inRoom = (px: number, pz: number, rot: number, len: number): [number, number] => {
    const f0 = islandFrame(px, pz, rot, len);
    const u0 = twoSided ? -COUNTER_D : -(20 + cfg.over) - (cfg.over >= 220 ? 360 : 0);
    const cs = [[0, u0], [len + tableExt, u0], [len + tableExt, COUNTER_D], [0, COUNTER_D]].map(([t, u]) => P(f0, t, u));
    const xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1]);
    const fit = (lo: number, hi: number, max: number) => (hi - lo > max ? (max - lo - hi) / 2 : lo < 0 ? -lo : hi > max ? max - hi : 0);
    return [px + fit(Math.min(...xs), Math.max(...xs), room.w), pz + fit(Math.min(...zs), Math.max(...zs), room.d)];
  };
  if (d.island) {
    const len = Math.max(1200, Math.min(3600, cfg.len));
    if (cfg.pos) {
      // 방 밖으로 끌려 나가지 않게 — 상판 · 의자 자리까지 방 안으로 밀어 넣는다(예전엔 거실 · 벽 너머로 나가 아일랜드가 사라져 보였다)
      const [px, pz] = inRoom(cfg.pos.x, cfg.pos.z, cfg.pos.rot, len);
      let info: IslandInfo = { cx: px, cz: pz, rot: cfg.pos.rot, len, frame: islandFrame(px, pz, cfg.pos.rot, len) };
      for (const run of noAttach ? [] : runs) {
        const f0 = info.frame;
        if (Math.abs(dot(f0.dir, run.frame.n)) < 0.99) continue;
        for (const end of [0, 1] as const) {
          const E = P(f0, end ? len : 0, BASE_D / 2);
          const rel: [number, number] = [E[0] - run.frame.o[0], E[1] - run.frame.o[1]];
          const u = dot(rel, run.frame.n), t = dot(rel, run.frame.dir);
          const away = (end === 0 ? 1 : -1) * dot(f0.dir, run.frame.n) > 0;
          // 붙임 — 끝이 장 앞면(u 600)에서 150 안쪽까지 다가왔을 때만. 예전엔 600 넘게 떨어져도 붙어 방 가운데에 놓을 수 없었다
          // 줄 끝(구석 · 옆 줄 장 자리)으로 700 까지 넘어 들어왔으면 붙일 수 있는 끝(300 안쪽)으로 당겨서 붙인다
          const tIn = Math.max(run.a + 300, Math.min(run.b - 300, t));
          if (!away || u < BASE_D / 2 + 150 || u > BASE_D + 150 || Math.abs(tIn - t) > 700 || run.b - run.a < 600) continue;
          // 끝을 장 앞면(600)에 딱 붙인다
          const sh = BASE_D - u;
          let cx = info.cx + run.frame.n[0] * sh + run.frame.dir[0] * (tIn - t), cz = info.cz + run.frame.n[1] * sh + run.frame.dir[1] * (tIn - t);
          // 상판에 맞춰 스냅 — 아일랜드 상판 옆면이 그 줄 상판 끝(벽 · 창 · 문 자리)에서 150 안쪽이면 끝에 딱 맞춘다
          {
            const fa = islandFrame(cx, cz, info.rot, len), u0 = twoSided ? -COUNTER_D : -(20 + cfg.over);
            const tt = [u0, COUNTER_D].map((uu) => { const q = P(fa, end ? len : 0, uu); return dot([q[0] - run.frame.o[0], q[1] - run.frame.o[1]], run.frame.dir); });
            const lo = Math.min(...tt), hi = Math.max(...tt);
            let dt = 0;
            for (const [s0, s1] of subtract(run.a, run.b, blocks(d.openings, run.wall).base)) {
              if (Math.abs(lo - s0) < 150) dt = s0 - lo;
              else if (Math.abs(hi - s1) < 150) dt = s1 - hi;
            }
            cx += run.frame.dir[0] * dt; cz += run.frame.dir[1] * dt;
          }
          const f = islandFrame(cx, cz, info.rot, len);
          const back = P(f, end ? len : 0, 0);
          const tb = dot([back[0] - run.frame.o[0], back[1] - run.frame.o[1]], run.frame.dir);
          const cw = W('cornerL').includes(CORNER_W) ? CORNER_W : W('cornerL')[0] ?? CORNER_W;
          const frontToPlusT = dot(f.n, run.frame.dir) > 0;
          // 앞(장 쪽) = 코너장(옆 줄 자리 = 아일랜드). T자로 줄 가운데 붙으면 뒤쪽도 — 양면은 반대 방향 코너장, FIX 면은 휠라 50(문이 FIX 판에 걸리지 않게)
          info = {
            cx, cz, rot: info.rot, len, frame: f, attached: run.wall, attachedEnd: end, corner: { wall: run.wall, t0: frontToPlusT ? tb : tb - cw - 100, w: cw },
            // 양면 아일랜드가 줄 가운데(T자)에 붙으면 뒤쪽도 코너장 — 뒤쪽으로 벽 장이 이어질 때만(줄 끝이면 ㄱ자라 뒤쪽엔 장이 없다)
            ...(twoSided && !(d as { _noCorner2?: boolean })._noCorner2 && (frontToPlusT ? tb - run.a : run.b - tb) >= cw + 100 ? { corner2: { wall: run.wall, t0: frontToPlusT ? tb - cw - 100 : tb, w: cw } } : {}),
          };
          break;
        }
        if (info.attached != null) break;
      }
      island = info;
    } else {
      const main = runs.reduce((p, r) => ((r.b - r.a) > (p.b - p.a) ? r : p), runs[0]);
      const across = main.wall % 2 === 0 ? room.d : room.w;
      const opposite = runs.find((r) => r.wall === ((main.wall + 2) % 4));
      const idep = twoSided ? BASE_D * 2 : BASE_D + 20 + cfg.over;
      const need = COUNTER_D + aisle + idep + (opposite ? COUNTER_D + 1000 : 900);
      const fitLen = Math.min(len, Math.floor((main.b - main.a - 600 - tableExt) / 100) * 100);
      const n: [number, number] = [-main.frame.n[0], -main.frame.n[1]];
      const rot = rotOfN(n);
      if (across >= need && fitLen >= 1200) {
        const c = P(main.frame, (main.a + main.b) / 2, COUNTER_D + aisle + BASE_D / 2);
        // 식탁까지 한 덩어리로 가운데 — 아일랜드 가운데를 식탁 반대쪽으로 반만큼
        const fd = islandFrame(c[0], c[1], rot, fitLen).dir;
        c[0] -= fd[0] * tableExt / 2; c[1] -= fd[1] * tableExt / 2;
        island = { cx: c[0], cz: c[1], rot, len: fitLen, frame: islandFrame(c[0], c[1], rot, fitLen) };
      } else {
        // 통로가 좁아도 빼지 않는다 — 빈 바닥 가운데에 놓고 알림 (예전엔 말없이 빠져 아일랜드가 사라진 것처럼 보였다)
        const far = opposite ? across - COUNTER_D : across;
        const L2 = Math.max(1200, fitLen);
        const c0 = P(main.frame, (main.a + main.b) / 2, (COUNTER_D + far) / 2);
        const c = inRoom(c0[0], c0[1], rot, L2);
        island = { cx: c[0], cz: c[1], rot, len: L2, frame: islandFrame(c[0], c[1], rot, L2) };
        warnings.push(`아일랜드 둘레 통로가 좁습니다 (권장 깊이 ${need}mm · 지금 ${across}mm) — 끌어 옮기거나 길이를 줄여 보세요`);
      }
    }
  }

  // 냉장고장 · 키큰장 묶음 — 바깥 끝부터: [EP] 냉장고 [EP] 키큰장… [EP]
  const tallKeys: string[] = [];
  for (let i = 0; i < st.talls - 1; i++) tallKeys.push(i % 2 === 0 ? 'tall2' : 'tall');
  // 카페 스타일 — 냉장고 옆에 폴딩 카페장(접어 여는 문 안에 커피머신 · 가전). 원본이 없는 계열이면 없이
  if (d.style === 'cafe' && mods('cafeTall')) tallKeys.push('cafeTall');
  /** 카페장이 아직 안 놓였으면 — 냉장고 묶음에 못 붙이면 어느 줄이든 빈 끝에 따로 */
  let cafeLeft = tallKeys.includes('cafeTall');
  let glassDone = false;

  runs.forEach((run, ri) => {
    const bl = blocks(d.openings, run.wall);
    let a = run.a, b = run.b;
    // EP 가 필요 없는 맞닿는 점 — 벽 · 벽 코너 · 키큰장 묶음 · 코너장 · 후드
    const joinB: number[] = [], joinU: number[] = [];
    // 줄 시작은 앞 벽(prevWall), 끝은 다음 벽(nextWall)에 닿는다 — 그 벽이 트인 쪽이면 벽이 아니라 EP
    // 트인 벽의 시작 쪽 날개벽(a)은 그 앞 줄(prevWall(open))의 끝에, 끝 쪽 날개벽(b)은 다음 줄의 시작에 닿는다
    const wallAtStart = prevWall(run.wall) !== d.openWall || d.wing.b >= BASE_D, wallAtEnd = nextWall(run.wall) !== d.openWall || d.wing.a >= BASE_D;
    // 상부장은 벽에 붙지 않으면 EP — 옆 줄 냉장고가 코너에 선 자리(냉장고 깊이만큼 비움)는 상부장 끝이 허공이라 EP. 팬트리는 그 EP(키큰장)가 받는다
    const openStart = run.cornerStart === 'skip' && !!run.fridgeCornerStart && !run.pantryStart, openEnd = run.cornerEnd === 'skip' && !!run.fridgeCornerEnd && !run.pantryEnd;
    if ((run.a <= 1 && wallAtStart) || run.cornerStart === 'skip') { joinB.push(run.a); if (!openStart) joinU.push(run.cornerStart === 'skip' ? run.wa : run.a); }
    if ((run.b >= run.L - 1 && wallAtEnd) || run.cornerEnd === 'skip') { joinB.push(run.b); if (!openEnd) joinU.push(run.cornerEnd === 'skip' ? run.wb : run.b); }
    /** 키큰장 묶음(냉장고 · 카페장) 구간 — 상부장 · 벽 마감을 끊는다 */
    const groupSpans: [number, number][] = [];

    if (ri === v.fridgeRun && !d.noFridge) {
      const startFree = (run.cornerStart !== 'cab' && run.cornerStart !== 'skip') || (!!run.fridgeAfterCornerStart && run.cornerStart === 'skip');
      const endFree = ((run.cornerEnd !== 'cab' && run.cornerEnd !== 'skip') || (!!run.fridgeAfterCornerEnd && run.cornerEnd === 'skip')) && !run.pantryEnd;
      const useStart = v.fridgeEnd === 'start' ? startFree || !endFree : !endFree && startFree;
      const outerWall = useStart ? run.a <= 1 && wallAtStart : run.b >= run.L - 1 && wallAtEnd;
      // 아일랜드를 붙일 자리(코너장 + 100)도 피한다 — 예전엔 냉장고 묶음이 먼저 차지해 아일랜드가 붙지 못하고 따로 놓였다
      const isp = islandSpan(island, run.wall), islCut: [number, number][] = isp ? [[isp[0] - 20, isp[1] + 20]] : [];
      const blocked = (t0: number, t1: number) => [...bl.base, ...bl.upper, ...islCut].some(([c0, c1]) => c1 > t0 && c0 < t1);
      // 빌트인 냉장고장(원본 T콤비 600)은 키큰장과 같은 몸통이라 사이 EP 없이 잇고, 위 냉장고 윗장도 없다
      const builtin = d.fridgeKind === 'builtin' && !!mods('fridgeTall');
      for (let nt = tallKeys.length; nt >= 0; nt--) {
        const seq: { key: string; w: number }[] = [];
        if (builtin) {
          if (!outerWall) seq.push({ key: 'epT', w: 20 });
          seq.push({ key: 'fridgeTall', w: W('fridgeTall')[0] ?? 600 });
        } else {
          if (!outerWall) seq.push({ key: 'epTx', w: 20 });
          seq.push({ key: 'fridge', w: fridgeSpec(d).w }, { key: 'epTx', w: 20 });
        }
        for (const k of (cafeLeft ? tallKeys : tallKeys.filter((x) => x !== 'cafeTall')).slice(0, nt)) seq.push({ key: k, w: k === 'tall' ? 600 : (W(k)[0] ?? 900) });
        if (nt || builtin) seq.push({ key: 'epT', w: 20 });
        const total = seq.reduce((x, y) => x + y.w, 0);
        const t0 = useStart ? a : b - total;
        // 묶음을 놓고 남길 길이 — 그 줄이 맡은 것만큼(싱크 1200 · 쿡탑 900). 예전엔 늘 1800 이라 짧은 옆 벽에는 냉장고장을 못 옮겼다
        // 식기세척기장(600)도 남긴다 — 길이가 모자라면 식세보다 냉장고장을 먼저 뺀다(냉장고는 따로 두는 경우가 많다, 사용자)
        const need = (ri === v.sinkRun ? (st.dish ? 1000 + 600 : 1200) : 0) + (ri === v.hobRun ? (ri === v.sinkRun ? 600 : 900) : 0);
        if (blocked(t0, t0 + total) || (b - a) - total < need) continue;
        // 바깥 끝에서 안쪽 순서 — 끝이 오른쪽이면 뒤집어 왼쪽부터 놓는다
        let cur = t0;
        for (const s of useStart ? seq : seq.slice().reverse()) {
          if (s.key === 'fridge') {
            items.push({ key: 'fridge', level: 'tall', frame: run.frame, t: cur, w: s.w, wall: run.wall, tag: 'fridge' });
            // 냉장고 윗장 — 냉장고 바로 위(틈 27)에서 키큰장 윗선까지 비규격 높이. 예전엔 원본 높이 315 라 냉장고와 사이가 170 떴다
            const fs = fridgeSpec(d), topH = Math.min(room.h, TALL_TOP) - fs.h - FRIDGE_GAP_TOP;
            if (topH >= FRIDGE_TOP_MIN) items.push({ key: 'fridgeTop', level: 'wall', frame: run.frame, t: cur, w: s.w, wall: run.wall, ov: { STD_YN: 'true', NSTD_W: String(s.w), NSTD_H: String(topH) } });
            fridgeP = P(run.frame, cur + s.w / 2, BASE_D / 2);
          } else if (s.key === 'fridgeTall') {
            items.push({ key: 'fridgeTall', level: 'tall', frame: run.frame, t: cur, w: s.w, wall: run.wall, tag: 'fridge' });
            fridgeP = P(run.frame, cur + s.w / 2, BASE_D / 2);
          } else if (s.key.startsWith('ep')) items.push(ep(s.key as 'epT' | 'epTx', run.frame, cur, run.wall));
          else { items.push({ key: s.key, level: 'tall', frame: run.frame, t: cur, w: s.w, wall: run.wall }); storageMM += s.w * 3.5; }
          cur += s.w;
        }
        groupSpans.push([t0, t0 + total]);
        if (seq.some((x) => x.key === 'cafeTall')) cafeLeft = false;
        if (useStart) a = t0 + total; else b = t0;
        joinB.push(useStart ? a : b); joinU.push(useStart ? a : b);
        reasons.push(builtin
          ? `빌트인 냉장고장을 ${wallName(d.openWall, run.wall)} ${useStart ? '시작' : '끝'} 쪽에 — 도어 안 콤비 냉장고${nt ? ` · 키큰장 ${nt}개 이어서` : ''}`
          : `냉장고장을 ${wallName(d.openWall, run.wall)} ${useStart ? '시작' : '끝'} 쪽에 — 양옆 EP · 위 냉장고 윗장${nt ? ` · ${tallKeys[0] === 'cafeTall' ? '폴딩 카페장' : `키큰장 ${nt}개`} 이어서` : ''}`);
        break;
      }
    }

    // 카페장 — 냉장고 묶음 옆에 못 붙였으면(창 · 길이) 이 줄의 빈 끝(코너 · 팬트리 · 냉장고 묶음이 없는 쪽)에 [EP] 카페장 EP
    if (cafeLeft) {
      const cw = W('cafeTall')[0] ?? 900;
      const need = (ri === v.sinkRun ? 1200 : 0) + (ri === v.hobRun ? (ri === v.sinkRun ? 600 : 900) : 0);
      const ispC = islandSpan(island, run.wall), islCutC: [number, number][] = ispC ? [[ispC[0] - 20, ispC[1] + 20]] : [];
      const blockedC = (t0: number, t1: number) => [...bl.base, ...bl.upper, ...islCutC].some(([c0, c1]) => c1 > t0 && c0 < t1);
      for (const atStart of [false, true]) {
        const free = atStart ? run.cornerStart == null && !run.pantryStart && near(a, run.a) : run.cornerEnd == null && !run.pantryEnd && near(b, run.b);
        if (!free) continue;
        const outer = atStart ? run.a <= 1 && wallAtStart : run.b >= run.L - 1 && wallAtEnd;
        const seq: { key: string; w: number }[] = [...(outer ? [] : [{ key: 'epT', w: 20 }]), { key: 'cafeTall', w: cw }, { key: 'epT', w: 20 }];
        const total = seq.reduce((x, y) => x + y.w, 0), t0 = atStart ? a : b - total;
        if (blockedC(t0, t0 + total) || (b - a) - total < need + 600) continue;
        let cur = t0;
        for (const s of atStart ? seq : seq.slice().reverse()) {
          if (s.key === 'epT') items.push(ep('epT', run.frame, cur, run.wall));
          else { items.push({ key: 'cafeTall', level: 'tall', frame: run.frame, t: cur, w: s.w, wall: run.wall }); storageMM += s.w * 3; }
          cur += s.w;
        }
        groupSpans.push([t0, t0 + total]);
        if (atStart) a = t0 + total; else b = t0;
        joinB.push(atStart ? a : b); joinU.push(atStart ? a : b);
        reasons.push(`폴딩 카페장을 ${wallName(d.openWall, run.wall)} ${atStart ? '시작' : '끝'} 쪽에 — 문을 접어 열면 커피머신 · 가전 자리`);
        cafeLeft = false;
        break;
      }
    }
    // 코너 팬트리장 — 줄 끝에 서고, 안쪽(장 쪽)은 EP. 다음 줄 시작 쪽도 EP 로 받는다
    // 그 EP 는 상판 깊이(620)까지 — 키큰장 EP 깊이(593)면 상판 끝이 27 튀어나와 잘린 면이 드러났다(사용자 「다른 장들이랑 구조가 이상」)
    const pantryEp = (t: number) => { const e = ep('epT', run.frame, t, run.wall); e.ov = { ...e.ov!, NSTD_D: String(COUNTER_D) }; return e; };
    if (run.pantryEnd) {
      items.push(pantryEp(run.L - PANTRY_W - 20));
      items.push({ key: 'pantryCorner', level: 'tall', frame: run.frame, t: run.L - PANTRY_W, w: PANTRY_W, wall: run.wall });
      storageMM += PANTRY_W * 3.5 * 1.6;
      joinB.push(b); joinU.push(b);
    }
    if (run.pantryStart) { items.push(pantryEp(run.a - 20)); joinB.push(run.a); joinU.push(run.a); }
    // 코너장 (벽 코너)
    if (run.cornerStart === 'cab') {
      const w = W('cornerL').includes(CORNER_W) ? CORNER_W : W('cornerL')[0] ?? CORNER_W;
      const gap = run.cornerGapStart ?? 0;
      items.push({ key: 'cornerL', level: 'base', frame: run.frame, t: a + gap, w, wall: run.wall });
      a += gap;
      a += w + 100; storageMM += w; joinB.push(a);
    }
    if (run.cornerEnd === 'cab') {
      const w = W('cornerR').includes(CORNER_W) ? CORNER_W : W('cornerR')[0] ?? CORNER_W;
      const gap = run.cornerGapEnd ?? 0;
      items.push({ key: 'cornerR', level: 'base', frame: run.frame, t: b - w - 100 - gap, w, wall: run.wall });
      b -= gap;
      b -= w + 100; storageMM += w; joinB.push(b);
    }
    // 아일랜드를 붙인 자리 — 코너장
    const penCut: [number, number][] = [];
    const isp = islandSpan(island, run.wall);
    if (island?.corner && isp) {
      // 앞 코너장 — 아일랜드 앞면 쪽으로 열린다. 뒤 코너장(양면)은 반대 방향
      const fk = dot(island.frame.n, run.frame.dir) > 0 ? 'cornerL' : 'cornerR', bk = fk === 'cornerL' ? 'cornerR' : 'cornerL';
      for (const [c, key] of [[island.corner, fk], [island.corner2, bk]] as const) if (c) { items.push({ key, level: 'base', frame: run.frame, t: c.t0, w: c.w, wall: run.wall }); storageMM += c.w; }
      penCut.push(isp); joinB.push(isp[0], isp[1]);
    }

    // 하부장 구간 — 끝이 벽 · 코너 · 키큰장이 아니면 EP
    const segs: [number, number][] = [];
    for (const [s0, s1] of subtract(a, b, [...bl.base, ...penCut])) {
      let x0 = s0, x1 = s1;
      if (!joinB.some((j) => near(j, x0))) { items.push(ep('epB', run.frame, x0, run.wall)); x0 += 20; }
      if (!joinB.some((j) => near(j, x1))) { x1 -= 20; items.push(ep('epB', run.frame, x1, run.wall)); }
      if (x1 - x0 >= 300) segs.push([x0, x1]);
    }
    // 상판 — 코너장 쪽은 벽 끝까지, 코너를 비운 쪽(skip)은 코너를 맡은 줄 상판 앞선(COUNTER_D)에 딱 맞춘다(왼쪽 · 오른쪽 같은 규칙)
    const ca = run.cornerStart === 'cab' ? run.a : run.cornerStart === 'skip' && !run.fridgeCornerStart && near(a, run.a) ? COUNTER_D : a;
    const cb = run.cornerEnd === 'cab' ? run.b : run.cornerEnd === 'skip' && !run.fridgeCornerEnd && near(b, run.b) ? run.L - COUNTER_D : b;
    for (const [s0, s1] of subtract(ca, cb, bl.base)) {
      counters.push({ frame: run.frame, t0: s0, t1: s1, z0: 0, z1: COUNTER_D });
      counterMM += s1 - s0;
    }

    // 싱크 · 쿡탑 자리
    const fixed: { key: string; w: number; c: number; tag: Item['tag'] }[] = [];
    if (segs.length) {
      const longest = segs.slice().sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
      const win = d.openings.find((o) => o.kind === 'window' && o.wall === run.wall && o.sill >= 930);
      const fx = useFix ? d.fix ?? {} : {};
      if (ri === v.sinkRun) {
        const sw = W('sink').includes(1000) ? 1000 : W('sink')[0] ?? 1000;
        let c: number;
        const winSeg = win && segs.find(([s0, s1]) => win.t + win.w / 2 > s0 + sw / 2 && win.t + win.w / 2 < s1 - sw / 2);
        if (fx.sink) c = fx.sink.c;
        else if (v.sinkAtWindow && win && winSeg) c = win.t + win.w / 2;
        else c = v.flip ? longest[1] - sw / 2 - 600 : longest[0] + sw / 2 + 600;
        if (win && c > win.t && c < win.t + win.w) sinkUnderWindow = true;
        fixed.push({ key: 'sink', w: sw, c, tag: 'sink' });
        // 식기세척기장 — 줄이 짧아(싱크 + 식세 + 같은 줄 쿡탑 + 조리대 300) 안 들어가면 뺀다. 넣으려다 쿡탑이 밀려 안 전체가 빠지던 문제
        const free = segs.reduce((sum, [s0, s1]) => sum + s1 - s0, 0);
        // 같은 줄 쿡탑 조리장은 600 까지 줄일 수 있으니 600 으로 본다
        const dishFits = free >= sw + 600 + (ri === v.hobRun ? HOB_W[HOB_W.length - 1] + 150 : 300);
        if (st.dish && !fx.dish && dishFits) fixed.push({ key: 'dish', w: 600, c: c + (v.flip ? -1 : 1) * (sw / 2 + 300), tag: 'dish' });
        else if (st.dish && !fx.dish) warnings.push('벽이 짧아 식기세척기장을 뺐습니다 — 넣으려면 방을 넓히거나 다른 공간 구조');
      }
      // 사용자가 옮긴 식기세척기장 — 어느 줄이든 그 벽 줄에
      if (st.dish && fx.dish && fx.dish.wall === run.wall) fixed.push({ key: 'dish', w: 600, c: fx.dish.c, tag: 'dish' });
      if (ri === v.hobRun) {
        // 쿡탑 조리장 폭 — 900 이 기본, 줄이 짧으면 800 · 700 · 600(1도어)까지 자동으로 줄인다 (사용자: 조리장도 자동으로 줄여)
        const free = segs.reduce((sum, [s0, s1]) => sum + s1 - s0, 0) - fixed.reduce((sum, f) => sum + f.w, 0);
        // 고른 쿡탑이 넓으면(올인원 830 등) 그 폭 아래로는 줄이지 않는다
        const hmin = hobMinW(d), hws = HOB_W.filter((w) => w >= hmin);
        const hw = d.style === 'storage' && hmin <= 600 ? 600 : hws.find((w) => free >= w + 150) ?? hws[hws.length - 1];
        const sink = fixed.find((f) => f.tag === 'sink');
        let c: number;
        if (fx.hob) c = fx.hob.c;
        else if (sink) {
          const dir = v.flip ? 1 : -1;
          c = sink.c + dir * (sink.w / 2 + 900 + hw / 2);
          const seg = segs.find(([s0, s1]) => c - hw / 2 >= s0 + 300 && c + hw / 2 <= s1 - 300);
          if (!seg) c = sink.c - dir * (sink.w / 2 + 600 + 900 + hw / 2);
        } else c = (longest[0] + longest[1]) / 2 + (v.flip ? 300 : -300);
        fixed.push({ key: d.style === 'storage' ? 'drawer3' : hobKey(hw), w: hw, c, tag: 'hob' });
        if (win && c > win.t - 300 && c < win.t + win.w + 300) hobUnderWindow = true;
      }
      // 구간 밖으로 나간 자리(벽 끝 너머 · 문 자리)는 가장 가까운 구간 안으로 당긴다
      for (const f of fixed) {
        if (segs.some(([s0, s1]) => f.c - f.w / 2 >= s0 && f.c + f.w / 2 <= s1)) continue;
        let best = f.c, dist = Infinity;
        for (const [s0, s1] of segs) {
          if (s1 - s0 < f.w) continue;
          const c = Math.max(s0 + f.w / 2, Math.min(s1 - f.w / 2, f.c));
          if (Math.abs(c - f.c) < dist) { dist = Math.abs(c - f.c); best = c; }
        }
        f.c = best;
      }
      fixed.sort((x, y) => x.c - y.c);
    }

    segs.forEach(([s0, s1]) => {
      let cur = s0, idx = 0;
      const mine = fixed.filter((f) => f.c >= s0 && f.c <= s1);
      const minW = 300;
      // 채울 수 있는 틈 — 휠라 하나(150) 이하 · 비규격 장 하나(300) 이상
      const ok = (g: number) => g <= 150 || g >= minW;
      mine.forEach((f, fi) => {
        let t0 = Math.round((f.c - f.w / 2) / 10) * 10;
        if (t0 < cur) t0 = cur;
        if (t0 + f.w > s1) t0 = s1 - f.w;
        if (t0 < cur) return;
        const last = fi === mine.length - 1;
        const fits = (x: number, w: number) => x >= cur && x + w <= s1 && ok(x - cur) && (!last || ok(s1 - x - w));
        if (!fits(t0, f.w)) {
          // 자리를 밀어 보고, 안 되면 원본 폭 선택지 안에서 폭도 바꿔 본다(씽크 900/1000/1200 · 조리장 700~1000)
          // 쿡탑 조리장은 900 → 800 → 700 → 600(1도어) 순으로 줄여 본다
          const ws = f.tag === 'hob' && f.key !== 'drawer3' ? [f.w, ...HOB_W.filter((x) => x < f.w && x >= hobMinW(d))]
            : [f.w, ...W(f.key).filter((x) => x !== f.w && x >= 400).sort((a2, b2) => Math.abs(a2 - f.w) - Math.abs(b2 - f.w))];
          let done = false;
          for (const w of ws) {
            const xs = [t0, cur, cur + minW, s1 - w, s1 - w - minW, Math.round((f.c - w / 2) / 10) * 10].filter((x) => fits(x, w));
            if (!xs.length) continue;
            t0 = xs.sort((x, y) => Math.abs(x + w / 2 - f.c) - Math.abs(y + w / 2 - f.c))[0];
            f.w = w; if (f.tag === 'hob' && f.key !== 'drawer3') f.key = hobKey(w);
            done = true; break;
          }
          void done;
        }
        for (const w of fillGap(t0 - cur, baseOpts, baseMax)) { items.push({ key: pickBase(w, idx++), level: 'base', frame: run.frame, t: cur, w, wall: run.wall }); storageMM += w > 75 ? w : 0; cur += w; }
        cur = t0;
        items.push({ key: f.key, level: 'base', frame: run.frame, t: cur, w: f.w, wall: run.wall, tag: f.tag });
        const cP = P(run.frame, cur + f.w / 2, BASE_D / 2);
        if (f.tag === 'sink') sinkP = cP;
        if (f.tag === 'hob') hobP = cP;
        if (f.key !== 'sink' && f.key !== 'dish') storageMM += f.w;
        cur += f.w;
      });
      for (const w of fillGap(s1 - cur, baseOpts, baseMax)) { items.push({ key: pickBase(w, idx++), level: 'base', frame: run.frame, t: cur, w, wall: run.wall }); storageMM += w > 75 ? w : 0; cur += w; }
    });

    // 상부장 — 창 · 문 피하고, 쿡탑 위 후드장, 끝이 벽 · 키큰장 · 후드가 아니면 EP. 카페는 오픈 선반
    // 창이 낮아 창 몰딩(50) · 틈(20) 위로 일반 상부장(720)이 그대로 들어가면 상부장 줄을 끊지 않는다 — 예전엔 끊고 창 위에 더 긴(830) 장을 따로 넣어 높이가 달랐다
    const uTop = upperTopOf(room);
    const winRoom = (o: Opening) => Math.floor((uTop - (o.sill + o.h + 50 + 20)) / 10) * 10;
    const lowWin = d.openings.filter((o) => o.wall === run.wall && o.kind === 'window' && winRoom(o) >= 720).map((o) => o.t - 50);
    const ucut: [number, number][] = [...bl.upper.filter(([c0]) => !lowWin.includes(c0)), ...groupSpans];
    let uA = run.cornerStart === 'skip' || run.noWallCornerStart ? run.wa : run.a, uB = run.cornerEnd === 'skip' || run.noWallCornerEnd ? run.wb : run.b;
    const hob = items.find((x) => x.tag === 'hob' && x.frame === run.frame);
    const upItems: Item[] = [];
    // 상부 코너장 — 상부장이 꽉 찬 스타일, 그리고 카페(폴딩 상부장으로 채움)도. 예전엔 full 에서만이라 카페 ㄷ자 · ㄱ자 구석이 비었다
    const wallCorners = st.uppers === 'full' || (st.uppers === 'cafe' && !!mods('wallFold'));
    if (run.cornerStart === 'cab' && wallCorners && !run.noWallCornerStart) { upItems.push({ key: 'wallCornerL', level: 'wall', frame: run.frame, t: uA, w: WCORNER_W, wall: run.wall }); uA += WCORNER_W; joinU.push(uA); }
    if (run.cornerEnd === 'cab' && wallCorners && !run.noWallCornerEnd) { upItems.push({ key: 'wallCornerR', level: 'wall', frame: run.frame, t: uB - WCORNER_W, w: WCORNER_W, wall: run.wall }); uB -= WCORNER_W; joinU.push(uB); }
    const hoodCut: [number, number][] = [];
    const chimney = hoodKindOf(applianceOf('hood', d.appliance?.hood)) === 'chimney';
    if (hob) {
      // 쿡탑 가운데 — 줄 끝(벽 · 코너장) 밖으로 나가면 안쪽으로 민다 (줄 시작 쿡탑에서 후드장이 벽 속 130 에 묻혔다)
      //   끝이 벽이 아니면(트인 쪽) EP 20 자리를 남긴다
      // 쿡탑이 든 구간(창 · 냉장고 묶음으로 끊긴 사이) 안으로 — 예전엔 줄 전체로 잡아 냉장고 묶음과 겹치면 후드가 통째로 빠졌다
      const hc = hob.t + hob.w / 2, seg = subtract(uA, uB, ucut).find(([s0, s1]) => hc >= s0 - 1 && hc <= s1 + 1) ?? [uA, uB];
      const lo = joinU.some((j) => near(j, seg[0])) ? seg[0] : seg[0] + 20, hi = joinU.some((j) => near(j, seg[1])) ? seg[1] : seg[1] - 20;
      // 벽부형(침니) 후드 — 후드장 없이 기기 폭(50 단위로 올림) 자리를 비운다. 빌트인은 후드장 900
      const hw = chimney ? Math.max(600, Math.ceil((applianceOf('hood', d.appliance?.hood)?.size?.[0] ?? 900) / 50) * 50) : 900, t0 = Math.max(lo, Math.min(hi - hw, hc - hw / 2));
      if (hi - lo >= hw && !ucut.some(([c0, c1]) => c1 > t0 && c0 < t0 + hw)) { upItems.push({ key: 'hood', level: 'wall', frame: run.frame, t: t0, w: hw, wall: run.wall }); hoodCut.push([t0, t0 + hw]); }
    }
    const wallOpts = [...new Set([...W('wall2'), ...W('wall1')])].filter((x) => x >= 300);
    // 창 위 상부장 자리 — 창이 낮아 창 몰딩 위 ~ 상부장 윗선이 250 이상이면. 옆 일반 상부장과 EP 없이 잇는다(사용자)
    const winUp: { c0: number; c1: number; H: number }[] = [];
    if (st.uppers === 'full') for (const o of d.openings) {
      if (o.wall !== run.wall || o.kind !== 'window') continue;
      const H = winRoom(o);
      if (H >= 720) continue;   // 일반 상부장이 들어간다 — 위에서 줄을 끊지 않았다
      let c0 = Math.max(uA, o.t - 50), c1 = Math.min(uB, o.t + o.w + 50);
      if (H < 250 || c1 - c0 < 300 || hoodCut.some(([h0, h1]) => h1 > c0 && h0 < c1) || groupSpans.some((g) => g[1] > c0 && g[0] < c1)) continue;
      // 옆 끝(줄 끝 · 냉장고 묶음 · 후드)까지 300 미만이면 그 끝까지 넓혀 붙인다 — 예전엔 10 틈이 남아 따로 떨어지고 키큰 EP 가 섰다
      const stops = [uA, uB, ...groupSpans.flat(), ...hoodCut.flat()];
      const l = stops.filter((x) => x <= c0 && c0 - x < 300).sort((a, b) => b - a)[0], r = stops.filter((x) => x >= c1 && x - c1 < 300).sort((a, b) => a - b)[0];
      if (l != null) c0 = l; if (r != null) c1 = r;
      winUp.push({ c0, c1, H });
    }
    // 카페 — 오픈 선반은 한 구간(900 이상 중 가장 짧은 구간)만, 나머지는 폴딩 상부장(접어 올려 여는 문). 폴딩 상부장 원본이 없으면 예전처럼 전부 선반
    const usegs = subtract(uA, uB, [...ucut, ...hoodCut]);
    const cafeFold = st.uppers === 'cafe' && !!mods('wallFold');
    // 선반 구간 — 싱크 위가 우선(카탈로그: 싱크 벽에 조명 선반), 없으면 900 이상 중 가장 짧은 구간
    const sinkIt = items.find((x) => x.tag === 'sink' && x.frame === run.frame), sinkC = sinkIt ? sinkIt.t + sinkIt.w / 2 : NaN;
    const shelfSeg = st.uppers !== 'cafe' ? undefined
      : usegs.find(([a2, b2]) => b2 - a2 >= 900 && sinkC >= a2 && sinkC <= b2) ?? usegs.filter(([a2, b2]) => b2 - a2 >= 900).sort((x, y) => (x[1] - x[0]) - (y[1] - y[0]))[0];
    // 키친바흐는 조명 선반(원본 COB 조명선반), 유로는 원목 선반
    const shelfKey = mods('shelfCob') ? 'shelfCob' : 'shelfOak';
    for (const [r0, r1] of usegs) {
      let s0 = r0, s1 = r1;
      if (st.uppers === 'cafe') {
        if (cafeFold && !(shelfSeg && r0 === shelfSeg[0] && r1 === shelfSeg[1])) { /* 폴딩 상부장으로 채움 */ } else {
          // 긴 구간(2100 초과)은 후드 · 냉장고 묶음 반대쪽 끝 1200 만 선반, 나머지는 폴딩 상부장
          let a0 = r0, a1 = r1;
          if (cafeFold && r1 - r0 > 2100) {
            const busyStart = [...hoodCut.flat(), ...groupSpans.flat()].some((j) => near(j, r0));
            if (busyStart) { a0 = r1 - 1200; s1 = a0; } else { a1 = r0 + 1200; s0 = a1; }
          }
          const sw = Math.min(a1 - a0 - 100, 1800);
          if (sw >= 500) {
            const t0 = (a0 + a1) / 2 - sw / 2;
            for (const y of [1500, 1880]) upItems.push({ key: shelfKey, level: 'shelf', frame: run.frame, t: t0, w: sw, y, wall: run.wall });
          }
          if (a0 === r0 && a1 === r1) continue;
        }
      }
      let x0 = s0, x1 = s1;
      // 침니 후드 옆은 장 옆면이 드러나 EP — 후드장(빌트인)이면 후드장과 잇는다
      const joined = [...joinU, ...(chimney ? [] : hoodCut.flat()), ...winUp.flatMap((u) => [u.c0, u.c1])];
      if (!joined.some((j) => near(j, x0))) { upItems.push(ep('epW', run.frame, x0, run.wall)); x0 += 20; }
      if (!joined.some((j) => near(j, x1))) { x1 -= 20; upItems.push(ep('epW', run.frame, x1, run.wall)); }
      let cur = x0, i = 0;
      for (const w of fillGap(x1 - x0, wallOpts, wallMax)) {
        const k = w <= 150 ? 'wfill50' : !wallOpts.includes(w) ? (w > 600 ? 'wall2' : 'wall1') : W('wall2').includes(w) ? (d.style === 'storage' || i % 4 !== 1 ? 'wall2' : 'dishDry') : 'wall1';
        const k2 = cafeFold && w > 150 && W('wallFold').includes(w) ? 'wallFold' : k === 'dishDry' && !W('dishDry').includes(w) ? 'wall2' : k;
        upItems.push({ key: k2, level: 'wall', frame: run.frame, t: cur, w, wall: run.wall });
        if (w > 50) storageMM += w * 0.6;
        cur += w; i++;
      }
    }
    // 창 위 상부장 — 창이 낮아 창 몰딩 위 ~ 상부장 윗선 사이가 250 이상 남으면 그 폭(상부장 자리 끊긴 구간)에 낮은 상부장(비규격 높이).
    //   윗선은 다른 상부장과 같고, 양옆은 이미 끊긴 자리의 EP 가 받는다(사용자)
    {
      for (const { c0, c1, H } of winUp) {
        // 양옆에 일반 상부장이 닿아 있으면 그대로 잇고, 아니면(벽 끝이 아닌 빈 쪽) EP
        const touch = (x: number) => upItems.some((u) => near(u.t, x) || near(u.t + u.w, x)) || joinU.some((j) => near(j, x));
        let x0 = c0, x1 = c1;
        if (!touch(x0)) { upItems.push(ep('epW', run.frame, x0, run.wall)); x0 += 20; }
        if (!touch(x1)) { x1 -= 20; upItems.push(ep('epW', run.frame, x1, run.wall)); }
        let cur = x0, i = 0;
        // 휠라 없이 — 휠라 몫(150 이하)은 옆 장 폭에 더한다(비규격 폭). 휠라는 높이를 따로 못 맞춰 키 큰 조각이 섞였다
        const ws0 = fillGap(x1 - x0, wallOpts, wallMax), ws: number[] = [];
        for (const w of ws0) { if (w <= 150 && ws.length) ws[ws.length - 1] += w; else ws.push(w); }
        if (ws.length > 1 && ws[0] <= 150) { ws[1] += ws[0]; ws.shift(); }
        for (const w of ws) {
          const k = W('wall2').includes(w) || w > 600 ? 'wall2' : 'wall1';
          upItems.push({ key: k, level: 'wall', frame: run.frame, t: cur, w, wall: run.wall, ov: { STD_YN: 'true', NSTD_H: String(H) } });
          if (w > 50) storageMM += w * 0.6 * (H / 720);
          cur += w; i++;
        }
        reasons.push(`창 위에 낮은 상부장(높이 ${H}) — 창 몰딩 위 공간`);
      }
    }
    // 후드장 끝 — 옆에 상부장 · 벽 · 키큰장 묶음이 없으면(창 · 문 옆) EP
    if (st.uppers === 'full' && !chimney) for (const h of upItems.filter((x) => x.key === 'hood')) {
      const others = upItems.filter((x) => x !== h && x.level === 'wall');
      // 벽 · 코너 · 키큰장 묶음(joinU)에 닿거나 옆에 상부장이 있으면 EP 없음
      if (!others.some((x) => near(x.t + x.w, h.t)) && !joinU.some((j) => near(j, h.t)) && h.t >= 20) upItems.push(ep('epW', run.frame, h.t - 20, run.wall));
      if (!others.some((x) => near(x.t, h.t + h.w)) && !joinU.some((j) => near(j, h.t + h.w)) && h.t + h.w <= run.L - 20) upItems.push(ep('epW', run.frame, h.t + h.w, run.wall));
    }
    // 상부 코너장 안쪽 끝 — 이어지는 상부장 · 후드 · 키큰장 묶음이 없으면(창 · 문 옆) EP
    for (const c of upItems.filter((x) => x.key.startsWith('wallCorner'))) {
      const x = c.key === 'wallCornerL' ? c.t + c.w : c.t;
      const touched = [...upItems, ...items].some((o) => o !== c && o.frame === run.frame && (o.level === 'wall' || o.level === 'tall') && (near(o.t, x) || near(o.t + o.w, x)));
      if (!touched) upItems.push(ep('epW', run.frame, c.key === 'wallCornerL' ? x : x - 20, run.wall));
    }
    if (d.glassAccent && !glassDone && mods('wallGlass')) {
      const cand = upItems.filter((x) => (x.key === 'wall2' || x.key === 'dishDry') && W('wallGlass').includes(x.w) && !x.ov?.NSTD_H);
      if (cand.length) {
        const mid = (uA + uB) / 2, g = cand.sort((a2, b2) => Math.abs(a2.t + a2.w / 2 - mid) - Math.abs(b2.t + b2.w / 2 - mid))[0];
        g.key = 'wallGlass'; glassDone = true;
        reasons.push(`상부장 하나를 유리장으로 — ${wallName(d.openWall, run.wall)} 가운데(카탈로그 유리 벽장 포인트)`);
      }
    }
    items.push(...upItems);
    for (const [s0, s1] of subtract(run.a, run.b, [...bl.base, ...groupSpans])) splashes.push({ frame: run.frame, t0: s0, t1: s1 });
  });

  if (!sinkP) return null;
  // 3단 서랍장 — 어떤 구성이든 하나는 꼭(사용자 2026-11-05). 없으면 쿡탑 가까운 조리장(여닫이) 하나를 바꾼다 — 폭이 서랍장 규격이거나 비규격 범위 안
  if (!items.some((x) => x.key === 'drawer3') && mods('drawer3')) {
    const dm = mods('drawer3')!, dw = W('drawer3');
    const fits = (w: number) => dw.includes(w) || (!!dm.nstd && !!dm.wmin && !!dm.wmax && w >= dm.wmin && w <= dm.wmax);
    const hb = items.find((x) => x.tag === 'hob');
    const hc = hb ? hb.t + hb.w / 2 : 0;
    const cand = items.filter((x) => x.level === 'base' && x.wall != null && !x.tag && /^cook[12]$/.test(x.key) && fits(x.w));
    const pickD = cand.sort((a2, b2) => (hb && a2.frame === hb.frame ? 0 : 1) - (hb && b2.frame === hb.frame ? 0 : 1) || Math.abs(a2.t + a2.w / 2 - hc) - Math.abs(b2.t + b2.w / 2 - hc))[0];
    if (pickD) { pickD.key = 'drawer3'; reasons.push('3단 서랍장 — 쿡탑 가까이 수저 · 조리도구 서랍'); }
    // 바꿀 조리장이 없으면 — ① 쿡탑장을 서랍형으로(쿡탑 아래 3단 서랍, 흔한 구성) ② 넓은 조리장을 3단 서랍장 + 1도어 조리장으로 나눈다
    else if (hb && hb.wall != null && /^cook[12]$/.test(hb.key) && fits(hb.w)) { hb.key = 'drawer3'; reasons.push('쿡탑장을 3단 서랍장으로 — 쿡탑 아래 조리도구 서랍'); }
    else {
      const sw = dw.includes(600) ? 600 : dw.filter((w) => w <= 600).pop() ?? dw[0];
      const c1 = mods('cook1'), c1ok = (w: number) => W('cook1').includes(w) || (!!c1?.nstd && !!c1.wmin && !!c1.wmax && w >= c1.wmin && w <= c1.wmax);
      const big = items.filter((x) => x.level === 'base' && x.wall != null && !x.tag && /^cook[12]$/.test(x.key) && c1ok(x.w - sw))
        .sort((a2, b2) => Math.abs(a2.t + a2.w / 2 - hc) - Math.abs(b2.t + b2.w / 2 - hc))[0];
      if (big && sw) {
        // 서랍장은 쿡탑 쪽 끝에
        const nearStart = !hb || hb.frame !== big.frame || hc < big.t + big.w / 2;
        const rest: Item = { ...big, key: 'cook1', w: big.w - sw, t: nearStart ? big.t + sw : big.t, ov: undefined };
        big.key = 'drawer3'; big.t = nearStart ? big.t : big.t + big.w - sw; big.w = sw; big.ov = undefined;
        items.push(rest);
        reasons.push('3단 서랍장 — 넓은 조리장을 나눠 쿡탑 쪽에');
      }
    }
  }
  if ((st.oven || d.wants?.includes('cook')) && mods('oven') && W('oven').includes(600)) {
    const hb = items.find((x) => x.tag === 'hob' && x.wall != null);
    const cand = items.filter((x) => x.level === 'base' && x.wall != null && !x.tag && x.w === 600 && /^(cook1|cook2|drawer2)$/.test(x.key) && (!hb || x.frame === hb.frame));
    const hc = hb ? hb.t + hb.w / 2 : 0;
    const ov = cand.sort((a2, b2) => Math.abs(a2.t + a2.w / 2 - hc) - Math.abs(b2.t + b2.w / 2 - hc))[0];
    if (ov) { ov.key = 'oven'; reasons.push('쿡탑 옆 하부장을 빌트인 오븐장으로 — 요리 동선'); }
  }
  // 아일랜드를 붙인 자리에 상판이 이어지는지 — 코너장 자리가 냉장고 · 키큰장 · 창 · 문과 겹치거나 상판이 없으면 붙이지 않고 그 자리에 따로 둔다
  if (island?.corner && !noAttach) {
    const c = island.corner, rf = runs.find((r) => r.wall === c.wall)?.frame;
    const span: [number, number] = islandSpan(island, c.wall)!;
    const own = (x: Item) => /^corner/.test(x.key);   // 붙이면서 넣은 코너장
    const hit = (x: Item) => x.frame === rf && !own(x) && (x.level === 'tall' || x.level === 'base') && x.t < span[1] - 1 && x.t + x.w > span[0] + 1;
    const covered = counters.some((ct) => ct.frame === rf && ct.t0 <= span[0] + 1 && ct.t1 >= span[1] - 1);
    if (rf && (items.some(hit) || !covered) && (d.islandCfg.pos && ((d as { _islShift?: number })._islShift ?? 0) < 2)) {
      // 붙일 자리가 냉장고 묶음 · 기존 코너장 · 창 · 문 아래와 겹친다 — 따로 두지 않고 가장 가까운 빈 자리로 아일랜드를 밀어 붙인다(최대 1500)
      const deltas: number[] = [];
      for (const x of items.filter((x) => x.frame === rf && (x.level === 'tall' || x.level === 'base') && x.t < span[1] - 1 && x.t + x.w > span[0] + 1)) deltas.push(x.t + x.w + 20 - span[0], x.t - 20 - span[1]);
      for (const ct of counters.filter((ct) => ct.frame === rf && !ct.island && ct.t1 - ct.t0 >= span[1] - span[0])) {
        if (span[0] < ct.t0) deltas.push(ct.t0 - span[0]); else if (span[1] > ct.t1) deltas.push(ct.t1 - span[1]); else deltas.push(0);
      }
      for (const dl of [...new Set(deltas.map((x) => Math.round(x / 10) * 10))].filter((x) => x && Math.abs(x) <= 1500).sort((p0, p1) => Math.abs(p0) - Math.abs(p1))) {
        const pos = d.islandCfg.pos!;
        const d2 = { ...d, islandCfg: { ...d.islandCfg, pos: { ...pos, x: pos.x + rf.dir[0] * dl, z: pos.z + rf.dir[1] * dl } }, _islShift: ((d as { _islShift?: number })._islShift ?? 0) + 1 } as Design;
        const r = planOne(d2, cat, series, v, useFix, false);
        if (r?.island?.attached != null) { r.reasons.push(`아일랜드 붙일 자리가 장 · 냉장고와 겹쳐 ${Math.abs(dl)}mm 옮겨 코너장으로 연결`); return r; }
      }
    }
    if (!rf || items.some(hit) || !covered) {
      // 뒤 코너장(T자) 자리가 막혀서면 — 뒤 코너장 없이(앞 코너장만) 붙여 본다
      if (island.corner2 && !(d as { _noCorner2?: boolean })._noCorner2) {
        const r2 = planOne({ ...d, _noCorner2: true } as Design, cat, series, v, useFix, false);
        if (r2?.island?.attached != null) return r2;
      }
      const r = planOne(d, cat, series, v, useFix, true);
      r?.warnings.push('붙이려던 자리에 상판이 이어지지 않아(냉장고 · 키큰장 · 창 · 문) 아일랜드를 따로 두었습니다');
      return r;
    }
  }
  // 휠라는 장 줄 끝으로 — 벽과 이어지는 쪽(도어 열림 영역 확보)에 모은다. 하부장 · 상부장 줄마다. 그다음 후드장을 쿡탑 가운데로 다시 맞춘다
  const rangeOf = (x: Item): [number, number] | null => {
    const m = mods(x.key), o = W(x.key);
    if (!m || /fill/.test(x.key) || x.key === 'hood') return null;
    let lo = m.nstd && m.wmin ? m.wmin : Math.min(...o);
    const hi = m.nstd && m.wmax ? m.wmax : Math.max(...o);
    // 자동으로 줄일 때 쓸 만한 최소 — 장 300 (원본 최소 150 까지 줄면 문짝이 막대가 된다) · 쿡탑 조리장 600 (쿡탑 기기 폭). 이미 더 좁으면 그 폭
    lo = Math.min(x.w, Math.max(lo, x.tag === 'hob' ? 600 : 300));
    if (x.tag === 'dish') return [x.w, x.w];   // 식기세척기 기기 폭(600) 고정
    return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
  };
  for (const run of runs) {
    for (const lv of ['base', 'wall'] as const) {
      const pick = (x: Item) => x.frame === run.frame && x.level === lv && x.tag !== 'ep' && !/^corner|^wallCorner|^fridgeTop/.test(x.key);
      const row = items.filter(pick).sort((p, q) => p.t - q.t);
      const groups: Item[][] = [];
      for (const x of row) { const g = groups[groups.length - 1]; if (g && Math.abs(g[g.length - 1].t + g[g.length - 1].w - x.t) < 1) g.push(x); else groups.push([x]); }
      for (const g of groups) {
        // 휠라 = 벽과 닿는 끝마다 하나(도어 열림 영역 · ㅡ자면 양쪽 벽). 폭 50 ~ 150, 모자라면 옆 장을 줄이고 남으면 장을 늘림.
        // 벽에 닿지 않는 끝(EP · 코너 · 창 · 문)에는 휠라를 두지 않는다 — 그 폭은 장이 흡수
        const fills = g.filter((x) => /fill/.test(x.key)), rest = g.filter((x) => !fills.includes(x));
        if (!rest.length) continue;
        const s0 = g[0].t, s1 = g[g.length - 1].t + g[g.length - 1].w;
        const wallS = prevWall(run.wall) !== d.openWall || d.wing.b >= BASE_D, wallE = nextWall(run.wall) !== d.openWall || d.wing.a >= BASE_D;
        const atStart = s0 <= 1 && wallS, atEnd = s1 >= run.L - 1 && wallE;
        const k = (atStart ? 1 : 0) + (atEnd ? 1 : 0);
        const F = fills.reduce((sum, x) => sum + x.w, 0);
        // 장 폭 바꾸기 — 여닫이장 → 서랍장 → 식세 · 싱크 · 쿡탑장 순, 같은 등급이면 벽 끝에서 가까운 장부터
        const resizable = (x: Item) => !!rangeOf(x);
        const adjust = (order: Item[], delta: number) => {
          for (const x of byPriority(order, delta > 0)) {   // 키울 때는 역방향(식세 · 싱크 · 쿡탑장 먼저)
            if (!delta) break;
            if (!resizable(x)) continue;
            const r = rangeOf(x)!, nw = Math.max(r[0], Math.min(r[1], x.w + delta));
            delta -= nw - x.w; x.w = nw;
          }
          return delta;
        };
        const w0 = rest.map((x) => x.w);
        let per = k ? Math.max(50, Math.min(150, Math.round(F / k / 10) * 10)) : 0;
        let left = adjust(k && atStart && !atEnd ? rest : rest.slice().reverse(), F - per * k);   // 휠라와의 차이 → 장 폭
        // 장이 다 못 받은 만큼은 휠라가 (10 ~ 150)
        if (left && k) { const p2 = Math.max(10, Math.min(150, per + Math.round(left / k / 10) * 10)); left -= (p2 - per) * k; per = p2; }
        if (!k && left) { rest.forEach((x, i) => { x.w = w0[i]; }); continue; }   // 벽 없는 줄인데 장이 못 받으면 그대로
        // 휠라 — 옆 장이 낮은 상부장(창 위)이면 그 높이를 따른다
        const mk = (w: number, nb?: Item): Item => ({ key: lv === 'wall' ? 'wfill50' : 'bfill50', level: lv, frame: run.frame, t: 0, w, wall: run.wall, ...(nb?.ov?.NSTD_H ? { ov: { STD_YN: 'true', NSTD_H: nb.ov.NSTD_H } } : {}) });
        for (const f of fills) items.splice(items.indexOf(f), 1);
        const seq = [...(atStart ? [mk(per, rest[0])] : []), ...rest, ...(atEnd ? [mk(per, rest[rest.length - 1])] : [])];
        for (const x of seq) if (/fill/.test(x.key)) items.push(x);
        // 남은 몇 mm 는 끝 휠라에 더해 줄 길이를 맞춘다
        const sum = seq.reduce((a, x) => a + x.w, 0), gap = (s1 - s0) - sum;
        if (gap) { const f = seq.find((x) => /fill/.test(x.key)); if (f) f.w += gap; else { const r0 = rest.find(resizable); if (r0) r0.w += gap; } }
        let t = s0;
        for (const x of seq) { x.t = t; t += x.w; }
      }
    }
    const hob = items.find((x) => x.tag === 'hob' && x.frame === run.frame), hood = items.find((x) => x.key === 'hood' && x.frame === run.frame);
    if (hob && hood) {
      const dd = Math.round(hob.t + hob.w / 2 - (hood.t + hood.w / 2));
      if (dd) {
        // 같은 높이 상부장끼리만 — 창 위 낮은 상부장(NSTD_H)까지 묶으면 그 사이에 키 큰 휠라가 끼었다
        const ug = rowGroup(items, hood, (x) => x.level === 'wall' && x.tag !== 'ep' && !x.key.startsWith('wallCorner') && x.key !== 'fridgeTop' && !x.ov?.NSTD_H);
        const pl = nudge(ug, hood, dd, rangeOf, (w) => ({ key: 'wfill50', level: 'wall', frame: run.frame, t: 0, w, wall: run.wall }));
        if (pl) {
          for (const x of pl.remove) items.splice(items.indexOf(x), 1);
          items.push(...pl.add);
          for (const [x, w] of pl.w) x.w = w;
          for (const [x, tt] of pl.t) x.t = tt;
        }
      }
    }
    if (hob) hobP = P(run.frame, hob.t + hob.w / 2, BASE_D / 2);
    const sk = items.find((x) => x.tag === 'sink' && x.frame === run.frame);
    if (sk) sinkP = P(run.frame, sk.t + sk.w / 2, BASE_D / 2);
  }
  applyNonStandard(items, mods);

  // 아일랜드 장 — 앞 줄 하부장 · 끝 EP · 뒤 FIX 도어(수납 많이 = 뒤에도 하부장)
  let islandNote = '';
  if (island) {
    const f = island.frame, len = island.len, attEnd = island.attachedEnd;
    island.style = islStyle;
    let c0 = 0, c1 = len;
    // 끝 — EP. 통판 마감은 그 자리를 상판 재질 판이 막는다(3D)
    if (attEnd !== 0) { if (islStyle !== 'waterfall') items.push(ep('epB', f, 0)); c0 = 20; }
    if (attEnd !== 1) { if (islStyle !== 'waterfall') items.push(ep('epB', f, len - 20)); c1 = len - 20; }
    // 붙인 끝 — 벽 코너처럼 코너장 휠라 꺾임판 자리(CORNER_D − BASE_D = 50)를 비우고 장을 놓는다. 꺾임판 · 그 위 찬넬이 벽 장 찬넬과 이 줄 찬넬을 잇는다
    //   (예전엔 600 에서 바로 시작해 꺾임판이 섬 장과 겹치고 찬넬은 덧댄 조각으로만 이어졌다). FIX 면은 끝까지(fx0 · fx1)
    const fx0 = c0, fx1 = c1, CG = CORNER_D - BASE_D;
    const bk0 = attEnd === 0 && island.corner2 ? CG : c0, bk1 = attEnd === 1 && island.corner2 ? len - CG : c1;
    if (island.corner) { if (attEnd === 0) c0 = CG; else c1 = len - CG; }
    let cur = c0, i = 0;
    const front = (to: number) => {
      for (const w of fillGap(to - cur, baseOpts, baseMax)) {
        items.push({ key: w <= 150 ? pickBase(w, i) : i % 2 === 0 && W('drawer3').includes(w) ? 'drawer3' : pickBase(w, i), level: 'base', frame: f, t: cur, w, tag: 'island' });
        storageMM += w > 75 ? w : 0; cur += w; i++;
      }
    };
    // 쿡탑을 아일랜드로 옮겼으면 — 그 자리에 조리장(900), 앞뒤 틈은 휠라 하나(150) 이하 · 장 하나(300) 이상이 되게 민다
    const ihob = useFix && d.fix?.hob?.island ? d.fix.hob : null, hw = 900;
    if (ihob && c1 - c0 >= hw) {
      const ok = (g: number) => g <= 150 || g >= 300;
      let t0 = Math.max(c0, Math.min(c1 - hw, Math.round((ihob.c - hw / 2) / 10) * 10));
      if (!ok(t0 - c0)) t0 = t0 - c0 < 225 ? c0 : c0 + 300;
      if (!ok(c1 - t0 - hw)) t0 = c1 - t0 - hw < 225 ? c1 - hw : c1 - hw - 300;
      t0 = Math.max(c0, Math.min(c1 - hw, t0));
      front(t0);
      items.push({ key: 'cook2', level: 'base', frame: f, t: cur, w: hw, tag: 'hob' });
      hobP = P(f, cur + hw / 2, BASE_D / 2);
      cur += hw;
      reasons.push('쿡탑을 아일랜드에 — 후드는 천장형으로 따로');
    }
    front(c1);
    const bf: Frame = { o: P(f, len, 0), dir: [-f.dir[0], -f.dir[1]], n: [-f.n[0], -f.n[1]] };
    let bc = len - c1;
    if (twoSided) {
      // 뒤 줄 양끝 EP — 앞 줄 EP 와 등을 맞대 아일랜드 끝을 앞뒤 전체 깊이로 막는다(예전엔 뒤 줄 끝 20 이 비었다)
      //   뒤 줄은 거꾸로 선 줄이라 앞 t 0 끝 = 뒤 t len − 20
      if (attEnd !== 0) items.push(ep('epB', bf, len - 20));
      if (attEnd !== 1) items.push(ep('epB', bf, 0));
      let j = 1;
      bc = len - bk1;
      for (const w of fillGap(bk1 - bk0, baseOpts, baseMax)) {
        items.push({ key: w <= 150 ? pickBase(w, j) : W('drawer3').includes(w) && j % 2 ? 'drawer3' : pickBase(w, j), level: 'base', frame: bf, t: bc, w, tag: 'island' });
        storageMM += w > 75 ? w : 0; bc += w; j++;
      }
    } else {
      // 뒤 FIX 도어 — 원본 FIX 도어(도어 변수 = 지금 그레이드 도어). 원본 폭에 없는 끝 조각은 같은 재질 판
      const fixOpts = W('fix').filter((x) => x >= 200);
      bc = len - fx1;
      // 높이 — 섬 장 몸통(걸레받이 위 ~ 상판 밑 768)에 맞춘다. 원본은 규격 폭이면 H(EO −36 · KB −172), 비규격 폭(STD_YN)이면 NSTD_H(EO −178 · KB −172)로
      //   판 높이를 내서, 예전엔 비규격 한 장만 낮았고(사용자 「픽스도어 길이가 안 맞는다」) KB 는 전부 630 이었다 → 전부 비규격 높이로 통일(실측 tools/_probe-fixh.ts)
      const fixNH = String(768 + (series === 'KB' ? 172 : 178));
      for (const w of fillGap(fx1 - fx0, fixOpts, (x) => (x >= 200 ? 600 : 150))) {
        items.push({ key: w >= 150 ? 'fix' : 'fixFill', level: 'base', frame: bf, t: bc, w, tag: 'fix', ov: { NSTD_H: fixNH } });
        bc += w;
      }
    }
    const z0 = twoSided ? -COUNTER_D : -(20 + cfg.over);
    counters.push({ frame: f, t0: attEnd === 0 ? COUNTER_D - BASE_D : 0, t1: attEnd === 1 ? len - (COUNTER_D - BASE_D) : len, z0, z1: COUNTER_D, island: true });
    counterMM += len;
    if (island.corner) reasons.push(`아일랜드를 ${wallName(d.openWall, island.attached!)} 장에 붙임 — 붙인 자리에 코너장을 넣어 ㄱ자로 연결`);
    const styleNote = islStyle === 'waterfall' ? ' · 양끝 통판 마감' : islStyle === 'table' ? ` · 끝에 연계형 식탁 ${ISLAND_TABLE.len}×${ISLAND_TABLE.w}` : islStyle === 'round' ? ` · 끝에 원형 식탁 Ø${ISLAND_TABLE.round}` : '';
    islandNote = (twoSided ? `아일랜드 ${len}mm — 양면 수납` : `아일랜드 ${len}mm — 뒤 FIX 도어${cfg.over >= 200 ? `, 상판 ${cfg.over}mm 내밀어 의자 자리` : ''}`) + styleNote;
    // 식탁이 붙는 끝(붙지 않은 끝) — 방 밖 검사에 식탁 자리까지
    const ext = islStyle === 'table' ? ISLAND_TABLE.len : islStyle === 'round' ? ISLAND_TABLE.round - ISLAND_TABLE.overlap : 0;
    const te0 = attEnd === 1 ? -ext : 0, te1 = attEnd === 1 ? len : len + ext;
    const corners = [[te0, z0], [te1, z0], [te1, COUNTER_D], [te0, COUNTER_D]].map(([t, z]) => P(f, t, z));
    if (corners.some(([x, z]) => x < -1 || z < -1 || x > room.w + 1 || z > room.d + 1)) warnings.push('아일랜드가 방 밖으로 나갑니다');
  }

  // 코너장 L — 원본 틀 폭은 W + 100 이고 몸통이 오른쪽(100 ~ W+100)에 있다(코너 쪽 100 은 빈 틈). R 은 몸통이 왼쪽(0 ~ W).
  // 자리 계산은 틀 시작 기준이므로 L 은 장 자리(t)를 몸통 시작으로 100 옮긴다 — 걸레받이 · 찬넬 · 고르기 상자가 몸통에 맞게
  for (const it of items) if (it.key === 'cornerL') it.t += 100;
  applyNonStandard(items, mods);
  // 점수
  const dist = (p?: [number, number], q?: [number, number]) => (p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : NaN);
  const legs = [dist(sinkP, hobP), dist(hobP, fridgeP), dist(fridgeP, sinkP)];
  const tri = legs.every((x) => !Number.isNaN(x)) ? legs.reduce((s, x) => s + x, 0) : NaN;
  const triScore = Number.isNaN(tri) ? 0.6 : tri < 3600 ? 0.5 + 0.5 * tri / 3600 : tri <= 6600 ? 1 : Math.max(0, 1 - (tri - 6600) / 4000);
  const prep = sinkP && hobP ? Math.abs(dist(sinkP, hobP)) - 950 : 0;
  const prepScore = prep >= 600 ? 1 : Math.max(0, prep / 600);
  const door = d.openings.find((o) => o.kind === 'door');
  const doorP = door ? wallPoint(room, door.wall, door.t + door.w / 2, 0)
    : d.openWall != null ? wallPoint(room, d.openWall, wallLength(room, d.openWall) / 2, 0) : undefined;
  const flow = fridgeP && doorP ? Math.max(0, 1 - dist(fridgeP, doorP) / (room.w + room.d)) : 0.5;
  const storeNeed = { basic: 6000, cafe: 4000, storage: 11000 }[d.style];
  const storeScore = Math.min(1, storageMM / storeNeed);
  const light = (sinkUnderWindow ? 1 : 0.4) * (hobUnderWindow ? 0.5 : 1);
  // 냉장고장을 일부러 뺐으면(noFridge) 감점 · 경고 없음
  const islandBonus = (d.island ? (islandNote ? 1 : 0.7) : 1) * (fridgeP || d.noFridge ? 1 : 0.95);
  if (!fridgeP && !d.noFridge) warnings.push('냉장고장은 빼고 배치했습니다 — 길이가 모자라 싱크 · 식기세척기 · 쿡탑을 먼저 넣었어요. 냉장고는 따로 두세요');
  const metrics = { 작업삼각형: Math.round(triScore * 100), 조리공간: Math.round(prepScore * 100), 수납: Math.round(storeScore * 100), 채광: Math.round(light * 100), 동선: Math.round(flow * 100) };
  const wts = [...{ basic: [0.3, 0.2, 0.2, 0.15, 0.15], cafe: [0.25, 0.2, 0.1, 0.25, 0.2], storage: [0.2, 0.15, 0.4, 0.1, 0.15] }[d.style], 0];
  // 바라는 것 — 그 항목 가중을 올린다. 답답하지 않게 = 채광 + 개방감(벽 길이 대비 상부장이 적을수록 · 아일랜드 둘레 통로)
  const wants = d.wants ?? [];
  const wallLen = runs.reduce((s2, r) => s2 + (r.b - r.a), 0) || 1;
  const upperLen = items.filter((x) => x.level === 'wall' && x.wall != null && !/^ep|fill/.test(x.key)).reduce((s2, x) => s2 + x.w, 0);
  const openness = Math.max(0, Math.min(1, 1 - upperLen / wallLen + (d.island ? -0.1 : 0.1)));
  if (wants.includes('storage')) wts[2] *= 1.8;
  if (wants.includes('open')) { wts[3] *= 1.5; wts[5] = 0.25; }
  if (wants.includes('flow')) { wts[0] *= 1.6; wts[4] *= 1.6; }
  if (wants.includes('cook')) wts[1] *= 1.8;
  const wsum = wts.reduce((a2, b2) => a2 + b2, 0);
  const score = Math.round(100 * islandBonus * (wts[0] * triScore + wts[1] * prepScore + wts[2] * storeScore + wts[3] * light + wts[4] * flow + wts[5] * openness) / wsum);
  if (wants.includes('open')) (metrics as Record<string, number>)['개방감'] = Math.round(openness * 100);
  if (wants.length) reasons.push(`바라는 것을 점수에 반영 — ${wants.map((w) => WANT_LABEL[w]).join(' · ')}`);

  if (!Number.isNaN(tri)) reasons.push(`작업 삼각형(싱크·쿡탑·냉장고) ${(tri / 1000).toFixed(1)}m — 권장 3.6~6.6m${tri >= 3600 && tri <= 6600 ? ' 안' : ' 밖'}`);
  if (sinkUnderWindow) reasons.push('싱크를 창 아래에 — 낮에 설거지 자리가 밝음');
  if (hobUnderWindow) warnings.push('쿡탑이 창 가까이 — 후드 · 커튼 화재 주의');
  if (prep > 0) reasons.push(`싱크와 쿡탑 사이 조리대 ${Math.round(prep / 10) * 10}mm${prep >= 600 ? '' : ' (600 이상 권장)'}`);
  reasons.push(`하부 조리대 ${(counterMM / 1000).toFixed(1)}m · 수납 ${STYLE[d.style].label} 기준 ${metrics.수납}%`);
  if (islandNote) reasons.push(islandNote);
  for (const o of d.openings) if (o.kind !== 'window' && o.kind !== 'door') reasons.push(`${OPENING_INFO[o.kind].label} 입구를 비우고 배치`);

  const title = `${{ I: 'ㅡ자', L: 'ㄱ자', Lr: 'ㄱ자', U: 'ㄷ자', II: '11자', walls: '벽 선택' }[d.layout]} · ${v.walls.map((w) => wallName(d.openWall, w, true)).join('+')}${v.sinkAtWindow && sinkUnderWindow ? ' · 창가 싱크' : ''}`;
  return {
    id: `${v.walls.join('')}-${v.sinkRun}${v.hobRun}${v.fridgeRun}${v.fridgeEnd[0]}${v.sinkAtWindow ? 'w' : ''}${v.flip ? 'f' : ''}`,
    title, layout: d.layout, walls: v.walls, items, counters, splashes, sink: sinkP, hob: hobP, fridge: fridgeP, island, score, metrics, reasons, warnings,
    skips: runs.flatMap((r) => [...(r.cornerStart === 'skip' ? [{ wall: r.wall, end: 0 as const }] : []), ...(r.cornerEnd === 'skip' ? [{ wall: r.wall, end: 1 as const }] : [])]),
  };
}

/** 원본 규격 폭에 없는 폭 → 비규격(STD_YN=true · NSTD_W). 범위 밖이면 범위 끝으로 */
export function applyNonStandard(items: Item[], mods: (k: string) => ModuleDef | undefined) {
  for (const it of items) {
    const m = mods(it.key);
    if (!m?.W || it.tag === 'ep' || it.key === 'fridgeTop') continue;
    const std = m.W.options?.length ? m.W.options.includes(it.w) : (m.W.min ?? 0) <= it.w && it.w <= (m.W.max ?? Infinity);
    const ov = { ...(it.ov ?? {}) };
    delete ov.STD_YN; delete ov.NSTD_W;
    if (!std && m.nstd) { ov.STD_YN = 'true'; ov.NSTD_W = String(it.w); }
    // 비규격 높이(창 위 상부장 · 냉장고 윗장)는 STD_YN 이 있어야 먹는다. STD_YN 을 켜면 폭도 NSTD_W 로만 읽혀서(없으면 원본 기본 800) 폭을 같이 넣는다
    if (ov.NSTD_H || ov.NSTD_D) { ov.STD_YN = 'true'; ov.NSTD_W = String(it.w); }
    it.ov = Object.keys(ov).length ? ov : undefined;
  }
}

/* ───────── 벽 조합 후보 ───────── */
function wallSets(d: Design): WallId[][] {
  const all: WallId[] = ([0, 1, 2, 3] as WallId[]).filter((w) => w !== d.openWall);
  const freeLen = (w: WallId) => subtract(0, wallLength(d.room, w), blocks(d.openings, w).base).reduce((s, [a, b]) => s + b - a, 0);
  // 정면 = 트인 쪽(거실)에 서서 마주 보는 벽 — ㅡ자는 정면, ㄱ자는 정면 + 왼쪽/오른쪽, ㄷ자는 정면 + 양옆, 11자는 양옆
  const v = viewWalls(d.openWall), F = v.front;
  switch (d.layout) {
    case 'I': {
      if (freeLen(F) >= 2400) return [[F]];
      // 정면이 막혔으면(다용도실 · 서브주방 입구 등) 옆 벽
      return [v.left, v.right].filter((w) => w !== d.openWall && freeLen(w) >= 2400).map((w) => [w]);
    }
    // ㄱ자 = 왼쪽 + 정면 · ㄱ자 반대 = 정면 + 오른쪽 (예전엔 ㄱ자가 둘 다 후보로 내서 고른 모양과 다른 쪽이 나오기도 했다)
    case 'L': return ([[prevWall(F), F]] as WallId[][]).filter((p) => p.every((w) => w !== d.openWall && freeLen(w) >= 1500));
    case 'Lr': return ([[F, nextWall(F)]] as WallId[][]).filter((p) => p.every((w) => w !== d.openWall && freeLen(w) >= 1500));
    case 'U': return ([[prevWall(F), F, nextWall(F)]] as WallId[][]).filter((p) => p.every((w) => w !== d.openWall && freeLen(w) >= 1200));
    case 'II': return ([[v.left, v.right]] as WallId[][]).filter((p) => wallLength(d.room, F) >= 600 * 2 + 1000 && p.every((w) => w !== d.openWall && freeLen(w) >= 1500)).map((p) => orderWalls(p));
    default: { const ws = d.walls.filter((w) => w !== d.openWall); return ws.length ? [orderWalls(ws)] : []; }
  }
}
/** 벽 선택을 시계 방향으로 이어지게 — 끊긴 곳에서 시작 */
function orderWalls(ws: WallId[]): WallId[] {
  const set = new Set(ws);
  const start = ws.find((w) => !set.has(prevWall(w))) ?? ws[0];
  const out: WallId[] = [];
  let w = start;
  for (let i = 0; i < 4; i++) { if (set.has(w)) out.push(w); w = nextWall(w); }
  return out;
}

export function autoPlan(d: Design, cat: KitchenCatalog, series: Series, max = 4): Candidate[] {
  let out = collect(d, cat, series, true);
  // 옮긴 자리가 이 공간 구조와 맞지 않으면(그 벽에 장이 없음) 무시하고 다시
  if (!out.length && d.fix && Object.keys(d.fix).length) out = collect(d, cat, series, false);
  // 코너 팬트리장을 켰는데 놓을 코너가 없으면(一자 · 코너 앞 문 · 창) 빼고 다시 — 배치 자체가 사라지지 않게
  if (!out.length && d.cornerPantry) {
    out = collect(d, cat, series, true, false);
    if (!out.length && d.fix && Object.keys(d.fix).length) out = collect(d, cat, series, false, false);
    for (const c of out) c.reasons.unshift('코너 팬트리장 — 놓을 수 있는 코너가 없어 뺐습니다(두 벽 모두 코너에서 1020 이 비어 있어야 함)');
  }
  // 냉장고장 자리를 골랐으면 그 벽에 냉장고가 선 안만 — 점수가 낮다고 빠지면 고른 자리가 무시된 것처럼 보인다
  const fa = d.fridgeAt, honor = fa ? out.filter((c) => c.items.some((x) => x.tag === 'fridge' && x.wall === fa.wall)) : [];
  if (honor.length) out = honor;
  return pickTop(out, max);
}
function collect(d: Design, cat: KitchenCatalog, series: Series, useFix: boolean, pantryOn = !!d.cornerPantry): Candidate[] {
  const out: Candidate[] = [];
  const fx = useFix ? d.fix ?? {} : {};
  // 코너 팬트리장 — 체크(cornerPantry)한 대로만. 수납 많이를 고르면 체크가 켜진다(사용자 2026-11-05). 원본은 유로 계열에만 있다
  const hasPantry = cat.modules.some((m) => m.key === 'pantryCorner' && (m.series === series || m.series === '*'));
  const pantryOpts = hasPantry && pantryOn ? [true] : [false];
  for (const walls of wallSets(d)) {
    const n = walls.length;
    for (let sinkRun = 0; sinkRun < n; sinkRun++) {
      if (fx.sink && walls[sinkRun] !== fx.sink.wall) continue;
      const hobRuns = fx.hob?.island && d.island ? [-1] : fx.hob ? walls.map((w, i) => (w === fx.hob!.wall ? i : -1)).filter((i) => i >= 0) : n === 1 ? [0] : [...new Set([sinkRun, (sinkRun + 1) % n])];
      for (const hobRun of hobRuns) {
        // 냉장고장 자리를 골랐으면 그 벽 · 그 끝만 (그 벽이 이 조합에 없으면 자동)
        const fa = useFix && d.fridgeAt && walls.includes(d.fridgeAt.wall) ? d.fridgeAt : null;
        for (const fridgeRun of fa ? [walls.indexOf(fa.wall)] : [...new Set([0, n - 1])]) {
          for (const fridgeEnd of fa ? [fa.end] : (['start', 'end'] as const)) {
            for (const sinkAtWindow of fx.sink ? [false] : [true, false]) {
              for (const flip of [false, true]) for (const pantry of pantryOpts) {
                const c = planOne(d, cat, series, { walls, sinkRun, hobRun, fridgeRun, fridgeEnd, sinkAtWindow, flip, pantry }, useFix);
                if (c && c.items.some((x) => x.tag === 'hob') && (!pantry || c.items.some((x) => x.key === 'pantryCorner'))) out.push(c);
              }
            }
          }
        }
      }
    }
  }
  return out;
}
function pickTop(out: Candidate[], max: number): Candidate[] {
  // 점수순 · 벽 조합과 기능 배치가 겹치지 않게
  out.sort((a, b) => b.score - a.score);
  const seen = new Set<string>(), pick: Candidate[] = [];
  for (const c of out) {
    const sig = `${c.walls.join()}|${c.sink?.map((x) => Math.round(x / 300)).join()}|${c.hob?.map((x) => Math.round(x / 300)).join()}|${c.fridge?.map((x) => Math.round(x / 300)).join()}`;
    if (seen.has(sig)) continue;
    seen.add(sig); pick.push(c);
    if (pick.length >= max) break;
  }
  return pick;
}
