// 프롬프트 — 말로 준 조건을 설계 설정으로 (규칙 해석 · LLM 아님). 알아들은 것과 못 알아들은 말을 돌려준다
import type { KitchenCatalog } from './kjlLib';
import { newOpening, viewWalls, type Want, type Design, type LayoutKind, type OpeningKind, type StyleKind, type WallId } from './plan';

const LAYOUT: [RegExp, LayoutKind, string][] = [
  [/ㄷ\s*자|디귿|ㄷ형|u\s*자|U\s*자/i, 'U', 'ㄷ자'],
  [/(ㄱ\s*자|기역|ㄱ형)\s*(반대|뒤집|오른쪽)|오른쪽\s*(ㄱ\s*자|기역)|역\s*ㄱ\s*자/i, 'Lr', 'ㄱ자 반대'],
  [/ㄱ\s*자|기역|ㄱ형|l\s*자|L\s*자|코너형/i, 'L', 'ㄱ자'],
  [/11\s*자|병렬|마주\s*보/, 'II', '11자'],
  [/ㅡ\s*자|일자|1\s*자|한\s*쪽\s*벽|한\s*벽/, 'I', 'ㅡ자'],
];
const STYLE: [RegExp, StyleKind, string][] = [
  [/카페|오픈\s*선반|선반\s*많/, 'cafe', '카페 스타일'],
  [/수납|넉넉|많이\s*넣|키큰장\s*많|팬트리\s*처럼/, 'storage', '수납 많이'],
  [/기본|일반|무난|평범/, 'basic', '일반'],
];
const GRADE: [RegExp, string, string][] = [
  [/kb\s*7|키친바흐\s*7|최고급|하이엔드/i, 'kb7', '키친바흐 KB7'],
  [/kb\s*5|키친바흐|바흐/i, 'kb5', '키친바흐 KB5'],
  [/(유로|euro|eo)\s*900|프리미엄|고급/i, 'e900', '유로 900'],
  [/(유로|euro|eo)\s*700/i, 'e700', '유로 700'],
  [/(유로|euro|eo)\s*500|중급/i, 'e500', '유로 500'],
  [/(유로|euro|eo)\s*300|저렴|가성비|기본\s*등급|싼/i, 'e300', '유로 300'],
];
/** 도어 색 — 원본 도어 이름에서 찾는 말 */
const COLOR: [RegExp, RegExp, string][] = [
  [/화이트|흰|하얀|white/i, /white|wh\b|화이트|cotton|blanc|bianco|크림/i, '화이트'],
  [/오크|나무|우드|원목|oak/i, /oak|오크|wood/i, '오크'],
  [/월넛|walnut|진한\s*나무/i, /walnut|월넛/i, '월넛'],
  [/그레이|회색|gray|grey/i, /gr[ae]y|그레이|stone|concrete|mg\b/i, '그레이'],
  [/블랙|검정|까만|black/i, /black|bk\b|블랙|jet|charcoal|차콜|espresso/i, '블랙'],
  [/네이비|남색|navy/i, /navy|네이비/i, '네이비'],
  [/그린|초록|녹색|green|세이지/i, /green|그린|sage|avocado/i, '그린'],
  [/베이지|beige|모카|라떼/i, /beige|베이지|mocha|모카|latte|dune|듄/i, '베이지'],
];
const COUNTER: [RegExp, RegExp, string][] = [
  [/블랙\s*마블|검은\s*대리석|마블\s*블랙/, /마블 블랙/, '마블 블랙'],
  [/마블|대리석/, /마블 화이트|베네토/, '마블'],
  [/스텐|스테인|stainless/i, /스테인/, '스테인리스'],
  [/테라조/, /테라조/, '테라조'],
  [/콘크리트|시멘트/, /콘크리트/, '콘크리트'],
  [/다크\s*상판|어두운\s*상판|글램/, /글램다크/, '글램다크'],
  [/(흰|화이트)\s*상판|상판\s*(흰|화이트)/, /코튼화이트/, '코튼화이트'],
];
const ROOMS: [RegExp, OpeningKind, string][] = [
  [/팬트리/, 'pantry', '팬트리'],
  [/다용도실|세탁실/, 'utility', '다용도실'],
  [/서브\s*주방|보조\s*주방|뒷\s*주방/, 'subkitchen', '서브주방'],
];
const NEG = /(없|빼|말고|제외|지워|안\s*넣|필요\s*없)/;
const num = (s: string) => { const v = Number(s.replace(/,/g, '')); return s.includes('.') || v < 20 ? v * 1000 : v; };

export function applyPrompt(text: string, d: Design, cat: KitchenCatalog): { applied: string[]; unknown: string[] } {
  const applied: string[] = [];
  const t = text.trim();
  // 문장을 조각으로 — 각 조각에서 부정어를 본다
  const want = (w: Want) => { d.wants = [...new Set([...(d.wants ?? []), w])]; };
  const parts = t.split(/[,，.。]|그리고|하고(?!\s*싶)|에다|이고|\s+및\s+/).map((x) => x.trim()).filter(Boolean);
  const used = new Set<string>();
  const mark = (p: string) => used.add(p);
  let saidStorage = false;
  const prevStyle = d.style, saysPantry = /코너\s*팬트리|팬트리\s*장/.test(t);
  for (const p of parts) {
    const neg = NEG.test(p);
    // 코너 팬트리장(장) — 공간 요소 「팬트리」(벽 너머 방)와 구분
    const cornerP = /코너\s*팬트리|팬트리\s*장/.test(p);
    if (cornerP) { d.cornerPantry = !neg; applied.push(neg ? '코너 팬트리장 없음' : '코너 팬트리장'); mark(p); }
    for (const [re, v, name] of LAYOUT) if (re.test(p)) { d.layout = v; applied.push(name); mark(p); break; }
    if (/아일랜드|섬\s*식탁|바\s*테이블|홈\s*바/.test(p)) { d.island = !neg; if (!/식사|밥\s*먹|아침\s*먹/.test(p)) applied.push(neg ? '아일랜드 없음' : '아일랜드'); mark(p); }
    for (const [re, v, name] of STYLE) if (re.test(p)) { if (v === 'storage') { want('storage'); saidStorage = true; } d.style = v; applied.push(v === 'cafe' ? '카페 스타일 — 폴딩 카페장 · 폴딩 상부장 · 오픈 선반' : name); if (v === 'cafe' && !/아일랜드/.test(t)) d.island = true; mark(p); break; }
    // 바라는 느낌 · 쓰임 — 구성으로 풀어 준다
    if (/답답|트인|탁\s*트|개방|넓어\s*보|시원|좁아\s*보이지/.test(p)) {
      // 위가 막히지 않게(상부 오픈 선반 · 폴딩장) · 밝은 도어 · 통로를 막는 아일랜드는 빼고 ㄷ자는 ㄱ자로
      if (!/수납/.test(t)) d.style = 'cafe';
      if (!/아일랜드/.test(t)) d.island = false;
      if (d.layout === 'U' && !/ㄷ\s*자|디귿/.test(t)) d.layout = 'L';
      const g = cat.grades.find((x) => x.id === d.grade), white = g?.doors.find((x) => /white|wh\b|화이트|cotton|크림/i.test(x.name));
      if (white && !COLOR.some(([re]) => re.test(t))) d.door = white.obs;
      want('open');
      applied.push('답답하지 않게 — 상부는 오픈 선반 · 폴딩장, 밝은 도어, 아일랜드 없이 통로 넓게');
      mark(p);
    }
    if (/동선|편하게|편한|일하기\s*편|움직임/.test(p)) {
      // 싱크 · 쿡탑 · 냉장고 삼각형이 짧게 — ㄱ자, 사용자가 옮긴 자리는 풀어 자동으로
      if (!LAYOUT.some(([re]) => re.test(t))) d.layout = 'L';
      delete d.fix; delete d.fridgeAt;
      want('flow');
      applied.push('동선이 편하게 — ㄱ자 · 싱크 · 쿡탑 · 냉장고 작업 삼각형을 짧게 자동 배치');
      mark(p);
    }
    if (/식사|밥\s*먹|식탁\s*겸|아침\s*먹|홈\s*바/.test(p) && !neg) {
      d.island = true; d.islandCfg = { ...d.islandCfg, style: 'table' };
      want('dine');
      applied.push('아일랜드에서 식사 — 끝에 연계형 식탁');
      mark(p);
    }
    if (/요리.*(자주|많이)|(자주|많이).*요리|조리\s*공간|베이킹|오븐/.test(p)) {
      // 넓은 조리대 · 서랍 많이 · 오븐장 — 수납 많이 스타일이 오븐 · 서랍을 넣는다
      if (!/카페/.test(t)) d.style = 'storage';
      want('cook');
      applied.push('요리를 자주 — 넓은 조리대 · 서랍 · 오븐장');
      mark(p);
    }
    for (const [re, v, name] of GRADE) if (re.test(p)) { d.grade = v; applied.push(name); mark(p); break; }
    const g = cat.grades.find((x) => x.id === d.grade);
    for (const [re, pat, name] of COLOR) if (re.test(p) && !/상판|타일|벽|바닥/.test(p)) {
      const door = g?.doors.find((x) => pat.test(x.name));
      if (door) { d.door = door.obs; applied.push(`도어 ${name}`); } else applied.push(`도어 ${name} (이 그레이드엔 없음)`);
      mark(p); break;
    }
    if (/상판|대리석|마블|스텐|테라조|콘크리트/.test(p)) for (const [re, pat, name] of COUNTER) if (re.test(p)) {
      const c = cat.counters.find((x) => pat.test(x.name));
      if (c) { d.counter = c.id; applied.push(`상판 ${name}`); mark(p); }
      break;
    }
    for (const [re, kind, name] of ROOMS) if (re.test(p) && !(cornerP && kind === 'pantry')) {
      const has = d.openings.some((o) => o.kind === kind);
      if (neg && has) { d.openings = d.openings.filter((o) => o.kind !== kind); applied.push(`${name} 빼기`); }
      else if (!neg && !has) {
        const wall = ([2, 1, 0, 3] as WallId[]).find((w) => w !== d.openWall) ?? 2;
        d.openings.push(newOpening(kind, d.room, wall)); applied.push(`${name} 추가`);
      }
      mark(p);
    }
    // 크기 — 가로 4200 · 세로 3.6m · 천장 2400 · 4200x3600
    const wh = p.match(/(\d[\d.,]*)\s*(?:mm|m|미터)?\s*[x×*]\s*(\d[\d.,]*)/i);
    // 가로 = 정면 벽 길이 · 세로 = 옆 벽 (정면이 왼/오른쪽 벽이면 방 d 축이 가로)
    const hx = viewWalls(d.openWall).front % 2 === 0 ? 'w' : 'd', vx = hx === 'w' ? 'd' : 'w';
    if (wh) { d.room[hx] = num(wh[1]); d.room[vx] = num(wh[2]); applied.push(`방 ${d.room[hx]}×${d.room[vx]}`); mark(p); }
    for (const [re, k, name] of [[/(가로|폭|너비)\s*(\d[\d.,]*)/, hx, '가로'], [/(세로|깊이)\s*(\d[\d.,]*)/, vx, '세로'], [/(높이|천장)\s*(\d[\d.,]*)/, 'h', '천장']] as const) {
      const m = p.match(re);
      if (m) { const v = num(m[2]); if (v > 1500 && v < 9000) { d.room[k] = v; applied.push(`${name} ${v}`); mark(p); } }
    }
    if (/냉장고/.test(p)) {
      if (/빌트인|붙박이|매립|콤비/.test(p) && !neg) { d.fridgeKind = 'builtin'; applied.push('빌트인 냉장고장'); mark(p); }
      else if (/4\s*도어|포\s*도어|프렌치/.test(p)) { d.fridgeKind = 'quad'; applied.push('4도어 냉장고'); mark(p); }
      else if (/양문|사이드\s*바이\s*사이드/.test(p)) { d.fridgeKind = 'sbs'; applied.push('양문형 냉장고'); mark(p); }
      else if (/비스포크|1\s*도어|두\s*대|2\s*대|프리스탠딩/.test(p)) { d.fridgeKind = 'twin'; applied.push('냉장고 1도어 2대'); mark(p); }
    }
    // 카탈로그 구성 — 유리 벽장 · 아일랜드 쿡탑 · 통판(돌) 아일랜드 · 원형 식탁 아일랜드 · 오븐
    if (/유리\s*(장|벽장|상부장|도어)/.test(p)) { d.glassAccent = !neg; applied.push(neg ? '유리장 없음' : '상부장 하나를 유리장으로'); mark(p); }
    if (/아일랜드.*(쿡탑|인덕션|화구)|(쿡탑|인덕션|화구).*아일랜드/.test(p) && !neg) {
      d.island = true; d.fix = { ...(d.fix ?? {}), hob: { wall: 0, c: d.islandCfg.len / 2, island: true } };
      applied.push('쿡탑을 아일랜드에 — 천장형 후드'); mark(p);
    }
    if (/(통판|돌|대리석|트레버틴|스톤)\s*아일랜드|아일랜드.*(통판|감싸)/.test(p) && !neg) { d.island = true; d.islandCfg = { ...d.islandCfg, style: 'waterfall' }; applied.push('통판 마감 아일랜드(돌로 감싼 아일랜드)'); mark(p); }
    if (/원형\s*식탁.*아일랜드|아일랜드.*원형/.test(p) && !neg) { d.island = true; d.islandCfg = { ...d.islandCfg, style: 'round' }; applied.push('아일랜드 끝에 원형 식탁'); mark(p); }
    if (/오븐/.test(p) && !/요리/.test(p)) { if (!neg) want('cook'); applied.push(neg ? '오븐 없음' : '쿡탑 옆 빌트인 오븐장'); mark(p); }
    if (/창밖|풍경/.test(p)) mark(p);
    if (/싱크.*창|창.*싱크/.test(p)) { if (d.fix) delete d.fix.sink; applied.push('싱크 창가 우선'); mark(p); }
  }
  // 수납 많이 ↔ 코너 팬트리장 체크 — 스타일 버튼과 같은 규칙(문장에 팬트리장을 직접 말했으면 그 말대로)
  if (!saysPantry && d.style === 'storage' && (saidStorage || prevStyle !== 'storage')) { d.cornerPantry = true; applied.push('코너 팬트리장 (수납 많이)'); }
  else if (!saysPantry && prevStyle === 'storage' && d.style !== 'storage') d.cornerPantry = false;
  // 겹친 조건 정리
  const uniq = [...new Set(applied)];
  const unknown = parts.filter((p) => !used.has(p));
  return { applied: uniq, unknown };
}
