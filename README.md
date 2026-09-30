# @seedhuang/ai_suit_tool

AI 配置与请求公共套件：三层模型配置 + 唯一请求出口 + 设置 UI，前后端可合可拆。

一句话说清楚：你的应用里凡是"要调大模型"的功能（生成方案、打标签、质检……），模型怎么配、请求怎么发、设置界面长什么样，都用这一套，不用每个功能自己再造一遍。

## 它解决什么问题

一个应用里只要有两个以上功能用到大模型，很快会撞上这一串麻烦：

**1. 配置散落各处。** 每个功能自己写死服务商、密钥、模型名。想换个模型，得把代码翻一遍。
→ 这套包把配置收成三层：**服务商凭证 → 模型条目 → 用途分配**。换模型变成改配置，不是改代码。

**2. 密钥到处漏。** 上游网关报错时经常把你的 key 原样回显（`401 Unauthorized: key sk-xxx 无效`），那一刻错误信息里没有"key"这个字段名，按字段名脱敏的规则一条都命中不了，日志一打就泄了。
→ 包内所有日志出口和 HTTP 错误出口都过一层脱敏：真正用 key 之前先按"值"登记，之后上游把它回显进任何报错都会被抹成 `***`；没登记过的再按常见 key 形态兜底抹。存储层对外只回"有没有 key"，永不回明文。

**3. 数字没人管。** 模型的上下文窗口、最大输出这些数字填错，后果不是报错而是静默出错：要么一批请求超上下文，要么长输出被拦腰截断、下游解析必失败。
→ 内置一张模型注册表，数字标明来源（官方/实测/估算）；本地 Ollama 不入表，运行时直接问它要真实值；查不到的给保守兜底，并在界面上标"待确认"提醒核对。

**4. 请求会挂死。** 本地模型 OOM、端点黑洞（只连不答）时，`await` 一个永远不返回的请求，整个功能就卡住了。
→ 所有对外请求带超时，到点抛一句人话；业务请求支持中途停止（abortSignal）。

**5. 设置页面得自己写。** 让用户选服务商、填 key、选模型、给每个功能指派模型——这套界面写起来琐碎还容易踩坑。
→ 送三张现成的 React 卡片。数字由服务端按注册表算好，前端只显示、不存、不算。

## 包里有什么

| 子路径 | 是什么 | 什么时候用 |
|---|---|---|
| `@seedhuang/ai_suit_tool/core` | 三层配置管理 + 唯一请求出口 `complete()` + 模型发现 + 脱敏 | 必装，核心 |
| `@seedhuang/ai_suit_tool/fastify` | 把配置管理暴露成 REST 接口的插件（12 个端点） | 要用设置页就装 |
| `@seedhuang/ai_suit_tool/react` | 三张设置卡片：服务商凭证 / 模型条目 / 用途分配 | 要用设置页就装 |
| `@seedhuang/ai_suit_tool/contract` | 端点清单 + 请求/响应类型（前后端共同语言） | 自己实现后端时对照 |
| `@seedhuang/ai_suit_tool/contract-tests` | 对任意后端跑合规测试 | 自建后端时自检 |

"前后端可合可拆"的意思：core 单独用也行（纯函数库，不碰 HTTP）；core + fastify + react 拼起来就是一个开箱即用的设置页。

## 安装

需要 Node 18 及以上（用到全局 fetch）。

```bash
pnpm add @seedhuang/ai_suit_tool
```

只用 core 的话，装完就能用——`ai`（Vercel AI SDK v7）、`@ai-sdk/deepseek`、`@ai-sdk/openai-compatible` 是普通依赖，会自动带上。

要用设置页 UI，把界面这几个装上（peerDependencies，对上版本即可）：

```bash
pnpm add react react-dom antd @ant-design/icons
```

要用 fastify 插件，你项目里本来就有 fastify（本包按 v5 开发）。

## Show Case：从零跑通一个最小可用版

### 第 1 步：后端建实例、挂接口

```ts
// server.ts
import Fastify from 'fastify';
import { createAiCore } from '@seedhuang/ai_suit_tool/core';
import { registerAiSettings } from '@seedhuang/ai_suit_tool/fastify';

// 配置存哪：任何 get/set/delete 的 KV 都行（内存 / SQLite / 文件……）
const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    get: (k: string) => m.get(k),
    set: (k: string, v: string) => void m.set(k, v),
    delete: (k: string) => void m.delete(k),
  };
};

const ai = createAiCore({
  // 你的应用里有哪些功能要用模型，就列成"用途"，名字随你定
  purposes: [
    { key: 'proposals', label: '夹子方案生成' },
    { key: 'rules', label: '规则建议' },
    { key: 'tag', label: '打标' },
    { key: 'tagcheck', label: '标签质检' },
  ],
  storage: memoryStorage(),
  // key 怎么加密：不传 = 明文降级（存成 plain:xxx），只建议本机开发用；
  // 生产上给一个真的 SecretsCipher（encrypt/decrypt 两个方法）
});

const app = Fastify();
await app.register(registerAiSettings, { ai });
await app.listen({ port: 3000 });
```

### 第 2 步：前端放三张卡，设置页就成了

```tsx
// AiSettingsPage.tsx
import {
  AiSettingsProvider, ProviderCard, EntryCard, PurposeCard,
} from '@seedhuang/ai_suit_tool/react';
import '@seedhuang/ai_suit_tool/tokens.css';

export function AiSettingsPage() {
  return (
    <AiSettingsProvider baseURL="http://localhost:3000">
      <ProviderCard /> {/* 配服务商：选厂商、填 key、测试连接 */}
      <EntryCard />    {/* 加模型条目：从厂商实时拉模型列表，数字服务端算 */}
      <PurposeCard />  {/* 给每个用途指一个条目 */}
    </AiSettingsProvider>
  );
}
```

设置页大概长这样：

```
┌ 服务商凭证 ─────────────────────────────────────────┐
│  deepseek · https://api.deepseek.com/v1    已存 key   │
│  服务商 [DeepSeek v]   接口地址 [留空用默认地址]         │
│  API Key [••••••••••]      [新建凭证]  [测试连接]       │
├ 模型条目 ───────────────────────────────────────────┤
│  deepseek · deepseek-flash     1024K / 384K    [删除]  │
│  凭据 [选一条凭证 v]   模型 [选一个,或直接打模型名 v]      │
├ 用途分配 ───────────────────────────────────────────┤
│  夹子方案生成   [deepseek · deepseek-flash v]           │
│  规则建议      [deepseek · deepseek-flash v]           │
└─────────────────────────────────────────────────────┘
```

不想写界面也可以直接调配置 API：

```ts
const p = ai.saveProvider({ provider: 'deepseek', apiKey: 'sk-xxx' });
const e = ai.addEntry({ providerId: p.id, model: 'deepseek-flash' });
// 第一条条目会自动指给所有用途，省得配完全是"未配置"
```

### 第 3 步：业务代码按"用途"发请求

```ts
const settings = ai.readLlmSettings('proposals');
if (!settings) {
  throw new Error('「夹子方案生成」还没配模型 —— 先去设置页配一个');
}

const text = await ai.complete({
  config: settings.config, // 服务商 / 地址 / key / 模型名，一层里全齐了
  messages: [{ role: 'user', content: prompt }],
  thinking: false,                        // 批量任务关思考模式：省 token、省时间
  maxOutputTokens: settings.ctx.maxOutput, // 不传 = 厂商默认(常只有 8K)，长 JSON 会被截断
  timeoutMs: 60_000,                       // 不传的话，模型挂起时这个 await 永远不回来
  abortSignal: controller.signal,          // 用户点"停止"时真的中断生成
});
```

`complete()` 是全应用对模型调用的**唯一出口**。业务代码不直接 import `ai` SDK——换模型、换厂商是改配置的事，不是改业务代码的事。

### 可选：自建后端时自证合规

```ts
import { runContractTests } from '@seedhuang/ai_suit_tool/contract-tests';

// 你的后端跑着的时候执行；全绿 = 你的实现和包内前端说的是同一种话
runContractTests({ baseUrl: 'http://localhost:3000' });
```

## 功能清单

**配置管理（core）**

- 三层配置：凭证（服务商 + 地址 + 加密的 key）→ 条目（用哪个模型）→ 分配（哪个用途用哪个条目）
- 更新凭证时不带 apiKey = 保留已存的——用户不用每次重打
- 删除有守卫：凭证还有条目在用不让删；条目正被用途引用不让删，并告诉你具体是哪些用途
- key 回落只在**同一服务商、同一地址**内找——绝不把 A 厂商的密钥发到 B 厂商端点

**请求出口 `complete()`（core）**

- 超时、可中止、思考模式开关（DeepSeek 原生）、输出上限，四个都不传也有合理默认
- 每次调用打一行日志：返回多长、为什么停、是不是空的、120 字预览（已脱敏）——"空返回""被截断""回了散文不是 JSON"三种失败一眼分得开

**模型发现（core）**

- 厂商 `/models` 实时拉名字（厂商新出的模型，表里没有也能选到），数字查注册表
- 本地 Ollama 走 `/api/show` 拿真实上下文长度，自动可信
- 厂商列表拉不到时退回内置表并带回"为什么"，下拉不空转
- 本地 Ollama 的模型给输出留 1/4 窗口（封顶 8K）——把整个窗口都算成输出会让输入预算变负，这是真机踩过的坑

**安全（core / fastify）**

- 日志脱敏双规则：按值（登记过的 key）+ 按形态（sk- 系、Bearer、常见敏感字段名）
- 递归脱敏对象，处理循环引用；`cookie` 整段不误伤兄弟字段
- 502 / 400 / 默认日志三条出口全部过脱敏，上游回显 key 也落不了明文

**设置 UI（react）**

- 输入框用真 `<label for>` 绑定——防浏览器自动填充把保存的用户名塞进"接口地址"框（实测踩过）
- 快速切换凭证时旧响应作废，不会把张冠李戴的模型名留在下拉里
- "加载失败"和"还没有数据"两种空态分得开，不会让用户以为数据丢了去重建

**契约（contract / contract-tests）**

- 12 个端点清单 + 全部请求/响应类型，key 只走 body 不进 query（防落日志）

## 内置的服务商和模型

服务商（带默认地址，留空即用）：`ollama`（本地）、`ark`（火山方舟）、`deepseek`、`minimax`、`custom`（任何 OpenAI 兼容端点，必填地址）。

协议只有两种：DeepSeek 官方包 + OpenAI 兼容。不写 per-provider 适配器——接入新厂商 = 注册表加一行数字。

内置模型数字（节选）：`deepseek-flash`（1M/384K）、方舟系 `claude-sonnet-4.5`、`kimi-k3`、`glm-5.3`、`doubao-seed-evolving` 等、`MiniMax-M2.7`。每个数字标了来源，拿不准的标了待确认。

## 想定制的都在这（扩展点）

| 注入点 | 你来决定什么 |
|---|---|
| `storage` | 配置存哪：内存 / SQLite / 文件 / Redis，实现 get/set/delete 即可 |
| `secrets` | key 怎么加密：给 encrypt/decrypt 两个方法；不传 = 明文降级（只建议本机/测试） |
| `purposes` | 用途就是你的业务功能名，随便定义，设置页按它渲染 |
| `registry.extend` | 追加自有模型的数字表（优先于内置表） |
| `fetchImpl` | 假 fetch 注入（core 与 fastify 插件各一层），测试时用 |
| `logger` | fastify 插件的日志出口；不传走包内默认（已脱敏的 console） |
| 自建 UI | react 还导出 `createAiClient`，可直接对那 12 个端点写你自己的界面 |

## 开发

```bash
pnpm test        # 122 个测试
pnpm typecheck   # tsc --noEmit
pnpm build       # 产出 dist/
```
