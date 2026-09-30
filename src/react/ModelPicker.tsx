import { Button, Select } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import type { AiClient } from './client.js';
import type { ModelMeta } from '../contract/types.js';

/**
 * 拉某个服务商的模型名(卡 1/卡 2 共用)。
 *
 * ollama 走本地实时接口 —— 用户装了什么只有 Ollama 自己知道。在这一层就把
 * 形状统一成 ModelMeta,后面的代码不用认识两种模型对象;其余走厂商 `/models`:
 * **名字实时从厂商拉**(它才知道自己现在服务哪些模型),数字由服务端查注册表。
 *
 * 厂商拉不到(还没填 key / 网络不通 / 端点不实现 /models)就退回内置那张表,并把
 * "为什么"用 `note` 带回去 —— 别让下拉直接空掉,那样用户连"该干什么"都看不出来。
 * ollama 拉不到是**硬失败**(throw),调用方自己接。
 *
 * apiKey 只在调用时读,不进任何依赖 —— 放进依赖会让用户每敲一个字符就发一次拉列表的请求。
 */
export async function fetchModels(
  client: AiClient,
  provider: string,
  baseUrl: string,
  apiKey: string,
): Promise<{ models: ModelMeta[]; note: string }> {
  if (provider === 'ollama') {
    const list = await client.ollamaModels(baseUrl);
    return {
      models: list.map((m) => ({
        provider: 'ollama',
        model: m.name,
        contextWindow: m.contextWindow,
        maxOutput: m.maxOutput,
        // 本地模型的值是 Ollama 自己报的,不是我们猜的
        verified: true,
        ...(m.detail ? { note: m.detail } : {}),
      })),
      note: '',
    };
  }

  try {
    return { models: await client.listRemoteModels({ provider, baseUrl, apiKey }), note: '' };
  } catch (e) {
    return {
      models: await client.listModels(provider),
      note:
        `拉不到厂商的模型列表:${(e as Error).message}。先显示内置的那几个 —— ` +
        `填上 API Key 再点「刷新」,或在下面直接打模型名。`,
    };
  }
}

/**
 * 拉模型列表的公共骨架(卡 1/卡 2 共用),配一个 `useRef(0)` 的请求序号用。
 *
 * **只认最后一次请求的结果** —— 快速切凭证/改地址时,先发后到的旧响应被序号守卫
 * 直接丢弃:不丢弃的话,下拉里显示的模型名看着像当前这条凭证拉回来的,用户照着
 * 建条目会得到张冠李戴的模型名(卡 2 还会把 A 厂商的模型名加到 B 厂商的条目下,
 * 因为 addEntry 只传 providerId + model)。
 *
 * busy 取值约定:`'' | 'models'` —— 各卡的 busy 是并集('add'/'save'/'test' 留在各卡),
 * 所以 setBusy 由调用方传入,这里只动 models 相关的三个状态。
 */
export async function loadModelList(
  seqRef: { current: number },
  run: () => Promise<{ models: ModelMeta[]; note: string }>,
  h: {
    setModels: (m: ModelMeta[]) => void;
    setModelsNote: (n: string) => void;
    setError: (m: string) => void;
    setBusy: (b: '' | 'models') => void;
  },
): Promise<void> {
  const seq = ++seqRef.current;
  h.setError('');
  h.setModelsNote('');
  h.setBusy('models');
  try {
    const r = await run();
    // 过期响应直接丢弃(不 setState)—— 只有最后一次请求的结果能落到界面上
    if (seq !== seqRef.current) return;
    h.setModels(r.models);
    h.setModelsNote(r.note);
  } catch (e) {
    if (seq !== seqRef.current) return;
    h.setModels([]);
    h.setError((e as Error).message);
  } finally {
    if (seq === seqRef.current) h.setBusy('');
  }
}

/**
 * 模型名下拉 + 刷新。**tags 模式是为了能自由输入模型名。** 厂商拉不到时(还没填 key)
 * 下拉可能只有内置那几个,「自定义」端点更是一个都没有 —— 而"想用的模型不在表里"是
 * 最正常不过的事。maxCount=1 让它在语义上仍然是单选,value/onChange 在这里做
 * 数组↔字符串的转换,别处看到的还是 `model: string`。
 */
export function ModelPicker({
  id,
  models,
  value,
  onChange,
  busy,
  onRefresh,
}: {
  id: string;
  models: ModelMeta[];
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <Select
        id={id}
        mode="tags"
        maxCount={1}
        value={value ? [value] : []}
        onChange={(v: string[]) => onChange(v[0] ?? '')}
        placeholder={busy ? '拉取中…' : '选一个,或直接打模型名'}
        optionFilterProp="label"
        style={{ width: 320 }}
        options={models.map((m) => ({
          value: m.model,
          label: m.note ? `${m.model} · ${m.note}` : m.model,
        }))}
      />
      <Button
        size="small"
        icon={<ReloadOutlined style={{ fontSize: 13 }} />}
        loading={busy}
        onClick={onRefresh}
        style={{ marginLeft: 8 }}
      >
        刷新
      </Button>
    </>
  );
}

/**
 * 退回内置表的软提示。**不能是灰字。** 退回内置表和"厂商就这几个模型"在界面上长得
 * 太像了 —— 用户会以为列表是拉出来的,于是问"为什么还是那两个老的"(真实反馈)。
 * 用和旁边 ⚠️ 待确认同一套 warn 色,让"这是兜底的,不是厂商说的"一眼可见。
 */
export function ModelsNote({ note }: { note: string }) {
  if (!note) return null;
  return (
    <div style={{ fontSize: 12, color: 'var(--ai-warn)', lineHeight: 1.6 }}>
      ⚠️ {note}
    </div>
  );
}
