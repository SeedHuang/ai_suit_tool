import type { AssignmentsView, EntryView, ModelMeta, OllamaModelView, ProviderView } from './types.js';

/** 契约端点清单 —— 实现方照此实现即合规。key 只走 body，永不进 query（防落日志） */
export const AI_ENDPOINTS = [
  { method: 'GET', path: '/api/settings/models' },
  { method: 'POST', path: '/api/settings/remote-models' },
  { method: 'GET', path: '/api/settings/ollama-models' },
  { method: 'GET', path: '/api/settings/providers' },
  { method: 'PUT', path: '/api/settings/providers' },
  { method: 'DELETE', path: '/api/settings/providers/:id' },
  { method: 'GET', path: '/api/settings/entries' },
  { method: 'POST', path: '/api/settings/entries' },
  { method: 'DELETE', path: '/api/settings/entries/:id' },
  { method: 'GET', path: '/api/settings/assignments' },
  { method: 'PUT', path: '/api/settings/assignments' },
  { method: 'POST', path: '/api/settings/test-llm' },
] as const;

export interface RemoteModelsRequest { provider: string; baseUrl?: string; apiKey?: string }
export interface SaveProviderRequest { id?: string; provider: string; baseUrl?: string; apiKey?: string }
export interface AddEntryRequest { providerId: string; model: string }
export interface TestLlmRequest { provider: string; model: string; baseUrl?: string; apiKey?: string }

export interface ListModelsResponse { models: ModelMeta[] }
export interface RemoteModelsResponse { models: ModelMeta[] }
export interface OllamaModelsResponse { models: OllamaModelView[]; reason?: string }
export interface ProvidersResponse { providers: ProviderView[] }
export interface EntriesResponse { entries: EntryView[] }
export interface AssignmentsResponse { assignments: Record<string, string | null> }
export interface TestLlmResponse { ok: true; reply: string; contextWindow: number; maxOutput: number }
