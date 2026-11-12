// 장 폭 바꾸기 · 끼우기 · 빼기 때 옆 장들이 차이를 받는 순서 — 사용자 2026-11-11 「모든 장은 정규격 사이즈로 크기를 맞추고 휠라로 조절이 안될때 배치룰 순서대로 장의 사이즈를 조절한다」
//   ① 휠라(30 ~ 150)가 먼저 ② 남으면 장을 배치 규칙 순서(줄일 때 여닫이 → 서랍 → 싱크 · 쿡탑 → 식세, 키울 때 반대)로 다른 정규격 폭으로 — 남는 차이는 휠라가 다시 받는다
//   ③ 정규격으로 안 맞으면 마지막에 비규격 범위. npx vite-node tools/probe-stdwidth.ts
import { planWidths, FILL_MIN, FILL_MAX } from '../src/reorder';
import type { Item } from '../src/autoplan';
const F = { o: [0, 0] as [number, number], dir: [1, 0] as [number, number], n: [0, 1] as [number, number] };
const mk = (key: string, w: number, tag?: Item['tag']): Item => ({ key, level: 'base', frame: F, t: 0, w, wall: 0, ...(tag ? { tag } : {}) });
const STD: Record<string, number[]> = { cook2: [700, 800, 900, 1000], drawer3: [450, 600], sink: [800, 900, 1000, 1200], cook1: [200, 250, 300, 350, 400, 450, 500, 550, 600] };
const RANGE: Record<string, [number, number]> = { cook2: [610, 1200], drawer3: [300, 600], sink: [800, 1200], cook1: [150, 600] };
const info = (x: Item) => (/fill/.test(x.key) ? { fill: true, std: [], range: [Math.min(FILL_MIN, x.w), FILL_MAX] as [number, number] } : { fill: false, std: STD[x.key] ?? [], range: RANGE[x.key] ?? null });
let n = 0, bad = 0;
const check = (name: string, near: Item[], rem: number, want: Record<string, number>, wantRem = 0, endFill: [number, number] | null = null) => {
  n++;
  const r = planWidths(near, rem, info, endFill);
  const got = Object.fromEntries(near.map((x, i) => [`${x.key}${i}`, r.plan.get(x) ?? x.w]));
  const okW = Object.entries(want).every(([k, v]) => got[k] === v), okR = r.rem === wantRem;
  // 바뀐 장(휠라 빼고)은 정규격이어야 — 비규격을 기대한 경우만 예외(want 에 적음)
  if (!okW || !okR) { bad++; console.log(`✗ ${name} — ${JSON.stringify(got)} 나머지 ${r.rem} (기대 ${JSON.stringify(want)} 나머지 ${wantRem})`); }
  else console.log(`✓ ${name} — ${JSON.stringify(got)}`);
};
// 1 휠라만으로 — 장은 그대로
check('휠라만', [mk('bfill50', 120), mk('cook2', 900)], -80, { bfill500: 40, cook21: 900 });
// 2 휠라가 다 못 받으면 — 여닫이장(규칙 첫째)을 정규격 한 단계, 남는 차이는 휠라가 다시
check('휠라 + 여닫이 정규격', [mk('bfill50', 100), mk('cook2', 900), mk('drawer3', 600)], -200, { bfill500: 100, cook21: 700, drawer32: 600 });
// 3 휠라 없음 · 정규격 한 단계로 딱 맞음
check('정규격 딱', [mk('cook2', 900), mk('drawer3', 600)], -100, { cook20: 800, drawer31: 600 });
// 4 키울 때 — 싱크(규칙상 키울 땐 먼저)를 정규격으로, 남는 건 휠라
check('키울 때 정규격', [mk('bfill50', 60), mk('cook2', 800), mk('sink', 900, 'sink')], 130, { bfill500: 90, cook21: 800, sink2: 1000 });
// 5 정규격 · 휠라로 안 맞으면 — 마지막에 비규격(규칙 순서 첫 장)
check('비규격 마지막', [mk('cook2', 800), mk('drawer3', 600)], -30, { cook20: 770, drawer31: 600 });
// 6 다 못 받으면 나머지
check('못 받음', [mk('drawer3', 300)], -200, { drawer30: 300 }, -200);
// 7 줄 끝이 벽 — 휠라가 없어도 벽 끝 새 휠라(30 ~ 150)가 먼저 받는다(장은 그대로, 나머지를 휠라로 넘김)
check('벽 끝 새 휠라', [mk('cook1', 200), mk('cook2', 900)], 130, { cook10: 200, cook21: 900 }, 130, [FILL_MIN, FILL_MAX]);
// 8 벽 끝 새 휠라로도 넘치면 — 정규격 한 단계 + 남는 건 새 휠라
check('정규격 + 벽 끝 새 휠라', [mk('cook1', 200), mk('cook2', 900)], 200, { cook10: 250, cook21: 900 }, 150, [FILL_MIN, FILL_MAX]);
console.log(`정규격 폭 경우 ${n} · 틀림 ${bad}`);
