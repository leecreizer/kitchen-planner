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
  // 원본 휠라 모델은 30 미만이면 깨진다(2026-11-09 최소 30). 150 초과는 ㄷ자 좁은 방의 고정 장 사이 틈 — 아직 안 고친 것(기준 40)
  ['probe-fillw.ts', '휠라 30 미만 · 겹침(150 초과는 기준 40 이하)', (o) => { const m = /휠라 (\d+)개 · 최소 폭 -?\d+ · \d+ 미만 (\d+) · \d+ 초과 (\d+) · 겹침 (\d+)/.exec(o); return [!!m && m[2] === '0' && m[4] === '0' && +m[3] <= 40, m ? `${m[1]}개 중 30 미만 ${m[2]} · 150 초과 ${m[3]} · 겹침 ${m[4]}` : '결과 없음']; }],
  // ㄷ자 · ㄱ자 + 아일랜드 — 알림 없이 동선이 막히거나 끝 통로가 880 미만인 안(2026-11-09 결정 A: 끝마다 통로 900 · 안 되면 반도형 · 그것도 안 되면 뺌).
  //   「아일랜드 둘레 통로가 좁습니다」 알림이 뜨는 안(방 깊이 부족)은 사용자 규칙대로 놓고 알리는 것이라 셈하지 않는다
  ['probe-island-u.ts', '아일랜드 — 알림 없이 막힘 · 좁은 끝 통로', (o) => { const m = /알림 없이 막힘 (\d+) · 알림 없이 좁음 (\d+)/.exec(o), k = /안 (\d+)개 .*반도형 (\d+) · 뺌 (\d+)/.exec(o); return [m?.[1] === '0' && m?.[2] === '0', m ? `막힘 ${m[1]} · 좁음 ${m[2]}${k ? ` (${k[1]}안 중 반도형 ${k[2]} · 뺌 ${k[3]})` : ''}` : '결과 없음']; }],
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
