// 벽 길이(wallRun) — 부엌 옆 벽은 트인 쪽 끝에서 거실 어깨 벽 두께(150)까지(사용자 2026-11-10 「부엌 벽 길이를 거실 왼쪽, 오른쪽 벽 두께도 포함해줘」).
// 그 끝에 날개벽이 있으면 부엌 벽은 날개벽에서 끝난다(150 없음). 거실 어깨 폭 0 이면 거실 옆 벽까지 한 줄(문턱 두께 150 포함). 트인 벽이 없으면 그대로
import { defaultDesign, nextWall, prevWall, wallLength, wallRun, WALL_THICK, type AnyWall, type Design } from '../src/plan';

const T = WALL_THICK;
let n = 0, bad = 0;
const expect = (name: string, d: Design, w: AnyWall, want: { off: number; L: number; parts: AnyWall[] }) => {
  n++;
  const got = wallRun(d, w);
  const ok = got.off === want.off && got.L === want.L && got.parts.join() === want.parts.join();
  if (!ok) { bad++; console.log(`틀림 ${name} — 벽 ${w}: ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`); }
};
for (const ow of [0, 1, 2, 3] as const) {
  const base = (): Design => ({ ...defaultDesign(), openWall: ow, openings: [] });
  const ka = prevWall(ow), kb = nextWall(ow), front = nextWall(nextWall(ow));
  // ① 거실이 부엌보다 넓음(어깨 1500) · 날개벽 없음 — 옆 벽 둘 다 트인 쪽 끝에 150
  let d = base();
  const La = wallLength(d.room, ka), Lb = wallLength(d.room, kb), Lf = wallLength(d.room, front);
  expect(`트인 벽 ${ow} 어깨 · 시작 쪽 옆 벽`, d, ka, { off: 0, L: La + T, parts: [ka] });
  expect(`트인 벽 ${ow} 어깨 · 끝 쪽 옆 벽`, d, kb, { off: T, L: T + Lb, parts: [kb] });
  expect(`트인 벽 ${ow} 정면 벽은 그대로`, d, front, { off: 0, L: Lf, parts: [front] });
  // ② 날개벽 — 그 끝은 날개벽에서 끝(150 없음), 반대쪽은 150
  d = { ...base(), wing: { a: 600, b: 0 } };
  expect(`트인 벽 ${ow} 시작 쪽 날개벽`, d, ka, { off: 0, L: La, parts: [ka] });
  expect(`트인 벽 ${ow} 시작 쪽 날개벽 · 끝 쪽 옆 벽`, d, kb, { off: T, L: T + Lb, parts: [kb] });
  d = { ...base(), wing: { a: 0, b: 600 } };
  expect(`트인 벽 ${ow} 끝 쪽 날개벽`, d, kb, { off: 0, L: Lb, parts: [kb] });
  // ③ 어깨 폭 0 — 거실 옆 벽까지 한 줄(예전 그대로)
  d = { ...base(), living: { depth: 4000, a: 0, b: 0 } };
  expect(`트인 벽 ${ow} 이어진 시작 쪽`, d, ka, { off: 0, L: La + T + 4000, parts: [ka, 11] });
  expect(`트인 벽 ${ow} 이어진 끝 쪽`, d, kb, { off: 4000 + T, L: 4000 + T + Lb, parts: [12, kb] });
  // ④ 거실 벽은 그대로
  d = base();
  expect(`트인 벽 ${ow} 거실 맞은편 벽`, d, 10, { off: 0, L: Lf + 1500 + 1500, parts: [10] });
}
// ⑤ 트인 벽 없음 — 닫힌 방, 벽 길이 그대로
{
  const d: Design = { ...defaultDesign(), openWall: null, openings: [] };
  for (const w of [0, 1, 2, 3] as const) expect(`닫힌 방 벽 ${w}`, d, w, { off: 0, L: wallLength(d.room, w), parts: [w] });
}
console.log(`벽 길이 경우 ${n} · 틀림 ${bad}`);
