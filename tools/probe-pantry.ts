// 코너 팬트리장 형상 — npx vite-node tools/probe-pantry.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const m = cat.modules.find((x) => x.key === 'pantryCorner')!;
await ensure(m.obs);
const md = modelOf(m.obs)! as unknown as { params?: unknown; paramModel?: unknown };
const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: {} });
const vars = (ev as unknown as { vars?: Map<string, unknown> }).vars;
console.log('vars', vars ? [...vars.keys()].slice(0, 60) : Object.keys(md));
const b = buildModel(ev, { product: kjlCatalog.product });
console.log('frame', b.frame.min, b.frame.max);
for (const p of b.parts.filter((p) => !p.hidden && p.kind !== 'aux')) {
  const g = p.geometry; if (!g) continue; g.computeBoundingBox();
  const bb = g.boundingBox!.clone().applyMatrix4(p.matrix);
  console.log((p as { name?: string }).name ?? '', p.kind, bb.min.toArray().map((v) => v | 0).join(','), '→', bb.max.toArray().map((v) => v | 0).join(','));
}
