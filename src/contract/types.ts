/** 模型元数据 —— 前后端共同语言。数字由服务端查注册表/ollama meta 拼好，前端不存不算 */
export interface ModelMeta {
  provider: string;
  model: string;
  contextWindow: number;
  maxOutput: number;
  /** false = 估算值，UI 标 ⚠️ 待确认 */
  verified: boolean;
  note?: string;
}

/** 服务商凭证的 HTTP 视图。后端**只**回这个，永不回传 apiKey 本身 */
export interface ProviderView {
  id: string;
  provider: string;
  baseUrl: string;
  hasApiKey: boolean;
}

/** 模型条目的 HTTP 视图。数字服务端拼好（注册表 / ollama 运行时真值 / 兜底） */
export interface EntryView {
  id: string;
  providerId: string;
  provider: string;
  model: string;
  contextWindow: number;
  maxOutput: number;
  verified: boolean;
  note?: string;
}

/** 一个用途的展示定义 —— 消费方传 createAiCore 的 purposes 用 */
export interface PurposeDef {
  key: string;
  label: string;
}

/** 用途分配视图 */
export interface AssignmentsView {
  assignments: Record<string, string | null>;
}

/** 本地 Ollama 模型发现的一行（前端下拉用） */
export interface OllamaModelView {
  name: string;
  contextWindow: number;
  maxOutput: number;
  detail?: string;
}
