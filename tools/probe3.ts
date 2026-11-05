import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const g = cat.grades.find((x) => x.id === process.argv[2])!;
const m = cat.modules.find((x) => x.key === 'cook2' && x.series === g.series)!;
for (const door of g.doors.slice(0, 3)) {
  await ensure(m.obs); await ensure(door.obs);
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: { [g.var]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } });
  const b = buildModel(ev, { product: kjlCatalog.product });
  console.log('==', door.name, door.obs, 'parts', b.parts.length);
  for (const p of b.parts) if (p.key.includes('/')) console.log('  ', p.kind, p.hidden ? 'HIDDEN' : '', p.key.slice(0, 40), p.name, p.texture ?? p.color, p.mesh ? JSON.stringify(p.mesh) : '');
  const d = ev.diagsAll().filter((x) => x.level !== 'info'); d.slice(0, 5).forEach((x) => console.log('  diag', x.level, x.where, x.message));
  const dm = modelOf(door.obs)!; console.log('  door nodes', dm.editorData.modelInstances?.map((n) => n.functionName + ':' + n.name + ':' + (n.obsBrandGoodId ?? '')).join(' | '));
}
