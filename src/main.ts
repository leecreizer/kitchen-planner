// 부엌 셀프 설계 — 단계 패널 · 자동 배치 · 3D · 평면도를 잇는다
import { devact, devlog, recentActs } from './devlog';   // 개발 서버 기록(오류 · 3D 상태) — 다른 모듈보다 먼저
import { applyNonStandard, autoPlan, upperBottomOf, FRIDGE_SPEC, fridgeSpec, STYLE_LABEL, widthsOf, wallBlocks, BASE_D, WALL_D, CORNER_D, COUNTER_D, type Candidate, type Frame, type Item } from './autoplan';
import { buildKitchen, buildSplashes, setDoors, type KitchenObj } from './kitchen3d';
import type { DoorPart } from './cabinet3d';
import { doorGaps, loadCatalog, texUrl, usableDoors, type DoorDef, type GradeDef, type KitchenCatalog, type ModuleDef } from './kjlLib';
import { DINING_SETS, DINING_SHAPES, buildDining, diningOf, diningPlace } from './dining3d';
import { APPLIANCES, APPLIANCE_CATS, DOOR_MISSING, applianceOf, counterLabel, doorLabel, type ApplianceCat } from './catalog';
import { PlanView } from './plan2d';
import { INLET_INFO, MEP_ASSUME, SYS_COLOR, SYS_LABEL, SYS_LIST, mepAim, mepOf, snapFloor, snapWall, type Sys, type V3, type WallSeg } from './mep';
import { buildMep3d } from './mep3d';
import {
  FIX_LABEL, FRIDGE_COLORS, ISLAND_LIMITS, ISLAND_STYLES, SPLASH_DEFAULT, LIVING_LIMITS, OPENING_INFO, WALL_NAMES, livingOf, nextWall, prevWall, viewWalls, wallName, clampOpening, nearestWall, wallFrame, loadDesign, anyWallName, isKitchenWall, nearestAnyWall, wallLine, wallRun, wallPoint, newId, type AnyWall, type InletKey, newOpening, saveDesign as storeDesign, wallLength, wallpaperOf,
  CLEAR_DEFAULT, CLEAR_LABEL, CLEAR_LIMITS, clearOf, cabSpan,
  type Clearance, type Design, type FixKey, type LayoutKind, type Opening, type OpeningKind, type StyleKind, type WallId, type WallSpace, type IslandStyle, type SplashCfg,
} from './plan';
import { buildRoom, liveOpening } from './room3d';
import { CEILING_LIGHTS, OUTDOOR, QUALITY_TIERS, Stage, type CeilingLight, type Quality, type RenderMode, type RoomLight, type Sun, type ViewKind } from './scene';
import { POST_DEFAULTS, type PostSettings } from './render/raster';
import * as THREE from 'three';
import { applyPrompt } from './prompt';
import { byPriority, FILL_MAX, FILL_MIN, nudge, planWidths, rowGroup, slotGroup, slotLayout, slotMovable, widenThinFills } from './reorder';
import { decode, encode, fromFile, History, toFile, type Snapshot } from './project';
import { bomCsv, bomGaps, buildBom } from './bom';
import { AI_MODELS, aiDesign, aiStatus, type AiProvider } from './ai';
import { thumbPair, type ThumbItem } from './thumbs';
import pkg from '../package.json';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const BASE = import.meta.env.BASE_URL + 'kjl/';

const cat: KitchenCatalog = await loadCatalog();
const d: Design = loadDesign();
let cands: Candidate[] = [];
let current: Candidate | null = null;
let selectedOp: string | null = null;
let buildToken = 0;
let lastKitchen: KitchenObj | null = null;
let picked: Item | null = null;
/** 교체 · 추가 미리보기 — 배치안 복사본(c)에 바꿔 끼운 상태. base = 원래 배치안, orig = 고른 장(base), item = 미리 보는 장(c), back = 복사본 장 → 원래 장 */
let preview: { base: Candidate; c: Candidate; orig: Item; item: Item; back: Map<Item, Item>; key: string; side?: 'L' | 'R'; cam: [THREE.Vector3, THREE.Vector3] } | null = null;

/* ───────── 되돌리기 · 다시 하기 · 자동 저장 ─────────
 * 바뀐 상태(설계 + 지금 배치안)를 글로 쌓는다 — 되돌리기 · 다시 하기 각 50번(사용자 2026-11-06).
 * 바뀔 때마다 부르지 않고 0.4초 모아서 한 번(끄는 중이면 놓은 뒤에) — 끌기 한 번 · 입력 한 번이 한 단계.
 * 같은 상태를 브라우저에도 둔다(PLAN_KEY) — 새로고침해도 직접 고친 장(폭 · 교체 · 추가 · 빼기)이 남는다. 예전엔 설계만 남아 자동 배치로 돌아갔다 */
const hist = new History(50);
const PLAN_KEY = 'kitchen-planner.plan';
let commitTimer = 0, pressed = false, restoring = false;
window.addEventListener('pointerdown', () => { pressed = true; }, true);
for (const t of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(t, () => { pressed = false; }, true);
function scheduleCommit() { clearTimeout(commitTimer); commitTimer = window.setTimeout(commit, 400); }
function commit() {
  commitTimer = 0;
  // 미리보기는 쌓지 않는다 — 적용하면 그때, 취소하면 원래 상태 그대로(같은 상태라 다시 쌓이지 않음)
  if (restoring || preview) return;
  if (pressed) { scheduleCommit(); return; }
  robotWant = robotsOf(current);
  const s = encode({ design: d, plan: current });
  hist.record(s);
  try { localStorage.setItem(PLAN_KEY, s); } catch { /* 저장 못 해도 화면은 그대로 */ }
  renderHistory();
}
/* 로봇청소기장 자리 — 다시 배치(창 옮기기 · 아일랜드 · 방 크기 · 공간 구조 …)는 장을 통째로 새로 만들어 직접 켠 로봇청소기장이 사라졌다
 * (사용자 2026-11-10 「로봇청소기 장은 어디갔어?」). 마지막으로 쌓은 상태(commit)의 자리를 기억했다가 새 배치안마다 같은 줄(벽 · 아일랜드)에서
 * 가운데가 가장 가까운 일반 하부장에 다시 단다 — 그 줄에 하부장이 없으면 빼고 알린다 */
let robotWant: { wall: WallId | null; p: [number, number] }[] = [];
/** 로봇청소기장을 달 수 있는 장 — 일반 하부장(폭 450 이상, 싱크 · 식세 · 쿡탑 아님) */
const robotOk = (x: Item) => x.level === 'base' && x.w >= 450 && !x.tag?.match(/sink|dish|hob/);
const centerOf = (x: Item): [number, number] => { const s = x.t + x.w / 2; return [x.frame.o[0] + x.frame.dir[0] * s, x.frame.o[1] + x.frame.dir[1] * s]; };
const robotsOf = (c: Candidate | null) => (c?.items ?? []).filter((x) => x.robot).map((x) => ({ wall: x.wall ?? null, p: centerOf(x) }));
function reapplyRobots(c: Candidate) {
  if (!robotWant.length || c.items.some((x) => x.robot)) return;   // 이미 단 안(저장해 둔 안)은 그대로
  let lost = 0;
  for (const w of robotWant) {
    let best: Item | undefined, bd = Infinity;
    for (const x of c.items) {
      if (x.robot || !robotOk(x) || (x.wall ?? null) !== w.wall) continue;
      const q = centerOf(x), dist = Math.hypot(q[0] - w.p[0], q[1] - w.p[1]);
      if (dist < bd) { bd = dist; best = x; }
    }
    if (best) best.robot = true; else lost++;
  }
  if (lost) c.warnings.push('로봇청소기장을 둘 하부장이 없어 뺐습니다 — 하부장을 골라 다시 켜 주세요');
}
/** 설계 저장(브라우저) — 바뀌었으니 되돌리기 단계도 */
function saveDesign(dd: Design) { storeDesign(dd); scheduleCommit(); }

const grade = (): GradeDef => cat.grades.find((g) => g.id === d.grade) ?? cat.grades[1];
if (!cat.grades.some((g) => g.id === d.grade)) d.grade = 'e500';
if (!grade().doors.some((x) => x.obs === d.door)) d.door = usableDoors(grade())[0].obs;
if (!cat.floors.some((x: { id: string }) => x.id === d.floor)) d.floor = cat.floors[0].id;
if (!cat.walls.some((x: { id: string }) => x.id === d.wallpaper)) d.wallpaper = '';

const stage = new Stage($('#three'));
(window as any).__stage = stage;   // 콘솔·시험 도구용
/* 3D 화면 지켜보기 — 2026-11-09 사용자 「3D 캔버스가 계속 날아간다」(헤드리스 시험에선 재현 안 됨). 쓰는 브라우저가 개발 서버로 직접 보낸다:
 * WebGPU 장치 끊김(three 는 끊기면 그리기를 영영 멈춘다) · 20초마다 3D 상태 · 3D 화면 크기 바뀜. 장치가 끊기면 화면에 다시 불러오기 안내 */
{
  type R = { onDeviceLost?: (i: unknown) => void; _isDeviceLost?: boolean; backend?: { isWebGPUBackend?: boolean }; info?: { frame?: number; render?: { frameCalls?: number; drawCalls?: number }; memory?: { geometries?: number; textures?: number } } };
  const r = stage.renderer as unknown as R;
  const prevLost = r.onDeviceLost?.bind(r);
  r.onDeviceLost = (info) => {
    prevLost?.(info);
    const i = info as { api?: string; message?: string; reason?: string } | undefined;
    devlog('device-lost', { api: i?.api, message: i?.message, reason: i?.reason });
    if (!document.querySelector('#gpu-lost')) {
      const b = document.createElement('div');
      b.id = 'gpu-lost';
      b.innerHTML = '3D 화면 장치(WebGPU)가 끊겼습니다 — 배치는 자동 저장돼 있습니다 <button>다시 불러오기</button>';
      b.querySelector('button')!.addEventListener('click', () => location.reload());
      $('#viewport').append(b);
    }
  };
  const beat = (why: string) => {
    const cv = stage.renderer.domElement as HTMLCanvasElement, rc = cv.getBoundingClientRect();
    devlog('beat', {
      why, lost: !!r._isDeviceLost, webgpu: r.backend?.isWebGPUBackend, frame: r.info?.frame, draws: r.info?.render?.drawCalls,
      geo: r.info?.memory?.geometries, tex: r.info?.memory?.textures, canvas: [cv.width, cv.height, Math.round(rc.width), Math.round(rc.height)], inDom: document.contains(cv),
      mode: stage.mode, quality: stage.quality, v2d: $('#viewport').classList.contains('v2d'), vis: document.visibilityState,
      cam: stage.camera.position.toArray().map((v) => +v.toFixed(2)),
      heapMB: Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1e6),
    });
  };
  setInterval(() => beat('20s'), 20_000);
  new ResizeObserver(() => beat('resize')).observe($('#three'));
  // 같은 장면 · 카메라를 그리는 중에 또 그리기 시작하면 — 그 장면 목록을 덮어써 「renderList[i] undefined」로 그리기가 끊기고
  // 렌더러 상태(MRT)가 안 돌아와 이후 파이프라인이 계속 무효가 됐다(그 브라우저 기록 04:52). 누가 다시 부르는지 호출 경로를 남긴다
  {
    const rr = stage.renderer as unknown as { _renderScene: (...a: unknown[]) => unknown };
    const orig = rr._renderScene.bind(rr), live = new Set<string>();
    rr._renderScene = (...a: unknown[]) => {
      const sc = a[0] as THREE.Object3D, cm = a[1] as THREE.Object3D, key = `${sc?.uuid}|${cm?.uuid}`;
      if (live.has(key)) {
        const w = window as unknown as { __nested?: number };
        w.__nested = (w.__nested ?? 0) + 1;   // 시험 도구용 개수
        devlog('nested-render', { scene: `${sc?.type}:${sc?.name}`, camera: `${cm?.type}:${cm?.name}`, stack: new Error().stack?.slice(0, 5000), acts: recentActs() });
      }
      live.add(key);
      try { return orig(...a); } finally { live.delete(key); }
    };
  }
  // 탭이 다시 보일 때 캔버스가 비었는지 — 다시 그리기 전(이 순간)과 1.5초 뒤를 64×36 으로 찍어 불투명도 · 밝기 · 밝기 편차를 남긴다
  const look = async (why: string) => {
    try {
      const bmp = await createImageBitmap(stage.renderer.domElement as HTMLCanvasElement, { resizeWidth: 64, resizeHeight: 36 });
      const g = new OffscreenCanvas(64, 36).getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      const px = g.getImageData(0, 0, 64, 36).data, n = px.length / 4;
      let a = 0, s = 0, s2 = 0;
      for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; a += px[i + 3]; s += l; s2 += l * l; }
      const mean = s / n;
      devlog('canvas', { why, alpha: Math.round(a / n), lum: Math.round(mean), sd: Math.round(Math.sqrt(Math.max(0, s2 / n - mean * mean))) });
    } catch (e) { devlog('canvas', { why, err: String(e) }); }
  };
  // 후처리 · 실내 조명 설정 — 같은 설정으로 시험 브라우저에서 다시 해 보려고(SSS 를 켜도 기본 설정에선 3D 가 안 비었다)
  const settings = (why: string) => {
    let ls: Record<string, unknown> = {};
    try { for (const k of ['kitchen-planner.perf', 'kitchen-planner.view', 'kitchen-planner.outdoor', 'kitchen-planner.light']) { const v = localStorage.getItem(k); if (v != null) ls[k] = /^[{[]/.test(v) ? JSON.parse(v) : v; } } catch { ls = {}; }
    devlog('settings', { why, post: stage.raster.post, room: stage.roomCfg, sun: stage.sunCfg, sunAuto: stage.sunAuto, shadow: stage.shadowCfg, quality: stage.quality, mode: stage.mode, dpr: devicePixelRatio, ls });
  };
  setTimeout(() => settings('start'), 3000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    settings('visible');
    void look('보임-다시 그리기 전');
    setTimeout(() => { void look('보임-1.5초 뒤'); beat('visible'); }, 1500);
  });
  // 공간이 바뀔 때 화면 — 사용자 2026-11-10 「공간 변경되면 깜빡이는데 왜그래?」(시험 브라우저에선 어두운 프레임이 안 나온다).
  //   방을 다시 만든 뒤 6초 동안 그릴 때마다 그린 직후(화면에 나갈 그림)를 48×27 로 찍어 밝기 · 어두운 화소 %, 그리기 시간, 앱 안 사건 · 프레임 간격을 남긴다.
  //   바뀌기 전 밝기는 평소 0.5초마다 찍어 둔 마지막 값
  {
    const st = stage as unknown as Record<string, (...a: unknown[]) => unknown>;
    const g = new OffscreenCanvas(48, 27).getContext('2d', { willReadFrequently: true })!;
    let until = 0, t0 = 0, lastRaf = 0, lastIdle = 0, before = -1, rows: number[][] = [], evs: [number, string][] = [];
    const tag = (k: string) => { if (until && evs.length < 200) evs.push([Math.round(performance.now() - t0), k]); };
    const shot = (): [number, number] => {
      g.drawImage(stage.renderer.domElement as HTMLCanvasElement, 0, 0, 48, 27);
      const px = g.getImageData(0, 0, 48, 27).data, n = px.length / 4;
      let s = 0, dark = 0;
      for (let i = 0; i < px.length; i += 4) { const l = (px[i] + px[i + 1] + px[i + 2]) / 3; s += l; if (l < 25) dark++; }
      return [Math.round(s / n), Math.round((dark / n) * 100)];
    };
    for (const k of ['shellLightmapNow', 'bakeAO', 'updateEnv', 'applyFloorReflection']) {
      const f = st[k]; if (typeof f !== 'function') continue;
      st[k] = function (this: unknown, ...a: unknown[]) { tag(k === 'shellLightmapNow' ? `라이트맵 ${a[1] ? '입힘' : '뗌'} ${(a[3] as string | undefined) ?? ''}` : k); return f.apply(this, a); };
    }
    const finish = () => { until = 0; devlog('space-change', { before, ms: Math.round(performance.now() - t0), renders: rows.length, rows, evs }); };
    const raf = () => {
      const n = performance.now();
      if (n - lastRaf > 100) tag(`간격 ${Math.round(n - lastRaf)}`);
      lastRaf = n;
      if (n < until) requestAnimationFrame(raf); else finish();
    };
    const sr = st.setRoom;
    st.setRoom = function (this: unknown, ...a: unknown[]) {
      const now = performance.now();
      if (!until) { t0 = now; rows = []; evs = []; lastRaf = now; requestAnimationFrame(raf); }
      until = now + 6000;
      tag('방 다시 만듦');
      return sr.apply(this, a);
    };
    const ra = stage.raster as unknown as { render: (...a: unknown[]) => unknown };
    const rr = ra.render.bind(ra);
    ra.render = (...a: unknown[]) => {
      const s = performance.now();
      const v = rr(...a);
      try {
        if (until) { const ms = performance.now() - s, [lum, dark] = shot(); if (rows.length < 500) rows.push([Math.round(s - t0), Math.round(ms), lum, dark]); }
        else if (s - lastIdle > 500) { lastIdle = s; before = shot()[0]; }
      } catch { /* 찍기 실패는 화면과 무관 */ }
      return v;
    };
  }
}
stage.getDesign = () => d;
const plan = new PlanView($('#plan'));

/* ───────── 상태 표시 ───────── */
const status = $('#status');
const say = (t: string | null) => { status.hidden = !t; if (t) status.textContent = t; };

/* ───────── 방 · 부엌 다시 만들기 ───────── */
function rebuildRoom() {
  const floor = cat.floors.find((x: { id: string }) => x.id === d.floor);
  // 벽지 — 벽마다 → 공간별 → 전체
  const wallOf = (sp: WallSpace, k: string) => cat.walls.find((x: { id: string }) => x.id === wallpaperOf(d, sp, k));
  stage.setRoom(buildRoom(d, { floor, wallOf }, BASE), d);
  plan.render(d, current);
}
const FOLD_KEYS = new Set(['cafeTall', 'foldTall']);
/** 같은 벽 · 같은 높이대 장끼리 겹친 쌍 수(냉장고 윗장 ↔ 키큰장 · 선반 빼고) */
function overlapCount(c: Candidate | null): number {
  if (!c) return 0;
  const its = c.items.filter((x) => x.wall != null && x.level !== 'shelf');
  let n = 0;
  for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++) {
    const a = its[i], b = its[j];
    if (a.wall !== b.wall || (a.level !== b.level && a.level !== 'tall' && b.level !== 'tall')) continue;
    if ((a.key === 'fridgeTop' && b.level === 'tall') || (b.key === 'fridgeTop' && a.level === 'tall')) continue;
    if (Math.min(a.t + a.w, b.t + b.w) - Math.max(a.t, b.t) > 1) n++;
  }
  return n;
}
/** 혼자 남은 EP 지우기 — 양옆 어디에도 장(EP 아님, 같은 높이대 — 하부 EP 는 하부 · 키큰, 상부 EP 는 상부 · 키큰)이 닿지 않은 EP.
 *  장을 다른 벽으로 옮기거나 빼면 그 옆면 EP 가 빈 자리에 홀로 남았다(사용자 2026-11-11 「EP가 덩그러나 혼자 있는거 삭제해」).
 *  하부 EP 를 지운 자리에 다른 하부장이 없으면 그 위 상판 · 벽 마감도 걷는다 */
function dropLoneEps(c: Candidate) {
  const zone: Record<string, Item['level'][]> = { base: ['base', 'tall'], wall: ['wall', 'tall'], tall: ['base', 'wall', 'tall'] };
  const lone = c.items.filter((e) => e.tag === 'ep' && e.wall != null && !c.items.some((x) => x !== e && x.tag !== 'ep' && x.frame === e.frame
    && (zone[e.level] ?? []).includes(x.level) && (Math.abs(x.t + x.w - e.t) < 1 || Math.abs(x.t - (e.t + e.w)) < 1)));
  if (!lone.length) return;
  c.items = c.items.filter((x) => !lone.includes(x));
  for (const e of lone) {
    if (e.level !== 'base' || c.items.some((x) => x.frame === e.frame && x.level === 'base' && x.t < e.t + e.w - 1 && x.t + x.w > e.t + 1)) continue;
    spanCut(c.counters, e.frame, e.t, e.t + e.w); spanCut(c.splashes, e.frame, e.t, e.t + e.w);
  }
  fixPoints(c);
}
/** 냉장고 정리 — 윗장은 냉장고 자리 · 폭 그대로, 드러난 옆면(벽 끝 아님 · 옆에 EP 없음)엔 키큰 EP. 직접 옮기기 · 밀기 뒤 윗장이 10 어긋나고
 *  옆 EP 가 빠진 채 남았다(사용자 2026-11-11 「냉장고 장이 깨져있는데」) */
function tidyFridge(c: Candidate) {
  for (const f of c.items.filter((x) => x.key === 'fridge' && x.wall != null)) {
    const top = c.items.find((x) => x.key === 'fridgeTop' && x.wall === f.wall && x.t < f.t + f.w && x.t + x.w > f.t);
    if (top) { top.t = f.t; top.w = f.w; top.frame = f.frame; }
    const L = wallLength(d.room, f.wall!), floor = (x: Item) => x.wall === f.wall && x.level !== 'wall' && x.level !== 'shelf';
    for (const side of ['L', 'R'] as const) {
      const at = side === 'L' ? f.t : f.t + f.w;
      if (side === 'L' ? at <= 1 : at >= L - 1) continue;
      if (c.items.some((x) => floor(x) && x.tag === 'ep' && Math.abs(side === 'L' ? x.t + x.w - at : x.t - at) < 1)) continue;
      const a = side === 'L' ? at - 20 : at, b = a + 20;
      if (c.items.some((x) => x !== f && floor(x) && x.t < b - 0.5 && x.t + x.w > a + 0.5)) continue;   // EP 자리가 없으면(다른 장이 붙어 있음) 그대로
      c.items.push(epItem(f, a));
    }
  }
}
async function rebuildKitchen() {
  const token = ++buildToken;
  devact('rebuild');
  if (!current) { stage.setKitchen(new (await import('three')).Group()); return; }
  // 직접 고친 뒤 장이 겹쳤으면(편집 전보다 겹친 쌍이 늘었으면) 편집 전으로 — 어느 편집 길로 생겼든 막는다(사용자 2026-11-11 「냉장고장하고 폴딩카페장이 하나로 합쳐졌네」)
  tidyFridge(current);
  // 「비규격 폭 0」 표시가 남은 장(옮기다 찌그러진 채 저장된 것, 2026-11-11 고치기 전) — 지금 폭으로 표시를 다시 잡는다
  for (const x of current.items) if (x.w > 1 && x.ov?.NSTD_W != null && Number(x.ov.NSTD_W) === 0) setWidth(x, x.w);
  dropLoneEps(current);
  // 하부장(끝 EP · 휠라 포함) 위에 상판 · 벽 마감이 빠진 곳을 채운다 — 장 추가 · 폭 키우기 · 옮기기로 줄이 빈 공간으로 늘어도 상판이 따라 길어지게
  //   (사용자 2026-11-11 「밑장이 배치되면 상판도 같이 밑장에 맞춰서 길어지고 끝쪽이면 EP나 휠라가 추가된 길이도 고려」 — 줄 끝 옆 빈 곳에 장 추가 때 상판이 그대로였다)
  for (const f of new Set(current.items.filter((x) => x.wall != null && x.level === 'base').map((x) => x.frame))) fillCounters(f);
  if (!restoring && !preview && hist.last) {
    const prev = decode(hist.last);
    if (overlapCount(current) > overlapCount(prev.plan)) {
      devlog('overlap-revert', { now: overlapCount(current), before: overlapCount(prev.plan) });
      await applySnapshot(prev, false);
      say('그 자리에 놓으면 다른 장과 겹쳐서 편집 전으로 되돌렸습니다'); setTimeout(() => say(null), 3200);
      return;
    }
  }
  const t0 = performance.now();
  say('부엌장 원본 계산 중…');
  // 폴딩 카페장 · 포켓 폴딩장 — 문은 원본 변수 「도어개폐율」(DROP)로 접혀 포켓에 들어간다. 늘 열어 접어 넣은 모습(사용자 2026-11-11 「카페장과 폴딩장 류는 도어가 기본적으로
  // 열려있고 접혀서 안으로 들어가있는 도어 표현」 — 예전엔 문 열기 단추를 따라 닫혀 있었다. 원본 기본도 100). 도어개폐율이 없는 장(키친바흐 카페장 · 폴딩 상부장)은 kitchen3d 가 문을 늘 연다
  for (const it of current.items) if (FOLD_KEYS.has(it.key)) it.ov = { ...(it.ov ?? {}), DROP: '100' };
  const k = await buildKitchen(current, d, cat, grade(), d.door, (n, all) => { if (token === buildToken) say(`부엌장 원본 계산 중… ${n}/${all}`); });
  // 식탁 · 의자 — 부엌 묶음에 같이(벽 숨김과 무관하게 늘 보임)
  k.group.add(await buildDining(d));
  if (token !== buildToken) return;
  stage.setKitchen(k.group);
  lastKitchen = k;
  setDoors(k.doors, doorsT);
  islLive = null;
  islBuilt = current.island ? { x: current.island.cx, z: current.island.cz, rot: current.island.rot } : null;
  if (islandSel) { if (current.island) { markIsland(); renderIslandInfo(); } else unpickIsland(); }
  if (hobSel) { markHob(); renderHobInfo(); }
  if (picked && !preview) pick(current?.items.includes(picked) ? picked : null);
  say(`${grade().label} · 장 ${k.items.length}개 · ${Math.round(performance.now() - t0)}ms`);
  setTimeout(() => { if (token === buildToken) say(null); }, 1800);
  // 장을 직접 고친 것(폭 · 교체 · 추가 · 빼기 · 옮김)도 다시 그리기로 끝난다 — 되돌리기 단계 · 자동 저장
  scheduleCommit();
  renderMep();
  mepView3d();
  // 개발 — 지금 배치(장마다 벽 · 층 · 자리 · 폭)를 개발 서버 기록으로(사용자 화면 상태 확인용 · 2026-11-11 「냉장고장하고 폴딩카페장이 하나로 합쳐졌네」)
  if (import.meta.env.DEV) devlog('plan', { style: d.style, fridgeKind: d.fridgeKind, items: current.items.filter((x) => x.level !== 'shelf').map((x) => [x.key, x.level[0], x.wall ?? 'i', Math.round(x.t), Math.round(x.w), x.frame === current!.items.find((q) => q.wall === x.wall)?.frame ? 1 : 0]) });
}

/** 카메라 — 평면도와 같은 방향(앞벽 쪽에서 뒷벽을 봄) */
function aim() {
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.view === 'persp'));
  stage.view('persp', d);
}

/** 자동 배치 다시 — 같은 안(벽 조합 · 기능 자리)이 남아 있으면 그것을 유지. build=false 면 평면도만(끄는 중) */
function replan(keep = true, build = true) {
  if (preview) endPreview(false, false);
  const prev = current?.id, prevWalls = current?.walls.join();
  cands = autoPlan(d, cat, grade().series);
  // 고른 공간 구조로 놓을 수 없으면(벽이 막힘) 다른 구조로 대신 — 알림을 붙인다
  if (!cands.length && d.layout !== 'walls') {
    const NAME = { I: 'ㅡ자', L: 'ㄱ자', Lr: 'ㄱ자 반대', U: 'ㄷ자', II: '11자', walls: '벽마다' } as const;
    for (const alt of (['L', 'Lr', 'I', 'U', 'II'] as LayoutKind[]).filter((x) => x !== d.layout)) {
      const alts = autoPlan({ ...d, layout: alt }, cat, grade().series);
      if (!alts.length) continue;
      for (const c of alts) c.warnings.unshift(`${NAME[d.layout]}로는 벽이 막혀 ${NAME[alt]}로 배치했습니다`);
      cands = alts; break;
    }
  }
  for (const c of cands) reapplyRobots(c);
  // 같은 안이 없으면 같은 벽 조합 안 (기기 · 냉장고 자리만 바뀐 경우 벽 조합이 갑자기 바뀌지 않게)
  current = (keep && (cands.find((c) => c.id === prev) || cands.find((c) => c.walls.join() === prevWalls))) || cands[0] || null;
  if (current && d.layout !== 'walls') d.walls = current.walls;
  // 장에 붙어 자리가 맞춰진 아일랜드는 그 자리를 기억 (다음 끌기의 시작점)
  if (build && current?.island && d.islandCfg.pos) d.islandCfg.pos = { x: Math.round(current.island.cx), z: Math.round(current.island.cz), rot: current.island.rot };
  renderCands();
  renderRunLen();
  plan.render(d, current);
  renderMep();
  if (build) void rebuildKitchen();
}
/* 장 배치 길이 — 배치가 나오면 장을 놓은 벽마다 길이를 묻는다. 기본은 벽 끝까지, 입력하면 그 길이까지만(잘린 끝 EP) */
function renderRunLen() {
  const box = $('#runlen');
  const walls = current?.walls ?? [];
  box.hidden = !walls.length;
  if (!walls.length) { box.innerHTML = ''; return; }
  const rows = walls.map((w) => {
    // 길이는 장 놓을 전체 구간 — 트인 쪽은 거실과 이어지는 곳 두께(150) 포함(cabSpan, 자동 배치와 같이)
    const [lo, hi] = cabSpan(d, w), L = hi - lo, cfg = d.runLen?.[w];
    const cS = walls.includes(prevWall(w)), cE = walls.includes(nextWall(w));
    const name = wallName(d.openWall, w);
    if (cS && cE) return `<div class="rl-row"><b>${name}</b><span class="rl-fixed">양 끝이 코너 — 벽 끝까지 ${L}</span></div>`;
    const base = cS ? '왼쪽 코너부터' : cE ? '오른쪽 코너부터' : '';
    const from = !cS && !cE ? `<select data-rl-from="${w}"><option value="start"${cfg?.from !== 'end' ? ' selected' : ''}>왼쪽부터</option><option value="end"${cfg?.from === 'end' ? ' selected' : ''}>오른쪽부터</option></select>` : `<small>${base}</small>`;
    return `<div class="rl-row"><b>${name}</b><input type="number" step="10" data-rl="${w}" value="${cfg?.len ?? L}" min="600" max="${L}"><small>/ ${L}</small>${from}${cfg?.len ? `<button data-rl-full="${w}" class="plain">벽 끝까지</button>` : ''}</div>`;
  });
  box.innerHTML = `<div class="rl-head">장 배치 길이 <small>기본은 벽 끝까지 — 입력하면 그 길이까지만 놓고 끝은 EP</small></div>${rows.join('')}`;
}
{
  const box = $('#runlen');
  const set = (w: WallId, len?: number, from?: 'start' | 'end') => {
    const [lo, hi] = cabSpan(d, w), L = hi - lo, runLen = { ...(d.runLen ?? {}) };
    const cur = runLen[w];
    const nl = len === undefined ? cur?.len : len;
    const nf = from ?? cur?.from;
    if (!nl || nl >= L) { if (nf === 'end' && nl && nl < L) runLen[w] = { len: nl, from: nf }; else delete runLen[w]; }
    else runLen[w] = { len: Math.max(600, Math.round(nl / 10) * 10), ...(nf ? { from: nf } : {}) };
    d.runLen = Object.keys(runLen).length ? runLen : undefined;
    pick(null); changed({ keep: true });
  };
  box.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (el.dataset.rl != null) set(Number(el.dataset.rl) as WallId, Number(el.value) || undefined);
    else if (el.dataset.rlFrom != null) set(Number(el.dataset.rlFrom) as WallId, undefined, el.value as 'start' | 'end');
  });
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-rl-full]') as HTMLElement | null;
    if (!b) return;
    const w = Number(b.dataset.rlFull) as WallId, runLen = { ...(d.runLen ?? {}) };
    delete runLen[w]; d.runLen = Object.keys(runLen).length ? runLen : undefined;
    pick(null); changed({ keep: true });
  });
}
/** room: 방 다시 · plan: 자동 배치 다시(1등 안) · keep: 자동 배치 다시하되 같은 안 유지(개구부 옮김) · kitchen: 장만 다시 */
function changed(opts: { room?: boolean; plan?: boolean; keep?: boolean; kitchen?: boolean } = { room: true, plan: true }) {
  saveDesign(d);
  if (opts.room) rebuildRoom();
  if (opts.plan || opts.keep) replan(!!opts.keep && !opts.plan);
  else if (opts.kitchen) void rebuildKitchen();
}

/* ───────── 1 공간 크기 ───────── */
// 가로 = 정면 벽 길이 · 세로 = 옆 벽 길이 (정면 = 트인 쪽에서 마주 보는 벽). 정면이 왼/오른쪽 벽(1 · 3)이면 가로가 방 d 축
const roomAxis = (ui: 'w' | 'd' | 'h'): 'w' | 'd' | 'h' => (ui === 'h' ? 'h' : (viewWalls(d.openWall).front % 2 === 0) === (ui === 'w') ? 'w' : 'd');
function syncRoomInputs() { for (const k of ['w', 'd', 'h'] as const) $<HTMLInputElement>(`#r-${k}`).value = String(d.room[roomAxis(k)]); }
for (const k of ['w', 'd', 'h'] as const) {
  const inp = $<HTMLInputElement>(`#r-${k}`);
  inp.value = String(d.room[roomAxis(k)]);
  inp.addEventListener('change', () => {
    const v = Math.round(Number(inp.value)), ax = roomAxis(k);
    const lim = k === 'h' ? [2100, 3200] : [1800, 9000];
    d.room[ax] = Math.max(lim[0], Math.min(lim[1], v || d.room[ax]));
    inp.value = String(d.room[ax]);
    d.openings.forEach((o) => clampOpening(o, d));
    renderOpenings();
    changed();
    aim();
  });
}

/* 거실 쪽(트인 벽) */
function renderOpenWall() {
  $('#openwall').innerHTML = [['', '없음'], ...([0, 1, 2, 3] as WallId[]).map((w) => [String(w), WALL_NAMES[w]])]
    .map(([v, n]) => `<button data-ow="${v}" class="${String(d.openWall ?? '') === v ? 'on' : ''}">${n}</button>`).join('');
}
$('#openwall').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-ow]') as HTMLElement | null;
  if (!b) return;
  d.openWall = b.dataset.ow === '' ? null : (Number(b.dataset.ow) as WallId);
  // 트인 벽에 있던 문 · 창 · 공간은 옆 벽으로
  for (const o of d.openings) if (o.wall === d.openWall) { o.wall = ((o.wall + 1) % 4) as WallId; clampOpening(o, d); }
  for (const o of d.openings) clampOpening(o, d);   // 거실 벽에 있던 것 — 거실이 없어졌으면 부엌 벽으로
  d.walls = d.walls.filter((w) => w !== d.openWall);
  renderOpenWall(); renderOpenings(); syncRoomInputs(); changed({ room: true, plan: true }); aim();
});

/* ───────── 2 공간 구조 ───────── */
const LAYOUTS: [LayoutKind, string, string, string][] = [
  ['I', 'ㅡ자', '정면 한 벽', 'M8 12h38'],
  ['L', 'ㄱ자', '왼쪽 + 정면', 'M8 12h38M8 12v32'],
  ['Lr', 'ㄱ자 반대', '정면 + 오른쪽', 'M8 12h38M46 12v32'],
  ['U', 'ㄷ자', '정면 + 양옆', 'M8 44V12h38v32'],
  ['II', '11자', '양옆 마주 보는 벽', 'M8 12v32M46 12v32'],
  ['walls', '벽마다', '직접 고르기', 'M8 12h38M46 12v32M8 44h38M8 12v32'],
];
function renderLayouts() {
  $('#layouts').innerHTML = LAYOUTS.map(([k, name, sub, path]) => `
    <button class="card${d.layout === k ? ' on' : ''}" data-layout="${k}">
      <svg viewBox="0 0 54 54"><rect x="4" y="8" width="46" height="40" rx="2" fill="#f4f4f4" stroke="#ccc"/><path d="${path}" stroke="#111" stroke-width="7" fill="none" stroke-linecap="square"/></svg>
      ${name}<small>${sub}</small></button>`).join('');
  const wp = $('#wallpick');
  wp.hidden = d.layout !== 'walls';
  const vw = viewWalls(d.openWall);
  wp.innerHTML = [vw.left, vw.front, vw.right, vw.near].filter((w) => w !== d.openWall).map((w) => `<button data-wall="${w}" class="${d.walls.includes(w) ? 'on' : ''}">${wallName(d.openWall, w)}</button>`).join('');
  $<HTMLInputElement>('#island').checked = d.island;
}
$('#layouts').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-layout]') as HTMLElement | null;
  if (!b) return;
  d.layout = b.dataset.layout as LayoutKind;
  if (d.layout === 'walls' && !d.walls.length) d.walls = [0];
  renderLayouts(); changed({ plan: true });
});
$('#wallpick').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-wall]') as HTMLElement | null;
  if (!b) return;
  const w = Number(b.dataset.wall) as WallId;
  d.walls = d.walls.includes(w) ? d.walls.filter((x) => x !== w) : [...d.walls, w];
  renderLayouts(); changed({ plan: true });
});
$<HTMLInputElement>('#island').addEventListener('change', (e) => { d.island = (e.target as HTMLInputElement).checked; renderIsland(); changed({ plan: true }); });

/* 아일랜드 — 크기 · 회전 · 끌기 */
function renderIsland() {
  $('#isl-box').hidden = !d.island;
  // 형태 — 카탈로그 기준 일자 · 양면 · 통판 · 연계형 식탁 · 원형 식탁 (고르지 않았으면 스타일 따라)
  const cur = d.islandCfg.style ?? (d.style === 'storage' ? 'double' : 'basic');
  $('#isl-styles').innerHTML = ISLAND_STYLES.map(([k, n, sub]) => `<button data-isl="${k}" class="${k === cur ? 'on' : ''}" title="${sub}">${n}</button>`).join('');
  $<HTMLInputElement>('#isl-len').value = String(d.islandCfg.len);
  $<HTMLInputElement>('#isl-over').value = String(d.islandCfg.over);
}
for (const [id, key] of [['#isl-len', 'len'], ['#isl-over', 'over']] as const) {
  $<HTMLInputElement>(id).addEventListener('change', (e) => {
    const lim = ISLAND_LIMITS[key];
    d.islandCfg[key] = Math.max(lim[0], Math.min(lim[1], Math.round(Number((e.target as HTMLInputElement).value) || d.islandCfg[key])));
    renderIsland(); changed({ keep: true });
  });
}
/* 통로 · 여유 기준 — 기본은 기준 글, 고친 값만 이 설계에 저장(d.clear)하고 다시 배치 · 평면도 검사(사용자 2026-11-09 「기본 기준으로하고 수정은 가능하게해」) */
function renderClear() {
  const cl = clearOf(d), rows = $('#clear-rows');
  const keys = Object.keys(CLEAR_DEFAULT) as (keyof Clearance)[];
  rows.innerHTML = keys.map((k) => `<label class="${cl[k] !== CLEAR_DEFAULT[k] ? 'on' : ''}"><span>${CLEAR_LABEL[k]}</span><input data-clear="${k}" type="number" step="50" min="${CLEAR_LIMITS[k][0]}" max="${CLEAR_LIMITS[k][1]}" value="${cl[k]}"><small>기본 ${CLEAR_DEFAULT[k].toLocaleString('ko-KR')}</small></label>`).join('');
  const n = keys.filter((k) => cl[k] !== CLEAR_DEFAULT[k]).length;
  $('#clear-sub').textContent = n ? `바꾼 기준 ${n}개` : '자동 배치 · 평면도 검사에 씀';
}
$('#clear-rows').addEventListener('change', (e) => {
  const inp = (e.target as HTMLElement).closest('[data-clear]') as HTMLInputElement | null;
  if (!inp) return;
  const k = inp.dataset.clear as keyof Clearance, [lo, hi] = CLEAR_LIMITS[k];
  const v = Math.max(lo, Math.min(hi, Math.round(Number(inp.value) || clearOf(d)[k])));
  const next: Partial<Clearance> = { ...(d.clear ?? {}), [k]: v };
  if (v === CLEAR_DEFAULT[k]) delete next[k];
  d.clear = Object.keys(next).length ? next : undefined;
  renderClear(); changed({ keep: true });
});
$('#clear-reset').addEventListener('click', () => { d.clear = undefined; renderClear(); changed({ keep: true }); });
/** 지금 아일랜드 자리 — 사용자 자리 또는 자동 배치가 정한 자리 */
const islandNow = () => (d.islandCfg.pos ? { ...d.islandCfg.pos } : current?.island ? { x: current.island.cx, z: current.island.cz, rot: current.island.rot } : null);
function rotateIsland() {
  const p = islandNow(); if (!p) return;
  d.islandCfg.pos = { ...p, rot: ((p.rot + 90) % 360) as 0 | 90 | 180 | 270 };
  changed({ keep: true });
}
$('#isl-rot').addEventListener('click', rotateIsland);
$('#isl-styles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-isl]') as HTMLElement | null;
  if (!b) return;
  d.islandCfg.style = b.dataset.isl as IslandStyle;
  renderIsland(); changed({ keep: true });
});
$('#isl-auto').addEventListener('click', () => { delete d.islandCfg.pos; changed({ keep: true }); });
function moveIsland(x: number, z: number, done: boolean) {
  const p = islandNow(); if (!p) return;
  d.islandCfg.pos = { x, z, rot: p.rot };
  if (!done) { liveIsland(x, z, 0); replan(true, false); return; }   // 끄는 동안 — 3D 는 그대로 옮겨 보이고 평면도만 다시 계산
  islandSel = true;
  saveDesign(d); replan(true);
}

/* 아일랜드 고르기 — 반투명 파란 상자 + 바닥 회전 고리(붙박이장 플래너처럼) + 화면 메뉴 */
let islandSel = false;
/** 지금 그려진 아일랜드(3D 를 만든 배치안의 자리) — 끄는 동안 이 자리에서 옮긴 만큼 보여 준다 */
let islBuilt: { x: number; z: number; rot: number } | null = null;
let islLive: { objs: { o: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion }[]; x: number; z: number; theta: number } | null = null;
const UP = new THREE.Vector3(0, 1, 0);
const islandObjs = () => (lastKitchen ? lastKitchen.group.children.filter((o) => o.userData.island) : []);
/** 끄는 동안 — 3D 아일랜드(장 · 상판 · 걸레받이 · 의자)를 가운데 (x, z) · 회전 theta(rad) 로 옮겨 보여 줌 */
function liveIsland(x: number, z: number, theta: number) {
  if (!lastKitchen || !islBuilt) return;
  if (!islLive) islLive = { objs: islandObjs().map((o) => ({ o, p: o.position.clone(), q: o.quaternion.clone() })), x, z, theta };
  Object.assign(islLive, { x, z, theta });
  const c0 = new THREE.Vector3(islBuilt.x / 1000, 0, islBuilt.z / 1000), c1 = new THREE.Vector3(x / 1000, 0, z / 1000);
  const q = new THREE.Quaternion().setFromAxisAngle(UP, theta);
  for (const e of islLive.objs) { e.o.position.copy(e.p).sub(c0).applyAxisAngle(UP, theta).add(c1); e.o.quaternion.copy(e.q).premultiply(q); }
  markIsland(theta === 0);
}
/** 고른 표시 — 상자는 늘, 고리는 ring=true 일 때(돌리는 중엔 고리가 스스로 돈다) */
function markIsland(ring = true) {
  if (!islandSel || !lastKitchen) { stage.setIslandRing(null); return; }
  const objs = islandObjs();
  if (!objs.length) { stage.setIslandRing(null); return; }
  const b = new THREE.Box3();
  for (const o of objs) b.expandByObject(o);
  stage.highlight(b);
  if (!ring) return;
  const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  const rot = islLive ? islBuilt!.rot : islandNow()?.rot ?? 0;
  stage.setIslandRing({ c: [c.x * 1000, c.z * 1000], R: Math.hypot(sz.x, sz.z) * 500 + 250, knob: Math.PI - rot * Math.PI / 180, deg: rot });
}
function pickIsland() {
  if (!current?.island) return;
  pick(null);
  selectedOp = null; plan.selected = null; stage.setDims(null); plan.pickedWall = null;
  islandSel = true; plan.islandPicked = true;
  plan.render(d, current);
  markIsland();
  renderIslandInfo();
}
function unpickIsland() {
  if (!islandSel) return;
  islandSel = false; plan.islandPicked = false; islLive = null;
  stage.setIslandRing(null);
  const box = $('#item-info'); if (box.dataset.isl) { box.hidden = true; delete box.dataset.isl; }
}
/** 아일랜드 메뉴 — 크기 · 회전 · 자동 위치 · 빼기 */
function renderIslandInfo() {
  const isl = current?.island; if (!isl) return;
  const box = $('#item-info');
  const ct = current!.counters.find((x) => x.island);
  const depth = ct ? Math.round(ct.z1 - ct.z0) : 0;
  const rot = islandNow()?.rot ?? isl.rot;
  box.innerHTML = `
    <div class="ii-head"><b>아일랜드장</b><button title="닫기">×</button></div>
    <div class="ii-model">${isl.attached != null ? `${wallName(d.openWall, isl.attached)} 장에 붙음 · 붙인 자리 코너장` : '따로 놓임'} · 끌어 옮기고 바닥 파란 고리를 끌어 돌리기</div>
    <div class="ii-size"><div><small>길이</small><b>${isl.len}</b></div><div><small>깊이(상판)</small><b>${depth}</b></div><div><small>방향</small><b>${rot}°</b></div></div>
    <div class="ii-row"><label>길이<input data-ik="len" type="number" step="50" value="${d.islandCfg.len}"></label><label>뒤로 내민 상판<input data-ik="over" type="number" step="10" value="${d.islandCfg.over}"></label></div>
    <div class="ii-acts"><button data-ia="rot" class="plain">↻ 90° 돌리기</button><button data-ia="auto" class="plain">자동 위치</button><button data-ia="del">아일랜드 빼기</button></div>`;
  box.dataset.isl = '1';
  box.hidden = false;
  box.querySelector('.ii-head button')!.addEventListener('click', () => { unpickIsland(); stage.highlight(null); plan.render(d, current); });
  box.querySelectorAll<HTMLInputElement>('[data-ik]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.ik as 'len' | 'over', lim = ISLAND_LIMITS[k];
    d.islandCfg[k] = Math.max(lim[0], Math.min(lim[1], Math.round(Number(inp.value) || d.islandCfg[k])));
    renderIsland(); changed({ keep: true });
  }));
  box.querySelector('[data-ia="rot"]')!.addEventListener('click', () => rotateIsland());
  box.querySelector('[data-ia="auto"]')!.addEventListener('click', () => { delete d.islandCfg.pos; changed({ keep: true }); });
  box.querySelector('[data-ia="del"]')!.addEventListener('click', () => {
    unpickIsland(); stage.highlight(null);
    d.island = false; renderIsland(); renderLayouts(); changed({ plan: true });
  });
}
/** 회전 고리 끌기 — deg = 끌기 시작 대비 three 회전(반시계 +). 아일랜드 방향(rot, 시계 +)은 그 반대로 */
let rotBase: { x: number; z: number; rot: number } | null = null;
function ringRotate(deg: number, done: boolean) {
  if (!rotBase) rotBase = islandNow();
  const b = rotBase; if (!b) return;
  const rot = ((((b.rot - deg) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  if (!done) {
    d.islandCfg.pos = { x: b.x, z: b.z, rot };
    stage.setRingLabel(rot);
    liveIsland(b.x, b.z, deg * Math.PI / 180);
    replan(true, false);
    return;
  }
  rotBase = null;
  if (!deg) { markIsland(); return; }
  d.islandCfg.pos = { x: b.x, z: b.z, rot };
  changed({ keep: true });
}
stage.onRotateIsland = (deg, done) => (diningSel ? diningRotate(deg, done) : hobSel ? hobRotate(deg, done) : ringRotate(deg, done));

/* 쿡탑(기기) — 상판 위 어디로든(벽 줄 · 아일랜드) 끌어 옮기고, 바닥 고리로 90° 돌린다. 장은 자동 배치가 그 자리에 조리장을 놓는다 */
let hobSel = false;
const hobDeco = () => { let top: THREE.Object3D | null = null, g: THREE.Object3D | null = null; lastKitchen?.group.children.forEach((o) => { if (o.userData.decoOf?.tag === 'hob') { g = o; o.traverse((x) => { if (x.userData.hobTop) top = x; }); } }); return { g: g as THREE.Object3D | null, top: top as THREE.Object3D | null }; };
function markHob() {
  const { top } = hobDeco();
  if (!hobSel || !top) { if (hobSel) stage.setIslandRing(null); return; }
  const b = new THREE.Box3().setFromObject(top); b.max.y += 0.03;
  stage.highlight(b);
  const c = b.getCenter(new THREE.Vector3());
  // 손잡이 = 기기 앞쪽(로컬 +z)
  const v = new THREE.Vector3(0, 0, 1).applyQuaternion(top.getWorldQuaternion(new THREE.Quaternion()));
  stage.setIslandRing({ c: [c.x * 1000, c.z * 1000], R: 480, knob: Math.atan2(v.x, v.z), y: b.max.y * 1000, deg: d.hobRot ?? 0 });
}
function pickHob() {
  if (!current?.items.some((x) => x.tag === 'hob')) return;
  pick(null);
  selectedOp = null; plan.selected = null; stage.setDims(null); plan.pickedWall = null; plan.render(d, current);
  hobSel = true;
  markHob(); renderHobInfo();
}
function unpickHob() {
  if (!hobSel) return;
  hobSel = false; stage.setIslandRing(null);
  const box = $('#item-info'); if (box.dataset.hob) { box.hidden = true; delete box.dataset.hob; }
}
function renderHobInfo() {
  const it = current?.items.find((x) => x.tag === 'hob'); if (!it) return;
  const box = $('#item-info');
  const where = it.wall != null ? wallName(d.openWall, it.wall) : '아일랜드';
  box.innerHTML = `
    <div class="ii-head"><b>쿡탑</b><button title="닫기">×</button></div>
    <div class="ii-model">${where} · 아래 조리장 ${it.w} · 끌어서 상판 위 어디로든(아일랜드 포함) · 바닥 고리로 돌리기</div>
    <div class="ii-size"><div><small>기기</small><b>590×520</b></div><div><small>방향</small><b>${(((d.hobRot ?? 0) % 360) + 360) % 360}°</b></div><div><small>후드</small><b>${it.wall != null ? '벽 위' : '천장형'}</b></div></div>
    <div class="ii-acts"><button data-ha="rot" class="plain">↻ 90° 돌리기</button><button data-ha="auto" class="plain">자리 자동</button></div>`;
  box.dataset.hob = '1';
  box.hidden = false;
  box.querySelector('.ii-head button')!.addEventListener('click', () => { unpickHob(); stage.highlight(null); });
  box.querySelector('[data-ha="rot"]')!.addEventListener('click', () => { d.hobRot = ((d.hobRot ?? 0) - 90 + 360) % 360; saveDesign(d); void rebuildKitchen(); });
  box.querySelector('[data-ha="auto"]')!.addEventListener('click', () => { if (d.fix) delete d.fix.hob; changed({ keep: false, plan: true }); });
}
/** 고리로 돌리기 — 기기만 (장 · 후드 그대로) */
let hobRot0: number | null = null;
function hobRotate(deg: number, done: boolean) {
  if (hobRot0 == null) hobRot0 = d.hobRot ?? 0;
  const { top } = hobDeco();
  if (!done) { stage.setRingLabel(hobRot0 + deg); if (top) top.rotation.y = ((hobRot0 + deg) * Math.PI) / 180; const b = top && new THREE.Box3().setFromObject(top); if (b) stage.highlight(b); return; }
  d.hobRot = (((hobRot0 + deg) % 360) + 360) % 360; hobRot0 = null;
  saveDesign(d); void rebuildKitchen();
}
/** 끌기 — 놓을 자리: 아일랜드 상판 위면 아일랜드, 아니면 가장 가까운 벽 줄 */
/** 끌기 — 아일랜드 상판 위(앞뒤 여유 포함)면 아일랜드 위 가운데 자리(c, 장 폭 반만큼 끝에서 띄움). 싱크 · 식세 · 쿡탑이 같이 쓴다 */
function islandTarget(p: [number, number], half = 450): { c: number; frame: Frame } | null {
  const isl = current?.island;
  if (!isl || !d.island) return null;
  const f = isl.frame, t = (p[0] - f.o[0]) * f.dir[0] + (p[1] - f.o[1]) * f.dir[1], u = (p[0] - f.o[0]) * f.n[0] + (p[1] - f.o[1]) * f.n[1];
  if (t > -200 && t < isl.len + 200 && u > -400 && u < 900) return { c: Math.round(Math.max(half, Math.min(isl.len - half, t)) / 10) * 10, frame: f };
  return null;
}
function hobTarget(p: [number, number]): { wall: WallId; c: number; island?: boolean; frame: Frame } | null {
  const it = islandTarget(p);
  if (it) return { wall: 0, c: it.c, island: true, frame: it.frame };
  const q: [number, number] = [Math.max(0, Math.min(d.room.w, p[0])), Math.max(0, Math.min(d.room.d, p[1]))];
  const nw = nearestWall(d.room, q[0], q[1], d.openWall);
  if (!current?.walls.includes(nw.wall)) return null;
  const f = wallFrame(d.room, nw.wall) as unknown as Frame;
  return { wall: nw.wall, c: Math.round(nw.t / 10) * 10, frame: f };
}
let hobOff: [number, number] | null = null;
function dragHob(p: [number, number], p0: [number, number], done: boolean) {
  const it = current?.items.find((x) => x.tag === 'hob');
  if (!it) return;
  if (!hobOff) { const c = [it.frame.o[0] + it.frame.dir[0] * (it.t + it.w / 2) + it.frame.n[0] * 300, it.frame.o[1] + it.frame.dir[1] * (it.t + it.w / 2) + it.frame.n[1] * 300]; hobOff = [c[0] - p0[0], c[1] - p0[1]]; }
  const tg = hobTarget([p[0] + hobOff[0], p[1] + hobOff[1]]);
  if (!tg) return;
  if (!done) {
    // 끄는 동안 — 기기를 그 자리 상판 위로 (장은 놓으면 다시 배치)
    const { g } = hobDeco();
    if (g) {
      const f = tg.frame, t = tg.c - it.w / 2;
      g.position.set((f.o[0] + f.dir[0] * t) / 1000, 0, (f.o[1] + f.dir[1] * t) / 1000);
      g.rotation.y = Math.atan2(-f.dir[1], f.dir[0]);
      const { top } = hobDeco(); if (top) stage.highlight(new THREE.Box3().setFromObject(top));
      stage.setIslandRing(null);
    }
    return;
  }
  hobOff = null;
  d.fix = { ...(d.fix ?? {}), hob: tg.island ? { wall: 0, c: tg.c, island: true } : { wall: tg.wall, c: tg.c } };
  hobSel = true;
  saveDesign(d); replan(true);
  say(tg.island ? '쿡탑을 아일랜드로 옮겼습니다 — 후드는 천장형' : `쿡탑을 ${wallName(d.openWall, tg.wall)} 줄로 옮겼습니다`); setTimeout(() => say(null), 2200);
}
stage.onPickHob = pickHob;
stage.onDragHob = dragHob;
stage.onPickIsland = pickIsland;
plan.onPickIsland = pickIsland;
plan.onIsland = moveIsland;
/* 싱크장 · 식기세척기장 · 쿡탑 — 옮긴 자리를 고정하고 나머지를 다시 채움 */
function moveFixture(key: FixKey, wall: WallId, c: number, done: boolean, island = false) {
  // 아일랜드 자리 — c 는 아일랜드 위 가운데(wall 은 자리 채움). 아일랜드 싱크(사용자 2026-11-10 「아일랜드 싱크 추가」)
  // 싱크가 벽에서 아일랜드로 처음 넘어갈 때 — 바로 옆에 맞붙어 있던 식세는 따로 옮긴 것이 아니므로 고정을 풀어 같이 가게(설계 5.2)
  if (island && key === 'sink' && !d.fix?.sink?.island && d.fix?.dish && !d.fix.dish.island && current) {
    const sk = current.items.find((x) => x.tag === 'sink'), ds = current.items.find((x) => x.tag === 'dish');
    if (sk && ds && ds.frame === sk.frame && (Math.abs(ds.t - (sk.t + sk.w)) <= 1 || Math.abs(sk.t - (ds.t + ds.w)) <= 1)) { const fx = { ...d.fix }; delete fx.dish; d.fix = fx; }
  }
  d.fix = { ...(d.fix ?? {}), [key]: island ? { wall: 0, c, island: true } : { wall, c } };
  const f = island ? current?.island?.frame : (wallFrame(d.room, wall) as unknown as Frame);
  if (!done) { if (f) liveMove(key, f, c); replan(true, false); return; }
  saveDesign(d); replan(true);
  say(island ? `${FIX_LABEL[key]}을(를) 아일랜드로 옮겼습니다${key === 'sink' ? ' — 급수 · 배수는 바닥 속으로(설비 보기)' : ''}` : `${FIX_LABEL[key]} 자리를 고정했습니다 — 「자리 초기화」로 자동 배치에 맡기기`); setTimeout(() => say(null), 2200);
}
/* 하부장 끌기 — 같은 줄 안에서는 옆 장들 사이에 끼워 넣는다(순서만 바뀌고 폭 합은 그대로 → 새 틈 · 휠라 없음).
 * 싱크장 · 식기세척기장 · 쿡탑은 줄 밖(다른 벽 · 줄 끝 너머)으로 끌면 예전처럼 그 자리를 고정해 다시 배치 */
let slot: { it: Item; group: Item[]; t0s: Map<Item, number>; cand: Candidate; fix0?: Design['fix']; c0: number; out: boolean; free: [number, number] } | null = null;
const FIX_TAGS = ['sink', 'dish', 'hob'] as const;
/** 지금 자리를 고정으로 — 아일랜드 줄(벽 없음)이면 아일랜드 위 자리(island). 예전엔 벽 없이 { c } 만 남아 다음 배치에서 아일랜드를 벗어났다(검토 2026-11-10) */
const fixAt = (x: Item) => (x.wall == null ? { wall: 0 as WallId, c: x.t + x.w / 2, island: true } : { wall: x.wall, c: x.t + x.w / 2 });
const isFix = (x: Item): x is Item & { tag: FixKey } => (FIX_TAGS as readonly string[]).includes(x.tag ?? '');
function dragItem(it: Item, p: [number, number], p0: [number, number], done: boolean) {
  // 미리보기 중엔 끌지 않는다 — 미리보기 배치안(복사본)이 바뀌어 취소 · 적용이 엉킨다
  if (!current || preview) return;
  if (!slot || slot.it !== it) {
    const group = slotGroup(current.items, it);
    // 줄 끝 옆 빈 공간까지는 끌어 갈 수 있다 — 놓으면 그만큼 빈 자리 쪽으로 옮긴다(nudgeItem → slideFree)
    const free: [number, number] = [useFree(group[0], 'L', 1e6)?.take ?? 0, useFree(group[group.length - 1], 'R', 1e6)?.take ?? 0];
    slot = { it, group, t0s: new Map(group.map((x) => [x, x.t])), cand: current, fix0: d.fix && structuredClone(d.fix), c0: it.t + it.w / 2, out: false, free };
  }
  const s = slot, f = it.frame;
  const inRoom = (q: [number, number]): [number, number] => [Math.max(0, Math.min(d.room.w, q[0])), Math.max(0, Math.min(d.room.d, q[1]))];
  const along = (q: [number, number]) => (q[0] - f.o[0]) * f.dir[0] + (q[1] - f.o[1]) * f.dir[1];
  const c = s.c0 + along(p) - along(p0);
  const first = s.group[0], last = s.group[s.group.length - 1];
  const a = s.t0s.get(first)!, b = s.t0s.get(last)! + last.w;
  const nw = nearestWall(d.room, ...inRoom(p), d.openWall);
  const outOfRow = nw.wall !== it.wall || c < a - s.free[0] - it.w / 2 || c > b + s.free[1] + it.w / 2;
  // 줄 밖 — 싱크 · 식세 · 쿡탑 아닌 장(사용자 2026-11-11 「모든 장은 단독으로 장 이동해서 벽에 배치」): 끄는 동안 그 벽 그 자리에 보이고, 놓으면 그리로 옮긴다(moveItemTo)
  if (outOfRow && !isFix(it) && it.wall != null) {
    if (!s.out) { for (const x of s.group) x.t = s.t0s.get(x)!; s.out = true; previewSlot(s.group, it); }
    const nw0 = nearestWall(d.room, ...inRoom(p0), d.openWall);
    const off = nw0.wall === it.wall && nw.wall === it.wall ? nw0.t - s.c0 : 0;
    const tc = Math.round((nw.t - off) / 10) * 10;
    if (!done) { livePlace(it, nw.wall, tc); return; }
    slot = null;
    // 떠난 자리를 채울지 비울지 묻는다(사용자 2026-11-11 「장을 빼거나 이동하면 자동으로 채울지 비울지 물어봐」) — 옆에 받아 줄 장이 있는 하부 · 상부장만.
    //   키큰장 · 냉장고장은 늘 빈 자리로 남고, 혼자 있던 장은 받을 장이 없다
    const done2 = (gap: 'join' | 'leave') => {
      const r = moveItemTo(it, nw.wall, tc, gap);
      if (typeof r === 'string') { say(r); setTimeout(() => say(null), 3200); void rebuildKitchen(); return; }
      plan.render(d, current); void rebuildKitchen().then(() => { if (current?.items.includes(r.item)) pick(r.item); });
      say(`${modOf(it)?.name ?? (it.key === 'fridge' ? '냉장고장' : '장')}을(를) ${wallName(d.openWall, nw.wall)}(으)로 옮겼습니다${gap === 'leave' ? ' — 원래 자리는 비워 두었습니다' : ''}`); setTimeout(() => say(null), 2400);
    };
    if (it.level === 'tall' || s.group.length < 2) { done2('join'); return; }
    void askGap(it.w).then((gap) => { if (gap) done2(gap); else { void rebuildKitchen(); pick(it); } });
    return;
  }
  // 줄 밖 — 싱크 · 식세 · 쿡탑 (다른 벽 쪽이거나 줄 끝을 장 폭 반 넘게 지남) — 고정 자리로 다시 배치
  if (isFix(it) && outOfRow) {
    if (!s.out) { for (const x of s.group) x.t = s.t0s.get(x)!; s.out = true; }
    if (done) slot = null;
    // 아일랜드 위로 끌어오면 그 아일랜드 자리에(싱크 · 식세 · 쿡탑장)
    const isl = islandTarget(p, it.w / 2);
    if (isl) { moveFixture(it.tag, 0, isl.c, done, true); return; }
    const nw0 = nearestWall(d.room, ...inRoom(p0), d.openWall);
    const off = nw0.wall === it.wall && nw.wall === it.wall ? nw0.t - s.c0 : 0;
    moveFixture(it.tag, nw.wall, Math.round((nw.t - off) / 10) * 10, done);
    return;
  }
  if (s.out) {
    // 줄 밖에서 돌아옴 — 고정 자리 · 배치안을 끌기 전으로
    s.out = false;
    if (s.fix0) d.fix = structuredClone(s.fix0); else delete d.fix;
    current = s.cand; renderCands();
  }
  const cc = Math.max(a - s.free[0] + it.w / 2, Math.min(b + s.free[1] - it.w / 2, c));
  const { order, ts } = slotLayout(s.group, it, cc, s.t0s);
  if (!done) {
    // 끄는 장은 마우스를 따라가고 옆 장들은 끼울 자리를 비워 둔다
    for (const x of s.group) x.t = x === it ? cc - it.w / 2 : ts.get(x)!;
    fixPoints(current); previewSlot(s.group, it); plan.render(d, current);
    return;
  }
  slot = null;
  for (const x of s.group) x.t = ts.get(x)!;
  followFridgeTop(current, s.t0s);
  const movedItems = s.group.filter((x) => x.t !== s.t0s.get(x));
  if (!movedItems.length) {
    // 순서는 그대로 — 끈 만큼 미리 단위로 옮긴다(옆 휠라 · 장 크기가 바뀜)
    const delta = Math.round((cc - s.c0) / 10) * 10;
    const err = delta ? nudgeItem(it, delta) : null;
    if (err) { say(err); setTimeout(() => say(null), 2200); }
    if (!delta || err) { previewSlot(s.group, it); plan.render(d, current); }
    return;
  }
  // 줄의 싱크 · 식세 · 쿡탑 자리를 기억 — 다시 배치해도(조건 변경 등) 그 자리
  const fix = { ...(d.fix ?? {}) };
  for (const x of s.group) if (isFix(x)) fix[x.tag] = fixAt(x);
  d.fix = fix;
  saveDesign(d);
  const name = modOf(it)?.name ?? FIX_LABEL[it.tag as FixKey] ?? '장';
  const pos = `${order.indexOf(it) + 1}번째`;
  if (movedItems.some((x) => x.tag === 'hob')) {
    // 쿡탑이 옮겨지면 위 후드장 · 상부장도 다시 맞춰야 해서 그 자리를 고정하고 다시 배치
    replan(true);
    say(`${name}을(를) 줄 ${pos} 자리에 끼웠습니다 — 쿡탑 위 후드장 · 상부장을 다시 맞춤`);
  } else {
    fixPoints(current);
    plan.render(d, current); void rebuildKitchen();
    say(`${name}을(를) 줄 ${pos} 자리에 끼웠습니다`);
  }
  setTimeout(() => say(null), 2200);
}
/** 미리 단위로 옮기기 — 같은 줄 휠라가 먼저, 넘치면 가까운 장부터 100 단위로 크기 조절. 쿡탑이면 위 후드장 줄도 같이 */
const baseRowPick = (x: Item) => slotMovable(x);
const upperRowPick = (x: Item) => x.level === 'wall' && x.tag !== 'ep' && !x.key.startsWith('wallCorner') && x.key !== 'fridgeTop';
/** 냉장고를 옮겼으면 위 냉장고 윗장도 같은 자리로 — 윗장은 상부 줄에 냉장고와 같은 위치 · 폭으로 따로 놓인다 */
function followFridgeTop(c: Candidate, t0s: Map<Item, number>) {
  for (const [f, t0] of t0s) {
    if (f.key !== 'fridge' || f.t === t0) continue;
    const top = c.items.find((x) => x.key === 'fridgeTop' && x.wall === f.wall && Math.abs(x.t - t0) < 1);
    if (top) top.t = f.t;
  }
}
function nudgeItem(it: Item, delta: number): string | null {
  if (!current) return '배치안이 없습니다';
  const cand = current;
  const fr0 = new Map(cand.items.filter((x) => x.key === 'fridge').map((x) => [x, x.t] as [Item, number]));
  const mk = (ref: Item) => (w: number): Item => ({ key: ref.level === 'wall' ? 'wfill50' : 'bfill50', level: ref.level, frame: ref.frame, t: 0, w, wall: ref.wall });
  // 끝까지 못 가면 갈 수 있는 데까지 (10 단위로 줄여 가며)
  const grp = rowGroup(cand.items, it, baseRowPick), want = delta;
  // 빈 공간 쪽이면 그 공간으로 밀어 넣는다(폭 그대로, 떠난 자리는 뒤 장이 메움) — 아래 미리 이동은 줄 길이를 그대로 두어
  // 빈 자리로는 옮겨지지 않았다(사용자 2026-11-09 「이동도 안돼」). 쿡탑은 후드장이 따라가야 해서 아래 길로
  const slid = it.tag === 'hob' ? 0 : slideFree(cand, grp, it, delta);
  if (slid) {
    followFridgeTop(cand, fr0);
    const fx = { ...(d.fix ?? {}) };
    for (const x of rowGroup(cand.items, it, baseRowPick)) if (isFix(x)) fx[x.tag] = fixAt(x);
    d.fix = fx;
    saveDesign(d);
    fixPoints(cand); plan.render(d, cand); void rebuildKitchen();
    say(`${delta > 0 ? '+' : '-'}${slid}mm 옮김 — 빈 자리 쪽으로${slid !== Math.abs(want) ? ' (빈 자리 · 뒤 장이 받는 데까지)' : ''}`);
    setTimeout(() => say(null), 2200);
    if (picked === it) pick(it);
    return null;
  }
  // 휠라는 벽에 닿는 끝에만 — 그 쪽만 휠라가 먼저 받고, 아닌 쪽은 장이 미리 단위로
  const wallEnds = (g: Item[]): [boolean, boolean] => {
    const w = g[0].wall; if (w == null) return [false, false];
    const L = wallLength(d.room, w), wS = prevWall(w) !== d.openWall || d.wing.b >= 600, wE = nextWall(w) !== d.openWall || d.wing.a >= 600;
    return [g[0].t <= 1 && wS, g[g.length - 1].t + g[g.length - 1].w >= L - 1 && wE];
  };
  const fo = wallEnds(grp);
  let pb = nudge(grp, it, delta, widthRange, mk(it), fo, sibFor);
  while (!pb && Math.abs(delta) > 10) { delta -= Math.sign(delta) * 10; pb = nudge(grp, it, delta, widthRange, mk(it), fo, sibFor); }
  if (!pb) return '이 줄에서는 더 옮길 수 없습니다 — 옆 장이 최소 폭';
  // 쿡탑 — 후드장도 같은 만큼
  const hood = it.tag === 'hob' ? cand.items.find((x) => x.key === 'hood' && x.frame === it.frame) : undefined;
  const ug = hood ? rowGroup(cand.items, hood, upperRowPick) : null;
  const pu = hood && ug ? nudge(ug, hood, delta, widthRange, mk(hood), wallEnds(ug), sibFor) : null;
  if (hood && !pu) {
    // 위 줄이 못 받으면 쿡탑 자리를 고정하고 다시 배치
    d.fix = { ...(d.fix ?? {}), hob: { wall: it.wall!, c: it.t + it.w / 2 + delta } };
    saveDesign(d); replan(true);
    return null;
  }
  for (const pl of [pb, pu]) {
    if (!pl) continue;
    cand.items = cand.items.filter((x) => !pl.remove.includes(x));
    cand.items.push(...pl.add);
    for (const x of pl.add) setWidth(x, x.w);
    for (const [x, w] of pl.w) setWidth(x, w);
    for (const [x, t] of pl.t) x.t = t;
  }
  followFridgeTop(cand, fr0);
  // 싱크 · 식세 · 쿡탑 자리 기억
  const fix = { ...(d.fix ?? {}) };
  for (const x of rowGroup(cand.items, it, baseRowPick)) if (isFix(x)) fix[x.tag] = fixAt(x);
  d.fix = fix;
  saveDesign(d);
  fixPoints(cand); plan.render(d, cand); void rebuildKitchen();
  const changedW = [...pb.w.keys()].filter((x) => !/fill/.test(x.key)).length;
  const swapped = pb.add.filter((x) => !/fill/.test(x.key));
  say(`${delta > 0 ? '+' : ''}${delta}mm 옮김${delta !== want ? ` (옆 장 최소 폭 때문에 여기까지)` : ''}${changedW ? ` · 장 ${changedW}개 크기 조절` : ''}${swapped.length ? ` · ${swapped.map((x) => modK(x.key)?.label ?? x.key).join(' · ')}(으)로 바꿈` : ''}${pb.add.length > swapped.length ? ' · 휠라 추가' : ''}${pb.remove.some((x) => /fill/.test(x.key)) ? ' · 휠라 뺌' : ''}`);
  setTimeout(() => say(null), 2200);
  if (picked === it) pick(it);
  return null;
}
/** 평면도 싱크 · 쿡탑 기호 자리 — 장 가운데 */
function fixPoints(c: Candidate) {
  const P = (x: Item): [number, number] => [x.frame.o[0] + x.frame.dir[0] * (x.t + x.w / 2) + x.frame.n[0] * 300, x.frame.o[1] + x.frame.dir[1] * (x.t + x.w / 2) + x.frame.n[1] * 300];
  const sink = c.items.find((x) => x.tag === 'sink'), hob = c.items.find((x) => x.tag === 'hob');
  if (sink) c.sink = P(sink);
  if (hob) c.hob = P(hob);
}
/** 끄는 동안 — 지금 보이는 3D 장(과 싱크볼 · 수전 장식)을 바뀐 자리로 */
function previewSlot(group: Item[], it: Item) {
  if (!lastKitchen) return;
  const set = new Set(group);
  const place = (o: THREE.Object3D, x: Item) => o.position.set((x.frame.o[0] + x.frame.dir[0] * x.t) / 1000, 0, (x.frame.o[1] + x.frame.dir[1] * x.t) / 1000);
  for (const { item, obj } of lastKitchen.items) if (set.has(item)) place(obj, item);
  lastKitchen.group.traverse((o) => { if (set.has(o.userData.decoOf)) place(o, o.userData.decoOf); });
  stage.highlight(lastKitchen.items.find((x) => x.item === it)?.obj ?? null);
}
plan.onDragItem = dragItem;
/** 끄는 동안 — 지금 보이는 3D 장을 그 자리로 옮김 (놓으면 배치를 다시 계산해 새로 그린다) */
function liveMove(key: FixKey, f: Frame, c: number) {
  if (!lastKitchen) return;
  const it = lastKitchen.items.find((x) => x.item.tag === key)?.item;
  if (!it) return;
  const t = c - it.w / 2;
  const place = (o: THREE.Object3D) => {
    o.position.set((f.o[0] + f.dir[0] * t) / 1000, 0, (f.o[1] + f.dir[1] * t) / 1000);
    o.rotation.y = Math.atan2(-f.dir[1], f.dir[0]);
  };
  for (const { item, obj } of lastKitchen.items) if (item === it) place(obj);
  lastKitchen.group.traverse((o) => { if (o.userData.decoOf === it) place(o); });
  stage.highlight(lastKitchen.items.find((x) => x.item === it)?.obj ?? null);
}
stage.onDragItem = dragItem;
/** 끄는 동안 — 장 하나(냉장고면 윗장도)를 다른 벽 자리(가운데 c)에 보여 준다. 놓으면 moveItemTo 가 배치를 고치고 다시 그린다 */
function livePlace(it: Item, wall: WallId, c: number) {
  if (!lastKitchen) return;
  const f = frameOfWall(wall), t = c - it.w / 2;
  const top = it.key === 'fridge' ? current?.items.find((x) => x.key === 'fridgeTop' && x.frame === it.frame && Math.abs(x.t - it.t) < 1) : undefined;
  const place = (o: THREE.Object3D) => { o.position.set((f.o[0] + f.dir[0] * t) / 1000, 0, (f.o[1] + f.dir[1] * t) / 1000); o.rotation.y = Math.atan2(-f.dir[1], f.dir[0]); };
  for (const { item, obj } of lastKitchen.items) if (item === it || item === top) place(obj);
  lastKitchen.group.traverse((o) => { if (o.userData.decoOf === it) place(o); });
  stage.highlight(lastKitchen.items.find((x) => x.item === it)?.obj ?? null);
}
$('#fix-reset').addEventListener('click', () => { delete d.fix; changed({ keep: false, plan: true }); });
plan.onIslandRotate = rotateIsland;
plan.onSpace = (box) => { document.querySelectorAll('[data-view]').forEach((x) => x.classList.remove('on')); stage.frameSpace(box, d); };
stage.getIsland = () => { const p = islandNow(); return p ? { x: p.x, z: p.z } : null; };
stage.onDragIsland = moveIsland;

/* ───────── 3 공간 요소 ───────── */
// 출입문은 없음 — 거실 쪽이 트여 있다. 문은 서브주방 · 다용도실에 딸려 생긴다
const KINDS: OpeningKind[] = ['window', 'pantry', 'utility', 'subkitchen'];
const DEFAULT_WALL: Record<OpeningKind, WallId> = { door: 2, window: 0, pantry: 1, utility: 2, subkitchen: 2 };
function renderOpenings() {
  $('#kinds').innerHTML = KINDS.map((k) => {
    const has = d.openings.some((o) => o.kind === k);
    return `<label class="${has ? 'on' : ''}" style="--c:${OPENING_INFO[k].color}"><input type="checkbox" data-kind="${k}"${has ? ' checked' : ''}>${OPENING_INFO[k].label}</label>`;
  }).join('') + `<label class="add" data-add="window">＋ 창 추가</label>`;
  if (selectedOp && !d.openings.some((o) => o.id === selectedOp)) pickOpening(null);
}
/** 공간 요소 값 바꾸기 — 메뉴 칸 · 3D 치수 칸이 같이 쓴다. dl · dr = 그 벽을 마주 봤을 때 왼쪽 · 오른쪽 벽 안쪽 면에서 입구 몰딩 안쪽까지 */
function setOpening(o: Opening, f: string, v: number) {
  // 한 줄로 이어진 벽(부엌 옆 벽 + 문턱 두께 + 거실 옆 벽)은 이어진 벽 양 끝에서, 부엌 옆 벽은 트인 쪽 끝 거실 어깨 벽 두께까지 잰다(wallRun)
  const run = wallRun(d, o.wall);
  if (f === 'dl') o.t = v - run.off;
  else if (f === 'dr') o.t = run.L - run.off - o.w - v;
  else (o as unknown as Record<string, number>)[f] = v;
  clampOpening(o, d);
  renderOpenings(); changed(); pickOpening(o.id);
}
/** 3D 치수 — 벽 면 바로 앞(25)을 따라 양옆 벽까지(창 가운데 높이), 창은 바닥에서 창대까지(사용자 2026-11-09 「창문 도어 누르면 벽과의 거리를 3D에서도」) */
function openingDims(o: Opening) {
  const f = wallLine(d, o.wall), run = wallRun(d, o.wall), u = 25;
  const out: { key: string; a: [number, number, number]; b: [number, number, number]; v: number; tick?: [number, number, number]; title: string }[] = [];
  if (!f) return out;
  const y = o.kind === 'window' ? o.sill + o.h / 2 : Math.min(1200, o.h / 2);
  const P = (t: number, yy: number): [number, number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, yy, f.o[1] + f.dir[1] * t + f.n[1] * u];
  // 이어진 벽이면 그 양 끝까지(문턱 두께 150 포함), 어깨 쪽 부엌 옆 벽은 트인 쪽 끝 어깨 벽 두께까지 — 이 벽 t 기준으로 -off ~ L - off
  const dl = run.off + o.t, dr = run.L - run.off - o.t - o.w, joined = run.parts.length > 1 ? ' (이어진 벽 · 두께 포함)' : '';
  const band = ' (거실 어깨 벽 두께 포함)', bandL = run.band && run.off > 0 ? band : '', bandR = run.band && run.off === 0 ? band : '';
  if (dl > 1) out.push({ key: 'dl', a: P(-run.off, y), b: P(o.t, y), v: dl, title: `왼쪽 벽까지${joined || bandL}` });
  if (dr > 1) out.push({ key: 'dr', a: P(o.t + o.w, y), b: P(run.L - run.off, y), v: dr, title: `오른쪽 벽까지${joined || bandR}` });
  if (o.kind === 'window') out.push({ key: 'sill', a: P(o.t + o.w / 2, 0), b: P(o.t + o.w / 2, o.sill), v: o.sill, tick: [f.dir[0] * 60, 0, f.dir[1] * 60], title: '창대 높이 (바닥에서)' });
  return out;
}
/** 공간 요소 메뉴 — 화면에서 누르면 그 자리 위에 뜬다(붙박이장 플래너 문 · 창 메뉴처럼). 벽 · 위치 · 폭 · 높이(창대) · 깊이 · 빼기 */
function pickOpening(id: string | null) {
  selectedOp = id; plan.selected = id;
  const box = $('#item-info');
  const o = id ? d.openings.find((x) => x.id === id) : undefined;
  if (!o) { if (box.dataset.op) { box.hidden = true; delete box.dataset.op; } stage.highlight(null); stage.setDims(null); plan.render(d, current); return; }
  pick(null);
  stage.highlightOpening(o.id);
  stage.setDims(openingDims(o), (k, v) => setOpening(o, k, v));
  plan.render(d, current);
  const i = OPENING_INFO[o.kind], run = wallRun(d, o.wall), L = run.L;
  // 고를 수 있는 벽 — 부엌(트인 쪽 빼고) · 거실(맞은편 · 양옆)
  const walls = ([0, 1, 2, 3, 10, 11, 12] as AnyWall[]).filter((w) => !!wallLine(d, w));
  const num = (f: string, label: string, v: number, step = 10) => `<label>${label}<input data-f="${f}" type="number" step="${step}" value="${Math.round(v)}"></label>`;
  box.innerHTML = `
    <div class="ii-head"><b style="color:${i.color}">●</b><b>${i.label}</b><button title="닫기">×</button></div>
    <div class="ii-model">${anyWallName(d, o.wall)} · 벽 길이 ${L.toLocaleString('ko-KR')}${run.parts.length > 1 ? ` (${run.parts.map((w) => anyWallName(d, w)).join(' + ')} · 사이 두께 150 포함)` : run.band ? ` (트인 쪽 끝 거실 어깨 벽 두께 ${run.band} 포함)` : ''} · 화면에서 끌어 옮기고 평면도 양 끝 ● 로 폭 조절</div>
    <div class="ii-row"><label>벽<select data-f="wall">${walls.map((w) => `<option value="${w}"${w === o.wall ? ' selected' : ''}>${anyWallName(d, w)}</option>`).join('')}</select></label>${num('w', '폭', o.w)}</div>
    <div class="ii-row">${num('dl', '왼쪽 벽까지', run.off + o.t)}${num('dr', '오른쪽 벽까지', L - run.off - o.t - o.w)}</div>
    <div class="ii-row">${o.kind === 'window' ? num('h', '높이', o.h) : o.depth ? num('depth', '깊이', o.depth, 50) : num('h', '높이', o.h)}</div>
    ${o.kind === 'window' ? `<div class="ii-row">${num('sill', '창대 높이 (바닥에서)', o.sill)}<label>&nbsp;<span class="ii-hint">${o.sill >= 930 ? '상판 위 창' : '상판보다 낮음 — 장 뒤가 막힘'}</span></label></div>` : ''}
    ${o.kind === 'utility' || o.kind === 'subkitchen' ? `<div class="ii-label">입구 문</div><div class="ii-seg">${([['swing', '여닫이'], ['sliding', '미닫이'], ['folding', '폴딩']] as const).map(([k, n]) => `<button data-door="${k}" class="${(o.door ?? 'swing') === k ? 'on' : ''}">${n}</button>`).join('')}</div>` : ''}
    <div class="ii-label">추가 영역 <small>${o.kind === 'window' ? '창' : '입구'} 옆으로 장을 두지 않을 폭 — 문 자리와 같이 장 배치에서 뺀다</small></div>
    <div class="ii-row">${num('padL', '왼쪽 폭', o.padL ?? 0, 50)}${num('padR', '오른쪽 폭', o.padR ?? 0, 50)}</div>
    <div class="ii-acts"><button data-act="del">${o.kind === 'window' ? '이 창 빼기' : `${i.label} 빼기`}</button></div>`;
  box.dataset.op = o.id;
  box.hidden = false;
  box.querySelector('.ii-head button')!.addEventListener('click', () => pickOpening(null));
  box.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((inp) => inp.addEventListener('change', () => setOpening(o, inp.dataset.f!, Number(inp.value))));
  box.querySelectorAll<HTMLElement>('[data-door]').forEach((b) => b.addEventListener('click', () => { o.door = b.dataset.door as Opening['door']; changed({ room: true }); pickOpening(o.id); }));
  box.querySelector('[data-act="del"]')!.addEventListener('click', () => {
    d.openings = d.openings.filter((x) => x.id !== o.id);
    pickOpening(null); renderOpenings(); changed();
  });
}
$('#kinds').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest('[data-add]') as HTMLElement | null;
  if (add) { addOpening(add.dataset.add as OpeningKind); return; }
  const inp = t.closest('input[data-kind]') as HTMLInputElement | null;
  if (!inp) return;
  const k = inp.dataset.kind as OpeningKind;
  if (inp.checked) addOpening(k);
  else { d.openings = d.openings.filter((o) => o.kind !== k); renderOpenings(); changed(); }
});
function addOpening(k: OpeningKind) {
  // 빈 벽부터 — 기본 벽이 막혔으면 다른 벽
  const order: AnyWall[] = [DEFAULT_WALL[k], ...([0, 1, 2, 3] as WallId[]).filter((w) => w !== DEFAULT_WALL[k])].filter((w) => w !== d.openWall);
  if (d.openWall != null) order.push(10, 11, 12);   // 부엌 벽이 다 차면 거실 벽에
  for (const w of order) {
    const L = wallLine(d, w)?.L ?? 0;
    const used = d.openings.filter((o) => o.wall === w).map((o) => [o.t - 150, o.t + o.w + 150]).sort((a, b) => a[0] - b[0]);
    const iw = Math.min(OPENING_INFO[k].w, L - 200);
    let t = 100;
    for (const [a, b] of used) { if (t + iw <= a) break; t = Math.max(t, b); }
    if (t + iw <= L - 100) {
      const o = newOpening(k, d.room, isKitchenWall(w) ? w : 0, k === 'window' && !used.length ? (L - iw) / 2 : t);
      o.wall = w; o.w = Math.min(OPENING_INFO[k].w, L - 200); clampOpening(o, d);
      d.openings.push(o);
      renderOpenings(); changed(); pickOpening(o.id);
      return;
    }
  }
  say('빈 벽 자리가 없습니다'); setTimeout(() => say(null), 1500);
}

// 평면도 · 3D 끌기
plan.onSelect = (id) => pickOpening(id);
let liveTimer = 0;
function moveOpening(id: string, patch: { wall?: AnyWall; t?: number; w?: number }, done: boolean) {
  const o = d.openings.find((x) => x.id === id);
  if (!o) return;
  Object.assign(o, patch);
  clampOpening(o, d);
  if (!done) {
    // 끄는 동안 — 그 개구부와 닿은 벽만 고친다(liveOpening). 방 · 장 · 타일 · 창 빛 · 라이트맵은 놓을 때 한 번. 예전엔 매 프레임 방을 통째로
    //   다시 만들어(조명 · 그림자 맵 · 벽 너머 공간까지) 끊겼다(사용자 2026-11-10 「공간요소 이동시에 끊김이 심한데 실시간으로 끊김없이」)
    if (!liveTimer) liveTimer = requestAnimationFrame(() => {
      liveTimer = 0;
      const lo = d.openings.find((x) => x.id === id);
      if (!lo) return;
      stage.beginLiveRoom();
      if (!stage.room || !liveOpening(stage.room, d, lo, (m) => stage.unbake(m))) rebuildRoom();
      stage.invalidate(true);
      if (selectedOp === id) { stage.highlightOpening(id); stage.setDims(openingDims(lo), (k, v) => setOpening(lo, k, v)); }
      plan.render(d, current);
    });
    return;
  }
  // 놓기 — 아직 안 그린 끌기 프레임은 버린다(놓은 뒤 그 프레임이 돌면 새 방의 라이트맵 굽기 예약을 지웠다)
  cancelAnimationFrame(liveTimer); liveTimer = 0;
  renderOpenings();
  changed({ room: true, keep: true });
  if (selectedOp === id) pickOpening(id);   // 메뉴 값도 옮긴 자리로
}
plan.onChange = (id, p, done) => moveOpening(id, p, done);
stage.onDragOpening = (id, wall, t, done) => moveOpening(id, done ? {} : { wall, t: Math.round(t / 10) * 10 }, done);
stage.onPickOpening = (id) => { if (id || selectedOp) pickOpening(id); };
stage.viewWin = () => viewWindow();   // 3D 치수 칸이 정보 창 · 도구 단추 밑에 숨지 않게
// 선택된 것만 끌어 옮긴다 — 장면이 지금 선택을 묻는다
stage.getSel = () => ({ item: picked ?? undefined, island: islandSel, hob: hobSel, opening: selectedOp, dining: diningSel });
// ESC — 끄는 중이면 원래 자리로, 아니면 선택 해제(장 · 아일랜드 · 쿡탑 · 개구부 · 벽)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) { t.blur(); return; }
  if (stage.cancelDrag()) return;
  pick(null);
  if (selectedOp) pickOpening(null);
  $('#item-info').hidden = true; stage.highlight(null); showWallArrow(null); plan.pickedWall = null; plan.render(d, current);
});

/* ───────── 4 스타일 ───────── */
const STYLES: [StyleKind, string, string][] = [
  ['basic', '상하부장을 고르게 · 냉장고장 하나', '<rect x="4" y="6" width="92" height="20" fill="#cfd5dc"/><rect x="4" y="34" width="92" height="22" fill="#9aa5b1"/>'],
  ['cafe', '상부장 대신 오픈 선반 · 유리장 · 아일랜드 바', '<rect x="4" y="12" width="40" height="3" fill="#b07a3a"/><rect x="4" y="22" width="40" height="3" fill="#b07a3a"/><rect x="56" y="6" width="40" height="20" fill="#cfd5dc"/><rect x="4" y="34" width="92" height="22" fill="#9aa5b1"/>'],
  ['storage', '키큰장 · 서랍 위주 · 상부장 빈틈없이', '<rect x="4" y="6" width="18" height="50" fill="#6f7a86"/><rect x="24" y="6" width="18" height="50" fill="#6f7a86"/><rect x="44" y="6" width="52" height="20" fill="#cfd5dc"/><rect x="44" y="34" width="52" height="22" fill="#9aa5b1"/><path d="M48 41h44M48 48h44" stroke="#fff"/>'],
];
function renderStyles() {
  // 코너 팬트리장 — 원본은 유로 계열에만 있다. 끄면 수납 많이 스타일에서만 자동으로 시도
  const hasP = cat.modules.some((m) => m.key === 'pantryCorner' && m.series === grade().series);
  const pin = $<HTMLInputElement>('#pantry');
  pin.checked = !!d.cornerPantry && hasP; pin.disabled = !hasP;
  $('#pantry-sub').textContent = !hasP ? '키친바흐 계열엔 원본 모델이 없음' : d.cornerPantry ? '코너 하나에 코너장 대신 바닥~천장 ㄱ자 수납장 — 끄면 빠짐' : '코너장 대신 바닥~천장 ㄱ자 수납장 · 수납 많이를 고르면 켜짐';
  $('#styles').innerHTML = STYLES.map(([k, sub, svg]) => `<button class="card${d.style === k ? ' on' : ''}" data-style="${k}"><svg viewBox="0 0 100 60">${svg}</svg>${STYLE_LABEL[k]}<small>${sub}</small></button>`).join('');
}
$<HTMLInputElement>('#pantry').addEventListener('change', (e) => { d.cornerPantry = (e.target as HTMLInputElement).checked; renderStyles(); changed({ plan: true }); });
$('#styles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-style]') as HTMLElement | null;
  if (!b) return;
  const prev = d.style;
  d.style = b.dataset.style as StyleKind;
  // 수납 많이 ↔ 코너 팬트리장 체크 — 수납 많이를 고르면 켜지고, 수납 많이에서 다른 스타일로 가면 꺼진다(직접 끄면 그대로 빠진다)
  if (d.style === 'storage' && prev !== 'storage') d.cornerPantry = true;
  else if (prev === 'storage' && d.style !== 'storage') d.cornerPantry = false;
  if (d.style === 'cafe' && !d.island) { d.island = true; renderOpenWall(); renderLayouts(); renderIsland(); }
  renderStyles(); changed({ plan: true });
});

/* ───────── 5 그레이드 · 도어 ───────── */
const GRADE_SUB: Record<string, string> = { e300: '유로 몸통 · 기본', e500: '유로 몸통 · 중급', e700: '유로 몸통 · 상급', e900: '유로 몸통 · 프리미엄', kb5: '키친바흐 몸통', kb7: '키친바흐 몸통 · 최상급' };
function renderGrades() {
  $('#grades').innerHTML = cat.grades.map((g) => `<button data-grade="${g.id}" class="${g.id === d.grade ? 'on' : ''}">${g.label}<small>${GRADE_SUB[g.id] ?? ''} · ${g.doors.length}색</small></button>`).join('');
  // 도어 — 카탈로그(2026.09) 라인별로 묶고 한글 색 이름 · BEST / NEW 표시. 카탈로그에 있는데 원본에 없는 색은 끝에 알림
  const lines = new Map<string, { badge?: string; doors: { x: DoorDef; color: string }[] }>();
  for (const x of grade().doors) {
    const l = doorLabel(x.name);
    if (!lines.has(l.line)) lines.set(l.line, { badge: l.badge, doors: [] });
    lines.get(l.line)!.doors.push({ x, color: l.color });
  }
  const miss = DOOR_MISSING[grade().id];
  $('#doors').innerHTML = [...lines].map(([line, g]) => `<div class="sw-line">${line}${g.badge ? ` <b class="badge ${g.badge.toLowerCase()}">${g.badge}</b>` : ''}<small>${g.doors.length}색</small></div>`
    + g.doors.map(({ x, color }) => {
      // 단면 자료가 없어 앞면이 깨져 보이는 도어는 목록에 없다(kjlLib loadCatalog 가 뺀다). 손잡이 · 옆마감만 근사된 도어는 설명에 알린다
      const gap = doorGaps(x.obs);
      const note = gap.length ? ` — 일부 단면 없음(${gap.join(', ')}): 손잡이 · 테두리 모양이 근사됨` : '';
      return `<button class="sw${x.obs === d.door ? ' on' : ''}" data-door="${x.obs}" title="${line} ${color} · 원본 ${x.name}${note}"><img loading="lazy" src="${x.img ?? ''}" alt=""><span>${color}</span></button>`;
    }).join('')).join('')
    + (miss ? `<div class="sw-miss">카탈로그에 있고 원본 자료에 없는 색: ${miss.join(' · ')}</div>` : '');
}
$('#grades').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-grade]') as HTMLElement | null;
  if (!b) return;
  const prevSeries = grade().series;
  d.grade = b.dataset.grade!;
  d.door = usableDoors(grade())[0].obs;
  renderGrades(); renderStyles();
  // 몸통 계열이 바뀌면(유로 ↔ 키친바흐) 모듈 폭이 달라 다시 배치
  changed(prevSeries !== grade().series ? { plan: true } : { kitchen: true });
});
$('#doors').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-door]') as HTMLElement | null;
  if (!b) return;
  d.door = b.dataset.door!;
  renderGrades(); changed({ kitchen: true });
});

/* ───────── 6 재질 ───────── */
function renderMats() {
  const sw = (id: string, img: string, name: string, on: boolean, attr: string) => `<button class="sw${on ? ' on' : ''}" ${attr}="${id}" title="${name}"><img loading="lazy" src="${img}" alt=""><span>${name}</span></button>`;
  // 상판 — 카탈로그 소재별(인조대리석 HS스톤 · 스테인리스 · 세라믹 · 엔지니어드스톤)로 묶고, 카탈로그에 없는 원본은 「기타」
  const cg = new Map<string, string>();
  for (const x of cat.counters) { const l = counterLabel(x.name); cg.set(l.group, (cg.get(l.group) ?? '') + sw(x.id, texUrl(x.id), l.name, x.id === d.counter, 'data-counter')); }
  $('#counters').innerHTML = [...cg].map(([g, h]) => `<div class="sw-line">${g}</div>${h}`).join('')
    + '<div class="sw-miss">카탈로그의 세라믹(12T) · 엔지니어드스톤(12 · 15 · 20T) 상판은 원본 자료에 없습니다</div>';
  $('#tiles').innerHTML = cat.tiles.map((x) => sw(x.id, texUrl(x.id), x.name, x.id === d.tile, 'data-tile')).join('');
  $('#floors').innerHTML = cat.floors.map((x: { id: string; thumb: string; name: string }) => sw(x.id, BASE + x.thumb, x.name, x.id === d.floor, 'data-floor')).join('');
  // 벽지 — 고르는 범위(전체 · 공간별 · 벽마다)와 대상. 칸에는 그 대상에 지금 적용된 벽지가 켜진다
  const tg = wpTargets(), cur = wpTarget && tg.some(([k]) => k === wpTarget) ? wpTarget : tg[0]?.[0] ?? '';
  wpTarget = cur;
  const by = d.wallpaperBy ?? {};
  const shownWp = wpMode === 'all' ? d.wallpaper : wpMode === 'space' ? by[cur] ?? d.wallpaper : wallpaperOf(d, wpSpaceOf(cur), cur);
  const own = wpMode !== 'all' && by[cur] != null;
  $('#wallps-scope').innerHTML = `<div class="ii-seg">${([['all', '전체'], ['space', '공간별'], ['wall', '벽마다']] as const).map(([k, n]) => `<button data-wpm="${k}" class="${wpMode === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    ${wpMode === 'all' ? '<small>모든 벽 — 공간 · 벽마다 따로 고른 것은 지워집니다</small>' : `<select data-wpt>${tg.map(([k, n]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${n}${by[k] != null ? ' ●' : ''}</option>`).join('')}</select>
    <button data-wpr class="plain"${own ? '' : ' disabled'}>${wpMode === 'space' ? '전체 따르기' : '공간 따르기'}</button>`}`;
  $('#wallps').innerHTML = sw('', 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f1eee8"/></svg>'), '페인트', shownWp === '', 'data-wallp')
    + cat.walls.map((x: { id: string; thumb: string; name: string }) => sw(x.id, BASE + x.thumb, x.name, x.id === shownWp, 'data-wallp')).join('');
}
/* 벽지 범위 — 전체 · 공간별(부엌 · 거실 · 벽 너머 공간) · 벽마다(부엌 벽 · 거실 벽 · 벽 너머 공간 하나씩) */
let wpMode: 'all' | 'space' | 'wall' = 'all', wpTarget = '';
const wpSpaceOf = (k: string): WallSpace => (k.startsWith('l') ? 'living' : k.startsWith('r') ? 'room' : 'kitchen');
function wpTargets(): [string, string][] {
  const rooms = d.openings.filter((o) => o.depth);
  if (wpMode === 'space') return [['kitchen', '부엌'], ...(d.openWall != null ? [['living', '거실'] as [string, string]] : []), ...(rooms.length ? [['room', '벽 너머 공간'] as [string, string]] : [])];
  if (wpMode !== 'wall') return [];
  const v = viewWalls(d.openWall);
  const kw = [v.left, v.front, v.right, v.near].filter((w) => w !== d.openWall).map((w) => [`k${w}`, `부엌 ${wallName(d.openWall, w)}`] as [string, string]);
  const lw: [string, string][] = d.openWall == null ? [] : [['l10', '거실 맞은편 벽'], ['l11', '거실 옆벽 (한쪽)'], ['l12', '거실 옆벽 (반대쪽)'], ['l15', '거실 부엌 쪽 벽 (한쪽)'], ['l16', '거실 부엌 쪽 벽 (반대쪽)']];
  const rw = rooms.map((o) => [`r${o.id}`, `${OPENING_INFO[o.kind].label} (${anyWallName(d, o.wall)})`] as [string, string]);
  return [...kw, ...lw, ...rw];
}
$('#wallps-scope').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!b) return;
  if (b.dataset.wpm) { wpMode = b.dataset.wpm as typeof wpMode; wpTarget = ''; renderMats(); return; }
  if (b.dataset.wpr != null && wpTarget) { const by = { ...(d.wallpaperBy ?? {}) }; delete by[wpTarget]; d.wallpaperBy = by; renderMats(); changed({ room: true }); }
});
$('#wallps-scope').addEventListener('change', (e) => { const s = e.target as HTMLSelectElement; if (s.dataset.wpt != null) { wpTarget = s.value; renderMats(); } });
for (const [sel, key, kitchen] of [['#counters', 'counter', true], ['#tiles', 'tile', true], ['#floors', 'floor', false], ['#wallps', 'wallpaper', false]] as const) {
  $(sel).addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.sw') as HTMLElement | null;
    if (!b) return;
    const attr = [...b.attributes].find((a) => a.name.startsWith('data-'))!;
    if (key === 'wallpaper' && wpMode !== 'all') {
      // 공간별 — 그 공간 안 벽마다 값은 지운다(공간 값이 보이도록) · 벽마다 — 그 벽만
      const by = { ...(d.wallpaperBy ?? {}) };
      if (wpMode === 'space') for (const k of Object.keys(by)) if (k !== wpTarget && wpSpaceOf(k) === wpTarget && !['kitchen', 'living', 'room'].includes(k)) delete by[k];
      by[wpTarget] = attr.value; d.wallpaperBy = by;
    } else {
      (d as unknown as Record<string, string>)[key] = attr.value;
      if (key === 'wallpaper') d.wallpaperBy = {};
    }
    renderMats();
    changed(kitchen ? { kitchen: true } : { room: true });
  });
}

/* ───────── 식탁 — 모양(원형 · 타원 · 4각) · 인원(4 · 6) · 한샘 상품 · 자리 ───────── */
function renderDining() {
  const on = !!d.dining?.on;
  plan.render(d, current);   // 평면도에도 식탁 · 의자
  $<HTMLInputElement>('#dining').checked = on;
  const box = $('#dining-box');
  box.hidden = !on;
  if (!on || !d.dining) return;
  box.innerHTML = diningHtml();
}
/** 식탁 고르기 메뉴 — 모양 · 인원 · 상품 · 의자 · 자리 · 회전 (사이드바와 화면 메뉴가 같이 쓴다) */
function diningHtml(): string {
  if (!d.dining) return '';
  const c = d.dining, set = diningOf(d);
  const list = DINING_SETS.filter((x) => x.shape === c.shape && x.seats === c.seats);
  const won = (n: number) => `${Math.round(n / 1000).toLocaleString()}천원`;
  return `
    <div class="ii-seg">${DINING_SHAPES.map(([k, n]) => `<button data-dsh="${k}" class="${c.shape === k ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="ii-seg">${([4, 6] as const).map((k) => { const has = DINING_SETS.some((x) => x.shape === c.shape && x.seats === k); return `<button data-dse="${k}" class="${c.seats === k ? 'on' : ''}"${has ? '' : ' disabled title="이 모양의 상품이 없습니다"'}>${k}인</button>`; }).join('')}</div>
    <select data-dcode>${(list.length ? list : DINING_SETS.filter((x) => x.shape === c.shape)).map((x) => `<option value="${x.code}"${x === set ? ' selected' : ''}>${x.name} · ${x.size[0]}×${x.size[1]} · ${won(x.price)}</option>`).join('')}</select>
    ${set ? `<div class="isl-note">의자 ${set.seats}개 — ${set.chair.name}${set.chair.auto ? ' (짝 의자가 없어 기본 의자)' : ''} · ${won(set.chair.price)}/개</div>` : ''}
    <div class="ii-seg"><button data-dwh="living" class="${c.where !== 'kitchen' ? 'on' : ''}"${d.openWall == null ? ' disabled' : ''}>거실 쪽</button><button data-dwh="kitchen" class="${c.where === 'kitchen' ? 'on' : ''}">부엌 가운데</button><button data-drot>↻ 회전</button></div>`;
}
/** 식탁 — 화면에서 누르면 선택 상자 + 화면 메뉴(같은 고르기) */
let diningSel = false;
function pickDining() {
  pick(null);
  if (!d.dining?.on) return;
  diningSel = true;
  markDining();
  const box = $('#item-info'), set = diningOf(d);
  box.innerHTML = `<div class="ii-head"><b>식탁 · ${set?.name ?? ''}</b><button title="닫기">×</button></div>
    <div class="ii-model">한샘 식탁 · 식탁의자 ${set?.seats ?? ''}개${set ? ` · ${set.size[0]}×${set.size[1]}×${set.size[2]}` : ''} · 다시 눌러 끌어 옮기고, 바닥 파란 고리를 끌어 돌리기(15° 단위)</div>
    <div class="dining-box">${diningHtml()}</div>
    <div class="ii-acts"><button data-doff class="plain">식탁 빼기</button></div>`;
  box.hidden = false;
  box.querySelector('.ii-head button')!.addEventListener('click', () => { box.hidden = true; diningSel = false; stage.highlight(null); stage.setIslandRing(null); });
  box.querySelector('[data-doff]')!.addEventListener('click', () => { d.dining!.on = false; saveDesign(d); renderDining(); box.hidden = true; diningSel = false; stage.highlight(null); stage.setIslandRing(null); void rebuildKitchen(); });
  box.querySelector('.dining-box')!.addEventListener('click', (e) => diningClick(e, true));
  box.querySelector('.dining-box')!.addEventListener('change', (e) => diningChange(e, true));
}
stage.onPickDining = pickDining;
/** 식탁 묶음(식탁 + 의자) — 자리 · 회전이 걸린 holder */
const diningHolder = () => { let h: THREE.Object3D | null = null; stage.kitchen?.getObjectByName('dining')?.traverse((o) => { if (!h && o.userData.dining) h = o; }); return h as THREE.Object3D | null; };
/** 고른 표시 — 상자 + 회전 고리(15° 딸깍). ring=false 면 상자만(돌리는 중엔 고리가 스스로 돈다) */
function markDining(ring = true) {
  const h = diningHolder();
  if (!diningSel || !h) { stage.setIslandRing(null); return; }
  const b = new THREE.Box3().setFromObject(h);
  stage.highlight(b);
  if (!ring) return;
  const sz = b.getSize(new THREE.Vector3());
  const v = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), h.rotation.y);
  stage.setIslandRing({ c: [h.position.x * 1000, h.position.z * 1000], R: Math.hypot(sz.x, sz.z) * 500 + 200, knob: Math.atan2(v.x, v.z), step: 15, deg: d.dining?.rot ?? 0 });
}
/** 끌어 옮기기 — 끄는 동안은 3D 묶음만 옮기고, 놓으면 자리를 저장(다시 짓지 않는다) */
stage.getDining = () => { const h = diningHolder(); return h ? { x: h.position.x * 1000, z: h.position.z * 1000 } : null; };
stage.onDragDining = (x, z, done) => {
  const h = diningHolder(), c = d.dining, set = diningOf(d);
  if (!h || !c || !set) return;
  // 거실 쪽 식탁은 트인 벽 밖에 서므로 방 둘레 3m 까지
  const M = 3000;
  x = Math.max(-M, Math.min(d.room.w + M, x)); z = Math.max(-M, Math.min(d.room.d + M, z));
  h.position.set(x / 1000, h.position.y, z / 1000);
  if (!done) { markDining(false); return; }
  c.pos = { x: Math.round(x), z: Math.round(z), rot: diningPlace(d, set).rot };
  saveDesign(d); markDining(); plan.render(d, current);
};
/** 회전 고리 — deg = 끌기 시작 대비 three 회전(15 단위). 식탁 회전(rot, 도)에 더한다 */
let dinRot0: number | null = null;
function diningRotate(deg: number, done: boolean) {
  const h = diningHolder(), c = d.dining;
  if (!h || !c) return;
  if (dinRot0 == null) dinRot0 = h.rotation.y;
  h.rotation.y = dinRot0 + deg * Math.PI / 180;
  if (!done) { stage.setRingLabel((c.rot ?? 0) + deg); markDining(false); return; }
  dinRot0 = null;
  c.rot = ((((c.rot ?? 0) + deg) % 360) + 360) % 360;
  saveDesign(d); renderDining(); markDining(); plan.render(d, current);
}
$<HTMLInputElement>('#fridge-on').addEventListener('change', (e) => {
  d.noFridge = !(e.target as HTMLInputElement).checked; pick(null); changed({ plan: true });
});
$<HTMLInputElement>('#fridge-on').checked = !d.noFridge;
$<HTMLInputElement>('#dining').addEventListener('change', (e) => {
  const on = (e.target as HTMLInputElement).checked;
  d.dining = { shape: 'rect', seats: 4, ...(d.dining ?? {}), on };
  saveDesign(d); renderDining(); void rebuildKitchen();
});
/** 식탁 메뉴 누름 — fromView 면 다시 그린 뒤 화면 메뉴도 다시 띄운다 */
function diningClick(e: Event, fromView = false) {
  const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
  if (!b || !d.dining || b.dataset.doff != null) return;
  const c = d.dining;
  if (b.dataset.dsh) { c.shape = b.dataset.dsh as typeof c.shape; delete c.code; if (!DINING_SETS.some((x) => x.shape === c.shape && x.seats === c.seats)) c.seats = c.seats === 4 ? 6 : 4; }
  else if (b.dataset.dse) { c.seats = Number(b.dataset.dse) as 4 | 6; delete c.code; }
  else if (b.dataset.dwh) { c.where = b.dataset.dwh as 'living' | 'kitchen'; delete c.pos; }
  else if (b.dataset.drot != null) c.rot = ((c.rot ?? 0) + 90) % 360;
  else return;
  saveDesign(d); renderDining(); void rebuildKitchen().then(() => { if (fromView || diningSel) pickDining(); });
}
function diningChange(e: Event, fromView = false) {
  const s = e.target as HTMLSelectElement;
  if (s.dataset.dcode == null || !d.dining) return;
  d.dining.code = s.value; saveDesign(d); renderDining(); void rebuildKitchen().then(() => { if (fromView || diningSel) pickDining(); });
}
$('#dining-box').addEventListener('click', (e) => diningClick(e));
$('#dining-box').addEventListener('change', (e) => diningChange(e));

/* ───────── 로봇청소기 — 걸레받이 문 열기 → 나와서 바닥을 지그재그로 → 충전대로 → 문 닫기 ─────────
 *  바닥 칸(100mm)에서 벽 · 장 줄 걸레받이선 · 키큰장 · 냉장고 · 아일랜드를 로봇 반지름(180)만큼 넓혀 막고, 300 간격 줄을 번갈아 훑는다.
 *  막혀 이어지지 않는 줄 사이는 칸 너비 우선 탐색으로 돌아간다. 장면 단위는 m, 계산은 평면 mm */
let robotRun: { stop: boolean } | null = null;
function robotPath(c: Candidate, start: [number, number]): [number, number][] {
  // 청소 바닥 = 부엌 + 거실(트인 벽 너머 T자) + 그 사이 트인 곳. 부엌만 있으면 부엌 바닥
  const W = d.room.w, D = d.room.d, CELL = 100, R = 180, WT = 150;
  const zones: { f: Frame; t0: number; t1: number; u0: number; u1: number }[] = [];
  const kf: Frame = { o: [0, 0], dir: [1, 0], n: [0, 1] };
  zones.push({ f: kf, t0: R, t1: W - R, u0: R, u1: D - R });
  if (d.openWall != null) {
    const of = wallFrame(d.room, d.openWall), lf: Frame = { o: of.o as [number, number], dir: of.dir as [number, number], n: of.n as [number, number] };
    const L = wallLength(d.room, d.openWall), lv = livingOf(d);
    zones.push({ f: lf, t0: -lv.a + R, t1: L + lv.b - R, u0: -(WT + lv.depth) + R, u1: -WT - R });     // 거실 안
    zones.push({ f: lf, t0: d.wing.a + R, t1: L - d.wing.b - R, u0: -WT - R - CELL, u1: R + CELL });   // 트인 곳(날개벽 사이)
  }
  const inZ = (z: { f: Frame; t0: number; t1: number; u0: number; u1: number }, x: number, y: number) => {
    const px = x - z.f.o[0], pz = y - z.f.o[1], t = px * z.f.dir[0] + pz * z.f.dir[1], u = px * z.f.n[0] + pz * z.f.n[1];
    return t >= z.t0 && t <= z.t1 && u >= z.u0 && u <= z.u1;
  };
  // 격자 범위 — 모든 바닥 구역을 덮는 사각형
  let X0 = 0, X1 = W, Z0 = 0, Z1 = D;
  for (const z of zones) for (const t of [z.t0, z.t1]) for (const u of [z.u0, z.u1]) {
    const x = z.f.o[0] + z.f.dir[0] * t + z.f.n[0] * u, y = z.f.o[1] + z.f.dir[1] * t + z.f.n[1] * u;
    X0 = Math.min(X0, x - R); X1 = Math.max(X1, x + R); Z0 = Math.min(Z0, y - R); Z1 = Math.max(Z1, y + R);
  }
  const nx = Math.ceil((X1 - X0) / CELL), nz = Math.ceil((Z1 - Z0) / CELL);
  const rects: { f: Frame; t0: number; t1: number; u0: number; u1: number }[] = [];
  for (const it of c.items) {
    if (it.level !== 'base' && it.level !== 'tall') continue;
    if (it.wall == null) continue;
    // 하부장은 걸레받이선(538)까지, 키큰장 600 · 냉장고 720
    const u1 = it.tag === 'fridge' ? 720 : it.level === 'tall' ? 600 : it.robot ? 0 : 540;
    if (u1 > 0) rects.push({ f: it.frame, t0: it.t, t1: it.t + it.w, u0: 0, u1 });
  }
  for (const ct of c.counters) if (ct.island) rects.push({ f: ct.frame, t0: ct.t0, t1: ct.t1, u0: ct.z0, u1: ct.z1 });
  const free = (x: number, z: number) => {
    if (!zones.some((zn) => inZ(zn, x, z))) return false;
    for (const r of rects) {
      const px = x - r.f.o[0], pz = z - r.f.o[1];
      const t = px * r.f.dir[0] + pz * r.f.dir[1], u = px * r.f.n[0] + pz * r.f.n[1];
      if (t > r.t0 - R && t < r.t1 + R && u > r.u0 - R && u < r.u1 + R) return false;
    }
    return true;
  };
  const ok: boolean[] = [];
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) ok[k * nx + i] = free(X0 + (i + 0.5) * CELL, Z0 + (k + 0.5) * CELL);
  const cell = (p: [number, number]) => [Math.max(0, Math.min(nx - 1, Math.floor((p[0] - X0) / CELL))), Math.max(0, Math.min(nz - 1, Math.floor((p[1] - Z0) / CELL)))] as [number, number];
  const ctr = (i: number, k: number): [number, number] => [X0 + (i + 0.5) * CELL, Z0 + (k + 0.5) * CELL];
  /** 칸 너비 우선 — a → b 칸 경로 */
  const bfs = (a: [number, number], b: [number, number]): [number, number][] => {
    const prev = new Int32Array(nx * nz).fill(-2), q = [a[1] * nx + a[0]]; prev[q[0]] = -1;
    const goal = b[1] * nx + b[0];
    for (let h = 0; h < q.length; h++) {
      const v = q[h]; if (v === goal) break;
      const i = v % nx, k = (v - i) / nx;
      for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, kk = k + dk; if (ii < 0 || kk < 0 || ii >= nx || kk >= nz) continue;
        const w = kk * nx + ii; if (prev[w] !== -2 || (!ok[w] && w !== goal)) continue;
        prev[w] = v; q.push(w);
      }
    }
    if (prev[goal] === -2) return [];
    const out: [number, number][] = [];
    for (let v = goal; v !== -1; v = prev[v]) { const i = v % nx; out.unshift(ctr(i, (v - i) / nx)); }
    return out;
  };
  // 지그재그 줄 — 300 간격, 줄마다 빈 구간들의 양 끝
  const goals: [number, number][] = [];
  let flip = false;
  for (let z = Z0 + R + 50; z < Z1 - R; z += 300) {
    const k = Math.floor((z - Z0) / CELL), segs: [number, number][] = [];
    let s = -1;
    for (let i = 0; i <= nx; i++) { const f = i < nx && ok[k * nx + i]; if (f && s < 0) s = i; if (!f && s >= 0) { segs.push([s, i - 1]); s = -1; } }
    const ordered = flip ? segs.reverse().map(([a, b]) => [b, a] as [number, number]) : segs;
    for (const [a, b] of ordered) goals.push(ctr(a, k), ctr(b, k));
    flip = !flip;
  }
  // 이어 붙이기 — 곧게 갈 수 있으면 그대로, 아니면 칸 경로
  const path: [number, number][] = [start];
  let cur = cell(start);
  for (const gp of [...goals, start]) {
    const gc = cell(gp);
    const seg = bfs(cur, gc);
    if (!seg.length) continue;
    for (const p of seg.slice(1)) path.push(p);
    cur = gc;
  }
  // 같은 방향 칸은 줄여 꺾이는 점만
  const out: [number, number][] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1], b = path[i], n = path[i + 1];
    if (Math.sign(b[0] - a[0]) === Math.sign(n[0] - b[0]) && Math.sign(b[1] - a[1]) === Math.sign(n[1] - b[1])) continue;
    out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
function runRobot(it: Item) {
  const e = lastKitchen?.items.find((x) => x.item === it);
  const rd = e?.obj.userData.robot as { rb: THREE.Object3D; flap: THREE.Object3D; dock: [number, number] } | undefined;
  if (!e || !rd || !current) return;
  const obj = e.obj, S = 0.001;
  obj.updateMatrixWorld(true);
  const toPlan = (lx: number, lz: number): [number, number] => { const v = obj.localToWorld(new THREE.Vector3(lx, 0, lz)); return [v.x / S, v.z / S]; };
  const toLocal = (p: [number, number]) => obj.worldToLocal(new THREE.Vector3(p[0] * S, 0, p[1] * S));
  const dock = toPlan(rd.dock[0], rd.dock[1]), gate = toPlan(rd.dock[0], 900);
  const path = [dock, ...robotPath(current, gate), dock];
  const run = { stop: false }; robotRun = run;
  const SPEED = 900;   // mm/s — 실제(약 300)보다 3배 빠르게 보여 준다
  let phase: 'open' | 'drive' | 'close' = 'open', t = 0, seg = 0, last = performance.now();
  const step = (now: number) => {
    if (!rd.rb.parent || robotRun !== run) return;           // 다시 그려졌거나 다른 청소가 시작됨
    stage.invalidate(true);                                   // 움직이는 동안 그린다(가만히 있으면 화면을 그리지 않는다)
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (run.stop && phase === 'drive') { seg = path.length - 2; t = 1; }   // 멈춤 — 곧장 충전대로(마지막 구간)
    if (phase === 'open') { t += dt / 0.6; rd.flap.rotation.x = Math.min(1, t) * Math.PI / 2; if (t >= 1) { phase = 'drive'; t = 0; } }
    else if (phase === 'drive') {
      const a = path[seg], b = path[seg + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      t += (dt * SPEED) / len;
      const k = Math.min(1, t), p: [number, number] = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      const la = toLocal(a), lb = toLocal(b), lp = toLocal(p);
      rd.rb.position.set(lp.x, 4, lp.z);
      if (len > 1) rd.rb.rotation.y = Math.atan2(lb.x - la.x, lb.z - la.z) + Math.PI;   // 범퍼(−z)가 가는 쪽
      if (t >= 1) { seg++; t = 0; if (seg >= path.length - 1) { phase = 'close'; t = 0; } }
    } else { t += dt / 0.6; rd.flap.rotation.x = Math.max(0, 1 - t) * Math.PI / 2; if (t >= 1) { rd.rb.rotation.y = 0; robotRun = null; if (picked === it) pick(it); return; } }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ───────── 7 가전 — 카탈로그 규격표. 쿡탑 · 싱크볼은 고른 규격으로 3D 모델 크기를, 후드는 폭을 맞춘다 ───────── */
function renderAppliances() {
  const sz = (s?: (number | null)[]) => (s && s[0] ? s.filter((x) => x != null).join('×') : '');
  $('#appliances').innerHTML = APPLIANCE_CATS.map(([cat, label]) => {
    const list = APPLIANCES.filter((a) => a.cat === cat);
    const cur = applianceOf(cat, d.appliance?.[cat as keyof NonNullable<Design['appliance']>]);
    const note = cur ? [sz(cur.size) && `규격 ${sz(cur.size)}`, cur.cut && cur.cut[0] ? `상판 재단 ${sz(cur.cut)}` : '', cur.type ?? ''].filter(Boolean).join(' · ') : '';
    return `<label class="app"><span>${label}</span><select data-app="${cat}">${cur ? '' : '<option value="">고르지 않음</option>'}${list.map((a) => `<option value="${a.model}"${a === cur ? ' selected' : ''}>${a.name}${a.badge ? ` [${a.badge}]` : ''}${sz(a.size) ? ` · ${sz(a.size)}` : ''}</option>`).join('')}</select><small>${note}</small></label>`;
  }).join('') + '<div class="sw-miss">쿡탑 · 싱크볼은 고른 규격으로 3D 크기를, 빌트인 후드는 폭을 맞춥니다. 오븐은 같은 브랜드 · 높이의 빌트인 오븐 모델로 보여 줍니다(밀레 · 삼성, 그 밖은 로고 없는 모델). 수전 · 식기세척기는 목록 기록만(모델 형상은 그대로)</div>';
}
$('#appliances').addEventListener('change', (e) => {
  const s = e.target as HTMLSelectElement;
  const cat = s.dataset.app as ApplianceCat | undefined;
  if (!cat) return;
  d.appliance = { ...(d.appliance ?? {}), [cat]: s.value };
  renderAppliances(); changed(cat === 'hob' || cat === 'hood' ? { keep: true } : { kitchen: true });   // 쿡탑 폭 · 후드 방식(빌트인 · 침니)이 바뀌면 배치도 다시
});

/* 창밖 풍경 */
let outdoor = 'city';
try { outdoor = localStorage.getItem('kitchen-planner.outdoor') ?? 'city'; } catch { /* 기본 */ }
function renderOutdoor() {
  $('#outdoor').innerHTML = Object.entries(OUTDOOR).map(([k, v]) => `<button data-out="${k}" class="${k === outdoor ? 'on' : ''}">${v.label}</button>`).join('');
}
$('#outdoor').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-out]') as HTMLElement | null;
  if (!b) return;
  outdoor = b.dataset.out!;
  try { localStorage.setItem('kitchen-planner.outdoor', outdoor); } catch { /* 저장 못 해도 화면은 그대로 */ }
  stage.setOutdoor(outdoor); renderOutdoor();
});
renderOutdoor(); stage.setOutdoor(outdoor);

/* ───────── 자동 배치 안 ───────── */
function renderCands() {
  $('#ai-sub').textContent = cands.length ? `${cands.length}개 안 · 점수순 · 눌러서 고르기` : '';
  if (!cands.length) {
    $('#cands').innerHTML = `<div class="cand-empty">이 조건으로는 배치할 수 없습니다 — 공간 구조를 바꾸거나 막힌 벽(문 · 팬트리 등)을 옮겨 보세요.</div>`;
    return;
  }
  $('#cands').innerHTML = cands.map((c) => `
    <button class="cand${c === current ? ' on' : ''}" data-cand="${c.id}">
      <div class="top"><b>${c.title}</b><span class="score">${c.score}</span></div>
      <div class="bars">${Object.entries(c.metrics).map(([k, v]) => `<span>${k}</span><span class="bar"><i style="width:${v}%"></i></span>`).join('')}</div>
      <ul>${c.reasons.slice(0, 3).map((r) => `<li>${r}</li>`).join('')}${c.warnings.map((w) => `<li class="warn">${w}</li>`).join('')}${mepOf(d, c).checks.filter((x) => x.level === 'warn').map((x) => `<li class="warn mep">설비 · ${x.text}</li>`).join('')}</ul>
    </button>`).join('');
}
$('#cands').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('[data-cand]') as HTMLElement | null;
  if (!b) return;
  if (preview) endPreview(false, false);
  current = cands.find((c) => c.id === b.dataset.cand) ?? current;
  if (current && d.layout !== 'walls') d.walls = current.walls;
  renderCands(); plan.render(d, current); void rebuildKitchen();
});
$('#ai-run').addEventListener('click', () => replan(false));
/* 프롬프트 — 말로 조건을 주면 설정을 바꾸고 다시 배치 */
/* 프롬프트 해석 — 규칙(앱 안, 정해진 말만) 또는 AI(Claude · Gemini · GPT — 개발 서버 중계 /api/ai, 키는 서버 .env.local).
 * AI 가 실패하면(키 없음 · 연결 끊김 · 형식 오류) 규칙으로 해석하고 그 사실을 알린다 */
const AI_KEY = 'kitchen-planner.ai';
const aiCfg: { provider: 'rule' | AiProvider; model?: string } = (() => { try { return { provider: 'rule' as const, ...JSON.parse(localStorage.getItem(AI_KEY) ?? '{}') }; } catch { return { provider: 'rule' as const }; } })();
const aiSel = $<HTMLSelectElement>('#ai-provider'), aiModel = $<HTMLSelectElement>('#ai-model');
const saveAi = () => { try { localStorage.setItem(AI_KEY, JSON.stringify(aiCfg)); } catch { /* 이번 화면엔 반영 */ } };
function renderAiModels() {
  const p = aiSel.value as 'rule' | AiProvider;
  aiModel.hidden = p === 'rule';
  if (p === 'rule') return;
  const list = AI_MODELS[p].models;
  aiModel.innerHTML = list.map((m) => `<option value="${m}">${m}</option>`).join('');
  aiModel.value = aiCfg.provider === p && aiCfg.model && list.includes(aiCfg.model) ? aiCfg.model : list[0];
}
void aiStatus().then((st) => {
  for (const [p, info] of Object.entries(AI_MODELS) as [AiProvider, { label: string }][]) {
    const ok = !!st?.[p];
    const o = new Option(`${info.label}${ok ? '' : st ? ' (키 없음)' : ' (서버 없음)'}`, p);
    o.disabled = !ok; aiSel.append(o);
  }
  aiSel.value = aiCfg.provider !== 'rule' && st?.[aiCfg.provider] ? aiCfg.provider : 'rule';
  renderAiModels();
});
aiSel.addEventListener('change', () => { aiCfg.provider = aiSel.value as 'rule' | AiProvider; renderAiModels(); aiCfg.model = aiModel.hidden ? undefined : aiModel.value; saveAi(); });
aiModel.addEventListener('change', () => { aiCfg.model = aiModel.value; saveAi(); });

async function runPrompt() {
  const inp = $<HTMLInputElement>('#prompt');
  const text = inp.value.trim();
  if (!text) return;
  const out = $('#prompt-out'), go = $<HTMLButtonElement>('#prompt-go');
  const p = aiSel.value as 'rule' | AiProvider;
  const before = JSON.stringify(d);
  let r: { applied: string[]; unknown: string[]; reply?: string };
  if (p !== 'rule') {
    out.innerHTML = `<em>${AI_MODELS[p].label}(${aiModel.value}) 해석 중…</em>`;
    go.disabled = true;
    try {
      const a = await aiDesign(text, d, cat, p, aiModel.value);
      r = { ...a, reply: `${a.reply}${a.reply ? ' · ' : ''}${AI_MODELS[p].label} ${(a.ms / 1000).toFixed(1)}초` };
    } catch (e) {
      r = { ...applyPrompt(text, d, cat), reply: `AI 연결 실패(${(e as Error).message.slice(0, 140)}) — 규칙으로 해석했습니다` };
    } finally { go.disabled = false; }
  } else r = applyPrompt(text, d, cat);
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  out.innerHTML = (r.applied.length
    ? r.applied.map((x) => `<span>${esc(x)}</span>`).join('') + (r.unknown.length ? `<em>못 알아들은 말: ${esc(r.unknown.join(', '))}</em>` : '')
    : `<em>알아들은 조건이 없습니다 — 예) 「수납 많이」 「답답하지 않게」 「동선이 편하게」 「카페 스타일」</em>`) + (r.reply ? `<em class="ai-reply">${esc(r.reply)}</em>` : '');
  if (JSON.stringify(d) === before) return;
  for (const o of d.openings) clampOpening(o, d);
  syncRoomInputs();
  if (!grade().doors.some((x) => x.obs === d.door)) d.door = usableDoors(grade())[0].obs;
  renderOpenWall(); renderLayouts(); renderIsland(); renderClear(); renderOpenings(); renderStyles(); renderGrades(); renderMats(); renderAppliances(); renderDining();
  changed({ room: true, plan: true }); aim();
}
$('#prompt-go').addEventListener('click', () => void runPrompt());
// 예시 — 눌러서 바로 적용
document.querySelectorAll<HTMLElement>('#prompt-bar [data-ex]').forEach((b) => b.addEventListener('click', () => { $<HTMLInputElement>('#prompt').value = b.dataset.ex!; void runPrompt(); }));
$<HTMLInputElement>('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) void runPrompt(); });

/* ───────── 장 고르기 — 이름 · 사이즈 · 폭 바꾸기 ───────── */
const NAMES: Record<string, string> = { fridge: '냉장고장 (비스포크 1도어 2대)', fixFill: 'FIX 판 (끝 조각)' };
const modOf = (it: Item) => cat.modules.find((m) => m.key === it.key && (m.series === grade().series || m.series === '*')) ?? cat.modules.find((m) => m.key === it.key);
/** 폭 선택지 — 원본 W 변수. 휠라는 50 · 75 · 100 · 150, 폭을 바꾸면 안 되는 것(EP · 냉장고 · FIX)은 없음. 코너장 · 상부 코너장은 원본 규격 폭(900 · 1000 / 700 · 750) */
const fixedW = (it: Item) => it.tag === 'ep' || it.tag === 'fix' || it.tag === 'fridge' || it.key === 'fridgeTop' || it.key === 'pantryCorner' || it.level === 'shelf';
function widthOptions(it: Item): number[] {
  if (fixedW(it)) return [];
  if (/fill/.test(it.key)) return [50, 75, 100, 150];
  return widthsOf(modOf(it));
}
/** 직접 입력 범위 — 원본 비규격 W_MIN ~ W_MAX (없으면 규격 폭 최소 ~ 최대) */
function widthRange(it: Item): [number, number] | null {
  if (fixedW(it)) return null;
  const m = modOf(it), o = widthOptions(it);
  if (/fill/.test(it.key)) return [FILL_MIN, FILL_MAX];   // 휠라 30 ~ 150 — 원본 모델이 30 미만이면 깨진다
  let lo = m?.nstd && m.wmin ? m.wmin : Math.min(...o);
  const hi = m?.nstd && m.wmax ? m.wmax : Math.max(...o);
  // 쿡탑장은 쿡탑 기기(600)가 들어가는 폭 아래로 줄이지 않는다 — 자동 배치(rangeOf)와 같은 기준. 이미 더 좁으면 그 폭
  if (it.tag === 'hob') lo = Math.max(lo, Math.min(it.w, 600));
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}
const inRange = (it: Item, w: number) => { const r = widthRange(it); return !!r && w >= r[0] && w <= r[1]; };
/** 폭을 바꾸고 원본 규격에 없으면 비규격(STD_YN · NSTD_W) */
function setWidth(it: Item, w: number) {
  it.w = w;
  applyNonStandard([it], (k) => cat.modules.find((m) => m.key === k && (m.series === grade().series || m.series === '*')));
}
/** 30 미만 휠라 정리 — 최소가 10 이던 때 저장한 설계 파일 · 자동 저장을 열 때. 가까운 장을 줄여 30 으로, 안 되면 빼고 옆 장이 받는다 */
function fixThinFills() {
  if (!current) return;
  const w0 = new Map(current.items.map((x) => [x, x.w] as const));
  const n = widenThinFills(current.items, (x) => (x.key === 'hood' ? null : widthRange(x)), (x) => (x.level === 'wall' ? upperRowPick(x) : x.tag !== 'ep' && !x.key.startsWith('corner')));
  if (!n) return;
  for (const x of current.items) if (w0.get(x) !== x.w) setWidth(x, x.w);
  fixPoints(current);
}
function pick(it: Item | null) {
  // 미리보기 중에 고르기(다른 장 · 빈 곳 · Esc · 닫기)는 미리보기 취소 — 미리보기 배치안의 장이면 원래 배치안의 같은 장으로
  if (preview) { const o = it && (preview.back.get(it) ?? (preview.base.items.includes(it) ? it : null)); endPreview(false); it = o; }
  if (it !== picked) devact(`pick ${it ? `${it.key}@${it.wall ?? 'isl'}` : '-'}`);
  // 설비 고른 것도 푼다(빈 곳 · 장을 누름) — 3D 흰 테두리 지우기
  if (plan.selectedMep) { plan.selectedMep = null; delete $('#item-info').dataset.mep; mepView3d(); }
  picked = it; plan.picked = it;
  if (it) plan.pickedWall = null;
  const obj = it && lastKitchen?.items.find((x) => x.item === it)?.obj;
  stage.highlight(obj ?? null);
  plan.render(d, current);
  unpickIsland(); unpickHob(); if (arrowWall != null) showWallArrow(null);
  if (diningSel) { diningSel = false; stage.setIslandRing(null); }
  const box = $('#item-info');
  delete box.dataset.op;
  box.classList.remove('previewing');
  if (it && selectedOp) { selectedOp = null; plan.selected = null; stage.setDims(null); }
  if (!it) { box.hidden = true; return; }
  const sc = swapCards(it);
  const m = it.key === 'fridge' || it.key === 'fixFill' ? undefined : modOf(it);
  // 냉장고장 — 고른 종류로 제목 · 설명(삼성 비스포크 스타일 직접 모델링)
  const fsp = it.key === 'fridge' ? fridgeSpec(d) : null;
  const label = fsp ? `냉장고장 · ${fsp.label}` : (it.robot ? '로봇청소기장 · ' : '') + (NAMES[it.key] ?? m?.label ?? it.key);
  const D = it.key === 'fridge' ? fridgeSpec(d).d : it.tag === 'fix' ? 20 : m?.D || (it.level === 'wall' ? 340 : 600);
  const H = it.ov?.NSTD_H ? Number(it.ov.NSTD_H) : it.key === 'fridge' ? fridgeSpec(d).h : m?.H || 0;
  const opts = widthOptions(it), rng = widthRange(it);
  const door = m?.doorVar ? grade().doors.find((x) => x.obs === d.door)?.name : '';
  box.innerHTML = `
    <div class="ii-head"><b>${label}</b><button title="닫기">×</button></div>
    <div class="ii-model">${fsp ? `삼성 비스포크 스타일 · 기기 폭 ${fsp.unitW}${fsp.n > 1 ? ` × ${fsp.n}대` : ''} · 깊이 ${fsp.d} · 높이 ${fsp.h}` : m ? `원본 ${m.name}` : '상품 모델'}${door ? ` · 도어 ${door}` : ''}${it.wall != null ? ` · ${wallName(d.openWall, it.wall)}` : it.tag === 'island' || it.tag === 'fix' ? ' · 아일랜드' : ''}</div>
    <div class="ii-size"><div><small>폭 W</small><b>${it.w}</b></div><div><small>깊이 D</small><b>${Math.round(D)}</b></div><div><small>높이 H</small><b>${Math.round(H)}</b></div></div>
    ${rng ? `<div class="ii-w">폭 <span class="ii-wpick"><input type="number" step="10" value="${it.w}" min="${rng[0]}" max="${rng[1]}" title="눌러서 원본 규격 폭 고르기 · 직접 입력도 됨">
      <span class="ii-wlist" hidden>${opts.map((w) => `<button data-w="${w}" class="${w === it.w ? 'on' : ''}">${w}</button>`).join('')}</span></span><small>${rng[0]}~${rng[1]}${modOf(it)?.nstd ? ' · 규격 밖은 비규격' : ''}</small></div>
    <div class="ii-note">${it.ov?.STD_YN ? '지금 비규격 폭 · ' : ''}바뀐 폭만큼 옆 장 · 휠라가 줄거나 늘어납니다 (자동 배치를 다시 하면 지워짐)</div>` : `<div class="ii-note">${it.tag === 'ep' ? 'EP 는 20 고정' : '이 장은 폭을 바꾸지 않습니다'}</div>`}
    ${slotMovable(it) ? `<div class="ii-row"><label>위치 (줄 시작 쪽 벽에서)<input data-pos type="number" step="10" value="${Math.round(it.t)}"></label><label>&nbsp;<span class="ii-hint">옆 휠라가 먼저, 넘치면 옆 장이 100 단위로</span></label></div>` : ''}
    ${cornerRow(it)}
    ${swapRow(it, sc)}
    ${editRow(it)}
    ${it.wall == null && (it.tag === 'island' || it.tag === 'hob' || it.tag === 'fix' || it.tag === 'ep') ? '<div class="ii-acts"><button data-isl-all class="plain">아일랜드 전체 (길이 · 형태 · 회전)</button></div>' : ''}
    ${fridgeRow(it)}`;
  box.hidden = false;
  box.querySelector('[data-isl-all]')?.addEventListener('click', () => { pick(null); pickIsland(); });
  // 코너장 좌 ↔ 우 — 그 코너를 맡는 벽을 뒤집고 자동 배치를 다시(같은 안 유지)
  box.querySelector<HTMLElement>('[data-corner-flip]')?.addEventListener('click', (e) => {
    const k = (e.currentTarget as HTMLElement).dataset.cornerFlip!, cf = { ...(d.cornerFlip ?? {}) };
    if (cf[k]) delete cf[k]; else cf[k] = true;
    d.cornerFlip = Object.keys(cf).length ? cf : undefined;
    pick(null); changed({ keep: true });
    say('코너장을 옆 벽 쪽으로 바꿨습니다 — 자동 배치를 다시 했습니다'); setTimeout(() => say(null), 2600);
  });
  // 장 교체 카드 · 장 추가 카드(「◀ 왼쪽에 장 추가」 · 「오른쪽에 장 추가 ▶」를 누르면 그쪽에 넣을 장, 다시 누르면 닫힘)
  bindCards(box.querySelector('[data-zone="swap"] .pcards'), sc, it);
  box.querySelectorAll<HTMLElement>('[data-add-open]').forEach((b) => b.addEventListener('click', () => {
    const side = b.dataset.addOpen as 'L' | 'R';
    showAddCards(box, it, addOpen?.it === it && addOpen.side === side ? null : side);
  }));
  if (addOpen?.it === it) showAddCards(box, it, addOpen.side); else addOpen = null;
  // 휠라 추가 — 50 으로 바로
  box.querySelectorAll<HTMLElement>('[data-add-fill]').forEach((b) => b.addEventListener('click', () => {
    const r = addBeside(it, b.dataset.addFill as 'L' | 'R', true);
    if (typeof r === 'string') { const n = box.querySelector('.ii-edit-note'); if (n) { n.textContent = r; n.classList.add('err'); } return; }
    void rebuildKitchen(); pick(r);
  }));
  // 빼기 — 빈 자리를 옆 장으로 이을지 · 비워 둘지 먼저 묻는다
  box.querySelector('[data-remove]')?.addEventListener('click', () => {
    const n = box.querySelector('.ii-edit-note') as HTMLElement | null;
    if (!n) return;
    n.classList.remove('err');
    n.innerHTML = `<b>${it.w}mm 빈 자리를 어떻게 할까요?</b>
      <div class="ii-swap"><button data-rm="join">옆 장으로 이어 메우기</button><button data-rm="leave">빈 자리로 두기 (옆 장 끝 EP)</button><button data-rm="cancel" class="plain">취소</button></div>`;
    n.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => b.addEventListener('click', () => {
      const mode = b.dataset.rm as 'join' | 'leave' | 'cancel';
      if (mode === 'cancel') { pick(it); return; }
      const msg = removeItem(it, mode);
      void rebuildKitchen(); pick(null);
      say(msg); setTimeout(() => say(null), 2600);
    }));
  });
  box.querySelector('[data-robot]')?.addEventListener('click', () => { it.robot = !it.robot; robotWant = robotsOf(current); void rebuildKitchen(); pick(it); });
  box.querySelector('[data-robot-run]')?.addEventListener('click', () => { if (robotRun) robotRun.stop = true; else runRobot(it); setTimeout(() => pick(it), 50); });
  box.querySelector('button')!.addEventListener('click', () => pick(null));
  box.querySelector<HTMLInputElement>('[data-pos]')?.addEventListener('change', (e) => {
    const v = Math.round(Number((e.target as HTMLInputElement).value) / 10) * 10, delta = v - Math.round(it.t);
    const err = delta ? nudgeItem(it, delta) : null;
    if (err) { say(err); setTimeout(() => say(null), 2200); (e.target as HTMLInputElement).value = String(Math.round(it.t)); }
  });
  // 냉장고장 · 키큰장 자리 — 벽 · 왼쪽/오른쪽 끝
  box.querySelectorAll<HTMLElement>('[data-fe]').forEach((b) => b.addEventListener('click', () => {
    const fr = current?.items.find((x) => x.tag === 'fridge');
    const wall = Number(box.querySelector<HTMLSelectElement>('[data-fw]')?.value ?? fr?.wall ?? 0) as WallId;
    if (b.dataset.fe === 'auto') delete d.fridgeAt; else d.fridgeAt = { wall, end: b.dataset.fe as 'start' | 'end' };
    saveDesign(d); pick(null); replan(true);
    const nf = current?.items.find((x) => x.tag === 'fridge');
    if (d.fridgeAt && nf && (nf.wall !== d.fridgeAt.wall)) say('그 자리에 냉장고장이 들어가지 않아 다른 자리에 놓았습니다');
    else if (nf) say(`냉장고장을 ${wallName(d.openWall, nf.wall!)} ${fridgeEndOf(nf) === 'start' ? '왼쪽' : '오른쪽'} 끝에`);
    setTimeout(() => say(null), 2200);
    if (nf) pick(nf);
  }));
  // 냉장고장 빼기 — 다시 넣기는 공간 구조의 「냉장고장」 스위치
  box.querySelector('[data-fridge-off]')?.addEventListener('click', () => {
    d.noFridge = true; $<HTMLInputElement>('#fridge-on').checked = false;
    pick(null); changed({ plan: true });
    say('냉장고장을 뺐습니다 — 공간 구조의 「냉장고장」 스위치로 다시 넣을 수 있습니다'); setTimeout(() => say(null), 3000);
  });
  // 냉장고 패널 색 — 장은 그대로, 다시 그리기만
  box.querySelectorAll<HTMLElement>('[data-fc]').forEach((b) => b.addEventListener('click', () => {
    d.fridgeColor = b.dataset.fc; saveDesign(d); void rebuildKitchen().then(() => { const nf = current?.items.find((x) => x.tag === 'fridge'); if (nf) pick(nf); });
  }));
  // 냉장고 종류 — 바꾸면 묶음 폭이 달라져 다시 배치
  box.querySelectorAll<HTMLElement>('[data-fk]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.fk as 'twin' | 'sbs' | 'quad' | 'builtin';
    if ((d.fridgeKind ?? 'quad') === k) return;
    d.fridgeKind = k; saveDesign(d); pick(null); replan(true);
    const nf = current?.items.find((x) => x.tag === 'fridge'); if (nf) pick(nf);
  }));
  box.querySelector<HTMLSelectElement>('[data-fw]')?.addEventListener('change', (e) => {
    const fr = current?.items.find((x) => x.tag === 'fridge');
    const wall = Number((e.target as HTMLSelectElement).value) as WallId, end0 = fr ? fridgeEndOf(fr) : 'start';
    const before = d.fridgeAt;
    // 고른 끝에 안 들어가면 반대 끝도 — 둘 다 안 되면 되돌리고 알린다(예전엔 조용히 그대로라 이동이 안 되는 것처럼 보였다)
    let nf: Item | undefined;
    // ㄱ자에서 반대쪽 옆 벽을 고르면 ㄱ자 ↔ ㄱ자 반대로 (그 벽이 있는 모양으로)
    const layout0 = d.layout, vw = viewWalls(d.openWall);
    if (d.layout === 'L' && wall === vw.right) d.layout = 'Lr';
    else if (d.layout === 'Lr' && wall === vw.left) d.layout = 'L';
    for (const end of [end0, end0 === 'start' ? 'end' : 'start'] as const) {
      d.fridgeAt = { wall, end }; pick(null); replan(true);
      nf = current?.items.find((x) => x.tag === 'fridge');
      if (nf?.wall === wall) break;
    }
    if (nf?.wall !== wall) {
      d.fridgeAt = before; d.layout = layout0; replan(true); nf = current?.items.find((x) => x.tag === 'fridge');
      say(`${wallName(d.openWall, wall)}에는 냉장고장 묶음이 들어갈 자리가 없습니다 — 창 · 문 · 코너와 겹치거나 벽이 짧습니다`);
      setTimeout(() => say(null), 3000);
    }
    saveDesign(d);
    if (d.layout !== layout0) renderLayouts();
    if (nf) pick(nf);
  });
  const apply = (w: number) => {
    // 직접 입력은 원본 최소 ~ 최대 범위 안으로
    if (rng) w = Math.max(rng[0], Math.min(rng[1], Math.round(w / 10) * 10));
    const err = resizeItem(it, w);
    if (err) { const n = box.querySelector('.ii-note')!; n.textContent = err; n.classList.add('err'); return; }
    void rebuildKitchen(); pick(it);
  };
  // 폭 입력 — 누르면 원본 규격 폭 목록이 뜨고(고르면 적용), 직접 치면 친 값 그대로(범위 안으로)
  const winp = box.querySelector<HTMLInputElement>('.ii-w input'), wl = box.querySelector<HTMLElement>('.ii-wlist');
  if (winp && wl) {
    winp.addEventListener('focus', () => { wl.hidden = !opts.length; });
    winp.addEventListener('input', () => { wl.hidden = true; });
    winp.addEventListener('blur', () => setTimeout(() => { wl.hidden = true; }, 150));
    winp.addEventListener('change', () => apply(Number(winp.value)));
    winp.addEventListener('keydown', (e) => { if (e.key === 'Enter') winp.blur(); });
    wl.querySelectorAll<HTMLElement>('[data-w]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); wl.hidden = true; apply(Number(b.dataset.w)); }));
  }
}
/** 장 교체 후보 — 같은 층(하부 · 상부 · 키큰)의 일반 장과 휠라(장 ↔ 휠라, 휠라 50 ↔ 75 — 사용자 지시 2026-11-06).
 *  싱크 · 쿡탑 · 후드 · 코너 · EP · 냉장고는 자리 기능이라 교체하지 않는다 */
const SWAP: Record<string, string[]> = {
  base: ['cook1', 'cook2', 'drawer2', 'drawer3', 'oven', 'dish', 'basket200', 'basket300', 'bfill50', 'bfill75'],
  hob: ['cook1', 'cook2', 'drawer2', 'drawer3', 'cooktop'],
  wall: ['wall1', 'wall2', 'wallGlass', 'dishDry', 'wallFold', 'wfill50'],
  tall: ['tall', 'tall2', 'cafeTall', 'foldTall', 'tallBasket'],
};
/** 코너장 좌 ↔ 우 — 코너장(하부 · 상부)은 코너 자리에 묶여 끌어 옮길 수 없다. 대신 그 코너를 옆 벽 줄이 맡게 바꾼다(d.cornerFlip, 자동 배치 다시).
 *  코너장 L 은 그 벽 시작 쪽 코너(앞 벽과 사이), R 은 끝 쪽 코너(다음 벽과 사이) — 사용자 2026-11-11 「코너장은 이동이안되면 좌코너 우코너 변경 가능하게해」 */
function cornerRow(it: Item): string {
  if (it.wall == null || !/^(corner|wallCorner)[LR]$/.test(it.key)) return '';
  const left = it.key.endsWith('L'), other = left ? prevWall(it.wall) : nextWall(it.wall);
  const key = left ? `${other}-${it.wall}` : `${it.wall}-${other}`;
  return `<div class="pv-zone"><div class="ii-label">코너장 방향 <small>코너장은 끌어 옮길 수 없습니다 — 대신 어느 벽 쪽에 둘지 바꿉니다</small></div>
    <div class="ii-swap"><button data-corner-flip="${key}">${left ? '좌코너 → 우코너' : '우코너 → 좌코너'} · ${wallName(d.openWall, other)} 쪽으로</button></div>
    <div class="ii-note">자동 배치를 다시 합니다 — 직접 고친 장 · 휠라는 지워집니다${d.cornerFlip?.[key] ? ' · 지금 바꾼 상태(다시 누르면 원래대로)' : ''}</div></div>`;
}
/** 교체 · 추가 카드 목록 — 같은 장이면 둘이 같다(사용자 2026-11-11 「장교체나 추가 내용이 같아야지 그리고 휠라 추가 교체는 없네」).
 *  휠라도 늘 카드로 보이고, 그 자리에 못 쓰면(벽에 닿지 않는 쪽 · 쿡탑 아래 못 두는 장 등) 흐리게 이유와 함께 */
const cardKeys = (it: Item): string[] => [...(SWAP[it.level] ?? []), ...(it.tag === 'hob' ? ['cooktop'] : []),
  // 하부장 · 상부장에서도 키큰장으로 바꾸거나 옆에 넣을 수 있다(사용자 2026-11-11 「밑장 벽장 옆에 장 추가나 교체가 키큰장도 가능하게해」)
  ...(it.level === 'base' || it.level === 'wall' ? SWAP.tall : [])].filter((k) => modK(k));
/** 키큰장 키인지 · 그 키로 놓일 층 */
const isTallKey = (k: string) => SWAP.tall.includes(k);
const lvOfKey = (k: string, lv: Item['level']): Item['level'] => (isTallKey(k) ? 'tall' : lv);
const swapKeys = (it: Item): string[] => {
  if (it.tag === 'sink' || it.tag === 'ep' || it.tag === 'fix' || it.tag === 'fridge' || /^corner|^wallCorner|^hood$|fridgeTop|pantry|islandOpen|^fixFill/.test(it.key)) return [];
  return cardKeys(it);
};
/** 교체로 못 쓰는 이유 — 휠라는 벽에 닿는 끝 장만(장 사이 · 코너 · EP 옆엔 휠라를 두지 않는다), 쿡탑 자리는 쿡탑 아래 둘 수 있는 장만 */
const swapWhy = (it: Item, k: string): string | null => {
  if (/fill/.test(k) && !/fill/.test(it.key) && !wallSide(it).some(Boolean)) return '벽에 닿지 않음 — 휠라는 벽에 닿는 줄 끝 장만 바꿀 수 있습니다';
  if (it.tag === 'hob' && !SWAP.hob.includes(k)) return '쿡탑 자리 — 쿡탑 아래엔 이 장을 둘 수 없습니다';
  return null;
};
/** 추가로 못 쓰는 이유 — 휠라는 벽에 닿는 쪽에만, 쿡탑장은 쿡탑 자리 교체로만 */
const addWhy = (it: Item, side: 'L' | 'R', k: string): string | null => {
  if (/fill/.test(k) && !wallSide(it)[side === 'L' ? 0 : 1]) return '벽에 닿지 않음 — 휠라는 벽에 닿는 쪽에만 넣습니다';
  if (k === 'cooktop') return '쿡탑장 — 쿡탑 자리에서 바꾸기로만';
  return null;
};
/** 이 장이 벽에 닿는 끝 장인지 — [왼쪽(줄 시작), 오른쪽(줄 끝)]. 휠라는 벽과 닿는 끝에만 둔다(사용자 2026-11-09 「휠라는 장사이에 배치하는게 아니야」) */
function wallSide(it: Item): [boolean, boolean] {
  if (!current || it.wall == null || (it.level !== 'base' && it.level !== 'wall')) return [false, false];
  const g = rowGroup(current.items, it, it.level === 'wall' ? upperRowPick : baseRowPick);
  const L = wallLength(d.room, it.wall), wS = prevWall(it.wall) !== d.openWall || d.wing.b >= 600, wE = nextWall(it.wall) !== d.openWall || d.wing.a >= 600;
  return [g[0] === it && it.t <= 1 && wS, g[g.length - 1] === it && it.t + it.w >= L - 1 && wE];
}
/** 이 그레이드(계열)의 원본 장 */
const modK = (k: string) => cat.modules.find((m) => m.key === k && (m.series === grade().series || m.series === '*'));
/** 짝 장 — 옆 장 폭 범위를 넘으면 1도어 ↔ 2도어 · 서랍 3단 → 2단으로 바꿔 받는다(벽에 닿지 않는 끝엔 휠라를 두지 않으므로, 사용자 2026-11-09) */
const SIB_KEY: Record<string, string> = { cook1: 'cook2', cook2: 'cook1', wall1: 'wall2', wall2: 'wall1', drawer3: 'drawer2' };
const sibFor = (x: Item, w: number): string | null => {
  const s = SIB_KEY[x.key], m = s ? modK(s) : undefined;
  return s && m && x.tag !== 'dish' && w >= (x.tag === 'hob' ? 600 : 300) && fitsW(m, w) ? s : null;
};
// 휠라는 30 ~ 150 이면 그 폭 그대로(앱 규칙 — 원본 범위 50 아래도 쓴다. 최소 30 은 사용자 2026-11-09, 예전 10)
const fitsW = (m: ModuleDef | undefined, w: number) => !!m && (/fill/.test(m.key) ? w >= FILL_MIN && w <= FILL_MAX : widthsOf(m).includes(w) || (!!m.nstd && !!m.wmin && !!m.wmax && w >= m.wmin && w <= m.wmax));
function swapRow(it: Item, cards: Card[]): string {
  if (!cards.length) return '';
  // 로봇청소기장 — 일반 하부장(폭 450 이상)의 걸레받이 자리를 로봇청소기 대기 공간으로
  const canRobot = robotOk(it);
  return `<div class="pv-zone" data-zone="swap"><div class="ii-label">장 · 휠라 교체 <small>누르면 그 자리에 미리 보기 · 마우스를 올리면 문 열림</small></div>
    ${cardGrid(cards, 'swap')}
    <div class="ii-note ii-swap-note">바꾼 장은 자동 배치를 다시 하면 지워집니다 · 휠라 폭 ${FILL_MIN}~${FILL_MAX}</div></div>
    ${canRobot ? `<div class="ii-swap"><button data-robot class="${it.robot ? 'on' : ''}" title="걸레받이 자리(높이 112)를 비우고 로봇청소기 · 충전대">로봇청소기장${it.robot ? ' ✓' : ''}</button>${it.robot ? `<button data-robot-run>${robotRun ? '■ 청소 멈춤' : '▶ 청소 시작'}</button>` : ''}</div>` : ''}`;
}
/* ───────── 장 추가 · 빼기 — 같은 줄 안에서. 추가하면 옆 장들이 줄고(휠라 먼저), 빼면 늘어난다(휠라 마지막). 자동 배치를 다시 하면 지워짐 ───────── */
/** 추가 · 빼기를 쓰지 않는 것 — EP · FIX 도어 · 선반 (키큰장 · 냉장고장 옆에도 추가할 수 있다, 사용자 지시 2026-11-06 「모든 장이 가능」) */
const fixedSlot = (it: Item) => it.tag === 'ep' || it.tag === 'fix' || /^fixFill/.test(it.key) || it.level === 'shelf';
/** 뺄 수 없는 것 — 자리 기능(코너 · 냉장고 · 냉장고 윗장 · 팬트리 · 후드). 냉장고는 「냉장고장」 켜고 끄기로 */
const fixedRemove = (it: Item) => it.tag === 'fridge' || /^corner|^wallCorner|fridgeTop|pantry|^hood$/.test(it.key);
/** 층마다 추가할 장 — [1도어 키, 2도어 키, 기본 폭] */
const ADD_KEYS: Record<string, [string, string, number]> = { base: ['cook1', 'cook2', 450], wall: ['wall1', 'wall2', 400], tall: ['tall', 'tall2', 600] };
/** 옆에 넣을 수 있는 장 — 교체 카드와 같은 목록(휠라 포함, 못 쓰는 쪽이면 흐리게) */
const addKeys = (it: Item): string[] => cardKeys(it);
/** 추가할 폭 — 층 기본(하부 450 · 상부 400 · 키큰 600)이 그 장 규격이면 그것, 아니면 그 장 기본 폭(원본 W).
 *  cap 을 넘으면 cap 안에서 가장 넓은 규격 폭(비규격이 되는 장은 cap 그대로), 없으면 0 */
function addW(m: ModuleDef, lv: Item['level'], cap: number): number {
  const ws = widthsOf(m), lvW = ADD_KEYS[lv]?.[2];
  const pref = lvW && ws.includes(lvW) ? lvW : Number(m.W?.value) || ws[0] || 0;
  if (pref && pref <= cap) return pref;
  let best = Math.max(0, ...ws.filter((w) => w <= cap));
  if (m.nstd && m.wmin && m.wmax && cap >= m.wmin) best = Math.max(best, Math.min(cap, m.wmax));
  return best;
}
let addOpen: { it: Item; side: 'L' | 'R' } | null = null;
function editRow(it: Item): string {
  if (fixedSlot(it)) return '';
  // 휠라 추가는 벽에 닿는 쪽에만 — 장 사이 · 코너 · EP 옆엔 휠라를 두지 않는다
  const [fL, fR] = /fill/.test(it.key) ? [false, false] : wallSide(it);
  const on = (s: 'L' | 'R') => (addOpen?.it === it && addOpen.side === s ? ' class="on"' : '');
  return `<div class="pv-zone" data-zone="add"><div class="ii-label">장 · 휠라 추가 · 빼기 <small>옆에 빈 공간이 있으면 그 자리에, 없으면 옆 장 폭이 바뀝니다</small></div>
    <div class="ii-swap"><button data-add-open="L"${on('L')}>◀ 왼쪽에 장 추가</button><button data-add-open="R"${on('R')}>오른쪽에 장 추가 ▶</button></div>
    <div class="pc-add"></div></div>
    <div class="ii-swap">${fL ? '<button data-add-fill="L">◀ 왼쪽(벽 쪽)에 휠라 추가</button>' : ''}${fR ? '<button data-add-fill="R">오른쪽(벽 쪽)에 휠라 추가 ▶</button>' : ''}${fixedRemove(it) ? '' : `<button data-remove>이 ${/fill/.test(it.key) ? '휠라' : '장'} 빼기</button>`}</div>
    <div class="ii-note ii-edit-note">${fL || fR ? `휠라는 50 으로 넣습니다 — 고른 뒤 폭(${FILL_MIN}~${FILL_MAX})을 바꿀 수 있습니다` : /fill/.test(it.key) ? `휠라 폭 ${FILL_MIN}~${FILL_MAX}` : '휠라는 벽에 닿는 줄 끝 장에만 넣습니다'}</div>`;
}

/* ───────── 교체 · 추가 카드 — 썸네일(닫힘, 마우스를 올리면 문 열림) · 들어가는지 먼저 시험 · 누르면 그 자리 미리보기 ─────────
 * 사용자 2026-11-09 「교체 · 배치 가능한 상품이 글로만 표시돼 형태 구분이 안 된다 · 도어 내부도 확인」.
 * 3D 조립 그대로 찍은 썸네일로 목록을 훑고, 고른 것은 부엌 안 그 자리에서(문 열고 카메라를 그 장 앞으로) 본 뒤 적용 · 취소 */
interface Card { key: string; label: string; name: string; ok: boolean; why?: string; item: ThumbItem; on?: boolean }
/** 배치안 복사본에서 해 본다 — 지금 배치안은 그대로(미리보기 중이면 원래 배치안 기준). fn 은 복사본의 같은 장을 받는다 */
function onCopy<T>(it: Item, fn: (ci: Item) => T): { c: Candidate; r: T; back: Map<Item, Item> } {
  const base = preview?.base ?? current!, keep = current, c = structuredClone(base);
  const back = new Map(c.items.map((x, i) => [x, base.items[i]] as const));
  current = c;
  try { return { c, r: fn(c.items[base.items.indexOf(it)]), back }; } finally { current = keep; }
}
/** 안 들어가는 카드도 모양은 보이게 — 그 장 기본 폭으로 찍는다 */
const thumbOf = (k: string, lv: Item['level']): ThumbItem => ({ key: k, level: lv, w: addW(modK(k)!, lv, Infinity), ...(k === 'dish' ? { tag: 'dish' as const } : {}) });
function swapCards(it: Item): Card[] {
  return swapKeys(it).map((k) => {
    const m = modK(k)!, c = { key: k, label: m.label, name: m.name };
    if (k === it.key) return { ...c, ok: true, on: true, item: it };
    const why = swapWhy(it, k);
    if (why) return { ...c, ok: false, why, item: thumbOf(k, lvOfKey(k, it.level)) };
    const t = onCopy(it, (ci) => swapItem(ci, k) ?? ci);
    return typeof t.r === 'string' ? { ...c, ok: false, why: t.r, item: thumbOf(k, lvOfKey(k, it.level)) } : { ...c, ok: true, item: t.r };
  });
}
function addCards(it: Item, side: 'L' | 'R'): Card[] {
  return addKeys(it).map((k) => {
    const m = modK(k)!, c = { key: k, label: m.label, name: m.name };
    const why = addWhy(it, side, k);
    if (why) return { ...c, ok: false, why, item: thumbOf(k, lvOfKey(k, it.level)) };
    const t = onCopy(it, (ci) => addBeside(ci, side, /fill/.test(k), k));
    return typeof t.r === 'string' ? { ...c, ok: false, why: t.r, item: thumbOf(k, lvOfKey(k, it.level)) } : { ...c, ok: true, item: t.r };
  });
}
function cardGrid(cards: Card[], kind: string): string {
  return `<div class="pcards">${cards.map((c) => `<button class="pcard${c.on ? ' on' : ''}${c.ok ? '' : ' off'}" data-card="${kind}:${c.key}" title="${c.name}${c.why ? `&#10;${c.why}` : ''}">
    <span class="pc-img"><img alt="" draggable="false"><img alt="" class="pc-open" draggable="false"></span>
    <b>${c.label}</b><small>${c.on ? `지금 · 폭 ${c.item.w}` : c.ok ? `폭 ${c.item.w}` : c.why!.split(' — ')[0]}</small></button>`).join('')}</div>`;
}
/** 카드 누르기 · 썸네일 채우기. 썸네일은 한 번에 하나씩 찍고(같은 장 · 폭 · 도어면 다시 찍지 않는다) 다 찍힌 것부터 보인다 */
function bindCards(grid: Element | null, cards: Card[], it: Item, side?: 'L' | 'R') {
  if (!grid) return;
  const btns = grid.querySelectorAll<HTMLElement>('.pcard');
  btns.forEach((b, i) => b.addEventListener('click', () => {
    const c = cards[i];
    if (c.on) { if (preview) { endPreview(false); pick(it); } return; }
    if (!c.ok) { const n = b.closest('.pv-zone')?.querySelector('.ii-note') ?? $('#item-info').querySelector('.ii-edit-note'); if (n) { n.textContent = c.why!; n.classList.add('err'); } return; }
    void startPreview(it, c.key, side);
  }));
  const base = preview?.base ?? current;
  if (!base) return;
  cards.forEach((c, i) => {
    const im = btns[i]?.querySelectorAll('img'), box = btns[i]?.querySelector('.pc-img');
    // 썸네일엔 하부 기능 표시(쿡탑 · 싱크)를 빼고 식세기 속만 — 쿡탑 표시가 있으면 섬 후드까지 붙어 장이 작게 찍혔다
    const ti: ThumbItem = { key: c.item.key, level: c.item.level, w: c.item.w, ...(c.item.ov ? { ov: c.item.ov } : {}), ...(c.item.tag === 'dish' ? { tag: 'dish' as const } : {}) };
    thumbPair(ti, base, d, cat, grade(), d.door).then(([cl, op]) => { im[0].src = cl; im[1].src = op; box?.classList.add('ready'); }, () => box?.classList.add('fail'));
  });
}
/** 장 추가 카드 — 그쪽(side)에 넣을 수 있는 장. null 이면 닫기 */
function showAddCards(box: HTMLElement, it: Item, side: 'L' | 'R' | null) {
  addOpen = side ? { it, side } : null;
  box.querySelectorAll<HTMLElement>('[data-add-open]').forEach((b) => b.classList.toggle('on', b.dataset.addOpen === side));
  const host = box.querySelector<HTMLElement>('.pc-add');
  if (!host) return;
  if (!side) { host.innerHTML = ''; return; }
  const cards = addCards(it, side);
  host.innerHTML = `${cardGrid(cards, `add${side}`)}<div class="ii-note ii-add-note">${side === 'L' ? '왼쪽' : '오른쪽'}에 넣을 장 — 누르면 그 자리에 미리 보기(빈 칸이면 그 폭에 맞춰 메움)</div>`;
  bindCards(host.querySelector('.pcards'), cards, it, side);
  markPreview();
}

/* ───────── 미리보기 — 카드를 누르면 배치안 복사본에 바꿔 끼워 그 자리에 3D 로 ─────────
 * 그 장 문만 열고 카메라를 그 장 앞으로. 「적용」이면 복사본이 지금 배치안(되돌리기 한 단계), 「취소」 · 다른 것 고르기 · Esc 면 원래 배치안 */
let previewSeq = 0, flySeq = 0;
async function startPreview(orig: Item, key: string, side?: 'L' | 'R') {
  devact(`preview ${key}${side ?? ''}`);
  const base = preview?.base ?? current;
  if (!base) return;
  if (!preview && commitTimer) { clearTimeout(commitTimer); commit(); }     // 미리보기 전 변경부터 쌓아 둔다
  const t = onCopy(orig, (ci) => (side ? addBeside(ci, side, /fill/.test(key), key) : swapItem(ci, key) ?? ci));
  if (typeof t.r === 'string') { say(t.r); setTimeout(() => say(null), 2400); return; }
  const cam: [THREE.Vector3, THREE.Vector3] = preview?.cam ?? [stage.camera.position.clone(), stage.controls.target.clone()];
  preview = { base, c: t.c, orig, item: t.r, back: t.back, key, side, cam };
  current = t.c;
  stage.highlight(null);
  plan.picked = t.r; plan.render(d, current);
  markPreview();
  const my = ++previewSeq;
  await rebuildKitchen();
  if (my !== previewSeq || !preview || !lastKitchen) return;
  const obj = lastKitchen.items.find((x) => x.item === preview!.item)?.obj;
  if (!obj) return;
  // 선택 상자(파란 덮개)는 씌우지 않는다 — 열린 문 안쪽이 가렸다. 카메라를 그 장 앞으로 옮겨 어느 장인지 보인다
  stage.highlight(null);
  const ds = doorsOf(obj);
  focusOn(obj, preview.item, ds);
  openDoorsOf(ds, my);
}
/** 미리보기 끝 — apply 면 복사본이 지금 배치안, 아니면 원래 배치안. rebuild=false 는 곧 다시 그릴 때(자동 배치 · 되돌리기 · 안 바꾸기) */
function endPreview(apply: boolean, rebuild = true) {
  const p = preview;
  if (!p) return null;
  devact(`preview-end ${apply ? 'apply' : 'cancel'}`);
  preview = null; previewSeq++;
  markPreview();
  flyCam(p.cam[0], p.cam[1]);
  if (apply) {
    const i = cands.indexOf(p.base);
    if (i >= 0) cands[i] = p.c;
    current = p.c;
    // 그 장 문은 지금 문 상태로 — 폴딩 문은 원본 변수라 다시 계산
    if (FOLD_KEYS.has(p.item.key)) void rebuildKitchen();
    else { if (lastKitchen) setDoors(lastKitchen.doors, doorsT); stage.invalidate(true); scheduleCommit(); }
  } else {
    current = p.base;
    plan.render(d, current);
    if (rebuild) void rebuildKitchen();
  }
  return p;
}
/** 정보 창 — 미리 보는 카드 표시 · 적용 / 취소 줄. 미리보기 동안 다른 칸은 흐리게(누르지 못함) */
function markPreview() {
  const box = $('#item-info'), p = preview;
  box.classList.toggle('previewing', !!p);
  box.querySelectorAll('.pcard.pv').forEach((x) => x.classList.remove('pv'));
  box.querySelector('.pv-bar')?.remove();
  if (!p) return;
  const card = box.querySelector<HTMLElement>(`[data-card="${p.side ? `add${p.side}` : 'swap'}:${p.key}"]`);
  card?.classList.add('pv');
  const bar = document.createElement('div');
  bar.className = 'pv-bar';
  bar.innerHTML = `<span>미리보기 · <b>${modK(p.key)?.label ?? p.key}</b> 폭 ${p.item.w}</span><button data-pv="ok">적용</button><button data-pv="no" class="plain">취소</button>`;
  (card?.closest('.pcards') ?? box.querySelector('.pcards'))?.after(bar);
  bar.scrollIntoView({ block: 'nearest' });     // 정보 창 아래쪽(장 추가 카드)에서 눌러도 적용 · 취소가 보이게
  bar.querySelector('[data-pv="ok"]')!.addEventListener('click', () => { const q = endPreview(true); if (q) pick(q.item); });
  bar.querySelector('[data-pv="no"]')!.addEventListener('click', () => { const q = endPreview(false); if (q) pick(q.orig); });
}
/** 그 장의 문 · 서랍 */
function doorsOf(obj: THREE.Object3D): DoorPart[] {
  const inObj = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (o === obj) return true; return false; };
  return lastKitchen?.doors.filter((x) => inObj(x.pivot)) ?? [];
}
/** 그 장 문만 연다(0.6초) — 다른 장은 지금 문 상태 그대로 */
function openDoorsOf(ds: DoorPart[], seq: number) {
  if (!ds.length || doorsT >= 1) return;
  const t0 = performance.now();
  const step = (now: number) => {
    if (seq !== previewSeq) return;
    const k = Math.min(1, (now - t0) / 600);
    setDoors(ds, k * k * (3 - 2 * k)); stage.invalidate(true);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** 3D 화면에서 가리지 않은 곳(정보 창 · 도구 단추 · 프롬프트 줄 밖) — 화면 좌표(NDC)의 가운데 · 반폭 */
function viewWindow() {
  const cv = $('#three').getBoundingClientRect(), info = $('#item-info'), tools = document.querySelector('.tools'), bar = $('#prompt-bar');
  // 3D 화면에 실제로 겹친 것만 — 2D 보기에선 3D 가 왼쪽 아래 작은 창이라 정보 창 · 도구 단추와 안 겹친다
  const over = (e: Element | null) => { if (!e || (e as HTMLElement).hidden) return null; const r = e.getBoundingClientRect(); return r.right > cv.left && r.left < cv.right && r.bottom > cv.top && r.top < cv.bottom ? r : null; };
  let x0 = cv.left, x1 = cv.right, y1 = cv.bottom;
  const y0 = cv.top, ri = over(info), rt = over(tools), rb = over(bar);
  if (ri) x0 = Math.max(x0, ri.right + 8);
  if (rt) x1 = Math.min(x1, rt.left - 8);
  if (rb) y1 = Math.min(y1, rb.top - 8);
  if (x1 - x0 < cv.width * 0.3 || y1 - y0 < cv.height * 0.3) return { cx: 0, cy: 0, hx: 1, hy: 1 };
  const nx = (x: number) => ((x - cv.left) / cv.width) * 2 - 1, ny = (y: number) => 1 - ((y - cv.top) / cv.height) * 2;
  return { cx: (nx(x0) + nx(x1)) / 2, cy: (ny(y0) + ny(y1)) / 2, hx: (nx(x1) - nx(x0)) / 2, hy: (ny(y0) - ny(y1)) / 2 };
}
/** 카메라를 범위 bb 의 정면으로 — n = 보는 사람 쪽(바닥에 평행), 가리지 않은 화면 88% 안에 들어오는 거리, els(도) 높이에서 내려다보며.
 *  avoid 면 앞을 다른 장 · 아일랜드 · 식탁이 막을 때 더 높이서(skip = 그 물체 자신은 빼고 잰다). 늘 천장 아래로. 미리보기 · Z 키가 쓴다 */
function frontView(bb: THREE.Box3, n: THREE.Vector3, els: number[], skip: THREE.Object3D | null, avoid = true) {
  if (!lastKitchen) return;
  // 광선 · 범위는 월드 행렬로 잰다 — 새로 지은 부엌은 문 충돌 검사(전부 연 상태)의 행렬이 남아 있어, 닫힌 옆 장 문에 열린 자리로 맞았다
  lastKitchen.group.updateMatrixWorld(true);
  const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3()), ceil = d.room.h / 1000 - 0.15;
  // 광선은 앞면에서 조금 나와서 쏜다 — 장 한가운데서 쏘면 바로 위 상판에 막혔다
  const front = (size.x * Math.abs(n.x) + size.z * Math.abs(n.z)) / 2 + 0.05;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z));
  const win = viewWindow(), tc = stage.camera.clone();
  const tv = Math.tan(THREE.MathUtils.degToRad(tc.fov) / 2), th = tv * tc.aspect;
  /** 카메라가 pos 일 때 바라볼 점 — 가운데(c)가 가리지 않은 화면 가운데에 오게 옆 · 위로 비킨 점 */
  const lookAt = (pos: THREE.Vector3) => {
    const fwd = c.clone().sub(pos), D = fwd.length();
    const right = fwd.clone().cross(new THREE.Vector3(0, 1, 0)).normalize(), up = right.clone().cross(fwd).normalize();
    return c.clone().addScaledVector(right, -win.cx * D * th).addScaledVector(up, -win.cy * D * tv);
  };
  /** at 에서 dir 로 얼마나 물러나야 꼭짓점이 가리지 않은 화면의 88% 안에 드는지 */
  const fitS = (at: THREE.Vector3, dir: THREE.Vector3) => {
    let s = 1.5;
    for (let k = 0; k < 6; k++) {
      tc.position.copy(at).addScaledVector(dir, s); tc.lookAt(lookAt(tc.position)); tc.updateMatrixWorld();
      const m = Math.max(...corners.map((p) => { const v = p.clone().project(tc); return Math.max(Math.abs(v.x - win.cx) / (win.hx * 0.88), Math.abs(v.y - win.cy) / (win.hy * 0.88)); }));
      s = Math.max(0.3, (s + front) * m - front);
    }
    return s;
  };
  const shown = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  const inSkip = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (o === skip) return true; return false; };
  const ray = new THREE.Raycaster();
  let best: { pos: THREE.Vector3; ok: number } | null = null;
  for (const el of els) {
    const e = THREE.MathUtils.degToRad(el), dir = n.clone().multiplyScalar(Math.cos(e)).setY(Math.sin(e));
    const at = c.clone().addScaledVector(n, front), s = fitS(at, dir);
    ray.set(at, dir); ray.far = s + 0.2;
    const hit = avoid ? ray.intersectObject(lastKitchen.group, true).find((h) => (h.object as THREE.Mesh).isMesh && !inSkip(h.object) && shown(h.object)) : undefined;
    const can = Math.min(s, hit ? hit.distance - 0.2 : Infinity, (ceil - at.y) / Math.max(0.05, dir.y));
    const ok = can / s;   // 1 이면 다 들어옴
    if (!best || ok > best.ok) best = { pos: at.clone().addScaledVector(dir, Math.max(0.3, can)), ok };
    if (ok >= 0.95) break;
  }
  if (best) flyCam(best.pos, lookAt(best.pos));
}
/** 미리보기 — 문을 다 연 범위로, 하부장은 조금 내려다보며(서랍 속), 상부장 · 키큰장은 거의 수평 */
function focusOn(obj: THREE.Object3D, it: Item, ds: DoorPart[]) {
  if (!lastKitchen) return;
  setDoors(ds, 1);
  lastKitchen.group.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(obj);
  setDoors(ds, doorsT);
  frontView(bb, new THREE.Vector3(it.frame.n[0], 0, it.frame.n[1]).normalize(), it.level === 'base' ? [28, 42, 56, 70] : [6, 18, 30], obj);
}
/** 카메라 옮기기(0.5초, 부드럽게) */
function flyCam(pos: THREE.Vector3, target: THREE.Vector3, ms = 500) {
  const my = ++flySeq, p0 = stage.camera.position.clone(), t0 = stage.controls.target.clone(), s0 = performance.now();
  const step = (now: number) => {
    if (my !== flySeq) return;
    const k = Math.min(1, (now - s0) / ms), e = k * k * (3 - 2 * k);
    stage.camera.position.lerpVectors(p0, pos, e); stage.controls.target.lerpVectors(t0, target, e);
    stage.controls.update(); stage.invalidate();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/* ───────── Z — 고른 것을 정면에서 화면에 맞춰 보기(사용자 2026-11-09 「Z 키 누르면 화면에 맞춰서 정면으로 — 지금은 줌인일 뿐」) ─────────
 * 3D 는 카메라를 그것의 정면(장 · 쿡탑 = 문 쪽, 아일랜드 = 아일랜드 정면, 식탁 = 앞, 창 · 문 · 벽 = 방 안쪽에서)으로 옮겨 화면에 맞추고,
 * 2D 보기는 평면도를 그 자리로 키운다. 고른 것 = 선택 표시 상자(미리보기 중이면 미리 보는 장) */
function selectionView(): { box: THREE.Box3; n: THREE.Vector3; avoid: boolean; skip: THREE.Object3D | null } | null {
  const N = (v: number[]) => new THREE.Vector3(v[0], 0, v[1]).normalize();
  const objOf = (it: Item) => lastKitchen?.items.find((x) => x.item === it)?.obj ?? null;
  if (preview) { const o = objOf(preview.item); if (o) return { box: new THREE.Box3().setFromObject(o), n: N(preview.item.frame.n), avoid: true, skip: o }; }
  const box = stage.selBounds?.clone();
  if (!box || box.isEmpty()) return null;
  if (picked) return { box, n: N(picked.frame.n), avoid: true, skip: objOf(picked) };
  const hob = hobSel ? current?.items.find((x) => x.tag === 'hob') : undefined;
  if (hob) return { box, n: N(hob.frame.n), avoid: true, skip: objOf(hob) };
  if (islandSel && current?.island) return { box, n: N(current.island.frame.n), avoid: true, skip: null };
  const dh = diningSel ? diningHolder() : null;
  if (dh) return { box, n: new THREE.Vector3(Math.sin(dh.rotation.y), 0, Math.cos(dh.rotation.y)), avoid: true, skip: dh };
  // 창 · 문 · 벽은 방 안쪽에서 — 그 앞의 장은 가림으로 보지 않는다(벽 앞엔 늘 장이 있다)
  const op = selectedOp ? d.openings.find((x) => x.id === selectedOp) : undefined;
  if (op) return { box, n: N(wallLine(d, op.wall)?.n ?? [0, 1]), avoid: false, skip: null };
  if (plan.pickedWall != null && plan.pickedWall <= 3) return { box, n: N(wallFrame(d.room, plan.pickedWall as WallId).n), avoid: false, skip: null };
  // 그 밖(거실 벽 등) — 지금 보는 방향 그대로
  const v = stage.camera.position.clone().sub(stage.controls.target).setY(0);
  return { box, n: v.lengthSq() > 1e-6 ? v.normalize() : new THREE.Vector3(0, 0, 1), avoid: false, skip: null };
}
function zoomToSelection() {
  devact('Z');
  const v = selectionView();
  if (!v) { say('고른 것이 없습니다 — 장 · 벽 · 창 등을 고른 뒤 Z'); setTimeout(() => say(null), 1800); return; }
  const b = v.box;
  if ($('#viewport').classList.contains('v2d')) { plan.focusBox(b.min.x * 1000, b.min.z * 1000, b.max.x * 1000, b.max.z * 1000); return; }
  // 정면 높이 — 하부 높이는 살짝 내려다보며(앞이 막히면 더 높이), 상부장 · 키큰장 위쪽은 거의 수평, 벽 · 창은 수평에 가깝게
  const cy = b.getCenter(new THREE.Vector3()).y;
  frontView(b, v.n, cy > 1.2 ? [5, 15, 25] : v.avoid ? [15, 30, 45, 60] : [8], v.skip, v.avoid);
}
// 한글 입력 상태에서도 되게 키 자리(code)로 본다. Ctrl+Z(되돌리기)와 글 입력 칸은 건드리지 않는다
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyZ' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  e.preventDefault();
  zoomToSelection();
});
/** 옆 빈 공간 — it 의 side 쪽, 같은 벽에서 그 층 높이를 차지하는 것이 없는 구간(문 · 창 · 옆 벽 코너 장 깊이 제외).
 *  바로 옆 EP 와 빈 칸 건너 맞은편 EP(빈 자리로 둔 칸을 막던 것)는 치울 수 있는 것으로 본다. 아일랜드는 길이가 정해져 있어 없음.
 *  장 배치 길이(runLen)로 줄을 짧게 잡았어도 벽에 공간이 있으면 쓴다(사용자 지시 2026-11-06) */
function freeBeside(it: Item, side: 'L' | 'R'): { t0: number; t1: number; eps: Item[]; to: Item | null; closed: boolean } | null {
  if (!current || it.wall == null) return null;
  const w = it.wall, L = wallLength(d.room, w), lv = it.level;
  const zone = rowZone(lv);
  const row = current.items.filter((x) => x !== it && x.wall === w && zone(x)).sort((a, b) => a.t - b.t);
  const stops = rowStops(it);
  const sameEp = (x: Item) => x.tag === 'ep' && (x.level === lv || (lv === 'tall' && x.level !== 'wall'));
  if (side === 'R') {
    const c = it.t + it.w, eps: Item[] = [];
    const ep = row.find((x) => sameEp(x) && Math.abs(x.t - c) < 1);
    if (ep) eps.push(ep);
    const rest = row.filter((x) => !eps.includes(x) && x.t + x.w > c + 0.5);
    const hit = stops.filter((s) => s.b > c + 0.5).map((s) => ({ at: Math.max(s.a, c), closed: s.closed })).sort((p, q) => p.at - q.at)[0];
    const nxt = rest[0];
    let end = Math.min(hit.at, nxt ? nxt.t : Infinity);
    if (end - c < 1) return null;
    // 빈 칸 건너 맞은편 EP — 그 너머 장에 붙어 있으면 치우고 그 장까지 잇는다
    let to: Item | null = nxt && Math.abs(nxt.t - end) < 1 ? nxt : null;
    if (to && sameEp(to)) { const after = rest.find((x) => x !== to && Math.abs(x.t - (to!.t + to!.w)) < 1); if (after) { eps.push(to); end = after.t; to = after; } else to = null; }
    return { t0: c, t1: end, eps, to, closed: !to && Math.abs(end - hit.at) < 1 && hit.closed };
  }
  const c = it.t, eps: Item[] = [];
  const ep = row.find((x) => sameEp(x) && Math.abs(x.t + x.w - c) < 1);
  if (ep) eps.push(ep);
  const rest = row.filter((x) => !eps.includes(x) && x.t < c - 0.5);
  const hit = stops.filter((s) => s.a < c - 0.5).map((s) => ({ at: Math.min(s.b, c), closed: s.closed })).sort((p, q) => q.at - p.at)[0];
  const prv = rest.sort((p, q) => (q.t + q.w) - (p.t + p.w))[0];
  let start = Math.max(hit.at, prv ? prv.t + prv.w : -Infinity);
  if (c - start < 1) return null;
  let to: Item | null = prv && Math.abs(prv.t + prv.w - start) < 1 ? prv : null;
  if (to && sameEp(to)) { const before = rest.find((x) => x !== to && Math.abs(x.t + x.w - to!.t) < 1); if (before) { eps.push(to); start = before.t + before.w; to = before; } else to = null; }
  return { t0: start, t1: c, eps, to, closed: !to && Math.abs(start - hit.at) < 1 && hit.closed };
}
/** 그 층 줄을 막는 장 — 하부 줄은 하부 · 키큰, 상부 줄은 상부 · 키큰, 키큰 줄은 전부 */
const rowZone = (lv: Item['level']) => (x: Item) => (lv === 'tall' ? x.level === 'base' || x.level === 'wall' || x.level === 'tall' : x.level === lv || x.level === 'tall');
/** 줄 끝을 막는 것 — 문 · 창(드러난 끝, EP), 벽 끝(트인 쪽 거실은 날개벽이 있을 때만), 옆 벽 줄이 차지한 코너(그 장 깊이까지 · 닫힌 끝).
 *  코너는 옆 벽 장이 이 줄 깊이 안에 걸치면 막힌다 — 자동 배치는 코너장을 코너에서 100 띄워 놓는데(cornerL t 100 · cornerR 끝 L−100),
 *  예전엔 코너에 딱 붙은 장만 봐서 코너장 앞을 빈 공간으로 알고 장을 코너장 쪽으로 키웠다(사용자 2026-11-09 「코너장 쪽으로 커지면 안 돼」) */
function rowStops(it: Item): { a: number; b: number; closed: boolean; corner?: boolean }[] {
  const w = it.wall!, L = wallLength(d.room, w), lv = it.level, zone = rowZone(lv);
  const blk = wallBlocks(d.openings, w);
  const stops: { a: number; b: number; closed: boolean; corner?: boolean }[] = (lv === 'base' ? blk.base : lv === 'wall' ? blk.upper : [...blk.base, ...blk.upper]).map(([a, b]) => ({ a, b, closed: false }));
  // 줄이 갈 수 있는 끝 — 트인 쪽은 거실 어깨 벽 두께(150)까지(cabSpan, 자동 배치와 같이)
  const [sp0, sp1] = cabSpan(d, w);
  stops.push({ a: -1e9, b: sp0, closed: prevWall(w) !== d.openWall || d.wing.b >= 300 }, { a: sp1, b: 1e9, closed: nextWall(w) !== d.openWall || d.wing.a >= 300 });
  const depthOf = (x: Item) => (x.level === 'wall' ? WALL_D : x.key.startsWith('corner') ? CORNER_D : x.level === 'tall' ? 720 : BASE_D);
  const band = lv === 'wall' ? WALL_D : lv === 'tall' ? 720 : BASE_D;
  for (const [ow, atStart] of [[prevWall(w), true], [nextWall(w), false]] as const) {
    const OL = wallLength(d.room, ow);
    const near = current!.items.filter((x) => x.wall === ow && zone(x) && (atStart ? x.t + x.w > OL - band : x.t < band));
    if (near.length) { const dep = Math.max(...near.map(depthOf)); stops.push(atStart ? { a: -1e9, b: dep, closed: true, corner: true } : { a: L - dep, b: 1e9, closed: true, corner: true }); }
  }
  return stops;
}
/** 줄 끝이 옆 벽 코너 자리 안으로 들어간 폭 — 예전 버그로 코너장 쪽으로 커진 줄. 줄일 때 이 끝부터 당긴다 */
function cornerOverrun(edge: Item, side: 'L' | 'R'): number {
  if (edge.wall == null) return 0;
  const c = side === 'R' ? edge.t + edge.w : edge.t;
  let o = 0;
  // 그 끝이 코너 자리 안에 있을 때만 — 반대쪽 끝 코너(벽 끝까지 이어진 구간)를 세면 줄 전체를 당겼다
  for (const s of rowStops(edge)) if (s.corner) o = Math.max(o, side === 'R' ? (s.a < c && c <= s.b ? c - s.a : 0) : (s.a <= c && c < s.b ? s.b - c : 0));
  return Math.min(o, edge.w);
}
/** EP — 그 층 EP 키(상부 epW · 키큰 epT · 하부 epB). 비규격 값은 같은 키 EP 를 따른다(없으면 상부는 도어 아랫선 ~ 천장 · 깊이 343) */
/* ───────── 하부장 · 상부장 줄에 키큰장 — 키큰장은 바닥부터 천장까지라, 그 폭(양옆 EP 20 씩 포함)만큼 고른 장의 줄은 비켜 주고(옆 장이 줄어듦)
 * 맞은편 층(하부 ↔ 상부)에서 그 자리에 걸친 장은 남는 폭으로 줄이거나 뺀다. 자리 기능(싱크 · 쿡탑 · 식세 · 코너 · 후드 · 냉장고)이 걸리면 놓지 않는다.
 * 사용자 2026-11-11 「밑장 벽장 옆에 장 추가나 교체가 키큰장도 가능하게해」 ───────── */
/** 배치안을 그대로 떠 두었다가 되돌리기 — 같은 객체에 값을 되돌려 넣는다(화면이 쥔 장이 묵은 값으로 남지 않게, moveItemTo 와 같은 이유) */
function candUndo(): () => void {
  const cand = current!;
  const keep = <T extends object>(xs: T[]) => ({ list: xs.slice(), vals: xs.map((x) => ({ ...x, ...('ov' in x && x.ov ? { ov: { ...(x.ov as object) } } : {}) }) as T) });
  const snap = { items: keep(cand.items), counters: keep(cand.counters), splashes: keep(cand.splashes) };
  const undo = <T extends object>(q: { list: T[]; vals: T[] }) => {
    q.list.forEach((x, i) => { for (const k of Object.keys(x)) if (!(k in q.vals[i])) delete (x as Record<string, unknown>)[k]; Object.assign(x, q.vals[i]); });
    return q.list;
  };
  return () => { cand.items = undo(snap.items); cand.counters = undo(snap.counters); cand.splashes = undo(snap.splashes); fixPoints(cand); };
}
/** 구간 s ~ e 에서 그 층 장을 치운다 — 다 들어가는 장 · EP 는 빼고, 한쪽만 걸친 장은 남는 폭으로 줄인다(그 폭이 안 되면 뺀다). 못 치우면 이유 */
function clearSpan(f: Frame, lv: 'base' | 'wall', s: number, e: number, skip?: Item): string | null {
  const cand = current!;
  const hits = cand.items.filter((x) => x !== skip && x.frame === f && x.level === lv && x.t < e - 1 && x.t + x.w > s + 1);
  const fixed = hits.find((x) => x.tag === 'sink' || x.tag === 'hob' || x.tag === 'dish' || x.tag === 'fix' || /^corner|^wallCorner|^hood$|fridgeTop|pantry/.test(x.key));
  if (fixed) return `그 자리 ${lv === 'base' ? '아래' : '위'}에 ${NAMES[fixed.key] ?? modOf(fixed)?.label ?? fixed.key}이(가) 있어 키큰장을 놓을 수 없습니다`;
  for (const x of hits) {
    const a = x.t, b = x.t + x.w, keepL = a < s - 1 ? s - a : 0, keepR = b > e + 1 ? b - e : 0, rg = x.tag === 'ep' ? null : widthRange(x);
    const fit = (w: number) => !!rg && w >= rg[0] && w <= rg[1];
    if (keepL && !keepR && fit(keepL)) setWidth(x, keepL);
    else if (keepR && !keepL && fit(keepR)) { x.t = e; setWidth(x, keepR); }
    else cand.items = cand.items.filter((q) => q !== x);
  }
  return null;
}
/** s 부터 키큰장(폭 W) + 양옆 EP 를 놓고, 그 자리 상판 · 벽 마감을 걷는다. it 를 주면 그 장을 키큰장으로 바꿔 쓴다(교체 — 화면이 쥔 장 그대로) */
function putTall(f: Frame, wall: WallId, s: number, W: number, key: string, it?: Item): Item {
  const cand = current!;
  const tall: Item = it ?? { key, level: 'tall', frame: f, t: s + 20, w: W, wall };
  if (it) { it.key = key; it.level = 'tall'; it.t = s + 20; delete it.tag; delete it.ov; delete it.robot; }
  else cand.items.push(tall);
  setWidth(tall, W);
  cand.items.push(epItem(tall, s), epItem(tall, s + 20 + W));
  spanCut(cand.counters, f, s, s + W + 40); spanCut(cand.splashes, f, s, s + W + 40);
  fixPoints(cand);
  return tall;
}
/** 하부장 · 상부장 옆에 키큰장 추가 — 고른 장의 줄이 폭(+EP 40)만큼 자리를 내주고, 맞은편 층은 걸친 장을 줄이거나 뺀다 */
function addTall(it: Item, side: 'L' | 'R', key: string): Item | string {
  const m = modK(key);
  if (!current || !m || it.wall == null || (it.level !== 'base' && it.level !== 'wall')) return '이 자리에는 키큰장을 넣을 수 없습니다';
  const back = candUndo(), cand = current, W = addW(m, 'tall', Infinity), tot = W + 40;
  // 자리 내기 — 같은 층 임시 장을 끼워 폭을 키운다(옆 장 · 휠라가 줄거나 줄 끝 빈 공간을 쓴다)
  const phKey = it.level === 'wall' ? (tot > 600 ? 'wall2' : 'wall1') : tot > 600 ? 'cook2' : 'cook1';
  const ph: Item = { key: phKey, level: it.level, frame: it.frame, t: side === 'L' ? it.t - 0.001 : it.t + it.w - 0.001, w: 0, wall: it.wall };
  cand.items.push(ph);
  const err = resizeItem(ph, tot);
  if (err) { back(); return `키큰장 ${W}mm(양옆 EP 포함 ${tot}) 자리를 낼 수 없습니다 — ${err}`; }
  const s = ph.t;
  cand.items = cand.items.filter((x) => x !== ph);
  const err2 = clearSpan(it.frame, it.level === 'wall' ? 'base' : 'wall', s, s + tot);
  if (err2) { back(); return err2; }
  return putTall(it.frame, it.wall, s, W, key);
}
/** 하부장 · 상부장을 키큰장으로 교체 — 그 장 폭에 가장 가까운 키큰장 폭(+EP 40)으로 줄을 맞추고, 맞은편 층을 치운다 */
function swapToTall(it: Item, key: string): string | null {
  const m = modK(key);
  if (!current || !m || it.wall == null || (it.level !== 'base' && it.level !== 'wall')) return '이 장은 키큰장으로 바꿀 수 없습니다';
  if (it.tag === 'sink' || it.tag === 'hob' || it.tag === 'ep' || /^corner|^wallCorner|^hood$|fridgeTop|fill/.test(it.key)) return '이 자리는 키큰장으로 바꿀 수 없습니다';
  const back = candUndo(), ws = widthsOf(m), want = it.w - 40;
  const W = fitsW(m, want) ? want : ws.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a), ws[0] ?? 0);
  if (!W) return '규격 폭이 없습니다';
  const tot = W + 40, lv0 = it.level;
  if (Math.abs(tot - it.w) > 0.5) { const err = resizeItem(it, tot); if (err) { back(); return `키큰장 ${W}mm(양옆 EP 포함 ${tot}) 자리를 낼 수 없습니다 — ${err}`; } }
  const s = it.t;
  const err2 = clearSpan(it.frame, lv0 === 'wall' ? 'base' : 'wall', s, s + tot, it);
  if (err2) { back(); return err2; }
  putTall(it.frame, it.wall, s, W, key, it);
  return null;
}
function epItem(ref: Item, t: number): Item {
  const key = ref.level === 'wall' ? 'epW' : ref.level === 'tall' ? 'epT' : 'epB';
  const ov = current?.items.find((x) => x.key === key && x.ov)?.ov ?? (key === 'epW' ? { STD_YN: 'true', NSTD_H: String(d.room.h - upperBottomOf(d.room)), NSTD_D: '343' } : undefined);
  return { key, level: ref.level, frame: ref.frame, t, w: 20, wall: ref.wall, tag: 'ep', ...(ov ? { ov: { ...ov } } : {}) };
}
/** 줄 끝 옆 빈 공간 쓰기 — edge(줄 끝 장) 의 side 쪽 빈 공간(빼서 비운 자리 · 짧게 잡은 줄 끝)에서 want 까지.
 *  일부만 쓰면 가까운 EP 가 새 줄 끝으로 따라가고, 남는 빈 자리에 양쪽 EP 자리(각 20)를 둔다. 다 쓰면 맞은편 장 · 막힌 끝(벽 · 옆 벽 코너 장)과
 *  이어 EP 를 치운다. 맞은편이 열린 끝(창 · 문 · 트인 쪽)이면 끝 EP 자리 20 을 남긴다. want 를 넘지 않는다. apply 는 줄 끝을 옮긴 뒤 부른다 */
function useFree(edge: Item, side: 'L' | 'R', want: number): { take: number; apply: () => void } | null {
  const fr = want > 0 ? freeBeside(edge, side) : null;
  if (!fr) return null;
  const span = fr.t1 - fr.t0, at0 = side === 'R' ? fr.t0 : fr.t1;
  const nearEp = fr.eps.find((x) => (side === 'R' ? Math.abs(x.t - at0) < 1 : Math.abs(x.t + x.w - at0) < 1));
  const farEp = fr.eps.find((x) => x !== nearEp);
  const join = (!!fr.to || fr.closed) && want >= span;
  const take = join ? span : Math.min(want, span - 20 - (farEp ? 20 : 0));
  if (take <= 0) return null;
  return {
    take, apply: () => {
      if (!current) return;
      if (join) { current.items = current.items.filter((x) => !fr.eps.includes(x)); return; }
      const t = side === 'R' ? at0 + take : at0 - take - 20;
      if (nearEp) nearEp.t = t; else current.items.push(epItem(edge, t));
    },
  };
}
/** 빈 공간 쪽으로 옮기기 — 옮기는 쪽 줄 끝 옆이 빈 공간이면 그 끝까지의 장들을 폭 그대로 밀어 넣는다. 떠난 자리는 뒤 장들이 늘어나 메우고
 *  (키울 때 순서), 뒤에 장이 없으면 빈 자리로 둔다 — 끝에 붙은 EP 는 따라오고, 벽 · 코너 장에 붙어 있던 끝이면 EP 를 댄다(20 이상 옮길 때).
 *  옮긴 폭(빈 공간 · 뒤 장이 받는 데까지), 빈 공간이 없으면 0 */
function slideFree(c: Candidate, grp: Item[], it: Item, delta: number): number {
  const k = grp.indexOf(it), dir = Math.sign(delta);
  const lead = dir > 0 ? grp.slice(k) : grp.slice(0, k + 1);
  const trail = dir > 0 ? grp.slice(0, k) : grp.slice(k + 1);
  const cap = trail.length ? trail.reduce((s, x) => { const r = widthRange(x); return s + (r ? Math.max(0, r[1] - x.w) : 0); }, 0) : Infinity;
  const back = dir > 0 ? it.t : it.t + it.w;
  const tailEp = trail.length ? undefined : c.items.find((x) => x.tag === 'ep' && x.wall === it.wall && x.level === it.level && Math.abs((dir > 0 ? x.t + x.w : x.t) - back) < 1);
  const u = useFree(dir > 0 ? grp[grp.length - 1] : grp[0], dir > 0 ? 'R' : 'L', Math.min(Math.abs(delta), cap));
  if (!u || (!trail.length && !tailEp && u.take < 20)) return 0;
  const m = u.take;
  let left = m;
  for (const x of byPriority(trail.slice().sort((a, b) => Math.abs(grp.indexOf(a) - k) - Math.abs(grp.indexOf(b) - k)), true)) {
    if (!left) break;
    const r = widthRange(x);
    if (!r) continue;
    const nw = Math.min(r[1], x.w + left);
    if (nw > x.w) { left -= nw - x.w; setWidth(x, nw); }
  }
  u.apply();
  for (const x of lead) x.t += dir * m;
  if (trail.length) {
    // 뒤 장들 — 줄의 먼 끝은 그대로, 늘어난 만큼 옮긴 장 쪽으로
    let t = dir > 0 ? grp[0].t : it.t + it.w;
    for (const x of trail) { x.t = t; t += x.w; }
  } else if (tailEp) tailEp.t += dir * m;
  else c.items.push(epItem(it, dir > 0 ? it.t - 20 : it.t + it.w));
  return m;
}
/** 옆에 새 장 · 휠라. 장은 옆 빈 공간이 있으면 그 자리에(옆 장을 줄이지 않는다) — 빈 칸 · 막힌 끝까지 한 장으로 메울 수 있으면 그 폭으로 메워 잇는다.
 *  빈 공간이 없으면 폭 0 으로 끼운 뒤 원하는 폭으로 늘린다(같은 줄 장들이 그만큼 줄어든다). key = 넣을 장(카드), 없으면 1도어 · 2도어 중 폭에 맞는 것.
 *  실패하면 이유 문자열 */
function addBeside(it: Item, side: 'L' | 'R', fill = false, key?: string): Item | string {
  if (!current) return '배치안이 없습니다';
  if (key && isTallKey(key) && (it.level === 'base' || it.level === 'wall')) return addTall(it, side, key);
  const [k1, k2] = ADD_KEYS[it.level] ?? ADD_KEYS.base;
  const keys = (key ? [key] : [k1, k2]).filter((k) => modK(k));
  const tagOf = (k: string) => (k === 'dish' ? { tag: 'dish' as const } : {});
  if (!fill) {
    if (!keys.length) return '이 그레이드에 넣을 장이 없습니다';
    const fr = freeBeside(it, side);
    if (fr) {
      const span = fr.t1 - fr.t0, at0 = side === 'R' ? fr.t0 : fr.t1;
      const nearEp = fr.eps.find((x) => (side === 'R' ? Math.abs(x.t - at0) < 1 : Math.abs(x.t + x.w - at0) < 1));
      const farEp = fr.eps.find((x) => x !== nearEp);
      // 빈 칸 · 막힌 끝(벽 · 날개벽 · 옆 벽 코너 장)까지 한 장으로 메울 수 있으면 메워 잇는다(EP 를 치움).
      // 아니면 기본 폭(모자라면 남는 자리에 맞춘 폭) — 새 끝에 EP, 맞은편 장 끝 EP 는 그대로(예전엔 맞은편 EP 까지 치워 그 장 옆면이 드러났다)
      let k = fr.to || fr.closed ? keys.find((x) => fitsW(modK(x), span)) : undefined, w = k ? span : 0;
      if (!k) for (const x of keys) { w = addW(modK(x)!, it.level, span - 20 - (farEp ? 20 : 0)); if (w) { k = x; break; } }
      const u = k ? useFree(it, side, w) : null;
      if (k && u && u.take === w) {
        const nt: Item = { key: k, level: it.level, frame: it.frame, t: side === 'R' ? fr.t0 : fr.t1 - w, w, wall: it.wall, ...tagOf(k) };
        u.apply();
        current.items.push(nt);
        setWidth(nt, w);
        fixPoints(current);
        return nt;
      }
    }
  }
  const k = fill ? (key && /fill/.test(key) ? key : it.level === 'wall' ? 'wfill50' : 'bfill50') : keys[0], m = modK(k);
  if (!m) return `이 그레이드에 넣을 ${fill ? '휠라가' : '장이'} 없습니다`;
  const w = fill ? Number(m.W?.value) || 50 : addW(m, it.level, Infinity);
  // 줄 정렬에서 기준 장의 바로 왼쪽 · 오른쪽에 오도록 t 를 아주 조금 비켜 끼운다(다시 이을 때 정수로 맞춰진다)
  const nt: Item = { key: k, level: it.level, frame: it.frame, t: side === 'L' ? it.t - 0.001 : it.t + it.w - 0.001, w: 0, wall: it.wall, ...tagOf(k) };
  current.items.push(nt);
  const err = resizeItem(nt, w);
  if (err) {
    current.items = current.items.filter((x) => x !== nt);
    // 키큰장 · 냉장고 줄은 하부 · 상부장을 줄여 자리를 만들지 않는다 — 옆이 하부장이면 그 장을 빼 빈 자리로 두고 추가하면 그 칸에 들어간다
    if (it.level === 'tall') return '옆에 빈 공간이 없습니다 — 키큰장 · 냉장고 옆은 바닥부터 천장까지 빈 벽에만 추가됩니다(옆 하부장 · 그 위 상부장을 빼면 그 자리에)';
    return `넣을 자리가 없습니다 — ${err}`;
  }
  return nt;
}
/** 옮길 때 떠난 자리를 어떻게 할지 묻는 창 — 채우기(join) · 비워 두기(leave) · 취소(null). 「이 장 빼기」의 물음과 같은 말 */
function askGap(w: number): Promise<'join' | 'leave' | null> {
  document.querySelector('#gap-ask')?.remove();
  const box = document.createElement('div');
  box.id = 'gap-ask';
  box.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:60;background:#fff;border:1px solid #d9dce1;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:14px 16px;font-size:13px;max-width:92vw';
  box.innerHTML = `<b>옮긴 장이 있던 ${Math.round(w)}mm 자리를 어떻게 할까요?</b>
    <div class="ii-swap" style="margin-top:10px"><button data-gap="join">옆 장으로 이어 메우기</button><button data-gap="leave">빈 자리로 두기 (옆 장 끝 EP)</button><button data-gap="cancel" class="plain">취소 (옮기지 않음)</button></div>`;
  document.body.appendChild(box);
  return new Promise((res) => {
    const end = (v: 'join' | 'leave' | null) => { box.remove(); document.removeEventListener('keydown', key); res(v); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(null); };
    document.addEventListener('keydown', key);
    box.querySelectorAll<HTMLElement>('[data-gap]').forEach((b) => b.addEventListener('click', () => end(b.dataset.gap === 'cancel' ? null : (b.dataset.gap as 'join' | 'leave'))));
  });
}
/** 빼기 — join: 옆 장들이 그 폭만큼 늘어난다(다 못 받으면 빈 자리) · leave: 그 자리를 비우고 옆 장의 드러난 끝에 EP */
function removeItem(it: Item, mode: 'join' | 'leave' = 'join'): string {
  if (!current) return '';
  const w0 = it.w, t0 = it.t;
  const err = mode === 'join' ? resizeItem(it, 0) : 'leave';
  current.items = current.items.filter((x) => x !== it);
  if (err) gapEps(current, it, t0, w0);
  fixPoints(current);
  // 빈 자리 — 옆 장을 고르고 그 쪽으로 「장 추가」하면 그 칸 폭에 맞춰 메우고 양쪽 EP 를 치운다(사용자 지시 2026-11-06)
  if (mode === 'leave') return `장을 뺐습니다 — ${w0}mm 를 빈 자리로 두고 옆 장 끝에 EP 를 댔습니다 · 다시 이으려면 옆 장을 고르고 그 쪽으로 「장 추가」`;
  return err ? `장을 뺐습니다 — 옆 장이 다 받지 못해 ${w0}mm 를 빈 자리로 남기고 옆 장 끝에 EP 를 댔습니다 · 다시 이으려면 옆 장을 고르고 그 쪽으로 「장 추가」` : '장을 뺐습니다 — 옆 장이 그 폭만큼 늘었습니다';
}
/* ───────── 장 하나를 다른 벽(또는 같은 벽 다른 자리)으로 — 사용자 2026-11-11 「모든 장은 단독으로 장 이동해서 벽에 배치 가능하게」 · 「냉장고장도 단독으로 벽 이동」 ─────────
 * 떠나는 자리: 하부 · 상부장은 옆 장이 그 폭을 받고(못 받으면 빈 자리 + EP), 키큰장 · 냉장고장은 빈 자리로 두고 옆 줄 끝에 EP. 빈 자리 상판 · 벽 마감은 걷는다.
 * 놓는 자리: 그 층 높이를 차지한 것이 없으면 그 자리에(가까운 장 · 벽 · 막힌 끝에 150 안이면 붙임, 드러난 옆면에 EP, 하부장이면 상판 · 벽 마감을 새로).
 * 같은 층 장 줄 위면 가장 가까운 장 사이에 끼워 옆 장들이 자리를 내준다(키큰장 · 냉장고장은 빈 벽에만). 냉장고 윗장은 냉장고를 따라간다 */
/** 그 벽 장들이 쓰는 틀 — 같은 벽 장끼리 같은 틀 객체여야 줄로 묶인다. 장이 없는 벽이면 새 틀 */
function frameOfWall(w: WallId): Frame {
  const x = current?.items.find((q) => q.wall === w);
  if (x) return x.frame;
  const f = wallFrame(d.room, w);
  return { o: [f.o[0], f.o[1]], dir: [f.dir[0], f.dir[1]], n: [f.n[0], f.n[1]] };
}
type Span = { frame: Frame; t0: number; t1: number; island?: boolean };
/** 같은 틀 띠들에 a ~ b 를 더한다(닿는 띠와 합침) · 뺀다 — 상판 · 벽 마감 */
function spanAdd<T extends Span>(list: T[], f: Frame, a: number, b: number, mk: (a: number, b: number) => T) {
  let lo = a, hi = b;
  for (const s of list.filter((x) => x.frame === f && !x.island && x.t1 >= lo - 1 && x.t0 <= hi + 1)) { lo = Math.min(lo, s.t0); hi = Math.max(hi, s.t1); list.splice(list.indexOf(s), 1); }
  list.push(mk(lo, hi));
}
function spanCut<T extends Span>(list: T[], f: Frame, a: number, b: number) {
  for (const s of list.filter((x) => x.frame === f && !x.island && x.t1 > a + 1 && x.t0 < b - 1)) {
    list.splice(list.indexOf(s), 1);
    if (a - s.t0 >= 1) list.push({ ...s, t1: a });
    if (s.t1 - b >= 1) list.push({ ...s, t0: b });
  }
}
/** a ~ b 에서 그 틀 · 층 장(EP · 코너장 포함)이 덮지 않은 조각 */
function bareSpans(f: Frame, lv: Item['level'], a: number, b: number): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const x of current!.items.filter((q) => q.frame === f && q.level === lv)) out = out.flatMap(([s0, s1]) => (x.t + x.w <= s0 || x.t >= s1 ? [[s0, s1] as [number, number]] : ([[s0, x.t], [x.t + x.w, s1]] as [number, number][]).filter(([p, q]) => q - p > 1)));
  return out;
}
/** 그 틀 하부장(EP · 코너장 포함) 위에 상판 · 벽 마감이 빠진 곳을 채운다 — 줄에 끼우며 줄이 옆 빈 공간으로 늘어난 자리 등. 키큰장 · 냉장고장 자리는 빼고 */
function fillCounters(f: Frame) {
  if (!current) return;
  const cand = current;
  for (const x of cand.items.filter((q) => q.frame === f && q.level === 'base' && q.wall != null)) {
    let parts: [number, number][] = [[x.t, x.t + x.w]];
    for (const k of cand.counters.filter((q) => q.frame === f && !q.island)) parts = parts.flatMap(([a, b]) => (k.t1 <= a || k.t0 >= b ? [[a, b] as [number, number]] : ([[a, k.t0], [k.t1, b]] as [number, number][]).filter(([p, q]) => q - p > 1)));
    for (const [a, b] of parts) {
      spanAdd(cand.counters, f, a, b, (p, q) => ({ frame: f, t0: p, t1: q, z0: 0, z1: COUNTER_D }));
      spanAdd(cand.splashes, f, a, b, (p, q) => ({ frame: f, t0: p, t1: q }));
    }
  }
}
/** 빈 자리 a ~ b 옆에 드러난 장 끝 — 하부 · 상부 줄 장 끝이 빈 자리에 닿으면 그 끝에 EP(이미 EP 가 있으면 그대로) */
function exposeEnds(f: Frame, w: WallId, a: number, b: number) {
  if (b - a < 20) return;
  for (const lv of ['base', 'wall'] as const) {
    if (bareSpans(f, lv, a, b).reduce((s, [p, q]) => s + q - p, 0) < b - a - 1) continue;   // 그 층은 빈 자리가 아니다
    const same = (x: Item) => x.frame === f && x.level === lv;
    const L = current!.items.find((x) => same(x) && Math.abs(x.t + x.w - a) < 1), R = current!.items.find((x) => same(x) && Math.abs(x.t - b) < 1);
    if (L && L.tag !== 'ep') current!.items.push(epItem(L, a));
    if (R && R.tag !== 'ep') current!.items.push(epItem(R, b - 20));
  }
}
function moveItemTo(it: Item, wall: WallId, c: number, gap: 'join' | 'leave' = 'join'): { item: Item } | string {
  if (!current || it.wall == null) return '벽에 붙은 장만 옮길 수 있습니다';
  const cand = current;
  // 실패하면 되돌린다 — 복사본으로 바꿔 끼우지 않고 같은 객체에 값을 되돌려 넣는다(frame 은 벽마다 같은 객체여야 해 얕게 복사).
  //   복사본을 넣으면 화면이 고른 장(it)은 배치에서 빠진 채 떼어 낼 때 줄인 폭(0)으로 남아, 그 장을 다시 끌면 폭 0 장이 놓였다
  //   (사용자 2026-11-11 「장을 선택해서 이동배치하면 꼬이는거 같아」)
  const keep = <T extends object>(xs: T[]) => ({ list: xs.slice(), vals: xs.map((x) => ({ ...x, ...('ov' in x && x.ov ? { ov: { ...(x.ov as object) } } : {}) }) as T) });
  const snap = { items: keep(cand.items), counters: keep(cand.counters), splashes: keep(cand.splashes) };
  const undo = <T extends object>(s: { list: T[]; vals: T[] }) => {
    s.list.forEach((x, i) => { for (const k of Object.keys(x)) if (!(k in s.vals[i])) delete (x as Record<string, unknown>)[k]; Object.assign(x, s.vals[i]); });
    return s.list;
  };
  const back = (msg: string) => { cand.items = undo(snap.items); cand.counters = undo(snap.counters); cand.splashes = undo(snap.splashes); fixPoints(cand); return msg; };
  const f0 = it.frame, w0 = it.wall, t0 = it.t, ww = it.w, lv = it.level;
  // 떼어 내기 전 모습 — 떼어 낼 때(removeItem join) 폭을 0 으로 줄이며 「비규격 폭 0」 표시(ov NSTD_W)가 붙는다. 그 장을 그대로 복사해 빈 곳에 놓으면
  //   몸통이 폭 0 으로 찌그러졌다(사용자 2026-11-11 「장 이동시 오른쪽 벽에 붙으면 장이 깨지는」 — 빈 벽 · 줄 끝 빈 곳에 놓는 길만 폭을 다시 안 잡았다)
  const src: Item = { ...it, ...(it.ov ? { ov: { ...it.ov } } : {}) };
  const top = it.key === 'fridge' ? cand.items.find((x) => x.key === 'fridgeTop' && x.frame === f0 && Math.abs(x.t - t0) < 1) : undefined;
  // ① 떠나기 — 이 장 옆면 EP(맞은편에 다른 장이 없는 것)는 같이 뗀다
  const own = cand.items.filter((x) => x.tag === 'ep' && x.frame === f0 && x.level === lv && (Math.abs(x.t + x.w - t0) < 1 || Math.abs(x.t - (t0 + ww)) < 1))
    .filter((ep) => { const outer = Math.abs(ep.t + ep.w - t0) < 1 ? ep.t : ep.t + ep.w; return !cand.items.some((y) => y !== ep && y !== it && y.tag !== 'ep' && y.frame === f0 && y.level === lv && (Math.abs(y.t + y.w - outer) < 1 || Math.abs(y.t - outer) < 1)); });
  cand.items = cand.items.filter((x) => !own.includes(x) && x !== top);
  const span0: [number, number] = [Math.min(t0, ...own.map((x) => x.t)), Math.max(t0 + ww, ...own.map((x) => x.t + x.w))];
  if (lv === 'tall') cand.items = cand.items.filter((x) => x !== it);
  else removeItem(it, gap);   // gap — 떠난 자리를 옆 장이 받을지(join) · 비워 두고 옆 장 끝에 EP 를 댈지(leave). 끌어 옮길 때 묻는다(askGap)
  // 빈 자리 — 하부 빈 곳의 상판 · 벽 마감을 걷고, 드러난 장 끝에 EP
  for (const [a, b] of bareSpans(f0, 'base', span0[0], span0[1])) if (lv !== 'wall') { spanCut(cand.counters, f0, a, b); spanCut(cand.splashes, f0, a, b); }
  if (lv === 'tall') exposeEnds(f0, w0, span0[0], span0[1]);
  // ② 놓기
  const F = frameOfWall(wall), L = wallLength(d.room, wall);
  const nt: Item = { ...src, frame: F, wall, t: 0, w: ww };
  if (!src.ov) delete (nt as Partial<Item>).ov;
  delete (nt as Partial<Item>).robot;
  if (it.robot) nt.robot = true;
  const zone = rowZone(lv);
  const occ = (): { a: number; b: number; item?: Item; closed: boolean }[] => [
    ...cand.items.filter((x) => x.wall === wall && x.frame === F && zone(x)).map((x) => ({ a: x.t, b: x.t + x.w, item: x, closed: x.tag !== 'ep' })),
    ...rowStops(nt).map((s) => ({ a: s.a, b: s.b, closed: s.closed })),
  ];
  const os = occ();
  const hitItems = os.filter((o) => o.item && o.item.tag !== 'ep' && o.a < c + 1 && o.b > c - 1);
  // 장 줄의 경계(줄 끝 포함) 중 c 에 가장 가까운 곳에 끼우고 옆 장들이 자리를 내준다
  const pickRow = lv === 'wall' ? upperRowPick : (x: Item) => x.level === lv && x.tag !== 'ep' && !x.key.startsWith('corner');
  const insertNear = (ref: Item): string | null => {
    const grp = rowGroup(cand.items, ref, pickRow);
    const bounds = grp.flatMap((x) => [{ at: x.t, ref: x, side: 'L' as const }, { at: x.t + x.w, ref: x, side: 'R' as const }]).sort((p, q) => Math.abs(p.at - c) - Math.abs(q.at - c));
    const bd = bounds[0];
    nt.t = bd.side === 'L' ? bd.ref.t - 0.001 : bd.ref.t + bd.ref.w - 0.001; nt.w = 0;
    cand.items.push(nt);
    return resizeItem(nt, ww);
  };
  // 줄 끝 EP(같은 층)는 빈 곳으로 본다 — 놓은 장이 그 자리를 덮으면 EP 를 걷는다. 막힌 것으로 보면 줄 끝 옆에 놓을 때 EP 가 장 사이에 끼었다
  //   (사용자 기록 2026-11-11: 싱크 · EP · 조리장)
  const rowEp = (o: { item?: Item }) => o.item?.tag === 'ep' && o.item.level === lv;
  const os2 = os.filter((o) => !rowEp(o));
  if (hitItems.length && lv !== 'tall' && hitItems.every((o) => o.item!.level === lv)) {
    const err = insertNear(hitItems[0].item!);
    if (err) return back(`그 줄에 끼울 자리가 없습니다 — ${err}`);
  } else {
    // 빈 곳 — c 가 든 빈 구간(없으면 가장 가까운, 장이 들어가는 구간)
    const [S0, S1] = cabSpan(d, wall);
    const blocks = os2.map((o) => [Math.max(S0, o.a), Math.min(S1, o.b)] as [number, number]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    const free: [number, number][] = [];
    let cur = S0;
    for (const [a, b] of blocks) { if (a > cur) free.push([cur, a]); cur = Math.max(cur, b); }
    if (cur < S1) free.push([cur, S1]);
    const fit = free.filter(([a, b]) => b - a >= ww).sort((p, q) => Math.max(0, p[0] - c, c - p[1]) - Math.max(0, q[0] - c, c - q[1]))[0];
    // 빈 곳이 모자라면 — 그 벽 같은 층 장 줄 끝에 끼워 옆 장들이 자리를 내준다(뺄 때 옆 장이 늘어 빈칸을 먹었으면 다시 가져올 수 없었다)
    const row = lv === 'tall' ? [] : cand.items.filter((x) => x.wall === wall && x.frame === F && pickRow(x)).sort((p, q) => Math.min(Math.abs(p.t - c), Math.abs(p.t + p.w - c)) - Math.min(Math.abs(q.t - c), Math.abs(q.t + q.w - c)));
    if (!fit && row.length) {
      const err = insertNear(row[0]);
      if (err) return back(`그 벽에 ${ww}mm 장이 들어갈 자리가 없습니다 — ${err}`);
      cand.items = cand.items.filter((x) => !(x.tag === 'ep' && x.level === lv && x.frame === F && x.t < nt.t + nt.w - 1 && x.t + x.w > nt.t + 1));
      fillCounters(f0); if (F !== f0) fillCounters(F);
      fixPoints(cand);
      return { item: nt };
    }
    if (!fit) return back(lv === 'tall' ? '그 벽에 키큰장 · 냉장고장을 놓을 빈 벽이 없습니다 — 바닥부터 천장까지 비어 있어야 합니다(옆 하부 · 상부장을 먼저 빼거나 옮기세요)' : `그 벽에 ${ww}mm 장이 들어갈 빈 자리가 없습니다 — 창 · 문 · 다른 장과 겹칩니다`);
    const [A, B] = fit;
    let t = Math.round(Math.max(A, Math.min(B - ww, c - ww / 2)) / 10) * 10;
    t = Math.max(A, Math.min(B - ww, t));
    if (t - A < 150) t = A; else if (B - (t + ww) < 150) t = B - ww;
    // 끝에 닿은 것 — 장(EP 아님) · 막힌 끝이면 그대로 붙고, 열린 끝(창 · 문 · 트인 쪽)이나 빈 곳이면 그 옆면에 EP
    const edge = (x: number, left: boolean) => os2.find((o) => Math.abs((left ? o.b : o.a) - x) < 1);
    nt.t = t;
    cand.items = cand.items.filter((x) => !(x.tag === 'ep' && x.level === lv && x.frame === F && x.t < t + ww - 1 && x.t + x.w > t + 1));
    cand.items.push(nt);
    const eps: Item[] = [];
    const joins = (o?: { item?: Item; closed: boolean }) => !!o && (!!o.item || o.closed);
    if (!joins(edge(t, true))) { if (t - A >= 20) eps.push(epItem(nt, t - 20)); else if (B - (t + ww) >= 20) { nt.t = t = t + 20; eps.push(epItem(nt, t - 20)); } }
    if (!joins(edge(t + ww, false)) && B - (t + ww) >= 20) eps.push(epItem(nt, t + ww));
    cand.items.push(...eps);
    if (lv === 'base') {
      const a = Math.min(nt.t, ...eps.map((x) => x.t)), b = Math.max(nt.t + ww, ...eps.map((x) => x.t + x.w));
      spanAdd(cand.counters, F, a, b, (p, q) => ({ frame: F, t0: p, t1: q, z0: 0, z1: COUNTER_D }));
      spanAdd(cand.splashes, F, a, b, (p, q) => ({ frame: F, t0: p, t1: q }));
    }
    // 냉장고 윗장 — 위가 비어 있으면 같이(창 · 상부장이 있으면 냉장고만)
    if (top) {
      const nt2: Item = { ...top, frame: F, wall, t: nt.t };
      const upOcc = [...cand.items.filter((x) => x.wall === wall && x.frame === F && x.level === 'wall'), ...rowStops({ ...nt2, level: 'wall' }).map((s) => ({ t: s.a, w: s.b - s.a }))];
      if (!upOcc.some((x) => x.t < nt.t + ww - 1 && x.t + x.w > nt.t + 1)) cand.items.push(nt2);
    }
  }
  fillCounters(f0); if (F !== f0) fillCounters(F);
  fixPoints(cand);
  return { item: cand.items.includes(nt) ? nt : cand.items[cand.items.length - 1] };
}
/** 빈 자리 양옆 — 옆에 장이 닿아 있으면(EP · 벽이 아니면) 빈 자리 안쪽에 EP 20. 상부장 EP 는 같은 줄 EP 의 비규격 값을 따른다 */
function gapEps(c: Candidate, it: Item, t0: number, w0: number) {
  const key = it.level === 'wall' ? 'epW' : 'epB';
  const same = (x: Item) => x.level === it.level && x.frame === it.frame && x.wall === it.wall;
  const ov = c.items.find((x) => x.key === key && x.ov)?.ov ?? (key === 'epW' ? { STD_YN: 'true', NSTD_H: String(d.room.h - upperBottomOf(d.room)), NSTD_D: '343' } : undefined);
  const at = (x: number) => c.items.push({ key, level: it.level, frame: it.frame, t: x, w: 20, wall: it.wall, tag: 'ep', ...(ov ? { ov: { ...ov } } : {}) });
  const L = c.items.find((x) => same(x) && Math.abs(x.t + x.w - t0) < 1), R = c.items.find((x) => same(x) && Math.abs(x.t - (t0 + w0)) < 1);
  let room = w0;
  if (L && L.tag !== 'ep' && room >= 20) { at(t0); room -= 20; }
  if (R && R.tag !== 'ep' && room >= 20) at(t0 + w0 - 20);
}
/** 장 교체 — 폭이 새 장 규격(또는 비규격 범위)에 맞으면 그대로, 아니면 가장 가까운 규격 폭으로(차이는 옆 장이 받음) */
function swapItem(it: Item, key: string): string | null {
  if (key === it.key) return null;
  if (isTallKey(key) && (it.level === 'base' || it.level === 'wall')) return swapToTall(it, key);
  const nm = cat.modules.find((m) => m.key === key && (m.series === grade().series || m.series === '*'));
  if (!nm) return '이 그레이드에는 없는 장입니다';
  const old = { key: it.key, tag: it.tag, ov: it.ov, robot: it.robot };
  // 비규격 높이 · 깊이(창 위 낮은 상부장 등)는 바꾼 장도 그대로 — 예전엔 다 지워 창을 덮는 원래 높이로 돌아갔다
  const keepHD = Object.fromEntries(Object.entries(it.ov ?? {}).filter(([k]) => k === 'NSTD_H' || k === 'NSTD_D'));
  it.key = key; delete it.ov;
  if (Object.keys(keepHD).length) it.ov = keepHD;
  if (key === 'dish') it.tag = 'dish'; else if (old.tag === 'dish') delete it.tag;
  if (/fill/.test(key)) delete it.robot;     // 휠라엔 로봇청소기 자리가 없다
  if (fitsW(nm, it.w)) { setWidth(it, it.w); return null; }
  // 장 → 휠라는 휠라 최대 폭(150)으로 — 남는 폭은 옆 장이 받는다
  const ws = /fill/.test(key) ? [Math.max(FILL_MIN, Math.min(FILL_MAX, it.w))] : widthsOf(nm);
  const target = ws.reduce((a, b) => (Math.abs(b - it.w) < Math.abs(a - it.w) ? b : a), ws[0]);
  const err = target ? resizeItem(it, target) : '규격 폭이 없습니다';
  if (err) { it.key = old.key; it.tag = old.tag; it.ov = old.ov; if (old.robot) it.robot = old.robot; return err; }
  return null;
}
/** 폭 바꾸기 — 같은 줄에 붙어 있는 장 중 가까운 것(휠라 먼저)이 차이를 흡수, 줄 위치를 다시 잇는다 */
function resizeItem(it: Item, w: number): string | null {
  if (!current) return '배치안이 없습니다';
  const delta = w - it.w;
  if (!delta) return null;
  // 같은 줄에 빈틈없이 이어진 장들(EP · 코너장 · 냉장고 윗장 제외) — 나머지가 -delta 를 나눠 받는다
  // 코너장 자신을 바꿀 때는 그 코너장도 줄에 넣는다 — 코너 쪽 끝은 그대로, 안쪽 끝이 움직이고 옆 장들이 받는다
  const pickRow0 = it.level === 'wall' ? upperRowPick : (x: Item) => x.level === it.level && x.tag !== 'ep' && !x.key.startsWith('corner');
  const pickRow = (x: Item) => x === it || pickRow0(x);
  const group = rowGroup(current.items, it, pickRow);
  const k = group.indexOf(it);
  // 크기 바꾸는 순서 — 휠라 → 여닫이장 → 서랍장 → 식세 · 싱크 · 쿡탑장, 같은 등급이면 가까운 장부터
  const near = group.filter((x) => x !== it).sort((a, b) => Math.abs(group.indexOf(a) - k) - Math.abs(group.indexOf(b) - k));
  const plan = new Map<Item, number>();
  let rem = -delta;
  // 키울 때는 줄 끝 옆 빈 공간(빼서 비운 자리 · 짧게 잡은 줄 끝)을 먼저 쓴다 — 가까운 끝부터, 옆 장은 그다음에 줄인다
  //   (사용자 2026-11-09 「빈 공간 있으면 늘어나게」 — 예전엔 빈 자리 옆 장을 늘리면 「옆 장이 줄어들 수 있는 폭이 없습니다」)
  const frees: (() => void)[] = [];
  let shiftL = 0;
  if (delta > 0 && it.wall != null) {
    for (const side of (k <= group.length - 1 - k ? ['L', 'R'] : ['R', 'L']) as ('L' | 'R')[]) {
      const u = rem < 0 ? useFree(side === 'L' ? group[0] : group[group.length - 1], side, -rem) : null;
      if (!u) continue;
      rem += u.take; frees.push(u.apply);
      if (side === 'L') shiftL = u.take;
    }
  }
  // 줄일 때 — 남는 폭은 먼저 옆 벽 코너 자리에 들어간 줄 끝을 당기는 데 쓴다(예전 버그로 코너장 쪽으로 커진 줄이 제자리로)
  const pull = { L: 0, R: 0 };
  if (delta < 0 && it.wall != null) {
    for (const s of ['L', 'R'] as const) {
      const p = Math.min(rem, cornerOverrun(s === 'L' ? group[0] : group[group.length - 1], s));
      if (p > 0) { pull[s] += p; rem -= p; }
    }
  }
  // 옆 장들 — 휠라(30 ~ 150)가 먼저, 남으면 배치 규칙 순서(여닫이 → 서랍 → 싱크 · 쿡탑 → 식세, 키울 때 반대)로 다른 정규격 폭, 그래도 안 맞으면 비규격
  //   (planWidths — 사용자 2026-11-11 「모든 장은 정규격 사이즈로 … 휠라로 조절이 안될때 배치룰 순서대로 장의 사이즈를 조절」. 예전엔 옆 장을 비규격 폭으로 바로 늘이고 줄였다)
  {
    // 줄 끝이 벽이면 그 끝 새 휠라(30 ~ 150)도 받을 수 있다 — 기존 휠라 다음, 장 크기 바꾸기보다 먼저(아래에서 만든다)
    const wl0 = it.wall, L0 = wl0 != null ? wallLength(d.room, wl0) : 0;
    const wallEnd = wl0 != null && ((group[0].t <= 1 && (prevWall(wl0) !== d.openWall || d.wing.b >= 600)) || (group[group.length - 1].t + group[group.length - 1].w >= L0 - 1 && (nextWall(wl0) !== d.openWall || d.wing.a >= 600)));
    const r = planWidths(near, rem, (x) => { const fill = /fill/.test(x.key); return { fill, std: fill ? [] : widthOptions(x), range: fill ? [Math.min(FILL_MIN, x.w), FILL_MAX] : widthRange(x) }; }, rem > 0 && wallEnd ? [FILL_MIN, FILL_MAX] : null);
    for (const [x, nw] of r.plan) plan.set(x, nw);
    rem = r.rem;
  }
  // 아직 남으면 — 줄 끝이 벽이면 그 끝에 휠라를 새로 (휠라는 벽 쪽 끝에만)
  let add: Item | null = null;
  if (rem > 0) {
    const wl = it.wall, L = wl != null ? wallLength(d.room, wl) : 0;
    const atS = wl != null && group[0].t <= 1 && (prevWall(wl) !== d.openWall || d.wing.b >= 600);
    const atE = wl != null && group[group.length - 1].t + group[group.length - 1].w >= L - 1 && (nextWall(wl) !== d.openWall || d.wing.a >= 600);
    if ((atS || atE) && rem >= FILL_MIN && rem <= FILL_MAX) {
      add = { key: it.level === 'wall' ? 'wfill50' : 'bfill50', level: it.level, frame: it.frame, t: 0, w: rem, wall: it.wall };
      (add as Item & { _atStart?: boolean })._atStart = atS && !atE;
      rem = 0;
    }
  }
  // 줄일 때 옆 장이 다 못 받으면 — 줄 끝을 당겨 빈 자리로 둔다(사용자 2026-11-09 「1100 에서 700 으로 줄이는데 오류」).
  // 당기는 쪽 장들은 줄인 장 쪽으로 옮겨지므로 후드 · 싱크 · 쿡탑장(위 · 아래 기기, 배관)이 없는 쪽만 — 드러난 끝(EP)이 먼저, 그다음 옮길 장이 적은 쪽.
  // EP 는 따라오고, 벽 · 키큰장에 닿았던 끝은 빈 자리에 장 끝 EP(그래서 20 이상일 때만). 양쪽 다 안 되면 예전처럼 막는다
  const sameEp = (x: Item) => x.tag === 'ep' && x.level === it.level && x.wall === it.wall && x.frame === it.frame;
  const epAt = { L: current.items.find((x) => sameEp(x) && Math.abs(x.t + x.w - group[0].t) < 1), R: current.items.find((x) => sameEp(x) && Math.abs(x.t - (group[group.length - 1].t + group[group.length - 1].w)) < 1) };
  if (rem > 0 && delta < 0 && it.wall != null) {
    const moves = { L: group.slice(0, k), R: group.slice(k + 1) };
    const anchored = (x: Item) => x.key === 'hood' || x.tag === 'sink' || x.tag === 'hob';
    const sides = (['L', 'R'] as const).filter((s) => !moves[s].some(anchored) && (epAt[s] || rem >= 20))
      .sort((a, b) => (Number(!epAt[a]) - Number(!epAt[b])) || moves[a].length - moves[b].length);
    if (sides.length) { pull[sides[0]] += rem; rem = 0; }
  }
  if (rem) return `옆 장이 ${delta > 0 ? '줄어들' : '늘어날'} 수 있는 폭이 없습니다 — 다른 폭을 고르세요`;
  const start0 = group[0].t, end0 = group[group.length - 1].t + group[group.length - 1].w;
  setWidth(it, w);
  for (const [x, nw] of plan) setWidth(x, nw);
  for (const f of frees) f();
  const gone = [...plan].filter(([x, nw]) => /fill/.test(x.key) && nw < 10).map(([x]) => x);
  current.items = current.items.filter((x) => !gone.includes(x));
  let seq = group.filter((x) => !gone.includes(x));
  if (add) { current.items.push(add); seq = (add as Item & { _atStart?: boolean })._atStart ? [add, ...seq] : [...seq, add]; }
  let t = group[0].t - shiftL + pull.L;
  for (const g of seq) { g.t = t; t += g.w; }
  // 당긴 끝 — 막힌 자리(옆 벽 코너장 · 벽)에 닿으면 EP 없이(코너 쪽으로 커질 때 따라 들어간 EP 는 치운다),
  // 아니면 그 끝 EP 가 따라오고 EP 가 없던 끝(벽 · 키큰장에 닿았던 끝)은 드러난 장 끝에 EP
  const stops = pull.L || pull.R ? rowStops(it) : [];
  for (const s of ['L', 'R'] as const) {
    if (!pull[s]) continue;
    const at = s === 'R' ? end0 - pull.R : start0 + pull.L, ep = epAt[s];
    if (stops.some((x) => x.closed && Math.abs((s === 'R' ? x.a : x.b) - at) < 1)) { if (ep) current.items = current.items.filter((x) => x !== ep); }
    else if (ep) ep.t = s === 'R' ? at : at - 20;
    else if (pull[s] >= 20) current.items.push(epItem(s === 'R' ? group[group.length - 1] : group[0], s === 'R' ? at : at - 20));
  }
  // 싱크 · 쿡탑 기호 자리 (위에 얹힌 후드 등은 자동 배치를 다시 하면 맞춰진다)
  fixPoints(current);
  return null;
}
/* 벽 고르기 — 길이(방 크기) · 두께 · 트인 벽 날개벽 */
/** 냉장고장 묶음이 그 벽 줄 어느 끝인지 — 시작(마주 보면 왼쪽) · 끝(오른쪽) */
const fridgeEndOf = (fr: Item): 'start' | 'end' => (fr.t + fr.w / 2 < wallLength(d.room, fr.wall!) / 2 ? 'start' : 'end');
/** 냉장고장 · 키큰장 · 냉장고 윗장 · 그 옆 EP 를 고르면 — 묶음 자리 고르기 */
function fridgeRow(it: Item): string {
  const fr = current?.items.find((x) => x.tag === 'fridge');
  if (!fr || fr.wall == null) return '';
  const inGroup = it === fr || it.key === 'fridgeTop' || it.level === 'tall' || (it.key === 'epTx' && it.wall === fr.wall);
  if (!inGroup) return '';
  // 벽 — 지금 배치의 벽만이 아니라 트인 쪽을 뺀 모든 벽(고르면 그 벽을 쓰는 배치 안으로 다시 짠다)
  const v = viewWalls(d.openWall);
  const end = fridgeEndOf(fr), walls = [v.left, v.front, v.right, ...(d.openWall == null ? [v.near] : [])];
  return `<div class="ii-label">냉장고장 · 키큰장 자리 <small>그 벽을 마주 봤을 때</small></div>
    <div class="ii-row"><label>벽<select data-fw>${walls.map((w) => `<option value="${w}"${w === fr.wall ? ' selected' : ''}>${wallName(d.openWall, w)}</option>`).join('')}</select></label>
    <label>끝<span class="ii-seg"><button data-fe="start" class="${end === 'start' ? 'on' : ''}">왼쪽</button><button data-fe="end" class="${end === 'end' ? 'on' : ''}">오른쪽</button></span></label></div>
    <div class="ii-acts"><button data-fe="auto" class="plain"${d.fridgeAt ? '' : ' disabled'}>자동 자리</button><button data-fridge-off class="plain">냉장고장 빼기</button></div>
    <div class="ii-label">냉장고 종류</div>
    <div class="fk-list">${(['twin', 'sbs', 'quad'] as const).map((k) => { const s = FRIDGE_SPEC[k]; return `<button data-fk="${k}" class="${(d.fridgeKind ?? 'quad') === k ? 'on' : ''}"><b>${s.label}</b><small>폭 ${s.unitW}${s.n > 1 ? ` × ${s.n}대` : ''} · 높이 ${s.h} · 자리 ${s.w}</small></button>`; }).join('')}<button data-fk="builtin" class="${d.fridgeKind === 'builtin' ? 'on' : ''}"><b>빌트인</b><small>원본 T콤비 냉장고장 · 자리 600</small></button></div>
    ${d.fridgeKind !== 'builtin' ? `<div class="ii-label">패널 색 <small>삼성 비스포크</small></div>
    <div class="ii-swap">${FRIDGE_COLORS.map(([k, n, c]) => `<button data-fc="${k}" class="${(d.fridgeColor ?? FRIDGE_COLORS[0][0]) === k ? 'on' : ''}"><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c};border:1px solid #0002;margin-right:4px"></i>${n}</button>`).join('')}</div>` : ''}`;
}
/** 거실 벽 — 맞은편(10) · 양옆(11 시작 쪽 · 12 끝 쪽) · 부엌 쪽 어깨(15 · 16). 고르면 그 벽 길이를 바꾼다 */
function pickLivingWall(id: number) {
  if (d.openWall == null) return;
  pick(null);
  selectedOp = null; plan.selected = null; stage.setDims(null);
  plan.pickedWall = id as WallId; plan.render(d, current);
  const obj = stage.room?.walls.find((x) => x.obj.children.some((c) => c.userData.wallId === id))?.obj;
  stage.highlight(obj ?? null);
  const lv = livingOf(d), L = wallLength(d.room, d.openWall), vw = viewWalls(d.openWall);
  // 어깨 a(트인 벽 시작 쪽)는 앞 벽(prevWall) 쪽 = 보는 사람 기준 오른쪽, b 는 왼쪽
  const sideName = (s: 'a' | 'b') => (s === 'a' ? wallName(d.openWall, vw.right, true) : wallName(d.openWall, vw.left, true));
  const box = $('#item-info');
  let title = '', note = '', rows = '';
  const num = (k: string, label: string, v: number) => `<label>${label}<input data-lv="${k}" type="number" step="50" value="${Math.round(v)}"></label>`;
  if (id === 10) {
    title = '거실 맞은편 벽'; note = '길이 = 거실 폭 · 늘리고 줄인 만큼 양 어깨가 반씩';
    rows = `<div class="ii-row">${num('w', '길이 (거실 폭)', L + lv.a + lv.b)}<label>두께<input type="number" value="150" disabled></label></div><div class="ii-row">${num('depth', '거실 깊이', lv.depth)}</div>`;
  } else if (id === 11 || id === 12) {
    const s = id === 11 ? 'a' : 'b';
    title = `거실 ${sideName(s)} 벽`; note = '길이 = 거실 깊이';
    rows = `<div class="ii-row">${num('depth', '길이 (거실 깊이)', lv.depth)}<label>두께<input type="number" value="150" disabled></label></div><div class="ii-row">${num(s, '부엌보다 넓게 나간 폭', lv[s])}</div>`;
  } else {
    const s = id === 15 ? 'a' : 'b', wing = d.wing[s];
    title = `거실 ${sideName(s)} 어깨 벽`; note = '부엌과 거실이 만나는 벽 — 부엌과 이어진 통로는 벽 없이 트여 있습니다';
    rows = `<div class="ii-row">${num(`sh${s}`, '길이', lv[s] + wing)}<label>두께<input type="number" value="150" disabled></label></div>
      <div class="ii-row">${num(s, '부엌 밖으로 나간 폭', lv[s])}${num(`wing${s}`, '통로 쪽 날개벽', wing)}</div>`;
  }
  box.innerHTML = `<div class="ii-head"><b>${title}</b><button title="닫기">×</button></div><div class="ii-model">${note} · 통로 폭 ${Math.max(0, L - d.wing.a - d.wing.b)}</div>${id === 11 || id === 12 ? joinedNote(id) : ''}${rows}`;
  box.hidden = false;
  box.querySelector('button')!.addEventListener('click', () => { box.hidden = true; stage.highlight(null); plan.pickedWall = null; plan.render(d, current); });
  box.querySelectorAll<HTMLInputElement>('[data-lv]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.lv!, v = Math.round(Number(inp.value) || 0);
    const nl = livingOf(d), side = (x: number) => Math.max(LIVING_LIMITS.side[0], Math.min(LIVING_LIMITS.side[1], Math.round(x)));
    if (k === 'depth') nl.depth = Math.max(LIVING_LIMITS.depth[0], Math.min(LIVING_LIMITS.depth[1], v));
    else if (k === 'w') { const extra = v - (L + nl.a + nl.b); nl.a = side(nl.a + extra / 2); nl.b = side(nl.b + extra / 2); }
    else if (k === 'a' || k === 'b') nl[k] = side(v);
    else if (k === 'sha' || k === 'shb') { const s = k === 'sha' ? 'a' : 'b'; nl[s] = side(v - d.wing[s]); }
    else if (k === 'winga' || k === 'wingb') { const s = k === 'winga' ? 'a' : 'b'; d.wing[s] = Math.max(0, Math.min(Math.floor(L / 2), v)); }
    d.living = nl;
    changed({ room: true, plan: true }); pickLivingWall(id);
  }));
}
/* 방 크기 — 늘어나는 쪽: end = 좌표 큰 쪽 벽(오른쪽 x · 앞 z)이 움직임, start = 0 쪽 벽이 움직임(안의 것을 그만큼 밀어 둠), both = 반씩 */
type Grow = 'start' | 'end' | 'both';
function resizeRoom(axis: 'w' | 'd', delta: number, grow: Grow) {
  const nv = Math.max(1800, Math.min(9000, Math.round((d.room[axis] + delta) / 10) * 10));
  delta = nv - d.room[axis];
  if (!delta) return;
  const s = grow === 'end' ? 0 : grow === 'start' ? delta : Math.round(delta / 20) * 10;
  d.room[axis] = nv;
  // 벽 따라 잰 자리 — 그 축을 따라 가는 벽 둘(정방향은 + s, 역방향은 + delta - s)
  const [fw, bw] = axis === 'w' ? [0, 2] : [1, 3];
  const shiftT = (wall: WallId, t: number) => (wall === fw ? t + s : wall === bw ? t + delta - s : t);
  // 거실 맞은편 벽(10)은 트인 벽과 같은 방향 — 트인 벽만큼 민다. 거실 옆 벽(11 · 12)은 깊이 방향이라 그대로
  const shiftAny = (wall: AnyWall, t: number) => (isKitchenWall(wall) ? shiftT(wall, t) : wall === 10 && d.openWall != null ? shiftT(d.openWall, t) : t);
  for (const o of d.openings) { o.t = shiftAny(o.wall, o.t); clampOpening(o, d); }
  if (d.fix) for (const k of Object.keys(d.fix) as FixKey[]) { const f = d.fix[k]!; if (!f.island) f.c = shiftT(f.wall, f.c); }
  if (d.islandCfg.pos && s) d.islandCfg.pos = { ...d.islandCfg.pos, [axis === 'w' ? 'x' : 'z']: d.islandCfg.pos[axis === 'w' ? 'x' : 'z'] + s };
  syncRoomInputs();
  renderOpenings();
}
/** 벽 메뉴의 「늘어나는 쪽」 — 그 벽을 마주 봤을 때 왼쪽(벽 시작) · 양쪽 · 오른쪽(벽 끝) */
let growSide: 'start' | 'end' | 'both' = 'end';
const growOf = (w: WallId, side: typeof growSide): Grow => (side === 'both' ? 'both' : (w === 2 || w === 3) !== (side === 'start') ? 'start' : 'end');
/** 고른 벽의 화살표 — 벽 양 끝(안쪽 면 앞 200)에서 벽을 따라 바깥쪽. 끌면 그 끝이 늘고 줄어든다.
 *  부엌 벽 = 방 크기(그 끝 쪽 옆 벽이 움직임) · 거실 맞은편 = 양 어깨 · 거실 옆벽 = 깊이 · 어깨 벽 = 어깨 · 통로 쪽 날개벽 */
let arrowWall: number | null = null;
type WallArrow = { p: [number, number]; dir: [number, number]; apply: (delta: number) => void };
function wallArrowsOf(id: number): WallArrow[] {
  const side = (x: number) => Math.max(LIVING_LIMITS.side[0], Math.min(LIVING_LIMITS.side[1], Math.round(x / 10) * 10));
  const lv = () => livingOf(d);
  if (id <= 3) {
    const w = id as WallId, f = wallFrame(d.room, w), L = wallLength(d.room, w), ax = w % 2 === 0 ? 'w' : 'd';
    const at = (t: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * 200, f.o[1] + f.dir[1] * t + f.n[1] * 200];
    return [
      { p: at(Math.min(500, L / 4)), dir: [-f.dir[0], -f.dir[1]], apply: (dd) => resizeRoom(ax, dd, growOf(w, 'start')) },
      { p: at(L - Math.min(500, L / 4)), dir: [f.dir[0], f.dir[1]], apply: (dd) => resizeRoom(ax, dd, growOf(w, 'end')) },
    ];
  }
  if (d.openWall == null) return [];
  const f = wallFrame(d.room, d.openWall), L = wallLength(d.room, d.openWall), l = lv(), T = 150;
  const Q = (t: number, u: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
  const fd: [number, number] = [f.dir[0], f.dir[1]], nd: [number, number] = [-f.dir[0], -f.dir[1]], deeper: [number, number] = [-f.n[0], -f.n[1]];
  const setL = (k: 'a' | 'b' | 'depth', v: number) => { const nl = lv(); nl[k] = k === 'depth' ? Math.max(LIVING_LIMITS.depth[0], Math.min(LIVING_LIMITS.depth[1], v)) : side(v); d.living = nl; };
  const farU = -T - l.depth + 200;
  if (id === 10) return [
    { p: Q(-l.a + 500, farU), dir: nd, apply: (dd) => setL('a', l.a + dd) },
    { p: Q(L + l.b - 500, farU), dir: fd, apply: (dd) => setL('b', l.b + dd) },
  ];
  if (id === 11) return [{ p: Q(-l.a + 200, -T - l.depth + 500), dir: deeper, apply: (dd) => setL('depth', l.depth + dd) }];
  if (id === 12) return [{ p: Q(L + l.b - 200, -T - l.depth + 500), dir: deeper, apply: (dd) => setL('depth', l.depth + dd) }];
  const wing = (k: 'a' | 'b', v: number) => { d.wing[k] = Math.max(0, Math.min(Math.floor(L / 2), Math.round(v / 10) * 10)); };
  if (id === 15) return [
    { p: Q(-l.a + 400, -T - 200), dir: nd, apply: (dd) => setL('a', l.a + dd) },
    { p: Q(Math.max(d.wing.a - 400, -l.a + 900), -T - 200), dir: fd, apply: (dd) => wing('a', d.wing.a + dd) },
  ];
  if (id === 16) return [
    { p: Q(L + l.b - 400, -T - 200), dir: fd, apply: (dd) => setL('b', l.b + dd) },
    { p: Q(Math.min(L - d.wing.b + 400, L + l.b - 900), -T - 200), dir: nd, apply: (dd) => wing('b', d.wing.b + dd) },
  ];
  return [];
}
function showWallArrow(id: number | null) {
  arrowWall = id;
  const list = id == null ? [] : wallArrowsOf(id);
  stage.setWallArrows(list.map((a) => ({ p: a.p, dir: a.dir, y: Math.min(1250, d.room.h - 300) })));
}
/** 화살표 끌기 — 끄는 동안 길이만 보여 주고, 놓으면 바꿔 다시 그린다 */
function dragWallArrow(i: number, delta: number, done: boolean) {
  const id = arrowWall; if (id == null) return;
  if (id === -1) {
    // 끝면 뽑아내기
    if (!done) { say(`${delta > 0 ? '+' : ''}${delta}mm`); return; }
    say(null);
    if (delta && endArrow) { endArrow.apply(delta); changed({ room: true, plan: true }); }
    showWallArrow(null); stage.highlight(null); $('#item-info').hidden = true;
    return;
  }
  const a = wallArrowsOf(id)[i]; if (!a) return;
  if (!done) { say(`${delta > 0 ? '+' : ''}${delta}mm`); return; }
  say(null);
  if (!delta) return;
  a.apply(delta);
  changed({ room: true, plan: true });
  pickWall(id);
}
stage.onDragWallArrow = dragWallArrow;
/** 벽 두께 면(끝면) — 고르면 그 면만 파랗게, 화살표 하나로 뽑아내기(벽이 그 방향으로 늘어남). 지금은 트인 쪽 날개벽 · 어깨 벽 끝 */
let endArrow: WallArrow | null = null;
function pickWallEnd(id: number, p: [number, number]) {
  if (d.openWall == null || (id !== 15 && id !== 16)) { pickWall(id); return; }
  const f = wallFrame(d.room, d.openWall), L = wallLength(d.room, d.openWall), T = 150, l = livingOf(d);
  const t = (p[0] - f.o[0]) * f.dir[0] + (p[1] - f.o[1]) * f.dir[1];
  const k = id === 15 ? 'a' : 'b';
  // 어느 끝면인가 — 통로 쪽(날개벽 끝) 또는 바깥 끝(어깨 끝)
  const inner = id === 15 ? d.wing.a : L - d.wing.b, outer = id === 15 ? -l.a : L + l.b;
  const atInner = Math.abs(t - inner) < Math.abs(t - outer);
  const sgn = (id === 15) === atInner ? 1 : -1;   // 뽑아내는 방향 (+f.dir 또는 -f.dir)
  const ft = atInner ? inner : outer;
  const Q = (tt: number, u: number): [number, number] => [f.o[0] + f.dir[0] * tt + f.n[0] * u, f.o[1] + f.dir[1] * tt + f.n[1] * u];
  pick(null);
  plan.pickedWall = id as WallId; plan.render(d, current);
  // 끝면 표시 — 두께 150 × 높이
  const c = Q(ft, -T / 2);
  stage.highlight(new THREE.Box3(new THREE.Vector3(c[0] / 1000 - 0.08, 0, c[1] / 1000 - 0.08), new THREE.Vector3(c[0] / 1000 + 0.08, d.room.h / 1000, c[1] / 1000 + 0.08)));
  endArrow = { p: Q(ft + sgn * 60, -T / 2), dir: [f.dir[0] * sgn, f.dir[1] * sgn], apply: (dd) => {
    if (atInner) d.wing[k] = Math.max(0, Math.min(Math.floor(L / 2), Math.round((d.wing[k] + dd) / 10) * 10));
    else { const nl = livingOf(d); nl[k] = Math.max(LIVING_LIMITS.side[0], Math.min(LIVING_LIMITS.side[1], Math.round((nl[k] + dd) / 10) * 10)); d.living = nl; }
  } };
  arrowWall = -1;
  stage.setWallArrows([{ p: endArrow.p, dir: endArrow.dir, y: Math.min(1250, d.room.h - 300) }]);
  const box = $('#item-info');
  const cur = atInner ? d.wing[k] : l[k];
  box.innerHTML = `<div class="ii-head"><b>${atInner ? '통로 쪽 날개벽 끝면' : '거실 어깨 벽 끝면'}</b><button title="닫기">×</button></div>
    <div class="ii-model">두께 150 면 · 화살표를 끌어 면을 뽑아내면 벽이 그만큼 늘어납니다</div>
    <div class="ii-row"><label>${atInner ? '날개벽 길이' : '부엌 밖으로 나간 폭'}<input data-ex type="number" step="10" value="${cur}"></label><label>두께<input type="number" value="150" disabled></label></div>`;
  box.hidden = false;
  box.querySelector('button')!.addEventListener('click', () => { box.hidden = true; stage.highlight(null); showWallArrow(null); });
  box.querySelector<HTMLInputElement>('[data-ex]')!.addEventListener('change', (e) => {
    endArrow!.apply(Math.round(Number((e.target as HTMLInputElement).value) || 0) - cur);
    changed({ room: true, plan: true }); pickWallEnd(id, p);
  });
}
stage.onPickWallEnd = pickWallEnd;
/* 벽 마감 — 상판 ~ 상부장 사이 벽. 3D 에서 누르면 타일 · 벽판넬과 치수(길이 · 두께 · 높이 · 배치 높이 · 시작 위치) */
function pickSplash(w: number) {
  if (!current) return;
  const wall = w as WallId;
  pick(null);
  const segs = current.splashes.filter((s) => current!.items.some((it) => it.frame === s.frame && it.wall === wall));
  if (!segs.length) return;
  const a0 = Math.min(...segs.map((s) => s.t0)), a1 = Math.max(...segs.map((s) => s.t1));
  const cfg: SplashCfg = { kind: 'tile', ...(d.splash?.[wall] ?? {}) };
  const panel = cfg.kind === 'panel';
  const v = { t0: cfg.t0 ?? a0, len: cfg.len ?? a1 - (cfg.t0 ?? a0), depth: cfg.depth ?? (panel ? SPLASH_DEFAULT.panelDepth : SPLASH_DEFAULT.tileDepth), h: cfg.h ?? SPLASH_DEFAULT.h, y: cfg.y ?? 910 };
  const pmat = cfg.mat ?? d.counter;
  const sg = stage.kitchen?.getObjectByName('splash')?.children.find((o) => o.userData.wall === wall);
  stage.highlight(sg ?? null);
  const box = $('#item-info');
  const inp = (k: keyof typeof v, label: string, dis = false) => `<label>${label}<input data-sp="${k}" type="number" step="${k === 'depth' ? 1 : 10}" value="${Math.round(v[k])}"${dis ? ' disabled' : ''}></label>`;
  box.innerHTML = `
    <div class="ii-head"><b>벽 마감 · ${wallName(d.openWall, wall)}</b><button title="닫기">×</button></div>
    <div class="ii-model">상판 위 ~ 상부장 아래 벽 · 자동 구간 ${Math.round(a0)}~${Math.round(a1)} · 시작 위치 · 길이를 넣으면 벽 안에서 그 구간 그대로(줄눈도 거기서 시작)</div>
    <div class="ii-seg"><button data-spk="tile" class="${!panel ? 'on' : ''}">타일</button><button data-spk="panel" class="${panel ? 'on' : ''}">벽판넬</button></div>
    ${panel ? `<div class="ii-label">벽판넬 재질 <small>상판 재질 — 카탈로그 세라믹 벽판넬 6T</small></div>
    <div class="ii-swap">${cat.counters.map((x) => `<button data-spm="${x.id}" class="${x.id === pmat ? 'on' : ''}">${x.name}</button>`).join('')}</div>` : ''}
    <div class="ii-row">${inp('t0', '시작 위치 (벽 시작에서)')}${inp('len', '길이')}</div>
    <div class="ii-row">${inp('h', '높이')}${inp('y', '배치 높이 (바닥에서)')}</div>
    <div class="ii-row">${inp('depth', '두께', !panel)}<label>&nbsp;<button data-spr class="plain">자동으로</button></label></div>
    <div class="ii-note">${panel ? '벽판넬은 벽에 붙인 판 — 창 자리는 창 몰딩 아래까지' : '타일 두께는 표현만(벽에 붙임)'} · 자동 = 상판 줄 길이 · 높이 620 · 상판 위</div>`;
  box.hidden = false;
  const apply = (next: SplashCfg | null) => {
    const all = { ...(d.splash ?? {}) };
    if (next) all[wall] = next; else delete all[wall];
    d.splash = all; saveDesign(d);
    stage.setSplash(buildSplashes(current!, d, cat));
    pickSplash(wall);
  };
  box.querySelector('button')!.addEventListener('click', () => { box.hidden = true; stage.highlight(null); });
  box.querySelectorAll<HTMLElement>('[data-spk]').forEach((b) => b.addEventListener('click', () => apply({ ...cfg, kind: b.dataset.spk as SplashCfg['kind'] })));
  box.querySelectorAll<HTMLElement>('[data-spm]').forEach((b) => b.addEventListener('click', () => apply({ ...cfg, mat: b.dataset.spm })));
  box.querySelector('[data-spr]')?.addEventListener('click', () => apply(null));
  box.querySelectorAll<HTMLInputElement>('[data-sp]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.sp as keyof typeof v, n = Math.round(Number(el.value));
    const next: SplashCfg = { ...cfg };
    if (!Number.isFinite(n) || el.value === '') delete next[k];
    else if (k === 'depth') next.depth = Math.max(1, Math.min(30, n));
    else if (k === 'h') next.h = Math.max(50, Math.min(d.room.h, n));
    else if (k === 'y') next.y = Math.max(0, Math.min(d.room.h - 50, n));
    else if (k === 'len') { next.len = Math.max(50, n); next.t0 = v.t0; }
    else next.t0 = Math.max(0, n);
    apply(next);
  }));
}
/** 한 줄로 이어진 벽 안내 — 거실 어깨 폭이 0 이면 부엌 옆 벽 · 문턱 두께 · 거실 옆 벽이 한 벽(사용자 2026-11-10 「두께까지 합쳐서 벽 길이를 측정」).
 *  어깨가 있으면 부엌 옆 벽 길이에 트인 쪽 끝 거실 어깨 벽 두께(같은 날 「부엌 벽 길이를 거실 왼쪽, 오른쪽 벽 두께도 포함해줘」) */
function joinedNote(w: AnyWall): string {
  const run = wallRun(d, w);
  if (run.band) return `<div class="ii-model">벽 길이 <b>${run.L.toLocaleString('ko-KR')}</b> (부엌 쪽 ${(run.L - run.band).toLocaleString('ko-KR')} + 트인 쪽 끝 거실 어깨 벽 두께 ${run.band})</div>`;
  if (run.parts.length < 2) return '';
  const parts = run.parts.map((x) => `${anyWallName(d, x)} ${wallLine(d, x)!.L.toLocaleString('ko-KR')}`).join(' + 문턱 두께 150 + ');
  return `<div class="ii-model">한 줄로 이어진 벽 — 전체 <b>${run.L.toLocaleString('ko-KR')}</b> (${parts})</div>`;
}
function pickWall(w: number) {
  if (w > 3) { pickLivingWall(w); showWallArrow(w); return; }
  const wall = w as WallId;
  pick(null);
  selectedOp = null; plan.selected = null; stage.setDims(null);
  plan.pickedWall = wall; plan.render(d, current);
  const obj = stage.room?.walls.find((x) => x.wall === wall)?.obj;
  stage.highlight(obj ?? null);
  const box = $('#item-info');
  const key = wall % 2 === 0 ? 'w' : 'd';
  const isOpen = wall === d.openWall;
  box.innerHTML = `
    <div class="ii-head"><b>${wallName(d.openWall, wall)}${isOpen ? ' (트임)' : ''}</b><button title="닫기">×</button></div>
    <div class="ii-model">벽 두께 150 · 3D 의 양 끝 파란 화살표를 끌어 그 끝 쪽으로 늘리고 줄일 수 있습니다</div>
    ${joinedNote(wall)}
    <div class="ii-row"><label>길이${isOpen ? '' : wallRun(d, wall).parts.length > 1 || wallRun(d, wall).band ? ' (부엌 쪽)' : ''}<input data-wf="len" type="number" step="10" value="${d.room[key]}"></label><label>두께<input type="number" value="150" disabled></label></div>
    <div class="ii-label">길이를 바꾸면 늘어나는 쪽 <small>이 벽을 마주 봤을 때</small></div>
    <div class="ii-seg"><button data-grow="start" class="${growSide === 'start' ? 'on' : ''}">왼쪽 끝</button><button data-grow="both" class="${growSide === 'both' ? 'on' : ''}">양쪽</button><button data-grow="end" class="${growSide === 'end' ? 'on' : ''}">오른쪽 끝</button></div>
    ${isOpen ? `<div class="ii-row"><label>날개벽 · 시작 쪽<input data-wf="a" type="number" step="10" min="0" value="${d.wing.a}"></label><label>날개벽 · 끝 쪽<input data-wf="b" type="number" step="10" min="0" value="${d.wing.b}"></label></div>
    <div class="ii-note">부엌과 거실 사이에 남기는 벽 — 600 이상이면 그쪽 장 끝은 EP 대신 벽에 붙습니다</div>` : ''}`;
  box.hidden = false;
  showWallArrow(wall);
  box.querySelector('button')!.addEventListener('click', () => { box.hidden = true; stage.highlight(null); showWallArrow(null); plan.pickedWall = null; plan.render(d, current); });
  box.querySelectorAll<HTMLElement>('[data-grow]').forEach((b) => b.addEventListener('click', () => { growSide = b.dataset.grow as typeof growSide; pickWall(wall); }));
  box.querySelectorAll<HTMLInputElement>('[data-wf]').forEach((inp) => inp.addEventListener('change', () => {
    const v = Math.round(Number(inp.value) || 0);
    if (inp.dataset.wf === 'len') {
      resizeRoom(key, v - d.room[key], growOf(wall, growSide));
    } else {
      const L = wallLength(d.room, wall);
      d.wing[inp.dataset.wf as 'a' | 'b'] = Math.max(0, Math.min(Math.floor(L / 2), v));
    }
    changed({ room: true, plan: true }); aim(); pickWall(wall);
  }));
}
stage.onPickWall = pickWall;
stage.onPickSplash = pickSplash;
plan.onPickWall = (w) => pickWall(w);
stage.onPickItem = (it) => pick((it as Item) ?? null);
plan.onPickItem = (it) => pick(it);

/* ───────── 화면 도구 ───────── */
// 시점 — 위에서 · 정면. 켜진 시점을 다시 누르면 기본 3D 시점(예전 「3D」 단추 자리는 2D · 3D 전환이 됐다)
document.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.addEventListener('click', () => {
  const kind = (b.classList.contains('on') ? 'persp' : b.dataset.view) as ViewKind;
  document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.view === kind));
  stage.view(kind, d);
}));
// 문 열기 — 여닫이 · 플랩 · 서랍 · 식세 전부 (다시 누르면 닫힘). 다시 만들어도 열린 상태 유지
let doorsT = 0, doorsTo = 0, doorsAt = 0;
function animDoors(now: number) {
  const dt = Math.min(0.1, (now - doorsAt) / 1000); doorsAt = now;
  doorsT = doorsTo > doorsT ? Math.min(doorsTo, doorsT + dt / 0.6) : Math.max(doorsTo, doorsT - dt / 0.6);
  const e = doorsT * doorsT * (3 - 2 * doorsT);
  if (lastKitchen) setDoors(lastKitchen.doors, e);
  stage.invalidate(true);
  if (doorsT !== doorsTo) requestAnimationFrame(animDoors);
}
$('#t-doors').addEventListener('click', () => {
  doorsTo = doorsTo ? 0 : 1;
  $('#t-doors').classList.toggle('on', !!doorsTo);
  $('#t-doors').dataset.tip = doorsTo ? '문 닫기' : '문 열기';
  doorsAt = performance.now(); requestAnimationFrame(animDoors);
});
// 보기 · 실사 · 조명 · 후처리 · 성능 — 붙박이장 플래너와 같은 메뉴
const lookPop = $('#look-pop'), renderPop = $('#render-pop'), sunPanel = $('#sun-panel'), postPanel = $('#post-panel'), perfPop = $('#perf-pop'), mepPop = $('#mep-pop');
const togglePop = (p: HTMLElement) => { const show = p.hidden; for (const x of [lookPop, renderPop, sunPanel, postPanel, perfPop, mepPop]) x.hidden = true; p.hidden = !show; if (show && p === postPanel) renderPost(); if (show && p === sunPanel) syncSliders(); };
// 메뉴 단추는 그 메뉴 창이 열려 있거나 기본이 아닌 상태(재질+라인 · 실사 방식)가 켜져 있을 때만 검게 — 뭘 골랐는지 보이게(사용자 지시 2026-11-06).
// 창은 여러 곳에서 열고 닫으므로 hidden 속성을 지켜본다
const MENUS: [HTMLElement, HTMLElement][] = [[$('#t-look'), lookPop], [$('#t-path'), renderPop], [$('#t-sun'), sunPanel], [$('#t-post'), postPanel], [$('#t-perf'), perfPop], [$('#t-mep'), mepPop]];
const menuOn = new Map<HTMLElement, boolean>();
const paintMenus = () => { for (const [b, p] of MENUS) b.classList.toggle('on', !p.hidden || !!menuOn.get(b)); };
const setMenuOn = (b: HTMLElement, on: boolean) => { menuOn.set(b, on); paintMenus(); };
{ const mo = new MutationObserver(paintMenus); for (const [, p] of MENUS) mo.observe(p, { attributes: true, attributeFilter: ['hidden'] }); }
$('#t-sun').addEventListener('click', () => togglePop(sunPanel));
// 실내 조명 — 천장 조명 구성(기본 없음 = 설치 전) · 세기 · 색온도 · 빛 색. 「없음」이면 나머지 칸을 숨긴다
const ceilSel = $<HTMLSelectElement>('#ceil-sel');
CEILING_LIGHTS.forEach(([v, t]) => ceilSel.append(new Option(t, v)));
const syncLampRows = () => { ceilSel.value = stage.roomCfg.ceiling; document.querySelectorAll<HTMLElement>('#sun-panel .lamp-row').forEach((x) => (x.hidden = stage.roomCfg.ceiling === 'none')); };
ceilSel.addEventListener('change', () => { stage.setRoomLight({ ceiling: ceilSel.value as CeilingLight }); syncLampRows(); syncSliders(); });
// 빛 색 — 자주 쓰는 색 칩 + 직접 고르기. 색온도와 곱해진다(흰색 = 색온도 그대로, 붙박이장 플래너와 같음)
const LAMP_COLORS: [string, string][] = [['#ffffff', '흰색(색온도대로)'], ['#ffe2b8', '웜 앰버'], ['#ffd0d6', '로즈'], ['#d7e8ff', '쿨 블루'], ['#d9f2df', '민트'], ['#e6d9ff', '라벤더']];
const lampColIn = $<HTMLInputElement>('#lamp-col'), lampChips = $('#lamp-colors');
const setLampColor = (c: string) => {
  stage.setRoomLight({ lampColor: c }); lampColIn.value = c;
  lampChips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLButtonElement).dataset.c === c));
};
for (const [c, name] of LAMP_COLORS) {
  const b = document.createElement('button'); b.type = 'button'; b.dataset.c = c; b.title = name; b.style.background = c;
  b.addEventListener('click', () => setLampColor(c)); lampChips.append(b);
}
lampColIn.addEventListener('input', () => setLampColor(lampColIn.value));
lampChips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLButtonElement).dataset.c === stage.roomCfg.lampColor));
lampColIn.value = stage.roomCfg.lampColor ?? '#ffffff';
syncLampRows();
$('#t-post').addEventListener('click', () => togglePop(postPanel));
// 조명 슬라이더 — 옆 칸에 숫자로 직접 넣을 수도 있다(붙박이장 플래너와 같음)
type Slider = { id: string; get: () => number; set: (v: number) => void };
const sliders: Slider[] = [
  { id: '#sun-az', get: () => stage.sunCfg.azimuth, set: (v) => stage.setSun({ azimuth: v }) },
  { id: '#sun-el', get: () => stage.sunCfg.elevation, set: (v) => stage.setSun({ elevation: v }) },
  { id: '#sun-in', get: () => stage.sunCfg.intensity, set: (v) => stage.setSun({ intensity: v }) },
  { id: '#sun-k', get: () => stage.sunCfg.kelvin, set: (v) => stage.setSun({ kelvin: v }) },
  { id: '#sky', get: () => stage.roomCfg.sky, set: (v) => stage.setRoomLight({ sky: v }) },
  { id: '#sh-str', get: () => stage.shadowCfg.strength, set: (v) => stage.setShadow({ strength: v }) },
  { id: '#sh-soft', get: () => stage.shadowCfg.soft, set: (v) => stage.setShadow({ soft: v }) },
  { id: '#lamp', get: () => stage.roomCfg.lamp, set: (v) => stage.setRoomLight({ lamp: v }) },
  { id: '#kelvin', get: () => stage.roomCfg.kelvin, set: (v) => stage.setRoomLight({ kelvin: v }) },
  { id: '#envi', get: () => stage.roomCfg.env, set: (v) => stage.setRoomLight({ env: v }) },
  { id: '#expo', get: () => stage.roomCfg.exposure, set: (v) => stage.setRoomLight({ exposure: v }) },
];
const stepFmt = (r: HTMLInputElement, v: number) => v.toFixed((r.step.split('.')[1] ?? '').length);
function bindNum(r: HTMLInputElement, box: HTMLInputElement, apply: (v: number) => void) {
  Object.assign(box, { min: r.min, max: r.max, step: r.step });
  box.title = `${r.min} ~ ${r.max} — 직접 입력`;
  box.onchange = () => {
    let v = +box.value;
    if (!Number.isFinite(v)) { box.value = stepFmt(r, +r.value); return; }
    v = Math.min(+r.max, Math.max(+r.min, v));
    r.value = String(v); box.value = stepFmt(r, v); apply(v);
  };
  box.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') box.blur(); };
}
function syncSliders() { for (const sl of sliders) { const r = $<HTMLInputElement>(sl.id); r.value = String(sl.get()); $<HTMLInputElement>(sl.id + '-v').value = stepFmt(r, sl.get()); } }
for (const sl of sliders) {
  const r = $<HTMLInputElement>(sl.id), box = $<HTMLInputElement>(sl.id + '-v');
  r.addEventListener('input', () => { sl.set(+r.value); box.value = stepFmt(r, +r.value); });
  bindNum(r, box, (v) => sl.set(v));
}
$('#sun-auto').addEventListener('click', () => { stage.resetSunAuto(); rebuildRoom(); syncSliders(); });
// 시간대 — 해 높이 · 세기 · 색과 실내 조명을 함께. 방위는 창 바깥 쪽 기준에서 돌린다(부엌마다 창 방향이 달라서)
const PRESETS: Record<string, { sun: Partial<Sun> & { turn?: number }; room: Partial<RoomLight> }> = {
  // 붙박이장 플래너 프리셋 값 그대로(방위는 부엌 창 바깥 쪽 기준에서 같은 만큼 돌린다). 실내 조명 세기는 「천장 조명」을 골랐을 때만 보인다
  bright: { sun: { turn: 0, elevation: 42, intensity: 3, kelvin: 5200 }, room: { lamp: 0.3, sky: 1.8, env: 1.0, exposure: 1.05 } },
  morning: { sun: { turn: -50, elevation: 18, intensity: 3.0, kelvin: 4300 }, room: { lamp: 0.4, sky: 1.6, env: 1.1, exposure: 1.2 } },
  noon: { sun: { turn: -10, elevation: 55, intensity: 4.2, kelvin: 5800 }, room: { lamp: 0.25, sky: 2.4, env: 1.2, exposure: 1.2 } },
  afternoon: { sun: { turn: 22, elevation: 26, intensity: 3.6, kelvin: 4800 }, room: { lamp: 0.6, sky: 1.2, env: 1, exposure: 1.1 } },
  sunset: { sun: { turn: 60, elevation: 7, intensity: 2.2, kelvin: 3000 }, room: { lamp: 1.0, sky: 0.5, env: 1, exposure: 1.1 } },
  night: { sun: { intensity: 0 }, room: { lamp: 1.5, sky: 0, env: 1, exposure: 1.1 } },
};
document.querySelectorAll<HTMLElement>('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  const p = PRESETS[b.dataset.preset!];
  if (p.sun.turn != null) { stage.resetSunAuto(); rebuildRoom(); }
  const { turn, ...sun } = p.sun;
  // 시간대 방위 = 창 바깥 쪽 자동 방위 + 그 시간대 돌림(기본 해 방위의 SUN_TURN 과 따로)
  stage.setSun({ ...sun, ...(turn != null ? { azimuth: stage.sunAuto + turn } : {}) });
  stage.setRoomLight(p.room); syncSliders();
}));
// 후처리 — 실시간 화면에만. 바꾸는 즉시 반영하고 이 브라우저에 기억한다(붙박이장 플래너와 같은 항목 중 부엌에 해당하는 것)
type PostCtl =
  | { kind: 'range'; key: keyof PostSettings; label: string; min: number; max: number; step: number }
  | { kind: 'check'; key: keyof PostSettings; label: string }
  | { kind: 'select'; key: keyof PostSettings; label: string; options: [string, string][] }
  | { kind: 'grp'; label: string; note?: string };
const POST_CTLS: PostCtl[] = [
  { kind: 'grp', label: '간접광 · AO', note: '화면 공간(SSGI)' },
  { kind: 'check', key: 'ssgi', label: '켜기' },
  { kind: 'select', key: 'aoKind', label: '방식', options: [['both', '간접광 SSGI + AO GTAO (기본)'], ['ssgi', 'SSGI — 간접광 + AO (모서리 그늘이 넓게 짐)'], ['gtao', 'GTAO — AO 만 (노이즈 적음)']] },
  { kind: 'range', key: 'aoRadius', label: 'GTAO 반경', min: 0.05, max: 2, step: 0.05 },
  { kind: 'select', key: 'quality', label: '품질', options: [['low', '낮음 (빠름)'], ['mid', '보통'], ['high', '높음 (느림)']] },
  { kind: 'select', key: 'giRes', label: '해상도', options: [['half', '절반 (빠름)'], ['full', '전체 (느림)']] },
  { kind: 'range', key: 'gi', label: '간접광', min: 0, max: 20, step: 0.5 },
  { kind: 'range', key: 'ao', label: 'AO', min: 0, max: 3, step: 0.05 },
  { kind: 'range', key: 'radius', label: '반경', min: 0.2, max: 5, step: 0.1 },
  { kind: 'range', key: 'thickness', label: '두께', min: 0.05, max: 3, step: 0.05 },
  { kind: 'select', key: 'giSpace', label: '샘플링', options: [['world', '월드 (고르게 퍼짐)'], ['screen', '화면 (가까운 곳 자세히 · 모서리 번짐)']] },
  { kind: 'range', key: 'giOcc', label: '모서리 누르기', min: 0, max: 1, step: 0.05 },
  { kind: 'check', key: 'denoise', label: '노이즈 제거 (자글거림)' },
  { kind: 'grp', label: '라이트맵 · 그늘', note: '미리 구운 빛과 그늘 — 창 · 트인 곳으로 드는 하늘빛 · 한 번 튄 빛' },
  { kind: 'check', key: 'spaceAO', label: '공간 라이트맵 (창 하늘빛 · 한 번 튄 빛)' },
  { kind: 'range', key: 'spaceLMStr', label: '공간 세기', min: 0, max: 2, step: 0.05 },
  { kind: 'check', key: 'spaceKeepAO', label: '공간 라이트맵 위에도 화면 AO' },
  { kind: 'range', key: 'depthFx', label: '공간감 (창에서 멀수록 어둡게)', min: 0, max: 1, step: 0.05 },
  { kind: 'grp', label: '안티앨리어싱', note: 'TRAA — 끄면 간접광 노이즈가 남는다' },
  { kind: 'check', key: 'traa', label: '켜기' },
  { kind: 'grp', label: '톤 · 색' },
  { kind: 'select', key: 'toneMapping', label: '톤매핑', options: [['agx', 'AgX (실사와 같음)'], ['neutral', 'Neutral'], ['aces', 'ACES']] },
  { kind: 'range', key: 'exposure', label: '노출 배율', min: 0.3, max: 3, step: 0.05 },
  { kind: 'range', key: 'contrast', label: '대비', min: 0.5, max: 1.5, step: 0.01 },
  { kind: 'range', key: 'saturation', label: '채도', min: 0, max: 2, step: 0.01 },
  { kind: 'range', key: 'vignette', label: '비네팅', min: 0, max: 1, step: 0.01 },
  { kind: 'grp', label: '화면 반사', note: 'SSR — 실사 메뉴 「④ 실시간 고품질」이 함께 켠다(무겁다)' },
  { kind: 'check', key: 'ssr', label: '화면 반사 (SSR)' },
  { kind: 'range', key: 'ssrIntensity', label: '반사 세기', min: 0, max: 2, step: 0.05 },
  { kind: 'grp', label: '바닥 반사', note: '바닥에 방이 거울처럼 비친다 — 비스듬히 볼수록 진하게. 0 이면 끔(방을 한 번 더 그려 무겁다)' },
  { kind: 'range', key: 'floorRefl', label: '세기', min: 0, max: 3, step: 0.05 },
  { kind: 'range', key: 'floorBlur', label: '흐림', min: 0, max: 1, step: 0.05 },
  { kind: 'grp', label: '상판 반사', note: '상판 윗면에 방이 비친다 — 종류마다 다르게(마블이 가장 또렷 · 콘크리트 · 스테인리스는 흐림). 이 값은 배율, 0 이면 끔' },
  { kind: 'range', key: 'counterRefl', label: '배율', min: 0, max: 3, step: 0.05 },
  { kind: 'grp', label: '블룸', note: '밝은 곳 빛 번짐' },
  { kind: 'check', key: 'bloom', label: '켜기' },
  { kind: 'range', key: 'bloomStrength', label: '세기', min: 0, max: 2, step: 0.05 },
  { kind: 'range', key: 'bloomThreshold', label: '문턱', min: 0, max: 3, step: 0.05 },
  { kind: 'range', key: 'bloomRadius', label: '반경', min: 0, max: 1, step: 0.05 },
];
function renderPost() {
  const r = stage.raster, post = r.post as Record<string, unknown>;
  const el = (tag: string, cls = '', html = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  postPanel.innerHTML = '';
  postPanel.append(el('div', 'sun-title', `후처리 <small>실시간 화면 · ${r.kind === 'webgpu' ? 'WebGPU' : 'WebGL (AO·톤만)'}</small>`));
  for (const c of POST_CTLS) {
    if (c.kind === 'grp') { postPanel.append(el('div', 'grp', `${c.label}${c.note ? ` <small>${c.note}</small>` : ''}`)); continue; }
    const on = r.supports.has(c.key);
    const row = el('label', (c.kind === 'check' ? 'chk' : '') + (on ? '' : ' off'));
    row.title = on ? '' : 'WebGPU 화면에서만 — 주소의 ?webgl 을 빼고 열어 주세요';
    row.append(el('span', '', c.label));
    if (c.kind === 'range') {
      const inp = el('input') as HTMLInputElement, out = el('input', 'val') as HTMLInputElement;
      Object.assign(inp, { type: 'range', min: String(c.min), max: String(c.max), step: String(c.step), value: String(post[c.key]), disabled: !on });
      out.type = 'number'; out.disabled = !on; out.value = stepFmt(inp, post[c.key] as number);
      inp.oninput = () => { stage.setPost({ [c.key]: +inp.value }); out.value = stepFmt(inp, +inp.value); };
      bindNum(inp, out, (v) => stage.setPost({ [c.key]: v }));
      row.append(inp, out);
    } else if (c.kind === 'check') {
      const inp = el('input') as HTMLInputElement;
      Object.assign(inp, { type: 'checkbox', checked: !!post[c.key], disabled: !on });
      inp.onchange = () => stage.setPost({ [c.key]: inp.checked });
      row.append(inp);
    } else {
      const sel = el('select') as HTMLSelectElement;
      c.options.forEach(([v, t]) => sel.append(new Option(t, v, false, post[c.key] === v)));
      sel.disabled = !on;
      sel.onchange = () => stage.setPost({ [c.key]: sel.value });
      row.append(sel);
    }
    postPanel.append(row);
  }
  postPanel.append(el('p', 'note', '실사(경로 추적)·굽기·서펠 화면에는 쓰이지 않는다. 노출 배율은 조명 패널의 노출에 곱한다'));
  const reset = el('button', 'reset', '기본값으로');
  reset.addEventListener('click', () => { stage.setPost({ ...POST_DEFAULTS }); renderPost(); });
  postPanel.append(reset);
}
$('#t-look').addEventListener('click', () => togglePop(lookPop));
$('#t-path').addEventListener('click', () => togglePop(renderPop));
// 화면 설정(보기 · 평면도 표시) — 이 브라우저에 저장하고 다음에 열면 그대로
const VIEW_KEY = 'kitchen-planner.view';
const viewCfg: { look?: string; plan?: boolean } = (() => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}'); } catch { return {}; } })();
const saveView = () => { try { localStorage.setItem(VIEW_KEY, JSON.stringify(viewCfg)); } catch { /* 이번 화면엔 반영 */ } };
const setLook = (look: string) => {
  lookPop.querySelectorAll<HTMLElement>('[data-look]').forEach((x) => x.classList.toggle('on', x.dataset.look === look));
  setMenuOn($('#t-look'), look !== 'mat');
  stage.setLines(look === 'line');
};
lookPop.querySelectorAll<HTMLElement>('[data-look]').forEach((b) => b.addEventListener('click', () => {
  setLook(b.dataset.look!); viewCfg.look = b.dataset.look; saveView();
}));
if (viewCfg.look) setLook(viewCfg.look);
renderPop.querySelectorAll<HTMLElement>('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
  const mode = b.dataset.mode as RenderMode;
  renderPop.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  $('#samples').hidden = mode === 'raster' || mode === 'hq'; $('#samples').textContent = '';
  renderPop.hidden = true;
  if (mode !== 'raster') { pick(null); stage.highlight(null); }
  if (mode !== 'raster' && mode !== 'hq') setMep3d([]);   // 실사로 가면 설비 보기 끔(④ 고품질은 실시간)
  await stage.setMode(mode);
}));
stage.onStatus = (t) => { $('#samples').textContent = t; };
// 실사 메뉴 표시 — 지금 실제 방식으로(사용자 지시 2026-11-06 「렌더링모드 표시가 기본모드가 아닌데 계속 기본모드로 표시」).
// 메뉴는 누를 때만 바뀌어서, 저장된 후처리 · 후처리 메뉴 · 성능 단계로 SSR · SSS 가 켜져 있어도 「실시간 (기본)」으로 보였다.
// 실시간에서 SSR · SSS 가 켜져 있으면 ④ 고품질로 본다
const shownMode = (): RenderMode => (stage.mode !== 'raster' ? stage.mode : stage.raster.post.ssr ? 'hq' : 'raster');
const syncRenderMenu = () => {
  const m = shownMode();
  renderPop.querySelectorAll<HTMLElement>('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === m));
  // 실사 단추는 메뉴가 펼쳐졌을 때만 검게(사용자 2026-11-11 「메뉴가 커져야 활성화고 메뉴가 안보이면 비활성화」) — 지금 방식은 메뉴 안 표시로 본다.
  // 예전엔 기본 실시간이 아니면(SSR 이 켜져 ④ 고품질로 보이면) 메뉴를 닫아도 계속 검었다
  $('#samples').hidden = m === 'raster' || m === 'hq';
};
stage.onModeChange = syncRenderMenu;
syncRenderMenu();
// 굽기 · 서펠 결과를 다시 쓸 열쇠 — 설계 · 배치안 · 문 열림
stage.stateKey = () => JSON.stringify([d, current?.id, current?.items.length, doorsTo]);
// 성능 — PC 사양에 맞춘 화질 단계(사용자 지시 2026-11-06). 자동은 그래픽 카드를 보고 고르고, 3D 를 돌릴 때 버벅이면 한 단계씩 낮춘다.
// 올리는 건 사용자가 직접(자동으로 오르내리면 화면이 출렁인다). 고른 단계는 이 브라우저에 저장
const PERF_KEY = 'kitchen-planner.perf';
type PerfPick = 'auto' | Quality;
const perfCfg: { pick?: PerfPick; auto?: Quality; gpu?: string; v?: number } = (() => { try { return JSON.parse(localStorage.getItem(PERF_KEY) ?? '{}'); } catch { return {}; } })();
const savePerf = () => { try { localStorage.setItem(PERF_KEY, JSON.stringify(perfCfg)); } catch { /* 이번 화면엔 반영 */ } };
const perfPick = (): PerfPick => perfCfg.pick ?? 'auto';
const renderPerf = () => {
  perfPop.querySelectorAll<HTMLElement>('[data-perf]').forEach((x) => x.classList.toggle('on', x.dataset.perf === perfPick()));
  $('#perf-auto-sub').textContent = `그래픽 카드로 고르고, 돌릴 때 60프레임이 안 나오면 해상도를 잠깐 낮춤(멈추면 원래대로) · 그래도 버벅이면 한 단계 낮춤${perfPick() === 'auto' ? ` · 지금 「${QUALITY_TIERS[stage.quality].label}」` : ''}`;
  $('#perf-note').textContent = `${perfCfg.gpu ? `그래픽 ${perfCfg.gpu} · ` : ''}단계를 고르면 후처리 값도 그 단계 값으로 바뀝니다`;
};
// 단계 적용 — post: 후처리 값까지(단계를 고를 때). 시작할 때는 후처리를 건드리지 않는다(사용자가 고친 후처리 값이 이미 저장돼 있다)
const applyPerf = (q: Quality, post: boolean) => { stage.setQuality(q, post); renderPerf(); if (post && !postPanel.hidden) renderPost(); };
/** 그래픽 카드로 단계 추정 — NVIDIA · AMD · 애플 · 인텔 Arc · 최신 내장(Xe-LPG)은 고품질, 그 밖 인텔 내장 · 퀄컴은 보통, 휴대폰 칩 · 소프트웨어 · WebGL 은 저사양.
 *  코어 4개 이하 · 메모리 4GB 이하면 한 단계 더 낮춘다(라이트맵 굽기 · 자동 배치가 CPU 몫) */
async function detectQuality(): Promise<Quality> {
  let q: Quality = 'mid';
  if (stage.raster.kind !== 'webgpu') { perfCfg.gpu = 'WebGL'; q = 'low'; }
  else {
    // 렌더러가 실제로 쓰는 카드 — 따로 고성능 카드를 물으면 노트북에서 렌더러는 내장, 판정은 외장으로 어긋날 수 있다
    const own = (stage.renderer as unknown as { backend?: { adapter?: GPUAdapter } }).backend?.adapter;
    const a = own ?? await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
    const i = a?.info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined;
    const s = [i?.vendor, i?.architecture, i?.description].filter(Boolean).join(' ').toLowerCase();
    perfCfg.gpu = s || '알 수 없음';
    // 2026-11-11 「노트북 사양에서 고퀄리티로 60프레임 목표」 — 움직일 때 해상도를 낮춰 60프레임을 맞추므로(scene resSample) 효과는 되도록 고품질로 둔다.
    //   그래도 느리면(최저 해상도에서도) 아래 자동 낮춤이 단계를 내린다. 소프트웨어 렌더러 · 휴대폰 칩만 처음부터 저사양, 오래된 인텔 내장 · 퀄컴은 보통
    if (!a || i?.isFallbackAdapter || /swiftshader|llvmpipe|microsoft basic/.test(s)) q = 'low';
    else if (/nvidia/.test(s)) q = 'high';
    else if (/intel/.test(s)) q = /hpg|\barc\b|xe2?-lpg|xe3/.test(s) ? 'high' : 'mid';
    else if (/mali|powervr|img-tec/.test(s)) q = 'low';
    else if (/qualcomm|\barm\b|adreno/.test(s)) q = 'mid';
    else q = 'high';   // AMD(내장 · 외장) · 애플
  }
  const cores = navigator.hardwareConcurrency || 8, mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if ((cores <= 4 || mem <= 4) && q !== 'low') q = q === 'high' ? 'mid' : 'low';
  return q;
}
{
  const p = perfPick();
  // 판정 기준이 바뀌면(v) 자동 단계는 한 번 다시 고른다 — 예전 기준으로 저사양 · 보통이 된 노트북이 그대로 남지 않게.
  //   그때는 저장된 후처리 값도 새 단계 값으로(예전 단계가 꺼 둔 효과가 남지 않게)
  const PERF_V = 2, old = p === 'auto' && perfCfg.v !== PERF_V ? perfCfg.auto : undefined;
  if (p === 'auto' && perfCfg.v !== PERF_V) { delete perfCfg.auto; perfCfg.v = PERF_V; savePerf(); }
  if (p !== 'auto') applyPerf(p, false);
  else if (perfCfg.auto) applyPerf(perfCfg.auto, false);
  // 처음 — 고른 단계가 고품질(기본값)이 아니면 후처리 값까지 그 단계로
  else void detectQuality().then((q) => { perfCfg.auto = q; savePerf(); applyPerf(q, q !== 'high' || (!!old && old !== q)); });
}
perfPop.querySelectorAll<HTMLElement>('[data-perf]').forEach((b) => b.addEventListener('click', async () => {
  const p = b.dataset.perf as PerfPick;
  perfCfg.pick = p;
  if (p === 'auto') { perfCfg.auto = await detectQuality(); savePerf(); applyPerf(perfCfg.auto, true); }
  else { savePerf(); applyPerf(p, true); }
}));
$('#t-perf').addEventListener('click', () => { renderPerf(); togglePop(perfPop); });
// 자동 — 3D 를 돌리는 동안(60장 넘게 모이면) 한 장 간격 가운데값이 45ms(≈22fps)를 넘으면 한 단계 낮춘다
const perfToast = $('#perf-toast');
let toastTimer = 0;
setInterval(() => {
  if (perfPick() !== 'auto' || stage.mode !== 'raster' || document.hidden || stage.quality === 'low') return;
  const s = stage.frameStats();
  // 낮추는 때 — 한 장 45ms(22프레임)를 넘거나, 해상도를 최저(가로세로 0.5 배)까지 낮췄는데도 평균 21ms(48프레임 아래)면. 60프레임 목표: 해상도 먼저, 그다음 효과
  const atMin = stage.resInfo().motion <= 0.51;
  if (s.n < 60 || !(s.med > 45 || (atMin && s.avg > 21))) return;
  const q: Quality = stage.quality === 'high' ? 'mid' : 'low';
  console.info('[성능] 돌릴 때 느려서 한 단계 낮춤', { 간격_ms: Math.round(s.med), 느린10퍼: Math.round(s.p90), 장수: s.n }, stage.quality, '→', q);
  perfCfg.auto = q; savePerf(); applyPerf(q, true);
  perfToast.textContent = `화면이 버벅여서 성능을 「${QUALITY_TIERS[q].label}」으로 낮췄습니다 · 오른쪽 성능 메뉴에서 바꿀 수 있습니다`;
  perfToast.hidden = false; clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { perfToast.hidden = true; }, 5000);
}, 2000);
$('#t-plan').addEventListener('click', () => { const box = $('#plan-box'); box.hidden = !box.hidden; $('#t-plan').classList.toggle('on', !box.hidden); viewCfg.plan = !box.hidden; saveView(); });
if (viewCfg.plan === false) { $('#plan-box').hidden = true; $('#t-plan').classList.remove('on'); }
/* 2D · 3D 보기 — 2D 는 평면도를 화면 가득, 3D 는 왼쪽 아래 작은 창(평면도 창이 있던 자리 · 크기). 사용자 2026-11-09
 * 「3D 버튼을 2D / 3D 보기로 전환 — 2D 는 평면도를 확대해 전체 화면, 3D 화면을 작게 지금 평면도처럼」.
 * 자리만 바꾼다 — 3D 화면은 크기 변화를 스스로 따라가고(ResizeObserver), 평면도는 보기 범위(viewBox)째로 커진다 */
function setDim(two: boolean) {
  devact(two ? '2D' : '3D');
  const vp = $('#viewport'), box = $('#plan-box'), b = $('#t-dim');
  vp.classList.toggle('v2d', two);
  // 3D 작은 창 크기 — 평면도 창을 끌어 키운 크기가 있으면 그것(정보 창은 그 위까지만)
  const vc = viewCfg as { planW?: number; planH?: number; dim2?: boolean };
  if (vc.planW && vc.planH) { vp.style.setProperty('--inset-w', `${vc.planW}px`); vp.style.setProperty('--inset-h', `${vc.planH}px`); }
  // 2D 에선 평면도가 곧 화면 — 끄는 단추를 숨긴다. 3D 로 돌아오면 평면도 창 켜고 끈 상태 그대로
  box.hidden = two ? false : viewCfg.plan === false;
  $('#t-plan').hidden = two;
  b.classList.toggle('on', two);
  b.querySelector('b')!.textContent = two ? '2D' : '3D';
  b.dataset.tip = two ? '3D 로 크게 보기 (평면도는 작은 창으로)' : '2D 평면도로 크게 보기 (3D 는 작은 창으로)';
  vc.dim2 = two; saveView();
  stage.invalidate(true);
}
$('#t-dim').addEventListener('click', () => setDim(!$('#viewport').classList.contains('v2d')));
if ((viewCfg as { dim2?: boolean }).dim2) setDim(true);
// 평면도 확대 · 축소 · 맞춤 버튼
document.querySelectorAll<HTMLElement>('[data-pz]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.pz; if (k === 'fit') plan.fit(); else plan.zoomBy(k === 'in' ? 1.25 : 1 / 1.25);
}));
// 동선 정보(작업 삼각형 변 길이 · 통로 폭 · 이동 경로) 켜고 끄기 — 요약 줄은 늘 보인다. 보기 설정에 기억
{
  const vf = viewCfg as { flow?: boolean };
  plan.flowBox = $('#plan-flow');
  plan.showFlow = vf.flow !== false;
  $('#pz-flow').classList.toggle('on', plan.showFlow);
  $('#pz-flow').addEventListener('click', () => { plan.showFlow = !plan.showFlow; vf.flow = plan.showFlow; saveView(); $('#pz-flow').classList.toggle('on', plan.showFlow); plan.render(d, current); });
  plan.render(d, current);
}
// 설비 층(평면도) — 머리 「설비」 단추 · 종류 칩(보기 설정에 기억). 인입점 · 콘센트를 끌면 그 자리에 고정(설계에 저장, 되돌리기 · 파일에 들어감)
{
  const vm = viewCfg as { mepOn?: boolean; mepPlan?: Sys[] };
  plan.mepBox = $('#plan-mep');
  plan.showMep = !!vm.mepOn;
  if (vm.mepPlan) plan.mepSys = new Set(vm.mepPlan);
  $('#pz-mep').classList.toggle('on', plan.showMep);
  $('#pz-mep').addEventListener('click', () => { plan.showMep = !plan.showMep; vm.mepOn = plan.showMep; saveView(); $('#pz-mep').classList.toggle('on', plan.showMep); plan.render(d, current); });
  plan.onMepSys = (s) => { vm.mepPlan = [...s]; saveView(); };
  plan.onMepMove = moveMep;
  plan.onMepPick = pickMep;
  plan.render(d, current);
}
/** 인입점 · 콘센트 옮기기 — 벽 인입점 · 콘센트는 가장 가까운 벽에, 바닥 인입점은 바닥에 붙여 부엌 좌표(mm)로 저장. 높이는 지금 높이 그대로 */
function moveMep(ref: string, x: number, z: number, done: boolean) {
  if (!current) return;
  const cfg = (d.mep ??= {});
  if (ref.startsWith('out:')) {
    const o = cfg.outlets?.find((q) => `out:${q.id}` === ref);
    if (!o) return;
    const sw = snapWall(d, x, z);
    o.x = Math.round(sw.p[0]); o.z = Math.round(sw.p[1]);
  } else {
    const key = ref as InletKey, info = INLET_INFO[key];
    const q = info.mount === 'wall' ? snapWall(d, x, z).p : snapFloor(d, x, z);
    const y = info.mount === 'wall' ? cfg.inlets?.[key]?.y ?? mepOf(d, current).inlets.find((i) => i.key === key)!.p[1] : undefined;
    cfg.inlets = { ...(cfg.inlets ?? {}), [key]: { x: Math.round(q[0]), z: Math.round(q[1]), ...(y != null ? { y: Math.round(y) } : {}) } };
  }
  if (!done) mepLive();
  if (done) { saveDesign(d); mepChanged(); if (plan.selectedMep === ref) pickMep(ref); say(`${ref.startsWith('out:') ? '콘센트' : INLET_INFO[ref as InletKey].label} 자리를 옮겼습니다 — 설비 선이 따라옵니다`); setTimeout(() => say(null), 2200); }
}
/* ───────── 설비 메뉴 — 인입점 · 일반 콘센트(따로 놓음) · 확인 목록 ───────── */
/** 설비가 바뀜(인입점 · 콘센트) — 메뉴 · 평면도 · 3D 설비 보기 */
function mepChanged() { renderMep(); plan.render(d, current); mepView3d(); }
/** 3D 설비 보기 — 체크한 종류(보기 설정 mep3d)가 있으면 지금 배치로 관을 다시 만들고 장 · 벽을 반투명으로. 없거나 실사 모드면 끈다 */
function mepView3d(live = false) {
  const on = new Set((viewCfg as { mep3d?: Sys[] }).mep3d ?? []);
  if (!on.size || !current || stage.mode !== 'raster') { if (stage.mepOn) stage.setMep(null); setMenuOn($('#t-mep'), false); return; }
  stage.setMep(buildMep3d(mepOf(d, current), on, plan.selectedMep), live);
  setMenuOn($('#t-mep'), true);
}
/** 끄는 중 — 평면도 · 3D 관을 한 프레임에 한 번 다시(사용자 2026-11-11 「실시간으로 위치 변경」. 예전엔 3D 는 놓을 때만 바뀌었다) */
let mepLiveQ = false;
function mepLive() {
  if (mepLiveQ) return;
  mepLiveQ = true;
  requestAnimationFrame(() => { mepLiveQ = false; if (!current) return; plan.render(d, current); mepView3d(true); });
}
/* 3D 설비 끌기 — 설비 보기에서 인입점 · 콘센트 상자를 누르고 끌면 벽 면(높이 포함) · 바닥 위를 따라 옮기고 관이 따라온다. 놓으면 저장, ESC 면 되돌림 */
let mep3dDrag: { ref: string; snap: string; off: V3; moved: boolean } | null = null;
const mepMount = (ref: string) => (ref.startsWith('out:') || INLET_INFO[ref as InletKey].mount === 'wall' ? 'wall' : 'floor');
const mepPos = (ref: string): V3 | undefined => { if (!current) return; const m = mepOf(d, current); return (ref.startsWith('out:') ? m.outlets.find((o) => `out:${o.id}` === ref) : m.inlets.find((i) => i.key === ref))?.p; };
/** 설비 자리 쓰기 — 벽에 붙는 것은 높이도(y), 바닥 인입점은 평면만 */
function placeMep(ref: string, p: V3) {
  const cfg = (d.mep ??= {}), x = Math.round(p[0]), z = Math.round(p[2]), y = Math.round(p[1]);
  if (ref.startsWith('out:')) { const o = cfg.outlets?.find((q) => `out:${q.id}` === ref); if (o) Object.assign(o, { x, z, y }); return; }
  const key = ref as InletKey;
  cfg.inlets = { ...(cfg.inlets ?? {}), [key]: { x, z, ...(INLET_INFO[key].mount === 'wall' ? { y } : {}) } };
}
stage.onPickMep = (ref) => { mep3dDrag = null; pickMep(ref); };
stage.onDragMep = (ref, o, dir, phase) => {
  if (!current) return;
  if (phase === 'down') {
    const p = mepPos(ref), mount = mepMount(ref), a = p && mepAim(d, mount, o, dir, p[1]);
    // 누른 점과 설비 가운데 차이 — 그만큼 띄워 따라오게(상자 끝을 잡아도 튀지 않게). 벽이 바뀌면 어긋나지 않게 200 넘으면 버린다
    const off: V3 = p && a ? [p[0] - a[0], mount === 'wall' ? p[1] - a[1] : 0, p[2] - a[2]] : [0, 0, 0];
    mep3dDrag = { ref, snap: JSON.stringify(d.mep ?? {}), off: Math.hypot(...off) > 200 ? [0, 0, 0] : off, moved: false };
    return;
  }
  const g = mep3dDrag;
  if (!g || g.ref !== ref) return;
  if (phase === 'cancel') { d.mep = JSON.parse(g.snap); mep3dDrag = null; mepChanged(); return; }
  if (phase === 'move') {
    const cur = mepPos(ref), a = mepAim(d, mepMount(ref), o, dir, cur?.[1] ?? 1500);
    if (!a) return;
    const t: V3 = [a[0] + g.off[0], a[1] + g.off[1], a[2] + g.off[2]];
    // 띄운 만큼 더한 점을 다시 벽 · 바닥에 붙인다
    const q = mepMount(ref) === 'wall' ? snapWall(d, t[0], t[2]).p : snapFloor(d, t[0], t[2]);
    placeMep(ref, [q[0], Math.max(100, Math.min(d.room.h - 100, t[1])), q[1]]);
    g.moved = true;
    mepLive();
    return;
  }
  // up — 저장(되돌리기 · 파일) · 메뉴 · 이름표 가려짐 다시 보기
  mep3dDrag = null;
  if (!g.moved) { pickMep(ref); return; }
  saveDesign(d); pickMep(ref); mepChanged();
  say(`${ref.startsWith('out:') ? '콘센트' : INLET_INFO[ref as InletKey].label} 자리를 옮겼습니다 — 설비 선이 따라옵니다 · 높이 · 자리는 메뉴에서도 입력`); setTimeout(() => say(null), 2400);
};
function setMep3d(list: Sys[]) { (viewCfg as { mep3d?: Sys[] }).mep3d = list; saveView(); renderMepChecks(); mepView3d(); }
function renderMepChecks() {
  const on = new Set((viewCfg as { mep3d?: Sys[] }).mep3d ?? []);
  $('#mep-checks').innerHTML = SYS_LIST.map((k) => `<label><input type="checkbox" data-mep3c="${k}"${on.has(k) ? ' checked' : ''}><i style="--c:${SYS_COLOR[k]}"></i>${SYS_LABEL[k]}${k === 'water' ? ' <small>(냉 · 온수)</small>' : k === 'heat' ? ' <small>(보일러 · 분배기)</small>' : ''}</label>`).join('');
}
$('#mep-checks').addEventListener('change', (e) => {
  const k = (e.target as HTMLElement).closest('[data-mep3c]') as HTMLInputElement | null;
  if (!k) return;
  const on = new Set((viewCfg as { mep3d?: Sys[] }).mep3d ?? []);
  if (k.checked) on.add(k.dataset.mep3c as Sys); else on.delete(k.dataset.mep3c as Sys);
  setMep3d(SYS_LIST.filter((x) => on.has(x)));
});
document.querySelectorAll<HTMLElement>('[data-mep3]').forEach((b) => b.addEventListener('click', () => setMep3d(b.dataset.mep3 === 'all' ? [...SYS_LIST] : [])));
$('#t-mep').addEventListener('click', () => {
  // 켜고 끄기 단추(사용자 2026-11-11 「누르면 활성화 검은색 … 다시 누르면 비활성화 화이트」 · 「비활성화시 다 꺼지고 장 · 가구 소품 등이 보이는 원래 상태로」)
  //   꺼져 있으면 → 6종 전부 켜고 메뉴를 펼친다(하나씩 · 전부 · 끄기는 메뉴에서). 켜져 있으면 → 전부 끄고 메뉴를 닫는다 — 장 반투명도 풀린다(stage.setMep(null))
  if (!((viewCfg as { mep3d?: Sys[] }).mep3d ?? []).length) { setMep3d([...SYS_LIST]); if (mepPop.hidden) togglePop(mepPop); return; }
  setMep3d([]);
  mepPop.hidden = true;
});
const segName = (s: WallSeg) => (s.space === 'kitchen' || s.space === 'living') && s.wall != null ? (isKitchenWall(s.wall) && s.wall === d.openWall ? '날개벽' : anyWallName(d, s.wall)) : `${OPENING_INFO[s.space as OpeningKind]?.label ?? ''} 벽`;
function renderMep() {
  const box = $('#mep-rows');
  if (!current) { box.innerHTML = ''; return; }
  const m = mepOf(d, current), outs = d.mep?.outlets ?? [];
  const warn = m.checks.filter((x) => x.level === 'warn'), info = m.checks.filter((x) => x.level === 'info');
  box.innerHTML = `
    <div class="mep-label">인입점 <small>앱이 정한 자리 — 평면도에서 끌거나 눌러 위치 입력</small></div>
    ${m.inlets.map((i) => `<div class="mep-row"><i style="--c:${SYS_COLOR[i.sys]}"></i><button class="link" data-mep-pick="${i.key}">${i.label}</button><small>${i.pinned ? '옮긴 자리' : '자동'}</small>${i.pinned ? `<button class="btn-mini light" data-mep-auto="${i.key}">자동 위치로</button>` : ''}</div>`).join('')}
    <div class="mep-label">일반 콘센트 <small>${outs.length}개 · 따로 놓은 것만</small><button class="btn-mini" data-mep-add>콘센트 추가</button></div>
    ${m.outlets.map((o, k) => `<div class="mep-row"><i style="--c:${SYS_COLOR.power}"></i><button class="link" data-mep-pick="out:${o.id}">콘센트 ${k + 1}</button><small>${segName(snapWall(d, o.p[0], o.p[2]).seg)} · 높이 ${Math.round(o.p[1]).toLocaleString('ko-KR')}</small><button class="btn-mini light" data-mep-del="${o.id}">빼기</button></div>`).join('')}
    <div class="mep-label">확인 <small>${warn.length ? `확인 필요 ${warn.length}` : '확인 필요 없음'}${info.length ? ` · 안내 ${info.length}` : ''}</small></div>
    ${[...warn, ...info].map((x) => `<div class="mep-check ${x.level}">${x.level === 'warn' ? '⚠ ' : ''}${x.text}</div>`).join('')}
    <div class="mep-note">높이 · 자리는 가정값입니다 — 시공 전 현장에서 확인하세요. 평면도 「설비」 단추와 3D 도구 막대 「설비 보기」로 봅니다.</div>`;
  $('#mep-sub').textContent = warn.length ? `확인 필요 ${warn.length}` : '급수 · 배수 · 전기 · 가스 · 배기 · 난방';
}
$('#mep-rows').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const pk = t.closest('[data-mep-pick]') as HTMLElement | null, au = t.closest('[data-mep-auto]') as HTMLElement | null, dl = t.closest('[data-mep-del]') as HTMLElement | null;
  if (pk) pickMep(pk.dataset.mepPick!);
  else if (au) { const k = au.dataset.mepAuto as InletKey; if (d.mep?.inlets) { delete d.mep.inlets[k]; saveDesign(d); mepChanged(); if (plan.selectedMep === k) pickMep(k); } }
  else if (dl) removeOutlet(dl.dataset.mepDel!);
  else if (t.closest('[data-mep-add]')) addOutlet();
});
/** 일반 콘센트 추가 — 정면 벽 상판 위, 싱크 · 쿡탑 가운데에서 600 넘게 · 다른 콘센트에서 300 넘게 떨어진 첫 자리(없으면 정면 벽 가운데). 높이 1,100(가정) */
function addOutlet() {
  if (!current) return;
  const w = viewWalls(d.openWall).front, L = wallLength(d.room, w), f = wallFrame(d.room, w);
  const tOf = (x: number, z: number) => (x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1];
  const busy = current.items.filter((x) => x.wall === w && (x.tag === 'sink' || x.tag === 'hob')).map((x) => x.t + x.w / 2);
  const taken = (d.mep?.outlets ?? []).map((o) => tOf(o.x, o.z));
  let t = L / 2;
  for (let k = 300; k <= L - 300; k += 100) if (busy.every((c) => Math.abs(c - k) > 600) && taken.every((c) => Math.abs(c - k) > 300)) { t = k; break; }
  const p = wallPoint(d.room, w, t), id = newId('mo');
  d.mep = { ...(d.mep ?? {}), outlets: [...(d.mep?.outlets ?? []), { id, x: Math.round(p[0]), z: Math.round(p[1]), y: MEP_ASSUME.outletY }] };
  saveDesign(d); mepChanged(); pickMep(`out:${id}`);
}
function removeOutlet(id: string) {
  if (!d.mep?.outlets) return;
  d.mep.outlets = d.mep.outlets.filter((o) => o.id !== id);
  if (plan.selectedMep === `out:${id}`) pickMep(null);
  saveDesign(d); mepChanged();
}
/** 인입점 · 콘센트 메뉴 — 정보 창(창 · 문 메뉴와 같은 모양). 벽에 붙는 것은 양 끝까지 · 높이, 바닥은 두 벽에서 거리 */
function pickMep(ref: string | null) {
  const box = $('#item-info');
  const was = plan.selectedMep;
  if (!ref || !current) { plan.selectedMep = null; if (box.dataset.mep) { box.hidden = true; delete box.dataset.mep; } plan.render(d, current); if (was) mepView3d(); return; }
  plan.selectedMep = null;   // pick() 가 3D 를 한 번 더 만들지 않게
  pick(null); if (selectedOp) pickOpening(null);
  plan.selectedMep = ref;
  if (was !== ref) mepView3d();   // 3D 흰 테두리
  const m = mepOf(d, current), isOut = ref.startsWith('out:');
  const inl = isOut ? undefined : m.inlets.find((i) => i.key === ref), out = isOut ? m.outlets.find((o) => `out:${o.id}` === ref) : undefined;
  if (!inl && !out) { pickMep(null); return; }
  const p = (inl ?? out)!.p, wallMount = !inl || inl.mount === 'wall', color = inl ? SYS_COLOR[inl.sys] : SYS_COLOR.power;
  const num = (f: string, label: string, v: number) => `<label>${label}<input data-mf="${f}" type="number" step="10" value="${Math.round(v)}"></label>`;
  let rows = '', where = '';
  if (wallMount) {
    const sw = snapWall(d, p[0], p[2]), a = sw.seg.a, b = sw.seg.b, L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = Math.hypot(p[0] - a[0], p[2] - a[1]);
    // a 가 왼쪽인지 — 진행 방향 왼쪽이 그 벽 법선이면(부엌 벽과 같은 규칙) a 쪽이 마주 보고 왼쪽
    const ab: [number, number] = [(b[0] - a[0]) / (L || 1), (b[1] - a[1]) / (L || 1)], aLeft = -ab[1] * sw.seg.n[0] + ab[0] * sw.seg.n[1] > 0;
    rows = `<div class="ii-row">${num('l', '왼쪽 끝까지', aLeft ? t : L - t)}${num('r', '오른쪽 끝까지', aLeft ? L - t : t)}</div><div class="ii-row">${num('y', '바닥에서 높이', p[1])}</div>`;
    where = `${segName(sw.seg)} · 벽 길이 ${Math.round(L).toLocaleString('ko-KR')}`;
  } else {
    rows = `<div class="ii-row">${num('x', `${wallName(d.openWall, 3)}에서`, p[0])}${num('z', `${wallName(d.openWall, 0)}에서`, p[2])}</div>`;
    where = '바닥(바닥 속 배관)';
  }
  box.innerHTML = `
    <div class="ii-head"><b style="color:${color}">■</b><b>${inl ? inl.label : '콘센트'}</b><button title="닫기">×</button></div>
    <div class="ii-model">${where} · ${inl ? (inl.pinned ? '옮긴 자리' : '앱이 정한 자리') : '따로 놓은 콘센트'} · 평면도에서 끌어 옮기기</div>
    ${rows}
    <div class="ii-acts">${inl ? (inl.pinned ? '<button data-mep-act="auto">자동 위치로</button>' : '') : '<button data-mep-act="del">이 콘센트 빼기</button>'}</div>`;
  box.dataset.mep = ref;
  box.hidden = false;
  box.querySelector('.ii-head button')!.addEventListener('click', () => pickMep(null));
  box.querySelectorAll<HTMLInputElement>('[data-mf]').forEach((inp) => inp.addEventListener('change', () => setMepPos(ref, inp.dataset.mf!, Number(inp.value))));
  box.querySelector('[data-mep-act="auto"]')?.addEventListener('click', () => { if (d.mep?.inlets) delete d.mep.inlets[ref as InletKey]; saveDesign(d); mepChanged(); pickMep(ref); });
  box.querySelector('[data-mep-act="del"]')?.addEventListener('click', () => removeOutlet(ref.slice(4)));
  plan.render(d, current);
}
/** 메뉴 값으로 옮기기 — 양 끝까지(같은 벽 위) · 높이 · 바닥 두 벽에서 거리 */
function setMepPos(ref: string, f: string, v: number) {
  if (!current || !Number.isFinite(v)) return;
  const m = mepOf(d, current), isOut = ref.startsWith('out:');
  const cur = (isOut ? m.outlets.find((o) => `out:${o.id}` === ref) : m.inlets.find((i) => i.key === ref))?.p;
  if (!cur) return;
  let [x, y, z] = cur;
  if (f === 'l' || f === 'r') {
    const sw = snapWall(d, x, z), a = sw.seg.a, b = sw.seg.b, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ab = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const aLeft = -ab[1] * sw.seg.n[0] + ab[0] * sw.seg.n[1] > 0, fromA = Math.max(0, Math.min(L, (f === 'l') === aLeft ? v : L - v));
    x = a[0] + ab[0] * fromA; z = a[1] + ab[1] * fromA;
  } else if (f === 'y') y = v;
  else if (f === 'x') x = v;
  else if (f === 'z') z = v;
  const cfg = (d.mep ??= {});
  if (isOut) { const o = cfg.outlets?.find((q) => `out:${q.id}` === ref); if (o) Object.assign(o, { x: Math.round(x), z: Math.round(z), y: Math.round(y) }); }
  else { const key = ref as InletKey; cfg.inlets = { ...(cfg.inlets ?? {}), [key]: { x: Math.round(x), z: Math.round(z), ...(INLET_INFO[key].mount === 'wall' ? { y: Math.round(y) } : {}) } }; }
  saveDesign(d); mepChanged(); pickMep(ref);
}
// 평면도 창 크기 — 오른쪽 위 손잡이를 끌어서(창은 왼쪽 아래에 붙어 있다). 크기는 저장
{
  const box = $('#plan-box'), grip = box.querySelector<HTMLElement>('.plan-resize')!;
  const vcfg = viewCfg as { planW?: number; planH?: number };
  const setSize = (w: number, h: number) => {
    const vp = $('#viewport').getBoundingClientRect();
    w = Math.max(260, Math.min(vp.width - 32, w)); h = Math.max(180, Math.min(vp.height - 32, h));
    box.style.width = `${w}px`; box.style.height = `${h}px`; box.classList.add('sized');
    vcfg.planW = Math.round(w); vcfg.planH = Math.round(h);
  };
  if (vcfg.planW && vcfg.planH) setSize(vcfg.planW, vcfg.planH);
  let st: { x: number; y: number; w: number; h: number } | null = null;
  grip.addEventListener('pointerdown', (e) => { const r = box.getBoundingClientRect(); st = { x: e.clientX, y: e.clientY, w: r.width, h: r.height }; grip.setPointerCapture(e.pointerId); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (st) setSize(st.w + (e.clientX - st.x), st.h - (e.clientY - st.y)); });
  grip.addEventListener('pointerup', () => { if (st) { st = null; saveView(); } });
  grip.addEventListener('dblclick', () => { box.style.width = box.style.height = ''; box.classList.remove('sized'); delete vcfg.planW; delete vcfg.planH; saveView(); });
}

/* ───────── 설계 묶음 되살리기 — 되돌리기 · 다시 하기 · 설계 파일 불러오기 ───────── */
/** 고른 것 · 끄는 중인 것을 모두 푼다(되살린 상태에는 그 장 · 개구부가 없을 수 있다) */
function clearSelection() {
  stage.cancelDrag();
  pick(null);
  if (selectedOp) pickOpening(null);
  if (islandSel) unpickIsland();
  if (hobSel) unpickHob();
  diningSel = false; stage.setIslandRing(null);
  $('#item-info').hidden = true; stage.highlight(null); showWallArrow(null); plan.pickedWall = null;
}
/** 패널 전부를 설계에 맞춰 다시 */
function refreshPanels() {
  syncRoomInputs(); renderOpenWall(); renderLayouts(); renderIsland(); renderClear(); renderOpenings(); renderStyles(); renderGrades(); renderMats(); renderAppliances(); renderDining(); renderMep();
  $<HTMLInputElement>('#fridge-on').checked = !d.noFridge;
}
/** 설계 · 배치안을 그대로 놓는다 — 자동 배치는 다른 안 목록에만 쓰고, 지금 안은 저장된 배치(직접 고친 장 포함) 그대로 */
async function applySnapshot(s: Snapshot, record: boolean) {
  if (preview) endPreview(false, false);
  clearSelection();
  restoring = !record;
  clearTimeout(commitTimer);
  for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k];
  Object.assign(d, s.design);
  storeDesign(d);
  cands = autoPlan(d, cat, grade().series);
  current = s.plan;
  fixThinFills();
  robotWant = robotsOf(current);
  if (current) { const i = cands.findIndex((c) => c.id === current!.id); if (i >= 0) cands[i] = current; else cands.unshift(current); }
  refreshPanels();
  rebuildRoom();
  renderCands(); renderRunLen(); plan.render(d, current);
  await rebuildKitchen();
  if (!record) { clearTimeout(commitTimer); hist.sync(encode({ design: d, plan: current })); try { localStorage.setItem(PLAN_KEY, hist.last!); } catch { /* 화면은 그대로 */ } }
  restoring = false;
  renderHistory();
}
function undo() {
  if (commitTimer) { clearTimeout(commitTimer); commit(); }     // 아직 안 쌓인 마지막 변경부터
  const s = hist.back(); if (!s) return;
  void applySnapshot(decode(s), false).then(() => say(`되돌렸습니다 · 남은 ${hist.undo.length}단계`)).then(() => setTimeout(() => say(null), 1500));
}
function redo() {
  if (commitTimer) { clearTimeout(commitTimer); commit(); }
  const s = hist.forward(); if (!s) return;
  void applySnapshot(decode(s), false).then(() => say(`다시 했습니다 · 남은 ${hist.redo.length}단계`)).then(() => setTimeout(() => say(null), 1500));
}
function renderHistory() {
  const u = $<HTMLButtonElement>('#h-undo'), r = $<HTMLButtonElement>('#h-redo');
  u.disabled = !hist.undo.length; r.disabled = !hist.redo.length;
  u.title = `되돌리기 (Ctrl+Z) · ${hist.undo.length}/${hist.limit}`; r.title = `다시 하기 (Ctrl+Y) · ${hist.redo.length}/${hist.limit}`;
}

/* ───────── 설계 파일 — 저장 · 불러오기 ───────── */
const ROOM_NAME: Record<LayoutKind, string> = { I: 'ㅡ자', L: 'ㄱ자', Lr: 'ㄱ자 반대', U: 'ㄷ자', II: '11자', walls: '벽마다' };
function stamp() { const t = new Date(), p = (n: number) => String(n).padStart(2, '0'); return `${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}_${p(t.getHours())}${p(t.getMinutes())}`; }
async function saveFile() {
  if (commitTimer) { clearTimeout(commitTimer); commit(); }
  const text = toFile({ design: d, plan: current }, {
    app: `kitchen-planner ${pkg.version}`,
    summary: { 공간: `${d.room.w}×${d.room.d}×${d.room.h}`, 구조: ROOM_NAME[d.layout], 아일랜드: d.island, 스타일: STYLE_LABEL[d.style], 그레이드: grade().label, 장: current?.items.length ?? 0, 배치안: current?.title },
    bom: current ? buildBom(d, current, cat, grade()) : [],
    // 그때 화면을 그대로 재현할 수 있게 — 카메라(m) · 창밖 풍경 · 성능 단계 · 화면 크기도 같이(참고용, 불러올 땐 적용하지 않음)
    settings: { light: { sun: stage.sunCfg, room: stage.roomCfg, shadow: stage.shadowCfg }, post: stage.raster.post, mode: stage.mode,
      camera: { pos: stage.camera.position.toArray().map((v) => +v.toFixed(3)), target: stage.controls.target.toArray().map((v) => +v.toFixed(3)), fov: stage.camera.fov },
      outdoor, quality: stage.quality, perf: perfCfg, view: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio } },
  });
  const name = `부엌설계_${stamp()}.kitchen.json`;
  // 저장 위치를 고를 수 있으면(크롬 · 엣지) 고르게, 아니면 내려받기 폴더로
  const picker = (window as unknown as { showSaveFilePicker?: (o: object) => Promise<{ name: string; createWritable(): Promise<{ write(t: string): Promise<void>; close(): Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try {
      const h = await picker({ suggestedName: name, types: [{ description: '부엌 설계 파일', accept: { 'application/json': ['.json'] } }] });
      const w = await h.createWritable(); await w.write(text); await w.close();
      say(`저장했습니다 — ${h.name}`); setTimeout(() => say(null), 2500); return;
    } catch (e) { if ((e as DOMException).name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  say(`저장했습니다 — ${name}`); setTimeout(() => say(null), 2500);
}
async function openFile(file: File) {
  let s: Snapshot;
  try { s = fromFile(await file.text()); } catch (e) { alert(`불러오지 못했습니다 — ${(e as Error).message}`); return; }
  // 지금 카탈로그에 없는 장(예전 판 카탈로그로 만든 파일) — 그 장만 빠진다
  const missing = [...new Set((s.plan?.items ?? []).map((it) => it.key).filter((k) => !cat.modules.some((m) => m.key === k) && !/^(fridge|fixFill|fill\d*)$/.test(k)))];
  if (commitTimer) { clearTimeout(commitTimer); commit(); }
  await applySnapshot(s, true);       // 불러오기도 한 단계 — 되돌리면 불러오기 전으로
  say(missing.length ? `불러왔습니다 — 지금 카탈로그에 없는 장 ${missing.length}종(${missing.join(', ')})은 빠졌습니다` : `불러왔습니다 — ${file.name}`);
  setTimeout(() => say(null), missing.length ? 6000 : 2500);
}
/** 견적 데이터(부품 목록) — 엑셀에서 열리는 CSV. 빈 칸(한샘 코드 · 단가)은 단가표를 원본 ID 로 이어 채운다 */
function saveBom() {
  if (!current) return;
  const rows = buildBom(d, current, cat, grade());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bomCsv(rows)], { type: 'text/csv' })); a.download = `부엌견적_${stamp()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const g = bomGaps(rows);
  say(`견적 데이터 ${rows.length}줄 — 비어 있는 칸: ${Object.entries(g).map(([k, v]) => `${k} ${v.length}`).join(' · ') || '없음'}`); setTimeout(() => say(null), 4000);
}
$('#f-save').addEventListener('click', () => void saveFile());
$('#f-bom').addEventListener('click', saveBom);
$('#f-open').addEventListener('click', () => $<HTMLInputElement>('#f-input').click());
$<HTMLInputElement>('#f-input').addEventListener('change', (e) => { const inp = e.target as HTMLInputElement; const f = inp.files?.[0]; inp.value = ''; if (f) void openFile(f); });
$('#h-undo').addEventListener('click', undo);
$('#h-redo').addEventListener('click', redo);
// 단축키 — 글자 입력 중엔 그 칸의 되돌리기를 그대로 둔다
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  const k = e.key.toLowerCase();
  if (preview && ['z', 'y', 's', 'o'].includes(k)) pick(null);     // 미리보기는 거두고(취소) — 되돌리기 · 저장은 원래 배치안으로
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  else if (k === 's') { e.preventDefault(); void saveFile(); }
  else if (k === 'o') { e.preventDefault(); $<HTMLInputElement>('#f-input').click(); }
});

/* ───────── 시작 ───────── */
renderLayouts(); renderIsland(); renderClear(); renderOpenings(); renderStyles(); renderGrades(); renderMats(); renderAppliances(); renderDining();
rebuildRoom();
replan(true, false);
// 새로고침 전에 직접 고친 장 — 설계가 그대로면 그때 배치안(자동 배치는 직접 고친 폭 · 교체 · 추가 · 빼기를 모른다)
try {
  const raw = localStorage.getItem(PLAN_KEY);
  if (raw) {
    const s = decode(raw);
    if (s.plan && JSON.stringify(s.design) === JSON.stringify(d)) {
      current = s.plan;
      fixThinFills();
      const i = cands.findIndex((c) => c.id === current!.id); if (i >= 0) cands[i] = current; else cands.unshift(current);
      renderCands(); renderRunLen(); plan.render(d, current);
    }
  }
} catch { /* 못 읽으면 자동 배치 그대로 */ }
robotWant = robotsOf(current);
hist.sync(encode({ design: d, plan: current }));
renderHistory();
void rebuildKitchen();
aim();
// 시험용
(window as unknown as Record<string, unknown>).__kp = { d, stage, get cands() { return cands; }, get current() { return current; }, get kitchen() { return lastKitchen; }, replan, resizeItem, nudgeItem, dragItem, rebuildKitchen, pick, pickOpening, moveOpening, plan, swapItem, runRobot, addBeside, removeItem, get robotRun() { return robotRun; }, robotPath, wallLength: (w: WallId) => wallLength(d.room, w), cabSpan: (w: WallId) => cabSpan(d, w),
  moveItemTo, widthOptions, hist, undo, redo, commit, fileText: () => toFile({ design: d, plan: current }, { app: `kitchen-planner ${pkg.version}` }), openText: (t: string) => applySnapshot(fromFile(t), true),
  bom: () => { const rows = current ? buildBom(d, current, cat, grade()) : []; return { rows, gaps: bomGaps(rows) }; } };
