import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createAiCore, redact, type AiLogger, type KvStorage } from '../core/index.js';
import { registerAiSettings } from './index.js';

// 把 provider 工厂换成假的「模型」工厂 —— 让 test-llm 能真的走完
// complete() 的失败路径(是真 SDK,只有模型是假的;别整体 mock `ai`)。
const mocks = vi.hoisted(() => ({
  createDeepSeek: vi.fn(),
  createOpenAICompatible: vi.fn(),
}));
vi.mock('@ai-sdk/deepseek', () => ({ createDeepSeek: mocks.createDeepSeek }));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mocks.createOpenAICompatible,
}));

const PURPOSES = [
  { key: 'proposals', label: '夹子方案生成' },
  { key: 'rules', label: '规则建议' },
  { key: 'tag', label: '打标' },
  { key: 'tagcheck', label: '标签质检' },
];

function memoryStorage(): KvStorage {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v), delete: (k) => void m.delete(k) };
}

async function makeApp() {
  const app = Fastify();
  const storage = memoryStorage();
  const ai = createAiCore({ purposes: PURPOSES, storage });
  // seed：1 凭证（带 key）+ 1 条目 + 全分配
  const p = ai.saveProvider({ provider: 'deepseek', apiKey: 'sk-secret-xyz' });
  const e = ai.addEntry({ providerId: p.id, model: 'deepseek-flash' });
  for (const { key } of PURPOSES) ai.setAssignment(key, e.id);
  await app.register(registerAiSettings, { ai });
  await app.ready();
  return { app, ai, storage };
}

/** doGenerate 一抛错就等价于「上游调用失败」——complete() 会把它往上传 */
function throwingModel(message: string) {
  return new MockLanguageModelV3({
    provider: 'fake',
    modelId: 'fake-model',
    doGenerate: async () => {
      throw new Error(message);
    },
  });
}

describe('registerAiSettings 路由', () => {
  afterEach(() => {
    vi.clearAllMocks();
  }); // app.close 在各用例内做

  it('providers 不回传明文 key', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/settings/providers' })).json();
    expect(JSON.stringify(body)).not.toContain('sk-secret-xyz');
    expect(body.providers[0].hasApiKey).toBe(true);
    await app.close();
  });

  it('PUT providers 无 apiKey 保留已存', async () => {
    const { app } = await makeApp();
    const p = (await app.inject({ method: 'GET', url: '/api/settings/providers' })).json().providers[0];
    const res = await app.inject({
      method: 'PUT', url: '/api/settings/providers',
      payload: { id: p.id, provider: 'deepseek', baseUrl: 'http://x/v1' },
    });
    expect(res.statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/settings/providers' })).json();
    expect(after.providers[0].hasApiKey).toBe(true);
    await app.close();
  });

  it('DELETE 被条目引用的凭证 → 400', async () => {
    const { app } = await makeApp();
    const p = (await app.inject({ method: 'GET', url: '/api/settings/providers' })).json().providers[0];
    const res = await app.inject({ method: 'DELETE', url: `/api/settings/providers/${p.id}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('entries 服务端拼好数字', async () => {
    const { app } = await makeApp();
    const body = (await app.inject({ method: 'GET', url: '/api/settings/entries' })).json();
    expect(body.entries[0].contextWindow).toBeTypeOf('number');
    expect(body.entries[0].model).toBe('deepseek-flash');
    await app.close();
  });

  it('test-llm 缺参数 → 400', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'POST', url: '/api/settings/test-llm', payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // ★ C9 安全不变量：测试连接的日志里不落明文 apiKey。
  //   上游报错经常把 key 原样回显，那一刻它不带任何键名 —— 键名规则一条都命中不了，
  //   唯一的兜底是 provider 在调模型前用 registerSecret 登记过这个值。
  //   这里刻意用一个**不带 `sk-` 前缀**的 key：redact 的 KEY_SHAPED 兜底只认 sk- 系，
  //   若这条仍被抹掉，只能是「按值抹」真的生效了（即 complete 登记过 key）。
  it('C9：test-llm 上游回显 apiKey → 注入 logger 经 redact 后不落明文', async () => {
    const KEY = 'ark-abcdef1234567890'; // 19 字，≥8，会被 registerSecret 登记
    const raw: string[] = [];
    const redacted: string[] = [];
    const logger: AiLogger = {
      event: (e) => {
        raw.push(e.message);
        // 消费方（BFM 的 Logger）就是在日志入口用包内这同一个 redact 抹值的
        redacted.push(redact(e.message));
      },
    };
    const app = Fastify();
    const storage = memoryStorage();
    const ai = createAiCore({ purposes: PURPOSES, storage });
    mocks.createDeepSeek.mockReturnValue(() => throwingModel(`401 Unauthorized: key ${KEY} 无效`));
    await app.register(registerAiSettings, { ai, logger });
    await app.ready();

    const res = await app.inject({
      method: 'POST', url: '/api/settings/test-llm',
      payload: { provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY },
    });

    expect(res.statusCode).toBe(502);
    // ① 之后，包内在调 logger **之前**就 redact 了 —— 注入的 logger 拿到的已是脱敏消息，
    //   所以 raw（logger 的输入）里也不该出现明文；出现 `***` 说明确实「按值抹」生效了
    //   （这个 key 没有 sk- 前缀，形态规则命中不了），即 complete 调模型前登记过它。
    expect(raw.join('\n')).not.toContain(KEY);
    expect(raw.join('\n')).toContain('***');
    // 消费方（BFM）再抹一次也幂等，同样不落明文
    expect(redacted.join('\n')).not.toContain(KEY);
    expect(redacted.join('\n')).toContain('***');
    await app.close();
  });

  // ★ ① 安全不变量：502 的 **HTTP 响应体** 里也不能落明文 apiKey。
  //   日志出口早就过了 redact，漏的是 HTTP 出口 —— reason 直接回传了上游 message。
  //   两个路由各覆盖一次，且都用**不带 `sk-` 前缀**的 key：
  //   形态规则(KEY_SHAPED)命中不了，只能靠路由里的 registerSecret 按值抹。
  it('① test-llm 上游回显 apiKey → 502 reason 不含明文', async () => {
    const KEY = 'mx-zyxwv9876543210'; // 19 字，无 sk- 前缀，形态规则命中不了
    const app = Fastify();
    const storage = memoryStorage();
    const ai = createAiCore({ purposes: PURPOSES, storage });
    mocks.createDeepSeek.mockReturnValue(() => throwingModel(`401 Unauthorized: key ${KEY} 无效`));
    await app.register(registerAiSettings, { ai });
    await app.ready();

    const res = await app.inject({
      method: 'POST', url: '/api/settings/test-llm',
      payload: { provider: 'deepseek', model: 'deepseek-flash', apiKey: KEY },
    });

    expect(res.statusCode).toBe(502);
    const reason = (res.json() as { reason: string }).reason;
    expect(reason).not.toContain(KEY);
    expect(reason).toContain('***');
    await app.close();
  });

  it('① remote-models 上游回显 apiKey → 502 reason 不含明文', async () => {
    const KEY = 'ark-qwerty1234567890'; // 20 字，无 sk- 前缀，形态规则命中不了
    const app = Fastify();
    const storage = memoryStorage();
    // 假 fetch 走 core 的注入点（listRemoteModels 用的就是它）：
    // 模拟上游把 key 原样回显进错误体（真实网关会这么干）
    const fetchImpl = vi.fn(async () => {
      throw new Error(`Invalid API key: ${KEY}`);
    }) as unknown as typeof fetch;
    const ai = createAiCore({ purposes: PURPOSES, storage, fetchImpl });
    await app.register(registerAiSettings, { ai });
    await app.ready();

    const res = await app.inject({
      method: 'POST', url: '/api/settings/remote-models',
      payload: { provider: 'ark', apiKey: KEY },
    });

    expect(res.statusCode).toBe(502);
    const reason = (res.json() as { reason: string }).reason;
    expect(reason).not.toContain(KEY);
    expect(reason).toContain('***');
    await app.close();
  });

  // ★ ③ key 作用域：apiKey 留空时的回落**必须限定同一服务商**。
  //   曾经用「第一个带凭证的条目」当回落源 —— 多服务商场景下会把 A 厂商的 key
  //   发到 B 厂商的 baseUrl 上（三次审查都命中这条）。
  it('③ remote-models：apiKey 留空只回落同服务商已存凭证，跨服务商不回落', async () => {
    const app = Fastify();
    const storage = memoryStorage();
    const seen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
    }) as unknown as typeof fetch;
    const ai = createAiCore({ purposes: PURPOSES, storage, fetchImpl });
    // 只存了 deepseek 的凭证
    ai.saveProvider({ provider: 'deepseek', apiKey: 'sk-deepseek-only' });
    await app.register(registerAiSettings, { ai });
    await app.ready();

    // 查取 ark 时留空 apiKey：**不能**回落到 deepseek 的那把
    await app.inject({ method: 'POST', url: '/api/settings/remote-models', payload: { provider: 'ark' } });
    expect(seen[0]).toBe('Bearer not-needed');

    // 同服务商留空 apiKey：用已存的 deepseek 凭证
    await app.inject({ method: 'POST', url: '/api/settings/remote-models', payload: { provider: 'deepseek' } });
    expect(seen[1]).toBe('Bearer sk-deepseek-only');
    await app.close();
  });

  // ★ ollama-models 这条胶水路的整链：拉模型 → 算出 maxOutput → 写回 meta → entries 读到真实值
  it('ollama-models：返回按 outputBudget 算的 maxOutput 且写回 meta、entries 用真实值 verified', async () => {
    const app = Fastify();
    const storage = memoryStorage();
    const ai = createAiCore({ purposes: PURPOSES, storage });
    // ollama 条目：模型名与下面假 /api/tags 报的一致
    const p = ai.saveProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' });
    ai.addEntry({ providerId: p.id, model: 'qwen2.5:14b' });

    // 假的 Ollama：/api/tags 报两个模型；/api/show 按模型回不同 context_length
    const ctx: Record<string, number> = { 'qwen2.5:14b': 32768, 'llama3:8b': 8192 };
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/api/tags')) {
        return {
          ok: true, status: 200,
          json: async () => ({ models: [{ name: 'qwen2.5:14b' }, { name: 'llama3:8b' }] }),
        } as Response;
      }
      const name = JSON.parse(String(init?.body)).name as string;
      return {
        ok: true, status: 200,
        json: async () => ({ model_info: { 'general.architecture': 'x', 'x.context_length': ctx[name] } }),
      } as Response;
    }) as unknown as typeof fetch;

    await app.register(registerAiSettings, { ai, fetchImpl });
    await app.ready();

    const body = (await app.inject({ method: 'GET', url: '/api/settings/ollama-models' })).json();
    // 32768/4 = 8192（正好封顶）；8192/4 = 2048（走 1/4 规则）
    expect(body.models.map((m: { name: string; maxOutput: number }) => [m.name, m.maxOutput])).toEqual([
      ['qwen2.5:14b', 8192],
      ['llama3:8b', 2048],
    ]);

    // 写回了 llm.ollama.meta —— 直接读内存 storage 的 key 验证
    const meta = JSON.parse(storage.get('llm.ollama.meta')!) as Record<string, { contextWindow: number; maxOutput: number }>;
    expect(meta['qwen2.5:14b']).toEqual({ contextWindow: 32768, maxOutput: 8192 });
    expect(meta['llama3:8b']).toEqual({ contextWindow: 8192, maxOutput: 2048 });

    // 之后 entries 对该 ollama 条目用真实值且 verified: true
    const entries = (await app.inject({ method: 'GET', url: '/api/settings/entries' })).json();
    expect(entries.entries[0].contextWindow).toBe(32768);
    expect(entries.entries[0].verified).toBe(true);
    await app.close();
  });

  // ★ B1：三条 502 出口一律过 redact —— Ollama 这条曾经漏了（上游把凭证回显进错误体时
  //   会原样落进 HTTP 响应）。
  it('B1：ollama-models 502 的 reason 也过 redact', async () => {
    const app = Fastify();
    const storage = memoryStorage();
    const ai = createAiCore({ purposes: PURPOSES, storage });
    const fetchImpl = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED key=sk-abcdef123456zzz');
    }) as unknown as typeof fetch;
    await app.register(registerAiSettings, { ai, fetchImpl });
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/settings/ollama-models' });

    expect(res.statusCode).toBe(502);
    const reason = (res.json() as { reason: string }).reason;
    expect(reason).not.toContain('sk-abcdef123456zzz');
    expect(reason).toContain('***');
    await app.close();
  });

  // ★ B5：插件层不注入 fetchImpl 时必须把 undefined 透传给 core ——
  //   否则 `opts.fetchImpl ?? fetch` 会把 core 注入的假 fetch 顶掉：
  //   同一个插件里 /remote-models 用注入的、/ollama-models 用全局的，只注 core 的消费方会误判。
  it('B5：插件不注入 fetchImpl 时，/ollama-models 仍走 core 注入的 fetch', async () => {
    const app = Fastify();
    const storage = memoryStorage();
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ models: [] }) } as Response;
    }) as unknown as typeof fetch;
    const ai = createAiCore({ purposes: PURPOSES, storage, fetchImpl });
    await app.register(registerAiSettings, { ai }); // 刻意不传 fetchImpl
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/settings/ollama-models' });

    expect(res.statusCode).toBe(200);
    expect(calls).toEqual(['http://127.0.0.1:11434/api/tags']);
    await app.close();
  });

  // ★ B2：/api/settings/models 直接用注册表的 listModels（不再经三层纯转发包装）
  it('B2：models 路由可按 provider 过滤', async () => {
    const { app } = await makeApp();
    const all = (await app.inject({ method: 'GET', url: '/api/settings/models' })).json();
    const deepseek = (await app.inject({ method: 'GET', url: '/api/settings/models?provider=deepseek' })).json();

    expect(deepseek.models).toHaveLength(1);
    expect(deepseek.models[0].provider).toBe('deepseek');
    expect(all.models.length).toBeGreaterThan(deepseek.models.length);
    await app.close();
  });

  // ★ B6：凭证没了（条目成了孤儿）时 entryMeta 兜底 custom，而不是崩 / 少字段
  it('B6：条目的凭证被删掉（孤儿条目）时兜底 custom', async () => {
    const { app, storage } = await makeApp();
    storage.delete('llm.providers'); // 直接抹掉凭证表，造出孤儿条目
    const body = (await app.inject({ method: 'GET', url: '/api/settings/entries' })).json();

    expect(body.entries[0].provider).toBe('?');
    expect(body.entries[0].contextWindow).toBeTypeOf('number');
    expect(body.entries[0].maxOutput).toBeTypeOf('number');
    await app.close();
  });
});
