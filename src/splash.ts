// 벽 마감(타일 · 벽판넬) 자리 — 배치안 · 설계에서 벽마다 깔 조각(mm)만 계산한다. 3D(kitchen3d buildSplashes)와 점검 도구(probe-winsplash)가 같이 쓴다
import type { Candidate, Frame, Splash } from './autoplan';
import type { Opening } from './plan';
import { CASING, SPLASH_DEFAULT, wallLength, type Design, type SplashCfg, type WallId } from './plan';

/** 상판 윗면 높이 — 벽 마감 기본 시작 */
export const COUNTER_TOP = 910;

/** 벽 마감 한 구간 — r0 = x 원점(줄눈 · 결 시작), y0 = 배치 높이, H = 마감 높이, pieces = [x0, x1, ya, yb] (r0 · y0 기준 mm) */
export interface SplashSeg { s: Splash; wall: WallId | undefined; cfg: SplashCfg; r0: number; y0: number; H: number; pieces: [number, number, number, number][] }

/** 창 · 개구부 구멍(몰딩 포함) 아래 · 위 — 창은 창턱 몰딩부터, 바닥에서 시작하는 개구부는 바닥부터 */
const holeBot = (o: Opening) => (o.kind === 'window' ? o.sill - CASING : -Infinity);
const holeTop = (o: Opening) => (o.kind === 'window' ? o.sill + o.h : o.h) + CASING;

/** 벽마다 깔 조각. 입력한 길이 · 시작이 있으면 그 구간 그대로(그 벽에 한 번), 없으면 상판 줄 구간마다.
 *  창 자리(몰딩 바깥 폭)는 구멍 아래 · 위로 나눠 깐다 — 양옆이 상부장 · 키큰장 · 벽 끝으로 막힌 자리는 창 위를 천장까지 메우고
 *  (사용자 2026-11-10 「창문위에 타일은 메꿔지지 않네」 — 예전엔 창 아래만 깔아 상부장 사이 창 위가 맨 벽이었다), 한쪽이라도 트였으면 평소 높이까지만 */
export function splashLayout(c: Candidate, d: Design): SplashSeg[] {
  const wallOf = new Map<Frame, WallId>();
  for (const it of c.items) if (it.wall != null) wallOf.set(it.frame, it.wall);
  const done = new Set<WallId>(), out: SplashSeg[] = [];
  for (const s of c.splashes) {
    const wall = wallOf.get(s.frame);
    const cfg: SplashCfg = (wall != null ? d.splash?.[wall] : undefined) ?? { kind: 'tile' };
    const y0 = cfg.y ?? COUNTER_TOP, H = cfg.h ?? SPLASH_DEFAULT.h;
    const seg: SplashSeg = { s, wall, cfg, r0: s.t0, y0, H, pieces: [] };
    out.push(seg);
    // 길이 · 시작 — 입력했으면 그 구간 그대로(벽 안으로만, 그 벽에 한 번). 예전엔 상판 줄 구간마다 잘려 입력과 달랐다. 안 했으면 상판 줄 구간
    const own = cfg.t0 != null || cfg.len != null;
    if (own && wall != null && done.has(wall)) continue;
    if (own && wall != null) done.add(wall);
    const segs = wall != null ? c.splashes.filter((x) => wallOf.get(x.frame) === wall) : [s];
    const a0 = Math.min(...segs.map((x) => x.t0)), a1 = Math.max(...segs.map((x) => x.t1)), L = wall != null ? wallLength(d.room, wall) : s.t1;
    const r0 = own ? Math.max(0, cfg.t0 ?? a0) : s.t0, r1 = own ? Math.min(L, cfg.len != null ? (cfg.t0 ?? a0) + cfg.len : a1) : s.t1;
    seg.r0 = r0;
    if (r1 - r0 < 1) continue;
    // 창 자리 양옆이 막혔나 — 상부장 · 키큰장(EP 포함) 끝이 몰딩 바깥에 닿거나 벽 끝
    const ups = c.items.filter((x) => (wall != null ? x.wall === wall : x.frame === s.frame) && (x.level === 'wall' || x.level === 'tall'));
    const near = (a: number, b: number) => Math.abs(a - b) <= 60;
    const colTop = (o: Opening) => {
      const c0 = o.t - CASING, c1 = o.t + o.w + CASING;
      const closed = (c0 <= 60 || ups.some((x) => near(x.t + x.w, c0))) && (c1 >= L - 60 || ups.some((x) => near(x.t, c1)));
      return closed ? d.room.h : y0 + H;
    };
    const ops = d.openings.filter((o) => o.wall === wall && holeBot(o) < colTop(o) && holeTop(o) > y0);
    const cuts: number[] = [r0, r1];
    for (const o of ops) cuts.push(o.t - CASING, o.t + o.w + CASING);
    const xs = [...new Set(cuts.filter((x) => x >= r0 && x <= r1))].sort((x, y) => x - y);
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
      if (x1 - x0 < 1) continue;
      const op = ops.find((o) => mid > o.t - CASING && mid < o.t + o.w + CASING);
      if (!op) { seg.pieces.push([x0 - r0, x1 - r0, 0, H]); continue; }
      const top = colTop(op) - y0, low = Math.min(top, holeBot(op) - y0), up = Math.max(0, holeTop(op) - y0);
      if (low >= 20) seg.pieces.push([x0 - r0, x1 - r0, 0, low]);
      if (top - up >= 20) seg.pieces.push([x0 - r0, x1 - r0, up, top]);
    }
  }
  return out;
}
