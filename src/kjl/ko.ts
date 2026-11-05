import data from './catVars.json';

/** 쿠지알러 중국어 이름 → 한글 (화면 표시용 — 저장 값은 원본 그대로). 표: scripts/build-pm-catvars.py 의 ko */
const KO = data.ko as Record<string, string>;
export const koName = (s: string | null | undefined) => (s ? KO[s] ?? s : '');
