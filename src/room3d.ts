// 방 3D — 바닥 · 벽(개구부 구멍) · 천장 · 출입문 · 창 · 벽 너머 공간(팬트리 · 다용도실 · 서브주방)
// three 단위 m. 평면 (x, z) mm → three (x/1000, ·, z/1000).
import * as THREE from 'three';
import { textureOwn } from './cabinet3d';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CEILING_LAMPS } from './scene';
import { OPENING_INFO, livingOf, nextWall, prevWall, wallFrame, wallLength, type Design, type Opening, type WallId, type WallSpace } from './plan';

export const WALL_T = 150;
/** 방 바로 아래 평면들(같은 이름 묶음)을 한 메시로 합친다 — 이음매 없이. size(m) 를 주면 UV = 월드 x · z ÷ 무늬 크기 */
function joinPlanes(group: THREE.Group, name: string, names: string[], size?: number[]) {
  const ms = group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && names.includes(o.name));
  if (!ms.length) return;
  const geos = ms.map((m) => { m.updateMatrix(); return m.geometry.clone().applyMatrix4(m.matrix); });
  const g = geos.length > 1 ? mergeGeometries(geos) ?? geos[0] : geos[0];
  if (size) {
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / size[0], -pos.getZ(i) / size[1]);
  }
  const out = new THREE.Mesh(g, ms[0].material);
  out.name = name; out.castShadow = ms[0].castShadow; out.receiveShadow = true;
  for (const m of ms) { group.remove(m); m.geometry.dispose(); }
  group.add(out);
}
/** 천장 — 양면(어느 쪽에서 오는 빛도 막는다) · 그림자 드리움은 메시에서 */
const ceilMat = () => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.9, side: THREE.DoubleSide, shadowSide: THREE.DoubleSide });
/** 창 · 문 안쪽 몰딩 폭 — 타일이 여기까지 붙는다 */
export const CASING = 50;
/** 벽 구멍 — 개구부보다 HOLE_IN 만큼 작게 뚫는다(안쪽 마감판 두께 12 의 절반). 같은 크기면 벽 잘린 면과 마감판 바깥면이 한 면이라
 *  벽이 틀을 뚫고 비쳤다(사용자 2026-11-05). 바닥에서 시작하는 문 · 통로는 아래를 줄이지 않는다 */
const HOLE_IN = 6;
function holePath(o: { t: number; w: number; sill: number; h: number }): THREE.Path {
  const x0 = o.t + HOLE_IN, x1 = o.t + o.w - HOLE_IN, y0 = o.sill > 0 ? o.sill + HOLE_IN : o.sill, y1 = o.sill + o.h - HOLE_IN;
  const p = new THREE.Path();
  p.moveTo(x0, y0); p.lineTo(x1, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath();
  return p;
}
const S = 0.001;

export interface RoomObj {
  group: THREE.Group;
  /** 벽마다 — 카메라 쪽 벽을 숨길 때 */
  /** keep = 카메라 쪽이어도 숨기지 않음 (거실 ↔ 부엌을 잇는 벽) */
  walls: { wall: WallId; obj: THREE.Object3D; n: THREE.Vector3; p: THREE.Vector3; keep?: boolean }[];
  /** 개구부 고르기용 */
  pick: THREE.Object3D[];
}

/** 벽 프레임 → 그룹 (로컬 X = 벽 진행 방향, Z = 방 안쪽, Y 위, 원점 = 벽 시작 바닥) */
export function wallGroup(d: Design, w: WallId): THREE.Group {
  const f = wallFrame(d.room, w);
  const g = new THREE.Group();
  g.position.set(f.o[0] * S, 0, f.o[1] * S);
  g.rotation.y = Math.atan2(-f.dir[1], f.dir[0]);
  g.scale.setScalar(S);
  return g;
}

function label(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 72;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(255,255,255,0.92)';
  x.beginPath(); x.roundRect(4, 4, 248, 64, 18); x.fill();
  x.strokeStyle = color; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#222'; x.font = 'bold 30px "Pretendard", "Malgun Gothic", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 38);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(400, 113, 1);
  s.renderOrder = 10;
  return s;
}

const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  return m;
};

type Surf = { map: string; size: number[] };
export function buildRoom(d: Design, surf: { floor?: Surf; wallOf?: (space: WallSpace, key: string) => Surf | undefined }, base: string): RoomObj {
  const r = d.room;
  const group = new THREE.Group();
  const walls: RoomObj['walls'] = [];
  const pick: THREE.Object3D[] = [];

  // 바닥
  const fm = new THREE.MeshStandardMaterial({ color: '#cdb89b', roughness: 0.55 });
  // 무늬는 실제 위치(m) 기준 UV 로(joinPlanes) — 부엌 · 거실 바닥이 한 무늬로 이어진다
  if (surf.floor) { const t = textureOwn(base + surf.floor.map); t.repeat.set(1, 1); fm.map = t; fm.color.set('#ffffff'); }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(r.w * S, r.d * S), fm);
  floor.rotation.x = -Math.PI / 2; floor.position.set(r.w * S / 2, 0, r.d * S / 2); floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);
  // 천장 — 양면 + 그림자 드리움(위에서 오는 햇빛이 뚫고 들어오지 않게). 위에서 내려다볼 땐 화면에만 안 보이게(scene frame)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(r.w * S, r.d * S), ceilMat());
  ceil.rotation.x = Math.PI / 2; ceil.position.set(r.w * S / 2, r.h * S, r.d * S / 2);
  ceil.name = 'ceiling'; ceil.castShadow = ceil.receiveShadow = true;
  group.add(ceil);

  const wm = new THREE.MeshStandardMaterial({ color: '#f1eee8', roughness: 0.92 });
  // 벽지 — 벽마다 → 공간별 → 전체. 반복은 벽 길이 · 높이(mm)로
  const wmFor = (L: number, space: WallSpace, key: string, H = r.h) => {
    const sf = surf.wallOf?.(space, key);
    if (!sf) return wm;
    const m = wm.clone(); const t = textureOwn(base + sf.map);
    t.repeat.set(L / 1000 / sf.size[0], H / 1000 / sf.size[1]); m.map = t; m.color.set('#ffffff');
    return m;
  };
  const trim = new THREE.MeshStandardMaterial({ color: '#f7f6f2', roughness: 0.5 });
  // 벽 너머 공간 벽 — 공간 하나(r{id})마다, 판 크기로 반복
  const roomWall = (o: Opening, w: number, h: number) => wmFor(w, 'room', `r${o.id}`, h);
  const skirting = new THREE.MeshStandardMaterial({ color: '#e9e6e0', roughness: 0.5 });

  // 거실 — 트인 쪽 너머 직사각형 공간(T자). 맞은편 벽에 거실 창
  // free — 부엌 ↔ 거실 잇는 벽(날개벽 · 어깨): 양면이 다 보이고 트인 곳 쪽 끝(x0 = start · x1 = end)의 벽 두께 면이 드러난다 → 걸레받이를 뒷면 · 끝면까지 두른다
  const slab = (o: [number, number], dir: [number, number], x0: number, x1: number, id: number, holes: Opening[] = [], mat: THREE.Material = wmFor(x1 - x0, 'living', `l${id}`), free: 'start' | 'end' | null = null) => {
    const g = new THREE.Group();
    g.position.set(o[0] * S, 0, o[1] * S);
    g.rotation.y = Math.atan2(-dir[1], dir[0]);
    g.scale.setScalar(S);
    const shape = new THREE.Shape();
    shape.moveTo(x0, 0); shape.lineTo(x1, 0); shape.lineTo(x1, r.h); shape.lineTo(x0, r.h); shape.closePath();
    for (const h of holes) shape.holes.push(holePath(h));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
    geo.translate(0, 0, -WALL_T);
    // 벽지 UV = 벽 길이 · 높이로 0~1 (반복은 재질 repeat)
    const uvs = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, (uvs.getX(i) - x0) / (x1 - x0), uvs.getY(i) / r.h);
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.wallId = id; mesh.name = `wall-l${id}`;
    g.add(mesh);
    const sk0 = Math.max(0, x0), sk1 = x1;
    if (sk1 - sk0 > 20) g.add(box(sk1 - sk0, 70, 12, skirting, (sk0 + sk1) / 2, 35, 6));
    if (free && sk1 - sk0 > 20) {
      g.add(box(sk1 - sk0, 70, 12, skirting, (sk0 + sk1) / 2, 35, -WALL_T - 6));          // 뒷면
      g.add(box(12, 70, WALL_T + 24, skirting, free === 'start' ? x0 - 6 : x1 + 6, 35, -WALL_T / 2));                 // 벽 두께 끝면 — 양면 걸레받이 끝까지 감싼다
    }
    for (const h of holes) g.add(openingObj(d, h, trim, [], roomWall));
    group.add(g);
    return g;
  };
  if (d.openWall != null) {
    // T자 — 거실은 부엌보다 양옆으로 어깨(d.living a · b)만큼 넓은 직사각형. 거실 벽(두께 WALL_T)이 부엌 트인 벽 자리에 서고 가운데가 뚫림
    // 트인 벽 프레임 기준: t = 벽 따라, u = 부엌 안쪽(+). 벽 두께 = u ∈ [-WALL_T, 0], 거실 안 = u < -WALL_T
    const lvs = livingOf(d);
    const f = wallFrame(r, d.openWall), L = wallLength(r, d.openWall), D = lvs.depth, sa = lvs.a, sb = lvs.b, LW = L + sa + sb, mid = (L + sb - sa) / 2;
    const P = (t: number, u: number): [number, number] => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
    const fd: [number, number] = [f.dir[0], f.dir[1]], fn: [number, number] = [f.n[0], f.n[1]];
    const neg = (v: [number, number]): [number, number] => [-v[0], -v[1]];
    const rot = Math.atan2(-f.dir[1], f.dir[0]);
    // 바닥(문턱 자리까지) · 천장
    const c0 = P(mid, -(D + WALL_T) / 2);
    const lv = new THREE.Mesh(new THREE.PlaneGeometry(LW * S, (D + WALL_T) * S), fm);
    lv.rotation.order = 'YXZ'; lv.rotation.set(-Math.PI / 2, rot, 0);
    lv.position.set(c0[0] * S, 0, c0[1] * S);
    lv.receiveShadow = true; lv.name = 'living-floor';
    group.add(lv);
    // 거실 천장 — 부엌 쪽 벽 두께 자리(트인 곳 위)까지 덮는다. 예전엔 그 150 띠가 비어 천장에 틈이 보였다
    const cl = P(mid, -(WALL_T + D) / 2);
    const lc = new THREE.Mesh(new THREE.PlaneGeometry(LW * S, (D + WALL_T) * S), ceilMat());
    lc.rotation.order = 'YXZ'; lc.rotation.set(Math.PI / 2, rot, 0);
    lc.position.set(cl[0] * S, r.h * S, cl[1] * S); lc.name = 'ceiling'; lc.castShadow = lc.receiveShadow = true;
    group.add(lc);
    const push = (g: THREE.Group, id: number, n: [number, number], c: [number, number], keep = false) => walls.push({ wall: id as WallId, obj: g, n: new THREE.Vector3(n[0], 0, n[1]), p: new THREE.Vector3(c[0] * S, 0, c[1] * S), keep });
    // 맞은편 벽 + 발코니형 거실 창
    const ww = Math.min(LW - 1200, 4200);
    const win: Opening = { id: 'living-window', kind: 'window', wall: d.openWall, t: (LW - ww) / 2, w: ww, h: Math.min(2100, r.h - 150), sill: 100 };
    push(slab(P(-sa, -WALL_T - D), fd, -WALL_T, LW + WALL_T, 10, [win]), 10, fn, P(mid, -WALL_T - D));
    // 옆벽 두 개
    push(slab(P(-sa, -WALL_T), neg(fn), -WALL_T, D + WALL_T, 11), 11, fd, P(-sa, -WALL_T - D / 2));
    push(slab(P(L + sb, -WALL_T - D), fn, -WALL_T, D + WALL_T, 12), 12, neg(fd), P(L + sb, -WALL_T - D / 2));
    // 부엌 쪽 벽 — 양옆(부엌 옆벽 끝과 맞물림) + 날개벽 만큼 안쪽으로. 가운데가 부엌으로 뚫림
    const wa = Math.min(d.wing.a, L / 2), wb = Math.min(d.wing.b, L / 2);
    // 거실 ↔ 부엌 잇는 벽 — 정면(거실)에서 봐도 숨기지 않는다
    // 어깨가 0 이고 날개벽도 0 이면 그쪽 벽 없음
    if (wa + sa > 1) push(slab(P(wa, -WALL_T), neg(fd), 0, wa + sa, 15, [], undefined, 'start'), d.openWall, fn, P((wa - sa) / 2, -WALL_T), true);
    if (wb + sb > 1) push(slab(P(L + sb, -WALL_T), neg(fd), 0, sb + wb, 16, [], undefined, 'end'), d.openWall, fn, P(L + (sb - wb) / 2, -WALL_T), true);
  }

  for (const w of [0, 1, 2, 3] as WallId[]) {
    if (w === d.openWall) continue;
    const L = wallLength(r, w);
    const g = wallGroup(d, w);
    const shape = new THREE.Shape();
    // 모서리를 벽 두께만큼 늘려 바깥 모서리가 맞물리게. 트인 쪽 끝은 거실 어깨 벽이 그 모서리를 채우므로 늘리지 않는다(겹침 방지)
    // — 어깨 · 날개벽이 없으면(0) 모서리가 비므로 그때만 늘림
    const lvs = livingOf(d);
    const shoulderAtStart = prevWall(w) === d.openWall && lvs.b >= WALL_T;   // 이 벽 시작 = 트인 벽 끝(b 쪽) — 어깨가 벽 두께 이상이면 모서리를 덮는다
    const shoulderAtEnd = nextWall(w) === d.openWall && lvs.a >= WALL_T;     // 이 벽 끝 = 트인 벽 시작(a 쪽)
    const xs0 = shoulderAtStart ? 0 : -WALL_T, xs1 = shoulderAtEnd ? L : L + WALL_T;
    shape.moveTo(xs0, 0); shape.lineTo(xs1, 0); shape.lineTo(xs1, r.h); shape.lineTo(xs0, r.h); shape.closePath();
    const ops = d.openings.filter((o) => o.wall === w);
    for (const o of ops) shape.holes.push(holePath(o));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
    geo.translate(0, 0, -WALL_T);
    // 벽지 UV = mm 로 (바깥 면 포함 — 반복은 재질 repeat 대신 직접)
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / L, uv.getY(i) / r.h);
    const mesh = new THREE.Mesh(geo, wmFor(L, 'kitchen', `k${w}`));
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.userData.wallId = w; mesh.name = `wall-k${w}`;
    g.add(mesh);
    // 걸레받이 (문 · 통로 자리 비움)
    let cur = 0;
    const cuts = ops.filter((o) => o.sill < 100).map((o) => [o.t, o.t + o.w]).sort((a, b) => a[0] - b[0]);
    for (const [c0, c1] of [...cuts, [L, L]]) { if (c0 - cur > 20) g.add(box(c0 - cur, 70, 12, skirting, (cur + c0) / 2, 35, 6)); cur = Math.max(cur, c1); }

    for (const o of ops) g.add(openingObj(d, o, trim, pick, roomWall));
    group.add(g);
    const f = wallFrame(r, w);
    walls.push({ wall: w, obj: g, n: new THREE.Vector3(f.n[0], 0, f.n[1]), p: new THREE.Vector3((f.o[0] + f.dir[0] * L / 2) * S, 0, (f.o[1] + f.dir[1] * L / 2) * S) });
  }
  // 부엌 · 거실 바닥 / 천장 — 한 면으로 합친다(공간이 나뉘어도 바닥 · 천장은 이어진다, 사용자 2026-11-05). 바닥 무늬는 실제 위치(m) 기준
  joinPlanes(group, 'floor', ['floor', 'living-floor'], surf.floor?.size);
  joinPlanes(group, 'ceiling', ['ceiling']);
  // 지붕판 — 그림자 전용(화면엔 안 보임, scene 이 숨김 층에 둔다). 천장은 얇은 판이라 벽 윗면과 같은 높이에서 만나는 선으로
  // 그림자 보정(바이어스)만큼 햇빛이 샜다(사용자 「벽 틈새로 빛」). 방 전체(벽 바깥까지)를 두께 200 판으로 덮고, 위면으로 그림자를 잰다
  {
    group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(group), sz = bb.getSize(new THREE.Vector3()), T = 0.2, M = 0.3;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(sz.x + M * 2, T, sz.z + M * 2), new THREE.MeshBasicMaterial({ color: '#000', shadowSide: THREE.FrontSide }));
    roof.position.set((bb.min.x + bb.max.x) / 2, r.h * S + T / 2 + 0.001, (bb.min.z + bb.max.z) / 2);
    roof.name = 'roof-shadow'; roof.castShadow = true; roof.receiveShadow = false;
    group.add(roof);
  }
  return { group, walls, pick };
}

/** 개구부 하나 — 문틀 · 문짝 / 창틀 · 유리 / 벽 너머 공간 */
function openingObj(d: Design, o: Opening, trim: THREE.Material, pick: THREE.Object3D[], roomWall?: (o: Opening, w: number, h: number) => THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.userData.openingId = o.id;
  const info = OPENING_INFO[o.kind];
  const c = o.t + o.w / 2;
  const th = 15;
  // 개구부 안쪽 벽 두께 마감 — 위 · 양옆
  g.add(box(o.w, 12, WALL_T, trim, c, o.sill + o.h - 6, -WALL_T / 2));
  for (const x of [o.t + 6, o.t + o.w - 6]) g.add(box(12, o.h, WALL_T, trim, x, o.sill + o.h / 2, -WALL_T / 2));
  if (o.kind === 'window') {
    // 안쪽 몰딩 — 네 변을 같은 테두리로 감싼다(창대 선반은 뺐다, 사용자 2026-11-05). 두께 TH 는 벽 마감(타일 8 · 벽판넬 6~20)보다 앞으로
    // 나와 벽을 감싸게 — 예전 15 는 벽 마감이 몰딩을 뚫고 보였다
    const TH = 25, y0 = o.sill - CASING, y1 = o.sill + o.h + CASING;
    g.add(box(o.w + CASING * 2, CASING, TH, trim, c, y1 - CASING / 2, TH / 2));
    g.add(box(o.w + CASING * 2, CASING, TH, trim, c, y0 + CASING / 2, TH / 2));
    for (const x of [o.t - CASING / 2, o.t + o.w + CASING / 2]) g.add(box(CASING, y1 - y0, TH, trim, x, (y0 + y1) / 2, TH / 2));
    // 벽 구멍 아래면 마감(창대 대신 — 벽 두께 안쪽만, 방으로 튀어나오지 않는다)
    g.add(box(o.w, 12, WALL_T, trim, c, o.sill + 6, -WALL_T / 2));
    void th;
    // 바깥 틀 + 이중 미닫이 창짝(앞뒤로 엇갈림) — PVC 흰색
    const pvc = new THREE.MeshStandardMaterial({ color: '#eceae6', roughness: 0.42 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe3f0', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.22, ior: 1.5 });
    const fz = -WALL_T + 40, fw = 55, fd = 70;
    g.add(box(o.w, fw, fd, pvc, c, o.sill + fw / 2, fz));
    g.add(box(o.w, fw, fd, pvc, c, o.sill + o.h - fw / 2, fz));
    for (const x of [o.t + fw / 2, o.t + o.w - fw / 2]) g.add(box(fw, o.h, fd, pvc, x, o.sill + o.h / 2, fz));
    const iw = o.w - fw * 2, ih = o.h - fw * 2, sw = iw / 2 + 30, sf = 45;
    for (const [i, dz] of [[0, 14], [1, -14]] as const) {
      const sx = o.t + fw + (i ? iw - sw / 2 : sw / 2);
      const sash = new THREE.Group();
      sash.position.set(sx, o.sill + fw + ih / 2, fz + dz);
      sash.add(box(sw, sf, 24, pvc, 0, ih / 2 - sf / 2, 0), box(sw, sf, 24, pvc, 0, -ih / 2 + sf / 2, 0));
      for (const x of [-sw / 2 + sf / 2, sw / 2 - sf / 2]) sash.add(box(sf, ih, 24, pvc, x, 0, 0));
      const gl = box(sw - sf * 2, ih - sf * 2, 5, glass, 0, 0, 0); gl.castShadow = false; gl.name = 'window-glass'; sash.add(gl);
      sash.add(box(14, 120, 10, new THREE.MeshStandardMaterial({ color: '#c8c8c8', metalness: 0.6, roughness: 0.35 }), i ? -sw / 2 + sf / 2 : sw / 2 - sf / 2, 0, i ? 16 : 16));
      g.add(sash);
    }
  } else {
    // 문 · 통로 몰딩 — 위 · 양옆 (바닥까지)
    const y1 = o.h + CASING;
    g.add(box(o.w + CASING * 2, CASING, th, trim, c, y1 - CASING / 2, th / 2));
    for (const x of [o.t - CASING / 2, o.t + o.w + CASING / 2]) g.add(box(CASING, y1, th, trim, x, y1 / 2, th / 2));
    g.add(box(o.w, 8, WALL_T, trim, c, 4, -WALL_T / 2)); // 문지방
    if (o.kind === 'door') {
      // 문짝 — 바깥쪽으로 70° 열림
      const leaf = new THREE.Group();
      leaf.position.set(o.t, 0, -WALL_T);
      leaf.rotation.y = 1.2; // 바깥쪽(로컬 -Z)으로
      leaf.add(box(o.w - 10, o.h - 10, 40, new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.45 }), o.w / 2, o.h / 2, -20));
      leaf.add(box(20, 20, 140, new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.8, roughness: 0.3 }), o.w - 90, 1000, -20));
      g.add(leaf);
    } else g.add(sideRoom(o, info.color, d.room.h, roomWall));
  }
  if (o.depth) {
    // 벽 너머 공간 이름 — 입구 위
    const lb = label(info.label, info.color);
    lb.position.set(c, Math.min(o.sill + o.h + 200, 2300), -WALL_T - 200);
    g.add(lb);
  }
  // 고르기 · 끌기용 투명 상자 (개구부 자리)
  const hit = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, WALL_T + 80), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.set(c, o.sill + o.h / 2, -WALL_T / 2 + 40);
  hit.userData.openingId = o.id;
  g.add(hit); pick.push(hit);
  return g;
}

/** 벽 너머 작은 공간 — 바닥 · 세 벽 · 내용물 */
/** 벽 너머 공간 입구 문 — 여닫이(안쪽으로 70°) · 미닫이(두 짝, 한 짝 열림) · 폴딩(4짝 지그재그로 반쯤 접힘). 벽 로컬: x = 벽 따라, z- = 공간 쪽 */
function entryDoor(o: Opening): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.45 });
  const metal = new THREE.MeshStandardMaterial({ color: '#888', metalness: 0.8, roughness: 0.3 });
  const h = o.h - 10, type = o.door ?? 'swing';
  if (type === 'swing') {
    const leaf = new THREE.Group();
    leaf.position.set(o.t, 0, -WALL_T); leaf.rotation.y = 1.2;
    leaf.add(box(o.w - 10, h, 40, mat, o.w / 2, h / 2, -20));
    leaf.add(box(20, 20, 140, metal, o.w - 90, 1000, -20));
    g.add(leaf);
  } else if (type === 'sliding') {
    // 레일 + 두 짝 — 오른쪽 짝을 왼쪽 짝 뒤로 밀어 반쯤 열림
    const pw = o.w / 2 + 30;
    g.add(box(o.w + 60, 40, 90, metal, o.t + o.w / 2, o.h + 20, -WALL_T - 45));
    g.add(box(pw, h, 35, mat, o.t + pw / 2, h / 2, -WALL_T - 25));
    g.add(box(pw, h, 35, mat, o.t + pw / 2 + 120, h / 2, -WALL_T - 70));
    for (const x of [o.t + pw - 60, o.t + pw + 60]) g.add(box(20, 300, 25, metal, x, 1000, -WALL_T - 5));
  } else {
    // 폴딩 — 양쪽 문틀에서 두 짝씩 지그재그(60°)로 접힘. 짝의 이음은 경첩
    const pw = o.w / 4, th = 0.8;
    const panel = (ax: number, az: number, bx: number, bz: number) => {
      const p = box(Math.hypot(bx - ax, bz - az), h, 28, mat, 0, h / 2, 0);
      p.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
      p.rotation.y = Math.atan2(-(bz - az), bx - ax);
      g.add(p);
    };
    for (const side of [0, 1] as const) {
      const x0 = side ? o.t + o.w : o.t, sx = side ? -1 : 1, z0 = -WALL_T - 20;
      const x1 = x0 + sx * pw * Math.cos(th), z1 = z0 - pw * Math.sin(th);
      const x2 = x1 + sx * pw * Math.cos(th), z2 = z0;
      panel(x0, z0, x1, z1); panel(x1, z1, x2, z2);
    }
    g.add(box(o.w + 40, 40, 70, metal, o.t + o.w / 2, o.h + 20, -WALL_T - 35));
  }
  return g;
}
function sideRoom(o: Opening, color: string, H = 2400, roomWall?: (o: Opening, w: number, h: number) => THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const D = o.depth ?? 1500, Wd = o.w + 600, x0 = o.t - 300, z0 = -WALL_T;
  const fl = new THREE.MeshStandardMaterial({ color: '#d9d2c6', roughness: 0.8 });
  const wl0 = new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.95 });
  const wlc = new Map<string, THREE.Material>();
  // 벽 판마다 크기에 맞춘 반복 — 기본 페인트면 하나 재질 그대로
  const wlOf = (w: number, h: number) => { if (!roomWall) return wl0; const k = `${Math.round(w)}x${Math.round(h)}`; let m = wlc.get(k); if (!m) wlc.set(k, (m = roomWall(o, w, h))); return m; };
  const fm = box(Wd, 10, D, fl, x0 + Wd / 2, -5, z0 - D / 2); fm.castShadow = false; g.add(fm);
  // 천장 — 공간 바닥과 같은 크기(벽 두께 통로 포함)에 방 천장 높이. 예전엔 천장이 없어 위가 뚫려 보였다
  const cl = new THREE.Mesh(new THREE.PlaneGeometry(Wd + 2 * WALL_T, D + 2 * WALL_T), ceilMat());
  cl.rotation.x = Math.PI / 2; cl.position.set(x0 + Wd / 2, H, z0 + WALL_T - (D + 2 * WALL_T) / 2); cl.name = 'ceiling'; cl.castShadow = cl.receiveShadow = true;
  g.add(cl);
  // 천장 조명 하나 — 지금은 끔(CEILING_LAMPS)
  if (CEILING_LAMPS) { const lamp = new THREE.PointLight('#fff1dc', 1.2, 4, 1.6); lamp.position.set(x0 + Wd / 2, H - 100, z0 - D / 2); g.add(lamp); }
  if (o.kind === 'utility') {
    // 맞은편 벽 — 창 자리(가운데 1200 × 900, 높이 1100~2000)를 비워 쌓음
    const ww = Math.min(1200, Wd - 400), wx = x0 + Wd / 2, zw = z0 - D - WALL_T / 2, full = Wd + 2 * WALL_T;
    const lw = (full - ww) / 2;
    g.add(box(lw, H, WALL_T, wlOf(lw, H), x0 - WALL_T + lw / 2, H / 2, zw), box(lw, H, WALL_T, wlOf(lw, H), x0 + Wd + WALL_T - lw / 2, H / 2, zw));
    g.add(box(ww, 1100, WALL_T, wlOf(ww, 1100), wx, 550, zw), box(ww, H - 2000, WALL_T, wlOf(ww, H - 2000), wx, (2000 + H) / 2, zw));
  } else g.add(box(Wd + 2 * WALL_T, H, WALL_T, wlOf(Wd + 2 * WALL_T, H), x0 + Wd / 2, H / 2, z0 - D - WALL_T / 2));
  g.add(box(WALL_T, H, D, wlOf(D, H), x0 - WALL_T / 2, H / 2, z0 - D / 2));
  g.add(box(WALL_T, H, D, wlOf(D, H), x0 + Wd + WALL_T / 2, H / 2, z0 - D / 2));
  const white = new THREE.MeshStandardMaterial({ color: '#f6f5f2', roughness: 0.6 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  if (o.kind === 'pantry') {
    // ㄷ자 선반
    for (const y of [400, 800, 1200, 1600, 2000]) {
      g.add(box(Wd, 20, 400, white, x0 + Wd / 2, y, z0 - D + 200));
      g.add(box(400, 20, D - 400, white, x0 + 200, y, z0 - (D - 400) / 2));
      g.add(box(400, 20, D - 400, white, x0 + Wd - 200, y, z0 - (D - 400) / 2));
    }
    for (let i = 0; i < 6; i++) g.add(box(140, 180, 140, accent, x0 + 250 + i * 220, 400 + 100, z0 - D + 150));
  } else if (o.kind === 'utility') {
    // 다용도실 — 타일 바닥 · 바깥 창 · 세탁기 위 건조기 · 세탁 싱크장 · 선반 · 폴딩 도어
    fm.material = new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.7 });
    const app = new THREE.MeshStandardMaterial({ color: '#e7e8ea', roughness: 0.35, metalness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: '#2d3136', roughness: 0.2, metalness: 0.3 });
    const zb = z0 - D;
    for (const y of [425, 425 + 860]) {
      g.add(box(650, 850, 650, app, x0 + 400, y, zb + 360));
      const door = new THREE.Mesh(new THREE.CylinderGeometry(200, 200, 12, 40), dark);
      door.rotation.x = Math.PI / 2; door.position.set(x0 + 400, y - 40, zb + 690); g.add(door);
    }
    const sw = Math.max(600, Wd - 950);
    g.add(box(sw, 850, 600, white, x0 + 800 + sw / 2, 425, zb + 310));                 // 세탁 싱크장
    g.add(box(sw, 30, 620, accent, x0 + 800 + sw / 2, 865, zb + 320));
    g.add(box(Math.min(500, sw - 100), 8, 380, new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.8, roughness: 0.25 }), x0 + 800 + sw / 2, 882, zb + 300));
    for (const y of [1500, 1850]) g.add(box(sw, 20, 300, white, x0 + 800 + sw / 2, y, zb + 160));   // 선반
    // 바깥 창 (맞은편 벽)
    const ww = Math.min(1200, Wd - 400), wy = 1100;
    const pvc = new THREE.MeshStandardMaterial({ color: '#eceae6', roughness: 0.42 });
    const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe3f0', roughness: 0.05, transmission: 0.9, transparent: true, opacity: 0.22 });
    const wx = x0 + Wd / 2;
    g.add(box(ww, 50, 60, pvc, wx, wy, zb - 20), box(ww, 50, 60, pvc, wx, wy + 900, zb - 20));
    for (const x of [wx - ww / 2 + 25, wx, wx + ww / 2 - 25]) g.add(box(50, 900, 60, pvc, x, wy + 450, zb - 20));
    const gl = box(ww - 50, 850, 5, glass, wx, wy + 450, zb - 20); gl.castShadow = false; g.add(gl);
    g.add(entryDoor(o));
  } else {
    // 서브주방 — 입구 문 · 하부장 · 상판 · 상부장
    g.add(entryDoor(o));
    g.add(box(Wd, 870, 600, white, x0 + Wd / 2, 435, z0 - D + 300));
    g.add(box(Wd, 30, 620, accent, x0 + Wd / 2, 885, z0 - D + 310));
    g.add(box(Wd, 720, 340, white, x0 + Wd / 2, 1530 + 360, z0 - D + 170));
    g.add(box(500, 10, 400, new THREE.MeshStandardMaterial({ color: '#9aa0a6', metalness: 0.8, roughness: 0.25 }), x0 + Wd / 2, 901, z0 - D + 300));
  }
  return g;
}
