import { DEFS, type ElementDef, type ParamDef } from './defs';
import {
  allVars, axisKey, defOf, extVal, formulaOf, frameMap, isSubModel, kindOf, nodesOf, paramMap, pv, pvOrDef, scopeOf, stateOfVar, styleId, subOf, uid, usesFormula, varLabel,
} from './doc';
import { gid, mergeGlobal, type GlobalVar } from './globals';
import { ExprError, NULL, dependencies, evaluate, fmt, tNum, tStr, toStr, truthy, typedOf, type Scope, type Typed } from './expr';
import { parseLinePath, parsePlankPath } from './path';
import type { PmModel, PmNode, PmParam, PmPath, PmVar, PlankShape, VarOption, VarScope } from './types';

export { uid };

/**
 * 파라메트릭 모델 계산 — 쿠지알러 원본(editorData) 그대로 계산한다.
 * 변수(inputs) · 중간 변수(constants) · 보고 변수(reports) · 요소 변수(parameters)를 필요할 때 계산(지연 계산 + 순환 검사).
 * 형상(three.js)은 geometry.ts 가 이 결과의 숫자를 받아 만든다.
 */

export type V3 = [number, number, number];

/** 상품(재질·스타일·윤곽·하위 모델) 조회 — 에디터가 컨텐츠 라이브러리 · 모델 저장소로 채운다 */
export interface Catalog {
  /** 재질·스타일 상품 — #CZ.name · #CZ.productcode · getProductCustomAttr */
  product?(id: string): { name: string; code?: string; model?: string; customcode?: string; custom?: Record<string, string>; color?: string; texture?: string } | undefined;
  /** 컨텐츠 라이브러리 3D 모델(메시 래퍼) — GLB 에셋과 원래 크기 */
  mesh?(id: string): { name: string; asset?: string; size?: V3 } | undefined;
  /** 윤곽(단면) — 로프트·스윕 profileData, 윤곽 변수 #ZX.w · #ZX.d */
  profile?(id: string): { name: string; w: number; h: number; points: [number, number][] } | undefined;
  /** 하위 파라메트릭 모델 (앱 모델 id 또는 쿠지알러 상품 id) */
  model?(id: string): PmModel | undefined;
  /** 전역 변수 */
  globals?(): GlobalVar[];
  /** 제품 패키지(변수 link) — 이름과 선택지(상품 id · 이름 · 그림) */
  package?(id: string): { name: string; options: { value: string; name: string; img?: string; versionId?: number }[] } | undefined;
}

export interface EvalOptions {
  catalog?: Catalog;
  /** 부모가 정한 변수 값(하위 모델 인스턴스) — 이름 → 값(계산 끝난 문자열) */
  overrides?: Record<string, string>;
  /** 복합 수식 상태 덮어쓰기 */
  states?: Record<string, 'value' | 'formula'>;
  /** 설계 툴 환경 — #selfPosition · #selfRotate (에디터에서는 적용하지 않음 — 문서 3.1.29 ‘편집기 로직’) */
  env?: { position: V3; rotate: V3 };
  depth?: number;
}

export interface Diag {
  level: 'error' | 'warn';
  /** 어디서 — ‘변수 W’, ‘평면 판재-1 · 높이’ … */
  where: string;
  message: string;
  varName?: string;
  nodeId?: string;
  param?: string;
}

export interface VarEval {
  v: PmVar;
  scope: VarScope;
  value: Typed;
  error?: string;
  /** 숨김 조건 결과 */
  hidden: boolean;
  /** 잠금 조건(diy-immutable) 결과 */
  locked: boolean;
  /** 보이는 선택지 (선택지 숨김 조건 반영) */
  options?: VarOption[];
  /** 구간 최소·최대 계산값 */
  min?: number;
  max?: number;
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const isFormulaLike = (s: string) => /^[#@(]/.test(s.trim()) || /[?+*/]|==|!=|&&|\|\|/.test(s);
/** 조건 값 — {"cases":[{"condition":"…","value":"…"}],"defaultValue":"…"} (쿠지알러 规则值) */
const isCases = (s: string) => /^\s*\{\s*"cases"\s*:/.test(s);

/** 값이 수식인지 문자 그대로인지 — 재질 id(3FO4KF1T9XQV)·선택지 값('top')은 문자 그대로 */
function literalOrFormula(raw: string, type: string, options?: { value: string }[]): { literal: true; v: Typed } | { literal: false } {
  const s0 = raw.trim();
  if (['material', 'shape', 'string', 'style', 'parammodelpackage'].includes(type)) {
    if (options?.some((o) => o.value === s0)) return { literal: true, v: tStr(s0) };
    if (/^['"].*['"]$/.test(s0) || isFormulaLike(s0)) return { literal: false };
    return { literal: true, v: tStr(s0) };
  }
  return { literal: false };
}

export class PmEval {
  readonly model: PmModel;
  readonly opts: EvalOptions;
  readonly diags: Diag[] = [];
  readonly scope: Scope;
  private readonly varByName = new Map<string, { v: PmVar; scope: VarScope }>();
  /** 설계 툴 기능 이름(scriptName)으로도 찾기 — 원본 수식에 #materialBrandGoodId (= CZ) 처럼 씀 */
  private readonly varByScript = new Map<string, string>();
  private readonly nodeByRef = new Map<string, PmNode>();
  private readonly varMemo = new Map<string, VarEval>();
  private readonly paramMemo = new Map<string, Typed | ExprError>();
  private readonly visiting: string[] = [];
  private readonly childMemo = new Map<string, PmEval | null>();
  private readonly reported = new Set<string>();

  constructor(model: PmModel, opts: EvalOptions = {}) {
    this.model = model;
    this.opts = opts;
    const globals = opts.catalog?.globals?.() ?? [];
    for (const v of allVars(model)) {
      const scope = scopeOf(model, v);
      // 전역 변수 사본 — 정의는 전역 변수, 값은 모델, 숨김은 ignoreMode 대로 (src/pm/globals.ts)
      const merged = v.globalId != null && v.globalId !== '' ? mergeGlobal(v, globals.find((x) => gid(x) === String(v.globalId))) : v;
      if (this.varByName.has(v.paramName)) this.diag('error', `변수 ${v.paramName}`, `참조명 ${v.paramName} 이(가) 중복됩니다`, { varName: v.paramName });
      else this.varByName.set(v.paramName, { v: merged, scope });
      if (!NAME_RE.test(v.paramName)) this.diag('error', `변수 ${varLabel(v)}`, '참조명은 영문자로 시작하고 영문·숫자만 쓸 수 있습니다', { varName: v.paramName });
      if (v.scriptName && v.scriptName !== v.paramName && !this.varByScript.has(v.scriptName)) this.varByScript.set(v.scriptName, v.paramName);
    }
    for (const s of [...this.varByScript.keys()]) if (this.varByName.has(s)) this.varByScript.delete(s);
    for (const n of nodesOf(model)) {
      if (!n.refName) continue;
      if (this.nodeByRef.has(n.refName)) this.diag('error', n.name, `부품 참조명 ${n.refName} 이(가) 중복됩니다`, { nodeId: n.instanceId });
      else this.nodeByRef.set(n.refName, n);
    }
    this.scope = {
      getVar: (name) => this.varTyped(this.alias(name)),
      getVarAttr: (name, path) => this.varAttr(this.alias(name), path),
      getRef: (ref, path) => this.refValue(ref, path),
      varState: (name) => this.stateOf(name),
      options: (name) => this.optionsOf(name),
      productCustomAttr: (id, key) => { const c = opts.catalog?.product?.(id)?.custom?.[key]; return c == null ? undefined : typedOf(c, Number.isNaN(Number(c)) ? 'string' : 'float'); },
    };
  }

  private diag(level: Diag['level'], where: string, message: string, extra: Partial<Diag> = {}) {
    const key = `${level}|${where}|${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.diags.push({ level, where, message, ...extra });
  }

  /** 순환 검사를 하며 계산 */
  private guard<T>(key: string, label: string, fn: () => T): T {
    if (this.visiting.includes(key)) {
      const cycle = [...this.visiting.slice(this.visiting.indexOf(key)).map((k) => k.split('|')[1]), label].join(' → ');
      throw new ExprError(`순환 참조: ${cycle}`);
    }
    this.visiting.push(key);
    try { return fn(); } finally { this.visiting.pop(); }
  }

  /* ───────────── 변수 ───────────── */

  private alias(name: string) { return this.varByName.has(name) ? name : this.varByScript.get(name) ?? name; }
  /** 변수 선택지 — 직접 적은 선택지, 없고 link(제품 패키지)가 있으면 패키지 상품 */
  optionsOf(name: string): { name: string; value: string }[] | undefined {
    const v = this.varByName.get(name)?.v;
    if (!v) return undefined;
    if (v.editorOptions?.length || !v.link) return v.editorOptions?.map((o) => ({ name: o.name, value: o.value }));
    return this.opts.catalog?.package?.(v.link)?.options.map((o) => ({ name: o.name, value: o.value }));
  }
  getVarDef(name: string) { return this.varByName.get(name)?.v; }
  scopeOfVar(name: string) { return this.varByName.get(name)?.scope; }

  stateOf(name: string): 'value' | 'formula' | undefined {
    const e = this.varByName.get(name);
    if (!e) return undefined;
    if (kindOf(e.v) !== 'composite') return 'value';
    if (this.opts.overrides && name in this.opts.overrides) return 'value';
    return this.opts.states?.[name] ?? stateOfVar(e.v);
  }

  private calc(expr: string, where: string, extra: Partial<Diag>): Typed {
    try { return evaluate(expr, this.scope); } catch (e) {
      const msg = (e as Error).message;
      this.diag('error', where, msg, extra);
      throw e;
    }
  }

  /** 조건 값 고르기 — 참인 첫 조건의 값, 없으면 defaultValue */
  private pickCase(raw: string, where: string, extra: Partial<Diag>): string {
    let o: { cases?: { condition?: string; value?: string }[]; defaultValue?: string };
    try { o = JSON.parse(raw); } catch { this.diag('error', where, '조건 값 형식 오류', extra); return ''; }
    for (const c of o.cases ?? []) {
      if (!c.condition?.trim()) continue;
      if (truthy(this.calc(c.condition, `${where} · 조건`, extra))) return String(c.value ?? '');
    }
    return String(o.defaultValue ?? '');
  }

  /** 변수 계산 결과 (값 · 숨김 · 잠금 · 보이는 선택지) */
  varEval(name: string): VarEval | undefined {
    const hit = this.varMemo.get(name);
    if (hit) return hit;
    const e = this.varByName.get(name);
    if (!e) return undefined;
    const { v, scope } = e;
    const where = `변수 ${varLabel(v)}(${v.paramName})`;
    const extra = { varName: v.paramName };
    let value: Typed = NULL, error: string | undefined;
    try {
      value = this.guard(`v|${name}`, `#${name}`, () => this.computeVar(v, scope, where, extra));
    } catch (err) { error = (err as Error).message; this.diag('error', where, error, extra); }
    const r: VarEval = { v, scope, value, error, hidden: false, locked: false };
    this.varMemo.set(name, r);
    // 숨김 조건 · 잠금 조건 · 선택지 숨김 · 구간 — 값 다음에 (자기 자신을 참조해도 순환이 아니게)
    const bool = (expr: unknown, label: string) => {
      if (typeof expr !== 'string' || !expr.trim()) return false;
      try { return truthy(evaluate(expr, this.scope)); } catch (err) { this.diag('error', `${where} · ${label}`, (err as Error).message, extra); return false; }
    };
    r.hidden = bool(v.ignore, '숨김 조건');
    r.locked = bool(extVal(v, 'diy-immutable'), '잠금 조건');
    if (v.editorOptions?.length) r.options = v.editorOptions.filter((o) => !bool(o.ignore, `선택지 ${o.name} 숨김 조건`));
    if (kindOf(v) === 'range' && (v.valueType === 'float' || v.valueType === 'int')) {
      const num = (x: string | undefined, label: string) => {
        if (x == null || x.trim() === '') return undefined;
        try { const t = evaluate(x, this.scope); return t.k === 'n' ? t.v : Number(toStr(t)); } catch (err) { this.diag('error', `${where} · ${label}`, (err as Error).message, extra); return undefined; }
      };
      r.min = num(v.min, '최솟값');
      r.max = num(v.max, '최댓값');
      if (value.k === 'n' && ((r.min != null && value.v < r.min - 1e-9) || (r.max != null && value.v > r.max + 1e-9)))
        this.diag('warn', where, `현재값 ${fmt(value)} 이(가) 구간 ${r.min ?? ''}~${r.max ?? ''} 밖입니다`, extra);
    }
    if (kindOf(v) === 'options' && r.options && value.k !== 'null' && !v.link && !v.editorOptions!.some((o) => o.value === toStr(value) || o.value === fmt(value)))
      this.diag('warn', where, `현재값 ${fmt(value)} 이(가) 선택지에 없습니다`, extra);
    return r;
  }

  private computeVar(v: PmVar, scope: VarScope, where: string, extra: Partial<Diag>): Typed {
    const t0 = v.valueType;
    const ov = this.opts.overrides?.[v.paramName];
    if (ov != null) return typedOf(ov, t0 === 'int' ? 'int' : t0 === 'float' ? 'float' : t0 === 'boolean' ? 'boolean' : 'string');
    const cast = (t: Typed) => (t0 === 'int' && t.k === 'n' ? tNum(Math.trunc(t.v), true) : t0 === 'float' && t.k === 'n' ? tNum(t.v) : t);
    if (usesFormula(v, scope, this.stateOf(v.paramName))) {
      let f = formulaOf(v, scope).trim();
      if (!f) return NULL;
      // 좌표·경로 수식은 JSON(성분마다 수식) — 원문 그대로, 성분은 #이름.x 로 계산
      if (['float2', 'float3', 'fit', 'plankpath', 'loftpath', 'meshinstance'].includes(t0) && (f.startsWith('{') || f.startsWith('['))) return tStr(f);
      if (isCases(f)) { f = this.pickCase(f, where, extra).trim(); if (!f) return NULL; }
      // 문자·재질·스타일 형식의 중간·보고 변수는 글자 그대로 저장되기도 한다(쿠지알러 원본: ITEM = K_IP000053)
      const lit = literalOrFormula(f, t0);
      if (lit.literal) return lit.v;
      return cast(this.calc(f, where, extra));
    }
    let raw = (v.value ?? '').trim();
    if (isCases(raw)) raw = this.pickCase(raw, where, extra).trim();
    if (t0 === 'float' || t0 === 'int') {
      if (raw === '') return NULL;
      if (!Number.isNaN(Number(raw))) return typedOf(raw, t0);
      return cast(this.calc(raw, where, extra));
    }
    if (t0 === 'boolean') {
      if (/^(true|false|1|0|)$/i.test(raw)) return typedOf(raw, 'boolean');
      return this.calc(raw, where, extra);
    }
    return tStr(raw);
  }

  varTyped(name: string): Typed | undefined {
    if (!this.varByName.has(name)) return undefined;
    const r = this.varEval(name)!;
    if (r.error) throw new ExprError(`#${name}: ${r.error}`);
    return r.value;
  }

  /** #이름.속성 — 재질/스타일 상품 속성, 윤곽 크기, 좌표 성분, 환경, #self부품.paramStyle.* */
  private varAttr(name: string, path: string[]): Typed | undefined {
    if (name === 'selfPosition' || name === 'selfRotate') {
      const env = this.opts.env;
      const i = { x: 0, y: 1, z: 2 }[path[0] as 'x' | 'y' | 'z'];
      if (i == null) return undefined;
      return tNum(env ? (name === 'selfPosition' ? env.position : env.rotate)[i] : 0);
    }
    const e = this.varByName.get(name);
    if (e) {
      const v = e.v;
      const val = this.varTyped(name);
      // 2·3차원 좌표 변수 성분 — #offset.x
      if (val && (v.valueType === 'float2' || v.valueType === 'float3') && val.k === 's' && path.length === 1) {
        try {
          const o = JSON.parse(val.v) as Record<string, string>;
          const ax = axisKey(o, path[0]);
          if (ax) return this.guard(`v|${name}.${ax}`, `#${name}.${ax}`, () => this.calc(String(o[ax]) || '0', `변수 ${varLabel(v)}(${v.paramName}).${ax}`, { varName: v.paramName }));
        } catch (err) { if (err instanceof ExprError) throw err; }
      }
      if (val && v.valueType === 'style') return this.attrOfValue(tStr(styleId(toStr(val))), path, 'style');
      return val ? this.attrOfValue(val, path, v.valueType === 'shape' ? 'profile' : v.valueType) : undefined;
    }
    // #MB.paramStyle.name · #selfMB.paramStyle.name — 하위 부품 상품 정보
    const node = this.findRef(name);
    if (node) return this.nodeAttr(node, path);
    return undefined;
  }

  /** 상품(재질·윤곽) id → 이름 (없으면 '') */
  nameOf(id: string, kind?: string): string {
    const t = id ? this.attrOfValue(tStr(id), ['name'], kind === 'shape' ? 'profile' : kind) : undefined;
    return t && t.k === 's' ? t.v : '';
  }

  /** 상품 id 값의 속성 */
  attrOfValue(val: Typed, path: string[], kind?: string): Typed | undefined {
    const id = toStr(val);
    const key = (path[0] ?? '').toLowerCase();
    if (kind === 'profile' || ((key === 'w' || key === 'd' || key === 'h') && this.opts.catalog?.profile?.(id))) {
      const p = this.opts.catalog?.profile?.(id);
      if (!p) return undefined;
      if (key === 'w') return tNum(p.w);
      if (key === 'd' || key === 'h') return tNum(p.h);
      if (key === 'name') return tStr(p.name);
      return undefined;
    }
    const prod = this.opts.catalog?.product?.(id);
    if (!prod) return key === 'name' || key === 'productcode' || key === 'model' || key === 'customcode' ? tStr('') : undefined;
    switch (key) {
      case 'name': return tStr(prod.name);
      case 'productcode': case 'code': return tStr(prod.code ?? '');
      case 'model': return tStr(prod.model ?? '');
      case 'customcode': return tStr(prod.customcode ?? '');
      default: { const c = prod.custom?.[path[0]]; return c == null ? undefined : tStr(c); }
    }
  }

  /* ───────────── 요소 ───────────── */

  findRef(ref: string): PmNode | undefined {
    return this.nodeByRef.get(ref) ?? (ref.startsWith('self') ? this.nodeByRef.get(ref.slice(4)) : undefined);
  }

  /** @참조명.변수[.속성] */
  private refValue(ref: string, path: string[]): Typed | undefined {
    const node = this.findRef(ref);
    if (!node) return undefined;
    return this.nodeAttr(node, path);
  }

  private nodeAttr(node: PmNode, path: string[]): Typed | undefined {
    const [param, ...rest] = path;
    const PROD_KEYS = ['name', 'productcode', 'model', 'customcode'];
    if (param === 'paramStyle' || (isSubModel(node) && !rest.length && PROD_KEYS.includes(param.toLowerCase()) && !node.parameters.some((p) => p.paramName === param))) {
      // 하위 모델 상품 정보 — 이름·형번·코드 (#부품.paramStyle.name · #부품.productcode)
      const key = (param === 'paramStyle' ? rest[0] ?? 'name' : param).toLowerCase();
      const sub = subOf(node);
      const child = sub?.kind === 'param' ? this.opts.catalog?.model?.(sub.id) : undefined;
      const prod = sub ? this.opts.catalog?.product?.(sub.id) : undefined;
      if (key === 'name') return tStr(prod?.name ?? child?.meta.name ?? sub?.name ?? node.name);
      if (key === 'productcode') return tStr(prod?.code ?? '');
      if (key === 'model') return tStr(prod?.model ?? '');
      if (key === 'customcode') return tStr(prod?.customcode ?? '');
      return undefined;
    }
    const v = this.nodeValue(node, param);
    if (!v) return undefined;
    if (!rest.length) return v;
    if (v.k === 's' && v.v.trim().startsWith('{')) {
      // float3/float2 성분 — @MB.position.x
      try {
        const o = JSON.parse(v.v) as Record<string, string>;
        const ax = axisKey(o, rest[0]);
        if (ax) return this.calcIn(node, `${param}.${ax}`, String(o[ax]) || '0');
      } catch { /* 문자열 값 */ }
    }
    const pd = this.paramDef(node, param);
    return this.attrOfValue(v, rest, pd?.type === 'shape' ? 'profile' : undefined);
  }

  private calcIn(node: PmNode, label: string, expr: string): Typed {
    return this.guard(`p|${node.instanceId}.${label}`, `@${node.refName || node.name}.${label}`, () => this.calc(expr, `${node.name} · ${label}`, { nodeId: node.instanceId, param: label }));
  }

  /** 요소 변수 정의 — 정의 파일 → 없으면 parameters 항목의 형식 */
  private paramDef(node: PmNode, param: string): (Pick<ParamDef, 'type' | 'label' | 'value'> & { options?: { value: string }[] }) | undefined {
    const pd = defOf(node)?.params.find((p) => p.name === param);
    if (pd) return pd;
    const p: PmParam | undefined = node.parameters?.find((x) => x.paramName === param);
    return p ? { type: p.valueType ?? 'string', label: p.displayName ?? param, value: p.defaultValue ?? null, options: (p.editorOptions as { value: string }[] | undefined) } : undefined;
  }

  /** 요소 변수 값(스칼라). float3·경로 같은 구조 값은 원문 문자열 */
  nodeValue(node: PmNode, param: string): Typed | undefined {
    const key = `${node.instanceId}.${param}`;
    const hit = this.paramMemo.get(key);
    if (hit) { if (hit instanceof ExprError) throw hit; return hit; }
    const def = defOf(node);
    const pd = this.paramDef(node, param);
    let raw = pv(node, param);
    let out: Typed | undefined;
    try {
      if (raw == null && subOf(node)?.kind === 'param') {
        // 하위 모델 변수 — 부모가 정하지 않았으면 하위 모델의 현재값
        out = this.child(node)?.varTyped(param);
      } else if (raw == null && (param === 'W' || param === 'D' || param === 'H') && def) {
        out = this.elementSize(node, def, param);
      } else {
        if (raw == null) raw = node.parameters?.find((p) => p.paramName === param)?.defaultValue ?? pd?.value ?? '';
        raw = raw ?? '';
        if (isCases(raw)) raw = this.pickCase(raw, `${node.name} · ${pd?.label ?? param}`, { nodeId: node.instanceId, param });
        const structured = pd && !['float', 'int', 'boolean', 'string', 'material', 'shape', 'style', 'positive', 'numberparamname'].includes(pd.type);
        if (structured || raw.trim().startsWith('{') || raw.trim().startsWith('[')) out = tStr(raw);
        else if (raw.trim() === '') out = pd?.type === 'boolean' ? tStr('') : NULL;
        else {
          const lit = literalOrFormula(raw, pd?.type ?? 'float', pd?.options);
          out = lit.literal ? lit.v : this.calcIn(node, pd?.label ?? param, raw);
          if (pd?.type === 'int' && out.k === 'n') out = tNum(Math.trunc(out.v), true);
        }
      }
    } catch (e) {
      const err = e instanceof ExprError ? e : new ExprError((e as Error).message);
      this.paramMemo.set(key, err);
      throw err;
    }
    if (out) this.paramMemo.set(key, out);
    return out;
  }

  /** 수식 하나 계산 (요소 값 → 숫자). 오류는 진단에 남기고 fallback */
  num(node: PmNode, label: string, expr: string | undefined | null, fallback = 0): number {
    if (expr == null || String(expr).trim() === '') return fallback;
    try {
      let e = String(expr);
      if (isCases(e)) e = this.pickCase(e, `${node.name} · ${label}`, { nodeId: node.instanceId, param: label });
      if (!e.trim()) return fallback;
      const t = this.calcIn(node, label, e);
      if (t.k === 'n') return t.v;
      if (t.k === 'b') return t.v ? 1 : 0;
      const n = Number(toStr(t));
      return Number.isNaN(n) ? fallback : n;
    } catch { return fallback; }
  }
  bool(node: PmNode, param: string, fallback = false): boolean {
    try {
      const t = this.nodeValue(node, param);
      if (!t || t.k === 'null' || (t.k === 's' && t.v.trim() === '')) return fallback;
      return truthy(t);
    } catch { return fallback; }
  }
  str(node: PmNode, param: string): string {
    try { const t = this.nodeValue(node, param); return t ? (t.k === 'n' ? fmt(t) : toStr(t)) : ''; } catch { return ''; }
  }
  numParam(node: PmNode, param: string, fallback = 0): number {
    try {
      const t = this.nodeValue(node, param);
      if (!t || t.k === 'null') return fallback;
      if (t.k === 'n') return t.v;
      const n = Number(toStr(t));
      return Number.isNaN(n) ? fallback : n;
    } catch { return fallback; }
  }
  /** float3 / float2 변수 */
  vec(node: PmNode, param: string, fallback: V3 = [0, 0, 0]): V3 {
    const raw = pvOrDef(node, param) ?? '';
    let o: Record<string, string> = {};
    try { o = raw ? JSON.parse(raw) : {}; } catch { this.diag('error', `${node.name} · ${param}`, '좌표 형식 오류', { nodeId: node.instanceId, param }); }
    const label = this.paramDef(node, param)?.label ?? param;
    return [this.num(node, `${label} X`, o.x, fallback[0]), this.num(node, `${label} Y`, o.y, fallback[1]), this.num(node, `${label} Z`, o.z, fallback[2])];
  }

  /** 판재 윤곽 — 점마다 수식 계산 */
  plankShape(node: PmNode, param = 'plankPath'): { shape: PlankShape; num: (p: PmPath, label: string) => NumPathOut } {
    const shape = parsePlankPath(pvOrDef(node, param) ?? '');
    return { shape, num: (p, label) => this.numPath(node, p, label) };
  }
  linePath(node: PmNode, param: string, closedDefault = false): NumPathOut {
    return this.numPath(node, parseLinePath(pvOrDef(node, param) ?? '', closedDefault), this.paramDef(node, param)?.label ?? param);
  }
  numPath(node: PmNode, p: PmPath, label: string): NumPathOut {
    return {
      closed: p.closed,
      points: p.points.map((pt, i) => ({
        x: this.num(node, `${label} 점${i + 1} X`, pt.x), y: this.num(node, `${label} 점${i + 1} Y`, pt.y), type: pt.type,
        radius: pt.type === 1 ? this.num(node, `${label} 점${i + 1} 반지름`, pt.radius) : 0,
        a: pt.type === 2 ? this.num(node, `${label} 점${i + 1} 모따기 a`, pt.chamferA) : 0,
        b: pt.type === 2 ? this.num(node, `${label} 점${i + 1} 모따기 b`, pt.chamferB) : 0,
      })),
      lines: p.lines.map((l, i) => ({
        type: l.type, radius: l.type === 1 ? this.num(node, `${label} 선${i + 1} 반지름`, l.radius) : 0,
        clockwise: !!l.clockwise, minor: l.minor !== false,
      })),
      offset: p.offset ? this.num(node, `${label} 오프셋`, p.offset) : 0,
    };
  }

  /** 요소의 W·D·H (@판재.W 등) — 윤곽 경계 + 두께 */
  private elementSize(node: PmNode, def: ElementDef, param: 'W' | 'D' | 'H'): Typed | undefined {
    if (def.fn === 'PrimitiveModel.plank' || def.fn === 'PrimitiveModel.sideStylePlank') {
      const { shape, num } = this.plankShape(node);
      const pts = num(shape.outline, '윤곽점').points;
      if (!pts.length) return tNum(0);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      if (param === 'W') return tNum(Math.max(...xs) - Math.min(...xs));
      if (param === 'D') return tNum(Math.max(...ys) - Math.min(...ys));
      return tNum(this.numParam(node, 'thickness'));
    }
    if (def.fn === 'PrimitiveModel.grid') return tNum(this.numParam(node, param === 'W' ? 'length' : param === 'D' ? 'width' : 'thickness'));
    const size = def.params.some((p) => p.name === 'size') ? this.vec(node, 'size') : null;
    if (size) return tNum(size[param === 'W' ? 0 : param === 'D' ? 1 : 2]);
    return undefined;
  }

  /* ───────────── 하위 모델 ───────────── */

  /** 하위 모델 id — functionName 이 '#변수'면 그 변수 값(상품 id)으로, 아니면 obsBrandGoodId */
  subModelId(node: PmNode): string | undefined {
    const sub = subOf(node);
    if (!sub) return undefined;
    if (sub.dyn) {
      try { const id = styleId(toStr(this.calcIn(node, '모델 변수', sub.dyn))); if (id) return id; } catch { /* 진단에 남음 */ }
    }
    // 스타일 변수(#CM 등)로 부품 모델 교체 — 문서 3.1.28 ‘样式变量’ (앱에서 만든 모델)
    const ps = pv(node, 'paramStyle');
    if (ps && ps.trim()) {
      try { const id = styleId(toStr(this.calcIn(node, '스타일 변수', ps))); if (id && this.opts.catalog?.model?.(id)) return id; } catch { /* 진단에 남음 */ }
    }
    return sub.id;
  }

  /** 하위 파라메트릭 모델 계산 (부모가 정한 W·D·H·변수 값으로) */
  child(node: PmNode): PmEval | null {
    const sub = subOf(node);
    if (sub?.kind !== 'param') return null;
    const hit = this.childMemo.get(node.instanceId);
    if (hit !== undefined) return hit;
    const depth = (this.opts.depth ?? 0) + 1;
    const modelId = this.subModelId(node) ?? sub.id;
    const m = this.opts.catalog?.model?.(modelId);
    if (!m) { this.diag('error', node.name, `하위 모델 ${sub.name} 을(를) 찾을 수 없습니다`, { nodeId: node.instanceId }); this.childMemo.set(node.instanceId, null); return null; }
    if (depth > 8) { this.diag('error', node.name, '하위 모델이 너무 깊게 중첩되었습니다(8단계)', { nodeId: node.instanceId }); this.childMemo.set(node.instanceId, null); return null; }
    this.childMemo.set(node.instanceId, null); // 자기 순환 방지
    const overrides: Record<string, string> = {};
    const childVars = new Map(allVars(m).map((v) => [v.paramName, v]));
    // [부엌 플래너 수정] 변수로 바뀌는 하위 모델('#변수' — 도어 교체 등)은 인스턴스 값이 자리표시 모델의 기본값 그대로면 넘기지 않는다.
    // 예) KB 장의 도어 자리 MDC='AAA'(KB 공도어 기본값)를 그대로 넘기면 KB7 도어가 자기 도어모델 코드(K_M01993)를 잃어 형상이 전부 숨겨진다.
    // 쿠지알러 동작으로 확인한 것은 아니다 — KB7 · Euro 도어가 원본 그대로 보이게 하는 최소 규칙.
    const dynDefaults = subOf(node)?.dyn ? new Map((node.parameters ?? []).map((p) => [p.paramName, String((p as { defaultValue?: unknown }).defaultValue ?? '')])) : undefined;
    // [부엌 플래너 수정] 인스턴스 재질(materialBrandGoodId)은 하위 모델의 재질 변수(CZ 우선)로 — 도어 → 도어 코어 재질이 여기로 넘어간다
    const mainMat = childVars.has('materialBrandGoodId') ? undefined
      : childVars.get('CZ') ?? [...childVars.values()].find((v) => v.valueType === 'material' && (v.groupTypeId ?? 0) !== 1);
    for (const [k0, expr] of Object.entries(paramMap(node))) {
      const k = k0 === 'materialBrandGoodId' && mainMat ? mainMat.paramName : k0;
      if (k !== k0 && paramMap(node)[k] != null) continue; // 같은 변수를 직접 넘기면 그것이 우선
      const cv = childVars.get(k);
      if (!cv || expr == null || String(expr).trim() === '' || expr === 'None') continue;
      if (dynDefaults && !String(expr).includes('#') && dynDefaults.get(k0) === String(expr)) continue;
      try {
        let e = String(expr);
        if (isCases(e)) e = this.pickCase(e, `${node.name} · ${k}`, { nodeId: node.instanceId, param: k });
        // 좌표(float2·float3) — 성분 수식을 부모 쪽에서 계산해 숫자로 넘김
        if ((cv.valueType === 'float3' || cv.valueType === 'float2') && e.trim().startsWith('{')) {
          try {
            const o = JSON.parse(e) as Record<string, string>;
            overrides[k] = JSON.stringify(Object.fromEntries(Object.entries(o).map(([ax, x]) => [ax, String(this.num(node, `${k}.${ax}`, x, 0))])));
          } catch { /* 형식 오류 — 하위 모델 값 그대로 */ }
          continue;
        }
        // 맞춤 규칙 · 경로 같은 구조 값은 글자 그대로
        if (e.trim().startsWith('{') || e.trim().startsWith('[') || ['fit', 'plankpath', 'loftpath', 'booleanlist'].includes(cv.valueType)) { overrides[k] = e; continue; }
        const lit = cv.valueType === 'material' || cv.valueType === 'style' || cv.valueType === 'shape' || cv.valueType === 'string';
        const t = lit && !isFormulaLike(e) ? tStr(e) : this.calcIn(node, k, e);
        overrides[k] = t.k === 'n' ? String(t.v) : toStr(t);
      } catch { /* 진단은 calcIn 이 남김 */ }
    }
    const ce = new PmEval(m, { catalog: this.opts.catalog, overrides, depth });
    this.childMemo.set(node.instanceId, ce);
    for (const d of ce.diagsAll()) this.diags.push({ ...d, where: `${node.name} › ${d.where}`, nodeId: node.instanceId });
    return ce;
  }

  /** 모든 변수·요소 변수를 한 번씩 계산해 진단을 모은다 */
  diagsAll(): Diag[] {
    for (const v of allVars(this.model)) this.varEval(v.paramName);
    for (const n of nodesOf(this.model)) {
      const def = defOf(n);
      for (const pd of def?.params ?? []) {
        if (['float', 'int', 'boolean', 'string', 'material'].includes(pd.type)) { try { this.nodeValue(n, pd.name); } catch { /* 진단에 남음 */ } }
        else if (pd.type === 'float3' || pd.type === 'float2') this.vec(n, pd.name);
      }
      if (subOf(n)?.kind === 'param') this.child(n);
      for (const p of n.parameters ?? []) {
        const v = p.value;
        if (def?.params.some((x) => x.name === p.paramName) || !v || String(v).trim().startsWith('{') || v === 'None') continue;
        if (!['float', 'int', 'boolean', 'string', 'material', 'style', 'shape'].includes(p.valueType ?? 'float')) continue;
        try { this.nodeValue(n, p.paramName); } catch { /* 진단 */ }
      }
    }
    for (const [k, v] of Object.entries(frameMap(this.model))) if (k === 'size' || k === 'center') this.frameVec(k, v);
    return this.diags;
  }

  /** 모델 외곽 틀 크기·위치 */
  frameVec(param: string, raw: string): V3 {
    let o: Record<string, string> = {};
    try { o = JSON.parse(raw); } catch { /* 기본 */ }
    const n = (e: string | undefined, label: string) => {
      if (!e) return 0;
      try { const t = this.calc(e, `모델 외곽 틀 · ${label}`, {}); return t.k === 'n' ? t.v : Number(toStr(t)) || 0; } catch { return 0; }
    };
    return [n(o.x, `${param} X`), n(o.y, `${param} Y`), n(o.z, `${param} Z`)];
  }

  /** 아무 수식이나 이 모델 안에서 계산 (수식 창 미리보기) */
  try(expr: string): { value?: Typed; error?: string } {
    if (!expr.trim()) return {};
    try { return { value: evaluate(expr, this.scope) }; } catch (e) { return { error: (e as Error).message }; }
  }
}

export interface NumPathOut {
  closed: boolean;
  points: { x: number; y: number; type: 0 | 1 | 2; radius: number; a: number; b: number }[];
  lines: { type: 0 | 1; radius: number; clockwise: boolean; minor: boolean }[];
  offset: number;
}

/* ───────────── 참조 보기 (의존 그래프) ───────────── */

export interface RefEdge { from: string; to: string; via: string }

/** 변수·요소가 누구를 참조하는지 — ‘참조 보기’ 페이지와 이름 바꾸기 확인용 */
export function referenceGraph(m: PmModel): RefEdge[] {
  const edges: RefEdge[] = [];
  const add = (from: string, expr: unknown, via: string) => {
    if (typeof expr !== 'string' || !expr) return;
    if (isCases(expr)) {
      try {
        const o = JSON.parse(expr) as { cases?: { condition?: string; value?: string }[]; defaultValue?: string };
        for (const c of o.cases ?? []) { add(from, c.condition, `${via} 조건`); add(from, c.value, via); }
        add(from, o.defaultValue, via);
      } catch { /* 형식 오류 */ }
      return;
    }
    const d = dependencies(expr);
    for (const v of d.vars) edges.push({ from, to: `#${v}`, via });
    for (const r of d.refs) edges.push({ from, to: `@${r}`, via });
  };
  for (const v of allVars(m)) {
    const scope = scopeOf(m, v);
    const from = `#${v.paramName}`;
    if (usesFormula(v, scope) || kindOf(v) === 'composite') add(from, formulaOf(v, scope), '수식');
    if (!(scope === 'middle' || scope === 'report') && (v.valueType === 'float' || v.valueType === 'int' || isCases(v.value ?? ''))) add(from, v.value, '현재값');
    add(from, v.min, '최솟값'); add(from, v.max, '최댓값'); add(from, v.ignore, '숨김 조건');
    for (const o of v.editorOptions ?? []) add(from, o.ignore, `선택지 ${o.name}`);
  }
  for (const n of nodesOf(m)) {
    const from = n.refName ? `@${n.refName}` : n.name;
    const def = defOf(n);
    if (isSubModel(n) && n.functionName.startsWith('#')) add(from, n.functionName, '모델 변수');
    for (const p of n.parameters ?? []) {
      const raw = p.value;
      if (!raw || raw === 'None') continue;
      const label = def?.params.find((x) => x.name === p.paramName)?.label ?? p.displayName ?? p.paramName;
      if (raw.trim().startsWith('{') && !isCases(raw)) {
        // float3 · 경로 — 안쪽 문자열 수식 모두
        for (const m2 of raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const s = m2[1].replace(/\\"/g, '"'); if (/[#@]/.test(s)) add(from, s.replace(/^\{.*\}$/, ''), label); }
      } else add(from, raw, label);
    }
  }
  return edges;
}

/** 기본 변수(W D H CZ) — 문서 1.1.6 ‘모든 분류에 시스템이 넣는 4개 변수’ (분류 템플릿이 없을 때) */
export function basicVars(w = 600, d = 500, h = 720): PmVar[] {
  const f = (paramName: string, displayName: string, value: string): PmVar => ({
    id: uid('v'), paramName, displayName, valueType: 'float', paramTypeId: 1, groupTypeId: 0, value, min: '0', max: '10000', scriptName: paramName, visible: true,
    ignore: '', editorOptions: [], editorRecommends: [], extAttr: {},
  });
  return [
    f('W', '폭', String(w)), f('D', '깊이', String(d)), f('H', '높이', String(h)),
    { id: uid('v'), paramName: 'CZ', displayName: '재질', valueType: 'material', paramTypeId: 0, groupTypeId: 0, value: '', scriptName: 'materialBrandGoodId', visible: true, ignore: '', editorOptions: [], editorRecommends: [], extAttr: {} },
  ];
}

/** 모델 외곽 틀 기본 요소 (실제 모델 frameModels 와 같은 값) */
export const defaultFrameNode = (): PmNode => ({
  instanceId: '0', uniqueId: uid('u'), name: '矩形外框', functionName: DEFS.frame.fn, functionTypeId: null, refName: null,
  parameters: DEFS.frame.params.map((p) => ({ paramName: p.name, valueType: p.type, displayName: p.zh, value: p.name === 'invokedPosType' ? '2' : p.value ?? p.def ?? null, groupTypeId: p.group, visible: p.visible, editable: true })),
  bizProperties: [], customParamGroups: [], depends: null, usedBy: null,
});

/** 모델 속성 기본 요소 (ParamModel.paramModel) */
export const defaultPropsNode = (): PmNode => ({
  instanceId: '-1', uniqueId: uid('u'), name: '', functionName: DEFS.model.fn, functionTypeId: null, refName: null,
  parameters: DEFS.model.params.map((p) => ({ paramName: p.name, valueType: p.type, displayName: p.zh, value: p.value ?? p.def ?? null, groupTypeId: p.group, visible: p.visible, editable: true })),
  bizProperties: [], customParamGroups: [], depends: null, usedBy: null,
});
