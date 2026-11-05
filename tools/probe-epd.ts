// EP · 키큰장 깊이 — npx vite-node tools/probe-epd.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const m of cat.modules.filter((x) => /^corner/.test(x.key))) {
  await ensure(m.obs);
  const ov = /^ep[TW]/.test(m.key) ? { STD_YN: 'true', NSTD_H: '2400' } : {};
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov });
  const b = buildModel(ev, { product: kjlCatalog.product });
  const f = b.frame;
  console.log(m.series, m.key, 'x', f.min.x | 0, f.max.x | 0, 'y', f.min.y | 0, f.max.y | 0, 'z', f.min.z | 0, f.max.z | 0, 'vars', Object.keys(ev.vars ?? {}).filter((k)=>/D|DEP/i.test(k)).slice(0,8).join(','));
}
