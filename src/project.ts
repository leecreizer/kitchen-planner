// 설계 묶음 — 설계(공간 · 구조 · 공간 요소 · 재질 · 선택)와 지금 배치안(장 하나하나 — 직접 고친 폭 · 교체 · 추가 · 빼기 · 옮김)을 함께.
// 설계 파일 저장 · 불러오기, 되돌리기 · 다시 하기(각 50번), 새로고침해도 고친 장이 남게 하는 자동 저장이 모두 이 묶음을 쓴다.
// 배치안의 줄(frame)은 같은 객체인지로 비교한다(kitchen3d 벽 찾기 · reorder 줄 고르기) — 저장할 땐 번호로, 불러올 땐 같은 객체로 되살린다
import type { Candidate, Frame } from './autoplan';
import { normalizeDesign, type Design } from './plan';

export const FILE_KIND = 'kitchen-planner/design';
export const FILE_VERSION = 1;
export interface Snapshot { design: Design; plan: Candidate | null }

type Packed = Omit<Candidate, 'items' | 'counters' | 'splashes' | 'island'> & {
  frames: Frame[];
  items: (Omit<Candidate['items'][number], 'frame'> & { frame: number })[];
  counters: (Omit<Candidate['counters'][number], 'frame'> & { frame: number })[];
  splashes: (Omit<Candidate['splashes'][number], 'frame'> & { frame: number })[];
  island?: Omit<NonNullable<Candidate['island']>, 'frame'> & { frame: number };
};

/** 화면 상태일 뿐인 원본 변수 — 폴딩 문 열림(DROP)은 문 열기 버튼을 따른다. 설계가 아니라 저장 · 되돌리기에서 뺀다 */
const VIEW_OV = new Set(['DROP']);
const designOv = (ov?: Record<string, string>) => {
  if (!ov) return ov;
  const out = Object.fromEntries(Object.entries(ov).filter(([k]) => !VIEW_OV.has(k)));
  return Object.keys(out).length ? out : undefined;
};
function pack(c: Candidate): Packed {
  const frames: Frame[] = [], idx = new Map<Frame, number>();
  const ref = (f: Frame) => { let i = idx.get(f); if (i === undefined) { i = frames.length; frames.push(f); idx.set(f, i); } return i; };
  return {
    ...c,
    items: c.items.map((x) => ({ ...x, ov: designOv(x.ov), frame: ref(x.frame) })),
    counters: c.counters.map((x) => ({ ...x, frame: ref(x.frame) })),
    splashes: c.splashes.map((x) => ({ ...x, frame: ref(x.frame) })),
    island: c.island ? { ...c.island, frame: ref(c.island.frame) } : undefined,
    frames,
  };
}
function unpack(p: Packed): Candidate {
  const frames = p.frames.map((f) => ({ o: [f.o[0], f.o[1]], dir: [f.dir[0], f.dir[1]], n: [f.n[0], f.n[1]] }) as Frame);
  const at = (i: number) => { const f = frames[i]; if (!f) throw new Error(`배치안의 줄 번호 ${i} 가 없습니다`); return f; };
  const { frames: _f, ...rest } = p;
  void _f;
  return {
    ...rest,
    items: p.items.map((x) => ({ ...x, frame: at(x.frame) })),
    counters: p.counters.map((x) => ({ ...x, frame: at(x.frame) })),
    splashes: p.splashes.map((x) => ({ ...x, frame: at(x.frame) })),
    island: p.island ? { ...p.island, frame: at(p.island.frame) } : undefined,
  } as Candidate;
}

/** 묶음 → 글(되돌리기 · 자동 저장용, 같은 상태면 같은 글이라 바뀌었는지 비교에도 쓴다) */
export function encode(s: Snapshot): string {
  return JSON.stringify({ design: s.design, plan: s.plan ? pack(s.plan) : null });
}
export function decode(text: string): Snapshot {
  const o = JSON.parse(text) as { design: Design; plan: Packed | null };
  return { design: normalizeDesign(o.design), plan: o.plan ? unpack(o.plan) : null };
}

/** 설계 파일 — 사람이 열어 봐도 무엇인지 알게 머리말(종류 · 판 · 저장 시각 · 요약)을 붙인다. bom = 견적 데이터(부품 목록, 읽기 전용 — 불러올 땐 쓰지 않는다) */
export function toFile(s: Snapshot, meta: { app: string; summary?: Record<string, unknown>; bom?: unknown[]; settings?: unknown }): string {
  return JSON.stringify({
    kind: FILE_KIND, version: FILE_VERSION, app: meta.app, savedAt: new Date().toISOString(), summary: meta.summary,
    design: s.design, plan: s.plan ? pack(s.plan) : null, bom: meta.bom,
    // 그때의 조명 · 후처리 — 참고용(같은 화면 재현 · 문의할 때). 불러올 땐 적용하지 않는다
    settings: meta.settings,
  }, null, 1);
}
export function fromFile(text: string): Snapshot {
  let o: { kind?: string; version?: number; design?: Design; plan?: Packed | null };
  try { o = JSON.parse(text); } catch { throw new Error('설계 파일이 아닙니다 (JSON 형식이 아님)'); }
  if (o.kind !== FILE_KIND) throw new Error('부엌 설계 파일이 아닙니다');
  if ((o.version ?? 0) > FILE_VERSION) throw new Error(`더 새 판(${o.version})의 설계 파일입니다 — 플래너를 갱신해 주세요`);
  if (!o.design?.room) throw new Error('설계 파일에 공간 정보가 없습니다');
  return { design: normalizeDesign(o.design), plan: o.plan ? unpack(o.plan) : null };
}

/** 되돌리기 · 다시 하기 — 바뀐 상태를 글로 쌓는다. 각 최대 LIMIT 개 */
export class History {
  undo: string[] = [];
  redo: string[] = [];
  /** 지금 화면 상태(마지막으로 기록한 글) */
  last: string | null = null;
  constructor(readonly limit = 50) {}
  /** 새 상태 — 바뀌었으면 이전 상태를 되돌리기에 쌓고 다시 하기는 비운다. 처음 기록은 쌓지 않는다 */
  record(s: string): boolean {
    if (s === this.last) return false;
    if (this.last !== null) { this.undo.push(this.last); if (this.undo.length > this.limit) this.undo.shift(); this.redo.length = 0; }
    this.last = s;
    return true;
  }
  /** 쌓지 않고 지금 상태만 맞춘다 — 되돌린 상태를 그리면서 생긴 사소한 차이(기본값 채움 등)를 새 단계로 보지 않게 */
  sync(s: string) { this.last = s; }
  back(): string | null {
    const s = this.undo.pop(); if (s === undefined) return null;
    if (this.last !== null) { this.redo.push(this.last); if (this.redo.length > this.limit) this.redo.shift(); }
    this.last = s; return s;
  }
  forward(): string | null {
    const s = this.redo.pop(); if (s === undefined) return null;
    if (this.last !== null) { this.undo.push(this.last); if (this.undo.length > this.limit) this.undo.shift(); }
    this.last = s; return s;
  }
}
