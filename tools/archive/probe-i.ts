import { readFileSync } from 'node:fs';
import { setReader, loadCatalog } from '../../src/kjlLib';
import { autoPlan } from '../../src/autoplan';
import { defaultDesign } from '../../src/plan';
setReader(async (p) => JSON.parse(readFileSync(`public/kjl/${p}`, 'utf-8')));
const cat = await loadCatalog();
const d = { ...defaultDesign(), layout: 'I' as const };
(globalThis as { __apDebug?: boolean }).__apDebug = true;
const cs = autoPlan(d, cat, 'EO');
console.log('I', cs.length);
// hob 조건 없이
const m = await import('../../src/autoplan');
console.log(Object.keys(m));
