// 부엌 설계 데이터 — 단위 mm, 평면 좌표(위에서 본 그림): x 오른쪽, z 아래(방 앞쪽). 방 안쪽 = [0,W]×[0,D]
//
// 벽 번호(시계 방향으로 돈다 — 벽을 따라 걸으면 방 안쪽이 늘 오른쪽):
//   0 뒷벽  (0,0)→(W,0)    1 오른쪽 벽 (W,0)→(W,D)    2 앞벽 (W,D)→(0,D)    3 왼쪽 벽 (0,D)→(0,0)
// 벽 위 위치 t = 그 벽 시작점에서 진행 방향으로 잰 거리.

export type WallId = 0 | 1 | 2 | 3;
export const WALL_NAMES = ['뒷벽', '오른쪽 벽', '앞벽', '왼쪽 벽'] as const;
/** 보는 쪽 기준 벽 — 정면 = 트인 쪽(거실)에 서서 마주 보는 벽. 트인 쪽이 없으면 앞벽 쪽에서 봄(3D 정면 · 평면도 아래와 같음) */
export function viewWalls(open: WallId | null | undefined) {
  const o = (open ?? 2) as number;
  return { front: ((o + 2) % 4) as WallId, left: ((o + 1) % 4) as WallId, right: ((o + 3) % 4) as WallId, near: o as WallId };
}
/** 보는 쪽 기준 벽 이름 — 정면 · 왼쪽 · 오른쪽 · 거실 쪽 */
export function wallName(open: WallId | null | undefined, w: WallId, short = false): string {
  const v = viewWalls(open);
  const n = w === v.front ? '정면' : w === v.left ? '왼쪽' : w === v.right ? '오른쪽' : open != null ? '거실 쪽' : '앞쪽';
  return short ? n : `${n} 벽`;
}

/** 공간 구조 — ㅡ자 · ㄱ자(왼쪽 + 정면) · ㄱ자 반대(정면 + 오른쪽) · ㄷ자 · 11자(마주 보는 두 벽) · 벽마다 직접 고르기 */
export type LayoutKind = 'I' | 'L' | 'Lr' | 'U' | 'II' | 'walls';
export type StyleKind = 'basic' | 'cafe' | 'storage';

/** 공간 요소 — 출입문 · 창문 · 팬트리 · 다용도실 · 서브주방 (벽에 붙어 벽을 따라 끌고 폭을 바꾼다) */
export type OpeningKind = 'door' | 'window' | 'pantry' | 'utility' | 'subkitchen';
export interface Opening {
  id: string;
  kind: OpeningKind;
  wall: WallId;
  /** 벽 시작점에서 개구부 시작까지 */
  t: number;
  /** 폭 */
  w: number;
  /** 높이 */
  h: number;
  /** 바닥에서 아래 끝 (창대) — 문·통로는 0 */
  sill: number;
  /** 벽 너머 공간 깊이 (팬트리 · 다용도실 · 서브주방) */
  depth?: number;
  /** 입구 문 — 여닫이(기본) · 미닫이 · 폴딩. 다용도실 · 서브주방 */
  door?: 'swing' | 'sliding' | 'folding';
}

export const OPENING_INFO: Record<OpeningKind, { label: string; w: number; h: number; sill: number; depth?: number; minW: number; maxW: number; color: string }> = {
  door: { label: '출입문', w: 900, h: 2100, sill: 0, minW: 700, maxW: 1800, color: '#8a6b4e' },
  window: { label: '창문', w: 1500, h: 1200, sill: 1000, minW: 400, maxW: 4000, color: '#4f8fd6' },
  pantry: { label: '팬트리', w: 1200, h: 2100, sill: 0, depth: 1500, minW: 800, maxW: 3000, color: '#b07a3a' },
  utility: { label: '다용도실', w: 900, h: 2100, sill: 0, depth: 1800, minW: 700, maxW: 2400, color: '#5a8f6a' },
  subkitchen: { label: '서브주방', w: 1400, h: 2100, sill: 0, depth: 1800, minW: 900, maxW: 3000, color: '#8b5fb0' },
};

export interface Room { w: number; d: number; h: number }
/** 냉장고 패널 — 삼성 비스포크 계열 색(이름 · 색 · 유광 여부) */
export const FRIDGE_COLORS: [string, string, string, boolean][] = [
  ['cotta-white', '코타 화이트', '#ecebe6', false], ['satin-beige', '새틴 베이지', '#d9cfbf', false], ['glam-white', '글램 화이트', '#f3f3f1', true],
  ['satin-gray', '새틴 그레이', '#b8b8b5', false], ['cotta-charcoal', '코타 차콜', '#4a4b4d', false], ['morning-blue', '모닝 블루', '#b5c3cf', false],
  ['satin-sage', '새틴 세이지 그린', '#b7c2ad', false],
];
export type FixKey = 'sink' | 'dish' | 'hob';
export const FIX_LABEL: Record<FixKey, string> = { sink: '싱크장', dish: '식기세척기장', hob: '쿡탑' };

/** 아일랜드 — 길이(EP 포함) · 뒤로 내민 상판(의자 자리) · 사용자가 옮긴 위치(없으면 자동).
 *  rot = 장 앞면이 보는 방향 0 뒷벽 쪽 · 90 오른쪽 · 180 앞벽 쪽 · 270 왼쪽 */
export interface IslandCfg { len: number; over: number; pos?: { x: number; z: number; rot: 0 | 90 | 180 | 270 }; style?: IslandStyle }
/** 아일랜드 형태 — 한샘 부엌 카탈로그(2026.09) 사진 기준.
 *  basic 일자(앞 수납 · 뒤 FIX) · double 양면 수납 · waterfall 통판 마감(양끝을 상판 재질로 바닥까지, 트레버틴 아일랜드) ·
 *  table 연계형 식탁(끝에 나무 식탁, 오리진 · ㄱ자 아일랜드 쪽) · round 원형 식탁 결합(EO900 테이트). 없으면 스타일 따라(수납 많이 = 양면) */
export type IslandStyle = 'basic' | 'double' | 'waterfall' | 'table' | 'round';
export const ISLAND_STYLES: [IslandStyle, string, string][] = [
  ['basic', '일자', '앞 수납 · 뒤 FIX 판'],
  ['double', '양면 수납', '앞뒤 모두 하부장'],
  ['waterfall', '통판 마감', '양끝을 상판 재질로 바닥까지'],
  ['table', '연계형 식탁', '끝에 나무 식탁 1200×800'],
  ['round', '원형 식탁', '끝에 Ø1000 원형 식탁 (식탁 높이)'],
];
/** 연계형 · 원형 식탁 — 높이 · 크기(mm) */
export const ISLAND_TABLE = { h: 750, len: 1200, w: 800, round: 1000, overlap: 0 } as const;
export const ISLAND_LIMITS = { len: [1200, 3600], over: [0, 450] } as const;

export type Want = 'storage' | 'open' | 'flow' | 'cook' | 'dine';
export const WANT_LABEL: Record<Want, string> = { storage: '수납 많이', open: '답답하지 않게', flow: '동선이 편하게', cook: '요리를 자주', dine: '식사 자리' };
export interface Design {
  room: Room;
  layout: LayoutKind;
  /** layout 'walls' 일 때 장을 놓을 벽, 그 외에는 자동 배치가 고른 벽(기록용) */
  walls: WallId[];
  island: boolean;
  islandCfg: IslandCfg;
  /** 거실과 이어진 트인 쪽 — 그 벽은 만들지 않고 장도 놓지 않는다. 정면 = 이쪽에서 본 방향 */
  openWall: WallId | null;
  /** 트인 쪽 날개벽 길이 — a = 트인 벽 시작 쪽, b = 끝 쪽 (0 이면 없음). 두께는 WALL_T */
  wing: { a: number; b: number };
  /** 사용자가 옮긴 싱크장 · 식기세척기장 · 쿡탑 자리 — 벽과 그 벽 위 가운데(mm). 없으면 자동 */
  fix?: Partial<Record<FixKey, { wall: WallId; c: number; island?: boolean }>>;
  /** 쿡탑(기기) 방향 — 상판 위에서 돌린 각(도, 90 단위, three 회전 방향). 장은 그대로 */
  hobRot?: number;
  /** 냉장고장 · 키큰장 묶음 자리 — 그 벽 줄의 시작(마주 보면 왼쪽) · 끝(오른쪽). 없으면 자동 */
  fridgeAt?: { wall: WallId; end: 'start' | 'end' };
  /** 냉장고 — twin = 비스포크 1도어 2대(1200 자리 + 냉장고 윗장, 기본) · sbs = 양문형(1100 자리) · quad = 4도어(1280 자리) · builtin = 원본 빌트인 냉장고장(T콤비 600) */
  fridgeKind?: 'twin' | 'sbs' | 'quad' | 'builtin';
  /** 코너 팬트리장 — 켜면 코너 하나에 코너장 대신 원본 T코너팬트리(유로 계열만). 끄면 수납 많이 스타일에서만 자동으로 시도 */
  cornerPantry?: boolean;
  /** 냉장고장 빼기 — true 면 냉장고 · 키큰장 묶음 없이 배치(그 자리는 일반장) */
  noFridge?: boolean;
  /** 바라는 것(프롬프트) — 배치안 점수 가중치에 반영. storage 수납 · open 답답하지 않게 · flow 동선 · cook 요리 · dine 식사 */
  wants?: Want[];
  /** 상부장 하나를 유리장으로(카탈로그 유리 벽장 포인트) */
  glassAccent?: boolean;
  /** 냉장고 패널 색 — 삼성 비스포크 패널(FRIDGE_COLORS 키). 없으면 코타 화이트 */
  fridgeColor?: string;
  /** 거실(T자) 크기 — 깊이 · 부엌보다 넓게 나간 양 어깨(a = 트인 벽 시작 쪽 · b = 끝 쪽). 없으면 기본 */
  living?: { depth: number; a: number; b: number };
  style: StyleKind;
  grade: string;
  door: string;
  counter: string;
  tile: string;
  floor: string;
  /** 벽지 — 전체(기본). '' = 페인트 */
  wallpaper: string;
  /** 벽지 나눠 고르기 — 전체 위에 공간별(kitchen 부엌 · living 거실 · room 벽 너머 공간)이, 그 위에 벽마다
   *  (k0~k3 부엌 벽 · l10~l16 거실 벽 · r{개구부 id} 벽 너머 공간 하나)가 덮는다. '' = 페인트 */
  wallpaperBy?: Record<string, string>;
  /** 벽 마감(상판 ~ 상부장 사이) — 벽마다 타일(기본) 또는 벽판넬과 그 치수. 없으면 자동(상판 줄 길이 · 높이 620 · 상판 위) */
  splash?: Partial<Record<WallId, SplashCfg>>;
  /** 식탁 — 한샘 식탁 · 식탁의자(홈뷰 상품). shape 원형 · 타원 · 4각, seats 4 · 6인, code 상품, where 거실 쪽(기본) · 부엌 가운데, rot 더 돌림(도), pos 사용자 자리 */
  dining?: { on: boolean; shape: 'round' | 'oval' | 'rect'; seats: 4 | 6; code?: string; where?: 'living' | 'kitchen'; rot?: number; pos?: { x: number; z: number; rot: number } };
  /** 가전 — 카탈로그 모델기호(쿡탑 · 후드 · 싱크볼 · 수전 · 식기세척기 · 오븐). 없으면 기본 */
  appliance?: Partial<Record<'hob' | 'hood' | 'sink' | 'faucet' | 'dish' | 'oven', string>>;
  openings: Opening[];
  /** 장 배치 길이 — 벽마다 장을 놓을 길이(벽 끝에서 mm). 없으면 벽 끝까지. 코너가 이어진 쪽이 기준이고 반대쪽 끝을 자른다(잘린 끝은 EP).
   *  양 끝이 다 트인 벽(ㅡ자 등)은 from 으로 시작(마주 보면 왼쪽) · 끝(오른쪽) 기준을 고른다 */
  runLen?: Partial<Record<WallId, { len: number; from?: 'start' | 'end' }>>;
}

/** 벽 마감 하나 — kind 타일 · 벽판넬(카탈로그 「세라믹 벽판넬 6T」, 재질 = 상판 목록). t0 · len 은 그 벽 시작에서(상판 줄 안으로 자름),
 *  depth 두께 · h 높이 · y 배치 높이(바닥에서 아래 끝). 비운 값은 자동 */
export interface SplashCfg { kind: 'tile' | 'panel'; mat?: string; t0?: number; len?: number; depth?: number; h?: number; y?: number }
export const SPLASH_DEFAULT = { tileDepth: 8, panelDepth: 6, h: 620 } as const;
export type WallSpace = 'kitchen' | 'living' | 'room';
/** 이 벽의 벽지 — 벽마다 → 공간별 → 전체 */
export function wallpaperOf(d: Design, space: WallSpace, key: string): string {
  const by = d.wallpaperBy ?? {};
  return by[key] ?? by[space] ?? d.wallpaper;
}
export function wallLength(r: Room, w: WallId) { return w % 2 === 0 ? r.w : r.d; }
/** 벽 시작점 · 진행 방향 · 방 안쪽 법선 (평면 x,z) */
export function wallFrame(r: Room, w: WallId) {
  switch (w) {
    case 0: return { o: [0, 0], dir: [1, 0], n: [0, 1] };
    case 1: return { o: [r.w, 0], dir: [0, 1], n: [-1, 0] };
    case 2: return { o: [r.w, r.d], dir: [-1, 0], n: [0, -1] };
    default: return { o: [0, r.d], dir: [0, -1], n: [1, 0] };
  }
}
/** 벽 위 t 와 안쪽으로 들어간 거리 u → 평면 점 */
export function wallPoint(r: Room, w: WallId, t: number, u = 0): [number, number] {
  const f = wallFrame(r, w);
  return [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
}
/** 평면 점 → 가장 가까운 벽과 그 위치 */
export function nearestWall(r: Room, x: number, z: number, skip: WallId | null = null): { wall: WallId; t: number; dist: number } {
  const c: { wall: WallId; t: number; dist: number }[] = (<{ wall: WallId; t: number; dist: number }[]>[
    { wall: 0, t: x, dist: Math.abs(z) },
    { wall: 1, t: z, dist: Math.abs(r.w - x) },
    { wall: 2, t: r.w - x, dist: Math.abs(r.d - z) },
    { wall: 3, t: r.d - z, dist: Math.abs(x) },
  ]).filter((x) => x.wall !== skip);
  return c.sort((a, b) => a.dist - b.dist)[0];
}
export const nextWall = (w: WallId): WallId => ((w + 1) % 4) as WallId;
export const prevWall = (w: WallId): WallId => ((w + 3) % 4) as WallId;

let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function newOpening(kind: OpeningKind, r: Room, wall: WallId, t?: number): Opening {
  const i = OPENING_INFO[kind];
  const L = wallLength(r, wall);
  const w = Math.min(i.w, L - 200);
  return { id: newId('o'), kind, wall, t: t ?? Math.max(100, (L - w) / 2), w, h: i.h, sill: i.sill, depth: i.depth };
}

/** 개구부를 벽 안으로 (끝에서 50 띄움) */
export function clampOpening(o: Opening, r: Room) {
  const L = wallLength(r, o.wall);
  const i = OPENING_INFO[o.kind];
  o.w = Math.max(i.minW, Math.min(i.maxW, o.w, L - 100));
  o.t = Math.max(50, Math.min(L - 50 - o.w, o.t));
  o.h = Math.max(300, Math.min(r.h - (o.kind === 'window' ? 50 : 0), o.h));
  if (o.kind === 'window') o.sill = Math.max(0, Math.min(r.h - o.h - 50, o.sill));
}

export const LIVING_DEFAULT = { depth: 4000, a: 1500, b: 1500 };
export const livingOf = (d: Design) => ({ ...LIVING_DEFAULT, ...(d.living ?? {}) });
export const LIVING_LIMITS = { depth: [1800, 8000], side: [0, 4000] } as const;
export function defaultDesign(): Design {
  const room = { w: 4200, d: 3600, h: 2400 };
  return {
    room, layout: 'L', walls: [0, 3], island: false, islandCfg: { len: 2400, over: 300 }, openWall: 3, wing: { a: 0, b: 0 }, style: 'basic', grade: 'e500', door: '', counter: '3FO4670BDNWY', tile: '3FO406QMAXD4', floor: '', wallpaper: '',
    openings: [
      { id: 'o-win', kind: 'window', wall: 0, t: 1300, w: 1500, h: 1100, sill: 1050 },
    ],
  };
}

const KEY = 'kitchen-planner.design.v1';
export function loadDesign(): Design {
  try {
    const s = localStorage.getItem(KEY);
    if (s) { const d = { ...defaultDesign(), ...JSON.parse(s) } as Design; d.islandCfg ??= { len: 2400, over: 300 }; if (d.openWall === undefined) d.openWall = 3; d.wing ??= { a: 0, b: 0 }; d.openings = d.openings.filter((o) => o.kind !== 'door'); for (const o of d.openings) if (o.wall === d.openWall) { o.wall = ((o.wall + 1) % 4) as WallId; clampOpening(o, d.room); } return d; }
  } catch { /* 저장 못 읽으면 기본 */ }
  return defaultDesign();
}
export function saveDesign(d: Design) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 저장 못 해도 화면은 그대로 */ }
}
