// 회귀 점검 한 번에 — npm run check (타입 검사 뒤 이 파일). 고칠 때마다 돌려 배치 규칙이 깨지지 않았는지 본다.
// 점검마다 요약 줄을 읽어 기준값과 비교한다(0 이 아닌 기준은 알려진 원본 · 설계 사정 — 아래 설명). 늘어나면 불합격, 종료 코드 1
import { spawnSync } from 'node:child_process';

/** 원본 계산 오류가 알려진 장 — 유로 포켓 폴딩장의 하위 「폴딩 1D밑장」이 키친바흐 도어 변수(@KBDR.MDC)를 참조(원본 자료, 교체 메뉴에만 있음) */
const KNOWN_ERR = /\bfoldTall\b/;
const CHECKS = [
  ['probe.ts', '모듈 × 그레이드 원본 계산 오류(알려진 foldTall 제외)', (o) => { const bad = o.split('\n').filter((l) => / err [1-9]/.test(l) && !KNOWN_ERR.test(l)); return [bad.length === 0, `오류 난 조합 ${bad.length}`]; }],
  ['probe-uend.ts', '상부장 끝이 아무것도 안 닿음', (o) => { const m = /open ends (\d+)/.exec(o); return [m?.[1] === '0', m ? `${m[1]}건` : '결과 없음']; }],
  // 창 높이 · 위치 조합 중 상부장 사이 빈틈이 남는 경우 — 기준 22(2026-11-05 확정, 창 위 공간이 장 높이에 못 미치는 조합)
  ['probe-winup.ts', '창 위 상부장 빈틈(기준 22 이하)', (o) => { const m = /빈틈 있는 경우 (\d+)/.exec(o); return [!!m && +m[1] <= 22, m ? `${m[1]}건` : '결과 없음']; }],
  ['probe-islattach.ts', '아일랜드 붙임 — 코너장 없이 붙은 경우', (o) => { const m = /닿은 경우 (\d+) 코너장 없이 (\d+)/.exec(o); return [m?.[2] === '0', m ? `${m[1]}곳 중 ${m[2]}` : '결과 없음']; }],
  ['probe-islattach2.ts', '양면 아일랜드 붙임 — 코너장 없이 붙은 경우', (o) => { const m = /닿은 경우 (\d+) 코너장 없이 (\d+)/.exec(o); return [m?.[2] === '0', m ? `${m[1]}곳 중 ${m[2]}` : '결과 없음']; }],
  // 원본에 남은 「레드」 공도어 판(EP 등) — 화면에선 cabinet3d 가 숨긴다. 기준 10(원본 자료 그대로)
  ['probe-gong.ts', '원본 공도어 판이 남는 장(기준 10 이하 · 화면은 숨김)', (o) => { const m = /공도어 남는 장 (\d+)/.exec(o); return [!!m && +m[1] <= 10, m ? `${m[1]}종` : '결과 없음']; }],
];

let fail = 0;
for (const [file, what, judge] of CHECKS) {
  const t0 = Date.now();
  const r = spawnSync('npx', ['vite-node', `tools/${file}`], { encoding: 'utf8', shell: true, maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const [ok, note] = r.status === 0 ? judge(out) : [false, `실행 실패(종료 ${r.status})`];
  if (!ok) fail++;
  console.log(`${ok ? '✓' : '✗'} ${what} — ${note} · ${((Date.now() - t0) / 1000).toFixed(0)}초  (tools/${file})`);
  if (!ok) console.log(out.split('\n').filter(Boolean).slice(-8).map((l) => `    ${l}`).join('\n'));
}
console.log(fail ? `불합격 ${fail}건` : '모두 합격');
process.exit(fail ? 1 : 0);
