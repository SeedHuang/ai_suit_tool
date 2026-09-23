import type {
  AssignmentsView, EntryView, ModelMeta, OllamaModelView, ProviderView,
} from '../contract/types.js';

export interface AiClient {
  listModels(provider?: string): Promise<ModelMeta[]>;
  listRemoteModels(input: { provider: string; baseUrl?: string; apiKey?: string }): Promise<ModelMeta[]>;
  ollamaModels(baseUrl: string): Promise<OllamaModelView[]>;
  providers(): Promise<ProviderView[]>;
  saveProvider(input: { id?: string; provider: string; baseUrl?: string; apiKey?: string }): Promise<{ ok: true; id: string }>;
  deleteProvider(id: string): Promise<{ ok: true }>;
  entries(): Promise<EntryView[]>;
  addEntry(input: { providerId: string; model: string }): Promise<{ ok: true; id: string }>;
  deleteEntry(id: string): Promise<{ ok: true }>;
  assignments(): Promise<Record<string, string | null>>;
  setAssignments(input: Record<string, string | null>): Promise<{ ok: true }>;
  test(input: { provider: string; model: string; baseUrl?: string; apiKey?: string }): Promise<{ ok: true; reply: string }>;
}

export function createAiClient(opts: { baseURL: string; fetchImpl?: typeof fetch }): AiClient {
  const baseURL = opts.baseURL.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(`${baseURL}${path}`, init);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error((body as { reason?: string }).reason ?? `请求失败 ${res.status}`);
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return res.json() as Promise<T>;
  }

  function json<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return api<T>(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }

  return {
    listModels: (provider) =>
      api<{ models: ModelMeta[] }>(`/api/settings/models${provider ? `?provider=${provider}` : ''}`).then((r) => r.models),
    listRemoteModels: (input) =>
      json<{ models: ModelMeta[] }>('POST', '/api/settings/remote-models', input).then((r) => r.models),
    ollamaModels: (baseUrl) =>
      api<{ models: OllamaModelView[] }>(`/api/settings/ollama-models?baseUrl=${encodeURIComponent(baseUrl)}`).then((r) => r.models),
    providers: () => api<{ providers: ProviderView[] }>('/api/settings/providers').then((r) => r.providers),
    saveProvider: (input) => json<{ ok: true; id: string }>('PUT', '/api/settings/providers', input),
    deleteProvider: (id) => json<{ ok: true }>('DELETE', `/api/settings/providers/${id}`),
    entries: () => api<{ entries: EntryView[] }>('/api/settings/entries').then((r) => r.entries),
    addEntry: (input) => json<{ ok: true; id: string }>('POST', '/api/settings/entries', input),
    deleteEntry: (id) => json<{ ok: true }>('DELETE', `/api/settings/entries/${id}`),
    assignments: () => api<AssignmentsView>('/api/settings/assignments').then((r) => r.assignments),
    setAssignments: (input) => json<{ ok: true }>('PUT', '/api/settings/assignments', input),
    test: (input) => json<{ ok: true; reply: string }>('POST', '/api/settings/test-llm', input),
  };
}
