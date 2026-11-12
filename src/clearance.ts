// 상판 여유 검사 — 쿡탑(인덕션) 양옆 · 싱크볼 좌우에 상판이 기준(clearOf)만큼 이어지는지(사용자 2026-11-09 「기본 기준으로하고 수정은 가능하게해」).
// 기기 가장자리에서 줄 방향으로 재며, 벽 · 키큰장 · 냉장고 · 줄 끝(EP) · 창 · 문에서 상판이 끊기면 거기까지. 코너는 옆 줄 상판이 이어 준다.
// 자동 배치(알림 · 점수)와 평면도(고친 뒤에도 바로) 가 같이 쓴다
import { applianceOf } from './catalog';
import { clearOf, type Design } from './plan';
import type { Candidate, Frame } from './autoplan';

export type Pt = [number, number];
export interface SideGap { what: 'hob' | 'sink'; free: number; need: number; ok: boolean; a: Pt; b: Pt }

/** 상판 깊이 가운데(장 깊이 600 의 반) — 상판 위 점을 재는 줄 */
const MID_U = 300;
const P = (f: Frame, t: number, u: number): Pt => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];

/** 상판 위인지 — 줄 · 아일랜드 상판 조각의 바닥 사각형 안(1mm 여유) */
function onCounter(c: Pick<Candidate, 'counters'>, p: Pt) {
  return c.counters.some((k) => {
    const x = p[0] - k.frame.o[0], z = p[1] - k.frame.o[1];
    const t = x * k.frame.dir[0] + z * k.frame.dir[1], u = x * k.frame.n[0] + z * k.frame.n[1];
    return t >= k.t0 - 1 && t <= k.t1 + 1 && u >= k.z0 - 1 && u <= k.z1 + 1;
  });
}

/** 쿡탑 · 싱크볼 양옆 상판 여유 — 쪽마다 하나(기준보다 200 더까지 잰다) */
export function sideGaps(d: Design, c: Pick<Candidate, 'items' | 'counters'>): SideGap[] {
  const cl = clearOf(d), out: SideGap[] = [];
  const hs = applianceOf('hob', d.appliance?.hob)?.size, ss = applianceOf('sink', d.appliance?.sink)?.size;
  const turned = Math.abs((d.hobRot ?? 0) % 180) === 90;
  for (const it of c.items) {
    const what = it.tag === 'hob' ? 'hob' : it.tag === 'sink' ? 'sink' : null;
    if (!what) continue;
    const need = what === 'hob' ? cl.hobSide : cl.sinkSide;
    // 기기 폭(줄 방향) — 쿡탑을 90° 돌렸으면 깊이가 줄 방향. 장보다 넓을 수는 없다
    const aw = Math.min(it.w, (what === 'hob' ? (turned ? hs?.[1] : hs?.[0]) : ss?.[0]) ?? (what === 'hob' ? 600 : 800));
    const mid = it.t + it.w / 2;
    for (const s of [-1, 1]) {
      const e = mid + (s * aw) / 2;
      let free = 0;
      for (let k = 10; k <= need + 200; k += 10) { if (!onCounter(c, P(it.frame, e + s * k, MID_U))) break; free = k; }
      out.push({ what, free, need, ok: free >= need, a: P(it.frame, e, MID_U), b: P(it.frame, e + s * Math.max(free, 10), MID_U) });
    }
  }
  return out;
}
