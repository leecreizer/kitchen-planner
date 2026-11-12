// 도어 목록 — 제대로 그려지지 않는 도어(앞판 · 액자 테두리 단면이 없는 맨하탄 · 아티잔 · 첼시)가 고를 수 있는 목록에 남지 않는지.
// 사용자 2026-11-12 「제대로 표현되지 않는 도어 모델은 삭제해」 — 원본 자료(catalog.json)는 그대로, loadCatalog 가 거른다. npx vite-node tools/probe-doors.ts
import { readFileSync } from 'node:fs';
import { setReader, loadCatalog, doorBroken } from '../src/kjlLib';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const raw = JSON.parse(readFileSync('public/kjl/catalog.json', 'utf-8')) as { grades: { id: string; doors: { obs: string; name: string }[] }[] };
const cat = await loadCatalog();
let all = 0, left = 0, empty = 0, lost = 0;
for (const g of cat.grades) {
  const r = raw.grades.find((x) => x.id === g.id)!;
  all += g.doors.length;
  if (!g.doors.length) empty++;
  for (const x of g.doors) if (doorBroken(x.obs).length) { left++; console.log('  남음', g.id, x.name); }
  // 멀쩡한 도어가 같이 빠지지 않았는지
  for (const x of r.doors) if (!doorBroken(x.obs).length && !g.doors.some((q) => q.obs === x.obs)) { lost++; console.log('  잘못 빠짐', g.id, x.name); }
  console.log(' ', g.id, `원본 ${r.doors.length} → ${g.doors.length}`);
}
// 빈 틀만 서는 키친바흐 포켓 폴딩장은 장 목록에 없어야 한다(유로 포켓 폴딩장은 선반이 있어 그대로)
if (cat.modules.some((m) => m.key === 'foldTall' && m.series === 'KB')) { left++; console.log('  남음 KB foldTall'); }
if (!cat.modules.some((m) => m.key === 'foldTall' && m.series === 'EO')) { lost++; console.log('  잘못 빠짐 EO foldTall'); }
console.log(`도어 ${all}종 · 깨진 도어 남음 ${left} · 빈 그레이드 ${empty} · 잘못 빠짐 ${lost}`);
