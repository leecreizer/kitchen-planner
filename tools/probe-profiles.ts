// 도어마다 단면(프로파일) 빠짐 점검 — 그 도어로 표본 장(여닫이 하부 · 3단 서랍 · 상부)을 실제로 계산해,
// 보이는 스윕 · 로프트 부품이 단면을 못 찾아 18×18 네모로 대신 그려진 단면 id 를 모은다.
//   npx vite-node tools/probe-profiles.ts           결과를 public/kjl/profiles.json 의 needs 로 쓴다(앱이 「단면 없음」 도어를 막는다)
// 받아 둔 단면은 public/kjl/profiles.json 의 profiles(tools/build_profiles.py 산출)를 그대로 둔다
import { readFileSync, writeFileSync } from 'node:fs';
import { setReader, loadCatalog, ensure, modelOf, kjlCatalog } from '../src/kjlLib';
import { PmEval } from '../src/kjl/resolve';
import { buildModel } from '../src/kjl/geometry';

setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const FILE = 'public/kjl/profiles.json';
const prev = (() => { try { return JSON.parse(readFileSync(FILE, 'utf-8')); } catch { return { profiles: {} }; } })();
const profiles: Record<string, { name: string; w: number; h: number; points: [number, number][] }> = prev.profiles ?? {};
const SAMPLE = ['cook2', 'drawer3', 'wall2'];
const needs: Record<string, string[]> = {};
let bad = 0;
for (const g of cat.grades) {
  for (const door of g.doors) {
    await ensure(door.obs);
    const miss = new Set<string>();
    for (const key of SAMPLE) {
      const m = cat.modules.find((x) => x.key === key && x.series === g.series);
      if (!m) continue;
      await ensure(m.obs);
      const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: door.obs, versionId: 1 }) } : {} });
      buildModel(ev, { product: kjlCatalog.product, profile: (id) => profiles[id], onMissingProfile: (id) => miss.add(id) });
    }
    if (miss.size) { needs[door.obs] = [...miss].sort(); bad++; console.log(`${g.label} · ${door.name} (${door.obs}) — 단면 없음 ${[...miss].join(', ')}`); }
  }
}
// 장 자체가 단면을 쓰는 것(폴딩장 등) — 기본 도어로
for (const m of cat.modules) {
  const g = cat.grades.find((x) => x.series === m.series) ?? cat.grades[0];
  await ensure(m.obs); await ensure(g.doors[0].obs);
  const miss = new Set<string>();
  const ev = new PmEval(modelOf(m.obs)!, { catalog: kjlCatalog, overrides: m.doorVar ? { [m.doorVar]: JSON.stringify({ obsBrandGoodId: g.doors[0].obs, versionId: 1 }) } : {} });
  buildModel(ev, { product: kjlCatalog.product, profile: (id) => profiles[id], onMissingProfile: (id) => miss.add(id) });
  if (miss.size && !g.doors.some((dd) => needs[dd.obs])) { needs[m.obs] = [...miss].sort(); console.log(`장 · ${m.label} (${m.obs}) — 단면 없음 ${[...miss].join(', ')}`); }
}
writeFileSync(FILE, JSON.stringify({ ...prev, source: 'tools/build_profiles.py (profiles · info) · tools/probe-profiles.ts (needs)', profiles, needs }));
console.log(`도어 ${cat.grades.reduce((s, g) => s + g.doors.length, 0)}종 중 단면이 빠진 도어 ${bad}종 · 장 ${Object.keys(needs).length - bad}종 → ${FILE}`);
