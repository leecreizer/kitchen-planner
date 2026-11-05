// 장 끼워 넣기 — 같은 벽 줄에 빈틈없이 이어 붙은 하부장들 사이에서 순서만 바꿔 옮긴다.
// 폭 합이 그대로라 새 틈 · 휠라가 생기지 않는다. 끄는 장 가운데가 옆 장 가운데를 지나면 자리를 바꾼다.
import type { Item } from './autoplan';

/** 끼워 넣기로 옮길 수 있는 장 — 벽 줄 하부장 (EP · 코너장 · 아일랜드 · FIX 도어는 제외) */
export const slotMovable = (it: Item) =>
  it.level === 'base' && it.wall != null && it.tag !== 'ep' && it.tag !== 'fix' && it.tag !== 'island' && !it.key.startsWith('corner');

/** 그 장이 속한 줄 — 같은 벽에서 빈틈없이 이어진 하부장들(EP · 코너장 · 창 · 문 자리에서 끊김), 시작 쪽부터 */
export function slotGroup(items: Item[], it: Item): Item[] {
  const row = items.filter((x) => x.frame === it.frame && slotMovable(x)).sort((a, b) => a.t - b.t);
  let i = row.indexOf(it), j = i;
  if (i < 0) return [it];
  while (i > 0 && Math.abs(row[i - 1].t + row[i - 1].w - row[i].t) < 1) i--;
  while (j < row.length - 1 && Math.abs(row[j].t + row[j].w - row[j + 1].t) < 1) j++;
  return row.slice(i, j + 1);
}

/** 끄는 장 가운데가 c 일 때의 순서 — 끄는 쪽 끝이 옆 장 가운데(끌기 전 자리 t0s)를 지나면 그 장과 자리를 바꾼다.
 *  (가운데끼리 비교하면 넓은 장이 줄 끝의 좁은 장을 못 넘는다). ts = 그 순서로 줄 시작부터 붙인 자리 */
export function slotLayout(group: Item[], it: Item, c: number, t0s: Map<Item, number>) {
  const others = group.filter((x) => x !== it), me = t0s.get(it)!;
  const before = (x: Item) => t0s.get(x)! + x.w / 2 < (t0s.get(x)! < me ? c - it.w / 2 : c + it.w / 2);
  const order = [...others.filter(before), it, ...others.filter((x) => !before(x))];
  const ts = new Map<Item, number>();
  let t = t0s.get(group[0])!;
  for (const x of order) { ts.set(x, t); t += x.w; }
  return { order, ts };
}

/** 같은 줄에 빈틈없이 이어진 장들 — pick 으로 고른 장끼리 (상부장 줄 등) */
export function rowGroup(items: Item[], it: Item, pick: (x: Item) => boolean): Item[] {
  const row = items.filter((x) => x.frame === it.frame && x.level === it.level && pick(x)).sort((a, b) => a.t - b.t);
  let i = row.indexOf(it), j = i;
  if (i < 0) return [it];
  while (i > 0 && Math.abs(row[i - 1].t + row[i - 1].w - row[i].t) < 1) i--;
  while (j < row.length - 1 && Math.abs(row[j].t + row[j].w - row[j + 1].t) < 1) j++;
  return row.slice(i, j + 1);
}

export const isFill = (x: Item) => /fill/i.test(x.key);
/** 크기를 바꾸는 순서(사용자 2026-11-05) — 줄일 때 휠라(최소 10까지) → 일반장 → 조리장 → 서랍장 → 싱크장 · 쿡탑장,
 *  키울 때는 그 반대(싱크장 · 쿡탑장 → 서랍장 → 조리장 → 일반장 → 휠라). 식기세척기장은 언제나 맨 마지막(byPriority dishLast) */
export const sizePriority = (x: Item) => (isFill(x) ? 0 : x.tag === 'sink' || x.tag === 'hob' ? 4 : x.tag === 'dish' ? 5 : /^drawer/.test(x.key) ? 3 : /^cook/.test(x.key) ? 2 : 1);
/** 가까운 순서 목록을 크기 바꾸는 순서로 (같은 등급이면 가까운 쪽 먼저) */
/** 줄일 때 = 휠라 → 여닫이장 → 서랍장 → 식세 · 싱크 · 쿡탑장. 키울 때(grow)는 그 역방향 — 휠라는 항상 마지막 (사용자) */
/** 식기세척기장은 기기 폭(600)을 최대한 지킨다 — 줄일 때든 키울 때든 다른 장이 다 받지 못했을 때만 맨 마지막에(사용자 2026-11-05).
 *  예전엔 키울 때 순서를 뒤집어 식세장이 가장 먼저 커졌다 */
const dishLast = (x: Item) => (x.tag === 'dish' ? 1 : 0);
export const byPriority = (list: Item[], grow = false) => list.map((x, i) => ({ x, i })).sort((a, b) => (dishLast(a.x) - dishLast(b.x)) || (grow ? -1 : 1) * (sizePriority(a.x) - sizePriority(b.x)) || a.i - b.i).map((o) => o.x);
const FILL_MAX = 150, FILL_MIN = 10;
export interface NudgePlan { w: Map<Item, number>; t: Map<Item, number>; add: Item[]; remove: Item[] }
/** 미리 단위로 옮기기 — 줄 길이는 그대로, 한쪽은 delta 만큼 늘고 다른 쪽은 줄어든다.
 *  각 쪽에서 휠라류가 먼저 받고(0 ~ 150), 넘치거나 모자라면 가까운 장부터 하나씩 100 단위로 크기를 바꾼다(그 장 범위를 넘으면 다음 장).
 *  휠라는 10 ~ 150. 없는데 남는 폭이 있으면 줄 끝(벽 쪽)에 새로 넣고, 0 이 되면 뺀다. 안 되면 null */
export function nudge(group: Item[], it: Item, delta: number, range: (x: Item) => [number, number] | null, makeFill: (w: number) => Item, fillOk: [boolean, boolean] = [true, true]): NudgePlan | null {
  const i = group.indexOf(it);
  if (i < 0 || !delta) return null;
  const plan: NudgePlan = { w: new Map(), t: new Map(), add: [], remove: [] };
  // 옮긴 장에서 가까운 순서
  const left = group.slice(0, i).reverse(), right = group.slice(i + 1);
  const side = (list: Item[], d: number, allowFill: boolean): Item[] | null => {
    if (!allowFill) {
      // 벽에 닿지 않는 쪽 — 휠라 없이 가까운 장이 그대로 받는다(미리 단위, 그 장 범위 안에서 다음 장으로)
      let rem = d;
      for (const x of byPriority(list, d > 0)) {
        if (!rem) break;
        const r = isFill(x) ? [FILL_MIN, FILL_MAX] as [number, number] : range(x);
        if (!r) continue;
        const nw = Math.max(r[0], Math.min(r[1], x.w + rem));
        if (nw !== x.w) { plan.w.set(x, nw); rem -= nw - x.w; }
      }
      return rem ? null : list.slice();
    }
    const fills = list.filter(isFill), F = fills.reduce((s, x) => s + x.w, 0), tot = F + d;
    // 줄어드는 쪽(d < 0) — 휠라가 먼저, 모자라면 장이 100 단위로.
    // 늘어나는 쪽(d > 0) — 장이 먼저 그만큼 그대로(식세 · 싱크 · 쿡탑장 → 서랍 → 여닫이 순), 장이 다 못 받은 것만 휠라 (사용자: 키울 때 휠라는 항상 마지막)
    if (d > 0) {
      let left = d;
      for (const x of byPriority(list, true)) {
        if (!left) break;
        if (isFill(x)) continue;
        const r = range(x);
        if (!r) continue;
        const nw = Math.min(r[1], x.w + left);
        if (nw > x.w) { plan.w.set(x, nw); left -= nw - x.w; }
      }
      const Fg = F + left;
      if (Fg > FILL_MAX || (Fg > 0 && Fg < FILL_MIN)) return null;
      const out = list.slice(), near = fills[fills.length - 1];
      for (const f of fills) if (f !== near || Fg < FILL_MIN) { plan.remove.push(f); out.splice(out.indexOf(f), 1); }
      if (Fg >= FILL_MIN) { if (near) plan.w.set(near, Fg); else { const nf = makeFill(Fg); plan.add.push(nf); out.push(nf); } }
      return out;
    }
    // 휠라는 최소 10 까지만 줄인다 — 더 줄여야 하면 장들이 받는다(휠라를 빼지 않는다, 사용자). 처음부터 휠라가 없던 줄은 예전처럼 0 도 된다
    const minF = F > 0 ? FILL_MIN : 0;
    let m = tot > FILL_MAX ? Math.ceil((tot - FILL_MAX) / 100) : tot < minF ? Math.floor((tot - minF) / 100) : 0;
    // 장 크기 바꾸기 — 하나씩 100 단위
    let rem = m * 100;
    const grow = (step: number) => {
      for (const x of byPriority(list, step > 0)) {
        if (!rem) break;
        if (isFill(x)) continue;
        const r = range(x);
        if (!r) continue;
        let w = plan.w.get(x) ?? x.w;
        while (rem && w + step >= r[0] && w + step <= r[1] && Math.sign(rem) === Math.sign(step)) { w += step; rem -= step; }
        if (w !== x.w) plan.w.set(x, w);
      }
    };
    grow(rem > 0 ? 100 : -100);
    const Fn = tot - (m * 100 - rem);
    // 휠라 폭 = 0(없음) 또는 FILL_MIN ~ FILL_MAX
    if (Fn < 0 || Fn > FILL_MAX || (Fn > 0 && Fn < FILL_MIN)) return null;
    // 휠라 — 줄 끝 쪽(옮긴 장에서 먼 쪽) 하나만 남겨 Fn, 나머지는 뺌. 없으면 줄 끝에 새로 (휠라는 장 줄 끝에 둔다)
    const out = list.slice();
    const near = fills[fills.length - 1];
    for (const f of fills) if (f !== near || Fn < FILL_MIN) { plan.remove.push(f); out.splice(out.indexOf(f), 1); }
    if (Fn >= FILL_MIN) {
      if (near) plan.w.set(near, Fn);
      else { const nf = makeFill(Fn); plan.add.push(nf); out.push(nf); }
    }
    void m;
    return out;
  };
  const L = side(left, delta, fillOk[0]), R = side(right, -delta, fillOk[1]);
  if (!L || !R) return null;
  let t = group[0].t;
  for (const x of [...L.reverse(), it, ...R]) { plan.t.set(x, t); t += plan.w.get(x) ?? x.w; }
  const end = group[group.length - 1].t + group[group.length - 1].w;
  if (Math.abs(t - end) > 1) return null;
  return plan;
}
