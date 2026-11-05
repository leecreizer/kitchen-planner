// 상부장 비규격 높이 — npx vite-node tools/probe-wallh.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const m of cat.modules.filter((x) => /^(wall1|wall2)$/.test(x.key))) {
  await ensure(m.obs);
  for (const ov of [{}, { STD_YN: 'true', NSTD_H: '400' }, { STD_YN: 'true', NSTD_W: '800', NSTD_H: '360' }]) {
    const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov });
    const b = buildModel(ev, { product: kjlCatalog.product });
    const s = b.frame.getSize(b.frame.min.clone());
    console.log(m.series, m.key, JSON.stringify(ov), 'frame', s.x | 0, s.y | 0, s.z | 0, 'err', ev.diagsAll().filter((d) => d.level === 'error').length);
  }
}
