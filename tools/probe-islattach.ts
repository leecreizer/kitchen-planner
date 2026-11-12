import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, wallFrame, wallLength, type Design, type WallId } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
// 냉장고 1도어 2대(2026-11-11 기본이 4도어로 바뀌기 전 기준) — 이 시험의 아일랜드 끌기 자리가 그 배치를 전제로 짜여 있다. 4도어에서 벽 끝으로 끈 아일랜드가 코너장 없이 닿는 경우는 따로 남은 일
const base = { ...defaultDesign(), fridgeKind: 'twin' } as ReturnType<typeof defaultDesign>;
const c0 = autoPlan({ ...base, island: true } as Design, cat, 'EO')[0];
console.log('walls', c0.walls, 'island', c0.island && { cx: c0.island.cx, cz: c0.island.cz, rot: c0.island.rot });
let bad = 0, tot = 0;
for (const w of c0.walls as WallId[]) {
  const f = wallFrame(base.room, w), L = wallLength(base.room, w);
  // 아일랜드 끝이 그 줄 앞면(600)에 닿도록 — 아일랜드 길이 방향 = 벽 안쪽 법선
  const rot = Math.round(((Math.atan2(f.n[0], f.n[1]) * 180) / Math.PI + 360 + 90) % 360 / 90) * 90 % 360;
  for (let t = 300; t <= L - 300; t += 300) for (const gap of [0, 80, -60]) {
    for (const r of [rot, (rot + 180) % 360]) {
      const len = 2400, u = 600 + gap + len / 2;
      const d = { ...base, island: true, islandCfg: { ...base.islandCfg, pos: { x: f.o[0] + f.dir[0] * t + f.n[0] * u, z: f.o[1] + f.dir[1] * t + f.n[1] * u, rot: r as 0 | 90 | 180 | 270 } } } as Design;
      const c = autoPlan(d, cat, 'EO')[0]; if (!c?.island) continue;
      // 끝이 장 앞에 닿았나 — 아일랜드 끝 중 하나가 그 벽 앞면 600±80 안
      const fr = c.island.frame, ends = [0, c.island.len].map((tt) => [fr.o[0] + fr.dir[0] * tt + fr.n[0] * 300, fr.o[1] + fr.dir[1] * tt + fr.n[1] * 300]);
      const touch = ends.some(([x, z]) => { const uu = (x - f.o[0]) * f.n[0] + (z - f.o[1]) * f.n[1]; return Math.abs(uu - 600) < 120; });
      if (!touch) continue;
      tot++;
      if (c.island.attached == null) { bad++; console.log(`  붙지 않음: 벽${w} t${t} gap${gap} rot${r} — ${c.warnings.concat(c.reasons.filter((x) => /아일랜드/.test(x))).join(' / ').slice(0, 160)}`); }
    }
  }
}
console.log('닿은 경우', tot, '코너장 없이', bad);
