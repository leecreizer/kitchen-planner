// 개발 서버 전용 기록 — 오류 · 경고 · 처리 안 된 거부 · 탭 숨김을 개발 서버(.devlog/client.log)로 보낸다. 배포본(build)에서는 아무 일도 안 한다.
// 사용자가 쓰는 브라우저의 콘솔은 밖에서 볼 수 없어서(2026-11-09 「3D 캔버스가 계속 날아간다」) 그 브라우저가 직접 보낸다
const ON = import.meta.env.DEV;
let seq = 0;
const recent = new Map<string, number>();
/** 보낸 쪽 — 시험 브라우저(헤드리스)면 H, 사람이 쓰는 브라우저면 U + 페이지마다 다른 번호. 섞여 쌓이는 기록을 가르려고(시험 쪽 설정을 사용자 것으로 잘못 읽었다) */
const SRC = `${/Headless/.test(navigator.userAgent) ? 'H' : 'U'}${Math.random().toString(36).slice(2, 6)}`;

const str = (x: unknown): string => {
  if (x instanceof Error) return `${x.name}: ${x.message}\n${x.stack ?? ''}`;
  if (typeof x === 'object' && x) { try { return JSON.stringify(x).slice(0, 800); } catch { return String(x); } }
  return String(x);
};

/** 한 줄 보내기 — 같은 내용은 10초에 한 번만(경고가 매 프레임 쏟아져도 파일이 넘치지 않게) */
export function devlog(kind: string, data: unknown) {
  if (!ON) return;
  try {
    const body = JSON.stringify({ src: SRC, kind, seq: ++seq, t: Math.round(performance.now()), data });
    const key = kind + body.slice(body.indexOf('"data"'), 400);
    const now = performance.now();
    if ((recent.get(key) ?? -1e9) > now - 10_000) return;
    recent.set(key, now);
    if (!navigator.sendBeacon?.('/api/devlog', new Blob([body], { type: 'text/plain' }))) void fetch('/api/devlog', { method: 'POST', body, keepalive: true }).catch(() => undefined);
  } catch { /* 기록 실패는 화면과 무관 */ }
}

if (ON) {
  addEventListener('error', (e) => devlog('error', { msg: e.message, at: `${e.filename}:${e.lineno}:${e.colno}`, stack: (e.error as Error | undefined)?.stack?.slice(0, 4000), acts: recentActs() }));
  addEventListener('unhandledrejection', (e) => devlog('reject', { msg: str(e.reason).slice(0, 3000), acts: recentActs() }));
  for (const lv of ['error', 'warn'] as const) {
    const orig = console[lv].bind(console);
    console[lv] = (...a: unknown[]) => { orig(...a); devlog(lv, lv === 'error' ? { msg: a.map(str).join(' ').slice(0, 3000), acts: recentActs() } : a.map(str).join(' ').slice(0, 3000)); };
  }
  addEventListener('visibilitychange', () => devlog('visibility', document.visibilityState));
  // 호출 경로를 길게 — 기본 10단계로는 three 안쪽에서 잘려 누가 불렀는지 안 보였다
  (Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 40;
  devlog('load', { url: location.href, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight });
}
/** 최근 동작 — 3D 오류가 나면 직전에 무엇을 했는지 같이 남긴다 */
const acts: string[] = [];
export function devact(a: string) {
  if (!ON) return;
  acts.push(`${Math.round(performance.now() / 100) / 10}s ${a}`);
  if (acts.length > 12) acts.shift();
}
export const recentActs = () => acts.slice();
