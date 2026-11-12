// 견적 데이터(부품 목록) — 지금 배치안의 장 · 상판 · 벽 마감 · 걸레받이 · 상부 몰딩 · 가전 · 냉장고 · 식탁을 한 표로.
// 장은 쿠지알러 원본 ID(obs) · 원본 이름 · 원본 모델 파일 · 실제 규격(비규격 변수 반영) · 도어까지 나간다.
// 한샘 품목 코드 · 단가는 원본에 없다(쿠지알러 editordata 의 brandGoodCode · prodPrice 가 장 모듈은 모두 비어 있음, productNumber 는 분류 기호 「CB」 등) —
// 빈 칸으로 내보내 단가표를 원본 ID 로 이어 붙이게 한다. 식탁 · 의자는 홈뷰 상품 코드 · 가격, 가전은 카탈로그 모델명이 있다
import type { Candidate, Item } from './autoplan';
import { FRIDGE_SPEC, fridgeSpec, upperBottomOf, upperTopOf, WALL_D } from './autoplan';
import { applianceOf, APPLIANCE_CATS, type ApplianceCat } from './catalog';
import { diningOf } from './dining3d';
import type { GradeDef, KitchenCatalog } from './kjlLib';
import { wallName, type Design } from './plan';
import { splashLayout } from './splash';

export interface BomRow {
  구분: string; 품목: string; 원본ID: string; 원본이름: string; 원본파일: string; 한샘코드: string;
  W: number | ''; D: number | ''; H: number | ''; 규격: string; 비규격: string; 도어: string; 재질: string;
  위치: string; 수량: number; 단위: string; 단가: number | ''; 비고: string;
}
export const BOM_COLS: (keyof BomRow)[] = ['구분', '품목', '원본ID', '원본이름', '원본파일', '한샘코드', 'W', 'D', 'H', '규격', '비규격', '도어', '재질', '위치', '수량', '단위', '단가', '비고'];

const LEVEL: Record<string, string> = { base: '하부장', wall: '상부장', tall: '키큰장', shelf: '선반' };
const TAG: Record<string, string> = { sink: '싱크', hob: '쿡탑', fridge: '냉장고', dish: '식기세척기', island: '아일랜드', ep: 'EP', fix: 'FIX 도어' };
const row = (r: Partial<BomRow>): BomRow => ({ 구분: '', 품목: '', 원본ID: '', 원본이름: '', 원본파일: '', 한샘코드: '', W: '', D: '', H: '', 규격: '', 비규격: '', 도어: '', 재질: '', 위치: '', 수량: 1, 단위: 'EA', 단가: '', 비고: '', ...r });

export function buildBom(d: Design, c: Candidate, cat: KitchenCatalog, grade: GradeDef): BomRow[] {
  const out: BomRow[] = [];
  const doorDef = grade.doors.find((x) => x.obs === d.door);
  const doorText = doorDef ? `${grade.label} · ${doorDef.name} (${doorDef.obs})` : grade.label;
  const where = (it: Item) => it.wall != null ? `${wallName(d.openWall, it.wall)} ${Math.round(it.t)}~${Math.round(it.t + it.w)}` : '아일랜드';

  // ① 장 — 원본 모듈(계열 맞춤)
  for (const it of c.items) {
    const m = cat.modules.find((x) => x.key === it.key && (x.series === grade.series || x.series === '*')) ?? cat.modules.find((x) => x.key === it.key);
    const ov = it.ov ?? {};
    // 깊이 — 유로 상부장은 원본 D 가 0(식으로 정함)이라 상부장 표준 깊이(WALL_D 340)로
    const W = Number(ov.NSTD_W) || it.w, D = Number(ov.NSTD_D) || m?.D || (it.level === 'wall' ? WALL_D : ''), H = Number(ov.NSTD_H) || m?.H || '';
    const std = m?.W?.options?.includes(it.w);
    const nonStd = ov.STD_YN != null || (m?.W && !std) ? ['W', ov.NSTD_H && 'H', ov.NSTD_D && 'D'].filter(Boolean).join('·') : '';
    out.push(row({
      구분: it.key === 'fridge' ? '냉장고 자리' : it.tag === 'ep' ? 'EP' : /^fill|Fill$/.test(it.key) ? '휠라' : LEVEL[it.level] ?? it.level,
      품목: m?.label ?? (it.key === 'fridge' ? '냉장고 자리' : it.key),
      원본ID: m?.obs ?? '', 원본이름: m?.name ?? '', 원본파일: m ? `kjl/m/${m.obs}.json` : '',
      W, D, H, 규격: `${W}×${D}×${H}`, 비규격: nonStd,
      도어: m?.doorVar ? doorText : '', 위치: where(it),
      비고: [it.tag && TAG[it.tag], it.robot && '로봇청소기 자리', Object.keys(ov).length ? `원본 변수 ${Object.entries(ov).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''].filter(Boolean).join(' · '),
    }));
  }

  // ② 상판 — 줄 · 아일랜드마다 길이 × 깊이(두께 30)
  const counter = cat.counters.find((x: { id: string }) => x.id === d.counter) as { id: string; name: string } | undefined;
  for (const k of c.counters) {
    const L = Math.round(k.t1 - k.t0), Dp = Math.round(Math.abs(k.z1 - k.z0));
    out.push(row({ 구분: '상판', 품목: k.island ? '아일랜드 상판' : '상판', 원본ID: d.counter, 원본이름: counter?.name ?? '', W: L, D: Dp, H: 30, 규격: `${L}×${Dp}×30`, 재질: counter?.name ?? d.counter, 수량: +(L * Dp / 1e6).toFixed(3), 단위: '㎡', 비고: c.items.some((x) => x.tag === 'sink' && x.frame === k.frame) ? '싱크볼 타공' : '' }));
  }

  // ③ 벽 마감(타일 · 벽판넬) — 벽 길이 전체 · 상부장 아래(없으면 천장)까지. 실제 깔리는 조각(splashLayout) 넓이 합 — 창 · 문 구멍 · 키큰장 뒤는 빠진다
  const tile = cat.tiles.find((x: { id: string }) => x.id === d.tile) as { id: string; name: string } | undefined;
  for (const sg of splashLayout(c, d)) {
    if (!sg.pieces.length) continue;
    const w = sg.wall, cfg = w != null ? d.splash?.[w] : undefined, panel = cfg?.kind === 'panel';
    const L = Math.round(Math.max(...sg.pieces.map((p) => p[1])) - Math.min(...sg.pieces.map((p) => p[0])));
    const Hh = Math.round(Math.max(...sg.pieces.map((p) => p[3])) - Math.min(...sg.pieces.map((p) => p[2])));
    const area = sg.pieces.reduce((a, p) => a + (p[1] - p[0]) * (p[3] - p[2]), 0);
    out.push(row({ 구분: '벽 마감', 품목: panel ? '벽판넬' : '타일', 원본ID: panel ? cfg?.mat ?? d.counter : d.tile, 원본이름: panel ? (cat.counters.find((x: { id: string }) => x.id === (cfg?.mat ?? d.counter)) as { name: string } | undefined)?.name ?? '' : tile?.name ?? '', W: L, H: Hh, 규격: `${L}×${Hh}`, 수량: +(area / 1e6).toFixed(3), 단위: '㎡', 위치: w != null ? wallName(d.openWall, w) : '', 비고: '깔리는 넓이 합(창 · 문 · 키큰장 자리 제외)' }));
  }

  // ④ 걸레받이 · 상부 몰딩(서라운딩) — 장 폭 합(줄 끝 꺾임 · 끝막음은 시공 기준으로 더한다)
  const sum = (f: (it: Item) => boolean) => Math.round(c.items.filter(f).reduce((s, it) => s + it.w, 0));
  const plinth = sum((it) => (it.level === 'base' || it.level === 'tall') && !it.robot && it.key !== 'fridge');
  const surround = sum((it) => it.level === 'wall' || it.level === 'tall');
  if (plinth) out.push(row({ 구분: '마감', 품목: '걸레받이', W: plinth, H: 112, 규격: `길이 ${plinth} · 높이 112`, 재질: '도어 재질', 수량: +(plinth / 1000).toFixed(2), 단위: 'm', 비고: '장 폭 합 — 꺾임 · 끝막음 별도' }));
  if (surround) out.push(row({ 구분: '마감', 품목: '상부 몰딩(서라운딩)', W: surround, H: d.room.h - upperTopOf(d.room), 규격: `길이 ${surround} · 높이 ${d.room.h - upperTopOf(d.room)}`, 재질: '도어 재질', 수량: +(surround / 1000).toFixed(2), 단위: 'm', 비고: `상부장 아래 ${upperBottomOf(d.room)} · 장 폭 합` }));

  // ⑤ 가전 — 배치안에 그 기기 자리가 있을 때만
  // 냉장고는 아래에서 따로(종류 · 대수)
  const has: Partial<Record<ApplianceCat, boolean>> = {
    hob: c.items.some((x) => x.tag === 'hob'), hood: c.items.some((x) => x.key === 'hood') || !!d.fix?.hob?.island,
    sink: c.items.some((x) => x.tag === 'sink'), faucet: c.items.some((x) => x.tag === 'sink'),
    dish: c.items.some((x) => x.tag === 'dish'), oven: c.items.some((x) => x.key === 'oven'),
  };
  for (const [k, label] of APPLIANCE_CATS) {
    if (!has[k] || k === 'fridge') continue;
    const a = applianceOf(k, d.appliance?.[k]);
    // 수전은 카탈로그 기본이 없다 — 3D 는 홈뷰 상품(거위목 SHD000146)으로 그린다
    if (!a && k === 'faucet') { out.push(row({ 구분: '가전', 품목: label, 원본이름: '거위목 수전(3D 기본 모델)', 원본ID: 'SHD000146', 비고: '카탈로그에서 고르지 않음' })); continue; }
    out.push(row({ 구분: '가전', 품목: label, 원본이름: a?.name ?? '', 한샘코드: a?.model ?? '', 규격: a?.size?.filter((x) => x != null).join('×') ?? '', 비고: a?.cut ? `타공 ${a.cut.join('×')}` : '' }));
  }
  if (!d.noFridge && !c.items.some((x) => x.key === 'fridgeTall')) {
    const f = fridgeSpec(d);
    const kind = Object.entries(FRIDGE_SPEC).find(([, v]) => v === f)?.[0] ?? '';
    out.push(row({ 구분: '가전', 품목: `냉장고 ${f.label}`, 규격: `${f.unitW}×${f.d}×${f.h}`, 수량: f.n, 재질: d.fridgeColor ?? '', 비고: `${kind} · 자리 ${f.w}` }));
  }

  // ⑥ 식탁 · 의자 — 홈뷰 상품 코드 · 가격
  const set = d.dining?.on ? diningOf(d) : undefined;
  if (set) {
    out.push(row({ 구분: '가구', 품목: '식탁', 원본이름: set.name, 한샘코드: set.code, 규격: set.size.join('×'), 단가: set.price }));
    out.push(row({ 구분: '가구', 품목: '식탁의자', 원본이름: set.chair.name, 한샘코드: set.chair.code, 규격: set.chair.size.join('×'), 수량: set.seats, 단가: set.chair.price }));
  }
  return out;
}

/** 엑셀에서 바로 열리는 CSV(UTF-8 BOM) */
export function bomCsv(rows: BomRow[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [BOM_COLS.join(','), ...rows.map((r) => BOM_COLS.map((k) => esc(r[k])).join(','))].join('\r\n');
}
/** 빈 칸 점검 — 견적에 쓰려면 채워야 하는 칸이 어디 비었는지(구분별 건수) */
export function bomGaps(rows: BomRow[]): Record<string, string[]> {
  const gaps: Record<string, string[]> = {};
  const need: [keyof BomRow, (r: BomRow) => boolean][] = [
    ['원본ID', (r) => /하부장|상부장|키큰장|선반|EP|휠라/.test(r.구분)],
    ['한샘코드', () => true],
    ['단가', () => true],
  ];
  for (const r of rows) for (const [k, applies] of need) if (applies(r) && (r[k] === '' || r[k] == null)) (gaps[k] ??= []).push(`${r.구분}:${r.품목}`);
  return gaps;
}
