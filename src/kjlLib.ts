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

/* 단면(프로파일) — 스윕 · 로프트 부품(액자 도어 테두리 · 찬넬 · 몰딩)의 쿠지알러 단면. profiles.json(tools/build_profiles.py · probe-profiles.ts).
 * 좌표가 없으면 계산기가 18×18 네모로 대신 그려 도어 앞면이 깨져 보인다 — 받은 단면만 profiles 에 있다 */
export interface ProfileData { name: string; w: number; h: number; points: [number, number][] }
let prof: { profiles: Record<string, ProfileData>; info: Record<string, { name: string; img?: string }>; needs: Record<string, string[]> } = { profiles: {}, info: {}, needs: {} };
export async function loadCatalog(): Promise<KitchenCatalog> {
  if (!cat) {
    const [c, p] = await Promise.all([readJson('catalog.json'), readJson('profiles.json').catch(() => null)]);
    cat = c as KitchenCatalog;
    if (p) { const q = p as Partial<typeof prof>; prof = { profiles: q.profiles ?? {}, info: q.info ?? {}, needs: q.needs ?? {} }; }
    // 제대로 그려지지 않는 도어는 목록에서 뺀다(사용자 2026-11-12 「제대로 표현되지 않는 도어 모델은 삭제해」) — 원본 자료는 그대로 두고 여기서만 거른다.
    //   쿠지알러 단면을 받아 profiles.json 에 들어오면 저절로 다시 나온다. 그레이드의 도어가 모두 빠지면 그대로 둔다
    for (const g of cat.grades) { const ok = g.doors.filter((x) => !doorBroken(x.obs).length); if (ok.length) g.doors = ok; }
    // 키친바흐 포켓 폴딩장(2D) — 원본이 문틀 · 포켓 문짝뿐이고 안이 비어, 문을 접어 넣으면 빈 틀만 선다(가까이 찍어 확인 2026-11-12) → 장 목록에서 뺀다
    cat.modules = cat.modules.filter((m) => !(m.key === 'foldTall' && m.series === 'KB'));
  }
  return cat;
}
export const profileOf = (id: string): ProfileData | undefined => prof.profiles[id];
/** 도어 쪽 단면(이름에 「도어」) 중 좌표가 없는 것의 이름 — 그 도어는 몰딩 · 손잡이 일부가 18×18 네모로 근사된다. 없으면 [] */
export const doorGaps = (obs: string): string[] =>
  (prof.needs[obs] ?? []).filter((p) => !prof.profiles[p] && /도어/.test(prof.info[p]?.name ?? '')).map((p) => prof.info[p]?.name ?? p);
/** 앞판 · 액자 테두리를 단면 스윕으로 만드는 도어(맨하탄 MHT · 아티잔 · 첼시) — 단면이 없으면 앞판이 떠 있고 속이 보일 만큼 깨진다(같은 시점 확인 2026-11-06).
 *  첼시는 액자 테두리(외곽 · 안쪽 몰딩)가 18×18 네모로 그려져 문짝 둘레로 장 속이 보인다(가까이 찍어 확인 2026-11-12).
 *  그레이스 · 베일 · 페이지는 손잡이 · 옆마감만 근사되고 앞판은 정상이라 둔다 */
const FACE = /맨하탄|아티산|첼시/;
export const doorBroken = (obs: string): string[] => doorGaps(obs).filter((n) => FACE.test(n));
/** 고를 수 있는 도어 — 깨져 보이는 도어는 뺀다(모두 그렇면 그대로) */
export function usableDoors(g: GradeDef): DoorDef[] {
  const ok = g.doors.filter((x) => !doorBroken(x.obs).length);
  return ok.length ? ok : g.doors;
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

export const kjlCatalog: Catalog = { model: modelOf, product, profile: profileOf };
