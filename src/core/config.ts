import type { PurposeDef } from '../contract/types.js';
import type { ModelMeta } from '../contract/types.js';
import { getModelMeta } from './registry.js';
import type { ModelConfig } from './provider.js';
import { assertUsableBaseUrl, DEFAULT_BASE_URLS } from './provider.js';

export interface KvStorage {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export interface SecretsCipher {
  encrypt(plain: string): string;
  decrypt(stored: string): string | null;
}

export interface AiLogger {
  event(e: { level: 'info' | 'warn' | 'error'; category: string; code?: string; message: string }): void;
}

/** 不传 secrets 时的降级：明文 + `plain:` 前缀，decrypt 能读回（测试/无敏感场景） */
export function plainSecretCipher(): SecretsCipher {
  return {
    encrypt: (plain: string) => (plain ? `plain:${plain}` : ''),
    decrypt: (stored: string) => (stored.startsWith('plain:') ? stored.slice('plain:'.length) : null),
  };
}

export interface ProviderEntry {
  id: string;
  provider: string;
  /** 留空 = 用 DEFAULT_BASE_URLS 的默认地址 */
  baseUrl: string;
  /** 密文。HTTP 层只回 hasApiKey，永不回本字段明文 */
  apiKeyEnc: string;
}

export interface ModelEntry {
  id: string;
  providerId: string;
  model: string;
}

const PROVIDERS_KEY = 'llm.providers';
const MODELS_KEY = 'llm.models';
const OLLAMA_META_KEY = 'llm.ollama.meta';
const purposeKey = (p: string) => `llm.purpose.${p}`;

const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

/** 比较接口地址前先归一化：去两端空白 + 去尾部 `/` —— 尾斜杠差异不是"另一个端点" */
const normalizeUrl = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');

function readJson<T>(storage: KvStorage, key: string, fallback: T): T {
  const v = storage.get(key);
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback; // 脏数据当没有，别让整个设置页挂掉
  }
}

const writeJson = (storage: KvStorage, key: string, value: unknown) =>
  storage.set(key, JSON.stringify(value));

export interface ConfigApi {
  listProviders(): ProviderEntry[];
  saveProvider(input: { id?: string; provider: string; baseUrl?: string; apiKey?: string }): ProviderEntry;
  deleteProvider(id: string): void;
  listEntries(): ModelEntry[];
  addEntry(input: { providerId: string; model: string }): ModelEntry;
  deleteEntry(id: string): void;
  getAssignments(): Record<string, string | null>;
  setAssignment(purpose: string, entryId: string | null): void;
  ollamaMeta(): Record<string, { contextWindow: number; maxOutput: number }>;
  setOllamaMeta(meta: Record<string, { contextWindow: number; maxOutput: number }>): void;
  readLlmSettings(purpose: string): { config: ModelConfig; ctx: ModelMeta } | null;
  /** 按服务商取已存凭证的明文 key（baseUrl 非空时只在**同地址**凭证里找）；详见实现处的说明。找不到 = '' */
  savedApiKey(provider: string, baseUrl?: string): string;
}

export function createConfigApi(deps: {
  purposes: PurposeDef[];
  storage: KvStorage;
  secrets: SecretsCipher;
}): ConfigApi {
  const { purposes, storage, secrets } = deps;
  const purposeKeys = () => purposes.map((p) => p.key);
  const purposeLabel = (key: string) => purposes.find((p) => p.key === key)?.label ?? key;

  // 下面这几个同级读写抽成**局部函数**，方法内直接调用 —— 不许走 `this`：
  // 消费方一旦解构（`const { addEntry } = ai`）或把方法当回调传，严格模式 ESM 下
  // `this` 就是 undefined，直接 TypeError。行为与从前逐字一致。
  const readProviders = () => readJson<ProviderEntry[]>(storage, PROVIDERS_KEY, []);
  const readEntries = () => readJson<ModelEntry[]>(storage, MODELS_KEY, []);
  const getAssignments = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    for (const p of purposeKeys()) out[p] = storage.get(purposeKey(p)) ?? null;
    return out;
  };
  const ollamaMeta = () =>
    readJson<Record<string, { contextWindow: number; maxOutput: number }>>(storage, OLLAMA_META_KEY, {});

  return {
    listProviders: readProviders,

    saveProvider(input) {
      const provider = input.provider?.trim() ?? '';
      if (!provider) throw new Error('没有选服务商');
      assertUsableBaseUrl(input.baseUrl ?? '');

      const list = readProviders();
      const existing = input.id ? list.find((p) => p.id === input.id) : undefined;
      if (input.id && !existing) throw new Error('凭证不存在');

      const baseUrl = input.baseUrl !== undefined ? input.baseUrl.trim() : existing?.baseUrl ?? '';
      // 没有默认地址的 provider（custom / anthropic-compatible）必须显式填一个 ——
      // 否则空地址会被原样存下，直到真正调用才以 fetch 层的 URL 解析错暴露。
      // listRemoteModels 对同一场景是明确抛「没有默认接口地址」的，两处保持一致。
      if (!baseUrl && !DEFAULT_BASE_URLS[provider]) {
        throw new Error(`「${provider}」没有默认接口地址 —— 请先填一个`);
      }

      // 显式传 apiKey = 按传入值处理（空串 = 清空）；不传 = 保留已存密文
      let apiKeyEnc: string;
      if (input.apiKey !== undefined) {
        apiKeyEnc = input.apiKey ? secrets.encrypt(input.apiKey) : '';
      } else {
        apiKeyEnc = existing?.apiKeyEnc ?? '';
      }

      const entry: ProviderEntry = {
        id: existing?.id ?? newId('p'),
        provider,
        baseUrl,
        apiKeyEnc,
      };
      writeJson(storage, PROVIDERS_KEY, existing ? list.map((p) => (p.id === entry.id ? entry : p)) : [...list, entry]);
      return entry;
    },

    deleteProvider(id) {
      if (readEntries().some((e) => e.providerId === id)) {
        throw new Error('这条凭证还有模型条目在用 —— 先删掉对应条目');
      }
      writeJson(storage, PROVIDERS_KEY, readProviders().filter((p) => p.id !== id));
    },

    listEntries: readEntries,

    addEntry(input) {
      if (!input.model?.trim()) throw new Error('没有选模型');
      if (!readProviders().some((p) => p.id === input.providerId)) {
        throw new Error('凭证不存在');
      }
      const entry: ModelEntry = { id: newId('m'), providerId: input.providerId, model: input.model.trim() };
      writeJson(storage, MODELS_KEY, [...readEntries(), entry]);
      // 首条条目自动全分配 —— 避免配完一个模型，所有用途全是"未配置"
      const assigned = getAssignments();
      if (purposeKeys().every((p) => assigned[p] === null)) {
        for (const p of purposeKeys()) storage.set(purposeKey(p), entry.id);
      }
      return entry;
    },

    deleteEntry(id) {
      const holders = purposeKeys().filter((p) => getAssignments()[p] === id);
      if (holders.length > 0) {
        throw new Error(
          `这个条目正被用途引用(${holders.map(purposeLabel).join(' / ')})—— 先在「用途分配」里改指别的条目`,
        );
      }
      writeJson(storage, MODELS_KEY, readEntries().filter((e) => e.id !== id));
    },

    getAssignments,

    setAssignment(purpose, entryId) {
      if (entryId !== null && !readEntries().some((e) => e.id === entryId)) {
        throw new Error('条目不存在');
      }
      if (entryId === null) storage.delete(purposeKey(purpose));
      else storage.set(purposeKey(purpose), entryId);
    },

    ollamaMeta,

    setOllamaMeta(meta) {
      writeJson(storage, OLLAMA_META_KEY, meta);
    },

    readLlmSettings(purpose) {
      const entryId = getAssignments()[purpose];
      if (!entryId) return null;
      const entry = readEntries().find((e) => e.id === entryId);
      if (!entry) return null;
      const provider = readProviders().find((p) => p.id === entry.providerId);
      if (!provider) return null;

      const apiKey = provider.apiKeyEnc ? (secrets.decrypt(provider.apiKeyEnc) ?? '') : '';
      const base = getModelMeta(provider.provider, entry.model);

      let ctx: ModelMeta;
      if (provider.provider === 'ollama') {
        const real = ollamaMeta()[entry.model];
        ctx = real ? { ...base, ...real, verified: true } : base;
      } else {
        ctx = base;
      }

      return {
        config: {
          id: entry.model,
          provider: provider.provider,
          baseUrl: provider.baseUrl,
          apiKey,
          model: entry.model,
        },
        ctx,
      };
    },

    /**
     * 按服务商取已存凭证的**明文** key —— 仅供服务端拼上游请求使用，绝不回传给客户端。
     * baseUrl 非空时只在**同地址**的凭证里找（比较前去掉两端空白与尾部 `/`）；
     * 一条同地址的都找不到 → 返回 ''。baseUrl 留空才回退到该 provider 的任意可解密凭证。
     * **不做跨服务商回落** —— 那等于把 A 厂商的密钥发到 B 厂商端点。
     */
    savedApiKey(provider, baseUrl) {
      const target = provider.trim();
      const url = normalizeUrl(baseUrl);
      const withKey = readProviders().filter((p) => p.provider === target && p.apiKeyEnc !== '');
      // 传了地址就只认同地址的 —— custom 这种「一个桶装多个网关」的用法下，
      // 退回其它地址的 key 等于把网关 A 的密钥发到网关 B
      const candidates = url ? withKey.filter((p) => normalizeUrl(p.baseUrl) === url) : withKey;
      for (const p of candidates) {
        const plain = secrets.decrypt(p.apiKeyEnc);
        // 解不出的继续找下一条 —— 不能提前返回 ''，那会挡住后面本可用的凭证
        if (plain) return plain;
      }
      return '';
    },
  };
}
