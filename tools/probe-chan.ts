// 서랍장 앞판 · 찬넬 자리 — npx vite-node tools/probe-chan.ts
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const K2L = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
for (const series of ['EO', 'KB'] as const) {
  const g = cat.grades.find((x) => x.series === series)!;
  for (const key of (process.argv[2] ?? 'drawer3,drawer2,cook1').split(',')) {
    const m = cat.modules.find((x) => x.key === key && x.series === series); if (!m) continue;
    await ensure(m.obs); await ensure(g.doors[0].obs);
    const ov: Record<string, string> = {}; if (m.doorVar) ov[m.doorVar] = JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 });
    const b = buildModel(new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov }), { product: kjlCatalog.product });
    console.log(`## ${series} ${key}`);
    for (const p of b.parts) {
      if (p.hidden || p.kind !== 'solid') continue;
      const bb = p.geometry!.boundingBox ?? (p.geometry!.computeBoundingBox(), p.geometry!.boundingBox!);
      const w = bb.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(K2L, p.matrix));
      if (w.max.z < 520) continue; // 앞쪽만
      const nm = (p.texture ? kjlCatalog.product(p.texture)?.name : p.color) ?? '';
      console.log(' ', p.name.slice(0, 12).padEnd(12), nm.slice(0, 18).padEnd(18), 'x', w.min.x | 0, w.max.x | 0, 'y', w.min.y | 0, w.max.y | 0, 'z', w.min.z | 0, w.max.z | 0);
    }
  }
}
