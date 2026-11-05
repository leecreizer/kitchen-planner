import { readFileSync } from 'node:fs';
import { Box3 } from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades[0];
for (const key of ['cook2', 'wall2', 'cornerL', 'sink', 'bfill50']) {
  const m = cat.modules.find((x) => x.key === key && x.series === 'EO')!;
  await ensure(m.obs); await ensure(g.doors[0].obs);
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: { W: String(m.key === 'cook2' ? 900 : m.W?.value ?? 600), [g.var]: JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 }) } });
  const b = buildModel(ev, { product: kjlCatalog.product });
  console.log('==', key, m.name, 'frame', b.frame.min.toArray().map(Math.round), b.frame.max.toArray().map(Math.round), 'W opts', JSON.stringify(m.W));
  for (const p of b.parts.filter((p) => !p.hidden && p.kind !== 'aux')) {
    const bb = new Box3(); if (p.geometry) { p.geometry.computeBoundingBox(); bb.copy(p.geometry.boundingBox!).applyMatrix4(p.matrix); } else if (p.mesh) bb.setFromCenterAndSize(new (bb.min.constructor as any)(...[0,0,0]), new (bb.min.constructor as any)(...p.mesh.size)).applyMatrix4(p.matrix);
    console.log('  ', p.kind, p.name.slice(0, 18).padEnd(18), p.texture ?? p.color, 'min', bb.min.toArray().map(Math.round), 'max', bb.max.toArray().map(Math.round), p.mesh ? 'MESH ' + JSON.stringify(p.mesh) : '');
  }
}
