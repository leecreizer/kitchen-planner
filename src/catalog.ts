// 한샘 부엌 카탈로그(Hanssem_Kitchen_EOML_2609, 2026.09 발행) 기준 이름 · 묶음 — 원본(쿠지알러) 도어 · 상판 이름을 카탈로그 표기로
// 카탈로그에 없는 원본(키친바흐 · 단종 등)은 원본 이름을 다듬어 쓴다.
import APPS from './appliances.json';

export interface DoorLabel { line: string; color: string; badge?: 'BEST' | 'NEW' }

/** 라인 — 원본 이름 머리 → 카탈로그 라인명 · 표시(목차 기준: 캔버스 BEST · 그레이스 · 베일 · 젠 · 브러쉬 NEW) */
const LINES: [RegExp, string, DoorLabel['badge']?][] = [
  [/CVS\/Gloss/i, '캔버스 글로스', 'BEST'], [/CVS\/Matt/i, '캔버스 매트', 'BEST'],
  [/Artisan/i, '아티잔'], [/Tate/i, '테이트'],
  [/Grace/i, '그레이스', 'NEW'], [/Veil/i, '베일', 'NEW'],
  [/Zen/i, '젠', 'NEW'], [/Scandi/i, '스칸디'], [/Chelsea/i, '첼시'], [/PG\//i, '페이지'], [/Classic/i, '유로클래식'],
  [/Brush/i, '브러쉬', 'NEW'], [/Matt/i, '매트'], [/Origin/i, '오리진'], [/LT\//i, '레더'], [/TC\//i, '터치'], [/EO\/WH/i, '유로'],
  [/Bach H\/G/i, '바흐 하이글로시'], [/Bach Matt/i, '바흐 매트'], [/MHT H\/G/i, 'MHT 하이글로시'], [/MHT Matt/i, 'MHT 매트'],
];
/** 색 — 원본 약칭 → 카탈로그 색 이름 */
const COLORS: [RegExp, string][] = [
  [/E\/Grey/i, '얼그레이'], [/O\/CR/i, '오트크림'], [/B\/Oak/i, '베이지오크'], [/A\/Oak/i, '앰버오크'],
  [/W\/Cotton/i, '웜코튼'], [/\bMG\b/, '매그놀리아'], [/Bianco/i, '비앙코'], [/Caligo/i, '칼리고'], [/S\/Walnut/i, '스모키 월넛'], [/A\/Walnut/i, '애쉬 월넛'], [/N\/Oak/i, '내추럴 오크'],
  [/Mocha/i, '모카'], [/Latte/i, '라테'], [/TC\/BK/i, '블랙'], [/TC\/GR/i, '그레이'], [/TC\/WH/i, '화이트'], [/EO\/WH/i, '화이트'],
  [/Stone/i, '스톤'], [/Mush/i, '머쉬룸'], [/Cloud/i, '클라우드'], [/Sage/i, '세이지'], [/PG\/RG/i, '로즈그레이'], [/Off WH/i, '오프화이트'], [/Avocado/i, '아보카도'],
  [/Hazelnut/i, '헤이즐넛'], [/Espresso/i, '에스프레소'],
  [/Shade/i, '쉐이드'], [/BRZ/i, '브리즈'], [/ETP/i, '에토프'],
  [/Artisan BB/i, '블루벨'], [/Tate H/i, '매그놀리아 (가로)'], [/Tate V/i, '매그놀리아 (세로)'],
];

/** 도어 이름 → 카탈로그 라인 · 색 · 표시 */
export function doorLabel(name: string): DoorLabel {
  const ln = LINES.find(([re]) => re.test(name));
  const line = ln?.[1] ?? name.replace(/^\(P\)/, '').split(/\s+/).slice(0, 2).join(' ');
  // 캔버스 · 키친바흐는 원본 이름 끝에 한글 색이 붙어 있다
  const ko = name.match(/[가-힣][가-힣\s]*$/)?.[0].trim();
  const cl = COLORS.find(([re]) => re.test(name));
  const color = ko ?? cl?.[1] ?? name.replace(/^(\(P\))?(Euro|EO|KB)\d+\s*/, '');
  return { line, color, badge: ln?.[2] };
}

/** 카탈로그에 실렸지만 원본(쿠지알러 받은 자료)에 없는 도어 — 알림용 */
export const DOOR_MISSING: Record<string, string[]> = {
  e500: ['스칸디 세이지', '유로클래식 화이트'],
};

/** 상판 — 카탈로그 소재 등급(고급형 · 표준형)과 소재 */
export function counterLabel(name: string): { group: string; name: string } {
  if (/스테인/.test(name)) return { group: '스테인리스', name: name.replace(/^HS스톤\s*/, '') };
  if (/세라믹/.test(name)) return { group: '세라믹', name };
  if (/HS스톤|엔지니어드|쿼츠/.test(name)) return { group: '인조대리석 (HS스톤)', name: name.replace(/^HS스톤\s*/, '') };
  return { group: '기타 (원본)', name };
}

/* ───────── 가전 — 한샘 가전 카탈로그(Hanssem_Appliances_2609) 규격표에서 읽은 것 ───────── */
export type ApplianceCat = 'hob' | 'hood' | 'sink' | 'faucet' | 'dish' | 'oven' | 'fridge';
export interface Appliance { cat: ApplianceCat; name: string; model: string; size?: [number | null, number | null, number | null]; cut?: [number | null, number | null]; badge?: 'BEST' | 'NEW'; type?: string }
export const APPLIANCES = APPS as Appliance[];
export const APPLIANCE_CATS: [ApplianceCat, string][] = [['hob', '쿡탑'], ['hood', '후드'], ['sink', '싱크볼'], ['faucet', '수전'], ['dish', '식기세척기'], ['oven', '오븐']];
/** 기본 — 지금 3D 모델과 같은 것(쿡탑 밀레 4구 626×526 · 싱크볼 818×450 에 가까운 CQ820 · 빌트인 후드 900 슬림) */
/** 후드 설치 방식 — builtin 후드장 안 · chimney 벽에 거는 침니(후드장 없이 그 자리 비움) · ceiling 천장에 매다는 아일랜드형 */
export type HoodKind = 'builtin' | 'chimney' | 'ceiling';
export function hoodKindOf(a: Appliance | undefined): HoodKind {
  const t = a?.type ?? '';
  if (/빌트인/.test(t)) return 'builtin';
  if (/벽부|벽 부착/.test(t)) return 'chimney';
  if (/천정|천장|아일랜드/.test(t)) return 'ceiling';
  return 'builtin';
}
/** 아일랜드 쿡탑 위 기본 후드 — 고른 후드가 천장형이 아니면 */
export const ISLAND_HOOD_DEFAULT = 'HDC-HSSI136H';
export const APPLIANCE_DEFAULT: Partial<Record<ApplianceCat, string>> = { hob: 'CIR-KM7564FR', sink: 'SSU-CQ820', hood: 'HDB-HSBI290T', dish: 'DWB-HS7160MD' };
export const applianceOf = (cat: ApplianceCat, model?: string) =>
  APPLIANCES.find((a) => a.cat === cat && a.model === (model ?? APPLIANCE_DEFAULT[cat])) ?? APPLIANCES.find((a) => a.cat === cat && a.model === APPLIANCE_DEFAULT[cat]);
