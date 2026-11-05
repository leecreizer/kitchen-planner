import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const series of ['EO', 'KB']) {
  const m = cat.modules.find((x) => x.key === 'fix' && x.series === series)!;
  await ensure(m.obs);
  const size = (ov: Record<string, string>) => { const b = buildModel(new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov }), { product: kjlCatalog.product }); const bb = new THREE.Box3(); for (const p of b.parts) if (!p.hidden && p.kind === 'solid' && p.geometry) { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox!.clone().applyMatrix4(p.matrix)); } const s = bb.getSize(new THREE.Vector3()); return [s.x, s.y, s.z].map(Math.round).join('x'); };
  console.log(series, 'std 600', size({ W: '600' }), '| std H802', size({ W: '600', H: '802' }));
  for (const h of ['768', '802', '910', '948']) console.log('  nstd 580 NSTD_H', h, size({ W: '580', STD_YN: 'true', NSTD_W: '580', NSTD_H: h }), '| +H', size({ W: '580', H: h, STD_YN: 'true', NSTD_W: '580', NSTD_H: h }));
}
