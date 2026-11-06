import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../../src/kjlLib';
import { PmEval } from '../../src/kjl/resolve';
import { buildModel } from '../../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const m of cat.modules.filter((x) => x.series === 'EO' && /^(tall|fridgeTall|fridgeTop|sink|cook1|epT|epTx|epB)$/.test(x.key))) {
  await ensure(m.obs);
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: /^ep[TW]/.test(m.key) ? { STD_YN: 'true', NSTD_H: '2400' } : {} });
  const b = buildModel(ev, { product: kjlCatalog.product });
  const bb = new THREE.Box3().setFromObject(b.group);
  console.log(m.key, 'frame z(depth)', (b.frame.max.z - b.frame.min.z) | 0, 'mesh', bb.min.z | 0, bb.max.z | 0, 'frame', b.frame.min.z | 0, b.frame.max.z | 0);
}
