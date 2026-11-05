import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
import { Box3, Vector3 } from 'three';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades.find((x) => x.id === 'e500')!, door = g.doors[0];
await ensure(door.obs);
for (const key of ['cornerL', 'cornerR', 'drawer3']) {
  const m = cat.modules.find((x) => x.key === key && x.series === g.series)!;
  await ensure(m.obs);
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {} });
  const b = buildModel(ev, { product: kjlCatalog.product });
  console.log('\n##', key, m.name, 'bbox', b.bbox.min.toArray().map(Math.round), b.bbox.max.toArray().map(Math.round));
  for (const p of b.parts.filter((p) => !p.hidden && p.kind !== 'aux')) {
    const bb = new Box3();
    try { bb.copy((p as unknown as { box?: Box3 }).box ?? new Box3()); } catch { /* */ }
    const nm = (p as unknown as { name?: string; path?: string }).name ?? (p as unknown as { path?: string }).path ?? '';
    const g2 = (p as unknown as { geometry?: { boundingBox?: Box3; computeBoundingBox?: () => void } }).geometry;
    let box = '';
    if (g2?.computeBoundingBox) { g2.computeBoundingBox(); const q = g2.boundingBox!.clone(); const mt = (p as unknown as { matrix?: import('three').Matrix4 }).matrix; if (mt) q.applyMatrix4(mt); box = `${q.min.toArray().map(Math.round)} ~ ${q.max.toArray().map(Math.round)}`; }
    console.log('  ', String(nm).slice(-40).padEnd(40), p.kind, box);
  }
  void Vector3;
}
for (const key of ['cornerL', 'cornerR']) {
  const m = cat.modules.find((x) => x.key === key && x.series === g.series)!;
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {} });
  const b = buildModel(ev, { product: kjlCatalog.product }) as unknown as { frame: Box3 };
  console.log('FRAME', key, b.frame.min.toArray().map(Math.round), b.frame.max.toArray().map(Math.round));
}
