// 3D 화면 — 렌더러 · 카메라 · 조명 · 카메라 쪽 벽 숨기기 · 개구부 끌기(벽을 따라)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/** 창밖 풍경 — Poly Haven CC0 HDRI 1K(1024×512). 2K 와 같은 시점 비교에서 정면 · 3D 보기는 차이가 잡음 수준이라 1K(6.5MB → 1.7MB),
 *  창에 바짝 붙어 볼 때만 조금 흐리다. 실내 조명은 RoomEnvironment 그대로 — 풍경의 해가 「두 번째 해」가 되지 않게 배경으로만 */
export const OUTDOOR: Record<string, { label: string; file: string; gain: number; rot: number }> = {
  city: { label: '도시', file: 'modern_buildings_2_1k.hdr', gain: 1.6, rot: 0 },
  park: { label: '공원', file: 'park_parking_1k.hdr', gain: 4, rot: 0 },
};
import { nearestWall, wallFrame, type Design, type WallId } from './plan';
const wallFrameOf = (d: Design, w: WallId) => wallFrame(d.room, w) as { o: number[]; dir: number[]; n: number[] };
import type { Item } from './autoplan';
import { slotMovable } from './reorder';
import type { RoomObj } from './room3d';
import { startEmbed, type EmbedKind, type EmbedHandle, type LightPayload } from './render/embed';
import { createRaster, type PostSettings, type Raster, type RasterRenderer } from './render/raster';
import { MeshPhysicalNodeMaterial, type WebGPURenderer } from 'three/webgpu';
import { abs, float, lights, normalView, normalWorld, positionViewDirection, positionWorld, reflector, smoothstep, step, uniform } from 'three/tsl';
import { COUNTER_TOP } from './kitchen3d';
import { bakeSpaceAO, clearSpaceAO, SPACE_FLAG, type LightIn } from './render/spaceao';
import { disposeTree, isShared, shared } from './dispose';
type GPT = typeof import('./render/gpupt');
let gpt: GPT | null = null;
const loadGpt = () => import('./render/gpupt').then((m) => (gpt = m));

/* 실사 렌더 — 붙박이장 플래너와 같은 3방식. ① MuTracer = 같은 three 장면을 경로 추적(별도 캔버스, 바뀐 것 자동 반영)
 * ② 라이트맵 굽기 · ③ 서펠 GI = 시험 앱 임베드 빌드(public/engines)를 iframe 으로 띄우고 장면을 GLB 로 넘긴다 */
/** hq = 실시간 + 화면 반사(SSR) · 접촉 그림자(SSS) · gpupt = ⑤ three-gpu-pathtracer(WebGPU, 같은 캔버스) */
export type RenderMode = 'raster' | 'hq' | 'mutracer' | 'gpupt' | 'bake' | 'surfel';
type MtMod = typeof import('./render/mutracer');
let mt: MtMod | null = null, mtLoading: Promise<MtMod> | null = null;
const loadMt = () => mtLoading ??= import('./render/mutracer').then((m) => { mt = m; m.setMutracerExposure(1.15); return m; });

const S = 0.001;
export type ViewKind = 'persp' | 'top' | 'front';

/** 화면에 보이는 것만 고른다 — 카메라 쪽 벽을 숨기면 그 벽의 장 · 상판도 숨기는데(visible=false) 광선은 숨김을 안 봐서 뒤에서 눌렸다 */
/** 천장 조명(다운라이트 · 벽 너머 공간 천장등) 켜기 */
export const CEILING_LAMPS = false;
/** 실시간 노출 기준 — 조명 패널 노출 × 후처리 노출 배율(기본 1.5)을 곱한다. 예전 WebGL AgX 1.15 화면 밝기에 맞춘 값 */
const KITCHEN_EXPOSURE = 1;   // 붙박이장 플래너와 같은 식 — 노출 × 후처리 노출 배율

/* ───────── 조명 — 붙박이장 플래너 조명 패널과 같은 항목(해 · 창 빛 · 그림자 · 실내 조명 · 환경광 · 노출) ───────── */
export type Sun = { azimuth: number; elevation: number; intensity: number; kelvin: number };
/** 천장 조명 구성 — none = 아직 설치 전(기본, 조명이 보이지 않는다) · main = 가운데 메인 조명 · down = 다운라이트 · both = 메인 + 다운라이트 */
export type CeilingLight = 'none' | 'main' | 'down' | 'both';
export const CEILING_LIGHTS: [CeilingLight, string][] = [['none', '없음 (설치 전)'], ['main', '메인 조명 (가운데 · 그림자)'], ['down', '다운라이트'], ['both', '메인 + 다운라이트']];
export type RoomLight = { sky: number; lamp: number; kelvin: number; env: number; exposure: number; ceiling: CeilingLight; lampColor: string };
export type ShadowCfg = { strength: number; soft: number };
/** 색온도 → 빛 색 (붙박이장 플래너와 같은 식 — 흰색 쪽으로 45%) */
export function kelvinColor(k: number): THREE.Color {
  const t = k / 100, c = (v: number) => THREE.MathUtils.clamp(v, 0, 255) / 255;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.45);
}
/** 창 하늘빛(사각 조명) 기준 밝기(니트) · 천장 다운라이트 한 개(칸델라) */
/** 붙박이장 플래너와 같은 값 — 다운라이트 한 개 6cd · 방 메인 조명 8cd(그림자) · 창 빛 1nit (조명 패널 「실내 조명」·「창 빛」 1.0 일 때) */
const WINDOW_NITS = 1, DOWNLIGHT_CD = 6, MAIN_CD = 8;
/** 조명 패널 환경광 × — 실내 환경맵은 가림 없이 고르게 비춰 공간감이 사라졌다(붙박이장 플래너와 같은 값) */
const RASTER_ENV = 0.85;
/** 끈 실사 엔진을 놓기까지(ms) — 그 안에 다시 켜면 셰이더 준비 없이 바로 이어진다 */
const RELEASE_MS = 60_000;

/* 성능 단계 — PC 에 맞춰 화질을 조절한다(사용자 2026-11-06 「저사양 노트북에서도 쾌적하게 · PC 성능에 따른 조절 버튼」).
 * 실측(RTX 4080 · 1370×1080): 기본 후처리 한 장 GPU 1.84ms, 간접광(SSGI) 끄면 1.31, 후처리 다 끄면 0.84 — 내장 그래픽은 대역폭이 10~25 배 낮아
 * 기본이면 돌릴 때 초당 15~35장(추정). CPU 4배 느리게 · 4코어 흉내에서 공간 라이트맵 굽기 3.2 → 11.8초.
 * 고품질 = 지금 기본 그대로 · 보통 = 간접광 보통 · 화면 배율 1.25 · 저사양 = 간접광 끄고 GTAO 그늘만 · 노이즈 제거 · 빛 번짐 끔 · 배율 1 · 라이트맵 성긴 판 */
export type Quality = 'high' | 'mid' | 'low';
export const QUALITY_TIERS: Record<Quality, { label: string; dpr: number; shadow: number; lampShadow: number; lightmap: { cell: number; bounce: number }; post: Partial<PostSettings> }> = {
  high: { label: '고품질', dpr: 1.5, shadow: 4096, lampShadow: 2048, lightmap: { cell: 0.04, bounce: 24 }, post: { ssgi: true, aoKind: 'both', quality: 'high', giRes: 'half', denoise: true, traa: true, bloom: true, floorRefl: 0.1, counterRefl: 1 } },
  // 보통 — 상판 반사는 끈다(바닥 · 상판 반사가 각각 방을 한 번 더 그린다)
  mid: { label: '보통', dpr: 1.25, shadow: 2048, lampShadow: 2048, lightmap: { cell: 0.05, bounce: 16 }, post: { ssgi: true, aoKind: 'both', quality: 'mid', giRes: 'half', denoise: true, traa: true, bloom: true, floorRefl: 0.1, counterRefl: 0 } },
  // 저사양 — 바닥 · 상판 반사 모두 끈다
  low: { label: '저사양', dpr: 1, shadow: 2048, lampShadow: 1024, lightmap: { cell: 0.08, bounce: 10 }, post: { ssgi: true, aoKind: 'gtao', quality: 'low', denoise: false, traa: true, bloom: false, floorRefl: 0, counterRefl: 0 } },
};
/** 화면에서만 숨기는 층 — 카메라 쪽 벽 · 위에서 본 천장. 그림자 · 실내 환경맵 · 라이트맵에는 그대로 남아 빛이 벽 · 천장을 뚫지 않는다 */
const HIDE_LAYER = 1;
const setLayer = (o: THREE.Object3D, hide: boolean) => {
  if (!!o.userData.hid === hide) return;
  o.userData.hid = hide;
  o.traverse((c) => { if (hide) c.layers.set(HIDE_LAYER); else c.layers.set(0); });
};
/** 조명 설정 저장 — 키를 고정한다. 판이 바뀌어도 키를 바꾸지 않고 새 항목만 기본값으로 채운다(예전엔 기본값을 바꿀 때마다 키를 올려
 *  저장해 둔 설정이 초기화됐다 — 사용자 지적 2026-11-05). 예전 키(v4 → v1)에 남은 값은 처음 한 번 가져온다 */
const LIGHT_KEY = 'kitchen-planner.light';
const LIGHT_OLD = ['kitchen-planner.light.v4', 'kitchen-planner.light.v3', 'kitchen-planner.light.v2', 'kitchen-planner.light.v1'];
function loadLight(): { sun?: object; room?: object; shadow?: object; sunUser?: boolean } | null {
  try {
    const cur = localStorage.getItem(LIGHT_KEY);
    if (cur) return JSON.parse(cur);
    for (const k of LIGHT_OLD) { const v = localStorage.getItem(k); if (v) { localStorage.setItem(LIGHT_KEY, v); return JSON.parse(v); } }
  } catch { /* 기본 */ }
  return null;
}
/* 실내 조명은 조명 패널 「천장 조명」으로 고른다 — 기본 「없음(설치 전)」(사용자 2026-11-05 「조명 설치를 안해서 조명이 표현되면 안돼」 · 「조명 컨트롤 메뉴도 빛에 추가해」) */
const isShown = (o: THREE.Object3D | null) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
const shown = (hits: THREE.Intersection[]) => hits.find((h) => isShown(h.object));

export class Stage {
  // 기본값 = 붙박이장 플래너 그대로(해 3 · 고도 42 · 창 빛 1.8 · 환경광 1.0 · 노출 1.05). 방위만 부엌 창 방향 자동, 실내 조명은 꺼 둔다(사용자: 천장 조명 빼)
  sunCfg: Sun = { azimuth: 0, elevation: 42, intensity: 3, kelvin: 5200 };
  roomCfg: RoomLight = { sky: 1.8, lamp: 0.3, kelvin: 5000, env: 1.0, exposure: 1.05, ceiling: 'none', lampColor: '#ffffff' };
  shadowCfg: ShadowCfg = { strength: 1, soft: 3 };
  /** 사용자가 해를 직접 돌렸는지 — 아니면 방이 바뀔 때 창 바깥 쪽으로 자동 */
  private sunUser = false;
  private skyK = 0.9;
  private outsideGain = 1;
  private windowLights = new THREE.Group();
  private hemi = new THREE.HemisphereLight('#ffffff', '#b9a98f', 0.6);
  /** 실시간 화면 — 붙박이장 플래너와 같은 렌더러(기본 WebGPU: SSGI 간접광 · GTAO · TRAA · 블룸, ?webgl 이면 WebGL GTAO) */
  raster: Raster;
  renderer: RasterRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
  controls: OrbitControls;
  sun = new THREE.DirectionalLight('#fff4e6', 2.2);
  room?: RoomObj;
  kitchen?: THREE.Object3D;
  private lamps = new THREE.Group();
  private ray = new THREE.Raycaster();
  private drag?: { id: string; offset: number; moved: boolean; wall0: WallId; t0: number };
  private islDrag?: { dx: number; dz: number; moved: boolean; x0: number; z0: number };
  /** 끌기 기준 — 누른 점의 높이(그 높이 수평면으로 마우스를 옮긴다) · 누른 화면 점(4px 넘게 움직여야 끌기 시작) */
  private dragY = 0.9;
  private downAt = { x: 0, y: 0 };
  private far(e: PointerEvent) { return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) >= 4; }
  /** 아일랜드 회전 고리 — 고른 아일랜드 둘레 바닥(붙박이장 플래너 가구 고리와 같은 모양). 고리를 잡아 끌면 90° 단위로 딸깍 돈다 */
  private islRing?: { c: [number, number]; R: number; g: THREE.Group; y: number; step: number; kp: THREE.Vector3 };
  /** 회전 고리 옆 지금 각도(사용자 지시 2026-11-06 「선택 회전 시 현재 각도가 안 보인다 — 부엌도 같은 기능」) — 손잡이 바깥에 띄우는 화면 글자. 고리와 함께 돈다 */
  private ringLabel?: HTMLDivElement;
  private ringDrag?: { a0: number; deg: number };
  /** 회전 고리 끌기 — 끌기 시작 대비 회전(도, three rotation.y 방향 · 90 단위) */
  onRotateIsland?: (deg: number, done: boolean) => void;
  /** 아일랜드를 눌렀다 뗌 — 고르기 */
  onPickIsland?: () => void;
  /** 쿡탑(기기) — 눌렀다 뗌 = 고르기, 끌기 = 상판 위 어디로든 (마우스 바닥 점 · 누른 점 mm) */
  onPickHob?: () => void;
  onDragHob?: (p: [number, number], p0: [number, number], done: boolean) => void;
  private hobDrag?: { p0: [number, number]; p: [number, number]; moved: boolean };
  /** 고리 보이기 — 가운데 · 반지름 (mm) · 손잡이 방향(atan2(x, z), 장 앞면 쪽). null 이면 숨김 */
  setIslandRing(r: { c: [number, number]; R: number; knob: number; y?: number; step?: number; deg?: number } | null) {
    if (this.ringLabel) this.ringLabel.hidden = true;
    if (this.islRing) { this.scene.remove(this.islRing.g); this.islRing.g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); this.islRing = undefined; }
    this.invalidate();
    if (!r) return;
    const mat = new THREE.MeshBasicMaterial({ color: '#2f6bff', transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    const g = new THREE.Group();
    const R = r.R * S;
    const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.025, R + 0.025, 128), mat);
    ring.rotation.x = -Math.PI / 2;
    const knob = new THREE.Mesh(new THREE.CircleGeometry(0.09, 32), mat);
    knob.rotation.x = -Math.PI / 2; knob.position.set(R * Math.sin(r.knob), 0.001, R * Math.cos(r.knob));
    // 손잡이 안 화살표 — 돌리는 손잡이임을 알게
    const arrow = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24, 1, 0.4, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false, side: THREE.DoubleSide }));
    arrow.rotation.x = -Math.PI / 2; arrow.position.copy(knob.position).setY(0.002);
    for (const m of [ring, knob, arrow]) { m.renderOrder = 21; g.add(m); }
    const y = (r.y ?? 20) * S;
    g.position.set(r.c[0] * S, y, r.c[1] * S);
    this.scene.add(g);
    // 각도 글자 자리 — 손잡이 바깥(고리 무리 좌표). 고리가 돌면 따라 돈다
    const kp = new THREE.Vector3((R + 0.26) * Math.sin(r.knob), 0.002, (R + 0.26) * Math.cos(r.knob));
    this.islRing = { c: r.c, R: r.R, g, y, step: r.step ?? 90, kp };
    if (r.deg != null) this.setRingLabel(r.deg);
  }
  /** 회전 고리 옆 각도 글자 — 0~359° 로 */
  setRingLabel(deg: number) {
    if (!this.islRing) return;
    if (!this.ringLabel) {
      const el = document.createElement('div'); el.className = 'rot-deg'; el.hidden = true;
      this.host.append(el); this.ringLabel = el;
    }
    this.ringLabel.textContent = `${((Math.round(deg) % 360) + 360) % 360}°`;
    this.ringLabel.hidden = false;
    this.placeRingLabel();
  }
  private placeRingLabel() {
    const r = this.islRing, el = this.ringLabel;
    if (!r || !el || el.hidden) return;
    r.g.updateMatrixWorld();
    const v = r.g.localToWorld(r.kp.clone()).project(this.camera);
    const off = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
    el.style.visibility = off ? 'hidden' : '';
    const cv = this.renderer.domElement;
    el.style.left = `${((v.x + 1) / 2) * cv.clientWidth}px`; el.style.top = `${((1 - v.y) / 2) * cv.clientHeight}px`;
  }
  /** 마우스가 고리(또는 손잡이) 위면 그 방향 각, 아니면 null */
  private ringAt(e: PointerEvent, any = false): number | null {
    const g = this.islRing, p = g && this.floorPoint(e, g.y);
    if (!g || !p) return null;
    const dx = p[0] - g.c[0], dz = p[1] - g.c[1];
    return any || Math.abs(Math.hypot(dx, dz) - g.R) < 140 ? Math.atan2(dx, dz) : null;
  }
  /** 벽 화살표 — 고른 벽의 양 끝에서 벽을 따라 바깥쪽을 가리킨다. 끌면 그 끝이 늘고(+) 줄어든다(-). 몇 번째 화살표인지 · 길이(mm) */
  private wallArrows: { g: THREE.Group; p: [number, number]; dir: [number, number]; y: number; base: THREE.Vector3 }[] = [];
  private arrowDrag?: { i: number; s0: number; d: number };
  onDragWallArrow?: (i: number, delta: number, done: boolean) => void;
  setWallArrows(list: { p: [number, number]; dir: [number, number]; y?: number }[]) {
    for (const a of this.wallArrows) { this.scene.remove(a.g); a.g.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); }
    this.wallArrows = [];
    this.invalidate();
    for (const a of list) {
      const mat = new THREE.MeshBasicMaterial({ color: '#2f6bff', transparent: true, opacity: 0.9, depthTest: false });
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 16), mat);
      shaft.rotation.z = -Math.PI / 2; shaft.position.x = 0.17;
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 24), mat);
      head.rotation.z = -Math.PI / 2; head.position.x = 0.44;
      // 잡는 자리 — 화살 뒤 원판
      const grip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 12), mat);
      for (const m of [shaft, head, grip]) { m.renderOrder = 22; g.add(m); }
      const y = (a.y ?? 1200) * S;
      g.position.set(a.p[0] * S, y, a.p[1] * S);
      g.rotation.y = Math.atan2(-a.dir[1], a.dir[0]);
      this.scene.add(g);
      this.wallArrows.push({ g, p: a.p, dir: a.dir, y, base: g.position.clone() });
    }
  }
  /** 화살표 위 — 몇 번째 · 그 화살표 축을 따라 잰 자리(mm), 아니면 null. only 를 주면 그 화살표 축으로만(끄는 중) */
  private arrowAt(e: PointerEvent, only?: number): { i: number; along: number } | null {
    for (let i = 0; i < this.wallArrows.length; i++) {
      if (only != null && i !== only) continue;
      const w = this.wallArrows[i], p = this.floorPoint(e, w.y);
      if (!p) continue;
      const dx = p[0] - w.p[0], dz = p[1] - w.p[1];
      const along = dx * w.dir[0] + dz * w.dir[1], side = Math.abs(-dx * w.dir[1] + dz * w.dir[0]);
      if (only != null || (along > -150 && along < 620 && side < 130)) return { i, along };
    }
    return null;
  }
  /** 아일랜드 가운데 (mm) — 끌기 시작점 */
  getIsland?: () => { x: number; z: number } | null;
  onDragIsland?: (x: number, z: number, done: boolean) => void;
  /** 하부장 끌기 — 지금 마우스 바닥 점 · 누른 바닥 점 (mm). 받는 쪽이 옆 장 사이에 끼워 넣는다 */
  onDragItem?: (item: Item, p: [number, number], p0: [number, number], done: boolean) => void;
  /** 장을 눌렀다 뗌(끌지 않음) — 고르기 */
  onPickItem?: (item: unknown | null) => void;
  onPickWall?: (w: number) => void;
  private wallPending?: { w: number; x: number; y: number; end?: [number, number] };
  /** 벽 두께 면(끝면)을 눌렀다 뗌 — 그 면을 뽑아내기(익스트루드) */
  onPickWallEnd?: (w: number, p: [number, number]) => void;
  private pickPending?: { item: unknown; x: number; y: number };
  /** 벽 마감(타일 · 벽판넬) 누름 — 떼면 고르기 */
  private splashPending?: { w: number; x: number; y: number };
  onPickSplash?: (w: number) => void;
  /** 식탁 누름 — 떼면 고르기 */
  onPickDining?: () => void;
  private diningPending?: { x: number; y: number };
  /** 지금 선택 — 선택된 것만 끌어 옮긴다(선택과 동시에 옮기면 카메라를 돌리려다 장이 움직였다). main 이 넘겨준다 */
  getSel?: () => { item?: unknown; island?: boolean; hob?: boolean; opening?: string | null; dining?: boolean };
  /** 식탁 — 고른 뒤 끌어 옮기기 (가운데 mm) */
  getDining?: () => { x: number; z: number } | null;
  onDragDining?: (x: number, z: number, done: boolean) => void;
  private dinDrag?: { dx: number; dz: number; moved: boolean; x0: number; z0: number };
  /** 선택 안 된 것을 누름 — 끌지 않고 떼면 그때 고른다(끌면 카메라 회전) */
  private hobPending?: { x: number; y: number };
  private islPending?: { x: number; y: number };
  private opPending?: { id: string | null; x: number; y: number };
  private clearPending?: { x: number; y: number };
  private selBox?: THREE.Object3D;
  private hdr = new Map<string, Promise<THREE.Texture>>();
  /** 창밖 풍경 바꾸기 */
  setOutdoor(key: string) {
    const o = OUTDOOR[key] ?? OUTDOOR.city;
    let p = this.hdr.get(key);
    if (!p) {
      p = new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}env/${o.file}`).then((t) => { t.mapping = THREE.EquirectangularReflectionMapping; return t; });
      this.hdr.set(key, p);
    }
    void p.then((t) => { this.scene.background = t; this.outsideGain = o.gain; this.scene.backgroundIntensity = 0.9 * this.skyK * o.gain; this.scene.backgroundRotation.set(0, o.rot * Math.PI / 180, 0); this.envDirty = true; this.invalidate(); });
  }
  /** 고른 것 표시 — 반투명 파란 상자 + 굵은 테두리 (가려도 보이게 위에 그림) */
  highlight(obj: THREE.Object3D | THREE.Box3 | null) {
    if (this.selBox) { this.scene.remove(this.selBox); this.selBox.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); }); this.selBox = undefined; }
    this.invalidate();
    if (!obj) return;
    const b = obj instanceof THREE.Box3 ? obj.clone() : new THREE.Box3().setFromObject(obj);
    b.expandByScalar(0.008);
    const size = b.getSize(new THREE.Vector3()), c = b.getCenter(new THREE.Vector3());
    const g = new THREE.Group();
    const fill = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), new THREE.MeshBasicMaterial({ color: '#2f6bff', transparent: true, opacity: 0.16, depthTest: false }));
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z)), new THREE.LineBasicMaterial({ color: '#2f6bff', depthTest: false }));
    fill.renderOrder = edge.renderOrder = 20;
    g.add(fill, edge); g.position.copy(c);
    this.selBox = g;
    this.scene.add(g);
  }
  /** 개구부 표시 (창 · 문 · 공간) */
  highlightOpening(id: string | null) {
    if (!id || !this.room) { this.highlight(null); return; }
    const hit = this.room.pick.find((p) => p.userData.openingId === id);
    if (hit) this.highlight(new THREE.Box3().setFromObject(hit));
  }
  private itemDrag?: { item: Item; p0: [number, number]; p: [number, number]; moved: boolean };
  /** 개구부를 끌 때마다 — 벽 · 위치 (mm) */
  onDragOpening?: (id: string, wall: 0 | 1 | 2 | 3, t: number, done: boolean) => void;
  onPickOpening?: (id: string | null) => void;
  getDesign!: () => Design;

  /* ───────── 필요할 때만 그리기 ─────────
   * 가만히 있으면 그리지 않는다(사용자 지시 2026-11-06 「아무것도 안 할 때는 그리지 말고」). 예전엔 매 프레임 후처리 전체와
   * 그림자 맵 2장을 다시 그렸다(가만히 2초에 120장 · 프레임당 드로우콜 1,360). 무언가 바뀌면 invalidate() — 시간 누적(TRAA · SSGI · GTAO)이
   * 가라앉을 만큼(raster.settleFrames) 더 그리고 멈춘다. 캔버스는 마지막 그림을 그대로 보여 준다 */
  private wake = 0;
  /** 그림자 맵을 다시 그릴지 — 해 · 메인 조명 그림자 맵은 시점과 무관해 카메라만 돌 땐 그대로 쓴다. 물체 · 빛이 바뀔 때만 */
  private shadowDirty = true;
  private lastView = new THREE.Matrix4();
  private lastProj = new THREE.Matrix4();
  /** 화면이 바뀌었다 — shadows = 물체 · 빛도 바뀌어 그림자 맵까지 다시 */
  invalidate(shadows = false) {
    this.wake = Math.max(this.wake, this.raster.settleFrames + 2);
    if (shadows) this.shadowDirty = true;
  }
  /** 장면 속 물체를 끄는 중인지 — 그동안은 그림자도 따라가야 한다 */
  private dragging() { return !!(this.itemDrag || this.islDrag || this.hobDrag || this.dinDrag || this.drag || this.ringDrag || this.arrowDrag); }

  /* ───────── 성능 단계 ───────── */
  quality: Quality = 'high';
  /** 단계 바꾸기 — 화면 배율 · 그림자 맵 크기 · 라이트맵 굵기, post = 후처리 값까지(고르면 true. 시작할 땐 저장된 후처리를 그대로 두려고 false) */
  setQuality(q: Quality, post: boolean) {
    const t = QUALITY_TIERS[q];
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, t.dpr));
    this.resize();
    if (post) this.setPost(t.post);
    // 그림자 맵 — 해는 방 크기 판단(setRoom)과 단계 상한 중 작은 쪽, 메인 조명은 단계 값
    const sunMs = Math.min(this.sunMapWant, t.shadow);
    if (this.sun.shadow.mapSize.x !== sunMs) { this.sun.shadow.mapSize.set(sunMs, sunMs); this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: unknown }).map = null; }
    for (const o of this.lamps.children) {
      const l = o as THREE.SpotLight;
      if (l.isSpotLight && l.castShadow && l.shadow.mapSize.x !== t.lampShadow) { l.shadow.mapSize.set(t.lampShadow, t.lampShadow); l.shadow.map?.dispose(); (l.shadow as { map: unknown }).map = null; }
    }
    this.frameDts.length = 0;
    this.scheduleSpaceAO();
    this.invalidate(true);
  }
  /** 방 크기로 정한 해 그림자 맵(단계 상한 전) */
  private sunMapWant = 2048;
  /* 돌릴 때 한 장 간격 — 이어서 그린 프레임 사이 시간(ms). 자동 단계가 이것으로 느린지 본다 */
  private frameDts: number[] = [];
  private lastRenderAt = 0;
  private orbiting = false;
  frameStats() {
    const v = [...this.frameDts].sort((a, b) => a - b);
    return { n: v.length, med: v.length ? v[v.length >> 1] : 0, p90: v.length ? v[Math.floor(v.length * 0.9)] : 0 };
  }

  constructor(private host: HTMLElement) {
    this.raster = createRaster(this.scene, this.camera, this.sun);
    this.renderer = this.raster.renderer;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 노출 — 톤매핑은 후처리 설정(기본 ACES), 노출 = 부엌 기준 × 후처리 노출 배율
    this.renderer.toneMappingExposure = KITCHEN_EXPOSURE * this.raster.post.exposure;
    host.append(this.renderer.domElement);
    this.scene.environmentIntensity = 0.55;
    this.scene.background = new THREE.Color('#e9ecef');
    this.setOutdoor('city');
    this.scene.add(this.hemi, this.windowLights);
    { const s = loadLight(); if (s) { Object.assign(this.sunCfg, s.sun ?? {}); Object.assign(this.roomCfg, s.room ?? {}); Object.assign(this.shadowCfg, s.shadow ?? {}); this.sunUser = !!s.sunUser; } }
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    // 그림자 맵은 물체 · 빛이 바뀔 때만 다시 그린다(frame 의 shadowDirty)
    this.sun.shadow.autoUpdate = false;
    this.scene.add(this.sun, this.sun.target, this.lamps);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 18;
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    // WebGPU 는 장치 준비가 비동기 — 끝나면 실내 환경맵을 만들고 그리기 시작
    this.sun.shadow.camera.layers.enableAll();
    for (const c of this.envCam.children) c.layers.enableAll();
    void RoomEnvironment;
    void this.raster.init().then(() => {
      this.envDirty = true;
      this.renderer.setAnimationLoop(() => this.frame());
    });
    this.controls.addEventListener('change', () => { if (this.mode === 'gpupt') gpt?.gpuPtCamera(); });
    this.controls.addEventListener('start', () => { this.orbiting = true; });
    this.controls.addEventListener('end', () => { this.orbiting = false; });
    // 사용자 입력 — 무엇이 바뀔지 모르니 그린다. 3D 화면에서 카메라만 돌리면 그림자 맵은 그대로, 3D 밖(평면도 · 메뉴)에서 끌거나
    // 값을 바꾸면 장 · 빛이 움직이므로 그림자 맵도. 버튼을 안 누른 마우스 이동(커서만 바뀜)은 무시
    const poke = (e: Event) => {
      if (e.type === 'pointermove' && !(e as PointerEvent).buttons) return;
      const camOnly = e.target === el && (e.type === 'pointermove' || e.type === 'wheel') && !this.dragging();
      this.invalidate(!camOnly);
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'input', 'change']) window.addEventListener(t, poke, { capture: true, passive: true });
    // 텍스처 · 모델 · HDR 을 다 받으면(비동기 — 입력이 끝난 뒤 도착한다) 다시 그린다
    const lm = THREE.DefaultLoadingManager, prevProgress = lm.onProgress;
    lm.onProgress = (url, loaded, total) => { prevProgress?.(url, loaded, total); this.invalidate(); };
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.raster.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  setRoom(r: RoomObj, d: Design) {
    const old = this.room;
    if (old) this.scene.remove(old.group);
    this.room = r;
    this.scene.add(r.group);
    if (old && old !== r) this.disposeRoom(old);
    if (this.lines) this.applyLines();
    this.sceneChanged();
    // 해 — 첫 창 바깥에서 비스듬히
    const win = d.openings.find((o) => o.kind === 'window');
    const c = new THREE.Vector3(d.room.w * S / 2, 0, d.room.d * S / 2);
    this.sun.target.position.copy(c);
    if (!this.sunUser) {
      // 해 — 첫 창 바깥에서 비스듬히 (방위 · 고도로 바꿔 둔다 — 조명 패널이 이 값에서 시작)
      const p = new THREE.Vector3();
      if (win) {
        const wd = r.walls.find((x) => x.wall === win.wall)!;
        p.copy(wd.p).addScaledVector(wd.n, -6); p.y = 5;
        p.add(new THREE.Vector3(-wd.n.z, 0, wd.n.x).multiplyScalar(2.5));
      } else p.set(c.x + 4, 6, c.z - 5);
      const dv = p.sub(c).normalize();
      void dv.y;   // 고도는 설정값 그대로(붙박이장 42°) — 방위만 창 바깥 쪽으로
      this.sunCfg.azimuth = Math.round(THREE.MathUtils.radToDeg(Math.atan2(dv.z, dv.x)));
    }
    // 창 빛 — 창마다 안쪽을 비추는 사각 조명(하늘 산란광). 실사 모드에선 끈다(경로 추적은 하늘을 직접 본다)
    this.windowLights.clear();
    for (const o of d.openings) {
      if (o.kind !== 'window') continue;
      const wd = r.walls.find((x) => x.wall === o.wall); if (!wd) continue;
      const f = { o: wd.p.clone(), n: wd.n };
      const along = new THREE.Vector3(-wd.n.z, 0, wd.n.x);
      // 벽 가운데(wd.p)에서 벽 시작까지 — 벽 프레임 t 를 다시 구하지 않고 room 의 벽 프레임 함수로
      const fr = wallFrameOf(d, o.wall);
      const cx = (fr.o[0] + fr.dir[0] * (o.t + o.w / 2)) * S, cz = (fr.o[1] + fr.dir[1] * (o.t + o.w / 2)) * S;
      const l = new THREE.RectAreaLight(0xe6edff, WINDOW_NITS, o.w * S, o.h * S);
      l.position.set(cx + fr.n[0] * 0.02, (o.sill + o.h / 2) * S, cz + fr.n[1] * 0.02);
      l.lookAt(cx + fr.n[0], (o.sill + o.h / 2) * S - 0.35, cz + fr.n[1]);
      void f; void along;
      this.windowLights.add(l);
    }
    // 해 그림자 범위 — 부엌만이 아니라 거실 · 벽 너머 공간까지 방 전체. 예전엔 부엌 크기만 덮어 그 밖(거실)은 그림자가 없어
    // 벽을 뚫은 것처럼 햇빛이 들었다(사용자 지적 2026-11-05)
    const bb = new THREE.Box3().setFromObject(r.group);
    let ext = 0;
    for (const x of [bb.min.x, bb.max.x]) for (const z of [bb.min.z, bb.max.z]) ext = Math.max(ext, Math.hypot(x - c.x, z - c.z));
    ext += 0.3;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -ext; cam.right = cam.top = ext; cam.near = 0.5; cam.far = 12 + ext * 2; cam.updateProjectionMatrix();
    // 넓어진 만큼 해상도도 — 텍셀이 너무 커지지 않게(방 전체 ~14m 에 4096 → 3.5mm)
    this.sunMapWant = ext > 5 ? 4096 : 2048;
    const ms = Math.min(this.sunMapWant, QUALITY_TIERS[this.quality].shadow);
    if (this.sun.shadow.mapSize.x !== ms) { this.sun.shadow.mapSize.set(ms, ms); this.sun.shadow.map?.dispose(); (this.sun.shadow as { map: unknown }).map = null; }
    // 천장 조명 — 격자 다운라이트. 지금은 끔(사용자: 천장 조명 일단 다 빼) — 다시 켜려면 CEILING_LAMPS
    this.lamps.clear();
    const nx = Math.max(2, Math.round(d.room.w / 1400)), nz = Math.max(2, Math.round(d.room.d / 1400));
    // 실내 조명 — 붙박이장 플래너와 같은 구성: 천장 가운데 메인 조명(그림자 · 반각 63°) + 격자 다운라이트(그림자 없음 → 공간 라이트맵에 굽는다).
    // 세기 = 조명 패널 「실내 조명」 × 기준 칸델라. 끌 때도 숨기지 않고 밝기만 0(조명 개수가 바뀌면 모든 재질 셰이더를 다시 짓는다)
    const H = d.room.h * S - 0.02;
    const spot = (x: number, z: number, cd: number, angle: number, penumbra: number, shadow: boolean) => {
      const l = new THREE.SpotLight(0xffffff, cd, 0, angle, penumbra, 2);
      l.position.set(x, H, z); l.target.position.set(x, 0, z); l.userData.cd = cd;
      l.castShadow = shadow;
      // 그림자 맵은 바뀔 때만, 그리고 켜져 있을 때만(frame) — three 는 castShadow 면 밝기 0 이어도 매 프레임 그림자 맵을 그린다
      if (shadow) { const lm = QUALITY_TIERS[this.quality].lampShadow; l.shadow.mapSize.set(lm, lm); l.shadow.camera.near = 0.1; l.shadow.camera.far = 8; l.shadow.bias = -0.0005; l.shadow.normalBias = 0.02; l.shadow.camera.layers.enableAll(); l.shadow.autoUpdate = false; }
      this.lamps.add(l, l.target);
      return l;
    };
    spot(d.room.w * S / 2, d.room.d * S / 2, MAIN_CD, 1.1, 0.7, true).userData.main = true;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) spot((i + 0.5) * d.room.w * S / nx, (j + 0.5) * d.room.d * S / nz, DOWNLIGHT_CD, 0.75, 0.6, false);
    void CEILING_LAMPS;
    // 공간 면(벽 · 바닥 · 천장) 표시 — 금속성 1/255. 라이트맵이 덮는 자리엔 화면 그늘 · 간접광을 겹치지 않는다(raster.ts)
    r.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && /^(floor|living-floor|ceiling|wall-)/.test(m.name)) for (const mt0 of [m.material].flat() as THREE.MeshStandardMaterial[]) if (!mt0.metalness) mt0.metalness = SPACE_FLAG; });
    // 벽 그림자는 빛 쪽 면(바깥면)으로 — three 기본(뒷면 = 실내 쪽 면)이면 벽 · 바닥 · 벽끼리 만나는 모서리에서 그림자 보정(바이어스)만큼
    // 그림자가 밀려 실내에 가는 빛줄이 샜다(닫힌 방 시험 — 해만 켜도 모서리 · 바닥 경계가 밝아짐). 붙박이장 플래너와 같은 처리
    r.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && /^wall-/.test(m.name)) for (const mt0 of [m.material].flat()) if (mt0.shadowSide !== THREE.FrontSide) { mt0.shadowSide = THREE.FrontSide; mt0.needsUpdate = true; } });
    this.design = d;
    this.applySun(); this.applyRoom();
    this.applyFloorReflection();
    this.depthWindow();
    this.envDirty = true;
    this.scheduleSpaceAO();
    this.invalidate(true);
  }
  private design?: Design;
  /** 옛 방 놓기 — 방은 그릴 때마다 형상 · 재질 · 텍스처(바닥 · 벽지)를 새로 만든다(창을 끄는 동안엔 매 프레임). 라이트맵 사본은 원본으로 되돌린 뒤
   *  사본만 놓는다(사본은 원본 텍스처 · 공간 라이트맵을 빌려 쓴다) */
  private disposeRoom(old: RoomObj) {
    const origOf = new Map<THREE.Material, THREE.Material>();
    this.lmMats.forEach((c, o) => origOf.set(c, o));
    this.floorNode.forEach((c, o) => origOf.set(c, o));
    old.group.traverse((o) => { const m = o as THREE.Mesh; const orig = m.material ? origOf.get(m.material as THREE.Material) : undefined; if (orig) m.material = orig; });
    for (const c of this.lmMats.values()) c.dispose();
    this.lmMats.clear();
    for (const c of this.floorNode.values()) c.dispose();
    this.floorNode.clear();
    disposeTree(old.group);
  }

  /* ───────── 바닥 거울 반사 — 실시간(WebGPU)에서만. 바닥 아래로 뒤집은 카메라로 방을 한 번 더 그려 바닥 재질에 얹는다 ─────────
   * 사용자 지시 2026-11-06 「마루 빛반사 말고 바닥에 거울처럼 반사 — 빛 반사는 지금도 강해」 → 재질의 거칠기 · 하이라이트는 그대로 두고
   * 비친 방만 더한다. 비스듬히 볼수록 진하게(프레넬, 정면 6%), 세기 · 흐림은 후처리 「바닥 반사」. 붙박이장 플래너 거울 · 하이글로시 도어와 같은 방식.
   * 화면 반사(SSR)와 달리 화면 밖 물체도 비친다. 실사(경로 추적) · 굽기 · 서펠은 원래 재질 — 노드 재질을 읽지 못한다 */
  private floorRefl: { node: { dispose(): void }; target: THREE.Object3D; emit: ReturnType<typeof float>; amt: ReturnType<typeof uniform>; blur: ReturnType<typeof uniform> } | null = null;
  /** 라이트맵 전(또는 공간 라이트맵 끔) 바닥 — 원래 재질 → 반사를 얹은 노드 재질 사본 */
  private floorNode = new Map<THREE.Material, MeshPhysicalNodeMaterial>();
  private floorOrig(m: THREE.Material) { for (const [o, c] of this.floorNode) if (c === m) return o; return undefined; }
  private floors() {
    const out: THREE.Mesh[] = [];
    this.room?.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'floor') out.push(o as THREE.Mesh); });
    return out;
  }
  private applyFloorReflection() {
    const amt = this.raster.post.floorRefl ?? 0;
    const on = this.mode === 'raster' && this.raster.kind === 'webgpu' && amt > 0;
    const floors = this.floors();
    if (!on) {
      for (const f of floors) { const o = this.floorOrig(f.material as THREE.Material); if (o) f.material = o; }
      // 반사를 통째로 놓는다 — 반사 텍스처를 쥔 바닥 재질(라이트맵 사본 · 반사 사본)에서 떼고 노드 · 렌더 타깃까지.
      // 붙여 둔 채 실사 · 서펠에 갔다 오면 「파괴된 텍스처를 제출에 사용」 WebGPU 오류가 매 프레임 났다(실측 2026-11-06). 돌아오면 새로 만든다
      const fr = this.floorRefl;
      if (fr) {
        for (const m of [...this.floorNode.values(), ...this.lmMats.values()] as unknown as { emissiveNode: unknown; needsUpdate: boolean }[]) if (m.emissiveNode === fr.emit) { m.emissiveNode = null; m.needsUpdate = true; }
        fr.target.removeFromParent();
        fr.node.dispose();
        this.floorRefl = null;
      }
      return;
    }
    const fr = this.floorReflNode();
    fr.amt.value = amt; fr.blur.value = this.raster.post.floorBlur ?? 0.25;
    for (const f of floors) {
      let m = f.material as THREE.Material;
      if (!(m as unknown as { isNodeMaterial?: boolean }).isNodeMaterial) {
        let c = this.floorNode.get(m);
        if (!c) { c = new MeshPhysicalNodeMaterial(); for (const k of Stage.LM_KEYS) if ((m as any)[k] !== undefined) (c as any)[k] = (m as any)[k]; c.name = m.name; this.floorNode.set(m, c); }
        f.material = c; m = c;
      }
      const n = m as unknown as { emissiveNode: unknown };
      if (n.emissiveNode !== fr.emit) { n.emissiveNode = fr.emit; m.needsUpdate = true; }
    }
    this.invalidate();
  }
  private floorReflNode() {
    if (this.floorRefl) return this.floorRefl;
    // 반사면 — 바닥(y 0) 바로 위, 앞(+z)이 위를 보게. 방을 다시 만들어도 바닥 높이는 같아서 장면에 하나만 둔다
    const target = new THREE.Object3D(); target.name = 'floor-mirror';
    target.position.set(0, 0.0005, 0); target.rotation.x = -Math.PI / 2;
    this.scene.add(target);
    const node = reflector({ resolutionScale: 0.5, target, generateMipmaps: true });
    const base = (node as unknown as { reflector: { updateBefore(f: { camera: THREE.Camera; frameId: number }): void } }).reflector;
    // 화면 카메라로 그릴 때만, 프레임에 한 번 — three 기본은 그림자 지도 · 실내 환경맵 · 다른 반사를 그릴 때마다 방을 다시 그린다.
    // 그리는 동안 숨기는 것:
    //  - 바닥 — 반사 텍스처를 읽는 바닥이 같은 텍스처에 그려지면 WebGPU 읽기 · 쓰기 충돌(붙박이장 거울에서 실측)
    //  - 투과 재질(창 유리 · 유리 도어) — 투과는 그리던 화면을 공용 텍스처에 복사해 쓰는데, 반사(절반 크기)와 본 화면이 한 프레임에
    //    그 텍스처 크기를 번갈아 바꿔 「파괴된 텍스처를 제출에 사용」 WebGPU 오류가 매 프레임 났다(실측 2026-11-06 — 창 크기를 바꾸거나 실사에 갔다 오면)
    const orig = base.updateBefore.bind(base);
    let last = -1;
    base.updateBefore = (frame) => {
      if (frame.camera !== this.camera || last === frame.frameId) return;
      last = frame.frameId;
      const hide: THREE.Object3D[] = this.floors();
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && o.visible && ([m.material].flat() as THREE.MeshPhysicalMaterial[]).some((x) => (x?.transmission ?? 0) > 0)) hide.push(o);
      });
      const was = hide.map((o) => o.visible);
      for (const o of hide) o.visible = false;
      try { orig(frame); } finally { hide.forEach((o, i) => { o.visible = was[i]; }); }
    };
    const amt = uniform(1), blur = uniform(0.25);
    // 프레넬 — 정면 6%, 비스듬할수록 진하게(코팅한 마루 · 광택 타일)
    const cos = normalView.dot(positionViewDirection).abs().clamp(0, 1);
    const fres = float(1).sub(cos).pow(5).mul(0.94).add(0.06);
    const emit = node.level(blur.mul(6)).rgb.mul(fres).mul(amt) as unknown as ReturnType<typeof float>;
    this.floorRefl = { node, target, emit, amt, blur };
    return this.floorRefl;
  }

  /* ───────── 상판 반사 — 대리석 · 엔지니어드 스톤 상판 윗면에 방이 비친다(실시간 WebGPU). 바닥 반사와 같은 방식, 높이 910 면 ─────────
   * 사용자 지시 2026-11-06 「대리석 상판들도 텍스쳐에 따라서 반사값을 적용」 — 상판 종류마다 세기 · 흐림이 다르다(counterGloss).
   * 후처리 「상판 반사」는 전체 배율(0 = 끔). 윗면에만 — 옆면 · 다른 높이 판(식탁형 아일랜드 등)엔 얹지 않는다 */
  private counterRefl: { node: { dispose(): void }; target: THREE.Object3D; tex: ReturnType<typeof reflector> } | null = null;
  /** 상판 원래 재질 → 반사를 얹은 노드 사본(세기 유니폼 · 종류별 기본 세기) */
  private counterNode = new Map<THREE.Material, { mat: MeshPhysicalNodeMaterial; amt: ReturnType<typeof uniform>; base: number }>();
  private counterOrig(m: THREE.Material) { for (const [o, c] of this.counterNode) if (c.mat === m) return o; return undefined; }
  private counters() {
    const out: THREE.Mesh[] = [];
    this.kitchen?.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === 'counter') out.push(o as THREE.Mesh); });
    return out;
  }
  /** 상판 종류별 [반사 세기, 흐림] — 광을 낸 마블이 가장 또렷하고, 콘크리트 느낌 · 스테인리스(헤어라인)는 흐리다 */
  private static counterGloss(name: string): [number, number] {
    if (/마블/.test(name)) return [0.35, 0.08];
    if (/글램/.test(name)) return [0.3, 0.12];
    if (/콘크리트/.test(name)) return [0.08, 0.45];
    if (/HS스톤/.test(name)) return [0.2, 0.15];
    if (/테라조/.test(name)) return [0.15, 0.25];
    if (/스테인/.test(name)) return [0.2, 0.6];
    return [0.12, 0.3];
  }
  private applyCounterReflection() {
    const k = this.raster.post.counterRefl ?? 0;
    const on = this.mode === 'raster' && this.raster.kind === 'webgpu' && k > 0;
    const counters = this.counters();
    if (!on) {
      for (const m of counters) { const o = this.counterOrig(m.material as THREE.Material); if (o) m.material = o; }
      if (this.counterRefl) { this.counterRefl.target.removeFromParent(); this.counterRefl.node.dispose(); this.counterRefl = null; }
      for (const c of this.counterNode.values()) c.mat.dispose();
      this.counterNode.clear();
      return;
    }
    const r = this.counterReflNode();
    for (const mesh of counters) {
      const cur = mesh.material as THREE.Material;
      const orig = this.counterOrig(cur) ?? cur;
      let c = this.counterNode.get(orig);
      if (!c) {
        const mat = new MeshPhysicalNodeMaterial();
        for (const key of Stage.LM_KEYS) if ((orig as any)[key] !== undefined) (mat as any)[key] = (orig as any)[key];
        mat.name = orig.name;
        const [base, blur] = Stage.counterGloss(orig.name);
        const amt = uniform(base * k);
        const cos = normalView.dot(positionViewDirection).abs().clamp(0, 1);
        const fres = float(1).sub(cos).pow(5).mul(0.94).add(0.06);
        // 윗면만 — 위를 보는 면 · 높이 910 근처
        const top = smoothstep(0.9, 0.98, normalWorld.y).mul(step(abs(positionWorld.y.sub(COUNTER_TOP * S)), 0.006));
        mat.emissiveNode = r.tex.level(float(blur * 6)).rgb.mul(fres).mul(amt).mul(top);
        c = { mat, amt, base };
        this.counterNode.set(orig, c);
      }
      c.amt.value = c.base * k;
      mesh.material = c.mat;
    }
    this.invalidate();
  }
  private counterReflNode() {
    if (this.counterRefl) return this.counterRefl;
    const target = new THREE.Object3D(); target.name = 'counter-mirror';
    target.position.set(0, COUNTER_TOP * S + 0.0005, 0); target.rotation.x = -Math.PI / 2;
    this.scene.add(target);
    const tex = reflector({ resolutionScale: 0.5, target, generateMipmaps: true });
    const base = (tex as unknown as { reflector: { updateBefore(f: { camera: THREE.Camera; frameId: number }): void } }).reflector;
    // 바닥 반사와 같은 규칙 — 화면 카메라 · 프레임에 한 번, 그리는 동안 상판(읽기 · 쓰기 충돌)과 투과 재질(공용 화면 복사 텍스처 크기 충돌)은 숨긴다
    const orig = base.updateBefore.bind(base);
    let last = -1;
    base.updateBefore = (frame) => {
      if (frame.camera !== this.camera || last === frame.frameId) return;
      last = frame.frameId;
      const hide: THREE.Object3D[] = this.counters();
      this.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && o.visible && ([m.material].flat() as THREE.MeshPhysicalMaterial[]).some((x) => (x?.transmission ?? 0) > 0)) hide.push(o);
      });
      const was = hide.map((o) => o.visible);
      for (const o of hide) o.visible = false;
      try { orig(frame); } finally { hide.forEach((o, i) => { o.visible = was[i]; }); }
    };
    this.counterRefl = { node: tex, target, tex };
    return this.counterRefl;
  }

  /* ───────── 실내 환경맵 — 방 가운데서 큐브맵을 찍어 환경광 · 반사로(붙박이장 플래너와 같은 방식).
   *  찍을 때 앞서 찍은 환경맵이 벽을 밝히므로 두 번 찍으면 벽에서 튄 빛(1차 반사광)까지 담긴다 ───────── */
  private envCube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  private envCam = new THREE.CubeCamera(0.05, 30, this.envCube);
  private envRT: THREE.RenderTarget | null = null;
  private envDirty = true;
  private envAt = 0;
  private updateEnv() {
    if (this.mode !== 'raster' || !this.raster.ready || !this.design) return;
    this.envDirty = false; this.envAt = performance.now();
    const sel = this.selBox; if (sel) sel.visible = false;
    const d = this.design;
    this.envCam.position.set(d.room.w * S / 2, 1.3, d.room.d * S / 2);
    // 매번 처음부터 두 번만 — 이전 환경맵 위에 계속 찍으면 하얀 닫힌 방에서 빛이 끝없이 불어난다(붙박이장 실측)
    this.scene.environment = null;
    for (let k = 0; k < 2; k++) {
      this.envCam.update(this.renderer as THREE.WebGLRenderer, this.scene);
      this.envRT = this.raster.pmremFromCubemap(this.envCube.texture, this.envRT);
      this.scene.environment = this.envRT.texture;
    }
    this.scene.environmentIntensity = this.roomCfg.env * RASTER_ENV;
    if (sel) sel.visible = true;
  }

  /* ───────── 공간감 — 창에서 멀수록 · 창을 등진 면일수록 어둡게(raster depthFx). 가장 큰 창 기준 ───────── */
  private depthWindow() {
    const wins = this.lightIn().wins;
    const w = wins.sort((a, b) => Math.hypot(...b.u) * Math.hypot(...b.v) - Math.hypot(...a.u) * Math.hypot(...a.v))[0];
    if (!w) { this.raster.setWindow(null); return; }
    const box = this.insideBox(), ax = w.n.findIndex((v) => Math.abs(v) > 0.5);
    const depth = w.n[ax] > 0 ? box.max.getComponent(ax) - w.c[ax] : w.c[ax] - box.min.getComponent(ax);
    this.raster.setWindow({ c: w.c, n: w.n, depth });
  }
  /** 방 안쪽 상자 — 부엌 + 거실 바닥 위(라이트맵: 방 밖을 보는 면은 굽지 않는다) */
  private insideBox() {
    const b = new THREE.Box3();
    this.room?.group.traverse((o) => { if (o.name === 'floor' || o.name === 'living-floor') b.expandByObject(o); });
    const h = (this.design?.room.h ?? 2400) * S;
    b.min.y = -0.01; b.max.y = h + 0.01; b.expandByScalar(0.01);
    return b;
  }
  /** 공간 라이트맵 조명 — 해 · 창(유리 묶음 바깥면에서 하늘빛). 실시간 조명 값 그대로(해 = lux, 창 = nit) */
  private lightIn(): LightIn {
    this.scene.updateMatrixWorld(true);
    const V = () => new THREE.Vector3();
    const sunDir = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const rgb = (c: THREE.Color, k: number) => [c.r * k, c.g * k, c.b * k];
    const inside = this.insideBox(), mid = inside.getCenter(V());
    // 창 — 유리를 평면(얇은 축 · 15cm)으로 묶어 상자 하나씩. 바깥면 2cm 밖에서 빛이 들어온다(창틀이 가린다). 거실 창도 — 트인 곳으로 부엌까지 들어온다
    const groups = new Map<string, THREE.Box3>();
    this.room?.group.traverse((o) => {
      if (o.name !== 'window-glass' || !(o as THREE.Mesh).isMesh) return;
      const b = new THREE.Box3().setFromObject(o), s = b.getSize(V());
      const ax = s.x < s.y && s.x < s.z ? 0 : s.y < s.z ? 1 : 2, c = b.getCenter(V());
      const k = `${ax}|${Math.round(c.getComponent(ax) / 0.15)}|${Math.round(c.getComponent((ax + 1) % 3) / 0.5)}|${Math.round(c.getComponent((ax + 2) % 3) / 3)}`;
      const g = groups.get(k); if (g) g.union(b); else groups.set(k, b);
    });
    const wins: LightIn['wins'] = [];
    const wc = new THREE.Color(0xe6edff), wi = WINDOW_NITS * this.roomCfg.sky;
    for (const [k, b] of groups) {
      const ax = +k.split('|')[0], c = b.getCenter(V()), s = b.getSize(V());
      const n = V(); n.setComponent(ax, Math.sign(mid.getComponent(ax) - c.getComponent(ax)) || 1);
      c.setComponent(ax, (n.getComponent(ax) > 0 ? b.min : b.max).getComponent(ax) - n.getComponent(ax) * 0.02);
      const ua = (ax + 1) % 3, va = (ax + 2) % 3, u = V(), v = V();
      u.setComponent(ua, s.getComponent(ua) / 2); v.setComponent(va, s.getComponent(va) / 2);
      wins.push({ c: c.toArray(), u: u.toArray(), v: v.toArray(), n: n.toArray(), rgb: rgb(wc, wi) });
    }
    const spots: LightIn['spots'] = [];
    this.lamps.traverse((o) => {
      const l = o as THREE.SpotLight;
      if (!l.isSpotLight || l.intensity <= 0) return;
      const p = l.getWorldPosition(V()), dd = l.target.getWorldPosition(V()).sub(p).normalize();
      spots.push({ p: p.toArray(), d: dd.toArray(), cosO: Math.cos(l.angle), cosI: Math.cos(l.angle * (1 - l.penumbra)), rgb: rgb(l.color, l.intensity), bake: !l.castShadow || !!l.userData.main });
    });
    return { sunDir: sunDir.toArray(), sunRgb: rgb(this.sun.color, this.sun.intensity), spots, wins };
  }
  /** 공간 라이트맵을 재질에 — 공간 재질마다 라이트맵을 단 사본(원래 재질은 그대로: 실사 · 굽기 · 서펠이 원본을 쓴다).
   *  WebGPU 는 창 면광원(그림자 없는 가짜 하늘빛)을 뺀 조명만 받는다 — 창 하늘빛은 라이트맵이 그림자까지 담았다. 환경 반사는 조금만 */
  private lmMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private static readonly LM_KEYS = ['color', 'map', 'roughness', 'roughnessMap', 'metalness', 'metalnessMap', 'normalMap', 'normalScale', 'bumpMap', 'bumpScale', 'emissive', 'emissiveMap',
    'emissiveIntensity', 'side', 'shadowSide', 'clearcoat', 'clearcoatRoughness', 'polygonOffset', 'polygonOffsetFactor', 'polygonOffsetUnits', 'colorWrite', 'depthWrite'] as const;
  private shellLightmap(meshes: THREE.Mesh[], tex: THREE.Texture | null) {
    const origOf = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    this.lmMats.forEach((c, o) => origOf.set(c, o as THREE.MeshStandardMaterial));
    this.invalidate();
    if (!tex) { for (const m of meshes) { const o = origOf.get(m.material as THREE.Material); if (o) m.material = o; } this.envDirty = true; this.applyFloorReflection(); return; }
    let ls: ReturnType<typeof lights> | null = null;
    if (this.raster.kind === 'webgpu') {
      // 다운라이트 · 메인 조명은 뺀다 — 라이트맵에 그림자째 구웠다
      const arr: THREE.Light[] = [this.sun, this.hemi];
      this.lamps.traverse((o) => { const l = o as THREE.SpotLight; if (l.isLight && !(l.isSpotLight && (!l.castShadow || l.userData.main))) arr.push(l); });
      ls = lights(arr);
    }
    for (const m of meshes) {
      const cur = m.material as THREE.MeshStandardMaterial;
      const orig = origOf.get(cur) ?? (this.floorOrig(cur) as THREE.MeshStandardMaterial | undefined) ?? cur;   // 바닥 반사 사본이면 그 원래 재질
      let c = this.lmMats.get(orig);
      if (!c) { c = (ls ? new MeshPhysicalNodeMaterial() : new THREE.MeshPhysicalMaterial()) as unknown as THREE.MeshStandardMaterial; c.name = orig.name; this.lmMats.set(orig, c); }
      for (const k of Stage.LM_KEYS) if ((orig as any)[k] !== undefined) (c as any)[k] = (orig as any)[k];
      if (ls) (c as unknown as MeshPhysicalNodeMaterial).lightsNode = ls;
      c.envMapIntensity = (orig.envMapIntensity ?? 1) * 0.25;
      const fresh = !c.lightMap;
      c.lightMap = tex; c.lightMapIntensity = this.raster.post.spaceLMStr ?? 1;
      if (fresh) c.needsUpdate = true;
      m.material = c;
    }
    this.envDirty = true;
    this.applyFloorReflection();     // 라이트맵 사본 바닥에 반사를 다시 얹는다
  }
  /** 공간 라이트맵 다시 굽기 — 0.6초 모아서(끌기 · 연속 변경 중엔 미룬다). 실시간 화면에서만.
   *  한 번에 하나씩 — 굽기(3~6초) 중에 다음 굽기가 시작되면 같은 작업자들의 응답 받는 곳을 덮어써 앞 굽기가 오류로 끝났다
   *  (되돌리기를 빠르게 이어 누를 때 실측 2026-11-06). 앞 굽기가 끝난 뒤 그때의 방으로 굽는다 */
  private aoTimer = 0;
  private aoRun: Promise<unknown> = Promise.resolve();
  scheduleSpaceAO() {
    clearTimeout(this.aoTimer);
    if (this.mode !== 'raster' || !this.raster.post.spaceAO || !this.room) return;
    this.aoTimer = window.setTimeout(() => { this.aoRun = this.aoRun.then(() => this.bakeAO()); }, 600);
  }
  private async bakeAO() {
    if (this.mode !== 'raster' || !this.raster.post.spaceAO || !this.room) return;
    try {
      // 성능 단계 — 저사양은 성긴 판(텍셀 80mm · 튄 빛 광선 10): 굽는 시간이 4코어 노트북에서 몇 배 준다
      const info = await bakeSpaceAO(this.room.group, this.kitchen ? [this.kitchen] : [], this.lightIn(), this.insideBox(), (ms, tex) => this.shellLightmap(ms, tex), (ms) => this.shellLightmap(ms, null), QUALITY_TIERS[this.quality].lightmap);
      if (info) { console.info('[공간 라이트맵]', info); this.envDirty = true; this.invalidate(); }
    } catch (e) { console.warn('[라이트맵] 실패', e); }
  }

  /* ───────── 조명 패널 ───────── */
  private saveLight() { try { localStorage.setItem(LIGHT_KEY, JSON.stringify({ sun: this.sunCfg, room: this.roomCfg, shadow: this.shadowCfg, sunUser: this.sunUser })); } catch { /* 이번 화면엔 반영 */ } }
  setSun(p: Partial<Sun>) { if ('azimuth' in p || 'elevation' in p) this.sunUser = true; Object.assign(this.sunCfg, p); this.applySun(); this.saveLight(); this.pushLight(); this.invalidate(true); }
  setRoomLight(p: Partial<RoomLight>) { Object.assign(this.roomCfg, p); this.applyRoom(); this.saveLight(); this.pushLight(); this.invalidate(true); }
  setShadow(p: Partial<ShadowCfg>) { Object.assign(this.shadowCfg, p); this.applySun(); this.saveLight(); this.invalidate(true); }
  /** 해를 방 가운데 기준으로 처음 자리로 — 방위 · 고도를 창 바깥 쪽으로 다시 */
  resetSunAuto() { this.sunUser = false; this.saveLight(); }
  private applySun() {
    const { azimuth, elevation, intensity, kelvin } = this.sunCfg;
    const az = THREE.MathUtils.degToRad(azimuth), el = THREE.MathUtils.degToRad(elevation);
    this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(12));
    this.sun.intensity = intensity;
    this.sun.color.copy(kelvinColor(kelvin));
    (this.sun.shadow as THREE.LightShadow & { intensity?: number }).intensity = Math.min(1, this.shadowCfg.strength / 1);
    this.sun.shadow.radius = this.shadowCfg.soft;
    this.envDirty = true; this.scheduleSpaceAO?.();
    for (const o of this.lamps.children) { const l = o as THREE.SpotLight; if (l.isSpotLight && l.castShadow) { (l.shadow as THREE.LightShadow & { intensity?: number }).intensity = Math.min(1, this.shadowCfg.strength); l.shadow.radius = this.shadowCfg.soft; } }
  }
  private applyRoom() {
    const { sky, lamp, kelvin, env, exposure, ceiling } = this.roomCfg;
    // 빛 색 — 색온도 × 고른 색(흰색이면 색온도 그대로, 붙박이장 플래너와 같음)
    const col = kelvinColor(kelvin).multiply(new THREE.Color(this.roomCfg.lampColor ?? '#ffffff'));
    // 천장 조명 구성 — 고르지 않은 것은 밝기 0(숨기지 않는다: 조명 개수가 바뀌면 셰이더를 다시 짓는다)
    const on = (l: THREE.Object3D) => ceiling === 'both' || (ceiling === 'main' && !!l.userData.main) || (ceiling === 'down' && !l.userData.main);
    for (const l of this.windowLights.children as THREE.RectAreaLight[]) l.intensity = WINDOW_NITS * sky;
    this.windowLights.visible = this.mode === 'raster' && sky > 0;
    this.envDirty = true; this.scheduleSpaceAO?.();
    for (const o of this.lamps.children) { const l = o as THREE.SpotLight; if (!l.isSpotLight) continue; l.intensity = on(l) ? (l.userData.cd ?? DOWNLIGHT_CD) * lamp : 0; l.color.copy(col); }
    // 창밖 하늘 = 「창 빛」 — 해 세기와 따로(붙박이장 skyLevel 과 같은 식)
    this.skyK = THREE.MathUtils.clamp(sky / 2, 0.02, 2);
    if (this.scene.background && (this.scene.background as THREE.Texture).isTexture) this.scene.backgroundIntensity = 0.9 * this.skyK * this.outsideGain;
    // 반구 보조광도 환경광과 같이 — 밤 · 해질녘에 보조광만 그대로 남아 하얗게 떴다
    this.hemi.intensity = 0;   // 붙박이장 플래너엔 반구 보조광이 없다 — 실내 환경맵 · 라이트맵이 대신
    if (this.mode === 'raster') this.scene.environmentIntensity = env * RASTER_ENV;
    else if (this.rasterEnv) this.rasterEnv.intensity = env;
    this.renderer.toneMappingExposure = KITCHEN_EXPOSURE * exposure * this.raster.post.exposure;
    if (mt) mt.setMutracerExposure(exposure * 1.15);
  }
  /** 후처리 — 노출 배율이 바뀌면 화면 노출도 다시 */
  setPost(p: Partial<import('./render/raster').PostSettings>) {
    this.raster.setPost(p); this.applyRoom();
    if ('floorRefl' in p || 'floorBlur' in p) this.applyFloorReflection();
    if ('counterRefl' in p) this.applyCounterReflection();
    if ('spaceAO' in p) { if (this.raster.post.spaceAO) this.scheduleSpaceAO(); else clearSpaceAO(); }
    if ('spaceLMStr' in p) for (const c of this.lmMats.values()) c.lightMapIntensity = this.raster.post.spaceLMStr ?? 1;
    this.invalidate();
    if ('ssr' in p || 'sss' in p) this.onModeChange?.();
  }
  private pushLight() {
    if (this.mode !== 'bake' && this.mode !== 'surfel') return;
    this.embeds.get(`${this.mode}|${this.stateKey()}`)?.setLight(this.lightPayload());
  }

  /** 벽 타일만 바꿔 끼움 — 창을 끄는 동안 */
  setSplash(s: THREE.Object3D) {
    if (!this.kitchen) return;
    const old = this.kitchen.getObjectByName('splash');
    if (old) { this.kitchen.remove(old); if (old !== s) disposeTree(old); }
    this.kitchen.add(s);
    this.invalidate(true);
  }

  setKitchen(k: THREE.Object3D) {
    const old = this.kitchen;
    if (old) this.scene.remove(old);
    this.kitchen = k;
    this.scene.add(k);
    // 옛 부엌 놓기 — 장 형상 · 재질 캐시(shared)는 남기고 나머지(상판 · 걸레받이 · 찬넬 · EP 등 매번 새로 만든 것)와 렌더러 내부 객체를
    if (old && old !== k) {
      // 상판 반사 사본은 원래 재질로 되돌린 뒤 같이 놓는다(둘 다 이번 부엌을 만들 때 새로 만든 것)
      old.traverse((o) => {
        const m = o as THREE.Mesh, orig = m.isMesh && o.name === 'counter' ? this.counterOrig(m.material as THREE.Material) : undefined;
        if (orig) { this.counterNode.get(orig)!.mat.dispose(); this.counterNode.delete(orig); m.material = orig; }
      });
      disposeTree(old);
    }
    this.applyCounterReflection();
    if (this.lines) this.applyLines();
    this.sceneChanged();
    this.envDirty = true;
    this.scheduleSpaceAO();
    this.invalidate(true);
  }

  /** 보기 — 정면 = 트인 쪽(거실)에서 안을 봄. 평면도도 트인 쪽이 아래라 방향이 같다 (트인 쪽 없으면 앞벽 쪽) */
  view(kind: ViewKind, d: Design) {
    const c = new THREE.Vector3(d.room.w * S / 2, 1.0, d.room.d * S / 2);
    const ext = Math.max(d.room.w, d.room.d) * S;
    const N: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const ow = d.openWall ?? 2, n = N[ow];
    const half = (ow % 2 === 0 ? d.room.d : d.room.w) * S / 2;
    // 트인 쪽 = 가운데에서 -n 방향
    const at = (dist: number, y: number) => this.camera.position.set(c.x - n[0] * dist, y, c.z - n[1] * dist);
    if (kind === 'top') at(0.01, ext * 2.1 + 2);
    else if (kind === 'front') at(half + ext * 0.55, 1.45);
    else at(half + ext * 0.75, 3.1);
    this.controls.target.copy(c);
    this.controls.update();
  }

  /** 공간 하나(도면 mm 범위)를 화면에 꽉 차게 — 기본 시점과 같은 방향(트인 쪽에서 안쪽)으로, 35° 내려다보며 */
  frameSpace(box: [number, number, number, number], d: Design) {
    const [x0, z0, x1, z1] = box.map((v) => v * S);
    const N: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    const n = N[d.openWall ?? 2];
    const c = new THREE.Vector3((x0 + x1) / 2, 0.9, (z0 + z1) / 2);
    const spanPerp = Math.abs(n[0]) > 0.5 ? z1 - z0 : x1 - x0, spanPar = Math.abs(n[0]) > 0.5 ? x1 - x0 : z1 - z0;
    const vf = THREE.MathUtils.degToRad(this.camera.fov) / 2, hf = Math.atan(Math.tan(vf) * this.camera.aspect), el = THREE.MathUtils.degToRad(35);
    // 가로(시선에 수직)는 화면 폭에, 세로(시선 방향 깊이를 내려다본 높이)는 화면 높이에 — 둘 중 먼 쪽. 앞 가장자리가 잘리지 않게 깊이 절반을 더한다
    const dist = Math.max((spanPerp / 2) / Math.tan(hf), (spanPar * Math.sin(el) / 2 + 1.2) / Math.tan(vf)) * 1.04 + spanPar / 2 * Math.cos(el);
    this.camera.position.set(c.x - n[0] * dist * Math.cos(el), c.y + dist * Math.sin(el), c.z - n[1] * dist * Math.cos(el));
    this.controls.target.copy(c);
    this.controls.update();
  }

  /* ───────── 보기 — 재질 / 재질+라인 (모서리 선을 메시 자식으로 — 도어와 같이 움직인다) ───────── */
  lines = false;
  private edgeCache = new WeakMap<THREE.BufferGeometry, THREE.EdgesGeometry>();
  private edgeMat = shared(new THREE.LineBasicMaterial({ color: 0x2b2b2b }));
  setLines(on: boolean) { this.lines = on; this.applyLines(); this.invalidate(); }
  private applyLines() {
    for (const root of [this.kitchen, this.room?.group]) {
      if (!root) continue;
      const meshes: THREE.Mesh[] = [];
      root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).transparent && (m.material as THREE.Material).visible !== false) meshes.push(m); });
      // 선이 면과 같은 깊이라 점선처럼 끊긴다 — 라인 보기에선 면을 살짝 뒤로 민다
      for (const m of meshes) for (const mt0 of [m.material].flat()) { mt0.polygonOffset = this.lines; mt0.polygonOffsetFactor = 1; mt0.polygonOffsetUnits = 1; }
      for (const m of meshes) {
        const old = m.children.find((c) => c.name === 'edge-lines');
        if (old) m.remove(old);
        if (!this.lines) continue;
        let eg = this.edgeCache.get(m.geometry);
        // 공유 형상(장 캐시)의 모서리 선은 다음 부엌도 같이 쓴다 — 옛 부엌을 놓을 때 건너뛰게
        if (!eg) { eg = new THREE.EdgesGeometry(m.geometry, 28); if (isShared(m.geometry)) shared(eg); this.edgeCache.set(m.geometry, eg); }
        const l = new THREE.LineSegments(eg, this.edgeMat);
        l.name = 'edge-lines'; l.raycast = () => {};
        m.add(l);
      }
    }
  }

  /* ───────── 실사 렌더 ───────── */
  mode: RenderMode = 'raster';
  onStatus?: (t: string) => void;
  /** 화면 방식이 바뀌었을 때(실사 방식 · 후처리의 SSR · SSS) — 메뉴 표시를 실제 상태로 맞춘다 */
  onModeChange?: () => void;
  /** 굽기 · 서펠 결과를 다시 쓸지 — 설계 · 문 열림이 같으면 같은 결과 */
  stateKey: () => string = () => '';
  private sky?: THREE.Texture;
  private rasterEnv?: { env: THREE.Texture | null; intensity: number };
  private embeds = new Map<string, EmbedHandle>();
  private embedPending = new Set<string>();
  private resendTimer = 0;
  /** 해 방향(굽기 엔진 aimSun 과 같은 각 — x = cos 고도 cos 방위, z = cos 고도 sin 방위) · 노출 */
  private lightPayload(): LightPayload {
    const d = this.sun.position.clone().sub(this.sun.target.position).normalize();
    const el = THREE.MathUtils.radToDeg(Math.asin(d.y)), az = THREE.MathUtils.radToDeg(Math.atan2(d.z, d.x));
    return {
      sun: { azimuth: az, elevation: el, intensity: this.sun.intensity * 1.4 }, sunTarget: this.sun.target.position.toArray(),
      spot: { intensity: DOWNLIGHT_CD * this.roomCfg.lamp, color: kelvinColor(this.roomCfg.kelvin).getHex() }, glow: { intensity: Math.max(0.05, this.roomCfg.lamp * 2.2), color: kelvinColor(this.roomCfg.kelvin).getHex() },
      exposure: this.renderer.toneMappingExposure,
    };
  }
  private async loadSky() {
    if (!this.sky) {
      // 하늘 HDR 속 태양은 눌러 둔 것 — 경로 추적에서 패널 해와 별개인 「두 번째 해」가 되지 않게(붙박이장 플래너 실측)
      this.sky = await new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}env/sky_nosun.hdr`);
      this.sky.mapping = THREE.EquirectangularReflectionMapping;
    }
    return this.sky;
  }
  /** 장면이 바뀌었다 — 굽기 · 서펠이면 새 장면을 다시 넘긴다(MuTracer 는 자동 반영) */
  sceneChanged() {
    // ⑤ 경로 추적은 장면을 통째로 넘겨 BVH 를 짓는다 — 바뀌면 다시 넘긴다
    if (this.mode === 'gpupt') { clearTimeout(this.resendTimer); this.resendTimer = window.setTimeout(() => { if (this.mode === 'gpupt') gpt?.showGpuPt(this.renderer as WebGPURenderer, this.scene, this.camera, this.renderer.toneMappingExposure); }, 300); return; }
    if (this.mode !== 'bake' && this.mode !== 'surfel') return;
    clearTimeout(this.resendTimer);
    this.resendTimer = window.setTimeout(() => { if (this.mode === 'bake' || this.mode === 'surfel') void this.showEmbed(this.mode); }, 400);
  }
  private async showEmbed(kind: EmbedKind) {
    const key = `${kind}|${this.stateKey()}`;
    this.embeds.forEach((h, k) => h.setActive(k === key));
    const hit = this.embeds.get(key);
    if (hit) { this.embeds.delete(key); this.embeds.set(key, hit); hit.setLight(this.lightPayload()); this.onStatus?.(hit.status || '저장해 둔 결과'); return; }
    if (!this.room || !this.kitchen || this.embedPending.has(key)) return;
    this.embedPending.add(key);
    const sel = this.selBox; if (sel) sel.visible = false;
    try {
      this.scene.updateMatrixWorld(true);
      const h = await startEmbed(kind, this.host, [this.room.group, this.kitchen], this.camera, this.controls.target, this.lightPayload(), (t) => this.onStatus?.(t));
      this.embeds.set(key, h);
      h.setActive(this.mode === kind && `${kind}|${this.stateKey()}` === key);
      // 엔진 화면마다 GPU 장치 · 장면 · 라이트맵을 따로 쓴다 — 지금 것 + 직전 것 하나만(예전 3개)
      while (this.embeds.size > 2) { const [k0, h0] = this.embeds.entries().next().value!; h0.dispose(); this.embeds.delete(k0); }
    } finally {
      this.embedPending.delete(key);
      if (sel) sel.visible = true;
    }
  }
  /* 안 쓰는 실사 엔진 놓기 — 떠난 뒤 RELEASE_MS 동안 다시 안 켜면 GPU 자원(장치 · 장면 · 누적 버퍼 · 신경망)을 놓는다.
   * 끈 엔진은 그리기는 멈추지만(MuTracer 멈춤 · 굽기/서펠 화면 숨김) 메모리는 그대로 잡고 있었다. 곧바로 다시 켜면 그대로 이어진다 */
  private releaseTimer = 0;
  private releaseIdle() {
    clearTimeout(this.releaseTimer);
    this.releaseTimer = window.setTimeout(() => {
      if (this.mode !== 'mutracer') mt?.disposeMutracer();
      if (this.mode !== 'gpupt') gpt?.disposeGpuPt();
      if (this.mode !== 'bake' && this.mode !== 'surfel') { this.embeds.forEach((h) => h.dispose()); this.embeds.clear(); }
    }, RELEASE_MS);
  }
  private modeReq = 0;
  async setMode(mode: RenderMode) {
    try { await this.switchMode(mode); } finally { this.onModeChange?.(); }
  }
  private async switchMode(mode: RenderMode) {
    // 늦게 끝난 앞 요청이 뒤 요청을 덮지 않게 — MuTracer 를 받는 동안 「실시간」을 누르면, 받은 뒤 MuTracer 로 바뀌어
    // 메뉴는 실시간인데 경로 추적이 계속 돌았다
    const req = ++this.modeReq;
    this.invalidate(true);
    // 실시간 ↔ ④ 고품질은 같은 화면 — 후처리 두 개만 켜고 끈다
    if ((mode === 'raster' || mode === 'hq') && this.mode === 'raster') {
      if (mode === 'hq' && this.raster.kind !== 'webgpu') { this.onStatus?.('이 방식은 WebGPU 화면에서만 됩니다'); return; }
      const on = mode === 'hq';
      if (!!this.raster.post.ssr !== on || !!this.raster.post.sss !== on) this.raster.setPost({ ssr: on, sss: on });
      return;
    }
    if (mode === this.mode) return;
    if ((mode === 'gpupt' || mode === 'hq') && this.raster.kind !== 'webgpu') { this.onStatus?.('이 방식은 WebGPU 화면에서만 됩니다'); return; }
    const m = mode === 'mutracer' ? await loadMt() : mt;
    if (mode === 'gpupt') await loadGpt();
    const sky = mode === 'mutracer' || mode === 'gpupt' ? await this.loadSky() : undefined;
    if (req !== this.modeReq) return;
    // ④ 실시간 고품질 = 실시간 + 화면 반사 · 접촉 그림자, 실시간(기본)은 둘을 끈다(붙박이장 플래너와 같음)
    const hq = mode === 'hq';
    if (mode === 'raster' || hq) { if (!!this.raster.post.ssr !== hq || !!this.raster.post.sss !== hq) this.raster.setPost({ ssr: hq, sss: hq }); }
    // WebGPU 캔버스는 화면에 내보낸 뒤 복사하면 비어 있다 — MuTracer 덮개로 쓸 실시간 화면을 다시 그려 둔다
    if (mode === 'mutracer' && this.raster.kind === 'webgpu' && this.raster.ready) this.raster.render();
    mt?.hideMutracer();
    if (this.mode === 'gpupt') gpt?.hideGpuPt(this.renderer as WebGPURenderer);
    this.embeds.forEach((h) => h.setActive(false));
    if (this.mode === 'raster' || this.mode === 'hq') this.rasterEnv = { env: this.scene.environment, intensity: this.scene.environmentIntensity };
    if (hq) mode = 'raster';
    this.mode = mode;
    this.releaseIdle();
    this.invalidate(true);
    // three 캔버스는 투명하게 두고 마우스는 그대로 받는다(궤도 회전) — MuTracer 가 밑 캔버스에 그린다
    this.renderer.domElement.style.opacity = mode === 'mutracer' ? '0' : '';
    // 경로 추적은 손을 떼면 바로 멈춰야 수렴을 시작한다
    this.controls.enableDamping = mode === 'raster';
    if (mode === 'gpupt') { this.scene.updateMatrixWorld(true); }
    if (sky) { this.scene.environment = sky; this.scene.environmentIntensity = 1; }
    else if (this.rasterEnv) { this.scene.environment = this.rasterEnv.env; this.scene.environmentIntensity = this.roomCfg.env * RASTER_ENV; }
    // 공간 라이트맵은 실시간에서만 — 경로 추적 · 굽기 · 서펠은 빛을 직접 계산한다
    if (mode === 'raster') { this.envDirty = true; this.scheduleSpaceAO(); } else clearSpaceAO();
    // 바닥 · 상판 반사 — 실시간에서만(실사 엔진은 원래 재질을 읽는다)
    this.applyFloorReflection();
    this.applyCounterReflection();
    // 숨긴 벽 · 천장 방식이 바뀐다 — 다음 프레임에 다시 정한다
    this.room?.group.traverse((o) => { delete o.userData.hid; o.layers.set(0); if (o.name === 'roof-shadow') o.visible = mode === 'raster'; });
    this.kitchen?.traverse((o) => { delete o.userData.hid; o.layers.set(0); });
    this.windowLights.visible = mode === 'raster' && this.roomCfg.sky > 0;
    if (mode === 'mutracer') {
      this.scene.updateMatrixWorld(true);
      m!.showMutracer(this.host, this.scene, this.camera, this.controls, (t) => this.onStatus?.(t), this.renderer.domElement);
    } else if (mode === 'gpupt') {
      gpt!.showGpuPt(this.renderer as WebGPURenderer, this.scene, this.camera, this.renderer.toneMappingExposure);
      this.onStatus?.('⑤ 경로 추적 · three-gpu-pathtracer — 절반 해상도 6샘플 + OIDN + FSR');
    } else if (mode === 'bake' || mode === 'surfel') await this.showEmbed(mode);
  }

  private frame() {
    // 카메라가 움직였으면(손 · 관성 · 코드로 옮긴 시점) 그린다
    let moved = this.controls.update();
    this.placeRingLabel();
    const cam = this.camera;
    cam.updateMatrixWorld();
    if (!cam.matrixWorld.equals(this.lastView) || !cam.projectionMatrix.equals(this.lastProj)) { this.lastView.copy(cam.matrixWorld); this.lastProj.copy(cam.projectionMatrix); moved = true; }
    if (moved) this.invalidate();
    // 실내 환경맵은 실시간 화면에서만 다시 찍는다 — 실사 모드에선 표시가 남아 있어도 그릴 이유가 아니다(⑤ 경로 추적이 다 그린 뒤에도 계속 그렸다)
    if (this.envDirty && this.mode === 'raster') this.invalidate();
    // 카메라 쪽 벽 · 천장 숨기기 — 그 벽에 붙은 장 · 상판 · 마감도 같이. 시점이 바뀌었거나 그릴 일이 있을 때만
    // (예전엔 가만히 있어도 매 틱 방 · 부엌을 훑었다 — 저사양 노트북에서 쉬는 동안에도 CPU 를 썼다)
    const cp = this.camera.position;
    if (this.room && (moved || this.wake > 0)) {
      const shown = new Map<number, boolean>();
      const live = this.mode === 'raster';
      const hide = (o: THREE.Object3D, on: boolean) => { if (live) { o.visible = true; setLayer(o, !on); } else o.visible = on; };
      for (const w of this.room.walls) {
        const on = w.keep || new THREE.Vector3().subVectors(cp, w.p).dot(w.n) > -0.05;
        hide(w.obj, on);
        if (!w.keep) shown.set(w.wall, on);
      }
      if (this.kitchen) for (const o of this.kitchen.children) {
        if (o.userData.wall != null) hide(o, shown.get(o.userData.wall) !== false);
        if (o.name === 'splash') for (const s of o.children) if (s.userData.wall != null) hide(s, shown.get(s.userData.wall) !== false);
      }
      // 천장 — 부엌 · 거실 · 벽 너머 공간 전부 (위에서 내려다보면 숨김)
      const d = this.getDesign?.();
      // 위에서 내려다보면 — 실시간 화면은 천장을 화면에만 안 보이게(색 · 깊이 안 씀) 두어 그림자는 계속 드리운다(햇빛이 뚫고 들어오지 않게).
      // 실사 방식(경로 추적 · 굽기 · 서펠)은 재질 쓰기 설정을 보지 않으므로 예전처럼 숨긴다
      if (d) this.room.group.traverse((o) => {
        if (o.name === 'ceiling') hide(o, cp.y < d.room.h * S);
        // 지붕판 — 실시간은 늘 숨김 층(그림자만), 실사는 안 넣는다(위에서 볼 때 화면을 가린다)
        else if (o.name === 'roof-shadow') { o.visible = live; setLayer(o, true); }
      });
    }
    // ⑤ 경로 추적 — 다 쌓이고 노이즈 제거까지 끝나면 같은 그림을 다시 내보내지 않는다(예전엔 매 프레임 FSR 확대 + 화면 복사)
    if (this.mode === 'gpupt') {
      if (this.wake > 0 || !gpt?.gpuPtDone()) { if (this.wake > 0) this.wake--; gpt?.renderGpuPt(); }
      return;
    }
    // MuTracer · 굽기 · 서펠은 제 캔버스에 따로 그린다 — 가려진 실시간 화면은 그리지 않는다(예전엔 그동안에도 매 프레임 그렸다)
    if (this.mode !== 'raster' || this.wake <= 0) return;
    this.wake--;
    if (this.shadowDirty) {
      this.shadowDirty = false;
      this.sun.shadow.needsUpdate = true;
      // 꺼진(밝기 0) 조명은 그림자 맵을 그리지 않는다 — 예전엔 천장 조명 「없음」이어도 메인 조명 그림자 맵(2048²)을 매 프레임 그렸다
      for (const o of this.lamps.children) { const l = o as THREE.SpotLight; if (l.isSpotLight && l.castShadow && l.intensity > 0) l.shadow.needsUpdate = true; }
    }
    if (this.envDirty && this.raster.ready && performance.now() - this.envAt > 100) this.updateEnv();
    if (!this.raster.ready) return;
    this.raster.render();
    // 사용자가 3D 를 돌리는 동안 이어서 그린 프레임 사이 간격 — 처음 열 때 모델을 읽느라 느린 프레임 · 쉬었다 다시 그린 첫 장(간격 0.25초 넘음)은 뺀다. 최근 90장
    const now = performance.now();
    if (this.orbiting && moved && this.lastRenderAt && now - this.lastRenderAt < 250) { this.frameDts.push(now - this.lastRenderAt); if (this.frameDts.length > 90) this.frameDts.shift(); }
    this.lastRenderAt = now;
  }

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  /** 마우스 → 바닥 위 높이 h(m) 평면 점 (mm) */
  private floorPoint(e: PointerEvent, h = 1): [number, number] | null {
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p) ? [p.x / S, p.z / S] : null;
  }
  private down(e: PointerEvent) {
    if (!this.room || e.button !== 0) return;
    this.downAt = { x: e.clientX, y: e.clientY };
    // 벽 화살표 — 다른 것보다 먼저
    const wa = this.arrowAt(e);
    if (wa) {
      this.arrowDrag = { i: wa.i, s0: wa.along, d: 0 };
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
      try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      return;
    }
    // 아일랜드 회전 고리 — 다른 것보다 먼저
    const ra = this.ringAt(e);
    if (ra != null) {
      this.ringDrag = { a0: ra, deg: 0 };
      this.controls.enabled = false;
      this.renderer.domElement.style.cursor = 'grabbing';
      try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      return;
    }
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const hits = this.ray.intersectObjects(this.room.pick.filter((o) => o.parent?.parent?.visible !== false), false).filter((h) => isShown(h.object));
    const id = hits[0]?.object.userData.openingId as string | undefined;
    // 벽 줄 하부장 — 그 장을 눌러 옆 장들 사이로 끌어 끼우기
    this.pickPending = undefined;
    if (this.kitchen) {
      // 벽(두께 면 포함)이 장 · 상품보다 앞이면 장 · 상품을 잡지 않는다 — 예전엔 벽 뒤 장도 먼저 잡혀 벽 끝면을 누르면 장이 골라졌다
      const wallD = this.ray.intersectObjects(this.room.walls.filter((w) => w.obj.visible).map((w) => w.obj), true).find((h) => h.object.userData.wallId != null)?.distance ?? Infinity;
      const khAll = shown(this.ray.intersectObject(this.kitchen, true));
      const kh0 = khAll && khAll.distance < wallD ? khAll : undefined;
      // 쿡탑 기기 — 장보다 먼저 (기기 윗면을 누르면 기기, 장 몸통을 누르면 장)
      let onHob = false;
      for (let o: THREE.Object3D | null = kh0?.object ?? null; o; o = o.parent) if (o.userData.hobTop) { onHob = true; break; }
      if (onHob && (!hits[0] || hits[0].distance > kh0!.distance)) {
        if (!this.getSel?.().hob) { this.hobPending = { x: e.clientX, y: e.clientY }; return; }
        this.dragY = kh0!.point.y;
        const fp = this.floorPoint(e, this.dragY) ?? [0, 0];
        this.hobDrag = { p0: fp, p: fp, moved: false };
        this.onPickOpening?.(null);
        this.controls.enabled = false;
        try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
        return;
      }
      let it: { tag?: string; wall?: 0 | 1 | 2 | 3; t: number; w: number } | undefined;
      for (let o: THREE.Object3D | null = kh0?.object ?? null; o; o = o.parent) if (o.userData.item) { it = o.userData.item; break; }
      if (it && (!hits[0] || hits[0].distance > kh0!.distance)) this.pickPending = { item: it, x: e.clientX, y: e.clientY };
      else this.clearPending = { x: e.clientX, y: e.clientY };   // 빈 곳 — 끌지 않고 떼면 선택 해제(누를 때 바로 풀면 카메라 돌릴 때마다 풀렸다)
      // 식탁 · 의자 — 장 · 개구부보다 앞이면
      this.diningPending = undefined;
      if (!it && kh0 && (!hits[0] || hits[0].distance > kh0.distance)) for (let o: THREE.Object3D | null = kh0.object; o; o = o.parent) if (o.userData.dining) { this.diningPending = { x: e.clientX, y: e.clientY }; break; }
      // 고른 식탁을 다시 누르면 끌기 — 누른 점 높이 수평면에서 움직인 만큼
      if (this.diningPending && this.getSel?.().dining && this.getDining) {
        const c = this.getDining();
        this.dragY = kh0!.point.y;
        const fp = this.floorPoint(e, this.dragY);
        if (c && fp) {
          this.diningPending = undefined; this.clearPending = undefined;
          this.dinDrag = { dx: c.x - fp[0], dz: c.z - fp[1], moved: false, x0: c.x, z0: c.z };
          this.onPickOpening?.(null);
          this.controls.enabled = false;
          try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
          return;
        }
      }
      // 벽 마감 — 장이 아니고 개구부보다 앞이면
      this.splashPending = undefined;
      if (!it && kh0 && (!hits[0] || hits[0].distance > kh0.distance) && kh0.object.userData.splashWall != null) this.splashPending = { w: kh0.object.userData.splashWall, x: e.clientX, y: e.clientY };
      // 벽 — 장 · 개구부보다 앞에 있을 때
      this.wallPending = undefined;
      if (!it && !hits[0]) {
        const wh = this.ray.intersectObjects(this.room.walls.filter((w) => w.obj.visible).map((w) => w.obj), true).find((h) => h.object.userData.wallId != null);
        if (wh && (!kh0 || wh.distance < kh0.distance)) {
          // 두께 면 — 면 방향이 수평이고 그 벽 면 방향과 직각이면 끝면
          const entry = this.room.walls.find((w) => { let hit = false; w.obj.traverse((o) => { if (o === wh.object) hit = true; }); return hit; });
          const fn = wh.face ? wh.face.normal.clone().transformDirection(wh.object.matrixWorld) : null;
          const end = !!(fn && entry && Math.abs(fn.y) < 0.5 && Math.abs(fn.dot(entry.n)) < 0.3);
          this.wallPending = { w: wh.object.userData.wallId, x: e.clientX, y: e.clientY, end: end ? [wh.point.x / S, wh.point.z / S] : undefined };
        }
      }
      if (it && it === this.getSel?.().item && slotMovable(it as Item) && (!hits[0] || hits[0].distance > kh0!.distance)) {
        // 누른 점 높이의 수평면 기준 — 누른 자리에서 움직인 만큼만 옮긴다
        this.dragY = kh0!.point.y;
        const fp = this.floorPoint(e, this.dragY) ?? [0, 0];
        this.itemDrag = { item: it as Item, p0: fp, p: fp, moved: false };
        this.onPickOpening?.(null);
        this.controls.enabled = false;
        try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
        return;
      }
    }
    // 아일랜드 — 장 · 상판을 눌러 끌기
    let isl = false;
    if (this.kitchen) {
      const kh0w = shown(this.ray.intersectObject(this.kitchen, true));
      const wallD = this.ray.intersectObjects(this.room.walls.filter((w) => w.obj.visible).map((w) => w.obj), true).find((h) => h.object.userData.wallId != null)?.distance ?? Infinity;
      const kh = kh0w && kh0w.distance < wallD ? kh0w : undefined;
      for (let o: THREE.Object3D | null = kh?.object ?? null; o; o = o.parent) if (o.userData.island) { isl = true; break; }
      if (isl && hits[0] && kh && hits[0].distance < kh.distance) isl = false;
    }
    if (isl && this.getIsland && !this.getSel?.().island) { if (!this.pickPending) this.islPending = { x: e.clientX, y: e.clientY }; return; }
    if (isl && this.getIsland) {
      this.dragY = shown(this.ray.intersectObject(this.kitchen!, true))?.point.y ?? 0.9;
      const fp = this.floorPoint(e, this.dragY), c = this.getIsland();
      if (fp && c) {
        this.islDrag = { dx: c.x - fp[0], dz: c.z - fp[1], moved: false, x0: c.x, z0: c.z };
        this.onPickOpening?.(null);
        this.controls.enabled = false;
        try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
        return;
      }
    }
    // 개구부 — 선택된 것만 끌기. 아니면 떼면 고르기(빈 곳이면 해제)
    if (!id || this.getSel?.().opening !== id) { this.opPending = { id: id ?? null, x: e.clientX, y: e.clientY }; return; }
    const d = this.getDesign(); const o = d.openings.find((x) => x.id === id)!;
    this.dragY = hits[0].point.y;
    const fp = this.floorPoint(e, this.dragY);
    const nw = fp ? nearestWall(d.room, fp[0], fp[1], d.openWall) : null;
    this.drag = { id, offset: nw && nw.wall === o.wall ? nw.t - o.t : o.w / 2, moved: false, wall0: o.wall, t0: o.t };
    this.controls.enabled = false;
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
  }
  private move(e: PointerEvent) {
    if (this.arrowDrag) {
      const a = this.arrowAt(e, this.arrowDrag.i);
      if (!a) return;
      const dd = Math.round((a.along - this.arrowDrag.s0) / 10) * 10;
      if (dd !== this.arrowDrag.d) {
        this.arrowDrag.d = dd;
        const w = this.wallArrows[this.arrowDrag.i];
        w.g.position.set(w.base.x + w.dir[0] * dd * S, w.base.y, w.base.z + w.dir[1] * dd * S);
        this.onDragWallArrow?.(this.arrowDrag.i, dd, false);
      }
      return;
    }
    if (this.ringDrag) {
      const a = this.ringAt(e, true);
      if (a == null) return;
      let da = a - this.ringDrag.a0;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const st = this.islRing?.step ?? 90, deg = Math.round(da * 180 / Math.PI / st) * st;
      if (deg !== this.ringDrag.deg) {
        this.ringDrag.deg = deg;
        if (this.islRing) this.islRing.g.rotation.y = deg * Math.PI / 180;
        this.onRotateIsland?.(deg, false);
      }
      return;
    }
    if (!e.buttons) this.renderer.domElement.style.cursor = this.ringAt(e) != null || this.arrowAt(e) ? 'grab' : '';
    if (this.hobDrag) {
      if (!this.hobDrag.moved && !this.far(e)) return;
      const fp = this.floorPoint(e, this.dragY);
      if (!fp) return;
      Object.assign(this.hobDrag, { p: fp, moved: true });
      this.onDragHob?.(fp, this.hobDrag.p0, false);
      return;
    }
    if (this.dinDrag) {
      if (!this.dinDrag.moved && !this.far(e)) return;
      const fp = this.floorPoint(e, this.dragY);
      if (!fp) return;
      this.dinDrag.moved = true;
      this.onDragDining?.(Math.round((fp[0] + this.dinDrag.dx) / 10) * 10, Math.round((fp[1] + this.dinDrag.dz) / 10) * 10, false);
      return;
    }
    if ((this.itemDrag && !this.itemDrag.moved) || (this.islDrag && !this.islDrag.moved) || (this.drag && !this.drag.moved)) if (!this.far(e)) return;
    if (this.itemDrag) {
      const fp = this.floorPoint(e, this.dragY);
      if (!fp) return;
      Object.assign(this.itemDrag, { p: fp, moved: true });
      this.onDragItem?.(this.itemDrag.item, fp, this.itemDrag.p0, false);
      return;
    }
    if (this.islDrag) {
      const fp = this.floorPoint(e, this.dragY);
      if (!fp) return;
      this.islDrag.moved = true;
      this.onDragIsland?.(Math.round((fp[0] + this.islDrag.dx) / 10) * 10, Math.round((fp[1] + this.islDrag.dz) / 10) * 10, false);
      return;
    }
    if (!this.drag) return;
    const fp = this.floorPoint(e, this.dragY);
    if (!fp) return;
    const d = this.getDesign();
    const nw = nearestWall(d.room, Math.max(0, Math.min(d.room.w, fp[0])), Math.max(0, Math.min(d.room.d, fp[1])), d.openWall);
    this.drag.moved = true;
    this.onDragOpening?.(this.drag.id, nw.wall, nw.t - this.drag.offset, false);
  }
  /** ESC — 끄는 중이면 원래 자리로 되돌리고 끝낸다. 되돌린 게 있으면 true (없으면 main 이 선택을 푼다) */
  cancelDrag(): boolean {
    const end = () => { this.controls.enabled = true; this.renderer.domElement.style.cursor = ''; };
    if (this.itemDrag) { const f = this.itemDrag; this.itemDrag = undefined; end(); if (f.moved) this.onDragItem?.(f.item, f.p0, f.p0, true); return true; }
    if (this.hobDrag) { const h = this.hobDrag; this.hobDrag = undefined; end(); if (h.moved) this.onDragHob?.(h.p0, h.p0, true); return true; }
    if (this.islDrag) { const i = this.islDrag; this.islDrag = undefined; end(); if (i.moved) this.onDragIsland?.(i.x0, i.z0, true); return true; }
    if (this.dinDrag) { const i = this.dinDrag; this.dinDrag = undefined; end(); if (i.moved) this.onDragDining?.(i.x0, i.z0, true); return true; }
    if (this.drag) { const r = this.drag; this.drag = undefined; end(); if (r.moved) { this.onDragOpening?.(r.id, r.wall0, r.t0, false); this.onDragOpening?.(r.id, r.wall0, r.t0, true); } return true; }
    if (this.ringDrag) { this.ringDrag = undefined; end(); if (this.islRing) this.islRing.g.rotation.y = 0; this.onRotateIsland?.(0, true); return true; }
    if (this.arrowDrag) { const a = this.arrowDrag; this.arrowDrag = undefined; end(); this.onDragWallArrow?.(a.i, 0, true); return true; }
    return false;
  }
  private up(e: PointerEvent) {
    if (this.arrowDrag) {
      const a = this.arrowDrag; this.arrowDrag = undefined;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = '';
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      this.onDragWallArrow?.(a.i, a.d, true);
      return;
    }
    if (this.ringDrag) {
      const r = this.ringDrag; this.ringDrag = undefined;
      this.controls.enabled = true;
      this.renderer.domElement.style.cursor = '';
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      this.onRotateIsland?.(r.deg, true);
      return;
    }
    if (this.dinDrag) {
      const i = this.dinDrag; this.dinDrag = undefined;
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (i.moved) { const c = this.getDining?.(); if (c) this.onDragDining?.(c.x, c.z, true); }
      return;
    }
    // 거의 안 움직이고 뗐으면 장 · 벽 고르기 (움직였으면 카메라를 돌린 것)
    const near = (p?: { x: number; y: number }) => !!p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 5;
    const hp = this.hobPending, ip = this.islPending, op = this.opPending, cp = this.clearPending;
    this.hobPending = this.islPending = this.opPending = this.clearPending = undefined;
    if (near(hp)) { this.onPickHob?.(); return; }
    // 빈 곳 해제 — 먼저. 공간 요소(창 · 팬트리 등)를 고른 클릭이면 해제하지 않는다(예전엔 고르자마자 풀려 표시가 안 됐다)
    const opHit = near(op) && op!.id != null;
    const dp = this.diningPending; this.diningPending = undefined;
    if (near(dp)) { this.onPickDining?.(); return; }
    if (near(cp) && !opHit) this.onPickItem?.(null);
    if (near(op)) this.onPickOpening?.(op!.id);
    const wp = this.wallPending; this.wallPending = undefined;
    if (wp && Math.hypot(e.clientX - wp.x, e.clientY - wp.y) < 5) { if (wp.end && this.onPickWallEnd) this.onPickWallEnd(wp.w, wp.end); else this.onPickWall?.(wp.w); }
    const sp = this.splashPending; this.splashPending = undefined;
    if (sp && Math.hypot(e.clientX - sp.x, e.clientY - sp.y) < 5) { this.onPickSplash?.(sp.w); return; }
    const pp = this.pickPending; this.pickPending = undefined;
    const click = pp && Math.hypot(e.clientX - pp.x, e.clientY - pp.y) < 5;
    if (this.hobDrag) {
      const h = this.hobDrag; this.hobDrag = undefined;
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (h.moved) this.onDragHob?.(h.p, h.p0, true); else this.onPickHob?.();
      return;
    }
    if (this.itemDrag) {
      const f = this.itemDrag; this.itemDrag = undefined;
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (f.moved && !click) this.onDragItem?.(f.item, f.p, f.p0, true);
      if (click) this.onPickItem?.(pp!.item);
      return;
    }
    // 아일랜드를 끌지 않고 뗐으면 — 누른 장이 있으면 그 장(구성 바꾸기), 상판 등이면 아일랜드 전체
    if (this.islDrag && !this.islDrag.moved) { this.islDrag = undefined; this.controls.enabled = true; if (click && pp) this.onPickItem?.(pp.item); else this.onPickIsland?.(); return; }
    if (click && !this.drag) { this.onPickItem?.(pp!.item); return; }
    if (near(ip)) { this.onPickIsland?.(); return; }
    if (this.islDrag) {
      const moved = this.islDrag.moved; this.islDrag = undefined;
      this.controls.enabled = true;
      try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (moved) { const c = this.getIsland?.(); if (c) this.onDragIsland?.(c.x, c.z, true); }
      return;
    }
    if (!this.drag) return;
    const dr = this.drag; this.drag = undefined;
    this.controls.enabled = true;
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
    if (dr.moved) {
      const d = this.getDesign(); const o = d.openings.find((x) => x.id === dr.id)!;
      this.onDragOpening?.(dr.id, o.wall, o.t, true);
    }
  }
}
