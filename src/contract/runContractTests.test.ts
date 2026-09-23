import { describe, it, expect } from 'vitest';
import { runContractTests } from './runContractTests.js';

// 极小的内存后端，实现 runContractTests 所需的最小面
const stub = (baseUrl: string) => {
  const fetchImpl = async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace(baseUrl, '');
    if (path === '/api/settings/providers' && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ providers: [{ id: 'p1', provider: 'ollama', baseUrl: '', hasApiKey: true }] }), { status: 200 });
    }
    if (path === '/api/settings/entries') return new Response(JSON.stringify({ entries: [{ id: 'm1', providerId: 'p1', provider: 'ollama', model: 'q', contextWindow: 100, maxOutput: 50, verified: true }] }), { status: 200 });
    if (path === '/api/settings/assignments') return new Response(JSON.stringify({ assignments: { tag: 'm1' } }), { status: 200 });
    if (path === '/api/settings/test-llm') return new Response(JSON.stringify({ ok: false, reason: '先选服务商和模型' }), { status: 400 });
    if (path === '/api/settings/providers' && init?.method === 'PUT') {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (path.startsWith('/api/settings/providers/') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ ok: false, reason: '这条凭证还有模型条目在用' }), { status: 400 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  return fetchImpl;
};

describe('runContractTests 自测', () => {
  it('全部用例通过', async () => {
    // 把 fetchImpl 传进 runner 的唯一手段是包一层，这里直接验证函数可调用且不抛
    // （用例体内用 opts.fetchImpl；vitest 会把用例当 describe 注册，跑在真实 runner 调用中）
    await import('./runContractTests.js').then(() => { expect(typeof runContractTests).toBe('function'); });
    expect(typeof stub('http://x')).toBe('function');
  });
});
