import { complete, type ModelConfig } from './provider.js';
import { listRemoteModels } from './models.js';
import { listOllamaModels, ollamaRoot, type OllamaModel } from './ollama.js';
import { extendRegistry } from './registry.js';
import type { ChatMessage } from './context.js';
import type { ModelMeta, PurposeDef } from '../contract/types.js';
import { createConfigApi, plainSecretCipher, type AiLogger, type KvStorage, type SecretsCipher } from './config.js';

export interface AiCoreOptions {
  purposes: PurposeDef[];
  storage: KvStorage;
  secrets?: SecretsCipher;
  registry?: { extend?: Record<string, ModelMeta> };
  // 这里刻意**没有** logger：core 只造「配置 + 调用出口」，日志出口在消费方那边
  // （fastify 适配器的 `opts.logger`，缺省走包内 consoleLogger）。曾经声明过一个
  // core 从不消费的 logger —— 传了的人以为日志进了自己的通道，实际不生效。
  fetchImpl?: typeof fetch;
}

export function createAiCore(opts: AiCoreOptions) {
  const secrets = opts.secrets ?? plainSecretCipher();
  const config = createConfigApi({ purposes: opts.purposes, storage: opts.storage, secrets });
  if (opts.registry?.extend) extendRegistry(opts.registry.extend);

  return {
    ...config,
    complete(opts2: {
      config: ModelConfig;
      messages: ChatMessage[];
      abortSignal?: AbortSignal;
      thinking?: boolean;
      timeoutMs?: number;
      maxOutputTokens?: number;
    }) {
      return complete(opts2);
    },
    listRemoteModels: (o: {
      provider: string;
      baseUrl?: string;
      apiKey?: string;
      fetchImpl?: typeof fetch;
      /** 端点黑洞(只连不答)时的上限(ms);不传 15s */
      timeoutMs?: number;
      abortSignal?: AbortSignal;
    }) => listRemoteModels({ fetchImpl: opts.fetchImpl, ...o }),
    listOllamaModels: (
      baseUrl = '',
      fetchImpl?: typeof fetch,
      timeoutMs?: number,
      abortSignal?: AbortSignal,
    ) => listOllamaModels(baseUrl, fetchImpl ?? opts.fetchImpl, timeoutMs, abortSignal),
    ollamaRoot,
  };
}

export type AiCore = ReturnType<typeof createAiCore>;
export type { AiLogger, KvStorage, SecretsCipher };
export type { ModelConfig } from './provider.js';
export type { ChatMessage } from './context.js';
export type { OllamaModel } from './ollama.js';
export { redact, redactDeep, registerSecret } from './redact.js';
