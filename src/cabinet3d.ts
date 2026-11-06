// 장 모듈 3D — 쿠지알러 원본을 계산기(src/kjl)로 계산해 three.js 메시로.
// 원본 좌표(mm): x 오른쪽 · y 뒤(0)→앞(-D) · z 위.  장 로컬(three, mm): X 오른쪽 · Y 위 · Z 앞  →  (x, z, -y)
// 3D 메시 하위 모델(다릿발 · 싱크 선반 등)은 원본 메시가 없어 그리지 않는다 — 다릿발은 걸레받이로 가린다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PmEval } from './kjl/resolve';
import { buildModel, type RenderPart } from './kjl/geometry';
import { ensure, kjlCatalog, modelOf, texUrl, type ModuleDef } from './kjlLib';
import { shared } from './dispose';

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
export function texture(url: string, srgb = true): THREE.Texture {
  let t = texCache.get(url);
  if (!t) {
    t = shared(loader.load(url));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    texCache.set(url, t);
  }
  return t;
}
/** 반복(repeat)을 따로 잡아야 하는 텍스처 — 공유 텍스처를 clone() 하면 이미지가 오기 전 복제본이 「갱신 필요」만 달고 이미지가 비어
 *  WebGPU 렌더러가 멈췄다(image === null 은 처리 못 함 — 느린 서버(GitHub Pages)에서 3D 가 통째로 빈 화면). 그래서 따로 불러온다(브라우저 캐시) */
export function textureOwn(url: string, srgb = true): THREE.Texture {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** 재질 — 원본 재질 id(텍스처) 또는 색. 이름에 유광 · 거울 · 유리가 있으면 그에 맞춘다 */
export function partMaterial(key: string, name = ''): THREE.MeshStandardMaterial {
  let m = matCache.get(key);
  if (m) return m;
  const gloss = /H\/?G|Gloss|유광|하이글로시|Shine|글로시/i.test(name);
  const glass = /유리|글라스|Glass/i.test(name);
  const metal = /스텐|니켈|크롬|알루미늄|AL|찬넬|Chrome|실버|골드/i.test(name);
  if (key.startsWith('#')) m = new THREE.MeshStandardMaterial({ color: key, roughness: 0.7 });
  else m = new THREE.MeshStandardMaterial({ map: texture(texUrl(key)), roughness: gloss ? 0.18 : 0.62, metalness: metal ? 0.6 : 0 });
  if (glass) { m.transparent = true; m.opacity = 0.35; m.roughness = 0.05; }
  m.userData.key = key;
  matCache.set(key, shared(m));
  return m;
}

/** 텍스처 좌표 — 면 방향별 평면 투영(mm / size). 원본 텍스처는 결이 이미지 가로(u)로 나 있다 →
 *  서 있는 면(도어 · EP · 옆판)은 u 를 높이로 돌려 세로결, 눕힌 면(상판 · 선반)은 가로 방향 결.
 *  angle = 원본 textureAngleDegree (판 기준 결 회전, 도) */
export function boxUV(g: THREE.BufferGeometry, size = 1000, angle = 0) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const c = Math.cos((angle * Math.PI) / 180), s = Math.sin((angle * Math.PI) / 180);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u: number, v: number;
    if (nz >= nx && nz >= ny) { u = y; v = x; }        // 앞뒤 면 — 세로결
    else if (nx >= ny) { u = y; v = z; }               // 옆면 — 세로결
    else { u = x; v = z; }                             // 위아래 면
    uv[i * 2] = (u * c - v * s) / size; uv[i * 2 + 1] = (u * s + v * c) / size;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

const K2L = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1); // (x,y,z)원본 → (x, z, -y)

/** 여닫는 문짝 — 경첩 축(pivot)을 원점으로 둔 묶음. 열 때 swing 은 y 축, flap 은 x 축으로 돌리고 drawer 는 앞(z)으로 뺀다 */
export interface DoorPart {
  pivot: THREE.Group;
  kind: 'swing' | 'flap' | 'drawer';
  /** 돌림 부호(swing: 왼쪽 경첩 −1 · 오른쪽 +1, flap: 위 −1 · 아래 +1) 또는 서랍 빼는 거리(mm) */
  amt: number;
  /** 최대로 열 만큼 — 각(라디안) 또는 서랍은 1(= amt 전부). 충돌 검사가 줄인다 */
  max: number;
}

export interface BuiltModule {
  group: THREE.Group;
  /** 원본 외곽 틀 (장 로컬 mm) */
  frame: THREE.Box3;
  /** 앞면 재질 (도어 — 아일랜드 뒤판 · 마감판에 쓴다) */
  frontMat?: THREE.MeshStandardMaterial;
  /** 앞판 사이 틈(장 로컬 y, 틀 아래 기준) — 서랍장 가운데 찬넬 자리. 맨 위 앞판 위(상판 밑 찬넬)는 넣지 않는다 */
  gaps: [number, number][];
  /** 여닫는 문짝 · 서랍 (원본 열림 방향 openDirection: 0 좌 · 1 우 · 2 상 · 3 하, 서랍장 앞판은 4 없음 → 서랍) */
  doors: DoorPart[];
  ms: number;
}

type DoorDef = { kind: DoorPart['kind']; amt: number; pivot: THREE.Vector3; geos: Map<string, THREE.BufferGeometry> };
const geoCache = new Map<string, { geos: Map<string, THREE.BufferGeometry>; doors: DoorDef[]; names: Map<string, string>; frame: THREE.Box3; front?: string; gaps: [number, number][] }>();
/** 「없음」 도어의 도어 형태(DP: 0 하좌 · 1 하우 · 2 하중 · 3 상좌 · 4 상우 · 5 상중 · 11 키큰장상부L · 12 키큰장상부R) → 경첩 쪽.
 *  −10 왼쪽 · −11 오른쪽 · −1 가운데(같은 장 다른 도어를 따름) — 임시 값, buildModule 안에서 0/1 로 바꾼다 */
const dpSide = (dp?: number) => (dp === 0 || dp === 3 || dp === 11 ? -10 : dp === 1 || dp === 4 || dp === 12 ? -11 : -1);
/** 도어 형태(DP)로 경첩 쪽을 정하는 장 — 빌트인 냉장고장(기기 문에 붙는 판). FIX 도어 · 휠라 · 코너 판은 DP 가 있어도 고정 */
const DP_SWING = /^fridgeTall$/;
/** 앞판이 열림 방향 「없음」이어도 서랍으로 빼는 장 */
// 망장(2단 인출 바스켓)도 앞으로 빼는 장 — 서랍으로 연다
const DRAWER_KEYS = /^(drawer\d|islandOpen|basket\d+|tallBasket)$/;

/* 형상 캐시 덜어내기 — 폭 · 변수 조합마다 계산 결과가 쌓인다(방 크기를 끌어 바꾸면 장 폭이 바뀔 때마다 새로).
 * 다시 그릴 때마다 세대를 올리고(cabinetCacheGeneration), 최근 KEEP_GEN 세대 동안 안 쓴 것을 CACHE_MAX 넘으면 놓는다 */
const CACHE_MAX = 240, KEEP_GEN = 3;
let gen = 0;
const usedAt = new Map<string, number>();
/** 부엌을 한 번 새로 그리기 시작할 때 — 이번 그리기에서 쓴 것을 표시하는 세대 */
export function cabinetCacheGeneration() { gen++; }
/** 다 그린 뒤 — 오래 안 쓴 계산 결과의 형상을 놓는다(지금 화면 · 직전 몇 번 그린 장은 남긴다) */
export function trimCabinetCache() {
  if (geoCache.size <= CACHE_MAX) return;
  for (const [key, c] of geoCache) {
    if ((usedAt.get(key) ?? 0) > gen - KEEP_GEN) continue;
    for (const g of c.geos.values()) g.dispose();
    for (const d of c.doors) for (const g of d.geos.values()) g.dispose();
    geoCache.delete(key); usedAt.delete(key);
    if (geoCache.size <= CACHE_MAX * 0.75) break;
  }
}

/** 모듈 하나 — W · 도어 변수를 덮어써 계산 */
export async function buildModule(m: ModuleDef, w: number, door?: { var: string; obs: string }, extra: Record<string, string> = {}): Promise<BuiltModule> {
  const t0 = performance.now();
  const key = `${m.obs}|${w}|${door?.obs ?? ''}|${JSON.stringify(extra)}`;
  usedAt.set(key, gen);
  let c = geoCache.get(key);
  if (!c) {
    await ensure(m.obs);
    if (door) await ensure(door.obs);
    const overrides: Record<string, string> = { ...extra };
    if (m.W && w) overrides.W = String(w);
    if (door && m.doorVar) overrides[m.doorVar] = JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 });
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides });
    // 단면 — 받아 둔 것이 있으면 스윕 · 로프트 부품(액자 도어 테두리 · 찬넬)이 원본 모양으로(없으면 계산기가 18×18 네모로 대신)
    const b = buildModel(ev, { product: kjlCatalog.product, profile: kjlCatalog.profile });
    const isDrawer = DRAWER_KEYS.test(m.key);
    // 묶음 — '' = 고정, 그 외 = 문짝 id
    const buckets = new Map<string, Map<string, THREE.BufferGeometry[]>>();
    const doorInfo = new Map<string, { dir: number; box: THREE.Box3 }>();
    const loose: { mk: string; g: THREE.BufferGeometry }[] = [];
    const add = (bk: string, mk: string, g: THREE.BufferGeometry) => {
      let mm = buckets.get(bk);
      if (!mm) buckets.set(bk, (mm = new Map()));
      if (!mm.has(mk)) mm.set(mk, []);
      mm.get(mk)!.push(g);
    };
    const names = new Map<string, string>();
    let frontY = Infinity, front: string | undefined;
    const faces: { mk: string; y0: number; y1: number; z1: number }[] = [];
    for (const p of b.parts as RenderPart[]) {
      if (p.hidden || p.kind !== 'solid' || !p.geometry) continue;
      // 공도어 표시 — 「레드」 재질 10mm 상자. 도어를 고르기 전 자리 표시용이라 숨긴다(사용자 2026-11-05). 도어 변수가 없는 장(KB 망장 · 리프트업장)은 문 앞에 튀어나와 보였다
      if (p.texture && /^레드/.test(kjlCatalog.product?.(p.texture)?.name ?? '')) continue;
      const g0 = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone();
      g0.applyMatrix4(new THREE.Matrix4().multiplyMatrices(K2L, p.matrix));
      g0.computeVertexNormals();
      g0.deleteAttribute('uv');
      boxUV(g0, 1000, p.texAngle ?? 0);
      for (const a of Object.keys(g0.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g0.deleteAttribute(a);
      const mk = p.texture ?? p.color;
      const prodName = p.texture ? kjlCatalog.product?.(p.texture)?.name ?? '' : '';
      names.set(mk, prodName);
      // 문짝 — 좌 · 우 · 상 · 하 는 여닫이, 서랍장의 「없음」 앞판은 서랍. 「없음」이어도 도어 형태(DP)가 좌 · 우면
      // 그쪽 경첩(빌트인 냉장고장 도어) — 가운데(2 · 5)는 아래에서 같은 장의 좌 · 우 도어를 따르거나 고정(코너 휠라 · 식세 · 오븐 판)
      const dr = p.door && (p.door.dir <= 3 || p.door.dir === 4) ? p.door : undefined;
      if (dr) {
        add(dr.id, mk, g0);
        if (!doorInfo.has(dr.id)) doorInfo.set(dr.id, { dir: dr.dir === 4 && !isDrawer ? (DP_SWING.test(m.key) ? dpSide(dr.info?.DP) : -1) : dr.dir, box: dr.box.clone().applyMatrix4(K2L) });
      } else if (isDrawer && /서랍/.test(prodName)) loose.push({ mk, g: g0 }); // 서랍 몸통 — 높이로 앞판에 붙인다
      else add('', mk, g0);
      // 가장 앞에 있는 텍스처 면 = 도어
      if (p.texture) {
        g0.computeBoundingBox();
        const fz = g0.boundingBox!.max.z;
        const area = (g0.boundingBox!.max.x - g0.boundingBox!.min.x) * (g0.boundingBox!.max.y - g0.boundingBox!.min.y);
        if (area > 40000 && -fz < frontY) { frontY = -fz; front = mk; }
        faces.push({ mk, y0: g0.boundingBox!.min.y, y1: g0.boundingBox!.max.y, z1: fz });
      }
    }
    for (const { mk, g } of loose) {
      g.computeBoundingBox();
      const cy = (g.boundingBox!.min.y + g.boundingBox!.max.y) / 2;
      const hit = [...doorInfo].find(([, d]) => d.dir === 4 && cy >= d.box.min.y - 10 && cy <= d.box.max.y + 10);
      add(hit ? hit[0] : '', mk, g);
    }
    // 가운데(DP 2 · 5) 「없음」 도어 — 같은 장에 좌 · 우 경첩 「없음」 도어가 있으면 그 방향(EO 빌트인 냉장고장 하부), 없으면 고정
    if (!isDrawer) {
      const sided = [...doorInfo.values()].find((d) => d.dir === -10 || d.dir === -11);
      for (const [id, d] of doorInfo) {
        if (d.dir === -1 && sided) d.dir = sided.dir;
        if (d.dir === -10) d.dir = 0; else if (d.dir === -11) d.dir = 1;
        if (d.dir < 0 || d.dir === 4) {
          // 열지 않는 판 — 고정 묶음으로
          for (const [mk, list] of buckets.get(id) ?? []) for (const g of list) add('', mk, g);
          buckets.delete(id); doorInfo.delete(id);
        }
      }
    }
    const frame = b.frame.clone().applyMatrix4(K2L);
    // 앞판(도어 재질 · 앞쪽) 높이 구간을 이어 붙이고 그 사이 틈 15 이상을 찬넬 자리로
    const spans = faces.filter((f) => f.mk === front && f.z1 > frame.max.z - 30).map((f) => [f.y0, f.y1] as [number, number]).sort((p, q) => p[0] - q[0]);
    const gaps: [number, number][] = [];
    let top = -Infinity;
    for (const [y0, y1] of spans) {
      if (top > -Infinity && y0 - top >= 15) gaps.push([top, y0]);
      top = Math.max(top, y1);
    }
    // 서랍 앞판 이음(틈 4)은 그대로 — 3단 서랍장 찬넬은 원본 자리(아래 · 가운데 서랍 사이) 하나뿐(사용자). 예전엔 이음을 넓혀 하나 더 만들었다
    const merge = (mm: Map<string, THREE.BufferGeometry[]>) => {
      const out = new Map<string, THREE.BufferGeometry>();
      for (const [mk, list] of mm) { const g = list.length > 1 ? mergeGeometries(list)! : list[0]; g.computeBoundingBox(); g.computeBoundingSphere(); out.set(mk, g); }
      return out;
    };
    const doors: DoorDef[] = [];
    for (const [id, mm] of buckets) {
      if (!id) continue;
      const { dir, box: bx } = doorInfo.get(id)!;
      // 경첩 축 — 문짝 앞면 모서리(뒷면 모서리로 돌리면 앞 모서리가 이웃 도어 쪽으로 두께만큼 튀어나간다). 서랍은 몸통 깊이의 3/4 만큼 앞으로
      const z = bx.max.z, geos = merge(mm);
      doors.push(dir === 0 ? { kind: 'swing', amt: -1, pivot: new THREE.Vector3(bx.min.x, 0, z), geos }
        : dir === 1 ? { kind: 'swing', amt: 1, pivot: new THREE.Vector3(bx.max.x, 0, z), geos }
        : dir === 2 ? { kind: 'flap', amt: -1, pivot: new THREE.Vector3(0, bx.max.y, z), geos }
        : dir === 3 ? { kind: 'flap', amt: 1, pivot: new THREE.Vector3(0, bx.min.y, z), geos }
        : { kind: 'drawer', amt: Math.round((frame.max.z - frame.min.z) * 0.75), pivot: new THREE.Vector3(), geos });
    }
    c = { geos: merge(buckets.get('') ?? new Map()), doors, names, frame, front, gaps: gaps.map(([a, b]) => [a - frame.min.y, b - frame.min.y] as [number, number]) };
    // 캐시 형상은 여러 번 그린 부엌이 같이 쓴다 — 다 쓴 부엌을 놓을 때(disposeTree) 건너뛰게
    for (const g of c.geos.values()) shared(g);
    for (const d of doors) for (const g of d.geos.values()) shared(g);
    geoCache.set(key, c);
  }
  const cc = c;
  const mesh = (mk: string, g: THREE.BufferGeometry) => { const o = new THREE.Mesh(g, partMaterial(mk, cc.names.get(mk))); o.castShadow = o.receiveShadow = true; return o; };
  const group = new THREE.Group();
  for (const [mk, g] of cc.geos) group.add(mesh(mk, g));
  const doors: DoorPart[] = cc.doors.map((dd) => {
    const pivot = new THREE.Group();
    pivot.position.copy(dd.pivot);
    pivot.userData.door = true;
    for (const [mk, g] of dd.geos) { const o = mesh(mk, g); o.position.copy(dd.pivot).negate(); pivot.add(o); }
    group.add(pivot);
    return { pivot, kind: dd.kind, amt: dd.amt, max: dd.kind === 'swing' ? Math.PI / 2 : dd.kind === 'flap' ? THREE.MathUtils.degToRad(85) : 1 };
  });
  return { group, frame: cc.frame.clone(), gaps: cc.gaps, doors, frontMat: cc.front ? partMaterial(cc.front, cc.names.get(cc.front)) : undefined, ms: performance.now() - t0 };
}
