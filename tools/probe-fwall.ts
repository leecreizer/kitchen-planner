// 냉장고장 벽 — 지금 배치에 없는 벽(오른쪽)을 고르면 그 벽을 쓰는 배치가 나오나. npx vite-node tools/probe-fwall.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, viewWalls, type Design } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const layout of ['I', 'L', 'U', 'II'] as const) {
  const d = { ...defaultDesign(), layout } as Design;
  const v = viewWalls(d.openWall);
  for (const [n, w] of [['왼쪽', v.left], ['정면', v.front], ['오른쪽', v.right]] as const) for (const end of ['start', 'end'] as const) {
    const cs = autoPlan({ ...d, fridgeAt: { wall: w, end } }, cat, 'EO');
    const fr = cs[0]?.items.find((x) => x.tag === 'fridge');
    console.log(layout, n, end, '→', cs[0]?.title, 'fridge wall', fr?.wall === w ? 'OK' : `X(${fr?.wall})`);
  }
}
