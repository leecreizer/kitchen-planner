// 장 썸네일 — 교체 · 추가 목록 카드용(사용자 2026-11-09 「상품 리스트가 글로만 표시돼 형태 구분이 안 된다 · 도어 내부도」).
// 그 장 하나만 담은 작은 배치안을 부엌과 같은 조립(buildKitchen — 오븐 기기 · 식세기 속 · 찬넬 · 걸레받이 · 상판)으로 만들어
// 밝은 배경 · 고른 조명의 작은 화면에서 닫힘 · 열림 두 장을 찍는다. 부엌 화면을 그대로 찍으면 어둡고 옆 장 · 평면도에 가려 형태가 안 읽혔다(같은 날 시험)
import * as THREE from 'three';
import { buildKitchen, setDoors } from './kitchen3d';
import { disposeTree } from './dispose';
import { COUNTER_D, type Candidate, type Item } from './autoplan';
import type { Design } from './plan';
import type { GradeDef, KitchenCatalog } from './kjlLib';

const SIZE = 240;
/** 폴딩 문 — 원본 변수(도어개폐율 DROP)로만 접혀서 열린 모습은 다시 계산한다(main 의 FOLD_KEYS 와 같은 장) */
const FOLD = new Set(['cafeTall', 'foldTall']);
const F0 = { o: [0, 0] as [number, number], dir: [1, 0] as [number, number], n: [0, 1] as [number, number] };

let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera } | null = null;
function getStudio() {
  if (studio) return studio;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f3f1ed');
  scene.add(new THREE.HemisphereLight('#ffffff', '#cfc8bd', 2.4));
  const key = new THREE.DirectionalLight('#ffffff', 2.0); key.position.set(-2, 3, 4); scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.9); fill.position.set(3, 1.5, 2.5); scene.add(fill);
  return (studio = { renderer, scene, cam: new THREE.PerspectiveCamera(26, 1, 0.05, 50) });
}

export type ThumbItem = Pick<Item, 'key' | 'level' | 'w'> & { ov?: Item['ov']; tag?: Item['tag'] };
const cache = new Map<string, Promise<[string, string]>>();
let queue: Promise<unknown> = Promise.resolve();

/** 닫힘 · 열림 썸네일(data URL). 같은 장 · 폭 · 비규격 값 · 그레이드 · 도어 · 방 높이 · 오븐 · 상판이면 다시 찍지 않는다. 한 번에 하나씩 찍는다 */
export function thumbPair(item: ThumbItem, base: Candidate, d: Design, cat: KitchenCatalog, grade: GradeDef, doorObs: string): Promise<[string, string]> {
  const k = JSON.stringify([item.key, item.level, item.w, item.ov ?? null, item.tag ?? null, grade.id, doorObs, d.room.h, d.appliance?.oven ?? '', d.counter]);
  let p = cache.get(k);
  if (!p) {
    p = queue.then(() => shoot(item, base, d, cat, grade, doorObs));
    queue = p.catch(() => undefined);
    cache.set(k, p);
    p.catch(() => cache.delete(k));
  }
  return p;
}

async function shoot(item: ThumbItem, base: Candidate, d: Design, cat: KitchenCatalog, grade: GradeDef, doorObs: string): Promise<[string, string]> {
  const s = getStudio();
  const build = async (drop?: string) => {
    const it: Item = { key: item.key, level: item.level, w: item.w, frame: F0, t: 0, ...(item.tag ? { tag: item.tag } : {}) };
    const ov = { ...(item.ov ?? {}), ...(drop != null ? { DROP: drop } : {}) };
    if (Object.keys(ov).length) it.ov = ov;
    // 하부장은 상판을 얹어 실제 모습처럼(상판이 없으면 상자로 보인다)
    const mini: Candidate = { ...base, items: [it], counters: item.level === 'base' ? [{ frame: F0, t0: 0, t1: item.w, z0: 0, z1: COUNTER_D }] : [], splashes: [], island: undefined, skips: [], sink: undefined, hob: undefined, fridge: undefined };
    return buildKitchen(mini, d, cat, grade, doorObs, undefined, true);
  };
  const fold = FOLD.has(item.key);
  const closed = await build(fold ? '0' : undefined);
  const open = fold ? await build('100') : closed;
  // 열린 모습 범위로 틀을 잡는다 — 닫힘 · 열림이 같은 자리에 오게
  setDoors(open.doors, 1);
  open.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(open.group);
  const c = box.getCenter(new THREE.Vector3()), r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const dir = new THREE.Vector3(-0.42, 0.3, 1).normalize();
  // 상자 꼭짓점이 화면 가장자리 8% 안쪽에 들어오는 거리 — 외접구로 잡으면 장이 화면 절반만 찼다
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
  let dist = r / Math.sin(THREE.MathUtils.degToRad(s.cam.fov / 2));
  for (let k = 0; k < 4; k++) {
    s.cam.position.copy(c).addScaledVector(dir, dist);
    s.cam.lookAt(c);
    s.cam.updateMatrixWorld(); s.cam.updateProjectionMatrix();
    const m = Math.max(...corners.map((p) => { const v = p.clone().project(s.cam); return Math.max(Math.abs(v.x), Math.abs(v.y)); }));
    dist *= m / 0.92;
  }
  s.cam.position.copy(c).addScaledVector(dir, dist);
  s.cam.lookAt(c);
  s.cam.updateMatrixWorld();
  const shot = (g: THREE.Group) => {
    s.scene.add(g); g.updateMatrixWorld(true);
    s.renderer.render(s.scene, s.cam);
    s.scene.remove(g);
    return s.renderer.domElement.toDataURL('image/jpeg', 0.88);
  };
  const urlOpen = shot(open.group);
  if (!fold) setDoors(closed.doors, 0);
  const urlClosed = shot(closed.group);
  disposeTree(closed.group);
  if (open !== closed) disposeTree(open.group);
  return [urlClosed, urlOpen];
}
