// 레드 판(공도어 표시) 크기 — 장 전체 틀과 비교
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const K2L = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const f = (b: THREE.Box3) => ['x', 'y', 'z'].map((k) => `${k}${Math.round((b.min as any)[k])}~${Math.round((b.max as any)[k])}`).join(' ');
for (const ks of (process.argv[2] ?? 'epT:EO,epB:EO,epW:EO,cafeTall:KB,basket200:KB').split(',')) {
  const [key, series] = ks.split(':');
  const m = cat.modules.find((x) => x.key === key && x.series === series)!;
  await ensure(m.obs);
  const b = buildModel(new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: {} }), { product: kjlCatalog.product });
  const all = new THREE.Box3();
  const reds: string[] = [];
  for (const p of b.parts) {
    if (p.hidden || p.kind !== 'solid' || !p.geometry) continue;
    p.geometry.computeBoundingBox();
    const bb = p.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(K2L, p.matrix));
    all.union(bb);
    const nm = p.texture ? kjlCatalog.product(p.texture)?.name ?? '' : p.color;
    if (/^레드/.test(nm)) reds.push(`${p.key} ${f(bb)}`);
  }
  console.log(`## ${key} ${series}  전체 ${f(all)}`); for (const r of reds) console.log('   레드', r);
}
