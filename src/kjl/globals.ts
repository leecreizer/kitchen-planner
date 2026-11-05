import type { PmVar } from './types';

/**
 * 전역 변수(变量与数据 › 全局变量) — 쿠지알러 원본 형식 그대로.
 *  원본: POST /editor/api/site/globalinput/new → d.inputs[] (globalId · ignoreMode · tags · group · outputName …)
 *  ignoreMode 0 통일 제어(统一控制 — 숨김은 전역 변수 값) · 1 로컬 설정(本地设置 — 모델마다 숨김 지정)
 *  모델에는 같은 정의의 사본이 inputs 에 들어가고(globalId 로 연결), 모델마다 다른 것은 값(value)과 로컬 설정일 때 숨김(ignore)뿐.
 *  전역 변수의 값 유형에는 수식 · 고정 수식이 없다(번들 getParamTypeIdVisibleInfoList).
 */
export interface GlobalTag { tagId: number | string; content: string; usageCount?: number; libraryId?: number; obsLibraryId?: string; accountId?: number }
export interface GlobalGroup { obsId: string; name: string; serialNumber?: number; inputCount?: number }
/** 현재값·선택지 묶음 표시용 — 상품 id → 이름·이미지 (원본 응답 d.resource 에서) */
export interface GlobalRes { name: string; img?: string; kind: 'model' | 'texture' | 'package' }

export interface GlobalVar extends PmVar {
  globalId: number | string;
  ignoreMode?: number | null;
  outputName?: string | null;
  tags?: GlobalTag[] | null;
  group?: GlobalGroup | null;
  /* 원본에 있는 그 밖의 키 — 그대로 보관 */
  accountId?: number | null;
  nextId?: number | null;
  deleted?: unknown;
  libraryId?: number | null;
  boolean?: boolean;
  number?: boolean;
  string?: boolean;
  texture?: boolean;
  style?: boolean;
}

export interface GlobalMeta { groups: GlobalGroup[]; tags: GlobalTag[]; countLimit: number; resource: Record<string, GlobalRes> }

export const IGNORE_MODE = { unified: 0, local: 1 } as const;

/** 전역 변수 키 — 모델 사본의 globalId 와 비교 */
export const gid = (v: Pick<PmVar, 'id' | 'globalId'>) => String(v.globalId ?? v.id);

/** 전역 변수에만 있는 키 — 모델에 가져올 때 뺀다 */
const GLOBAL_ONLY = ['ignoreMode', 'outputName', 'tags', 'group', 'accountId', 'nextId', 'deleted', 'libraryId', 'boolean', 'number', 'string', 'texture', 'style', 'hideMode'] as const;

/** 모델에 넣을 사본 (모델 사본은 globalId 로 연결, groupTypeId 는 사용자 정의) */
export function modelCopy(g: GlobalVar, id: string): PmVar {
  const o: Record<string, unknown> = { ...g };
  for (const k of GLOBAL_ONLY) delete o[k];
  return { ...(o as unknown as PmVar), id, globalId: g.globalId, groupTypeId: 2 };
}

/**
 * 모델 사본 + 전역 정의 → 계산에 쓸 변수. 정의(이름·형식·선택지·범위)는 전역 변수, 값은 모델,
 * 숨김은 통일 제어면 전역 변수 · 로컬 설정이면 모델 (번들 getCurrentParamState: ignoreMode===0 → ignore = 전역).
 */
export function mergeGlobal(v: PmVar, g: GlobalVar | undefined): PmVar {
  if (!g) return v;
  const def = modelCopy(g, v.id);
  return { ...def, groupTypeId: v.groupTypeId, globalId: v.globalId, value: v.value, ignore: (g.ignoreMode ?? 0) === IGNORE_MODE.unified ? g.ignore : v.ignore ?? g.ignore };
}

/** 저장본 정리 — 예전 형식 전역 변수(hideMode, id 만)를 원본 형식으로 */
export function normalizeGlobal(raw: unknown): GlobalVar {
  const v = raw as GlobalVar & { hideMode?: 'unified' | 'local' };
  const { hideMode, ...rest } = v;
  return {
    ...rest,
    globalId: v.globalId ?? v.id,
    id: String(v.globalId ?? v.id),
    ignoreMode: v.ignoreMode ?? (hideMode === 'local' ? IGNORE_MODE.local : IGNORE_MODE.unified),
    tags: v.tags ?? [],
    group: v.group ?? null,
  };
}

/** 이 앱에서 새로 만드는 전역 변수 id — 쿠지알러 번호와 겹치지 않게 'h' + 시각 */
export const newGlobalId = (list: GlobalVar[]) => {
  let n = Date.now();
  while (list.some((g) => gid(g) === `h${n}`)) n++;
  return `h${n}`;
};

/**
 * 가져오기 파일 해석 — 앱 묶음(globals.json) · 쿠지알러 응답({ d: { inputs, resource } }) · 배열.
 * 같은 globalId 는 덮어쓴다.
 */
export function parseGlobalsFile(j: unknown): { inputs: GlobalVar[]; meta: Partial<GlobalMeta> } {
  const o = j as Record<string, unknown> | unknown[];
  if (Array.isArray(o)) return { inputs: o.filter(isGlobal).map(normalizeGlobal), meta: {} };
  if (o && (o as { kind?: string }).kind === 'kjl-globals') {
    const h = o as unknown as { inputs: unknown[]; groups?: GlobalGroup[]; tags?: GlobalTag[]; countLimit?: number; resource?: Record<string, GlobalRes> };
    return { inputs: h.inputs.filter(isGlobal).map(normalizeGlobal), meta: { groups: h.groups, tags: h.tags, countLimit: h.countLimit, resource: h.resource } };
  }
  const d = (o as { d?: { inputs?: unknown[]; resource?: Record<string, unknown[]> } })?.d;
  if (d?.inputs) return { inputs: d.inputs.filter(isGlobal).map(normalizeGlobal), meta: { resource: resourceOf(d.resource) } };
  throw new Error('전역 변수 파일이 아닙니다');
}
const isGlobal = (x: unknown) => !!x && typeof x === 'object' && 'globalId' in x && 'paramName' in x;

/** 원본 응답 resource(models · textures · obsParamPackages) → 이름·이미지 */
export function resourceOf(r: Record<string, unknown[]> | undefined): Record<string, GlobalRes> {
  const out: Record<string, GlobalRes> = {};
  const img = (e: Record<string, string | undefined>) => { const u = e.previewImgUrl || e.displayCoverImgUrl || e.coverImgUrl || ''; return u.startsWith('//') ? `https:${u}` : u; };
  for (const e of (r?.models ?? []) as Record<string, string>[]) out[e.obsBrandGoodId] = { name: e.name ?? '', img: img(e), kind: 'model' };
  for (const e of (r?.textures ?? []) as Record<string, string>[]) out[e.obsBrandGoodId] = { name: e.name ?? '', img: img(e), kind: 'texture' };
  for (const e of (r?.obsParamPackages ?? []) as Record<string, string>[]) out[e.obsPackageId] = { name: e.name ?? '', kind: 'package' };
  return out;
}

/** 목록 병합 — 같은 globalId 는 새 것으로 */
export function mergeGlobals(list: GlobalVar[], add: GlobalVar[]): { list: GlobalVar[]; added: number; replaced: number } {
  const byId = new Map(list.map((g) => [gid(g), g]));
  let added = 0, replaced = 0;
  for (const g of add) { if (byId.has(gid(g))) replaced++; else added++; byId.set(gid(g), g); }
  return { list: [...byId.values()], added, replaced };
}
