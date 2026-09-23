import type React from 'react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { AiClient } from './client.js';
import { createAiClient } from './client.js';

/** 刷新版本号 + 触发函数 —— 卡片把 version 放进「拉数据」effect 的依赖数组里,
 *  版本一变就重新拉,但**组件不卸载**:notice(成功提示)和编辑中的 state 因此存活。 */
type ReloadValue = { version: number; reload: () => Promise<void> };

const ClientCtx = createContext<AiClient | null>(null);
const ReloadCtx = createContext<ReloadValue | null>(null);

export function AiSettingsProvider({
  baseURL,
  fetchImpl,
  children,
}: {
  baseURL: string;
  fetchImpl?: typeof fetch;
  children: React.ReactNode;
}) {
  const [version, setVersion] = useState(0);
  const client = useMemo(() => createAiClient({ baseURL, fetchImpl }), [baseURL, fetchImpl]);
  const reload = useCallback(async () => setVersion((v) => v + 1), []);
  const reloadValue = useMemo(() => ({ version, reload }), [version, reload]);
  // client 随 baseURL 重建;reload 只递增版本号让三卡重新拉数据 ——
  // **不要**用 key={version} 重挂载子树:那会清空卡片本地 state,保存成功的 notice 会被立刻重置掉
  return (
    <ClientCtx.Provider value={client}>
      <ReloadCtx.Provider value={reloadValue}>{children}</ReloadCtx.Provider>
    </ClientCtx.Provider>
  );
}

export function useAiClient(): AiClient {
  const c = useContext(ClientCtx);
  if (!c) throw new Error('useAiClient 必须在 <AiSettingsProvider> 内使用');
  return c;
}

function useReloadValue(): ReloadValue {
  const v = useContext(ReloadCtx);
  if (!v) throw new Error('useAiReload / useAiVersion 必须在 <AiSettingsProvider> 内使用');
  return v;
}

export function useAiReload(): () => Promise<void> {
  return useReloadValue().reload;
}

/** 「拉数据」effect 的依赖项:版本变化 → 重新拉数,但不重挂载 */
export function useAiVersion(): number {
  return useReloadValue().version;
}

export { ProviderCard } from './ProviderCard.js';
export { EntryCard } from './EntryCard.js';
export { PurposeCard } from './PurposeCard.js';
export type { AiClient } from './client.js';
export { createAiClient } from './client.js';
