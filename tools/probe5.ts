import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
(globalThis as Record<string, unknown>).__kpPlankCenter = process.env.KP_CENTER === '1';
for (const s of ['EO', 'KB'] as const) {
  const g = cat.grades.find((x) => x.series === s)!;
  for (const key of ['drawer3', 'drawer2', 'cook2', 'bfill50', 'bfill75']) {
    const m = cat.modules.find((x) => x.key === key && x.series === s)!;
    await ensure(m.obs); await ensure(g.doors[0].obs);
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: { ...(key.startsWith('bfill') ? {} : { [g.var]: JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 }) }) } });
    const b = buildModel(ev, { product: kjlCatalog.product });
    const fronts: string[] = [];
    for (const p of b.parts) {
      if (p.hidden || p.kind !== 'solid' || !p.geometry) continue;
      p.geometry.computeBoundingBox(); const bb = p.geometry.boundingBox!.clone().applyMatrix4(p.matrix);
      if (bb.min.y < -560) fronts.push(`${p.name.slice(0, 10)} z${Math.round(bb.min.z)}..${Math.round(bb.max.z)} y${Math.round(bb.min.y)}..${Math.round(bb.max.y)} ${p.texture ?? p.color}`);
    }
    console.log(s, key, m.name, 'frame z', Math.round(b.frame.max.z)); fronts.forEach((f) => console.log('   ', f));
  }
}
