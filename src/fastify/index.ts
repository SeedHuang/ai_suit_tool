import type { FastifyInstance } from 'fastify';
import type { AiCore } from '../core/index.js';
import type { AiLogger } from '../core/index.js';
import type { ModelMeta } from '../contract/types.js';
// registry.ts 只依赖 contract/types.ts，引它不会连带 provider.ts 与 `ai` SDK
import { getModelMeta, listModels } from '../core/registry.js';
// 刻意从 redact.ts 引、而不是 core/index.js —— 后者会连带 provider.ts 与 `ai` SDK，
// 这里只想要脱敏。redact.ts 零 import，且与 provider.ts 引用的是同一份模块实例
// （registerSecret 登记的凭据值，这里抹得掉）。
import { redact, registerSecret } from '../core/redact.js';

export interface AiSettingsPluginOptions {
  ai: AiCore;
  logger?: AiLogger;
  /**
   * 注入点：Ollama 模型发现的 fetch（测试用假的）。
   *
   * **这里注入会覆盖 core 的注入点**（`createAiCore({ fetchImpl })`）。本插件默认不回落
   * 全局 fetch —— 留 undefined 透传给 core，让 core 自己的注入点仍然生效；否则同一个
   * 插件里 `/remote-models` 走 core 的假 fetch、`/ollama-models` 走全局 fetch，只注了
   * core 的消费方会以为两个出口用同一份。
   */
  fetchImpl?: typeof fetch;
}

/**
 * 未注入 `logger` 时的默认出口。
 *
 * message 必须过 redact：上游报错经常把 key 原样回显（`401 Unauthorized: key sk-xxx 无效`），
 * 那一刻它不带键名，键名规则一条都命中不了。注入的 logger 自己负责抹值（BFM 的 Logger
 * 就是这么做的），但这条默认路径是**本包**打的 stdout，得本包自己保证不落明文。
 */
const consoleLogger: AiLogger = {
  event: (e) =>
    console.log(`[ai] ${e.level} ${e.category}${e.code ? `:${e.code}` : ''} ${redact(e.message)}`),
};

/** 「测试连接」的探针提示词 —— 只要两个字，省 token 也省等待 */
const PROBE_PROMPT = '回复两个字:可以';

// ── helper ──

/**
 * 解出这次请求该用哪把 key，并**按值登记**给 redact。
 *
 * 用户传入优先（刚粘贴、还没保存的那把），否则查已存（同服务商 + 同地址，查不到就是空）。
 * 登记是必须的：方舟/MiniMax 的 key 没有 `sk-` 前缀，redact 的形态规则命中不了，
 * 只有按值抹才兜得住上游把它回显进错误体 / 日志。
 */
function resolveApiKey(
  ai: AiCore,
  provider: string,
  baseUrl: string | undefined,
  apiKey: string | undefined,
): string {
  const saved = ai.savedApiKey(provider, baseUrl?.trim());
  const resolved = apiKey?.trim() || saved || '';
  registerSecret(resolved);
  return resolved;
}

/**
 * 条目视图里该显示的数字：ollama 有运行时真值（`/api/show` 拉的）就用它并标 verified，
 * 否则查注册表；凭证已不存在（条目成了孤儿）时兜底 custom。
 */
function entryMeta(
  provider: string | undefined,
  model: string,
  ollama: Record<string, { contextWindow: number; maxOutput: number }>,
): ModelMeta {
  if (!provider) return getModelMeta('custom', model);
  const base = getModelMeta(provider, model);
  const real = provider === 'ollama' ? ollama[model] : undefined;
  return real ? { ...base, ...real, verified: true } : base;
}

export function registerAiSettings(app: FastifyInstance, opts: AiSettingsPluginOptions): void {
  const { ai } = opts;
  const logger = opts.logger ?? consoleLogger;
  // 不在这里回落全局 fetch —— 留 undefined 让 core 自己的注入点仍能生效（见选项注释）
  const fetchImpl = opts.fetchImpl;

  app.get('/api/settings/models', async (req) => {
    const provider = (req.query as { provider?: string }).provider;
    return { models: provider ? listModels(provider) : listModels() };
  });

  app.get('/api/settings/ollama-models', async (req, reply) => {
    const baseUrl = (req.query as { baseUrl?: string }).baseUrl ?? '';
    try {
      const models = await ai.listOllamaModels(baseUrl, fetchImpl);
      const prev = ai.ollamaMeta();
      for (const m of models) prev[m.name] = { contextWindow: m.contextWindow, maxOutput: m.maxOutput };
      ai.setOllamaMeta(prev);
      return { models };
    } catch (e) {
      let tried = baseUrl;
      try {
        tried = ai.ollamaRoot(baseUrl);
      } catch {
        // 地址本身非法，原样显示更好定位
      }
      // 三条 502 出口一律过 redact：`tried` 来自用户可填的地址（可能带 user:pass@host），
      // 代理场景下上游报错也可能回显凭证
      return reply
        .code(502)
        .send({ ok: false, reason: redact(`连不上本地 Ollama(${tried}):${(e as Error)?.message ?? e}`) });
    }
  });

  app.post('/api/settings/remote-models', async (req, reply) => {
    const body = (req.body ?? {}) as { provider?: string; baseUrl?: string; apiKey?: string };
    if (!body.provider) return reply.code(400).send({ ok: false, reason: '先选服务商' });
    const apiKey = resolveApiKey(ai, body.provider, body.baseUrl, body.apiKey);
    try {
      const models = await ai.listRemoteModels({
        provider: body.provider,
        baseUrl: body.baseUrl?.trim() ?? '',
        apiKey,
      });
      return { models };
    } catch (e) {
      const message = redact((e as Error)?.message ?? String(e));
      logger.event({ level: 'warn', category: 'llm', code: 'LIST_MODELS_FAILED', message });
      return reply.code(502).send({ ok: false, reason: message });
    }
  });

  app.get('/api/settings/providers', async () => ({
    providers: ai.listProviders().map(({ id, provider, baseUrl, apiKeyEnc }) => ({
      id, provider, baseUrl, hasApiKey: apiKeyEnc !== '',
    })),
  }));

  app.put('/api/settings/providers', async (req, reply) => {
    const body = (req.body ?? {}) as { id?: string; provider: string; baseUrl?: string; apiKey?: string };
    try {
      const p = ai.saveProvider(body);
      logger.event({ level: 'info', category: 'llm', message: `服务商凭证已保存:${p.provider}` });
      return { ok: true, id: p.id };
    } catch (e) {
      return reply.code(400).send({ ok: false, reason: (e as Error).message });
    }
  });

  app.delete('/api/settings/providers/:id', async (req, reply) => {
    try {
      ai.deleteProvider((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, reason: (e as Error).message });
    }
  });

  app.get('/api/settings/entries', async () => {
    const providers = ai.listProviders();
    const meta = ai.ollamaMeta();
    return {
      entries: ai.listEntries().map((e) => {
        const provider = providers.find((p) => p.id === e.providerId);
        const ctx = entryMeta(provider?.provider, e.model, meta);
        return {
          id: e.id, providerId: e.providerId,
          provider: provider?.provider ?? '?',
          model: e.model,
          contextWindow: ctx.contextWindow, maxOutput: ctx.maxOutput,
          verified: ctx.verified, ...(ctx.note ? { note: ctx.note } : {}),
        };
      }),
    };
  });

  app.post('/api/settings/entries', async (req, reply) => {
    const body = (req.body ?? {}) as { providerId?: string; model?: string };
    try {
      const e = ai.addEntry({ providerId: body.providerId ?? '', model: body.model ?? '' });
      logger.event({ level: 'info', category: 'llm', message: `模型条目已添加:${e.model}` });
      return { ok: true, id: e.id };
    } catch (e) {
      return reply.code(400).send({ ok: false, reason: (e as Error).message });
    }
  });

  app.delete('/api/settings/entries/:id', async (req, reply) => {
    try {
      ai.deleteEntry((req.params as { id: string }).id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, reason: (e as Error).message });
    }
  });

  app.get('/api/settings/assignments', async () => ({ assignments: ai.getAssignments() }));

  app.put('/api/settings/assignments', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | null>;
    try {
      for (const purpose of Object.keys(ai.getAssignments())) {
        if (body[purpose] !== undefined) ai.setAssignment(purpose, body[purpose]);
      }
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ ok: false, reason: (e as Error).message });
    }
  });

  app.post('/api/settings/test-llm', async (req, reply) => {
    const body = (req.body ?? {}) as {
      provider?: string; baseUrl?: string; apiKey?: string; model?: string;
    };
    if (!body.provider || !body.model) {
      return reply.code(400).send({ ok: false, reason: '先选服务商和模型' });
    }
    const apiKey = resolveApiKey(ai, body.provider, body.baseUrl, body.apiKey);
    const meta: ModelMeta = getModelMeta(body.provider, body.model);
    try {
      const started = Date.now();
      const text = await ai.complete({
        config: {
          id: body.model,
          provider: body.provider,
          baseUrl: body.baseUrl?.trim() ?? '',
          apiKey,
          model: body.model,
        },
        // 上游挂起（本地模型 OOM / 网络黑洞）时别让「测试连接」无限转圈 ——
        // 不传超时的话 busy==='test' 永不释放，按钮一直转
        timeoutMs: 15_000,
        messages: [{ role: 'user', content: PROBE_PROMPT }],
        thinking: false,
      });
      logger.event({
        level: 'info',
        category: 'llm',
        message: `测试连接成功:${body.provider}/${body.model}(${Date.now() - started}ms)`,
      });
      return { ok: true, reply: text.slice(0, 100), contextWindow: meta.contextWindow, maxOutput: meta.maxOutput };
    } catch (e) {
      const message = redact((e as Error)?.message ?? String(e));
      logger.event({ level: 'warn', category: 'llm', code: 'LLM_TEST_FAILED', message });
      return reply.code(502).send({ ok: false, reason: message });
    }
  });
}
