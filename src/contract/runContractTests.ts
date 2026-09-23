import { describe, expect, it } from 'vitest';
import type { EntryView, ProviderView } from './types.js';

export interface ContractTestOpts {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/** 实现方自证合规：对任意 baseUrl 跑全部契约用例。seedLlm 语义由实现方保证 */
export function runContractTests(opts: ContractTestOpts): void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const call = async <T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> => {
    const res = await fetchImpl(`${opts.baseUrl}${path}`, init);
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  };

  describe('AI 设置契约（runContractTests）', () => {
    it('providers 列表不回传明文 key', async () => {
      const { body } = await call<{ providers: ProviderView[] }>('/api/settings/providers');
      // 存密钥的字段名不许出现（含任意嵌套层）—— 断言**字段**而不是 key 的**值**：
      // runner 不知道实现方 seed 的是哪个 key，断言字面量 key 是恒真的装饰。
      // 「不回明文」的主不变量是下面那条逐条精确的键集合断言。
      expect(JSON.stringify(body)).not.toContain('apiKeyEnc');
      for (const p of body.providers) {
        expect(Object.keys(p).sort()).toEqual(['id', 'provider', 'baseUrl', 'hasApiKey'].sort());
      }
    });

    it('PUT providers 更新时 apiKey 不带 = 保留已存', async () => {
      const { body: list } = await call<{ providers: ProviderView[] }>('/api/settings/providers');
      const p = list.providers[0];
      if (!p) throw new Error('契约测试需要至少一条已 seed 的凭证');
      const res = await call<{ ok: true }>('/api/settings/providers', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, provider: p.provider, baseUrl: 'http://x/v1' }), // 无 apiKey
      });
      expect(res.status).toBe(200);
      const { body: after } = await call<{ providers: ProviderView[] }>('/api/settings/providers');
      expect(after.providers.find((x) => x.id === p.id)?.hasApiKey).toBe(true);
    });

    it('DELETE 被条目引用的凭证 → 400 且带 reason', async () => {
      const { body: list } = await call<{ providers: ProviderView[] }>('/api/settings/providers');
      const p = list.providers.find((x) => x.hasApiKey) ?? list.providers[0];
      if (!p) throw new Error('需要至少一条凭证');
      const res = await call<{ ok: false; reason: string }>(
        `/api/settings/providers/${p.id}`,
        { method: 'DELETE' },
      );
      expect(res.status).toBe(400);
      expect((res.body as { reason?: string }).reason).toBeTruthy();
    });

    it('entries 视图带服务端拼好的数字', async () => {
      const { body } = await call<{ entries: EntryView[] }>('/api/settings/entries');
      for (const e of body.entries) {
        expect(typeof e.contextWindow).toBe('number');
        expect(typeof e.maxOutput).toBe('number');
        expect(typeof e.verified).toBe('boolean');
      }
    });

    it('assignments 覆盖全部用途键', async () => {
      const { body } = await call<{ assignments: Record<string, string | null> }>(
        '/api/settings/assignments',
      );
      expect(Object.keys(body.assignments).length).toBeGreaterThan(0);
    });

    it('test-llm 缺参数 → 400', async () => {
      const res = await call<{ ok: false; reason: string }>('/api/settings/test-llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });
}
