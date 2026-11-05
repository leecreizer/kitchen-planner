import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const m = cat.modules.find((x) => x.key === 'epTx' && x.series === 'EO')!;
await ensure(m.obs);
const md: any = modelOf(m.obs)!;
console.log(JSON.stringify(md).match(/"(name|n)":"[A-Z_]{1,12}"/g)?.slice(0, 80).join(' '));
for (const ov of [{ STD_YN: 'true', NSTD_H: '2400', NSTD_D: '570' }, { STD_YN: 'true', NSTD_H: '2400', D: '570' }, { STD_YN: 'true', NSTD_H: '2400', NSTD_DP: '570' }]) {
  const ev = new PmEval(md, { catalog: kjlCatalog, overrides: ov });
  const b = buildModel(ev, { product: kjlCatalog.product });
  console.log(JSON.stringify(ov), b.frame.min.y | 0);
}
