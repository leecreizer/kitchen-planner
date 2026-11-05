import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
await loadCatalog();
const id = '3FO44Q9XIIL3';
await ensure(id);
const m = modelOf(id)!;
console.log(m.meta.name, m.editorData.inputs.filter((i) => i.groupTypeId !== 1).map((i) => `${i.paramName}=${String(i.value).slice(0, 30)}`).join(' '));
const ev = new PmEval(m, { catalog: kjlCatalog, overrides: { W: '446', H: '732', D: '18' } });
const b = buildModel(ev, { product: kjlCatalog.product });
console.log('frame', b.frame.min.toArray().map(Math.round), b.frame.max.toArray().map(Math.round));
for (const p of b.parts) {
  if (p.hidden || p.kind === 'aux' || !p.geometry) continue;
  p.geometry.computeBoundingBox(); const bb = p.geometry.boundingBox!.clone().applyMatrix4(p.matrix);
  console.log('  ', p.key.padEnd(8), p.name.slice(0, 14).padEnd(14), 'x', Math.round(bb.min.x), Math.round(bb.max.x), 'y', Math.round(bb.min.y), Math.round(bb.max.y), 'z', Math.round(bb.min.z), Math.round(bb.max.z));
}
for (const n of m.editorData.modelInstances ?? []) console.log(' node', n.functionName, n.name, n.obsBrandGoodId, (n.parameters ?? []).filter((p) => ['position', 'H', 'W', 'rotationDegree', 'ignore'].includes(p.paramName)).map((p) => `${p.paramName}=${String(p.value).slice(0, 60)}`).join(' '));
