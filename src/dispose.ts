// 다 쓴 3D 묶음 해제 — 장 · 방을 다시 만들 때 예전 묶음의 GPU 자원과 렌더러 내부 객체(렌더 오브젝트 · 유니폼 버퍼)를 놓는다.
// 예전엔 장면에서 빼기만 해서, 다시 그리기 20번에 형상 74 → 2,877개 · 유니폼 버퍼 402 → 19,312개 · 힙 81 → 151MB 로 늘었다(실측 2026-11-06).
// three 0.186 은 물체마다 dispose() 를 불러야 그 물체용 렌더 오브젝트를 놓는다 — 안 부르면 공유 재질의 정리 리스너가 옛 물체를 계속 붙잡는다.
// 캐시가 여러 번 쓰는 형상 · 재질 · 텍스처는 shared() 로 표시해 두고 건너뛴다
import * as THREE from 'three';

const SHARED = new WeakSet<object>();
/** 캐시에 넣어 여러 번 쓰는 것 — disposeTree 가 건너뛴다 */
export function shared<T extends object>(o: T): T { SHARED.add(o); return o; }
export const isShared = (o: object) => SHARED.has(o);

function texturesOf(m: THREE.Material): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const k in m) { const v = (m as unknown as Record<string, unknown>)[k] as THREE.Texture | undefined; if (v && v.isTexture) out.push(v); }
  return out;
}
/** GLB 등 캐시에 넣는 묶음 — 안의 형상 · 재질 · 텍스처를 모두 공유로 */
export function shareTree<T extends THREE.Object3D>(root: T): T {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) SHARED.add(m.geometry);
    for (const mt of [m.material ?? []].flat() as THREE.Material[]) { SHARED.add(mt); for (const t of texturesOf(mt)) SHARED.add(t); }
  });
  return root;
}
/** 재질 하나 — 공유가 아니면 재질과 (공유 아닌) 텍스처를 놓는다 */
export function disposeMaterial(m: THREE.Material) {
  if (SHARED.has(m)) return;
  for (const t of texturesOf(m)) if (!SHARED.has(t)) t.dispose();
  m.dispose();
}
/** 묶음 통째로 — 물체마다 dispose(렌더러가 그 물체용으로 만든 것) + 공유 아닌 형상 · 재질 · 텍스처 */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !SHARED.has(m.geometry)) m.geometry.dispose();
    for (const mt of [m.material ?? []].flat() as THREE.Material[]) disposeMaterial(mt);
    (o as THREE.Object3D & { dispose?: () => void }).dispose?.();
  });
}
