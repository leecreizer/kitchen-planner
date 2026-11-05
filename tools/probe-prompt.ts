import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { applyPrompt } from '../src/prompt';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const t of ['수납 많이 해 주세요', '답답하지 않게 해 주세요', '동선이 편하게 해 주세요', '카페 스타일로 해 주세요', '아일랜드에서 식사도 하고 싶어요', '요리를 자주 해요', 'ㄷ자 답답하지 않게, 수납도 넉넉히']) {
  const d = defaultDesign(); d.layout = 'U';
  const r = applyPrompt(t, d, cat);
  console.log(t, '=>', r.applied.join(' / '), '| 못:', r.unknown.join(','), '| layout', d.layout, 'style', d.style, 'island', d.island, d.islandCfg.style ?? '', 'door', d.door);
}
