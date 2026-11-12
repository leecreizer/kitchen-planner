// 벽 마감(타일 · 벽판넬) 자리 — 배치안 · 설계에서 벽마다 깔 조각(mm)만 계산한다. 3D(kitchen3d buildSplashes)와 점검 도구(probe-winsplash)가 같이 쓴다
import type { Candidate, Frame, Item, Splash } from './autoplan';
import { BASE_D, COUNTER_D, WALL_D, upperTopOf } from './autoplan';
import type { Opening } from './plan';
import { CASING, SPLASH_DEFAULT, cabSpan, wallFrame, type Design, type SplashCfg, type WallId } from './plan';

/** 상판 윗면 높이 — 벽 마감 기본 시작 */
export const COUNTER_TOP = 910;

/** 벽 마감 한 구간 — r0 = x 원점(줄눈 · 결 시작), y0 = 배치 높이(상판 위), H = 가장 높은 조각 윗선(y0 기준), pieces = [x0, x1, ya, yb] (r0 · y0 기준 mm — 바닥부터 까는 조각은 ya 가 음수) */
export interface SplashSeg { s: Splash; wall: WallId | undefined; cfg: SplashCfg; r0: number; y0: number; H: number; pieces: [number, number, number, number][] }

/** 창 · 개구부 구멍(몰딩 포함) 아래 · 위 — 창은 창턱 몰딩부터, 바닥에서 시작하는 개구부는 바닥부터 */
const holeBot = (o: Opening) => (o.kind === 'window' ? o.sill - CASING : -Infinity);
const holeTop = (o: Opening) => (o.kind === 'window' ? o.sill + o.h : o.h) + CASING;

/** 상부장 몸통 아랫선 — 벽 마감이 여기까지 올라간다(도어는 14 더 내려와 마감 끝을 가린다). 창 위 낮은 상부장(NSTD_H) · 냉장고 윗장은 제 높이 */
const upperBottom = (it: Pick<Item, 'key' | 'ov'>, upTop: number) => upTop - (Number(it.ov?.NSTD_H) || (it.key === 'fridgeTop' ? 315 : 720));

/** 벽마다 깔 조각 — 장 줄이 있는 벽은 **벽 길이 전체**(거실 어깨 벽 두께까지, cabSpan)에 깐다
 *  (사용자 2026-11-12 「최초 벽길이에 맞게 벽판넬이나 타일도 맞춰서 적용해줘 상부장이 있으면 상부장 배치 높이까지는 다 채워주고 상부장이 없으면 벽면을 꽉 채워줘」).
 *  세로줄마다: 위 = 상부장이 있으면 그 몸통 아래까지 · 없으면 천장까지, 아래 = 하부장(상판)이 있으면 상판 위부터 · 없으면 바닥부터.
 *  키큰장 · 냉장고 자리는 가려지므로 안 깐다. 창 · 문 구멍(몰딩 포함)은 비운다(창 아래 · 위로 나눠 깐다).
 *  길이 · 시작 · 높이 · 배치 높이를 직접 넣었으면 그 값 그대로(높이를 넣으면 상부장 · 천장과 상관없이 그 높이까지).
 *  조각은 그 벽의 첫 구간(c.splashes 순서)에 모아 담는다 — 나머지 구간은 빈 채로. 벽이 없는 구간(아일랜드 등)은 예전처럼 제 구간 · 기본 높이 */
export function splashLayout(c: Candidate, d: Design): SplashSeg[] {
  const wallOf = new Map<Frame, WallId>();
  for (const it of c.items) if (it.wall != null) wallOf.set(it.frame, it.wall);
  const done = new Set<WallId>(), out: SplashSeg[] = [], upTop = upperTopOf(d.room);
  for (const s of c.splashes) {
    const wall = wallOf.get(s.frame);
    const cfg: SplashCfg = (wall != null ? d.splash?.[wall] : undefined) ?? { kind: 'tile' };
    const y0 = cfg.y ?? COUNTER_TOP, H = cfg.h ?? SPLASH_DEFAULT.h;
    const seg: SplashSeg = { s, wall, cfg, r0: s.t0, y0, H, pieces: [] };
    out.push(seg);
    if (wall == null) { if (s.t1 - s.t0 >= 1) seg.pieces.push([0, s.t1 - s.t0, 0, H]); continue; }
    if (done.has(wall)) continue;
    done.add(wall);
    const [lo, hi] = cabSpan(d, wall);
    const r0 = Math.max(lo, cfg.t0 ?? lo), r1 = Math.min(hi, cfg.len != null ? r0 + cfg.len : hi);
    seg.r0 = r0;
    if (r1 - r0 < 1) continue;
    // 이 벽을 가리는 장 — 이 벽 장 + 구석에서 이 벽에 옆면을 댄 옆 벽 장(그 장 깊이만큼 이 벽을 덮는다: 하부장은 상판 깊이 · 상부장 340 · 키큰장 600)
    const fw = wallFrame(d.room, wall);
    /** 다른 줄 틀(f)의 네모(t0~t1 × u0~u1)를 이 벽 좌표로 — 이 벽 면에 닿으면 덮는 구간 [t0, t1], 아니면 null */
    const onWall = (f: Frame, t0: number, t1: number, u0: number, u1: number): [number, number] | null => {
      const cs = [[t0, u0], [t1, u0], [t0, u1], [t1, u1]].map(([t, u]) => {
        const px = f.o[0] + f.dir[0] * t + f.n[0] * u - fw.o[0], pz = f.o[1] + f.dir[1] * t + f.n[1] * u - fw.o[1];
        return [px * fw.dir[0] + pz * fw.dir[1], px * fw.n[0] + pz * fw.n[1]];
      });
      const us = cs.map((q) => q[1]), ts = cs.map((q) => q[0]);
      return Math.min(...us) > 30 || Math.max(...us) < 30 ? null : [Math.min(...ts), Math.max(...ts)];
    };
    const its: Pick<Item, 'level' | 't' | 'w' | 'key' | 'ov'>[] = c.items.filter((x) => x.wall === wall && x.level !== 'shelf');
    for (const x of c.items) {
      if (x.wall == null || x.wall === wall || x.level === 'shelf') continue;
      const dep = x.level === 'base' ? COUNTER_D : x.level === 'wall' ? WALL_D : BASE_D;
      const sp = onWall(x.frame, x.t, x.t + x.w, 0, dep);
      if (sp) its.push({ level: x.level, t: sp[0], w: sp[1] - sp[0], key: x.key, ov: x.ov });
    }
    // 상판 — 이 벽 줄 상판 + 구석을 덮은 옆 벽 상판(코너장은 구석에서 100 떨어져 서지만 상판은 구석까지 덮는다)
    const ctr: { t0: number; t1: number }[] = [];
    for (const k of c.counters) {
      if (k.island) continue;
      if (wallOf.get(k.frame) === wall) { ctr.push(k); continue; }
      const sp = onWall(k.frame, k.t0, k.t1, Math.min(k.z0, k.z1), Math.max(k.z0, k.z1));
      if (sp) ctr.push({ t0: sp[0], t1: sp[1] });
    }
    const ops = d.openings.filter((o) => o.wall === wall);
    const cuts: number[] = [r0, r1];
    for (const x of its) cuts.push(x.t, x.t + x.w);
    for (const k of ctr) cuts.push(k.t0, k.t1);
    for (const o of ops) cuts.push(o.t - CASING, o.t + o.w + CASING);
    const xs = [...new Set(cuts.filter((x) => x >= r0 && x <= r1))].sort((x, y) => x - y);
    let top = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1], mid = (x0 + x1) / 2;
      if (x1 - x0 < 1) continue;
      const on = (lv: Item['level']) => its.filter((x) => x.level === lv && x.t < mid && x.t + x.w > mid);
      if (on('tall').length) continue;   // 키큰장 · 냉장고 뒤
      const based = on('base').length > 0 || ctr.some((k) => k.t0 < mid && k.t1 > mid), ups = on('wall');
      const ya = cfg.y ?? (based ? COUNTER_TOP : 0);
      const yb = cfg.h != null ? y0 + cfg.h : ups.length ? Math.min(...ups.map((x) => upperBottom(x, upTop))) : d.room.h;
      // 이 세로줄의 구멍(창 · 문 · 개구부)을 빼고 남는 띠
      let bands: [number, number][] = yb - ya >= 20 ? [[ya, yb]] : [];
      for (const o of ops) {
        if (!(mid > o.t - CASING && mid < o.t + o.w + CASING)) continue;
        const h0 = holeBot(o), h1 = holeTop(o);
        bands = bands.flatMap(([a, b]) => (h1 <= a || h0 >= b ? [[a, b]] : [[a, Math.min(b, h0)], [Math.max(a, h1), b]]) as [number, number][]);
      }
      for (const [a, b] of bands) {
        if (b - a < 20) continue;
        // 옆 세로줄과 높이가 같으면 한 조각으로 잇는다
        const last = seg.pieces.find((q) => Math.abs(q[1] - (x0 - r0)) < 0.5 && Math.abs(q[2] - (a - y0)) < 0.5 && Math.abs(q[3] - (b - y0)) < 0.5);
        if (last) last[1] = x1 - r0; else seg.pieces.push([x0 - r0, x1 - r0, a - y0, b - y0]);
        top = Math.max(top, b - y0);
      }
    }
    if (cfg.h == null && top > 0) seg.H = top;
  }
  return out;
}
