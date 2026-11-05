// 쿠지알러 부엌 원본 저장소 — public/kjl (tools/build_kitchen_data.py 산출물)
// 계산기(src/kjl)는 하위 모델을 동기로 찾으므로, 계산 전에 ensure() 로 하위 모델까지 미리 받아 둔다.
import type { Catalog } from './kjl/resolve';
import { NODE_SECTIONS, type PmModel } from './kjl/types';

export type Series = 'EO' | 'KB';
export type ModuleKind = 'base' | 'wall' | 'tall' | 'shelf';
export interface WSpec { value?: string; type?: number; options?: number[]; min?: number; max?: number }
export interface ModuleDef {
  key: string; kind: ModuleKind; label: string; series: Series | '*'; obs: string; name: string;
  W: WSpec | null; D: number; H: number; doorVar: string | null;
  /** 비규격 폭 범위(원본 W_MIN · W_MAX) — nstd 면 STD_YN=true · NSTD_W 로 아무 폭이나 */
  wmin?: number | null; wmax?: number | null; nstd?: boolean;
}
export interface DoorDef { obs: string; name: string; line: string; img?: string }
export interface GradeDef { id: string; label: string; series: Series; var: string; doors: DoorDef[] }
export interface ProductDef { name?: string; model?: string; tex?: 1 }
export interface MatDef { id: string; name: string; size: number }
export interface TileDef { id: string; name: string; size: [number, number] }
export interface SurfDef { id: string; name: string; size: [number, number]; map: string; thumb: string }
export interface KitchenCatalog {
  modules: ModuleDef[]; grades: GradeDef[]; products: Record<string, ProductDef>;
  counters: MatDef[]; tiles: TileDef[]; floors: SurfDef[]; walls: SurfDef[];
}

type RawModel = { prodCatId?: number; paramCategoryTypePos?: number[]; editorData: PmModel['editorData']; name: string; tool: string };

const BASE = `${import.meta.env?.BASE_URL ?? './'}kjl/`;
/** 시험(node)에서는 파일로 읽도록 바꿔 끼운다 */
export let readJson: (path: string) => Promise<unknown> = (p) => fetch(BASE + p).then((r) => { if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
export function setReader(f: (path: string) => Promise<unknown>) { readJson = f; }
export const texUrl = (id: string) => `${BASE}tex/${id}.jpg`;

let cat: KitchenCatalog | undefined;
const models = new Map<string, PmModel>();
const pending = new Map<string, Promise<void>>();
const missing = new Set<string>();

export async function loadCatalog(): Promise<KitchenCatalog> {
  cat ??= (await readJson('catalog.json')) as KitchenCatalog;
  return cat;
}
export const catalogNow = () => cat!;

/** 2D 도면 표시용 X 자 판(식기세척기 자리 · 규격 외 표시) — 3D 에선 그리지 않는다 */
const MARKERS = new Set(['3FO4G6N6UAOF', '3FO3OOEOCN5P']);

function toModel(obs: string, d: RawModel): PmModel {
  if (MARKERS.has(obs)) for (const k of NODE_SECTIONS) if (Array.isArray((d.editorData as unknown as Record<string, unknown>)[k])) (d.editorData as unknown as Record<string, unknown[]>)[k] = [];
  return {
    prodCatId: d.prodCatId, paramCategoryTypePos: d.paramCategoryTypePos, editorData: d.editorData, kjl: {},
    meta: { id: obs, obs, name: d.name, tooltype: d.tool as PmModel['meta']['tooltype'], library: '쿠지알러', category: '', version: 0, versions: [], createdAt: 0, updatedAt: 0 },
  };
}

/** 하위 모델 id — 고정(obsBrandGoodId)과 변수로 바뀌는 것('#변수' 의 기본값)까지 */
function subIdsOf(m: PmModel): string[] {
  const out: string[] = [];
  for (const n of m.editorData.modelInstances ?? []) if (n.obsBrandGoodId) out.push(n.obsBrandGoodId);
  return out;
}

/** 모델과 그 하위 모델 전부를 받아 둔다 (없는 것 — 3D 메시 하위 모델 — 은 건너뜀) */
export function ensure(obs: string): Promise<void> {
  if (models.has(obs) || missing.has(obs)) return Promise.resolve();
  let p = pending.get(obs);
  if (!p) {
    p = (readJson(`m/${obs}.json`) as Promise<RawModel>)
      .then((d) => { const m = toModel(obs, d); models.set(obs, m); return Promise.all(subIdsOf(m).map(ensure)); })
      .then(() => undefined, () => { missing.add(obs); });
    pending.set(obs, p);
  }
  return p;
}

export const modelOf = (id: string) => models.get(id);

/** 계산기 상품 조회 — 재질(텍스처) · 도어 형번(#EM_DR.model) · 이름 */
export function product(id: string) {
  const p = cat?.products[id];
  if (!p) return undefined;
  return { name: p.name ?? id, model: p.model, ...(p.tex ? { texture: id } : {}) };
}

export const kjlCatalog: Catalog = { model: modelOf, product };
