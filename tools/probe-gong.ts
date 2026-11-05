// 공도어(도어 미선택 기본 사각 상자)가 남는 장 — 도어를 골라 넣고도 부품 경로에 공도어 하위 모델이 남는지
//   npx vite-node tools/probe-gong.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let n = 0;
for (const m of cat.modules) {
  const g = cat.grades.find((x) => x.series === m.series) ?? cat.grades[0];
  await ensure(m.obs); await ensure(g.doors[0].obs);
  const ov: Record<string, string> = {}; if (m.doorVar) ov[m.doorVar] = JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 });
  const b = buildModel(new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov }), { product: kjlCatalog.product });
  const hit = new Set<string>();
  // 공도어 표시 = 「레드」 재질 판(도어를 고르면 사라진다)
  for (const p of b.parts) if (!p.hidden && p.kind === 'solid' && /^레드/.test(p.texture ? kjlCatalog.product(p.texture)?.name ?? '' : '')) hit.add(p.key);
  if (hit.size) n++, console.log(m.key, m.series, m.doorVar, m.name, '레드 판', hit.size);
}
console.log('공도어 남는 장', n, '/', cat.modules.length);
