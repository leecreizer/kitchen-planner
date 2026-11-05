// 줄이기 · 키우기 순서 — 줄일 땐 휠라 먼저, 키울 땐 역방향(휠라 마지막). npx vite-node tools/probe-grow.ts
import { nudge, byPriority } from '../src/reorder';
import type { Item } from '../src/autoplan';
const f = { o: [0, 0], dir: [1, 0], n: [0, 1] } as never;
const mk = (key: string, w: number, tag?: Item['tag']): Item => ({ key, level: 'base', frame: f, t: 0, w, wall: 0, tag });
const row = () => { const r = [mk('bfill50', 50), mk('cook1', 450), mk('drawer3', 600), mk('dish', 600, 'dish'), mk('sink', 1000, 'sink'), mk('cook2', 900)]; let t = 0; for (const x of r) { x.t = t; t += x.w; } return r; };
const range = (x: Item): [number, number] | null => (x.tag === 'dish' ? [600, 600] : x.key === 'sink' ? [900, 1200] : x.key === 'cook1' ? [300, 600] : x.key === 'cook2' ? [610, 1200] : x.key === 'drawer3' ? [300, 600] : null);
const show = (r: Item[], p: ReturnType<typeof nudge>) => r.map((x) => `${x.key}:${p?.w.get(x) ?? x.w}${p?.remove.includes(x) ? '(뺌)' : ''}`).join(' ') + (p?.add.length ? ' +' + p.add.map((x) => `${x.key}:${x.w}`).join(',') : '') + (p ? '' : ' 실패');
console.log('줄일 때 순서', byPriority(row()).map((x) => x.key).join(' > '));
console.log('키울 때 순서', byPriority(row(), true).map((x) => x.key).join(' > '));
for (const d of [-40, -130, 40, 130, 260]) {
  // 싱크를 d 만큼 옮김 — 왼쪽 줄(벽 쪽 휠라 있음)이 d 만큼 늘거나 줄어든다
  const r = row(); const it = r[4];
  console.log(`sink ${d > 0 ? '+' : ''}${d}:`, show(r, nudge(r, it, d, range, (w) => mk('bfill50', w), [true, false])));
}
