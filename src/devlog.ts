// 개발 서버 전용 기록 — 오류 · 경고 · 처리 안 된 거부 · 탭 숨김을 개발 서버(.devlog/client.log)로 보낸다. 배포본(build)에서는 아무 일도 안 한다.
// 사용자가 쓰는 브라우저의 콘솔은 밖에서 볼 수 없어서(2026-11-09 「3D 캔버스가 계속 날아간다」) 그 브라우저가 직접 보낸다
import * as THREE from 'three';
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
    console[lv] = (...a: unknown[]) => {
      orig(...a);
      const msg = a.map(str).join(' ');
      devlog(lv, lv === 'error' ? { msg: msg.slice(0, 3000), acts: recentActs() } : msg.slice(0, 3000));
      if (/used in submit while destroyed/.test(msg)) (window as unknown as { __devSuspects?: () => void }).__devSuspects?.();
    };
  }
  addEventListener('visibilitychange', () => devlog('visibility', document.visibilityState));
  // 호출 경로를 길게 — 기본 10단계로는 three 안쪽에서 잘려 누가 불렀는지 안 보였다
  (Error as unknown as { stackTraceLimit: number }).stackTraceLimit = 40;
  devlog('load', { url: location.href, ua: navigator.userAgent, dpr: devicePixelRatio, w: innerWidth, h: innerHeight });
}
/* 쓰는 중인 형상 · 재질을 놓는지 — 장면(__stage.scene)에 있는 메시가 쓰는 형상(속성 공유 포함) · 재질을 dispose 하면 다음 그리기부터
 * 「Buffer used in submit while destroyed」 가 매 프레임 난다(2026-11-09 사용자 화면 — 다시 그리기 직후부터 초당 수백 번, 헤드리스 기본 설정으론 재현 안 됨).
 * 놓는 순간 그 메시 경로와 부른 곳을 남긴다. 장면 목록은 한 번 놓기 묶음(30ms) 안에서 다시 쓴다 */
if (ON) {
  let used: { at: number; map: Map<object, string> } | null = null;
  const pathOf = (o: THREE.Object3D) => { const p: string[] = []; for (let x: THREE.Object3D | null = o; x && p.length < 6; x = x.parent) p.push(x.name || x.type); return p.reverse().join('/'); };
  const inScene = () => {
    const now = performance.now();
    if (used && now - used.at < 30) return used.map;
    const map = new Map<object, string>();
    ((window as unknown as { __stage?: { scene?: THREE.Scene } }).__stage?.scene)?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) { const at = pathOf(m); map.set(m.geometry, at); for (const a of Object.values(m.geometry.attributes)) map.set(a, at); if (m.geometry.index) map.set(m.geometry.index, at); }
      for (const mt of [m.material ?? []].flat() as THREE.Material[]) map.set(mt, pathOf(m));
    });
    used = { at: now, map };
    return map;
  };
  const where = () => (new Error().stack ?? '').split('\n').slice(3, 12).map((l) => l.trim().replace(/^at /, '').replace(/https?:\/\/[^/]+\//, '')).join(' < ');
  // 놓은 것 — 오류가 나면 장면에서 이것을 아직 쓰는 메시를 찾는다(놓은 곳도 함께)
  const gone = new WeakMap<object, string>();
  const geoHit = (u: Map<object, string>, g: THREE.BufferGeometry) => u.get(g) ?? [...Object.values(g.attributes), g.index].map((a) => (a ? u.get(a) : undefined)).find(Boolean);
  const gd = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function (this: THREE.BufferGeometry) {
    // 장면 목록은 30ms 재사용이라 같은 묶음에서 형상을 바꿔 끼운 직후엔 낡았다 — 걸리면 새로 훑어 다시 본다
    let hit = geoHit(inScene(), this);
    if (hit) { used = null; hit = geoHit(inScene(), this); }
    const by = where();
    if (hit) devlog('dispose-in-use', { what: 'geometry', mesh: hit, by, acts: recentActs() });
    gone.set(this, by); for (const a of [...Object.values(this.attributes), this.index]) if (a) gone.set(a, by);
    return gd.call(this);
  };
  const md = THREE.Material.prototype.dispose;
  THREE.Material.prototype.dispose = function (this: THREE.Material) {
    let hit = inScene().get(this);
    if (hit) { used = null; hit = inScene().get(this); }
    const by = where();
    if (hit) devlog('dispose-in-use', { what: `material ${this.type} ${this.name}`, mesh: hit, by, acts: recentActs() });
    gone.set(this, by);
    return md.call(this);
  };
  /** 「… used in submit while destroyed」 가 나면 — 장면에서 놓은 형상 · 속성 · 재질을 아직 쓰는 메시와 그것을 놓은 곳(한 번만, 그다음은 10초 묶음) */
  let lastSuspect = 0;
  (window as unknown as { __devSuspects?: () => void }).__devSuspects = () => {
    const now = performance.now();
    if (now - lastSuspect < 10_000) return;
    lastSuspect = now;
    const out: { mesh: string; what: string; by: string }[] = [];
    ((window as unknown as { __stage?: { scene?: THREE.Scene } }).__stage?.scene)?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (out.length >= 12) return;
      if (m.geometry) {
        const g = m.geometry, k = [g, ...Object.values(g.attributes), g.index].find((x) => x && gone.has(x));
        if (k) out.push({ mesh: pathOf(m), what: k === g ? 'geometry' : 'attribute', by: gone.get(k)! });
      }
      for (const mt of [m.material ?? []].flat() as THREE.Material[]) if (gone.has(mt)) out.push({ mesh: pathOf(m), what: `material ${mt.type} ${mt.name}`, by: gone.get(mt)! });
    });
    devlog('destroyed-suspects', { n: out.length, out, acts: recentActs() });
  };
}
/** 최근 동작 — 3D 오류가 나면 직전에 무엇을 했는지 같이 남긴다 */
const acts: string[] = [];
export function devact(a: string) {
  if (!ON) return;
  acts.push(`${Math.round(performance.now() / 100) / 10}s ${a}`);
  if (acts.length > 12) acts.shift();
}
export const recentActs = () => acts.slice();
