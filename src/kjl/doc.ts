import { DEFS, elementDef, type ElementDef, type ParamDef } from './defs';
import { koName } from './ko';
import { NODE_SECTIONS, type EditorData, type PmArray, type NodeSection, type PmBiz, type PmModel, type PmNode, type PmParam, type PmVar, type VarScope } from './types';

/**
 * 쿠지알러 원본(editorData) 읽기·쓰기 도우미 — 모델은 언제나 쿠지알러 형식 그대로이고, 여기 함수는 찾기·바꾸기만 한다.
 * 바꾸는 함수는 새 객체를 돌려준다(실행 취소 기록용).
 */

let seq = 0;
export const uid = (p = 'n') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ───────────── 변수 (inputs · constants · reports) ───────────── */

const VAR_KEYS = ['inputs', 'constants', 'reports'] as const;
type VarKey = typeof VAR_KEYS[number];

export const keyOfScope = (s: VarScope): VarKey => (s === 'middle' ? 'constants' : s === 'report' ? 'reports' : 'inputs');
const GROUP_TYPE: Partial<Record<VarScope, number>> = { basic: 0, system: 1, custom: 2 };

/** 변수 구역 — 어느 배열에 있는지 + inputs 는 groupTypeId */
export function scopeOf(m: PmModel, v: PmVar): VarScope {
  if (m.editorData.constants?.includes(v)) return 'middle';
  if (m.editorData.reports?.includes(v)) return 'report';
  return v.groupTypeId === 1 ? 'system' : v.groupTypeId === 0 ? 'basic' : 'custom';
}
/** 배열만 보고 정하는 구역(같은 객체가 아닐 때) */
export const scopeByName = (m: PmModel, name: string): VarScope | undefined => {
  const v = findVar(m, name);
  return v ? scopeOf(m, v) : undefined;
};

export const allVars = (m: Pick<PmModel, 'editorData'>): PmVar[] => [...(m.editorData.inputs ?? []), ...(m.editorData.constants ?? []), ...(m.editorData.reports ?? [])];
export const varsIn = (m: PmModel, s: VarScope): PmVar[] => (s === 'middle' ? m.editorData.constants ?? [] : s === 'report' ? m.editorData.reports ?? []
  : (m.editorData.inputs ?? []).filter((v) => (v.groupTypeId === 1 ? 'system' : v.groupTypeId === 0 ? 'basic' : 'custom') === s));
export const findVar = (m: Pick<PmModel, 'editorData'>, name: string) => allVars(m).find((v) => v.paramName === name);
/** 변수 이름 — 쿠지알러 중국어 이름은 한글로 보여 줌 */
export const varLabel = (v: Pick<PmVar, 'displayName' | 'paramName'>) => koName(v.displayName) || v.paramName;

const mapVars = (ed: EditorData, fn: (l: PmVar[], k: VarKey) => PmVar[]): EditorData => {
  const out: EditorData = { ...ed };
  for (const k of VAR_KEYS) if (ed[k] || k === 'inputs') out[k] = fn(ed[k] ?? [], k);
  return out;
};
export const withEd = (m: PmModel, fn: (ed: EditorData) => EditorData): PmModel => ({ ...m, editorData: fn(m.editorData) });

/** 변수 고치기 — id 로 찾음 */
export const patchVar = (m: PmModel, id: string, patch: Partial<PmVar>): PmModel =>
  withEd(m, (ed) => mapVars(ed, (l) => l.map((v) => (v.id === id ? { ...v, ...patch } : v))));
/** 변수 추가 — 구역에 맞는 배열 끝에 */
export function addVar(m: PmModel, v: PmVar, s: VarScope): PmModel {
  const k = keyOfScope(s);
  const nv = k === 'inputs' ? { ...v, groupTypeId: GROUP_TYPE[s] ?? 2 } : v;
  return withEd(m, (ed) => ({ ...ed, [k]: [...(ed[k] ?? []), nv] }));
}
export const removeVar = (m: PmModel, id: string): PmModel => withEd(m, (ed) => mapVars(ed, (l) => l.filter((v) => v.id !== id)));
/** 구역을 옮기며 바꾸기(변수 창 저장) — 이전 자리에서 지우고 새 구역 같은 자리(없으면 끝)에 */
export function replaceVar(m: PmModel, prevId: string | undefined, v: PmVar, s: VarScope): PmModel {
  const k = keyOfScope(s);
  const nv = k === 'inputs' ? { ...v, groupTypeId: GROUP_TYPE[s] ?? v.groupTypeId ?? 2 } : v;
  const prev = prevId ? allVars(m).find((x) => x.id === prevId) : undefined;
  if (prev && (VAR_KEYS.find((kk) => (m.editorData[kk] as PmVar[] | undefined)?.includes(prev)) === k)) {
    return withEd(m, (ed) => ({ ...ed, [k]: (ed[k] ?? []).map((x) => (x.id === prevId ? nv : x)) }));
  }
  return addVar(prevId ? removeVar(m, prevId) : m, nv, s);
}
/** 구역 전체 바꾸기 */
export function setScopeVars(m: PmModel, s: VarScope, list: PmVar[]): PmModel {
  const k = keyOfScope(s);
  if (k !== 'inputs') return withEd(m, (ed) => ({ ...ed, [k]: list }));
  const keep = (m.editorData.inputs ?? []).filter((v) => !varsIn(m, s).includes(v));
  return withEd(m, (ed) => ({ ...ed, inputs: [...keep, ...list.map((v) => ({ ...v, groupTypeId: GROUP_TYPE[s] }))] }));
}

/* 값 유형 (paramTypeId) */
export const VT = { free: 0, range: 1, options: 2, composite: 4, formula: 5, fixed: 6 } as const;
export type ValueKind = keyof typeof VT;
export const VT_LABEL: Record<ValueKind, string> = { range: '구간', options: '선택', free: '무제한', formula: '수식', composite: '복합 수식', fixed: '고정값' };
/** 값 유형 이름 — 3·7·8·9 는 선택 */
export function kindOf(v: Pick<PmVar, 'paramTypeId'>): ValueKind {
  switch (v.paramTypeId) {
    case 1: return 'range';
    case 2: case 3: case 7: case 8: case 9: return 'options';
    case 4: return 'composite';
    case 5: return 'formula';
    case 6: return 'fixed';
    default: return 'free';
  }
}
/** 복합 수식 상태 */
export const stateOfVar = (v: Pick<PmVar, 'status'>): 'value' | 'formula' => (v.status === 1 ? 'formula' : 'value');
/** 값을 수식으로 정하는지 (중간·보고 변수는 항상) */
export const usesFormula = (v: PmVar, scope: VarScope, state?: 'value' | 'formula') =>
  scope === 'middle' || scope === 'report' || kindOf(v) === 'formula' || (kindOf(v) === 'composite' && (state ?? stateOfVar(v)) === 'formula');
/** 수식 문자열 — 수식 변수는 formula 가 비면 value(중간·보고 변수는 value 가 수식) */
export const formulaOf = (v: PmVar, scope: VarScope) => ((scope === 'middle' || scope === 'report') ? (v.value || v.formula || '') : (v.formula || (kindOf(v) === 'formula' ? v.value : '') || ''));

/* 사용자 그룹 (customParamGroups) */
const DEFAULT_GROUP = '自定义变量';
export const groupsOf = (m: PmModel): string[] => (m.editorData.customParamGroups ?? []).map((g) => g.groupName).filter((g) => g && g !== DEFAULT_GROUP);
export const groupOfVar = (m: PmModel, name: string): string | undefined =>
  (m.editorData.customParamGroups ?? []).find((g) => g.groupName !== DEFAULT_GROUP && g.paramNames.includes(name))?.groupName;
/** 변수의 그룹 바꾸기 ('' = 그룹 없음) */
export function setVarGroup(m: PmModel, name: string, group: string): PmModel {
  const gs = (m.editorData.customParamGroups ?? []).map((g) => ({ ...g, paramNames: g.paramNames.filter((n) => n !== name) }));
  if (group) {
    const g = gs.find((x) => x.groupName === group);
    if (g) g.paramNames = [...g.paramNames, name];
    else gs.push({ groupName: group, paramNames: [name] });
  }
  return withEd(m, (ed) => ({ ...ed, customParamGroups: gs }));
}
/** 그룹 목록 순서·이름 바꾸기 */
export function setGroups(m: PmModel, groups: string[], rename: Record<string, string> = {}): PmModel {
  const old = m.editorData.customParamGroups ?? [];
  const byName = new Map(old.map((g) => [g.groupName, g]));
  const back = Object.fromEntries(Object.entries(rename).map(([a, b]) => [b, a]));
  const keepDefault = old.filter((g) => g.groupName === DEFAULT_GROUP);
  const list = groups.map((g) => ({ groupName: g, paramNames: byName.get(back[g] ?? g)?.paramNames ?? [] }));
  return withEd(m, (ed) => ({ ...ed, customParamGroups: [...keepDefault, ...list] }));
}

/** 스타일 변수 값 — 쿠지알러는 {"obsBrandGoodId":"…","versionId":n} JSON, 이 앱은 모델 id 그대로 */
export function styleId(v: string | null | undefined): string {
  const s = (v ?? '').trim();
  if (s.startsWith('{')) { try { return String((JSON.parse(s) as { obsBrandGoodId?: string }).obsBrandGoodId ?? ''); } catch { return ''; } }
  return s;
}
/** 좌표 성분 이름 — x · X 둘 다 */
export const axisKey = (o: Record<string, unknown>, k: string) => (k in o ? k : k.toLowerCase() in o ? k.toLowerCase() : k.toUpperCase() in o ? k.toUpperCase() : undefined);

/** 확장 속성 값 — 쿠지알러 원본은 { value, displayName, valueType } 객체, 예전 형식은 글자 */
export function extVal(v: Pick<PmVar, 'extAttr'>, k: string): string {
  const x = v.extAttr?.[k];
  if (x == null) return '';
  if (typeof x === 'object') { const val = (x as { value?: unknown }).value; return val == null ? '' : String(val); }
  return String(x);
}
/** 확장 속성 쓰기 — 원본 객체 모양 유지(없으면 { value, displayName: null, valueType: null }) */
export function withExtVal(v: Pick<PmVar, 'extAttr'>, k: string, value: string): Record<string, unknown> {
  const x = v.extAttr?.[k];
  const next = x && typeof x === 'object' ? { ...(x as object), value } : { value, displayName: null, valueType: null };
  return { ...(v.extAttr ?? {}), [k]: next };
}

/* ───────────── 요소 (modelInstances · moldingPaths …) ───────────── */

/** 정의 묶음(defs section) → editorData 배열 */
export const SECTION_KEY: Record<string, NodeSection | 'frameModels'> = {
  paramModels: 'modelInstances', modelInstances: 'modelInstances', adsorbs: 'adsorbLines', adsorbLines: 'adsorbLines', frameModels: 'frameModels',
  moldingPaths: 'moldingPaths', innerFrameModels: 'innerFrameModels', customDoorHoles: 'customDoorHoles', intersectBoxes: 'intersectBoxes',
  connectors: 'connectors', connectorModels: 'connectorModels', wireLayouts: 'wireLayouts', customAuxiliaries: 'customAuxiliaries',
};

export const nodesOf = (m: Pick<PmModel, 'editorData'>): PmNode[] => NODE_SECTIONS.flatMap((s) => m.editorData[s] ?? []);
export const findNode = (m: Pick<PmModel, 'editorData'>, id: string) => nodesOf(m).find((n) => n.instanceId === id);
export const sectionOf = (m: Pick<PmModel, 'editorData'>, id: string): NodeSection | undefined => NODE_SECTIONS.find((s) => m.editorData[s]?.some((n) => n.instanceId === id));

const mapNodes = (ed: EditorData, fn: (l: PmNode[], s: NodeSection) => PmNode[]): EditorData => {
  const out: EditorData = { ...ed };
  for (const s of NODE_SECTIONS) if (ed[s]) out[s] = fn(ed[s]!, s);
  return out;
};
export const updateNode = (m: PmModel, id: string, fn: (n: PmNode) => PmNode): PmModel =>
  withEd(m, (ed) => mapNodes(ed, (l) => l.map((n) => (n.instanceId === id ? fn(n) : n))));
export const removeNodes = (m: PmModel, ids: string[]): PmModel => {
  const set = new Set(ids);
  return withEd(m, (ed) => mapNodes(ed, (l) => l.filter((n) => !set.has(n.instanceId))));
};
export const addNode = (m: PmModel, section: NodeSection, n: PmNode): PmModel => withEd(m, (ed) => ({ ...ed, [section]: [...(ed[section] ?? []), n] }));
/** 모든 요소 지우기(비우기) */
export const clearNodes = (m: PmModel): PmModel => withEd(m, (ed) => mapNodes(ed, () => []));
/** 같은 묶음 안에서 순서 바꾸기 */
export function moveNode(m: PmModel, id: string, dir: -1 | 1): PmModel {
  return withEd(m, (ed) => mapNodes(ed, (l) => {
    const i = l.findIndex((n) => n.instanceId === id);
    if (i < 0 || i + dir < 0 || i + dir >= l.length) return l;
    const c = [...l]; [c[i], c[i + dir]] = [c[i + dir], c[i]]; return c;
  }));
}

/* 하위 모델 */
export const isSubModel = (n: PmNode) => !!n.obsBrandGoodId && (n.functionTypeId ?? 1) !== 0;
export type SubRef = { kind: 'param' | 'mesh'; id: string; name: string; dyn?: string };
/** 하위 모델 — kind · 상품 id · 변수로 바뀌면 dyn(#변수) */
export function subOf(n: PmNode): SubRef | undefined {
  if (!isSubModel(n)) return undefined;
  const fn = n.functionName ?? '';
  const kind = /furnitureModel/i.test(fn) ? 'mesh' : 'param';
  return { kind, id: n.obsBrandGoodId!, name: n.name, ...(fn.startsWith('#') ? { dyn: fn } : {}) };
}
/** 정의 id — 하위 모델은 'instance', 보조 구조는 함수 이름#업무 종류 */
export function defIdOf(n: PmNode): string {
  if (isSubModel(n)) return 'instance';
  const fn = n.functionName;
  const bt = pv(n, 'businessType');
  if (bt && DEFS.elements.some((e) => e.id === `${fn}#${bt}`)) return `${fn}#${bt}`;
  if (DEFS.elements.some((e) => e.id === fn) || fn === DEFS.frame.id) return fn;
  return DEFS.elements.find((e) => e.fn === fn)?.id ?? fn;
}
export const defOf = (n: PmNode): ElementDef | undefined => elementDef(defIdOf(n));

/* 요소 변수 (parameters[]) */
/** 저장 값 — 없으면 undefined (정의 기본값은 계산기가 채움) */
export const pv = (n: Pick<PmNode, 'parameters'>, name: string): string | undefined => {
  const p = n.parameters?.find((x) => x.paramName === name);
  return p?.value ?? undefined;
};
/** 값 + 정의 기본값 */
export function pvOrDef(n: PmNode, name: string): string | undefined {
  return pv(n, name) ?? n.parameters?.find((x) => x.paramName === name)?.defaultValue ?? defOf(n)?.params.find((p) => p.name === name)?.value ?? undefined;
}
/** 이름 → 값 표 (값 있는 것만) */
export const paramMap = (n: Pick<PmNode, 'parameters'>): Record<string, string> =>
  Object.fromEntries((n.parameters ?? []).filter((p) => p.value != null).map((p) => [p.paramName, p.value as string]));

/** 정의에서 parameters 항목 만들기 */
export function paramFromDef(pd: ParamDef, value?: string | null): PmParam {
  return {
    paramName: pd.name, valueType: pd.type, displayName: pd.zh, value: value === undefined ? pd.value ?? null : value,
    groupTypeId: pd.group, visible: pd.visible, editable: true,
    ...(pd.options?.length ? { editorOptions: pd.options.map((o) => ({ name: o.zh || o.name, value: o.value })) } : {}),
  };
}
/** 요소 변수 바꾸기 — 없으면 정의로 항목을 만들어 넣음. value null = 지움(기본값) */
export function setPv(n: PmNode, name: string, value: string | null): PmNode {
  const ps = n.parameters ?? [];
  if (ps.some((p) => p.paramName === name)) return { ...n, parameters: ps.map((p) => (p.paramName === name ? { ...p, value } : p)) };
  const pd = defOf(n)?.params.find((p) => p.name === name);
  return { ...n, parameters: [...ps, pd ? paramFromDef(pd, value) : { paramName: name, value }] };
}
export const setPvs = (n: PmNode, vals: Record<string, string | null>): PmNode => Object.entries(vals).reduce((a, [k, v]) => setPv(a, k, v), n);

/** 새 요소 — 정의 기본값으로 parameters 를 채움 */
export function newNode(def: ElementDef, name: string, vals: Record<string, string> = {}): { section: NodeSection | 'frameModels'; node: PmNode } {
  const node: PmNode = {
    instanceId: uid('i'), uniqueId: uid('u'), name, functionName: def.fn, functionTypeId: 0, refName: null,
    parameters: def.params.map((pd) => paramFromDef(pd, vals[pd.name] ?? pd.value ?? null)),
    bizProperties: [], customParamGroups: [], depends: null, usedBy: null,
  };
  return { section: SECTION_KEY[def.section] ?? 'modelInstances', node };
}
/** 새 하위 모델 인스턴스 — 앱 모델은 ext.paramModel, 컨텐츠 라이브러리 3D 는 ext.furnitureModel */
export function newSubNode(sub: { kind: 'param' | 'mesh'; id: string; name: string }, vals: Record<string, string> = {}): PmNode {
  const def = DEFS.instance;
  return {
    instanceId: uid('i'), uniqueId: uid('u'), name: sub.name, functionName: sub.kind === 'mesh' ? 'ext.furnitureModel' : 'ext.paramModel', functionTypeId: 1,
    obsBrandGoodId: sub.id, versionId: 0, refName: null,
    parameters: def.params.map((pd) => paramFromDef(pd, vals[pd.name] ?? pd.value ?? null)),
    bizProperties: [], customParamGroups: [{ groupName: DEFAULT_GROUP, paramNames: [] }], instanceInheritance: { paramGroupInheritances: {}, paramNameInheritances: {} },
    depends: null, usedBy: null, inputFamilyRefs: [], envInputOverrides: null, transformType: null,
  };
}

/* ───────────── 외곽 틀 · 모델 속성 · 업무 속성 ───────────── */

export const frameNode = (m: Pick<PmModel, 'editorData'>): PmNode | undefined => m.editorData.frameModels?.[0];
export const frameMap = (m: Pick<PmModel, 'editorData'>): Record<string, string> => {
  const f = frameNode(m);
  const base = Object.fromEntries(DEFS.frame.params.map((p) => [p.name, p.value ?? p.def ?? '']));
  return f ? { ...base, ...paramMap(f) } : base;
};
export const propsNode = (m: Pick<PmModel, 'editorData'>): PmNode | undefined => m.editorData.paramModel;
export const propsMap = (m: Pick<PmModel, 'editorData'>): Record<string, string> => {
  const base = Object.fromEntries(DEFS.model.params.map((p) => [p.name, p.value ?? p.def ?? '']));
  const n = propsNode(m);
  return n ? { ...base, ...paramMap(n) } : base;
};
export const setProp = (m: PmModel, name: string, value: string): PmModel =>
  withEd(m, (ed) => ({ ...ed, paramModel: setPv(ed.paramModel ?? newNode(DEFS.model, '模型').node, name, value) }));
export const setFrame = (m: PmModel, name: string, value: string): PmModel =>
  withEd(m, (ed) => {
    const f = ed.frameModels?.[0] ?? newNode(DEFS.frame, '矩形外框').node;
    return { ...ed, frameModels: [setPv(f, name, value), ...(ed.frameModels ?? []).slice(1)] };
  });

export const bizMap = (l: PmBiz[] | undefined): Record<string, string> => Object.fromEntries((l ?? []).map((b) => [b.key, b.value ?? '']));
/** 업무 속성 값 바꾸기 — 없으면 정의(DEFS.bizProps)로 항목을 만듦, '' 는 지움 */
export function setBiz(l: PmBiz[] | undefined, key: string, value: string): PmBiz[] {
  const list = l ?? [];
  if (value === '') return list.filter((b) => b.key !== key);
  if (list.some((b) => b.key === key)) return list.map((b) => (b.key === key ? { ...b, value } : b));
  const d = DEFS.bizProps.find((b) => b.key === key);
  return [...list, { key, namespace: 'diy', name: d?.zh ?? key, valueType: d?.type ?? 'string', value, optionId: '0' }];
}
export const modelBiz = (m: Pick<PmModel, 'editorData'>) => bizMap(m.editorData.bizProperties);
export const setModelBiz = (m: PmModel, key: string, value: string): PmModel => withEd(m, (ed) => ({ ...ed, bizProperties: setBiz(ed.bizProperties, key, value) }));

/* ───────────── 앱 정보 ───────────── */

export const isViewHidden = (m: PmModel, id: string) => !!m.meta.viewHidden?.includes(id);
export const arrayOf = (m: PmModel, id: string) => m.meta.arrays?.[id];
export const varExt = (m: PmModel, name: string) => m.meta.varExt?.[name] ?? {};

/* ───────────── 참조명 바꾸기 ───────────── */

/** 값 안의 수식 문자열마다 fn — JSON(좌표·경로·조건 값)이면 안쪽 문자열(속의 JSON 문자열까지)에 */
export function mapExprs(s: string, fn: (e: string) => string): string {
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const walk = (x: unknown): unknown => (typeof x === 'string' ? mapExprs(x, fn) : Array.isArray(x) ? x.map(walk) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)])) : x);
      const o = JSON.parse(t);
      const n = walk(o);
      const out = JSON.stringify(n);
      return out === JSON.stringify(o) ? s : out;
    } catch { /* 일반 문자열 */ }
  }
  return fn(s);
}

/** 모든 수식에서 바꾸기 — 변수(값·수식·구간·숨김 조건·선택지) · 요소 변수 · 외곽 틀 · 모델 속성 · 업무 속성 · 변수로 바뀌는 하위 모델 */
export function mapAllExprs(m: PmModel, fn: (e: string) => string): PmModel {
  const s = (x: string | null | undefined) => (x ? mapExprs(x, fn) : x);
  const v2 = (v: PmVar): PmVar => ({
    ...v, value: s(v.value) ?? '', formula: s(v.formula) ?? v.formula, min: s(v.min) ?? v.min, max: s(v.max) ?? v.max, ignore: s(v.ignore),
    editorOptions: v.editorOptions?.map((o) => ({ ...o, ignore: s(o.ignore) })),
    ...(v.extAttr ? { extAttr: Object.fromEntries(Object.entries(v.extAttr).map(([k, x]) => [k, typeof x === 'string' ? s(x)
      : x && typeof x === 'object' && typeof (x as { value?: unknown }).value === 'string' ? { ...(x as object), value: s((x as { value: string }).value) } : x])) } : {}),
  });
  const n2 = (n: PmNode): PmNode => ({
    ...n, functionName: n.functionName.startsWith('#') ? fn(n.functionName) : n.functionName,
    parameters: n.parameters.map((p) => (typeof p.value === 'string' ? { ...p, value: s(p.value) } : p)),
    bizProperties: n.bizProperties?.map((b) => ({ ...b, value: s(b.value) ?? b.value })),
  });
  return withEd(m, (ed) => {
    const out = mapNodes(mapVars(ed, (l) => l.map(v2)), (l) => l.map(n2));
    if (ed.frameModels) out.frameModels = ed.frameModels.map(n2);
    if (ed.paramModel) out.paramModel = n2(ed.paramModel);
    if (ed.bizProperties) out.bizProperties = ed.bizProperties.map((b) => ({ ...b, value: s(b.value) ?? b.value }));
    return out;
  });
}

/* ───────────── 앱 정보 · 단위 · 외부 값 ───────────── */

export const withMeta = (m: PmModel, patch: Partial<PmModel['meta']>): PmModel => ({ ...m, meta: { ...m.meta, ...patch } });
export const toggleViewHidden = (m: PmModel, id: string): PmModel => {
  const l = m.meta.viewHidden ?? [];
  return withMeta(m, { viewHidden: l.includes(id) ? l.filter((x) => x !== id) : [...l, id] });
};
export const setArray = (m: PmModel, id: string, a: PmArray | undefined): PmModel => {
  const arrays = { ...(m.meta.arrays ?? {}) };
  if (a) arrays[id] = a; else delete arrays[id];
  return withMeta(m, { arrays });
};
/** 같은 묶음에서 그 요소 바로 뒤에 넣기 */
export function insertNodeAfter(m: PmModel, afterId: string, n: PmNode): PmModel {
  const sec = sectionOf(m, afterId) ?? 'modelInstances';
  return withEd(m, (ed) => {
    const l = [...(ed[sec] ?? [])];
    const i = l.findIndex((x) => x.instanceId === afterId);
    l.splice(i < 0 ? l.length : i + 1, 0, n);
    return { ...ed, [sec]: l };
  });
}
export const unitsOf = (m: Pick<PmModel, 'editorData'>) => m.editorData.unitDataList ?? [];
export const setUnits = (m: PmModel, list: PmModel['editorData']['unitDataList']): PmModel => withEd(m, (ed) => ({ ...ed, unitDataList: list ?? [] }));
export const assignsOf = (m: Pick<PmModel, 'editorData'>) => m.editorData.parameterAssignments?.parameterAssignments ?? [];
export const setAssigns = (m: PmModel, list: NonNullable<NonNullable<EditorData['parameterAssignments']>['parameterAssignments']>): PmModel =>
  withEd(m, (ed) => ({ ...ed, parameterAssignments: { ...(ed.parameterAssignments ?? {}), parameterAssignments: list } }));
/** 요소를 지울 때 함께 지울 것 — 단위(문 개구부 연결) · 노드 보고 · 배열 · 보기 숨김 */
export function dropNodeRefs(m: PmModel, ids: string[]): PmModel {
  const set = new Set(ids);
  const arrays = Object.fromEntries(Object.entries(m.meta.arrays ?? {}).filter(([k]) => !set.has(k)));
  return withMeta(setUnits(m, unitsOf(m).filter((u) => !set.has(u.mainInstanceId) && !set.has(u.accessoryInstanceId))), {
    arrays, viewHidden: (m.meta.viewHidden ?? []).filter((x) => !set.has(x)), nodeReports: (m.meta.nodeReports ?? []).filter((r) => !set.has(r.nodeId)),
  });
}
