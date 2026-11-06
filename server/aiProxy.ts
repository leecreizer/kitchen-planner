// AI 중계 — 개발 서버(npm run dev) · 미리보기(vite preview)에서 /api/ai 로 Claude · Gemini · GPT 를 부른다.
// 키는 이 서버에만(.env.local — git 에 안 올라감). 브라우저는 키를 모른다. 정적 배포(Pages 등)엔 이 중계가 없어 앱이 규칙 해석으로 돌아간다.
//   ANTHROPIC_API_KEY · GEMINI_API_KEY(또는 GOOGLE_API_KEY) · OPENAI_API_KEY
// GET /api/ai → 어느 곳 키가 있는지 · POST /api/ai {provider, model, system, user} → {text}
import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Provider = 'claude' | 'gemini' | 'gpt';
interface Ask { provider: Provider; model: string; system: string; user: string }

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code; res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage) => new Promise<string>((ok, bad) => {
  let s = ''; req.setEncoding('utf8');
  req.on('data', (c) => { s += c; if (s.length > 1_000_000) bad(new Error('요청이 너무 큽니다')); });
  req.on('end', () => ok(s)); req.on('error', bad);
});
const fail = async (r: Response) => { const t = await r.text(); throw new Error(`${r.status} ${t.slice(0, 300)}`); };

async function call(a: Ask, key: string): Promise<string> {
  const signal = AbortSignal.timeout(90_000);
  if (a.provider === 'claude') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: a.model, max_tokens: 4000, system: a.system, messages: [{ role: 'user', content: a.user }] }),
    });
    if (!r.ok) await fail(r);
    const j = await r.json() as { content?: { type: string; text?: string }[] };
    return (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  }
  if (a.provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(a.model)}:generateContent`, {
      method: 'POST', signal,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: a.system }] },
        contents: [{ role: 'user', parts: [{ text: a.user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) await fail(r);
    const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: a.model, messages: [{ role: 'system', content: a.system }, { role: 'user', content: a.user }], response_format: { type: 'json_object' } }),
  });
  if (!r.ok) await fail(r);
  const j = await r.json() as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}

export function aiProxy(mode: string, root: string): Plugin {
  const env = loadEnv(mode, root, '');
  const keys: Record<Provider, string | undefined> = { claude: env.ANTHROPIC_API_KEY, gemini: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, gpt: env.OPENAI_API_KEY };
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url || !/^\/api\/ai(\?|$)/.test(req.url)) return next();
    if (req.method === 'GET') return send(res, 200, { providers: { claude: !!keys.claude, gemini: !!keys.gemini, gpt: !!keys.gpt } });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST 로 보내 주세요' });
    try {
      const a = JSON.parse(await readBody(req)) as Ask;
      if (!['claude', 'gemini', 'gpt'].includes(a.provider)) return send(res, 400, { error: `모르는 AI: ${a.provider}` });
      const key = keys[a.provider];
      if (!key) return send(res, 400, { error: `${a.provider} 키가 없습니다 — .env.local 에 넣고 개발 서버를 다시 켜 주세요` });
      const t0 = Date.now();
      const text = await call(a, key);
      send(res, 200, { text, ms: Date.now() - t0 });
    } catch (e) { send(res, 502, { error: (e as Error).message }); }
  };
  return { name: 'kitchen-ai-proxy', configureServer(s) { s.middlewares.use(handler); }, configurePreviewServer(s) { s.middlewares.use(handler); } };
}
