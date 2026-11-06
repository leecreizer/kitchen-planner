// 평면도 (SVG, mm) — 방 · 장 배치 · 개구부. 개구부 몸통을 끌면 벽을 따라(다른 벽으로도) 옮겨지고, 양 끝 손잡이로 폭을 바꾼다.
import type { Candidate, Frame, Item } from './autoplan';
import { slotMovable } from './reorder';
import { BASE_D, WALL_D } from './autoplan';
import { chairSpots, diningOf, diningPose } from './dining3d';
import { ISLAND_TABLE } from './plan';
import { livingOf, OPENING_INFO, clampOpening, nearestWall, wallFrame, wallName, wallLength, type Design, type FixKey, type Opening, type WallId } from './plan';
import { flowOf, type FlowInfo } from './flow';

const NS = 'http://www.w3.org/2000/svg';
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

export class PlanView {
  svg: SVGSVGElement;
  /** 돌린 그림 묶음 — 마우스 좌표도 이것 기준 */
  private root?: SVGGElement;
  private angle = 0;
  /** 동선 정보 겹쳐 그리기 — 작업 삼각형 변 길이 · 통로 폭 · 이동 경로(flow.ts). 요약은 flowBox 에 */
  showFlow = true;
  flowBox?: HTMLElement;
  selected: string | null = null;
  onChange?: (id: string, o: Partial<Opening>, done: boolean) => void;
  onSelect?: (id: string | null) => void;
  /** 아일랜드 끌기 (가운데 mm) · 90° 돌리기 */
  onIsland?: (x: number, z: number, done: boolean) => void;
  onIslandRotate?: () => void;
  /** 공간(부엌 바닥 · 거실 · 벽 너머 방)을 눌렀다 뗌 — 그 공간 범위(도면 mm, x0 z0 x1 z1). 3D 카메라가 그 공간을 꽉 차게 잡는다 */
  onSpace?: (box: [number, number, number, number]) => void;
  /** 아일랜드를 눌렀다 뗌 — 고르기 */
  onPickIsland?: () => void;
  islandPicked = false;
  /** 하부장 끌기 — 지금 마우스 점 · 누른 점 (mm). 받는 쪽이 옆 장 사이에 끼워 넣는다 */
  onDragItem?: (item: Item, p: [number, number], p0: [number, number], done: boolean) => void;
  /** 장 고르기 */
  onPickItem?: (item: Candidate['items'][number] | null) => void;
  /** 벽 고르기 (트인 벽 포함) */
  onPickWall?: (w: WallId) => void;
  pickedWall: WallId | null = null;
  picked: Candidate['items'][number] | null = null;
  private itemDrag?: { item: Item; p0: [number, number]; p: [number, number]; moved: boolean };
  /** 누른 화면 점 — 4px 넘게 움직여야 끌기 시작(누르기만 하면 고르기) */
  private downAt = { x: 0, y: 0 };
  private far(e: PointerEvent) { return Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) >= 4; }
  private drag?: { id: string; mode: 'move' | 'a' | 'b'; offset: number; start: Opening; moved: boolean };
  private islDrag?: { dx: number; dz: number; x: number; z: number; moved: boolean };
  private d?: Design; private c?: Candidate | null;
  /* 확대 · 축소 · 이동 — base = 방 전체가 맞게 들어오는 보기 범위, k = 배율, ox · oy = 가운데 이동(도면 단위 mm) */
  private base = { x: 0, y: 0, w: 1, h: 1 };
  private view = { k: 1, ox: 0, oy: 0 };
  private pan?: { x: number; y: number; ox: number; oy: number; moved: boolean; clear: boolean; space?: Element };
  private applyView() {
    const { x, y, w, h } = this.base, { k, ox, oy } = this.view;
    const w2 = w / k, h2 = h / k, cx = x + w / 2 + ox, cy = y + h / 2 + oy;
    this.svg.setAttribute('viewBox', `${cx - w2 / 2} ${cy - h2 / 2} ${w2} ${h2}`);
  }
  /** 화면 1px 이 도면 몇 mm 인지 */
  private unitPerPx() { const m = this.svg.getScreenCTM(); return m ? 1 / m.a : 1; }
  /** 처음 보기(방 전체 맞춤) */
  fit() { this.view = { k: 1, ox: 0, oy: 0 }; this.applyView(); }
  zoomBy(f: number, at?: { x: number; y: number }) {
    const k0 = this.view.k, k1 = Math.max(0.5, Math.min(10, k0 * f));
    if (k1 === k0) return;
    // 커서 아래 점이 그대로 있게 — 확대 전 · 후 그 점의 도면 좌표 차이만큼 가운데를 옮긴다
    if (at) {
      const r = this.svg.getBoundingClientRect(), u = this.unitPerPx();
      const dx = (at.x - (r.left + r.width / 2)) * u, dy = (at.y - (r.top + r.height / 2)) * u;
      this.view.ox += dx - dx * (k0 / k1); this.view.oy += dy - dy * (k0 / k1);
    }
    this.view.k = k1; this.applyView();
  }

  constructor(host: HTMLElement) {
    this.svg = el('svg', { class: 'plan-svg' }) as SVGSVGElement;
    host.append(this.svg);
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    // 빈 곳(바닥 · 바깥)을 누르면 — 끌면 화면 이동, 그냥 떼면 선택 해제. 오른쪽 · 가운데 버튼은 어디서든 화면 이동
    this.svg.addEventListener('pointerdown', (e) => {
      const cl = (e.target as Element).classList;
      // 공간 도형 — 부엌 바닥 · 거실 · 벽 너머 방(이름 글자 포함)
      const space = cl?.contains('p-floor') || cl?.contains('p-living') || cl?.contains('p-side') ? e.target as Element
        : cl?.contains('p-livingname') ? this.svg.querySelector('.p-living') : null;
      const bg = e.target === this.svg || !!space || cl?.contains('p-wall');
      if (e.button === 1 || e.button === 2 || (e.button === 0 && bg)) {
        this.pan = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy, moved: false, clear: e.button === 0, space: space ?? undefined };
        try { this.svg.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
        if (e.button !== 0) { e.preventDefault(); e.stopPropagation(); }
      }
    }, true);
    this.svg.addEventListener('contextmenu', (e) => e.preventDefault());
    this.svg.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, { x: e.clientX, y: e.clientY }); }, { passive: false });
    this.svg.addEventListener('dblclick', (e) => { const t = e.target as Element; if (t === this.svg || t.classList?.contains('p-floor') || t.classList?.contains('p-wall')) this.fit(); });
  }

  private pt(e: PointerEvent): [number, number] {
    const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
    const q = p.matrixTransform((this.root ?? this.svg).getScreenCTM()!.inverse());
    return [q.x, q.y];
  }

  render(d: Design, c: Candidate | null) { this.d = d; this.c = c; this.draw(); }

  private draw() {
    const d = this.d; if (!d) return;
    const r = d.room, top = this.svg;
    top.replaceChildren();
    const side = Math.max(0, ...d.openings.map((o) => o.depth ?? 0)), m = 400 + side;
    // 거실(T자) — 트인 벽 너머 직사각형
    const lvPts: number[][] = [];
    if (d.openWall != null) {
      const f = wallFrame(r, d.openWall), L = wallLength(r, d.openWall);
      const Q = (t: number, u: number) => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
      const T = 150, lv = livingOf(d), D = lv.depth;
      lvPts.push(Q(-lv.a - T, 0), Q(L + lv.b + T, 0), Q(L + lv.b + T, -2 * T - D), Q(-lv.a - T, -2 * T - D));
    }
    // 트인 쪽(거실)이 아래 — 왼쪽 벽 -90 · 오른쪽 90 · 뒷벽 180 · 앞벽 0
    this.angle = d.openWall == null ? 0 : ({ 0: 180, 1: 90, 2: 0, 3: -90 } as const)[d.openWall];
    const swap = Math.abs(this.angle) === 90;
    // 보기 범위 — 방 · 거실 꼭짓점을 돌린 뒤의 경계
    const rad = this.angle * Math.PI / 180, cx = r.w / 2, cz = r.d / 2;
    const all = [[-m, -m], [r.w + m, -m], [r.w + m, r.d + m], [-m, r.d + m], ...lvPts.map(([x, z]) => [x, z])];
    const rp = all.map(([x, z]) => [cx + (x - cx) * Math.cos(rad) - (z - cz) * Math.sin(rad), cz + (x - cx) * Math.sin(rad) + (z - cz) * Math.cos(rad)]);
    const minX = Math.min(...rp.map((p) => p[0])) - 150, maxX = Math.max(...rp.map((p) => p[0])) + 150;
    const minY = Math.min(...rp.map((p) => p[1])) - 150, maxY = Math.max(...rp.map((p) => p[1])) + 150;
    void swap;
    this.base = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    this.applyView();
    const svg = el('g', { transform: `rotate(${this.angle} ${r.w / 2} ${r.d / 2})` }, top) as SVGGElement;
    this.root = svg;
    // 벽 너머 공간
    for (const o of d.openings) {
      if (!o.depth) continue;
      const f = wallFrame(r, o.wall);
      const a = [f.o[0] + f.dir[0] * (o.t - 300), f.o[1] + f.dir[1] * (o.t - 300)];
      const pts = [[0, 0], [o.w + 600, 0], [o.w + 600, -o.depth - 150], [0, -o.depth - 150]].map(([t, u]) => [a[0] + f.dir[0] * t + f.n[0] * (u - 0), a[1] + f.dir[1] * t + f.n[1] * (u - 0)]);
      el('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: 'p-side', style: `--c:${OPENING_INFO[o.kind].color}` }, svg);
      const mid = [a[0] + f.dir[0] * (o.w / 2 + 300) - f.n[0] * (o.depth / 2 + 150), a[1] + f.dir[1] * (o.w / 2 + 300) - f.n[1] * (o.depth / 2 + 150)];
      const t = el('text', { x: mid[0], y: mid[1], class: 'p-sidelabel' }, svg); t.textContent = OPENING_INFO[o.kind].label;
    }
    if (lvPts.length) {
      el('polygon', { points: lvPts.map((p) => p.join(',')).join(' '), class: 'p-wall' }, svg);
      const f = wallFrame(r, d.openWall!), L = wallLength(r, d.openWall!);
      const Q = (t: number, u: number) => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
      const T = 150, lv = livingOf(d), D = lv.depth, sa = lv.a, sb = lv.b, LW = L + sa + sb;
      el('polygon', { points: [Q(-sa, -T), Q(L + sb, -T), Q(L + sb, -T - D), Q(-sa, -T - D)].map((p) => p.join(',')).join(' '), class: 'p-living' }, svg);
      const ww = Math.min(LW - 1200, 4200), w0 = (LW - ww) / 2 - sa;
      const wa = Q(w0, -T * 1.5 - D), wb = Q(w0 + ww, -T * 1.5 - D);
      el('line', { x1: wa[0], y1: wa[1], x2: wb[0], y2: wb[1], class: 'p-opline p-window', style: '--c:#4f8fd6' }, svg);
      const lp = Q((L + sb - sa) / 2, -T - D / 2);
      const lt = el('text', { x: lp[0], y: lp[1], class: 'p-livingname' }, svg); lt.textContent = '거실';
      // 거실 벽 고르기 띠 — 맞은편(10) · 양옆(11 · 12) · 부엌 쪽 어깨(15 · 16). 부엌과 이어진 통로는 벽이 아니라 고르지 않는다
      const band = (id: number, a: number[], b: number[]) => {
        const hl = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: `p-wallhit${this.pickedWall === id ? ' on' : ''}` }, svg);
        hl.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pickedWall = id as WallId; this.onPickWall?.(id as WallId); this.draw(); });
      };
      band(10, Q(-sa, -T * 1.5 - D), Q(L + sb, -T * 1.5 - D));
      band(11, Q(-sa - T / 2, -T), Q(-sa - T / 2, -T - D));
      band(12, Q(L + sb + T / 2, -T), Q(L + sb + T / 2, -T - D));
      if (sa + d.wing.a > 1) band(15, Q(-sa, -T / 2), Q(d.wing.a, -T / 2));
      if (sb + d.wing.b > 1) band(16, Q(L - d.wing.b, -T / 2), Q(L + sb, -T / 2));
    }
    el('rect', { x: -75, y: -75, width: r.w + 150, height: r.d + 150, class: 'p-wall' }, svg);
    el('rect', { x: 0, y: 0, width: r.w, height: r.d, class: 'p-floor' }, svg);
    // 장
    const quad = (f: Frame, t: number, w: number, u0: number, u1: number) => [[t, u0], [t + w, u0], [t + w, u1], [t, u1]]
      .map(([a, u]) => `${f.o[0] + f.dir[0] * a + f.n[0] * u},${f.o[1] + f.dir[1] * a + f.n[1] * u}`).join(' ');
    if (this.c) {
      for (const ct of this.c.counters) el('polygon', { points: quad(ct.frame, ct.t0, ct.t1 - ct.t0, ct.z0, ct.z1), class: 'p-counter' }, svg);
      for (const it of this.c.items) {
        if (it.level === 'wall' || it.level === 'shelf') continue;
        // 코너 팬트리장은 ㄱ자 — 이 줄 쪽 날개(깊이 590) + 다음 벽 쪽 날개(430~1000, 깊이 1000)
        const pts = it.key === 'pantryCorner'
          ? [[0, 0], [1000, 0], [1000, 1000], [430, 1000], [430, 590], [0, 590]].map(([a, u]) => `${it.frame.o[0] + it.frame.dir[0] * (it.t + a) + it.frame.n[0] * u},${it.frame.o[1] + it.frame.dir[1] * (it.t + a) + it.frame.n[1] * u}`).join(' ')
          : quad(it.frame, it.t, it.w, 0, it.key === 'islandOpen' ? 450 : BASE_D - 10);
        const pg = el('polygon', { points: pts, class: `p-cab p-${it.level}${it.tag ? ' p-' + it.tag : ''}${it === this.picked ? ' picked' : ''}` }, svg);
        pg.addEventListener('pointerdown', (e) => {
          if (slotMovable(it)) { this.downItem(e as PointerEvent, it); return; }
          e.stopPropagation(); this.picked = it; this.onPickItem?.(it); this.draw();
        });
        if (slotMovable(it)) pg.classList.add('p-move');
      }
      for (const it of this.c.items) if (it.level === 'wall' || it.level === 'shelf') el('polygon', { points: quad(it.frame, it.t, it.w, 0, it.level === 'shelf' ? 200 : WALL_D), class: `p-upper p-${it.level}${/fill/.test(it.key) ? ' p-ufill' : ''}${it === this.picked ? ' picked' : ''}` }, svg);
      const sym = (p: [number, number] | undefined, cls: string, txt: string, key?: FixKey) => {
        if (!p) return;
        const g = el('g', { class: key ? 'p-fix' : '' }, svg);
        el('circle', { cx: p[0], cy: p[1], r: 130, class: cls }, g);
        const t = el('text', { x: p[0], y: p[1], class: 'p-symtxt' }, g); t.textContent = txt;
        const it = key && this.c!.items.find((i) => i.tag === key);
        if (it) g.addEventListener('pointerdown', (e) => this.downItem(e as PointerEvent, it));
      };
      if (this.c.sink && this.c.hob && this.c.fridge) el('polygon', { points: [this.c.sink, this.c.hob, this.c.fridge].map((p) => p.join(',')).join(' '), class: 'p-tri' }, svg);
      sym(this.c.sink, 'p-sym p-sinks', '싱크', 'sink'); sym(this.c.hob, 'p-sym p-hobs', '쿡탑', 'hob'); sym(this.c.fridge, 'p-sym p-fridges', '냉장고');
      const dish = this.c.items.find((x) => x.tag === 'dish');
      if (dish) { const f = dish.frame; sym([f.o[0] + f.dir[0] * (dish.t + dish.w / 2) + f.n[0] * 300, f.o[1] + f.dir[1] * (dish.t + dish.w / 2) + f.n[1] * 300], 'p-sym p-dishs', '식세', 'dish'); }
      // 아일랜드 — 끌어서 옮기기 · ↻ 로 90° 돌리기 (장 줄 앞에 끝을 대면 코너장으로 이어 붙음)
      const isl = this.c.island, ct = this.c.counters.find((x) => x.island);
      if (isl && ct) {
        const body = el('polygon', { points: quad(ct.frame, ct.t0, ct.t1 - ct.t0, ct.z0 - 20, ct.z1), class: `p-isl${isl.attached != null ? ' att' : ''}${this.islandPicked ? ' sel' : ''}` }, svg);
        body.addEventListener('pointerdown', (e) => this.downIsland(e as PointerEvent, isl.cx, isl.cz));
        const f = isl.frame;
        const rp = [f.o[0] + f.dir[0] * isl.len / 2 + f.n[0] * 300, f.o[1] + f.dir[1] * isl.len / 2 + f.n[1] * 300];
        const rot = el('g', { class: 'p-rot' }, svg);
        el('circle', { cx: rp[0], cy: rp[1], r: 150 }, rot);
        const t = el('text', { x: rp[0], y: rp[1] }, rot); t.textContent = '↻';
        rot.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onIslandRotate?.(); });
        // 연계형 · 원형 식탁 — 붙지 않은 끝(3D 와 같은 자리)
        if (isl.style === 'table' || isl.style === 'round') {
          const zc = (ct.z0 + ct.z1) / 2, e = isl.attachedEnd === 1 ? 0 : 1, sx = e === 1 ? 1 : -1, x0 = e === 1 ? isl.len : 0;
          if (isl.style === 'table') {
            const L = ISLAND_TABLE.len, W = ISLAND_TABLE.w;
            el('polygon', { points: quad(f, Math.min(x0, x0 + sx * L), L, zc - W / 2, zc + W / 2), class: 'p-table' }, svg);
          } else {
            const R = ISLAND_TABLE.round / 2, xm = x0 + sx * (R - ISLAND_TABLE.overlap);
            el('circle', { cx: f.o[0] + f.dir[0] * xm + f.n[0] * zc, cy: f.o[1] + f.dir[1] * xm + f.n[1] * zc, r: R, class: 'p-table' }, svg);
          }
        }
      }
      // 식탁 · 의자 — 3D 와 같은 자리 · 방향(평면 x = 3D x, 평면 y = 3D z)
      const set = d.dining?.on ? diningOf(d) : undefined;
      if (set) {
        const p = diningPose(d, set), c = Math.cos(p.ry), s = Math.sin(p.ry);
        const g = el('g', { class: 'p-dining', transform: `translate(${p.x} ${p.z}) matrix(${c} ${-s} ${s} ${c} 0 0)` }, svg);
        const [W, D] = set.size;
        if (set.shape === 'round') el('circle', { cx: 0, cy: 0, r: W / 2, class: 'p-table' }, g);
        else if (set.shape === 'oval') el('ellipse', { cx: 0, cy: 0, rx: W / 2, ry: D / 2, class: 'p-table' }, g);
        else el('rect', { x: -W / 2, y: -D / 2, width: W, height: D, rx: 30, class: 'p-table' }, g);
        const [cw, cdp] = set.chair.size;
        for (const sp of chairSpots(set)) {
          const deg = (-sp.face * 180) / Math.PI;
          el('rect', { x: -cw / 2, y: -cdp / 2, width: cw, height: cdp, rx: 60, class: 'p-chair', transform: `translate(${sp.x} ${sp.z}) rotate(${deg})` }, g);
        }
      }
    }
    // 개구부
    for (const o of d.openings) this.drawOpening(o);
    // 거실 쪽 — 벽 대신 트인 표시 · 날개벽(벽 두께 150 으로 그림)
    if (d.openWall != null) {
      const f = wallFrame(r, d.openWall), L = wallLength(r, d.openWall);
      const Q = (t: number, u: number) => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
      const a = Q(d.wing.a, -75), b = Q(L - d.wing.b, -75);
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'p-gapline' }, svg);
      const mp = Q(L / 2, -260);
      const t = el('text', { x: mp[0], y: mp[1], class: 'p-livingtxt' }, svg); t.textContent = '거실 쪽 (트임)';
      for (const [t0, t1, len] of [[0, d.wing.a, d.wing.a], [L - d.wing.b, L, d.wing.b]] as const) {
        if (len <= 0) continue;
        const pts = [Q(t0, 0), Q(t1, 0), Q(t1, -150), Q(t0, -150)].map((p) => p.join(',')).join(' ');
        el('polygon', { points: pts, class: 'p-wing' }, svg);
        const lp = Q((t0 + t1) / 2, 200);
        const lt = el('text', { x: lp[0], y: lp[1], class: 'p-dist' }, svg); lt.textContent = `${len} · 두께 150`;
      }
    }
    // 벽 고르기 띠 (벽 바깥 150)
    for (const w of ([0, 1, 2, 3] as WallId[]).filter((x) => x !== d.openWall)) {
      const f = wallFrame(r, w), L = wallLength(r, w);
      const a = [f.o[0] - f.n[0] * 75, f.o[1] - f.n[1] * 75], b = [a[0] + f.dir[0] * L, a[1] + f.dir[1] * L];
      const hl = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: `p-wallhit${this.pickedWall === w ? ' on' : ''}` }, svg);
      hl.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pickedWall = w; this.onPickWall?.(w); this.draw(); });
    }
    // 치수
    const dim = (x: number, y: number, txt: string, rot = 0) => { const t = el('text', { x, y, class: 'p-dim', transform: rot ? `rotate(${rot} ${x} ${y})` : '' }, svg); t.textContent = txt; };
    dim(r.w / 2, -m + 170, `${r.w}`); dim(-m + 170, r.d / 2, `${r.d}`, -90);
    for (const w of ([0, 1, 2, 3] as WallId[]).filter((x) => x !== d.openWall)) {
      const f = wallFrame(r, w), L = wallLength(r, w);
      const p = [f.o[0] + f.dir[0] * L / 2 - f.n[0] * 230, f.o[1] + f.dir[1] * L / 2 - f.n[1] * 230];
      const t = el('text', { x: p[0], y: p[1], class: 'p-wallname', transform: w % 2 ? `rotate(${w === 1 ? 90 : -90} ${p[0]} ${p[1]})` : '' }, svg); t.textContent = wallName(d.openWall, w);
    }
    this.drawFlow(top, svg);
    this.uprightText();
  }

  /** 동선 정보 — ① 작업 삼각형 변 길이 ② 통로 폭(치수선) ③ 이동 경로(거실 → 냉장고 → 싱크 → 쿡탑, 화살표 · 번호). 눌러지지 않는 겹친 층 */
  private drawFlow(top: SVGSVGElement, svg: SVGGElement) {
    const fl: FlowInfo | null = this.c && this.d ? flowOf(this.d, this.c) : null;
    if (this.flowBox) {
      const n = (v: number) => v.toLocaleString('ko-KR');
      this.flowBox.innerHTML = !fl ? '' : [
        fl.legs.length === 3 ? `<span class="${fl.triOk ? '' : 'bad'}" title="권장: 각 변 1,200~2,700 · 합 4,000~7,900">작업 삼각형 <b>${n(fl.triTotal)}</b> <small>(${fl.legs.map((l) => `<i class="${l.ok ? '' : 'bad'}">${n(l.len)}</i>`).join(' · ')})</small></span>` : '',
        fl.minAisle != null ? `<span class="${fl.minAisle < 900 ? 'bad' : ''}" title="900 미만 좁음 · 1,070 이상 작업 통로 · 1,220 이상 2인 작업">통로 최소 <b>${n(fl.minAisle)}</b></span>` : '',
        fl.path.length > 1 ? `<span class="${fl.blocked ? 'bad' : ''}" title="${fl.stops.map((s) => s.label).join(' → ')}">이동 <b>${(fl.pathLen / 1000).toFixed(1)}m</b>${fl.blocked ? ' (막힌 곳 있음)' : ''}</span>` : '',
      ].filter(Boolean).join('');
    }
    if (!fl || !this.showFlow) return;
    // 화살촉
    const defs = el('defs', {}, top);
    const mk = el('marker', { id: 'p-arrow', viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }, defs);
    el('path', { d: 'M0,1 L9,5 L0,9 z', class: 'p-arrowhead' }, mk);
    const g = el('g', { class: 'p-flow' }, svg);
    // ③ 이동 경로 — 구간마다 화살표
    for (let k = 1; k < fl.path.length; k++) {
      const [a, b] = [fl.path[k - 1], fl.path[k]];
      el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: `p-path${fl.blocked ? ' blocked' : ''}`, 'marker-end': 'url(#p-arrow)' }, g);
    }
    fl.stops.forEach((s, k) => {
      el('circle', { cx: s.p[0], cy: s.p[1], r: 95, class: 'p-stop' }, g);
      const t = el('text', { x: s.p[0], y: s.p[1], class: 'p-stoptxt' }, g); t.textContent = String(k + 1);
    });
    // ① 작업 삼각형 — 변 가운데 길이
    for (const l of fl.legs) {
      const m = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
      const t = el('text', { x: m[0], y: m[1], class: `p-leg${l.ok ? '' : ' bad'}` }, g); t.textContent = l.len.toLocaleString('ko-KR');
    }
    // ② 통로 폭 — 치수선 · 양 끝 눈금 · 값
    for (const a of fl.aisles) {
      el('line', { x1: a.a[0], y1: a.a[1], x2: a.b[0], y2: a.b[1], class: `p-aisle ${a.grade}` }, g);
      const dx = a.b[0] - a.a[0], dz = a.b[1] - a.a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * 60, nz = dx / L * 60;
      for (const p of [a.a, a.b]) el('line', { x1: p[0] - nx, y1: p[1] - nz, x2: p[0] + nx, y2: p[1] + nz, class: `p-aisle ${a.grade}` }, g);
      const t = el('text', { x: (a.a[0] + a.b[0]) / 2, y: (a.a[1] + a.b[1]) / 2, class: `p-aisletxt ${a.grade}` }, g); t.textContent = a.w.toLocaleString('ko-KR');
    }
  }

  /** 돌린 그림 속 글자를 똑바로 */
  private uprightText() {
    if (!this.root || !this.angle) return;
    for (const t of this.root.querySelectorAll('text')) {
      const x = t.getAttribute('x'), y = t.getAttribute('y');
      t.setAttribute('transform', `rotate(${-this.angle} ${x} ${y})`);
    }
  }

  private drawOpening(o: Opening) {
    const d = this.d!, svg = this.root ?? this.svg, f = wallFrame(d.room, o.wall);
    const P = (t: number, u: number) => [f.o[0] + f.dir[0] * t + f.n[0] * u, f.o[1] + f.dir[1] * t + f.n[1] * u];
    const g = el('g', { class: `p-op${this.selected === o.id ? ' sel' : ''}`, style: `--c:${OPENING_INFO[o.kind].color}` }, svg);
    const a = P(o.t, 0), b = P(o.t + o.w, 0);
    el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'p-gap' }, g);
    el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: `p-opline p-${o.kind}` }, g);
    if (o.kind === 'door') {
      const h = P(o.t, 0), e = P(o.t, -o.w), tip = P(o.t + o.w, 0);
      el('path', { d: `M${h[0]},${h[1]} L${e[0]},${e[1]} A${o.w},${o.w} 0 0 ${1} ${tip[0]},${tip[1]}`, class: 'p-swing' }, g);
    }
    // 끌기 몸통
    const body = el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'p-hit' }, g);
    body.addEventListener('pointerdown', (e) => this.down(e as PointerEvent, o, 'move'));
    if (this.selected === o.id) {
      for (const [k, p] of [['a', a], ['b', b]] as const) {
        const hnd = el('circle', { cx: p[0], cy: p[1], r: 90, class: 'p-handle' }, g);
        hnd.addEventListener('pointerdown', (e) => this.down(e as PointerEvent, o, k));
      }
      const m = P(o.t + o.w / 2, 380);
      const t = el('text', { x: m[0], y: m[1], class: 'p-optxt' }, g); t.textContent = `${o.w}`;
      // 양옆 벽까지 거리 — 치수선 + 숫자
      const WL = wallLength(d.room, o.wall);
      for (const [a0, a1] of [[0, o.t], [o.t + o.w, WL]] as const) {
        if (a1 - a0 < 1) continue;
        const p0 = P(a0, 250), p1 = P(a1, 250), mm = P((a0 + a1) / 2, 380);
        el('line', { x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], class: 'p-opdim' }, g);
        const dt = el('text', { x: mm[0], y: mm[1], class: 'p-opdimtxt' }, g); dt.textContent = `${Math.round(a1 - a0)}`;
      }
      const L = wallLength(d.room, o.wall);
      const ta = P(o.t / 2, 220), tb = P(o.t + o.w + (L - o.t - o.w) / 2, 220);
      const t1 = el('text', { x: ta[0], y: ta[1], class: 'p-dist' }, g); t1.textContent = `${Math.round(o.t)}`;
      const t2 = el('text', { x: tb[0], y: tb[1], class: 'p-dist' }, g); t2.textContent = `${Math.round(L - o.t - o.w)}`;
    }
  }

  private down(e: PointerEvent, o: Opening, mode: 'move' | 'a' | 'b') {
    e.stopPropagation();
    this.selected = o.id; this.onSelect?.(o.id);
    const [x, z] = this.pt(e);
    const nw = nearestWall(this.d!.room, x, z, this.d!.openWall);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.drag = { id: o.id, mode, offset: nw.wall === o.wall ? nw.t - o.t : o.w / 2, start: { ...o }, moved: false };
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
    this.draw();
  }
  private downItem(e: PointerEvent, it: Item) {
    e.stopPropagation();
    this.downAt = { x: e.clientX, y: e.clientY };
    const p = this.pt(e);
    this.itemDrag = { item: it, p0: p, p, moved: false };
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
  }
  private downIsland(e: PointerEvent, cx: number, cz: number) {
    e.stopPropagation();
    const [x, z] = this.pt(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.islDrag = { dx: cx - x, dz: cz - z, x: cx, z: cz, moved: false };
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
  }
  private move(e: PointerEvent) {
    if (this.pan) {
      if (!this.pan.moved && Math.hypot(e.clientX - this.pan.x, e.clientY - this.pan.y) < 4) return;
      this.pan.moved = true;
      const u = this.unitPerPx();
      this.view.ox = this.pan.ox - (e.clientX - this.pan.x) * u; this.view.oy = this.pan.oy - (e.clientY - this.pan.y) * u;
      this.applyView();
      return;
    }
    if (this.itemDrag) {
      if (!this.itemDrag.moved && !this.far(e)) return;
      Object.assign(this.itemDrag, { p: this.pt(e), moved: true });
      this.onDragItem?.(this.itemDrag.item, this.itemDrag.p, this.itemDrag.p0, false);
      return;
    }
    if (this.islDrag) {
      if (!this.islDrag.moved && !this.far(e)) return;
      this.islDrag.moved = true;
      const [x, z] = this.pt(e);
      this.islDrag.x = Math.round((x + this.islDrag.dx) / 10) * 10; this.islDrag.z = Math.round((z + this.islDrag.dz) / 10) * 10;
      this.onIsland?.(this.islDrag.x, this.islDrag.z, false);
      return;
    }
    if (!this.drag) return;
    if (!this.drag.moved && !this.far(e)) return;
    this.drag.moved = true;
    const d = this.d!, o = d.openings.find((x) => x.id === this.drag!.id)!;
    const [x, z] = this.pt(e);
    const s = this.drag.start;
    const snap = (v: number) => Math.round(v / 10) * 10;
    let patch: Partial<Opening>;
    if (this.drag.mode === 'move') {
      const nw = nearestWall(d.room, Math.max(0, Math.min(d.room.w, x)), Math.max(0, Math.min(d.room.d, z)), d.openWall);
      patch = { wall: nw.wall, t: snap(nw.t - this.drag.offset) };
    } else {
      const f = wallFrame(d.room, s.wall);
      const t = (x - f.o[0]) * f.dir[0] + (z - f.o[1]) * f.dir[1];
      patch = this.drag.mode === 'a' ? { t: snap(Math.min(t, s.t + s.w - OPENING_INFO[s.kind].minW)), w: snap(s.t + s.w - Math.min(t, s.t + s.w - OPENING_INFO[s.kind].minW)) } : { w: snap(Math.max(OPENING_INFO[s.kind].minW, t - s.t)) };
    }
    const tmp = { ...o, ...patch }; clampOpening(tmp, d.room);
    this.onChange?.(o.id, { wall: tmp.wall, t: tmp.t, w: tmp.w }, false);
  }
  private up(e: PointerEvent) {
    if (this.pan) {
      const p = this.pan; this.pan = undefined;
      try { this.svg.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (!p.moved && p.clear) {
        // 고른 것이 있으면 해제만, 없으면 누른 공간으로 3D 시점 이동(사용자 2026-11-05 「공간 선택하면 해당 공간으로 이동 꽉 차게」)
        const had = !!(this.selected || this.picked || this.islandPicked || this.pickedWall != null);
        this.selected = null; this.picked = null; this.onSelect?.(null); this.onPickItem?.(null); this.draw();
        if (!had && p.space) {
          const xs: number[] = [], zs: number[] = [];
          if (p.space.tagName === 'rect') { const a = (k: string) => Number(p.space!.getAttribute(k)); xs.push(a('x'), a('x') + a('width')); zs.push(a('y'), a('y') + a('height')); }
          else for (const q of (p.space.getAttribute('points') ?? '').trim().split(/\s+/)) { const [x, z] = q.split(',').map(Number); xs.push(x); zs.push(z); }
          if (xs.length) this.onSpace?.([Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]);
        }
      }
      return;
    }
    if (this.itemDrag) {
      const f = this.itemDrag; this.itemDrag = undefined;
      try { this.svg.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (f.moved) this.onDragItem?.(f.item, f.p, f.p0, true);
      else { this.picked = f.item; this.onPickItem?.(f.item); this.draw(); }
      return;
    }
    if (this.islDrag) {
      const { x, z, moved } = this.islDrag; this.islDrag = undefined;
      try { this.svg.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
      if (moved) this.onIsland?.(x, z, true);
      else this.onPickIsland?.();
      return;
    }
    if (!this.drag) return;
    const { id, moved } = this.drag; this.drag = undefined;
    try { this.svg.releasePointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ }
    if (moved) this.onChange?.(id, {}, true);
  }
}
