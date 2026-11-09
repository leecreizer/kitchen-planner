// 장 끼워 넣기 — 같은 벽 줄에 빈틈없이 이어 붙은 하부장들 사이에서 순서만 바꿔 옮긴다.
// 폭 합이 그대로라 새 틈 · 휠라가 생기지 않는다. 끄는 장 가운데가 옆 장 가운데를 지나면 자리를 바꾼다.
import type { Item } from './autoplan';

/** 끼워 넣기 · 끌기로 옮길 수 있는 장 — 하부 · 상부 · 키큰장(냉장고 포함) · 아일랜드 장(사용자 지시 2026-11-06 「모든 장이 선택 이동되게」).
 *  EP · FIX 도어 · 코너장 · 상부 코너장 · 냉장고 윗장(냉장고를 따라간다) · 후드장(쿡탑을 따라간다) · 팬트리 · 선반은 제외 */
export const slotMovable = (it: Item) =>
  (it.level === 'base' || it.level === 'wall' || it.level === 'tall') && it.tag !== 'ep' && it.tag !== 'fix'
  && !/^corner|^wallCorner|^fridgeTop$|^hood$|pantry|^fixFill/.test(it.key);

/** 그 장이 속한 줄 — 같은 벽 · 같은 층에서 빈틈없이 이어진 장들(EP · 코너장 · 창 · 문 자리에서 끊김), 시작 쪽부터 */
export function slotGroup(items: Item[], it: Item): Item[] {
  const row = items.filter((x) => x.frame === it.frame && x.level === it.level && slotMovable(x)).sort((a, b) => a.t - b.t);
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
/** 크기를 바꾸는 순서(사용자 2026-11-05) — 줄일 때 휠라(최소 30까지) → 일반장 → 조리장 → 서랍장 → 싱크장 · 쿡탑장,
 *  키울 때는 그 반대(싱크장 · 쿡탑장 → 서랍장 → 조리장 → 일반장 → 휠라). 식기세척기장은 언제나 맨 마지막(byPriority dishLast) */
export const sizePriority = (x: Item) => (isFill(x) ? 0 : x.tag === 'sink' || x.tag === 'hob' ? 4 : x.tag === 'dish' ? 5 : /^drawer/.test(x.key) ? 3 : /^cook/.test(x.key) ? 2 : 1);
/** 가까운 순서 목록을 크기 바꾸는 순서로 (같은 등급이면 가까운 쪽 먼저) */
/** 줄일 때 = 휠라 → 여닫이장 → 서랍장 → 식세 · 싱크 · 쿡탑장. 키울 때(grow)는 그 역방향 — 휠라는 항상 마지막 (사용자) */
/** 식기세척기장은 기기 폭(600)을 최대한 지킨다 — 줄일 때든 키울 때든 다른 장이 다 받지 못했을 때만 맨 마지막에(사용자 2026-11-05).
 *  예전엔 키울 때 순서를 뒤집어 식세장이 가장 먼저 커졌다 */
const dishLast = (x: Item) => (x.tag === 'dish' ? 1 : 0);
export const byPriority = (list: Item[], grow = false) => list.map((x, i) => ({ x, i })).sort((a, b) => (dishLast(a.x) - dishLast(b.x)) || (grow ? -1 : 1) * (sizePriority(a.x) - sizePriority(b.x)) || a.i - b.i).map((o) => o.x);
/** 휠라 폭 30 ~ 150 — 원본 휠라 모델은 30 미만이면 부품 일부가 고정 폭으로 남아 옆 장과 겹친다(폭 10 이 유로 하부 57 · 키친바흐 35 ·
 *  유로 상부 132mm 로 그려짐, 실측 2026-11-06). 최소 30(사용자 2026-11-09, 예전 10) */
export const FILL_MAX = 150, FILL_MIN = 30;
export interface NudgePlan { w: Map<Item, number>; t: Map<Item, number>; add: Item[]; remove: Item[] }
/** 미리 단위로 옮기기 — 줄 길이는 그대로, 한쪽은 delta 만큼 늘고 다른 쪽은 줄어든다.
 *  각 쪽에서 휠라류가 먼저 받고(0 ~ 150), 넘치거나 모자라면 가까운 장부터 하나씩 100 단위로 크기를 바꾼다(그 장 범위를 넘으면 다음 장).
 *  휠라는 30 ~ 150. 없는데 남는 폭이 있으면 줄 끝(벽 쪽)에 새로 넣고, 0 이 되면 뺀다. 안 되면 null */
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
      let Fg = F + left;
      // 남는 휠라가 30 미만이면 가까운 장을 그만큼 줄여 30 으로
      if (Fg > 0 && Fg < FILL_MIN) {
        let need = FILL_MIN - Fg;
        for (const x of byPriority(list)) {
          if (!need) break;
          const r = isFill(x) ? null : range(x);
          if (!r) continue;
          const w0 = plan.w.get(x) ?? x.w, nw = Math.max(r[0], w0 - need);
          if (nw < w0) { plan.w.set(x, nw); need -= w0 - nw; }
        }
        if (!need) Fg = FILL_MIN;
      }
      if (Fg > FILL_MAX || (Fg > 0 && Fg < FILL_MIN)) return null;
      const out = list.slice(), near = fills[fills.length - 1];
      for (const f of fills) if (f !== near || Fg < FILL_MIN) { plan.remove.push(f); out.splice(out.indexOf(f), 1); }
      if (Fg >= FILL_MIN) { if (near) plan.w.set(near, Fg); else { const nf = makeFill(Fg); plan.add.push(nf); out.push(nf); } }
      return out;
    }
    // 휠라는 최소 30 까지만 줄인다 — 더 줄여야 하면 장들이 받는다(휠라를 빼지 않는다, 사용자). 처음부터 휠라가 없던 줄은 예전처럼 0 도 된다
    const minF = F > 0 ? FILL_MIN : 0;
    let m = tot > FILL_MAX ? Math.ceil((tot - FILL_MAX) / 100) : tot < minF ? Math.floor((tot - minF) / 100) : 0;
    // 휠라가 없던 쪽에 남는 폭이 30 미만이면 장을 100 더 줄여 휠라를 넓힌다(예: 90 옮기면 휠라 10 대신 장 −200 · 휠라 110)
    if (tot - m * 100 > 0 && tot - m * 100 < FILL_MIN) m--;
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

/** 30 미만 휠라 고치기 — 같은 줄(빈틈없이 이어진 장)의 가까운 장을 줄여 휠라를 30 으로 넓히고(줄이는 순서 byPriority),
 *  안 되면 휠라를 빼고 옆 장들이 그 폭을 받는다(키우는 순서). 둘 다 안 되면 그대로. 자동 배치 끝맞춤 몇 mm · 고정 장 사이 좁은 틈,
 *  최소가 10 이던 때 저장한 설계가 남긴 것. 폭 0 휠라는 뺀다(벽 끝 후드장처럼 폭을 못 바꾸는 장만 있는 줄에서 끝맞춤이 남김 —
 *  원본 모델이 폭 0 으로도 고정 폭 부품을 그렸다). pick = 줄로 묶을 장(EP · 코너장 등 빼고). 고친 휠라 수 */
export function widenThinFills(items: Item[], range: (x: Item) => [number, number] | null, pick: (x: Item) => boolean): number {
  let n = 0;
  for (const f of items.filter((x) => /fill/.test(x.key) && x.w < FILL_MIN)) {
    if (f.w <= 0) { items.splice(items.indexOf(f), 1); n++; continue; }
    const group = rowGroup(items, f, (x) => x === f || pick(x));
    const k = group.indexOf(f);
    const near = group.filter((x) => x !== f && !/fill/.test(x.key)).sort((a, b) => Math.abs(group.indexOf(a) - k) - Math.abs(group.indexOf(b) - k));
    const take = (amount: number, grow: boolean): Map<Item, number> | null => {
      const plan = new Map<Item, number>();
      let rem = amount;
      for (const x of byPriority(near, grow)) {
        if (!rem) break;
        const r = range(x);
        if (!r) continue;
        const nw = grow ? Math.min(r[1], x.w + rem) : Math.max(r[0], x.w - rem);
        if (grow ? nw > x.w : nw < x.w) { plan.set(x, nw); rem -= Math.abs(nw - x.w); }
      }
      return rem ? null : plan;
    };
    let plan = take(FILL_MIN - f.w, false), drop = false;
    if (!plan) { plan = take(f.w, true); drop = !!plan; }
    if (!plan) continue;
    for (const [x, w] of plan) x.w = w;
    if (drop) items.splice(items.indexOf(f), 1); else f.w = FILL_MIN;
    let t = group[0].t;
    for (const x of group) { if (drop && x === f) continue; x.t = t; t += x.w; }
    n++;
  }
  return n;
}
