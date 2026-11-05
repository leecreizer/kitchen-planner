// 문짝 열림 방향 — npx vite-node tools/probe-door.ts [키,…]
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const K2L = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const keys = (process.argv[2] ?? 'cook1,cook2,sink,drawer3,drawer2,wall1,wall2,dishDry,hood,tall,tall2,fridgeTop,wallCornerL,cornerL,oven,fridgeTall,wallGlass,islandOpen,dish').split(',');
for (const series of (process.argv[3] ?? 'EO,KB').split(',')) {
  const g = cat.grades.find((x) => x.series === series)!;
  for (const key of keys) {
    const m = cat.modules.find((x) => x.key === key && x.series === series); if (!m) continue;
    await ensure(m.obs); await ensure(g.doors[0].obs);
    const ov: Record<string, string> = {}; if (m.doorVar) ov[m.doorVar] = JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 });
    const b = buildModel(new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: ov }), { product: kjlCatalog.product });
    const doors = new Map<string, { dir: number; box: THREE.Box3; n: number; names: Set<string>; info?: Record<string, number> }>();
    let loose = 0;
    for (const p of b.parts) {
      if (p.hidden || p.kind !== 'solid') continue;
      if (!p.door) { const bb = (p.geometry!.computeBoundingBox(), p.geometry!.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(K2L, p.matrix))); if (bb.max.z > 560 && /서랍/.test(kjlCatalog.product(p.texture ?? '')?.name ?? '')) loose++; continue; }
      const e = doors.get(p.door.id) ?? { dir: p.door.dir, box: p.door.box.clone().applyMatrix4(K2L), n: 0, names: new Set<string>(), info: p.door.info };
      e.n++; e.names.add((p.texture ? kjlCatalog.product(p.texture)?.name : p.color)?.slice(0, 14) ?? ''); doors.set(p.door.id, e);
    }
    console.log(`## ${series} ${key}  문짝 ${doors.size}`);
    for (const [id, e] of doors) console.log('   dir', e.dir, 'x', e.box.min.x | 0, e.box.max.x | 0, 'y', e.box.min.y | 0, e.box.max.y | 0, 'z', e.box.min.z | 0, e.box.max.z | 0, 'parts', e.n, JSON.stringify(e.info));
  }
}
