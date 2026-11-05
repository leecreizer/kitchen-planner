// 결 각도 — npx vite-node tools/probe-grain.ts
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades.find((x) => x.id === 'e500')!;
const door = g.doors.find((x) => /Hazelnut/.test(x.name))!;
for (const key of ['cook1', 'tall', 'epT', 'wall1']) {
  const m = cat.modules.find((x) => x.key === key && x.series === g.series); if (!m) { console.log('no', key); continue; }
  await ensure(m.obs); await ensure(door.obs);
  const ov: Record<string, string> = /^ep/.test(key) ? { STD_YN: 'true', NSTD_H: '2400' } : {};
  if (m.doorVar) ov[m.doorVar] = JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 });
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov });
  const b = buildModel(ev, { product: kjlCatalog.product });
  for (const p of b.parts) {
    if (p.hidden || p.kind !== 'solid' || !p.texture) continue;
    p.geometry!.computeBoundingBox(); const s = p.geometry!.boundingBox!.getSize(new THREE.Vector3());
    const e = p.matrix.elements;
    console.log(key, p.name.slice(0, 18).padEnd(18), kjlCatalog.product(p.texture)?.name?.slice(0, 22).padEnd(22), 'ang', (p as any).texAngle, 'local', s.x | 0, s.y | 0, s.z | 0, 'X->', [e[0], e[1], e[2]].map((v) => Math.round(v)).join(','), 'Y->', [e[4], e[5], e[6]].map((v) => Math.round(v)).join(','));
  }
}
