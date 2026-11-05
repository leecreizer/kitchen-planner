import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../src/kjlLib';
import { autoPlan } from '../src/autoplan';
import { applyPrompt } from '../src/prompt';
import { defaultDesign } from '../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
for (const t of ['', '수납 많이 해 주세요', '답답하지 않게 해 주세요', '동선이 편하게 해 주세요', '요리를 자주 해요', '카페 스타일로 해 주세요', '유리장 넣어줘', '아일랜드에 쿡탑 넣어줘', '돌 아일랜드로', 'ㄷ자 수납 많이, 유리장']) {
  const d = defaultDesign(); const r = t ? applyPrompt(t, d, cat) : { applied: [], unknown: [] };
  for (const ser of ['EO', 'KB'] as const) {
    const cs = autoPlan(d, cat, ser); const c = cs[0];
    if (!c) { console.log(t, ser, '안 없음'); continue; }
    const keys = c.items.filter((i) => /oven|wallGlass|shelf|cafeTall|wallFold/.test(i.key) || i.tag === 'hob').map((i) => `${i.key}${i.tag === 'hob' ? (i.wall == null ? '(아일랜드)' : '') : ''}@${i.wall ?? 'I'}`);
    console.log(`[${t || '기본'}] ${ser} ${c.title} 점수 ${c.score} ${JSON.stringify(c.metrics)} | ${[...new Set(keys)].join(' ')} | ${c.reasons.filter((x) => /바라는|오븐|유리|선반|아일랜드|쿡탑/.test(x)).join(' / ')}${ser === 'EO' ? ' | 적용: ' + r.applied.join(', ') : ''}`);
  }
}
