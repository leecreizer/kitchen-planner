import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../../src/kjlLib';
import { PmEval } from '../../src/kjl/resolve';
import { buildModel } from '../../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades.find((x) => x.id === 'e500')!, door = g.doors[0];
await ensure(door.obs);
for (const key of ['bfill50', 'bfill75', 'wfill50']) {
  const m = cat.modules.find((x) => x.key === key && (x.series === g.series || x.series === '*'))!;
  await ensure(m.obs);
  for (const ov of [{ W: '30' }, {}, { STD_YN: 'true', NSTD_W: '130' }]) {
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: { ...(m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {}), ...ov } });
    const b = buildModel(ev, { product: kjlCatalog.product });
    const vis = b.parts.filter((p) => !p.hidden && p.kind !== 'aux');
    console.log(key, m.name, JSON.stringify(ov), 'W', m.W && JSON.stringify(m.W), 'nstd', m.nstd, m.wmin, m.wmax);
    for (const p of vis) {
      const g2 = (p as unknown as { geometry?: import('three').BufferGeometry }).geometry; let box = '';
      if (g2) { g2.computeBoundingBox(); const q = g2.boundingBox!.clone(); const mt = (p as unknown as { matrix?: import('three').Matrix4 }).matrix; if (mt) q.applyMatrix4(mt); box = `${q.min.toArray().map(Math.round)} ~ ${q.max.toArray().map(Math.round)} tris ${(g2.index ? g2.index.count : g2.getAttribute('position').count) / 3}`; }
      console.log('   ', (p as unknown as { name?: string }).name, p.kind, box, 'mat', JSON.stringify((p as unknown as {material?: unknown; matKey?: unknown; texture?: unknown; color?: unknown}).texture ?? (p as unknown as {color?: unknown}).color ?? ''), Object.keys(p).join(','));
    }
  }
}
