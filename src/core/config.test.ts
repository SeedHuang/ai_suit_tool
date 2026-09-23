import { describe, expect, it } from 'vitest';
import { createConfigApi, plainSecretCipher, type KvStorage, type SecretsCipher } from './config.js';

function memoryStorage(): KvStorage & { _map: Map<string, string> } {
  const _map = new Map<string, string>();
  return {
    _map,
    get: (k) => _map.get(k),
    set: (k, v) => void _map.set(k, v),
    delete: (k) => void _map.delete(k),
  };
}

const PURPOSES = [
  { key: 'proposals', label: '夹子方案生成' },
  { key: 'rules', label: '规则建议' },
  { key: 'tag', label: '打标' },
  { key: 'tagcheck', label: '标签质检' },
];

const api = (storage: KvStorage = memoryStorage(), secrets: SecretsCipher = plainSecretCipher()) =>
  createConfigApi({ purposes: PURPOSES, storage, secrets });

function seed(storage: KvStorage = memoryStorage()) {
  const a = api(storage);
  const p = a.saveProvider({ provider: 'ollama', baseUrl: '', apiKey: '' });
  const e = a.addEntry({ providerId: p.id, model: 'qwen2.5:14b' });
  for (const { key } of PURPOSES) a.setAssignment(key, e.id);
  return { a, p, e };
}

describe('createConfigApi 三层存储', () => {
  it('saveProvider 加密存储、listProviders 带回密文', () => {
    const a = api();
    const p = a.saveProvider({ provider: 'deepseek', apiKey: 'sk-keep-me-1234' });
    expect(p.apiKeyEnc).toContain('plain:');
    // savedApiKey 按服务商取明文
    expect(a.savedApiKey('deepseek')).toBe('sk-keep-me-1234');
  });

  it('saveProvider 无 apiKey = 保留已存', () => {
    const { a, p } = seed();
    const again = a.saveProvider({ id: p.id, provider: 'ollama', baseUrl: 'http://x/v1' });
    expect(again.apiKeyEnc).toBe(p.apiKeyEnc);
  });

  it('首条条目自动全分配', () => {
    const a = api();
    const p = a.saveProvider({ provider: 'ollama' });
    a.addEntry({ providerId: p.id, model: 'qwen2.5:14b' });
    const assigned = a.getAssignments();
    for (const { key } of PURPOSES) expect(assigned[key]).not.toBeNull();
  });

  it('deleteEntry 被用途引用 → 抛错', () => {
    const { a, e } = seed();
    expect(() => a.deleteEntry(e.id)).toThrow(/用途引用/);
  });

  it('deleteProvider 被条目引用 → 抛错', () => {
    const { a, p } = seed();
    expect(() => a.deleteProvider(p.id)).toThrow(/模型条目在用/);
  });

  it('readLlmSettings 三层查找 + ollama 真实数字', () => {
    const { a, e } = seed();
    a.setOllamaMeta({ 'qwen2.5:14b': { contextWindow: 32_768, maxOutput: 8_192 } });
    const s = a.readLlmSettings('rules')!;
    expect(s.config.model).toBe('qwen2.5:14b');
    expect(s.ctx.verified).toBe(true);
    expect(s.ctx.contextWindow).toBe(32_768);
    expect(s.config.apiKey).toBe('');
  });

  it('readLlmSettings 未分配 → null', () => {
    const a = api();
    expect(a.readLlmSettings('rules')).toBeNull();
  });

  it('savedApiKey 跳过无 key 的凭证', () => {
    const a = api();
    a.saveProvider({ provider: 'ollama' }); // 无 key
    expect(a.savedApiKey('ollama')).toBe('');
  });

  it('savedApiKey 取该服务商第一条带 key 的凭证（跳过前面无 key 的）', () => {
    const a = api();
    a.saveProvider({ provider: 'deepseek' }); // 无 key
    a.saveProvider({ provider: 'deepseek', apiKey: 'sk-second' });
    expect(a.savedApiKey('deepseek')).toBe('sk-second');
  });

  it('savedApiKey 解不出密文的那条继续往下找（不提前返回空）', () => {
    // 密文前缀不是 plain: 就解不出来 —— 模拟 DPAPI 换了用户/机器后旧密文失效
    const halfBroken: SecretsCipher = {
      encrypt: (plain) => (plain === 'bad' ? 'undecryptable' : `plain:${plain}`),
      decrypt: (stored) => (stored.startsWith('plain:') ? stored.slice('plain:'.length) : null),
    };
    const a = api(memoryStorage(), halfBroken);
    a.saveProvider({ provider: 'deepseek', apiKey: 'bad' }); // 密文解不出
    a.saveProvider({ provider: 'deepseek', apiKey: 'sk-good' });
    expect(a.savedApiKey('deepseek')).toBe('sk-good');
  });

  it('savedApiKey 优先取 baseUrl 也匹配的那条', () => {
    const a = api();
    a.saveProvider({ provider: 'deepseek', baseUrl: 'http://a/v1', apiKey: 'sk-a' });
    a.saveProvider({ provider: 'deepseek', baseUrl: 'http://b/v1', apiKey: 'sk-b' });
    expect(a.savedApiKey('deepseek', 'http://b/v1')).toBe('sk-b');
    expect(a.savedApiKey('deepseek')).toBe('sk-a');
  });

  it('savedApiKey 跨服务商不回落', () => {
    const a = api();
    a.saveProvider({ provider: 'deepseek', apiKey: 'sk-deepseek' });
    // 只存了 deepseek 的 key，查 ollama 必须返回空 —— 否则等于把 A 厂商的密钥发到 B 厂商端点
    expect(a.savedApiKey('ollama')).toBe('');
  });

  // ★ A1 安全不变量：同一个 provider 桶里装着**不同端点**的凭证时，传了地址就只能认同地址的。
  //   custom 这种「一个桶装多个网关」的用法下，退回其它地址的 key = 把网关 A 的密钥发到网关 B。
  it('savedApiKey 传了地址但同 provider 没有同址凭证 → 返回空（不退回其它地址的 key）', () => {
    const a = api();
    a.saveProvider({ provider: 'custom', baseUrl: 'https://gw-a.example/v1', apiKey: 'sk-gw-a' });
    expect(a.savedApiKey('custom', 'https://gw-b.example/v1')).toBe('');
  });

  it('savedApiKey 只差一个尾斜杠仍算同地址', () => {
    const a = api();
    a.saveProvider({ provider: 'custom', baseUrl: 'https://gw-a.example/v1', apiKey: 'sk-gw-a' });
    expect(a.savedApiKey('custom', 'https://gw-a.example/v1/')).toBe('sk-gw-a');
    expect(a.savedApiKey('custom', '  https://gw-a.example/v1  ')).toBe('sk-gw-a');
  });

  it('savedApiKey baseUrl 留空 → 回退该 provider 的任意可解密凭证', () => {
    const a = api();
    a.saveProvider({ provider: 'custom', baseUrl: 'https://gw-a.example/v1', apiKey: 'sk-gw-a' });
    expect(a.savedApiKey('custom')).toBe('sk-gw-a');
    expect(a.savedApiKey('custom', '')).toBe('sk-gw-a');
  });

  it('savedApiKey 同址那条没 key 也不退回其它地址的（同址范围内继续找而已）', () => {
    const a = api();
    a.saveProvider({ provider: 'custom', baseUrl: 'https://gw-a.example/v1', apiKey: 'sk-gw-a' });
    a.saveProvider({ provider: 'custom', baseUrl: 'https://gw-b.example/v1' }); // 地址对、没 key
    expect(a.savedApiKey('custom', 'https://gw-b.example/v1')).toBe('');
  });

  // ★ A8：没有默认地址的 provider 不能存空地址 —— 否则直到真正调用时才以 fetch 层的
  //   URL 解析错暴露，而 listRemoteModels 对同一场景是明确报「没有默认接口地址」的。
  it('saveProvider 没有默认地址的 provider + 空 baseUrl → 明确报错', () => {
    const a = api();
    expect(() => a.saveProvider({ provider: 'custom', apiKey: 'sk-x' })).toThrow(/没有默认接口地址/);
    expect(() => a.saveProvider({ provider: 'anthropic-compatible' })).toThrow(/没有默认接口地址/);
  });

  it('saveProvider 没有默认地址但填了 baseUrl → 正常存下', () => {
    const a = api();
    const p = a.saveProvider({ provider: 'custom', baseUrl: 'https://gw.example/v1' });
    expect(p.baseUrl).toBe('https://gw.example/v1');
  });

  it('saveProvider 有默认地址的 provider 仍可留空 baseUrl', () => {
    const a = api();
    expect(a.saveProvider({ provider: 'deepseek', apiKey: 'sk-d' }).baseUrl).toBe('');
  });

  // ★ A6：方法内不许再依赖 `this` —— 解构出来单独调用（或当回调传）必须照样跑。
  //   走 `this` 的话严格模式 ESM 下 `this` 是 undefined，直接 TypeError。
  it('方法解构出来后仍可调用（不再依赖 this）', () => {
    const core = api();
    const { saveProvider, addEntry, deleteEntry, readLlmSettings, getAssignments } = core;

    const p = saveProvider({ provider: 'deepseek', apiKey: 'sk-d' });
    const e = addEntry({ providerId: p.id, model: 'deepseek-flash' });
    // addEntry 内部要读 getAssignments（首条自动全分配）
    for (const { key } of PURPOSES) expect(getAssignments()[key]).toBe(e.id);
    // readLlmSettings 内部要读 getAssignments + ollamaMeta
    expect(readLlmSettings('rules')?.config.model).toBe('deepseek-flash');
    // deleteEntry 内部要读 getAssignments —— 已被用途引用，必须抛「用途引用」而不是 TypeError
    expect(() => deleteEntry(e.id)).toThrow(/用途引用/);
  });
});
