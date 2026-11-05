import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades.find((x) => x.id === 'e500')!;
for (const flag of ['', '__kpNoSkip', '__kpNoMat']) for (const door of g.doors.filter((x) => /Classic|Scandi Stone/.test(x.name))) {
  (globalThis as Record<string, unknown>).__kpNoSkip = flag === '__kpNoSkip'; (globalThis as Record<string, unknown>).__kpNoMat = flag === '__kpNoMat';
  const row: string[] = [];
  for (const key of ['cook2', 'drawer3']) {
    const m = cat.modules.find((x) => x.key === key && x.series === g.series)!;
    await ensure(m.obs); await ensure(door.obs);
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [g.var]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {} });
    const b = buildModel(ev, { product: kjlCatalog.product });
    let lo = Infinity, hi = -Infinity;
    for (const p of b.parts) {
      if (p.hidden || p.kind !== 'solid' || !p.geometry) continue;
      p.geometry.computeBoundingBox(); const bb = p.geometry.boundingBox!.clone().applyMatrix4(p.matrix);
      if (bb.min.y < -570 && bb.max.z - bb.min.z > 100) { lo = Math.min(lo, bb.min.z); hi = Math.max(hi, bb.max.z); }
    }
    row.push(`${key} ${Math.round(lo)}~${Math.round(hi)}`);
  }
  console.log(flag.padEnd(11), g.label.padEnd(10), door.name.slice(0, 26).padEnd(26), row.join(' | '));
}
