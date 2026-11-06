// 배치안 → 3D — 장(원본 계산) · EP · FIX 도어 · 냉장고 · 걸레받이 · 서라운딩 · 상판 · 벽 타일 · 싱크볼 · 수전 · 쿡탑
import * as THREE from 'three';
import { gltfLoader as gltf } from './gltf';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Candidate, Frame, Item } from './autoplan';
import { BASE_D, CORNER_D, COUNTER_D, FRIDGE_GAP_BACK, fridgeSpec, TALL_TOP, upperBottomOf, upperTopOf } from './autoplan';
import { boxUV, buildModule, cabinetCacheGeneration, partMaterial, texture, trimCabinetCache, type DoorPart } from './cabinet3d';
import { shared, shareTree } from './dispose';
import { ISLAND_HOOD_DEFAULT, hoodKindOf, applianceOf, type Appliance } from './catalog';
import { texUrl, type GradeDef, type KitchenCatalog, type Series } from './kjlLib';
import { CASING } from './room3d';
import { FRIDGE_COLORS, ISLAND_TABLE, SPLASH_DEFAULT, nextWall, prevWall, wallLength, type Design, type WallId } from './plan';

const S = 0.001;
/** 높이(mm) — 걸레받이 위에 원본 몸통(768)을 올리고 상판을 덮어 910 (원본 EP B 880 = 상판 아래까지) */
export const PLINTH = 112, COUNTER_T = 30, COUNTER_TOP = 910, SPLASH_H = 620;
/** 걸레받이 앞면 — 도어 면(593)에서 55 들어감 · 두께 18 */
const PLINTH_Z = 520, SKIRT_T = 18;
/** 원본 휠라 앞판 재질(고정 회색) — 도어 재질로 바꿔 칠한다 */
const FILL_FACE = '3FO3XT53OP3P';
/** 싱크볼 — 가운데 깊이(벽에서) · 상판 구멍(볼 테두리 818×450 에서 20 씩 안쪽) */
const SINK_Z = 330, SINK_HOLE: [number, number] = [778, 410];

export interface KitchenObj { group: THREE.Group; items: { item: Item; obj: THREE.Object3D }[]; ms: number; doorMat?: THREE.Material; doors: DoorPart[] }

/** 문 열기 — t 0(닫힘)~1(열림). 여닫이 좌우 90° · 플랩 위로 · 식세 아래로 85° · 서랍은 몸통 깊이 3/4 앞으로 — 각 문짝의 max(충돌로 줄어듦)까지 */
export function setDoors(doors: DoorPart[], t: number) {
  for (const d of doors) {
    if (d.kind === 'swing') d.pivot.rotation.y = d.amt * t * d.max;
    else if (d.kind === 'flap') d.pivot.rotation.x = d.amt * t * d.max;
    else d.pivot.position.z = (d.pivot.userData.z0 ??= d.pivot.position.z) + d.amt * t * d.max;
  }
}

/** 문짝끼리 충돌 — 전부 연 상태에서 문짝 · 서랍 상자(OBB)가 겹치면 겹친 둘을 조금씩 덜 연다(여닫이 · 플랩 5°, 서랍 10%).
 *  같은 장 안 문짝끼리도 본다(코너장 · 2도어). 최소 여닫이 30° · 서랍 30% */
function limitDoors(root: THREE.Object3D, doors: DoorPart[]) {
  const local = doors.map((d) => {
    const b = new THREE.Box3();
    for (const m of d.pivot.children) { const g = (m as THREE.Mesh).geometry; if (!g) continue; g.computeBoundingBox(); b.union(g.boundingBox!.clone().translate(m.position)); }
    b.expandByScalar(-1); // 맞닿기만 한 것은 충돌 아님
    return b;
  });
  const minOf = (d: DoorPart) => (d.kind === 'drawer' ? 0.3 : THREE.MathUtils.degToRad(30));
  const step = (d: DoorPart) => (d.kind === 'drawer' ? 0.1 : THREE.MathUtils.degToRad(5));
  for (let iter = 0; iter < 16; iter++) {
    setDoors(doors, 1);
    root.updateMatrixWorld(true);
    const obb = doors.map((d, i) => new OBB().fromBox3(local[i]).applyMatrix4(d.pivot.matrixWorld));
    const hit = new Set<number>();
    for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) if (obb[i].intersectsOBB(obb[j])) { hit.add(i); hit.add(j); }
    if (!hit.size) break;
    for (const i of hit) doors[i].max = Math.max(minOf(doors[i]), doors[i].max - step(doors[i]));
  }
  setDoors(doors, 0);
}

/** 벽 마감 — 상판 위 벽. 벽마다 타일(기본) 또는 벽판넬(상판 재질 판, 두께 6). 창 자리는 창 몰딩(CASING) 아래까지만
 *  (창을 옮기면 이것만 다시 만든다). 메시마다 userData.splashWall = 벽 — 3D 에서 눌러 고른다 */
export function buildSplashes(c: Candidate, d: Design, cat: KitchenCatalog): THREE.Group {
  const out = new THREE.Group();
  out.name = 'splash';
  const wallOf = new Map<Frame, WallId>();
  for (const it of c.items) if (it.wall != null) wallOf.set(it.frame, it.wall);
  const tile = cat.tiles.find((x) => x.id === d.tile) ?? cat.tiles[0];
  const tileMat = new THREE.MeshStandardMaterial({ map: texture(texUrl(tile.id)), roughness: 0.35 });
  const panelMats = new Map<string, THREE.MeshStandardMaterial>();
  const done = new Set<WallId>();
  for (const s of c.splashes) {
    const wall = wallOf.get(s.frame);
    const g = frameGroup(s.frame);
    if (wall != null) g.userData.wall = wall;
    const cfg = (wall != null ? d.splash?.[wall] : undefined) ?? { kind: 'tile' as const };
    const panel = cfg.kind === 'panel';
    const y0 = cfg.y ?? COUNTER_TOP, H = cfg.h ?? SPLASH_DEFAULT.h, dep = cfg.depth ?? (panel ? SPLASH_DEFAULT.panelDepth : 0);
    // 길이 · 시작 — 입력했으면 그 구간 그대로(벽 안으로만, 그 벽에 한 번). 예전엔 상판 줄 구간마다 잘려 입력과 달랐다. 안 했으면 상판 줄 구간
    const own = cfg.t0 != null || cfg.len != null;
    if (own && wall != null && done.has(wall)) { out.add(g); continue; }
    if (own && wall != null) done.add(wall);
    const segs = wall != null ? c.splashes.filter((x) => wallOf.get(x.frame) === wall) : [s];
    const a0 = Math.min(...segs.map((x) => x.t0)), a1 = Math.max(...segs.map((x) => x.t1)), L = wall != null ? wallLength(d.room, wall) : s.t1;
    const r0 = own ? Math.max(0, cfg.t0 ?? a0) : s.t0, r1 = own ? Math.min(L, cfg.len != null ? (cfg.t0 ?? a0) + cfg.len : a1) : s.t1;
    if (r1 - r0 < 1) { out.add(g); continue; }
    const pm = panel ? cat.counters.find((x) => x.id === cfg.mat) ?? cat.counters.find((x) => x.id === d.counter) ?? cat.counters[0] : undefined;
    let mat: THREE.MeshStandardMaterial = tileMat;
    if (pm) { mat = panelMats.get(pm.id) ?? new THREE.MeshStandardMaterial({ map: texture(texUrl(pm.id)), roughness: 0.3 }); panelMats.set(pm.id, mat); }
    const ops = d.openings.filter((o) => o.wall === wall && (o.kind === 'window' ? o.sill < y0 + H + CASING : true));
    const cuts: number[] = [r0, r1];
    for (const o of ops) cuts.push(o.t - CASING, o.t + o.w + CASING);
    const xs = [...new Set(cuts.filter((x) => x >= r0 && x <= r1))].sort((x, y) => x - y);
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
      if (x1 - x0 < 1) continue;
      const op = ops.find((o) => mid > o.t - CASING && mid < o.t + o.w + CASING);
      const h = op ? (op.kind === 'window' ? Math.min(H, op.sill - CASING - y0) : 0) : H;
      if (h < 20) continue;
      // 줄눈 · 결은 시작 위치(r0) · 배치 높이(y0)에서 시작 — 그 점을 원점으로 UV 를 잡고 메시를 옮긴다
      let geo: THREE.BufferGeometry;
      if (panel) {
        // 벽판넬 — 벽에 붙인 판(두께 dep). 상판 재질 결 그대로(mm 투영)
        geo = new THREE.BoxGeometry(x1 - x0, h, Math.max(1, dep));
        geo.translate(mid - r0, h / 2, Math.max(1, dep) / 2);
        worldUV(geo, pm!.size);
      } else {
        geo = new THREE.PlaneGeometry(x1 - x0, h);
        geo.translate(mid - r0, h / 2, 2 + dep);
        worldUV(geo, tile.size[0], tile.size[1]);
      }
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; m.castShadow = panel;
      m.position.set(r0, y0, 0);
      m.userData.splashWall = wall;
      g.add(m);
    }
    out.add(g);
  }
  return out;
}

function frameGroup(f: Frame, t = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set((f.o[0] + f.dir[0] * t) * S, 0, (f.o[1] + f.dir[1] * t) * S);
  g.rotation.y = Math.atan2(-f.dir[1], f.dir[0]);
  g.scale.setScalar(S);
  return g;
}
/** 상자 — 재질에 텍스처가 있으면 mm 투영(서 있는 면 세로결). horiz = 가로결(상부 서라운딩처럼 긴 띠) */
const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, horiz = false) => {
  const g = new THREE.BoxGeometry(w, h, d);
  // 도어 재질 판(서라운딩 · 패널)도 장과 같은 mm 투영 — 기본 UV 면 하나에 이미지 한 장이 늘어나 결이 퍼진다
  if ((mat as THREE.MeshStandardMaterial).map) { g.translate(x, y, z); boxUV(g, 1000, horiz ? 90 : 0); g.translate(-x, -y, -z); }
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
};
/** 빌트인 후드 — 후드장 밑면(y) 아래로 스테인리스 몸체 · 앞쪽 검은 유리 바이저 · 조명 두 개 (원본 후드장은 기기 자리만 비워 둔다) */
// 모듈 수준 재질은 그릴 때마다 같이 쓴다 — 다 쓴 부엌을 놓을 때 건너뛰게 shared
const steel = shared(new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 0.85, roughness: 0.32 }));
const visor = shared(new THREE.MeshStandardMaterial({ color: '#111214', metalness: 0.3, roughness: 0.08 }));
const lamp = shared(new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: '#fff1cc', emissiveIntensity: 1.2 }));
function hoodUnit(w: number, y: number, depth: number, cw = w): THREE.Group {
  // w = 후드 기기 폭(카탈로그 규격) · cw = 후드장 폭 — 장 가운데에
  const g = new THREE.Group();
  const bw = Math.min(w, cw - 40), d = depth - 30, x = cw / 2;
  g.add(box(bw, 40, d, steel, x, y - 20, d / 2 + 10));
  g.add(box(bw, 8, 70, visor, x, y - 44, d + 10 - 35));
  for (const dx of [-bw / 4, bw / 4]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(28, 28, 3, 24), lamp);
    l.position.set(x + dx, y - 41.5, d / 2); g.add(l);
  }
  return g;
}
/** 아래 wb × db · 위 wt × dt 사각뿔대 (뒤 z 0 맞춤 · back=false 면 가운데 맞춤) — 침니 후드 몸통 */
function frustum(wb: number, db: number, wt: number, dt: number, h: number, mat: THREE.Material, back = true): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1), p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 0, w = top ? wt : wb, dd = top ? dt : db;
    p.setXYZ(i, p.getX(i) * w, (p.getY(i) + 0.5) * h, back ? (p.getZ(i) + 0.5) * dd : p.getZ(i) * dd);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true;
  return m;
}
/** 후드 색 — 이름에 WH 만 있으면 흰색, BK 만 있으면 검정, 아니면 스테인리스 */
function hoodMat(name = ''): THREE.Material {
  const wh = /WH|화이트/.test(name), bk = /BK|블랙/.test(name);
  if (wh && !bk) return new THREE.MeshStandardMaterial({ color: '#f1f0ec', roughness: 0.35 });
  if (bk && !wh) return new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.3, metalness: 0.3 });
  return steel;
}
/** 벽부형(침니) 후드 — 캐노피(아래 판 + 사각뿔대) + 천장까지 굴뚝. 후드장 자리(cw) 가운데, 쿡탑 위 700 */
function chimneyHood(cw: number, a: Appliance | undefined, roomH: number): THREE.Group {
  const g = new THREE.Group(), mat = hoodMat(a?.name);
  const W = Math.min(cw - 10, a?.size?.[0] ?? 900), D = Math.min(520, a?.size?.[1] ?? 450), x = cw / 2;
  const y0 = COUNTER_TOP + 700, lip = 50, taper = 220, cwid = Math.min(300, W * 0.4), cdep = Math.min(260, D * 0.6);
  const base = box(W, lip, D, mat, x, y0 + lip / 2, D / 2); g.add(base);
  g.add(box(W - 40, 4, D - 40, visor, x, y0 - 1, D / 2));
  for (const dx of [-W / 4, W / 4]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 3, 20), lamp); l.position.set(x + dx, y0 - 2, D / 2); g.add(l); }
  const fr = frustum(W, D, cwid, cdep, taper, mat); fr.position.set(x, y0 + lip, 0); g.add(fr);
  const ch0 = y0 + lip + taper;
  if (roomH - ch0 > 10) g.add(box(cwid, roomH - ch0, cdep, mat, x, (ch0 + roomH) / 2, cdep / 2));
  return g;
}
/** 천장형(아일랜드) 후드 — 원통형(폭 520 이하 · 깊이 없음) · 침니형(이름에 침니) · 판형(넓은 것, 줄로 매닮). 가운데 원점, 바닥 = 쿡탑 위 700 */
function ceilingHood(a: Appliance | undefined, roomH: number): THREE.Group {
  const g = new THREE.Group(), mat = hoodMat(a?.name);
  const W = a?.size?.[0] ?? 340, D = a?.size?.[1] ?? null, y0 = COUNTER_TOP + 700;
  if (D == null || W <= 520 && (D ?? 0) <= 520 && !/침니/.test(a?.name ?? '')) {
    const r = W / 2, h = Math.min(a?.size?.[2] ?? 750, roomH - y0);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), mat); cyl.position.y = y0 + h / 2; cyl.castShadow = true; g.add(cyl);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(r - 20, r - 20, 3, 40), lamp); lens.position.y = y0 - 1; g.add(lens);
    // 천장까지 남으면 가는 봉
    if (roomH - (y0 + h) > 5) { const rod = new THREE.Mesh(new THREE.CylinderGeometry(15, 15, roomH - y0 - h, 12), mat); rod.position.y = (y0 + h + roomH) / 2; g.add(rod); }
  } else if (/침니/.test(a?.name ?? '')) {
    const lip = 50, taper = 220, cw = Math.min(300, W * 0.4), cd = Math.min(300, D * 0.6);
    g.add(box(W, lip, D, mat, 0, y0 + lip / 2, 0));
    g.add(box(W - 40, 4, D - 40, visor, 0, y0 - 1, 0));
    const fr = frustum(W, D, cw, cd, taper, mat, false); fr.position.set(0, y0 + lip, 0); g.add(fr);
    const c0 = y0 + lip + taper;
    if (roomH - c0 > 10) g.add(box(cw, roomH - c0, cd, mat, 0, (c0 + roomH) / 2, 0));
  } else {
    const T = 60, dd = D ?? 600;
    g.add(box(W, T, dd, mat, 0, y0 + T / 2, 0));
    g.add(box(W - 60, 4, dd - 60, lamp, 0, y0 - 1, 0));
    const wire = new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.7, roughness: 0.3 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, roomH - y0 - T, 6), wire);
      c.position.set(sx * (W / 2 - 80), (y0 + T + roomH) / 2, sz * (dd / 2 - 80)); g.add(c);
    }
  }
  return g;
}

/* ───────── 식기세척기 내부 — 스테인리스 통 · 위아래 바구니 · 수저 트레이 · 회전 노즐 (원본 식세장은 기기 자리만 비워 둔다) ───────── */
const dwSteel = shared(new THREE.MeshStandardMaterial({ color: '#cfd2d5', metalness: 0.75, roughness: 0.28 }));
const dwDark = shared(new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.5 }));
const dwWire = shared(new THREE.MeshStandardMaterial({ color: '#9ea3a8', metalness: 0.6, roughness: 0.35 }));
const dwGray = shared(new THREE.MeshStandardMaterial({ color: '#7d8287', roughness: 0.45 }));
/** 움직이지 않는 작은 부품 묶음을 재질별로 한 메시씩 — 그리기 호출(드로우콜)을 줄인다. 자식 메시만(손자 없음), 위치 · 회전을 형상에 굽는다 */
function mergeByMaterial(g: THREE.Group): THREE.Group {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const c of [...g.children]) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.children.length) continue;
    m.updateMatrix();
    const geo = m.geometry.clone().applyMatrix4(m.matrix);
    // 합칠 형상끼리 속성이 같아야 한다 — 위치 · 법선 · UV 만 남긴다
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    const list = byMat.get(m.material) ?? []; list.push(geo); byMat.set(m.material, list);
    g.remove(m); m.geometry.dispose();
  }
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const geo of merged ? [merged] : geos) { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); }
    if (merged) geos.forEach((x) => x.dispose());
  }
  return g;
}

/** 식기세척기 속 — 철망 살 하나하나가 상자라 280개 남짓이었다 → 재질별로 합쳐 4개(장 전체 그리기 호출의 70%) */
function dishInterior(W: number): THREE.Group {
  return mergeByMaterial(dishInteriorParts(W));
}
function dishInteriorParts(W: number): THREE.Group {
  const g = new THREE.Group();
  const x0 = 22, x1 = W - 22, y0 = PLINTH + 12, y1 = PLINTH + 722, z0 = 40, z1 = 560, cx = (x0 + x1) / 2, iw = x1 - x0, T = 4;
  // 통 — 옆 · 뒤 · 위 · 바닥
  g.add(box(T, y1 - y0, z1 - z0, dwSteel, x0 + T / 2, (y0 + y1) / 2, (z0 + z1) / 2), box(T, y1 - y0, z1 - z0, dwSteel, x1 - T / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  g.add(box(iw, y1 - y0, T, dwSteel, cx, (y0 + y1) / 2, z0 + T / 2));
  g.add(box(iw, T, z1 - z0, dwSteel, cx, y1 - T / 2, (z0 + z1) / 2), box(iw, T, z1 - z0, dwSteel, cx, y0 + T / 2, (z0 + z1) / 2));
  // 바구니 — 철망 테두리(사각) + 바닥 살 + 그릇 받침살
  const rack = (y: number, h: number, tines: boolean) => {
    const rx0 = x0 + 15, rx1 = x1 - 15, rz0 = z0 + 20, rz1 = z1 - 10, w = rx1 - rx0, dz = rz1 - rz0, d = 6;
    for (const yy of [y, y + h]) {
      g.add(box(w, d, d, dwWire, (rx0 + rx1) / 2, yy, rz0), box(w, d, d, dwWire, (rx0 + rx1) / 2, yy, rz1));
      g.add(box(d, d, dz, dwWire, rx0, yy, (rz0 + rz1) / 2), box(d, d, dz, dwWire, rx1, yy, (rz0 + rz1) / 2));
    }
    for (const [xx, zz] of [[rx0, rz0], [rx1, rz0], [rx0, rz1], [rx1, rz1]]) g.add(box(d, h, d, dwWire, xx, y + h / 2, zz));
    for (let x = rx0 + 40; x < rx1; x += 40) g.add(box(3, 3, dz, dwWire, x, y, (rz0 + rz1) / 2));
    if (tines) for (let z = rz0 + 50; z < rz1 - 20; z += 55) for (let x = rx0 + 40; x < rx1; x += 40) g.add(box(3, 70, 3, dwWire, x, y + 35, z));
    // 바구니 바퀴
    for (const [xx, zz] of [[rx0, rz0 + 40], [rx1, rz0 + 40], [rx0, rz1 - 40], [rx1, rz1 - 40]]) { const wh = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 8, 14), dwGray); wh.rotation.z = Math.PI / 2; wh.position.set(xx, y - 10, zz); g.add(wh); }
  };
  rack(y0 + 70, 170, true);     // 아래 바구니 — 접시
  rack(y0 + 380, 140, true);    // 위 바구니 — 컵 · 그릇
  // 맨 위 수저 트레이
  g.add(box(iw - 40, 40, z1 - z0 - 40, dwGray, cx, y1 - 60, (z0 + z1) / 2 + 10));
  // 회전 노즐 — 바닥 · 아래 바구니 밑
  for (const yy of [y0 + 30, y0 + 360]) {
    const arm = box(iw - 120, 10, 36, dwGray, cx, yy, (z0 + z1) / 2); arm.rotation.y = 0.5; g.add(arm);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 16, 20), dwGray); hub.position.set(cx, yy, (z0 + z1) / 2); g.add(hub);
  }
  // 바닥 필터
  const flt = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 12, 24), dwDark); flt.position.set(cx, y0 + 8, z0 + 140); g.add(flt);
  return g;
}

/* ───────── 냉장고 — 삼성 비스포크 스타일(평면 컬러 패널 · 홈 손잡이 · 얇은 이음 · 아래 그릴). 원점 = 기기 왼쪽 뒤 바닥 ───────── */
const fridgeBody = shared(new THREE.MeshStandardMaterial({ color: '#c8cacc', metalness: 0.55, roughness: 0.35 }));
const fridgeDark = shared(new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.6 }));
const fridgeMats = new Map<string, THREE.MeshStandardMaterial>();
function fridgeColor(d: Design): THREE.MeshStandardMaterial {
  const c = FRIDGE_COLORS.find((x) => x[0] === d.fridgeColor) ?? FRIDGE_COLORS[0];
  let m = fridgeMats.get(c[0]);
  if (!m) fridgeMats.set(c[0], (m = shared(new THREE.MeshStandardMaterial({ color: c[2], roughness: c[3] ? 0.12 : 0.55, metalness: c[3] ? 0.05 : 0 }))));
  return m;
}
/** kind — oneL · oneR 1도어(경첩 왼쪽 · 오른쪽) · quad 4도어(위 양문 + 아래 서랍 2) · sbs 양문형 */
function bespokeFridge(kind: 'oneL' | 'oneR' | 'quad' | 'sbs', W: number, H: number, D: number, panel: THREE.Material, doors: DoorPart[], chan: [number, number] = [846, 880]): THREE.Group {
  const g = new THREE.Group();
  // 문 두께 58(비스포크처럼 두툼하게) — 은회색 문 몸통 + 앞면 컬러 패널 8. 전체 깊이 D 는 그대로(몸통이 그만큼 얕아짐)
  const PT = 58, PANEL = 8, gap = 4, base = 70, bodyD = D - PT;
  // 몸통 — 옆면 은회색, 아래 그릴
  g.add(box(W - 2, H - 2, bodyD, fridgeBody, W / 2, (H - 2) / 2, bodyD / 2));
  g.add(box(W - 40, base - 10, 8, fridgeDark, W / 2, (base - 10) / 2, bodyD + 4));
  /** 문 하나 — 패널 + 손잡이 홈(gEdge 쪽 가장자리 · 'x0' 왼쪽 · 'x1' 오른쪽 · 'y0' 아래 · 'y1' 위). hinge: 'L' · 'R' 여닫이, 'drawer' 서랍 */
  const door = (x0: number, x1: number, y0: number, y1: number, hinge: 'L' | 'R' | 'drawer', grip: 'x0' | 'x1' | 'y0' | 'y1' | null) => {
    const w = x1 - x0 - gap, h = y1 - y0 - gap, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pivot = new THREE.Group();
    // 경첩 축 — 문 앞면 바깥 모서리(옆 기기 · EP 와 안 겹치게)
    const px = hinge === 'L' ? x0 + gap / 2 : hinge === 'R' ? x1 - gap / 2 : 0, pz = bodyD + PT;
    pivot.position.set(px, 0, pz);
    const add = (o: THREE.Object3D) => { o.position.x -= px; o.position.z -= pz; pivot.add(o); };
    // 홈 손잡이 — 손잡이 쪽 가장자리 GW 만큼 문(몸통 · 패널)을 비우고, 그 자리를 앞면보다 RE 들어간 어두운 홈으로(문 전체 높이)
    // 예전엔 홈 상자가 문 안에 묻혀 보이지 않았다
    const GW = 22, RE = 14;
    const sx = grip === 'x0' ? GW : 0, ex = grip === 'x1' ? GW : 0;
    const pw = w - sx - ex, pcx = cx + (sx - ex) / 2;
    add(box(pw, h, PT - PANEL, fridgeBody, pcx, cy, bodyD + (PT - PANEL) / 2));
    add(box(pw, h, PANEL, panel, pcx, cy, bodyD + PT - PANEL / 2));
    if (grip === 'x0' || grip === 'x1') {
      const gx = grip === 'x0' ? x0 + gap / 2 + GW / 2 : x1 - gap / 2 - GW / 2;
      add(box(GW, h, PT - RE, fridgeDark, gx, cy, bodyD + (PT - RE) / 2));
    }
    g.add(pivot);
    doors.push(hinge === 'drawer' ? { pivot, kind: 'drawer', amt: Math.round(bodyD * 0.7), max: 1 } : { pivot, kind: 'swing', amt: hinge === 'L' ? -1 : 1, max: Math.PI / 2 });
  };
  if (kind === 'oneL' || kind === 'oneR') {
    door(0, W, base, H, kind === 'oneL' ? 'L' : 'R', kind === 'oneL' ? 'x1' : 'x0');
  } else if (kind === 'sbs') {
    door(0, W / 2, base, H, 'L', 'x1'); door(W / 2, W, base, H, 'R', 'x0');
  } else {
    // 4도어 — 위 냉장 양문 · 아래 냉동 서랍 둘(좌우). 위아래 사이가 손잡이 홈이고 높이는 하부장 찬넬과 같은 줄(사용자)
    const [c0, c1] = chan;
    door(0, W / 2, c1 - gap / 2, H, 'L', null); door(W / 2, W, c1 - gap / 2, H, 'R', null);
    door(0, W / 2, base, c0 + gap / 2, 'drawer', null); door(W / 2, W, base, c0 + gap / 2, 'drawer', null);
    // 손잡이 홈 — 찬넬처럼 안쪽으로 파인 어두운 띠 + 아래 턱(은색)
    g.add(box(W - 4, c1 - c0, PT - 8, fridgeDark, W / 2, (c0 + c1) / 2, bodyD + (PT - 8) / 2));
    g.add(box(W - 4, 4, PT, fridgeBody, W / 2, c0 + 2, bodyD + PT / 2));
  }
  return g;
}

/** 상판 · 타일 UV — 평면 mm 를 재질 크기로 */
function worldUV(g: THREE.BufferGeometry, su: number, sv = su) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ay > 0.5 ? p.getX(i) : ax > 0.5 ? p.getZ(i) : p.getX(i);
    const v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv[i * 2] = u / su; uv[i * 2 + 1] = v / sv;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/* ───────── 기기 모델 (홈뷰 상품 GLB, m 단위 · 앞면 +z) ─────────
 *  sink_a = 싱크볼(SSU000166, 818×450 · 윗면 y 0~5, 볼은 아래로) · faucet_a = 수전(SHD000146, 바닥 원점 · 토출구 +z)
 *  hob_a = 인덕션(SCB000273, 626×7×526 검은 유리 · 바닥 원점). Draco + WebP 압축본(gltf.ts) */
const propCache = new Map<string, Promise<THREE.Object3D>>();
function propModel(name: string): Promise<THREE.Object3D> {
  let p = propCache.get(name);
  if (!p) {
    p = gltf.loadAsync(`${import.meta.env.BASE_URL}props/${name}.glb`).then((g) => {
      g.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
      return shareTree(g.scene);     // 복제본들이 형상 · 재질 · 텍스처를 같이 쓴다
    });
    propCache.set(name, p);
  }
  return p.then((s) => s.clone(true));
}

export async function buildKitchen(c: Candidate, d: Design, cat: KitchenCatalog, grade: GradeDef, doorObs: string, onProgress?: (done: number, all: number) => void): Promise<KitchenObj> {
  const t0 = performance.now();
  cabinetCacheGeneration();
  const group = new THREE.Group();
  group.name = 'kitchen';
  const series: Series = grade.series;
  const door = { var: grade.var, obs: doorObs };
  const out: KitchenObj['items'] = [];
  const doors: DoorPart[] = [];
  let doorMat: THREE.Material | undefined;
  const noVarDoors: DoorPart[] = [];
  const carcass = new THREE.MeshStandardMaterial({ color: '#3b3b3d', roughness: 0.6 });
  const upperTop = upperTopOf(d.room);
  // 프레임 → 벽 (카메라 쪽 벽을 숨길 때 그 벽의 장 · 상판 · 마감도 같이)
  const wallOf = new Map<Frame, WallId>();
  for (const it of c.items) if (it.wall != null) wallOf.set(it.frame, it.wall);
  const tag = (o: THREE.Object3D, f: Frame) => { const w = wallOf.get(f); if (w != null) o.userData.wall = w; return o; };

  let done = 0;
  const jobs = c.items.map(async (it) => {
    const g = frameGroup(it.frame, it.t);
    g.userData.item = it;
    tag(g, it.frame);
    if (it.key === 'fridge') {
      // 냉장고장 — 삼성 비스포크 스타일 기기(직접 모델링, 종류별 규격)를 자리 가운데에, 뒤 틈 두고. 문은 문 열기로 같이 열린다
      const fs = fridgeSpec(d);
      const n = fs.n, z0 = FRIDGE_GAP_BACK / 2;
      for (let i = 0; i < n; i++) {
        const x0 = it.w / 2 + (i - (n - 1) / 2) * (fs.unitW + 5) - fs.unitW / 2;
        // 1도어 2대 — 왼쪽 대는 왼쪽 경첩, 오른쪽 대는 오른쪽 경첩(가운데로 손잡이 홈)
        const kind = d.fridgeKind === 'quad' ? 'quad' : d.fridgeKind === 'sbs' ? 'sbs' : i === 0 ? 'oneL' : 'oneR';
        // 4도어 위아래 사이(손잡이 홈) = 하부장 찬넬 높이(도어 윗선 ~ 상판 아래)
        const f = bespokeFridge(kind, fs.unitW, fs.h, fs.d, fridgeColor(d), doors, [PLINTH + (series === 'KB' ? 740 : 734), COUNTER_TOP - COUNTER_T]);
        f.position.set(x0, 0, z0);
        g.add(f);
      }
      g.userData.top = fs.h; g.userData.depth = fs.d + FRIDGE_GAP_BACK / 2;
      group.add(g); out.push({ item: it, obj: g });
      onProgress?.(++done, c.items.length);
      return;
    }
    if (it.key === 'hood' && hoodKindOf(applianceOf('hood', d.appliance?.hood)) === 'chimney') {
      g.add(chimneyHood(it.w, applianceOf('hood', d.appliance?.hood), d.room.h));
      g.userData.top = d.room.h; g.userData.depth = 0; g.userData.chimney = true;
      group.add(g); out.push({ item: it, obj: g });
      onProgress?.(++done, c.items.length);
      return;
    }
    if (it.key === 'fixFill') {
      g.userData.top = COUNTER_TOP - COUNTER_T; g.userData.depth = 20;
      group.add(g); out.push({ item: it, obj: g });
      return;
    }
    const m = cat.modules.find((x) => x.key === it.key && (x.series === series || x.series === '*'))
      ?? cat.modules.find((x) => x.key === it.key);
    if (!m) return;
    const b = await buildModule(m, it.w, m.doorVar ? door : undefined, it.ov ?? {});
    onProgress?.(++done, c.items.length);
    const inner = b.group;
    const fh = b.frame.max.y - b.frame.min.y;
    let y = 0;
    if (it.tag === 'ep') y = it.key === 'epW' ? upperBottomOf(d.room) : 0;
    else if (it.level === 'base' || it.level === 'tall') y = PLINTH;
    else if (it.key === 'fridgeTop') y = Math.min(d.room.h, TALL_TOP) - fh;
    else if (it.level === 'wall') y = upperTop - fh;
    else if (it.level === 'shelf') y = it.y ?? 1500;
    if (it.tag === 'fix') {
      // FIX 도어 — 원본은 옆판처럼(두께가 x) 정의돼 있어 판 면이 바깥(프레임 +z)을 보게 세운다
      const holder = new THREE.Group();
      holder.add(inner);
      const bb0 = new THREE.Box3().setFromObject(inner);
      const sz = bb0.getSize(new THREE.Vector3());
      if (sz.x < sz.z) holder.rotation.y = -Math.PI / 2;
      holder.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(holder);
      holder.position.set(-bb.min.x, PLINTH - bb.min.y, -bb.min.z);
      g.add(holder);
      g.userData.top = PLINTH + (bb.max.y - bb.min.y); g.userData.depth = bb.max.z - bb.min.z;
    } else {
      // 원본 틀 왼쪽 아래 뒤 = 장 로컬 원점 (K2L 뒤 z: 뒤 = min.z, 앞 = max.z)
      // 코너장 L 은 장 자리(t)가 몸통 시작 — 원본 틀은 그보다 100 앞에서 시작한다(autoplan 참고)
      const lShift = it.key === 'cornerL' ? (b.frame.max.x - b.frame.min.x) - it.w : 0;
      inner.position.set(-b.frame.min.x - lShift, y - b.frame.min.y, -b.frame.min.z);
      g.add(inner);
      g.userData.top = y + fh;
      // EP 는 옆 장 깊이를 따른다(서라운딩 · 걸레받이 묶음에서 끊기지 않게)
      // 코너 상부장은 틀 깊이 340 이지만 도어 앞면은 일반 상부장(320 + 도어)과 같은 면 — 틀대로 두면 코너에서 시작한 줄 서라운딩이 도어보다 20 앞으로 나왔다
      g.userData.depth = it.tag === 'ep' ? undefined : it.key.startsWith('wallCorner') ? 320 : b.frame.max.z - b.frame.min.z;
    }
    // 후드 — 고른 카탈로그 빌트인 후드 폭(후드장 폭 안으로)
    if (it.key === 'hood') g.add(hoodUnit(Math.min(it.w, applianceOf('hood', d.appliance?.hood)?.size?.[0] ?? it.w), y, b.frame.max.z - b.frame.min.z || 340, it.w));
    g.userData.gaps = b.gaps.map(([a, c]) => [a + y, c + y]);
    doors.push(...b.doors);
    // 도어 변수가 없는 장(KB 망장 · 리프트업장) — 원본 기본 도어(단종 재질)가 남는다 → 아래에서 고른 도어 재질로 덮는다
    if (!m.doorVar && it.tag !== 'ep' && b.doors.length) noVarDoors.push(...b.doors);
    // 도어 재질 — 휠라 · 식세장은 앞판이 도어와 달라 잡지 않는다. 도어 변수가 없는 장은 고른 도어가 아니라 잡지 않는다
    if (b.frontMat && !doorMat && m.doorVar && it.level !== 'shelf' && it.tag !== 'ep' && it.tag !== 'dish' && !/fill/.test(it.key)) doorMat = b.frontMat;
    group.add(g);
    out.push({ item: it, obj: g });
  });
  await Promise.all(jobs);
  const dm = doorMat ?? carcass;
  // 도어 변수가 없는 장의 문짝 — 금속(손잡이 · 찬넬) · 유리는 두고 판만 고른 도어 재질로
  for (const dp of noVarDoors) dp.pivot.traverse((o) => {
    const mm = o as THREE.Mesh; if (!mm.isMesh) return;
    const mt = mm.material as THREE.MeshStandardMaterial;
    if (Array.isArray(mt) || (mt.metalness ?? 0) > 0.3 || mt.transparent) return;
    mm.material = dm;
  });

  // EP · FIX 조각 — 도어와 같은 재질(원본 EP 판넬 패키지는 도어 색과 이름으로만 이어져 있어 앞면 재질을 쓴다)
  for (const { item, obj } of out) {
    if (item.tag === 'ep') obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = dm; });
    // 휠라 앞판 — 원본은 고정 회색 판이라 도어 옆에 덧댄 것처럼 보인다 → 도어 재질로 (찬넬 · 몸통 판은 그대로)
    if (/fill/.test(item.key)) obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).userData?.key === FILL_FACE) m.material = dm; });
    if (item.key === 'fixFill') obj.add(box(item.w, COUNTER_TOP - COUNTER_T - PLINTH - 2, 20, dm, item.w / 2, (PLINTH + COUNTER_TOP - COUNTER_T - 2) / 2, 10));
  }

  // 코너 팬트리장 — ㄱ자라 줄 걸레받이 · 서라운딩 대신 안쪽 두 면(앞 날개 0~430 · 옆 날개 깊이 590~1000)을 따라 따로
  for (const { item, obj } of out) if (item.key === 'pantryCorner') {
    const IN = 430, FZ = 590, rec = 70;
    obj.add(box(IN + rec, PLINTH, SKIRT_T, carcass, (IN + rec) / 2, PLINTH / 2, FZ - rec + SKIRT_T / 2));
    obj.add(box(SKIRT_T, PLINTH, 1000 - (FZ - rec), carcass, IN + rec + SKIRT_T / 2, PLINTH / 2, (FZ - rec + 1000) / 2));
    const top = obj.userData.top as number, gap = d.room.h - top;
    if (gap > 5) {
      obj.add(box(IN + 6, gap, SKIRT_T, dm, (IN + 6) / 2, top + gap / 2, FZ + 6 + SKIRT_T / 2, true));
      obj.add(box(SKIRT_T, gap, 1000 - FZ, dm, IN + 6 + SKIRT_T / 2, top + gap / 2, FZ + (1000 - FZ) / 2, true));
    }
  }
  // 식기세척기 — 원본은 기기 자리만 비워 둔다(기기 메시 없음) → 도어 재질 전면 패널(빌트인)
  // 원본 앞판(높이 590 · z 571~593)은 빼고 — 그대로 두면 이 패널과 같은 자리에 겹쳐 자글거린다 (찬넬 턱 같은 얇은 것은 둔다)
  for (const { item, obj } of out) if (item.tag === 'dish') {
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!;
      if (bb.max.z > 560 && bb.max.y - bb.min.y > 300) m.visible = false;
    });
    // 앞 패널은 아래 경첩으로 열리게(플랩 아래) — 축 = 패널 아랫선 뒷면
    const hinge = new THREE.Group(); hinge.position.set(0, PLINTH + 2, 593);
    hinge.add(box(item.w - 4, 734, 18, dm, item.w / 2, 367, -9));
    // 문 안쪽 — 스테인리스 내판 · 윗면 조작부(열면 보인다)
    hinge.add(box(item.w - 50, 680, 6, dwSteel, item.w / 2, 350, -21));
    hinge.add(box(item.w - 50, 40, 30, dwDark, item.w / 2, 712, -33));
    obj.add(hinge); doors.push({ pivot: hinge, kind: 'flap', amt: 1, max: THREE.MathUtils.degToRad(85) });
    obj.add(dishInterior(item.w));
  }

  /* ───────── 찬넬 바 — 하부장 도어 윗선(846) ~ 상판 아래(880) 틈에 장 폭만큼 C 찬넬 (표현용 형상) ───────── */
  const chan = new THREE.MeshStandardMaterial({ color: '#c4c8cd', metalness: 0.8, roughness: 0.3 });
  const chanIn = new THREE.MeshStandardMaterial({ color: '#a3a8ae', metalness: 0.75, roughness: 0.38 });
  // 도어 윗선 — 원본 앞판 윗선: 유로 734 · 키친바흐 740 (계열마다 달라 찬넬 턱이 도어 뒤에 숨지 않게)
  const doorTop = PLINTH + (series === 'KB' ? 740 : 734), cBottom = COUNTER_TOP - COUNTER_T;
  // 아일랜드를 장 줄에 붙였으면 붙인 끝 — 찬넬 · 걸레받이를 옆 줄 것까지 늘려 잇는다
  const isl = c.island, attT = isl && isl.attachedEnd != null ? (isl.attachedEnd === 0 ? 0 : isl.len) : null;
  const CH_EXT = 600 - 558, PL_EXT = 600 - (PLINTH_Z + SKIRT_T);   // 옆 줄 장 앞면(600)에서 찬넬 홈 · 걸레받이 면까지
  for (const { item, obj } of out) {
    // 하부장 · 휠라 전부 (EP · FIX 제외)
    if (item.level !== 'base' || item.tag === 'ep' || item.tag === 'fix' || item.w < 5) continue;
    const ch = cBottom - doorTop;
    // 코너장으로 붙였으면 그 코너장 휠라 꺾임판 찬넬(아래)이 벽 장 찬넬 ~ 이 줄 첫 장을 잇는다 — 덧댄 조각은 코너장이 없을 때만
    if (isl && attT != null && !isl.corner && item.frame === isl.frame && (Math.abs(item.t - attT) < 1 || Math.abs(item.t + item.w - attT) < 1)) {
      const x0 = attT === 0 ? -CH_EXT : item.w;
      obj.add(box(CH_EXT, ch, 3, chanIn, x0 + CH_EXT / 2, doorTop + ch / 2, 558));
      obj.add(box(CH_EXT, 5, 38, chan, x0 + CH_EXT / 2, doorTop + 2.5, 575));
      obj.add(box(CH_EXT, 3, 22, chan, x0 + CH_EXT / 2, cBottom - 1.5, 568));
    }
    // 홈 안쪽 면 · 아래 턱(도어 면까지 — 은색 선) · 위 턱
    obj.add(box(item.w, ch, 3, chanIn, item.w / 2, doorTop + ch / 2, 558));
    obj.add(box(item.w, 5, 38, chan, item.w / 2, doorTop + 2.5, 575));
    obj.add(box(item.w, 3, 22, chan, item.w / 2, cBottom - 1.5, 568));
    // 코너장 휠라 꺾임판 — 옆 줄 도어 면에 서는 50 폭 판. 그 위도 찬넬을 옆 줄 방향으로 잇는다(위 찬넬과 같은 단면을 돌려서)
    //   코너장 L 은 틀이 장 자리보다 100 앞(옆 벽 쪽)에서 시작 → 옆 줄 도어 면 x = 600 − 100 · R 은 틀 끝(w + 100)이 옆 벽
    if (item.key === 'cornerL' || item.key === 'cornerR') {
      const sx = item.key === 'cornerL' ? 1 : -1, x0 = item.key === 'cornerL' ? -100 : item.w + 100;
      const X = (d: number) => x0 + sx * d, z0 = 558, z1 = CORNER_D, zl = z1 - z0, zc = (z0 + z1) / 2;
      obj.add(box(3, ch, zl, chanIn, X(558), doorTop + ch / 2, zc));
      obj.add(box(38, 5, zl, chan, X(575), doorTop + 2.5, zc));
      obj.add(box(22, 3, zl, chan, X(568), cBottom - 1.5, zc));
    }
    // 서랍장 가운데 틈 — 원본은 안쪽 18 각 찬넬만 있어 빈 홈처럼 보였다 → 위 찬넬과 같은 모양(안쪽 면 · 아래 턱 · 위 턱)
    for (const [g0, g1] of (obj.userData.gaps as [number, number][] | undefined) ?? []) {
      const gh = g1 - g0;
      obj.add(box(item.w, gh, 3, chanIn, item.w / 2, g0 + gh / 2, 558));
      obj.add(box(item.w, 5, 38, chan, item.w / 2, g0 + 2.5, 575));
      obj.add(box(item.w, 3, 22, chan, item.w / 2, g1 - 1.5, 568));
    }
  }

  /* ───────── 걸레받이 · 서라운딩 — 줄을 따라 이어서. 끊긴 끝은 측면까지(벽 · EP · 키큰장 쪽은 생략) ───────── */
  const skipStart = new Set<WallId>(), skipEnd = new Set<WallId>();
  for (const s of c.skips ?? []) (s.end ? skipEnd : skipStart).add(s.wall);
  const byFrame = new Map<Frame, { item: Item; obj: THREE.Object3D }[]>();
  for (const e of out) { if (!byFrame.has(e.item.frame)) byFrame.set(e.item.frame, []); byFrame.get(e.item.frame)!.push(e); }
  for (const [f, list] of byFrame) {
    const wall = wallOf.get(f);
    const L = wall != null ? wallLength(d.room, wall) : Infinity;
    const eps = list.filter((e) => e.item.tag === 'ep').map((e) => e.item);
    const g = tag(frameGroup(f), f);
    if (wall == null) g.userData.island = true;
    // 연속 구간 묶기
    const runsOf = (pick: (e: { item: Item; obj: THREE.Object3D }) => boolean, sameTop = false) => {
      const xs = list.filter(pick).sort((a, b) => a.item.t - b.item.t);
      const res: { t0: number; t1: number; top: number; depth: number }[] = [];
      for (const e of xs) {
        const last = res[res.length - 1];
        const dep = (e.obj.userData.depth as number | undefined) ?? last?.depth ?? (e.item.level === 'wall' ? 320 : 570), top = e.obj.userData.top as number;
        // 윗선이 다르면 끊는다 — 상부장(2250)이 키큰장 EP(예전 2339)와 한 줄로 묶여 서라운딩이 장 위로 89 떠 있었다
        if (last && Math.abs(e.item.t - last.t1) < 2 && Math.abs(dep - last.depth) < 60 && (!sameTop || Math.abs(top - last.top) < 5)) { last.t1 = e.item.t + e.item.w; last.top = Math.max(last.top, top); }
        else res.push({ t0: e.item.t, t1: e.item.t + e.item.w, top, depth: dep });
      }
      return res;
    };
    /** 끝이 막혔나 — 벽 · EP · (키큰장 · 냉장고) */
    const closed = (x: number, side: 0 | 1, also: (it: Item) => boolean) =>
      (wall != null && ((x <= 1 && (prevWall(wall) !== d.openWall || d.wing.b >= 300)) || (x >= L - 1 && (nextWall(wall) !== d.openWall || d.wing.a >= 300))))
      || eps.some((e) => Math.abs((side ? e.t : e.t + e.w) - x) < 2)
      || list.some((e) => also(e.item) && Math.abs((side ? e.item.t : e.item.t + e.item.w) - x) < 2);

    // 걸레받이 — 하부장 · 키큰장 아래 (냉장고 · EP 제외). 섬 뒤 FIX 쪽은 FIX 면에서 들어간 자리
    const isFix = list.some((e) => e.item.tag === 'fix');
    // 로봇청소기장은 걸레받이를 비운다 — 줄이 거기서 끊기고 양쪽에 측면 걸레받이가 생겨 대기 공간 옆을 막는다
    for (const r of runsOf((e) => (e.item.level === 'base' || e.item.level === 'tall') && e.item.tag !== 'ep' && e.item.key !== 'fridge' && e.item.key !== 'islandOpen' && e.item.key !== 'pantryCorner' && !e.item.robot)) {
      let a = r.t0, b = r.t1;
      const zf = isFix ? -50 : PLINTH_Z;
      // 벽 코너에서 비워 둔 쪽 — 옆 줄 걸레받이까지 늘려 맞물림
      // 코너 비운 자리 — 코너장이면 650(휠라 꺾임판까지), 일반장으로 채운 사각이면 600
      const sk = (x: number) => Math.abs(x - BASE_D) < 2 || Math.abs(x - CORNER_D) < 2;
      const aSkip = wall != null && skipStart.has(wall) && sk(a), bSkip = wall != null && skipEnd.has(wall) && sk(L - b);
      if (aSkip) a = PLINTH_Z; if (bSkip) b = L - PLINTH_Z;
      // 붙인 아일랜드 — 붙인 끝을 옆 줄 걸레받이 면까지 (앞 줄은 t 0/len, 뒤 줄은 거꾸로 len/0)
      if (isl && attT != null && wall == null) {
        const tt = f === isl.frame ? attT : isl.len - attT;
        // 장 끝이 붙인 끝 근처(코너장 휠라 자리 50 비움 포함)면 벽 장 걸레받이 면까지 — 꺾임판 아래도 이어진다
        if (Math.abs(a - tt) < 80) a = tt - PL_EXT;
        if (Math.abs(b - tt) < 80) b = tt + PL_EXT;
      }
      g.add(box(b - a, PLINTH, SKIRT_T, carcass, (a + b) / 2, PLINTH / 2, zf + SKIRT_T / 2));
      const ret = (x: number, sgn: 1 | -1) => {
        const z0 = isFix ? zf : 0, z1 = isFix ? 0 : zf + SKIRT_T;
        g.add(box(SKIRT_T, PLINTH, Math.abs(z1 - z0), carcass, x + sgn * SKIRT_T / 2, PLINTH / 2, (z0 + z1) / 2));
      };
      const tallish = (it: Item) => it.level === 'tall';
      // 아일랜드(벽 없는 줄)는 끝이 EP 이거나 붙인 장이라 측면 걸레받이를 두지 않는다 — 뒤 FIX 줄은 EP 를 몰라 EP 자리에 측면이 생겼었다
      if (wall == null) continue;
      if (!aSkip && !closed(a, 0, tallish)) ret(a, 1);
      if (!bSkip && !closed(b, 1, tallish)) ret(b, -1);
    }

    // 서라운딩 — 상부장 · 키큰장 · 냉장고 윗장 위 천장까지 (앞판 + 끊긴 끝 측면)
    // EP 는 천장까지라 서라운딩에서 뺀다(끝 막힘 판정에만 쓴다)
    for (const r of runsOf((e) => e.item.tag !== 'ep' && !e.obj.userData.chimney && (e.item.level === 'wall' || (e.item.level === 'tall' && e.item.key !== 'fridge' && e.item.key !== 'pantryCorner')), true)) {
      const gap = d.room.h - r.top;
      if (gap < 5) continue;
      let a = r.t0, b = r.t1;
      const zf = r.depth + 6;
      const aSkip = wall != null && skipStart.has(wall) && r.depth < 400 && Math.abs(a - 340) < 2, bSkip = wall != null && skipEnd.has(wall) && r.depth < 400 && Math.abs(b - (L - 340)) < 2;
      if (aSkip) a = 340; if (bSkip) b = L - 340;
      // 상부 서라운딩 — 긴 띠라 결은 가로(사용자)
      g.add(box(b - a, gap, SKIRT_T, dm, (a + b) / 2, r.top + gap / 2, zf + SKIRT_T / 2, true));
      const deeper = (it: Item) => it.level === 'tall' || it.key === 'fridgeTop';
      const ret = (x: number, sgn: 1 | -1) => g.add(box(SKIRT_T, gap, zf + SKIRT_T, dm, x + sgn * SKIRT_T / 2, r.top + gap / 2, (zf + SKIRT_T) / 2, true));
      if (!aSkip && !closed(a, 0, deeper)) ret(a, 1);
      if (!bSkip && !closed(b, 1, deeper)) ret(b, -1);
    }
    group.add(g);
  }

  // 상판
  const cm = cat.counters.find((x) => x.id === d.counter) ?? cat.counters[0];
  const counterMat = new THREE.MeshStandardMaterial({ map: texture(texUrl(cm.id)), roughness: cm.name.includes('스테인') ? 0.3 : 0.32, metalness: cm.name.includes('스테인') ? 0.8 : 0 });
  for (const ct of c.counters) {
    const g = tag(frameGroup(ct.frame), ct.frame);
    // 판 모양(t, z) — 싱크볼 자리는 구멍
    const shape = new THREE.Shape();
    shape.moveTo(ct.t0, ct.z0); shape.lineTo(ct.t1, ct.z0); shape.lineTo(ct.t1, ct.z1); shape.lineTo(ct.t0, ct.z1); shape.closePath();
    for (const sk of c.items) {
      if (sk.tag !== 'sink' || sk.frame !== ct.frame) continue;
      const cx = sk.t + sk.w / 2;
      if (cx - SINK_HOLE[0] / 2 < ct.t0 || cx + SINK_HOLE[0] / 2 > ct.t1) continue;
      const h = new THREE.Path();
      h.moveTo(cx - SINK_HOLE[0] / 2, SINK_Z - SINK_HOLE[1] / 2); h.lineTo(cx - SINK_HOLE[0] / 2, SINK_Z + SINK_HOLE[1] / 2);
      h.lineTo(cx + SINK_HOLE[0] / 2, SINK_Z + SINK_HOLE[1] / 2); h.lineTo(cx + SINK_HOLE[0] / 2, SINK_Z - SINK_HOLE[1] / 2); h.closePath();
      shape.holes.push(h);
    }
    const geo = new THREE.ExtrudeGeometry(shape, { depth: COUNTER_T, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);                // 판 (t, z) → 수평, 두께는 아래로
    geo.translate(0, COUNTER_TOP, 0);
    geo.computeVertexNormals();
    worldUV(geo, cm.size);
    const mesh = new THREE.Mesh(geo, counterMat); mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    if (ct.island) g.userData.island = true;
    if (ct.island && ct.z0 <= -220 && ct.z0 > -500) {
      // 의자 자리 — 바 스툴
      const seat = new THREE.MeshStandardMaterial({ color: '#2b2b2d', roughness: 0.5 });
      const leg = new THREE.MeshStandardMaterial({ color: '#b5b8bc', metalness: 0.8, roughness: 0.3 });
      const len = ct.t1 - ct.t0, n = Math.max(1, Math.floor(len / 600));
      for (let i = 0; i < n; i++) {
        const x = ct.t0 + (i + 0.5) * len / n, z = ct.z0 - 160;
        const top = new THREE.Mesh(new THREE.CylinderGeometry(190, 180, 50, 28), seat); top.position.set(x, 650, z);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 620, 12), leg); post.position.set(x, 320, z);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(200, 210, 14, 28), leg); base.position.set(x, 7, z);
        const ringM = new THREE.Mesh(new THREE.TorusGeometry(150, 9, 8, 32), leg); ringM.rotation.x = Math.PI / 2; ringM.position.set(x, 260, z);
        for (const o of [top, post, base, ringM]) { o.castShadow = o.receiveShadow = true; g.add(o); }
      }
    }
    group.add(g);
  }

  // 아일랜드 형태 — 통판 마감(양끝 상판 재질 판, EP 자리) · 연계형 식탁 · 원형 식탁(붙지 않은 끝, 식탁 높이 750)
  const ict = isl && c.counters.find((x) => x.island && x.frame === isl.frame);
  if (isl && ict && (isl.style === 'waterfall' || isl.style === 'table' || isl.style === 'round')) {
    const g = tag(frameGroup(isl.frame), isl.frame);
    g.userData.island = true;
    const z0 = ict.z0, z1 = ict.z1, zc = (z0 + z1) / 2, dz = z1 - z0, H = COUNTER_TOP - COUNTER_T;
    if (isl.style === 'waterfall') {
      for (const e of [0, 1] as const) if (e !== isl.attachedEnd) g.add(box(20, H, dz, counterMat, e === 0 ? 10 : isl.len - 10, H / 2, zc));
    } else {
      const wood = new THREE.MeshStandardMaterial({ color: '#a87c52', roughness: 0.6 });
      const metal = new THREE.MeshStandardMaterial({ color: '#2b2b2d', roughness: 0.4, metalness: 0.5 });
      const e = isl.attachedEnd === 1 ? 0 : 1, sx = e === 1 ? 1 : -1, x0 = e === 1 ? isl.len : 0;
      const T = 30, top = ISLAND_TABLE.h;
      if (isl.style === 'table') {
        const L = ISLAND_TABLE.len, W = ISLAND_TABLE.w, xm = x0 + sx * L / 2;
        g.add(box(L, T, W, wood, xm, top - T / 2, zc));
        // 다리 — 먼 끝 두 개(가까운 끝은 아일랜드 옆판에 고정)
        for (const zz of [zc - W / 2 + 60, zc + W / 2 - 60]) g.add(box(60, top - T, 60, metal, x0 + sx * (L - 60), (top - T) / 2, zz));
      } else {
        const R = ISLAND_TABLE.round / 2, xm = x0 + sx * (R - ISLAND_TABLE.overlap);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, T, 56), wood); disc.position.set(xm, top - T / 2, zc);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, top - T, 20), metal); post.position.set(xm, (top - T) / 2, zc);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(260, 280, 16, 40), metal); foot.position.set(xm, 8, zc);
        for (const o of [disc, post, foot]) { o.castShadow = o.receiveShadow = true; g.add(o); }
      }
    }
    group.add(g);
  }

  // 아일랜드 쿡탑 — 천장형 후드(고른 후드가 천장형이 아니면 기본 천장형)
  const ihob = c.items.find((x) => x.tag === 'hob' && x.wall == null);
  if (ihob) {
    const sel = applianceOf('hood', d.appliance?.hood);
    const a = hoodKindOf(sel) === 'ceiling' ? sel : applianceOf('hood', ISLAND_HOOD_DEFAULT);
    const hg = frameGroup(ihob.frame, ihob.t + ihob.w / 2);
    const h = ceilingHood(a, d.room.h); h.position.z = BASE_D / 2; hg.add(h);
    hg.userData.island = true;
    group.add(hg);
  }

  const splash = buildSplashes(c, d, cat);
  group.add(splash);

  // 싱크볼 · 수전 · 쿡탑 = 홈뷰 상품 모델 (원본 장에는 기기 메시가 없다)
  for (const it of c.items) {
    if (it.tag !== 'sink' && it.tag !== 'hob') continue;
    const g = tag(frameGroup(it.frame, it.t), it.frame);
    g.userData.decoOf = it;
    const cx = it.w / 2;
    if (it.tag === 'sink') {
      const [sink, tap] = await Promise.all([propModel('sink_a'), propModel('faucet_a')]);
      // 싱크볼 — 고른 카탈로그 규격(W × D)에 맞춰 모델(818 × 450)을 늘이고 줄인다
      const ss = applianceOf('sink', d.appliance?.sink)?.size;
      sink.scale.set(1000 * ((ss?.[0] ?? 818) / 818), 1000, 1000 * ((ss?.[1] ?? 450) / 450)); sink.position.set(cx, COUNTER_TOP, SINK_Z);
      // 싱크볼 재질 — 원본은 밝은 거울 같은 금속이라 하얗게 번쩍였다(사용자 「너무 밝아 · 반사를 알루미늄처럼」). 색을 낮추고 거칠기를 올려 무광 알루미늄처럼
      sink.traverse((o) => {
        const m = o as THREE.Mesh; if (!m.isMesh) return;
        m.material = ([m.material].flat() as THREE.MeshStandardMaterial[]).map((mt) => {
          if (!mt.isMeshStandardMaterial || (mt.metalness ?? 0) < 0.3) return mt;
          const c = mt.clone(); c.color.set('#8f9396'); c.metalness = 0.7; c.roughness = 0.42; c.envMapIntensity = 0.6;
          return c;
        }) as unknown as THREE.Material;
        if (Array.isArray(m.material) && (m.material as THREE.Material[]).length === 1) m.material = (m.material as THREE.Material[])[0];
      });
      tap.scale.setScalar(1000); tap.position.set(cx, COUNTER_TOP, SINK_Z - 225 - 50);
      g.add(sink, tap);
    } else {
      // 쿡탑 기기 — 상판 위에서 따로 돌린다(d.hobRot). 고르기 · 끌기 · 돌리기용 표시 hobTop
      const top = new THREE.Group();
      top.position.set(cx, COUNTER_TOP, 300); top.rotation.y = ((d.hobRot ?? 0) * Math.PI) / 180;
      top.userData.hobTop = true;
      // 인덕션(SCB000273, 626×7×526) — 상판 위에 유리판만 4
      const hob = await propModel('hob_a');
      // 쿡탑 — 고른 카탈로그 규격(W × D)에 맞춰 모델(626 × 526)을 늘이고 줄인다
      const hs = applianceOf('hob', d.appliance?.hob)?.size;
      hob.scale.set(1000 * ((hs?.[0] ?? 626) / 626), 1000, 1000 * ((hs?.[1] ?? 526) / 526)); hob.position.y = -3;
      top.add(hob);
      g.add(top);
      if (it.wall == null) g.userData.island = true;
    }
    group.add(g);
  }
  // 로봇청소기장 — 걸레받이 자리(높이 PLINTH, 장 바닥 아래)에 안쪽 마감 · 바닥 판 · 로봇청소기(Ø350 · 높이 95) · 충전대
  for (const { item, obj } of out) if (item.robot) {
    const dk = new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.7 });
    const robo = new THREE.MeshStandardMaterial({ color: '#e9e9e7', roughness: 0.35 });
    const lid = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.2, metalness: 0.2 });
    obj.add(box(item.w - 4, PLINTH - 4, 12, dk, item.w / 2, (PLINTH - 4) / 2, 60));          // 안쪽 뒤판
    const cx = item.w / 2, cz = 360;
    // 로봇 — 한 묶음(앞 = −z 쪽 범퍼 · 위 뚜껑). 청소 때 이 묶음만 바닥을 돌아다닌다(main runRobot)
    const rb = new THREE.Group(); rb.position.set(cx, 4, cz);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(175, 175, 80, 48), robo); body.position.y = 40;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(120, 120, 6, 40), lid); top.position.set(0, 83, 20);
    const bump = new THREE.Mesh(new THREE.CylinderGeometry(176, 176, 30, 48, 1, false, Math.PI * 0.6, Math.PI * 0.8), lid); bump.position.y = 30;
    for (const o of [body, top, bump]) { o.castShadow = o.receiveShadow = true; rb.add(o); }
    obj.add(rb);
    const dock = box(170, PLINTH - 14, 90, lid, cx, (PLINTH - 14) / 2 + 4, 66 + 45);
    obj.add(dock);
    // 걸레받이 문 — 아래 경첩, 열면 앞으로 눕는다(로봇이 그 위로 드나든다). 축 = 앞면 아랫선
    const flap = new THREE.Group(); flap.position.set(0, 0, PLINTH_Z + SKIRT_T);
    flap.add(box(item.w - 4, PLINTH - 4, SKIRT_T, carcass, item.w / 2, (PLINTH - 4) / 2, -SKIRT_T / 2));
    obj.add(flap);
    obj.userData.robot = { rb, flap, dock: [cx, cz] as [number, number] };
  }
  // 아일랜드 고르기 · 끌기용 표시
  for (const { item, obj } of out) if (item.tag === 'island' || item.tag === 'fix' || (item.wall == null && item.level === 'base')) obj.userData.island = true;
  void COUNTER_D;
  limitDoors(group, doors);
  trimCabinetCache();
  return { group, items: out, ms: performance.now() - t0, doorMat, doors };
}

export { partMaterial };
