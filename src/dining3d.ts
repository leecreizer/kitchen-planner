// 식탁 · 식탁의자 — 홈뷰 한샘 상품(DT_ProductMaster 의 DiningTable · DiningChair) GLB. 원점 = 바닥 가운데, 앞 +z
// 데이터 src/dining.json — 식탁마다 모양(round 원형 · oval 타원 · rect 4각) · 인원(4 · 6) · 실측 크기(W×D×H) · 짝 의자
import * as THREE from 'three';
import { gltfLoader as loader } from './gltf';
import DINING from './dining.json';
import { WALL_T } from './room3d';
import { wallFrame, wallLength, type Design } from './plan';
import { shareTree } from './dispose';

export type DiningShape = 'round' | 'oval' | 'rect';
export interface DiningSet { code: string; name: string; price: number; shape: DiningShape; seats: 4 | 6; size: [number, number, number]; chair: { code: string; name: string; size: [number, number, number]; price: number; auto?: boolean } }
export const DINING_SETS = DINING as DiningSet[];
export const DINING_SHAPES: [DiningShape, string][] = [['round', '원형'], ['oval', '타원'], ['rect', '4각']];

/** 고른 식탁 — 코드가 있으면 그것, 없으면 모양 · 인원에 맞는 첫 상품(없으면 모양만 맞는 것) */
export function diningOf(d: Design): DiningSet | undefined {
  const c = d.dining;
  if (!c) return undefined;
  const hit = DINING_SETS.find((x) => x.code === c.code && x.shape === c.shape && x.seats === c.seats);
  return hit ?? DINING_SETS.find((x) => x.shape === c.shape && x.seats === c.seats) ?? DINING_SETS.find((x) => x.shape === c.shape);
}

const S = 0.001;
const cache = new Map<string, Promise<THREE.Object3D>>();
function model(code: string): Promise<THREE.Object3D> {
  let p = cache.get(code);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}props/dining/${code}.glb`).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.castShadow = m.receiveShadow = true; });
      return shareTree(g.scene);     // 복제본들이 형상 · 재질 · 텍스처를 같이 쓴다
    });
    cache.set(code, p);
  }
  return p.then((s) => s.clone(true));
}

/** 자리 — 트인 쪽이 있으면 거실 쪽(트인 벽 가운데에서 거실로 1000 + 식탁 반 깊이), 없으면 부엌 가운데. 사용자 자리(pos)가 우선 */
export function diningPlace(d: Design, set: DiningSet): { x: number; z: number; rot: number } {
  const c = d.dining!;
  if (c.pos) return c.pos;
  const r = d.room;
  if (c.where !== 'kitchen' && d.openWall != null) {
    const f = wallFrame(r, d.openWall), L = wallLength(r, d.openWall), u = -(WALL_T + 1000 + set.size[1] / 2);
    const x = f.o[0] + f.dir[0] * L / 2 + f.n[0] * u, z = f.o[1] + f.dir[1] * L / 2 + f.n[1] * u;
    // 식탁 긴 변을 트인 벽과 나란히
    return { x, z, rot: Math.atan2(-f.dir[1], f.dir[0]) };
  }
  return { x: r.w / 2, z: r.d / 2, rot: 0 };
}

/** 의자 자리 — 식탁 가운데 기준(mm) · 의자가 보는 방향(three 회전). 4각 · 타원은 긴 변 양쪽에 인원/2 씩, 원형은 둘레에 인원만큼 (3D · 평면도 같이 씀) */
export function chairSpots(set: DiningSet): { x: number; z: number; face: number }[] {
  const [W, D] = set.size, cd = set.chair.size[1], out: { x: number; z: number; face: number }[] = [];
  if (set.shape === 'round') {
    const R = W / 2 + cd * 0.15;
    for (let i = 0; i < set.seats; i++) { const a = (i / set.seats) * Math.PI * 2 + Math.PI / 4; out.push({ x: Math.sin(a) * R, z: Math.cos(a) * R, face: a + Math.PI }); }
  } else {
    const n = set.seats / 2, gap = W / n, zz = D / 2 + cd * 0.15;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + gap * (i + 0.5);
      out.push({ x, z: -zz, face: 0 }, { x, z: zz, face: Math.PI });   // 뒤쪽 의자(앞 +z 가 식탁을 본다) · 앞쪽 의자
    }
  }
  return out;
}
/** 놓인 자리 · 방향(three 회전 y, 라디안) — 3D holder 와 같은 값 */
export function diningPose(d: Design, set: DiningSet): { x: number; z: number; ry: number } {
  const p = diningPlace(d, set);
  return { x: p.x, z: p.z, ry: p.rot + ((d.dining?.rot ?? 0) * Math.PI) / 180 };
}

/** 식탁 + 의자 — 의자 자리는 chairSpots */
export async function buildDining(d: Design): Promise<THREE.Group> {
  const g = new THREE.Group();
  g.name = 'dining';
  const set = diningOf(d);
  if (!d.dining?.on || !set) return g;
  const [table, ...chairs] = await Promise.all([model(set.code), ...Array.from({ length: set.seats }, () => model(set.chair.code))]);
  const root = new THREE.Group();
  root.add(table);
  // 모델은 m 단위 — 자리(mm)는 S 로
  chairSpots(set).forEach((s, i) => { const ch = chairs[i]; if (!ch) return; ch.position.set(s.x * S, 0, s.z * S); ch.rotation.y = s.face; root.add(ch); });
  const p = diningPose(d, set);
  const holder = new THREE.Group();
  holder.position.set(p.x * S, 0, p.z * S);
  holder.rotation.y = p.ry;
  holder.add(root);
  holder.userData.dining = true;
  g.add(holder);
  return g;
}
