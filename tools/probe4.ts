import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const s of ['EO', 'KB'] as const) for (const [key, ov] of [['fridgeTop', { STD_YN: 'true', NSTD_W: '1200' }], ['fridgeTop', {}], ['epT', {}], ['epTx', {}], ['epB', {}], ['epW', {}], ['fix', { W: '600' }]] as const) {
  const m = cat.modules.find((x) => x.key === key && x.series === s)!;
  await ensure(m.obs);
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov as Record<string, string> });
  const b = buildModel(ev, { product: kjlCatalog.product });
  const errs = ev.diagsAll().filter((d) => d.level === 'error');
  const vis = b.parts.filter((p) => !p.hidden && p.kind === 'solid');
  console.log(s, key, JSON.stringify(ov), 'frame', b.frame.min.toArray().map(Math.round), b.frame.max.toArray().map(Math.round), 'bbox', b.bbox.min.toArray().map(Math.round), b.bbox.max.toArray().map(Math.round), 'solids', vis.length, 'err', errs.length, errs[0]?.message ?? '');
}
