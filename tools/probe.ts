// 모듈 × 그레이드 계산 시험 — npx vite-node tools/probe.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const g of cat.grades) {
  const door = g.doors[0];
  await ensure(door.obs);
  for (const m of cat.modules.filter((x) => x.series === g.series || x.series === '*')) {
    await ensure(m.obs);
    const t = performance.now();
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {} });
    const errs = ev.diagsAll().filter((d) => d.level === 'error');
    const b = buildModel(ev, { product: kjlCatalog.product });
    const vis = b.parts.filter((p) => !p.hidden && p.kind !== 'aux');
    const s = b.bbox.getSize(b.bbox.min.clone());
    console.log(`${g.label.padEnd(10)} ${m.key.padEnd(12)} ${m.name.slice(0, 22).padEnd(22)} err ${errs.length} parts ${vis.length} tex ${vis.filter((p) => p.texture).length} mesh ${vis.filter((p) => p.kind === 'mesh').length} size ${s.x | 0}x${s.y | 0}x${s.z | 0} ${(performance.now() - t) | 0}ms`);
    errs.slice(0, 2).forEach((d) => console.log('     ', d.where, d.message));
  }
}
