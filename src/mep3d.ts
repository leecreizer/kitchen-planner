// 설비 3D — mepOf 결과를 관 · 기기 점 · 인입점으로(설비 보기를 켰을 때만 만든다 · scene.setMep).
// 관은 선분마다 원기둥, 꺾인 곳은 구 — 색마다 한 메시로 합친다(그리기 몇 번). 재질은 색마다 하나(shared — 놓지 않음), 형상은 매번 새로(그룹째 disposeTree)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared } from './dispose';
import { HOT_COLOR, MEP_SIZE, RETURN_COLOR, SYS_COLOR, gasClamps, type MepInfo, type Sys, type V3 } from './mep';
import type { InletKey } from './plan';

const S = 0.001;
/** 관 반지름(mm) — 실물 바깥지름의 반(MEP_SIZE.pipe) */
const RAD = Object.fromEntries(Object.entries(MEP_SIZE.pipe).map(([k, v]) => [k, v / 2])) as Record<Sys, number>;
const mats = new Map<string, THREE.MeshStandardMaterial>();
/** 색 재질 — 빛을 받되 약하게 스스로 빛나 반투명 장 뒤에서도 또렷하게 */
const matOf = (color: string) => {
  let m = mats.get(color);
  if (!m) { m = shared(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.45, metalness: 0.05 })); m.name = `mep-${color}`; mats.set(color, m); }
  return m;
};
/** 묻힌 관(바닥 속 · 벽 속 · 천장 위)은 옅은 같은 색으로 깊이 검사 없이 그려 벽 · 바닥 너머로 비쳐 보이게 — 진한 색은 드러난 관(가스 · 장 안 호스 · 기기에 닿는 꼭지)만.
 *  묻힘 · 노출이 한눈에 갈린다(사용자 2026-11-11 「바닥 · 벽에 매몰」) */
const xmats = new Map<string, THREE.MeshBasicMaterial>();
const xmatOf = (color: string) => {
  let m = xmats.get(color);
  if (!m) { m = shared(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false })); m.name = `mep-x-${color}`; xmats.set(color, m); }
  return m;
};
const colorOf = (sys: Sys, sub?: string) => (sub === 'hot' ? HOT_COLOR : sub === 'return' ? RETURN_COLOR : SYS_COLOR[sys]);
const UP = new THREE.Vector3(0, 1, 0);
function tube(a: V3, b: V3, r: number): THREE.BufferGeometry | null {
  const A = new THREE.Vector3(a[0] * S, a[1] * S, a[2] * S), B = new THREE.Vector3(b[0] * S, b[1] * S, b[2] * S);
  const v = B.clone().sub(A), L = v.length();
  if (L < 1e-4) return null;
  const geo = new THREE.CylinderGeometry(r * S, r * S, L, 10, 1, true);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, v.normalize()));
  geo.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return geo;
}
function ball(p: V3, r: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(r * S, 12, 8);
  geo.translate(p[0] * S, p[1] * S, p[2] * S);
  return geo;
}
/** 바닥 속(음수 높이) 기기 점(세탁기 배수 등)은 바닥 면 바로 위에 표시한다. 관은 실제 자리(바닥 속)에 그리고 비쳐 보이게(xmatOf) */
const ON_FLOOR = 8;
const lift = (p: V3, r = 0): V3 => (p[1] - r < ON_FLOOR ? [p[0], Math.max(p[1], ON_FLOOR + r), p[2]] : p);
/** 이름표를 다는 기기 점 — 수전 · 밸브 · 전용 콘센트 · 팝업 · 후드 · 만나는 자리 */
const LABEL_KINDS = new Set(['faucet', 'valve', 'dedicated', 'popup', 'hood', 'junction']);
/** 고른 설비 테두리 — 흰 선, 반투명 장 · 벽 뒤에서도 보이게 깊이 검사 안 함 */
let selMat: THREE.LineBasicMaterial | null = null;
/** 잡기용 상자 — 화면엔 안 보이고 광선만 맞는다(급수관 Ø20 · 콘센트 판 8.5 처럼 작은 실물도 잡히게 최소 160) */
let pickMat: THREE.MeshBasicMaterial | null = null;
const PICK_MIN = 160;
/** 벽 방향으로 돌린 상자 — 가운데 c, 가로 w(벽 따라) · 높이 h · 깊이 d(법선 n 쪽) */
function obox(c: V3, w: number, h: number, d: number, n: [number, number]): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w * S, h * S, d * S);
  g.rotateY(Math.atan2(n[0], n[1]));
  g.translate(c[0] * S, c[1] * S, c[2] * S);
  return g;
}
/** 원통 — 세운 것(axis 없음) 또는 벽 법선 n 쪽으로 누운 것 */
function ocyl(c: V3, dia: number, len: number, n?: [number, number]): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(dia / 2 * S, dia / 2 * S, len * S, 20);
  if (n) g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(n[0], 0, n[1])));
  g.translate(c[0] * S, c[1] * S, c[2] * S);
  return g;
}
/** 실물 몸체 — 벽에 붙는 것은 뒷면이 벽 면(p)에 닿고 법선 쪽으로 d 만큼, 높이 가운데 = p 높이. 바닥에 서는 것은 밑면이 바닥에 */
function bodyOf(key: InletKey | 'outlet', p: V3, n: [number, number] | undefined, floor: boolean): { geo: THREE.BufferGeometry; c: V3; z: { w: number; h: number; d: number }; n: [number, number] } {
  const z = key === 'outlet' ? MEP_SIZE.outlet : MEP_SIZE.inlet[key], nn = n ?? [0, 1];
  if (floor) {
    const c: V3 = [p[0], z.h / 2, p[2]];
    return { geo: key === 'manifold' ? obox(c, z.w, z.h, z.d, nn) : ocyl(c, z.w, z.h), c, z, n: nn };
  }
  const c: V3 = [p[0] + nn[0] * z.d / 2, p[1], p[2] + nn[1] * z.d / 2];
  return { geo: key === 'duct' ? ocyl(c, z.w, z.d, nn) : obox(c, z.w, z.h, z.d, nn), c, z, n: nn };
}
/** 인입점 · 콘센트는 실물 크기 몸체(userData.mepBody)로 그리고, 눌러 고르고 끌어 옮긴다(사용자 2026-11-11) — 잡기용 투명 상자(userData.mepRef = 인입점 키 ·
 *  'out:' + 콘센트 id)만 장면이 광선으로 본다. sel = 고른 것(흰 테두리) */
export function buildMep3d(info: MepInfo, on: Set<Sys>, sel?: string | null): { group: THREE.Group; labels: { text: string; p: V3 }[]; handles: THREE.Mesh[] } {
  const parts = new Map<string, THREE.BufferGeometry[]>();
  const add = (color: string, g: THREE.BufferGeometry | null) => { if (!g) return; (parts.get(color) ?? parts.set(color, []).get(color)!).push(g); };
  const handles: THREE.Mesh[] = [], extra: THREE.Object3D[] = [];
  const labels: { text: string; p: V3 }[] = [];
  const handle = (ref: string, key: InletKey | 'outlet', color: string, p: V3, n: [number, number] | undefined, floor: boolean, text: string) => {
    const b = bodyOf(key, p, n, floor);
    const body = new THREE.Mesh(b.geo, matOf(color));
    body.name = 'mep-body'; body.userData.mepBody = ref; body.renderOrder = 5; body.raycast = () => {};
    extra.push(body);
    pickMat ??= shared(new THREE.MeshBasicMaterial({ visible: false }));
    const pk = new THREE.Mesh(obox(b.c, Math.max(b.z.w, PICK_MIN), Math.max(b.z.h, PICK_MIN), Math.max(b.z.d, PICK_MIN), b.n), pickMat);
    pk.name = 'mep-handle'; pk.userData.mepRef = ref;
    handles.push(pk);
    if (ref === sel) {
      selMat ??= shared(new THREE.LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true }));
      const g = obox(b.c, b.z.w + 60, b.z.h + 60, b.z.d + 60, b.n);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), selMat); g.dispose();
      e.renderOrder = 7; e.raycast = () => {};
      extra.push(e);
    }
    labels.push({ text, p: [b.c[0], b.c[1] + b.z.h / 2 + 60, b.c[2]] });
  };
  const xparts = new Map<string, THREE.BufferGeometry[]>();
  const addX = (color: string, g: THREE.BufferGeometry | null) => { if (!g) return; (xparts.get(color) ?? xparts.set(color, []).get(color)!).push(g); };
  for (const r of info.runs) {
    if (!on.has(r.sys)) continue;
    // 관은 실제 자리에 — 바닥 속 관도 바닥 밑에(예전엔 바닥이 불투명이라 바닥 면 위로 올렸다). 묻힌 구간은 비쳐 보이는 옅은 색으로
    const c = colorOf(r.sys, r.sub), rad = r.od ? r.od / 2 : RAD[r.sys], pts = r.pts;
    for (let i = 1; i < pts.length; i++) (r.hid?.[i - 1] ? addX : add)(c, tube(pts[i - 1], pts[i], rad));
    for (let i = 1; i < pts.length - 1; i++) (r.hid?.[i - 1] && r.hid?.[i] ? addX : add)(c, ball(pts[i], rad * 1.15));
    // 가스 노출 배관 고정 장치(2m 안마다 · 꺾인 곳) — 관보다 조금 굵은 고리
    if (r.sys === 'gas') for (const q of gasClamps(r)) add('#6b6b6b', ball(q, rad + 9));
  }
  // 기기 점 — 콘센트(벽 · 장 뒤판 법선을 아는 것)는 실물 판, 나머지(수전 · 트랩 · 밸브 …)는 이어지는 자리 표시 점
  const userOut = new Set(info.outlets.map((o) => `${Math.round(o.p[0])},${Math.round(o.p[1])},${Math.round(o.p[2])}`));
  for (const n of info.nodes) {
    if (!on.has(n.sys)) continue;
    const color = /온수/.test(n.label) ? HOT_COLOR : SYS_COLOR[n.sys];
    if ((n.kind === 'outlet' || n.kind === 'dedicated') && n.n) {
      if (userOut.has(`${Math.round(n.p[0])},${Math.round(n.p[1])},${Math.round(n.p[2])}`)) continue;   // 따로 놓은 콘센트는 아래 손잡이가 그린다
      add(color, bodyOf('outlet', n.p, n.n, false).geo);
      if (LABEL_KINDS.has(n.kind)) labels.push({ text: n.label, p: n.p });
      continue;
    }
    const r = n.kind === 'junction' ? 70 : 40, p = lift(n.p, r);
    add(color, ball(p, r));
    if (LABEL_KINDS.has(n.kind)) labels.push({ text: n.label, p });
  }
  for (const i of info.inlets) if (on.has(i.sys)) handle(i.key, i.key, SYS_COLOR[i.sys], i.p, i.n, i.mount === 'floor', `${i.label}${i.pinned ? ' (옮김)' : ''}`);
  if (on.has('power')) for (const o of info.outlets) handle(`out:${o.id}`, 'outlet', SYS_COLOR.power, o.p, o.n, false, '콘센트');
  const group = new THREE.Group();
  group.name = 'mep';
  for (const h of [...handles, ...extra]) group.add(h);
  for (const [color, geos] of parts) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, matOf(color));
    mesh.renderOrder = 5;
    mesh.raycast = () => {};   // 고르기 · 끌기를 막지 않게
    group.add(mesh);
  }
  for (const [color, geos] of xparts) {
    const merged = mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, xmatOf(color));
    mesh.name = 'mep-xray'; mesh.renderOrder = 4; mesh.raycast = () => {};
    group.add(mesh);
  }
  return { group, labels, handles };
}
