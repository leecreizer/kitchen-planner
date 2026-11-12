// 자동 배치 1위 안 — 벽 쿡탑 위에 후드가 있는지(후드일체형 쿡탑 빼고) · 「쿡탑이 창 가까이」 경고가 쿡탑 최종 자리와 맞는지.
// 2026-11-11 기본 냉장고를 4도어로 바꾸자 1위 안(92점)이 쿡탑을 창 밑에 두고 후드도 없었다 — 창 밑 판정을 처음 자리로만 해서 당겨진 쿡탑을 놓쳤다.
// npx vite-node tools/probe-hobhood.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { defaultDesign, type Design, type LayoutKind } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
let cases = 0, noHood = 0, winFlag = 0;
const out: string[] = [];
const note = (s: string) => { if (out.length < 20) out.push(s); };
for (const layout of ['I', 'L', 'Lr', 'U', 'II'] as LayoutKind[]) for (const fridgeKind of ['twin', 'sbs', 'quad', 'builtin'] as const)
  for (const hob of ['CIR-KM7564FR', 'CTB-HS133P', 'CTB-HS614MD']) for (const room of [{ w: 4200, d: 3600 }, { w: 3600, d: 3000 }, { w: 5000, d: 4200 }]) {
    const d = { ...defaultDesign(), layout, fridgeKind, appliance: { hob }, room: { ...room, h: 2400 } } as Design;
    const c = autoPlan(d, cat, 'EO')[0];
    if (!c) continue;
    cases++;
    const h = c.items.find((x) => x.tag === 'hob' && x.wall != null);
    if (!h) continue;
    const tag = `${layout}/${fridgeKind}/${hob}/${room.w}×${room.d}`;
    if (hob !== 'CTB-HS614MD' && !c.items.some((x) => x.key === 'hood' && x.frame === h.frame)) { noHood++; note(`${tag} 1위 안 쿡탑(벽${h.wall} ${h.t}~${h.t + h.w}) 위 후드 없음 · 점수 ${c.score}`); }
    const near = d.openings.some((o) => o.kind === 'window' && o.wall === h.wall && h.t < o.t + o.w + 300 && h.t + h.w > o.t - 300);
    if (near !== c.warnings.some((w) => /쿡탑이 창 가까이/.test(w))) { winFlag++; note(`${tag} 쿡탑 창 가까이 ${near} · 경고 ${!near}`); }
  }
for (const s of out) console.log(' ', s);
console.log(`쿡탑 후드 경우 ${cases} · 후드 없음 ${noHood} · 창 판정 어긋남 ${winFlag}`);
