// 프롬프트 AI 해석 — 말로 준 요청을 Claude · Gemini · GPT 가 설계 값으로 바꾼다(사용자 2026-11-06). 장 하나하나는 그대로 자동 배치가 놓는다:
// AI 는 공간 · 구조 · 아일랜드 · 스타일 · 바라는 것 · 그레이드 · 도어 · 상판 · 마감 · 냉장고 · 식탁 · 가전 · 공간 요소만 고른다.
// 고를 수 있는 값은 목록으로 주고, 돌아온 값은 다시 검사해(목록 밖 · 범위 밖은 버림) 적용한다. 부르는 곳은 개발 서버 중계(/api/ai, server/aiProxy.ts)
import { applianceOf, APPLIANCES, APPLIANCE_CATS } from './catalog';
import { usableDoors, type KitchenCatalog } from './kjlLib';
import { FRIDGE_COLORS, newOpening, viewWalls, WANT_LABEL, type Design, type IslandStyle, type LayoutKind, type OpeningKind, type StyleKind, type Want } from './plan';

export type AiProvider = 'claude' | 'gemini' | 'gpt';
/** 고를 수 있는 모델 — 첫째가 기본 */
export const AI_MODELS: Record<AiProvider, { label: string; models: string[] }> = {
  claude: { label: 'Claude', models: ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  gemini: { label: 'Gemini', models: ['gemini-3.1-pro-preview', 'gemini-2.5-flash'] },
  gpt: { label: 'GPT', models: ['gpt-5', 'gpt-5-mini'] },
};

/** 중계 서버에 어느 곳 키가 있는지 — 정적 배포(중계 없음)면 null */
export async function aiStatus(): Promise<Record<AiProvider, boolean> | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}api/ai`, { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
    return (await r.json()).providers ?? null;
  } catch { return null; }
}

const LAYOUTS: Record<string, LayoutKind> = { I: 'I', L: 'L', Lr: 'Lr', U: 'U', II: 'II' };
const STYLES: StyleKind[] = ['basic', 'cafe', 'storage'];
const ISLAND_STYLES: IslandStyle[] = ['basic', 'double', 'waterfall', 'table', 'round'];
const WANTS = Object.keys(WANT_LABEL) as Want[];
const ROOM_KINDS: Record<string, [OpeningKind, string]> = { pantry: ['pantry', '팬트리'], utility: ['utility', '다용도실'], subkitchen: ['subkitchen', '서브주방'] };
const clamp = (v: unknown, a: number, b: number) => (typeof v === 'number' && isFinite(v) ? Math.max(a, Math.min(b, Math.round(v / 10) * 10)) : undefined);

function systemPrompt(cat: KitchenCatalog): string {
  const list = <T>(xs: T[], f: (x: T) => string) => xs.map(f).join(' / ');
  const apps = APPLIANCE_CATS.filter(([k]) => k !== 'fridge').map(([k, label]) => `  ${k}(${label}): ${list(APPLIANCES.filter((a) => a.cat === k), (a) => `${a.model} ${a.name}`)}`).join('\n');
  return `너는 한샘 부엌 셀프 설계 앱의 설계 비서다. 사용자의 말을 앱의 설계 값으로 바꾼다.
장(캐비닛) 하나하나의 배치는 앱의 자동 배치 엔진이 정한다 — 너는 아래 값 중 바꿀 것만 고른다. 반드시 JSON 객체 하나만 출력한다(설명 글 · 코드 블록 없이).

출력 형식:
{"changes": {...바꿀 항목만...}, "rooms": [{"kind": "pantry|utility|subkitchen", "wall": "front|left|right", "remove": false}], "applied": ["바꾼 것을 한글로 짧게"], "unknown": ["반영하지 못한 요청"], "reply": "사용자에게 한두 문장"}

changes 항목(이 이름 · 이 값만):
- roomFront: 정면 벽 길이 mm(1800~9000), roomSide: 옆 벽 길이 mm(1800~9000), ceiling: 천장 높이 mm(2200~2800)
- layout: "I"(ㅡ자 정면 한 벽) | "L"(ㄱ자 왼쪽+정면) | "Lr"(ㄱ자 반대 정면+오른쪽) | "U"(ㄷ자 정면+양옆) | "II"(11자 양옆)
- island: true|false, islandLen: 1200~3600, islandStyle: "basic"(일자) | "double"(양면 수납) | "waterfall"(통판 돌 마감) | "table"(연계형 식탁) | "round"(원형 식탁), hobOnIsland: true|false(쿡탑을 아일랜드에)
- style: "basic"(일반) | "cafe"(카페 — 오픈 선반 · 폴딩장) | "storage"(수납 많이 — 키큰장 · 서랍)
- wants: ${JSON.stringify(WANTS)} 중 여럿 (${WANTS.map((w) => `${w}=${WANT_LABEL[w]}`).join(', ')}) — 배치안 점수에 반영
- grade: ${list(cat.grades, (g) => `"${g.id}"(${g.label})`)}
- door: 고른 그레이드의 도어 id. 그레이드별 도어(id 이름):
${cat.grades.map((g) => `  ${g.id}: ${list(usableDoors(g), (x) => `${x.obs} ${x.name}`)}`).join('\n')}
- counter(상판): ${list(cat.counters as { id: string; name: string }[], (x) => `"${x.id}" ${x.name}`)}
- tile(벽 타일): ${list(cat.tiles as { id: string; name: string }[], (x) => `"${x.id}" ${x.name}`)}
- floor(바닥): ${list(cat.floors as { id: string; name: string }[], (x) => `"${x.id}" ${x.name}`)}
- wallpaper(벽지, ""=페인트): ${list(cat.walls as { id: string; name: string }[], (x) => `"${x.id}" ${x.name}`)}
- fridgeKind: "twin"(1도어 2대) | "sbs"(양문형) | "quad"(4도어) | "builtin"(빌트인 냉장고장), noFridge: true|false(냉장고장 빼기)
- fridgeColor: ${list(FRIDGE_COLORS, (c) => `"${c[0]}" ${c[1]}`)}
- cornerPantry: true|false(코너 팬트리장, 유로 계열만), glassAccent: true|false(상부장 하나를 유리장으로)
- dining: {"on": true|false, "shape": "round"|"oval"|"rect", "seats": 4|6} (식탁 · 의자)
- appliance: {"hob"|"hood"|"sink"|"faucet"|"dish"|"oven": 모델기호} — 고를 수 있는 모델:
${apps}

rooms: 공간 요소(문으로 이어진 방) 추가/빼기. wall 은 거실(트인 쪽)에서 본 방향.
규칙: 말하지 않은 것은 바꾸지 않는다. 목록에 없는 값은 쓰지 않는다. 애매하면 바꾸지 말고 unknown 에 적는다. 가격 · 단가는 모른다고 답한다.`;
}

function currentDesign(d: Design, cat: KitchenCatalog) {
  const front = viewWalls(d.openWall).front % 2 === 0 ? 'w' : 'd', side = front === 'w' ? 'd' : 'w';
  const g = cat.grades.find((x) => x.id === d.grade);
  return {
    roomFront: d.room[front], roomSide: d.room[side], ceiling: d.room.h, layout: d.layout, island: d.island, islandLen: d.islandCfg.len, islandStyle: d.islandCfg.style ?? 'basic',
    style: d.style, wants: d.wants ?? [], grade: d.grade, door: `${d.door} ${g?.doors.find((x) => x.obs === d.door)?.name ?? ''}`, counter: d.counter, tile: d.tile, floor: d.floor, wallpaper: d.wallpaper,
    fridgeKind: d.fridgeKind ?? 'quad', noFridge: !!d.noFridge, fridgeColor: d.fridgeColor ?? 'cotta-white', cornerPantry: !!d.cornerPantry, glassAccent: !!d.glassAccent,
    dining: d.dining ? { on: d.dining.on, shape: d.dining.shape, seats: d.dining.seats } : { on: false },
    appliance: Object.fromEntries(APPLIANCE_CATS.filter(([k]) => k !== 'fridge').map(([k]) => [k, applianceOf(k, d.appliance?.[k as keyof NonNullable<Design['appliance']>])?.model ?? null])),
    rooms: d.openings.filter((o) => o.kind !== 'window').map((o) => o.kind),
  };
}

/** JSON 만 뽑는다 — 코드 블록 · 앞뒤 글이 붙어 와도 */
function parseJson(text: string): Record<string, unknown> {
  const s = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('AI 답에 JSON 이 없습니다');
  return JSON.parse(s.slice(i, j + 1));
}

export interface AiResult { applied: string[]; unknown: string[]; reply: string; ms: number; model: string }

/** 요청 → AI → 검사 → 설계에 적용. 실패하면 예외(부르는 쪽이 규칙 해석으로 돌아간다) */
export async function aiDesign(text: string, d: Design, cat: KitchenCatalog, provider: AiProvider, model: string): Promise<AiResult> {
  const user = `지금 설계:\n${JSON.stringify(currentDesign(d, cat))}\n\n사용자 요청:\n${text}`;
  const r = await fetch(`${import.meta.env.BASE_URL}api/ai`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, model, system: systemPrompt(cat), user }) });
  const j = await r.json().catch(() => ({ error: `중계 서버 응답이 JSON 이 아님(${r.status})` }));
  if (!r.ok || j.error) throw new Error(j.error ?? `중계 오류 ${r.status}`);
  const o = parseJson(j.text);
  const ch = (o.changes ?? {}) as Record<string, unknown>;
  const applied: string[] = [], dropped: string[] = [];
  const bad = (k: string, v: unknown) => dropped.push(`${k}=${JSON.stringify(v)}`);

  // 공간 — 정면 · 옆 벽(트인 쪽 기준)을 방 w · d 로
  const front = viewWalls(d.openWall).front % 2 === 0 ? 'w' : 'd', side = front === 'w' ? 'd' : 'w';
  for (const [k, ax, a, b] of [['roomFront', front, 1800, 9000], ['roomSide', side, 1800, 9000], ['ceiling', 'h', 2200, 2800]] as const) {
    if (ch[k] === undefined) continue;
    const v = clamp(ch[k], a, b); if (v === undefined) { bad(k, ch[k]); continue; }
    d.room[ax] = v;
  }
  if (ch.layout !== undefined) { const v = LAYOUTS[String(ch.layout)]; if (v) d.layout = v; else bad('layout', ch.layout); }
  if (typeof ch.island === 'boolean') d.island = ch.island;
  if (ch.islandLen !== undefined) { const v = clamp(ch.islandLen, 1200, 3600); if (v) d.islandCfg = { ...d.islandCfg, len: v }; else bad('islandLen', ch.islandLen); }
  if (ch.islandStyle !== undefined) { if (ISLAND_STYLES.includes(ch.islandStyle as IslandStyle)) d.islandCfg = { ...d.islandCfg, style: ch.islandStyle as IslandStyle }; else bad('islandStyle', ch.islandStyle); }
  if (typeof ch.hobOnIsland === 'boolean') {
    if (ch.hobOnIsland) { d.island = true; d.fix = { ...(d.fix ?? {}), hob: { wall: 0, c: d.islandCfg.len / 2, island: true } }; }
    else if (d.fix?.hob?.island) { const f = { ...d.fix }; delete f.hob; d.fix = f; }
  }
  if (ch.style !== undefined) { if (STYLES.includes(ch.style as StyleKind)) d.style = ch.style as StyleKind; else bad('style', ch.style); }
  if (Array.isArray(ch.wants)) d.wants = [...new Set((ch.wants as string[]).filter((w): w is Want => WANTS.includes(w as Want)))];
  if (ch.grade !== undefined) { if (cat.grades.some((g) => g.id === ch.grade)) d.grade = String(ch.grade); else bad('grade', ch.grade); }
  if (ch.door !== undefined) {
    const id = String(ch.door).split(/\s/)[0], g = cat.grades.find((x) => usableDoors(x).some((dd) => dd.obs === id));
    if (g) { d.door = id; if (g.id !== d.grade) d.grade = g.id; } else bad('door', ch.door);
  }
  const pickId = (k: 'counter' | 'tile' | 'floor', list: { id: string }[]) => { if (ch[k] === undefined) return; if (list.some((x) => x.id === ch[k])) d[k] = String(ch[k]); else bad(k, ch[k]); };
  pickId('counter', cat.counters as { id: string }[]); pickId('tile', cat.tiles as { id: string }[]); pickId('floor', cat.floors as { id: string }[]);
  if (ch.wallpaper !== undefined) { if (ch.wallpaper === '' || (cat.walls as { id: string }[]).some((x) => x.id === ch.wallpaper)) d.wallpaper = String(ch.wallpaper); else bad('wallpaper', ch.wallpaper); }
  if (ch.fridgeKind !== undefined) { if (['twin', 'sbs', 'quad', 'builtin'].includes(String(ch.fridgeKind))) d.fridgeKind = ch.fridgeKind as Design['fridgeKind']; else bad('fridgeKind', ch.fridgeKind); }
  if (typeof ch.noFridge === 'boolean') d.noFridge = ch.noFridge || undefined;
  if (ch.fridgeColor !== undefined) { if (FRIDGE_COLORS.some((c) => c[0] === ch.fridgeColor)) d.fridgeColor = String(ch.fridgeColor); else bad('fridgeColor', ch.fridgeColor); }
  if (typeof ch.cornerPantry === 'boolean') d.cornerPantry = ch.cornerPantry;
  if (typeof ch.glassAccent === 'boolean') d.glassAccent = ch.glassAccent;
  if (ch.dining && typeof ch.dining === 'object') {
    const v = ch.dining as { on?: boolean; shape?: string; seats?: number };
    const shape = ['round', 'oval', 'rect'].includes(String(v.shape)) ? v.shape as 'round' | 'oval' | 'rect' : d.dining?.shape ?? 'rect';
    const seats = v.seats === 6 ? 6 : v.seats === 4 ? 4 : d.dining?.seats ?? 4;
    d.dining = { ...(d.dining ?? {}), on: v.on !== false, shape, seats };
  }
  if (ch.appliance && typeof ch.appliance === 'object') {
    for (const [k, m] of Object.entries(ch.appliance as Record<string, string>)) {
      if (APPLIANCES.some((a) => a.cat === k && a.model === m)) d.appliance = { ...(d.appliance ?? {}), [k]: m };
      else bad(`appliance.${k}`, m);
    }
  }
  // 공간 요소 — 거실에서 본 방향의 벽에 더하거나 빼기
  for (const r0 of (Array.isArray(o.rooms) ? o.rooms : []) as { kind?: string; wall?: string; remove?: boolean }[]) {
    const rk = ROOM_KINDS[String(r0.kind)]; if (!rk) { bad('rooms.kind', r0.kind); continue; }
    if (r0.remove) { const n0 = d.openings.length; d.openings = d.openings.filter((x) => x.kind !== rk[0]); if (d.openings.length < n0) applied.push(`${rk[1]} 빼기`); continue; }
    if (d.openings.some((x) => x.kind === rk[0])) continue;
    const vw = viewWalls(d.openWall), wall = r0.wall === 'left' ? vw.left : r0.wall === 'right' ? vw.right : vw.front;
    d.openings.push(newOpening(rk[0], d.room, wall));
  }
  applied.push(...((Array.isArray(o.applied) ? o.applied : []) as string[]).map(String));
  const unknown = [...((Array.isArray(o.unknown) ? o.unknown : []) as string[]).map(String), ...(dropped.length ? [`목록 밖 값이라 버림: ${dropped.join(', ')}`] : [])];
  return { applied, unknown, reply: String(o.reply ?? ''), ms: j.ms ?? 0, model };
}
