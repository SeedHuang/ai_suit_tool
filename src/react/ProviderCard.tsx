import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select } from 'antd';
import { KeyOutlined, SaveOutlined } from '@ant-design/icons';
import { useAiClient, useAiReload, useAiVersion } from './index.js';
import type { ModelMeta, ProviderView } from '../contract/types.js';
import { Card } from './Card.js';
import { Field } from './Field.js';
import { fetchModels, ModelPicker, ModelsNote } from './ModelPicker.js';
import { useCardFeedback } from './useCardFeedback.js';

const PROVIDERS = [
  { value: 'ollama', label: '本地 Ollama', hint: '隐私 / 离线主力,默认 qwen2.5:14b' },
  { value: 'ark', label: '火山方舟', hint: 'Coding Plan / 豆包 / Kimi / GLM' },
  { value: 'deepseek', label: 'DeepSeek', hint: '普通 API' },
  { value: 'minimax', label: 'MiniMax', hint: '直连' },
  { value: 'custom', label: '自定义', hint: '任何 OpenAI 兼容端点' },
];

/** API Key 输入框的提示语 —— 抽成纯函数,渲染里不再堆嵌套三元;字段文案一字不改 */
function apiKeyPlaceholder(editingHasKey: boolean, provider: string): string {
  if (editingHasKey) return '已保存,留空表示不改动';
  if (provider === 'ollama') return '本地模型不需要';
  return '粘贴 API Key';
}

// ── 卡 1:服务商凭证 ─────────────────────────────────────

export function ProviderCard() {
  const client = useAiClient();
  const reload = useAiReload();
  /** reload 递增的刷新版本号 —— 加进拉数据 effect 的依赖里重拉,而不是靠重挂载子树 */
  const version = useAiVersion();
  const { error, setError, setNotice, clear, alerts } = useCardFeedback();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [provider, setProvider] = useState('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  /** 用户动过 baseUrl 没有。没动过又不是新建 → **不带**这个字段,免得把已存端点冲空 */
  const [baseUrlTouched, setBaseUrlTouched] = useState(false);
  const [apiKey, setApiKey] = useState('');
  /** 镜像最新的 baseUrl / apiKey —— loadModels 的 useCallback 依赖里**两个都不放**,
   *  否则每敲一个字符就重建一次、连带下面的 effect 重跑:非 ollama 时一次输入 = 几十次
   *  真的打到厂商 /models 的请求(下拉闪烁、还可能被限流)。但闭包读的是旧值,会变成
   *  「填上地址/Key 再点刷新」永远带上旧值 —— 读 ref 即拿最新值。
   *  重拉只由「切换服务商」和点「刷新」按钮显式触发。 */
  const baseUrlRef = useRef('');
  const apiKeyRef = useRef('');
  /** 模型列表请求序号 —— 只认最后一次请求的结果。先发后到的旧响应(快速改地址 / 快速切
   *  服务商)直接丢弃,否则下拉里显示的模型名看着像当前这条凭证拉回来的,用户照着建条目
   *  会得到张冠李戴的模型名。 */
  const modelsSeqRef = useRef(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [models, setModels] = useState<ModelMeta[]>([]);
  /** 测试连接要个模型名 —— 不落库,只喂给 test-llm */
  const [model, setModel] = useState('');
  const [modelsNote, setModelsNote] = useState('');
  const [busy, setBusy] = useState<'' | 'models' | 'save' | 'test'>('');

  // ref 的镜像放进 effect:渲染函数体里赋值属于渲染期副作用(并发渲染下渲染可能被重复
  // 执行或丢弃)。点「刷新」时 effect 早已 flush,行为不变。**必须声明在下面的拉取
  // effect 之前** —— 同一次提交里 effect 按声明顺序跑,切服务商时 baseUrl 先被清空,
  // 紧接着的那次拉取才拿得到 ''。
  useEffect(() => {
    baseUrlRef.current = baseUrl;
  }, [baseUrl]);
  useEffect(() => {
    apiKeyRef.current = apiKey;
  }, [apiKey]);

  useEffect(() => {
    let alive = true;
    // 重拉前先清掉上一次的失败 —— 否则拉成功之后那句错误还挂在界面上
    setError('');
    client
      .providers()
      .then((p) => {
        if (alive) setProviders(p);
      })
      .catch((e) => {
        // 不能吞:列表保持 [] 时界面上是「还没有凭证 —— 在下面建一条」,和「确实一条
        // 都没配」长得一模一样,用户会以为配置丢了并去重建
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
    // version:保存/删除凭证后要重拉这张列表(以前靠 key 重挂载,现在靠版本号)
  }, [client, version, setError]);

  const loadModels = useCallback(
    async (p: string) => {
      const seq = ++modelsSeqRef.current;
      setError('');
      setModelsNote('');
      setBusy('models');
      try {
        const r = await fetchModels(client, p, baseUrlRef.current, apiKeyRef.current);
        // 过期响应直接丢弃(不 setState)—— 只有最后一次请求的结果能落到界面上
        if (seq !== modelsSeqRef.current) return;
        setModels(r.models);
        setModelsNote(r.note);
      } catch (e) {
        if (seq !== modelsSeqRef.current) return;
        setModels([]);
        setError((e as Error).message);
      } finally {
        if (seq === modelsSeqRef.current) setBusy('');
      }
    },
    // 同 fetchModels:baseUrl / apiKey 故意不在这里 —— 靠 ref.current 取最新值,所以这份
    // 缓存不会因为用户改地址、改 Key 而重建(否则每敲一个字符就重拉一次上游)
    [client, setError],
  );

  useEffect(() => {
    void loadModels(provider);
    // version:凭证变更后模型列表也跟着刷新(与旧的重挂载行为一致)
  }, [provider, loadModels, version]);

  /**
   * 换服务商 = 换端点 + 换模型名空间,所以上一家的这两项**必须清掉**。
   *
   * 不清 baseUrl 的后果是实测出来的:本地 Ollama 的模型发现会把它当根地址用,
   * 于是留着 deepseek 的地址就去问 deepseek 要 /api/tags(401)→ 前端 catch 里
   * `setModels([])` → **下拉直接空掉**,而报错还说"确认 Ollama 正在运行" ——
   * 明明它在跑,极其误导。
   *
   * (旧的另一个坑 —— 换服务商留着上一家 1024000 的上下文数字 —— 随三层重构消失:
   * 数字现在由服务端按条目算,前端不存。)
   */
  const changeProvider = (p: string) => {
    if (p === provider) return;
    setProvider(p);
    setBaseUrl('');
    setBaseUrlTouched(true);
    setModel('');
  };

  const startEdit = (p: ProviderView) => {
    clear();
    setEditingId(p.id);
    setProvider(p.provider);
    setBaseUrl(p.baseUrl);
    setBaseUrlTouched(false);
    setApiKey('');
    setModel('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    // 服务商也要归零 —— 只清其余字段会让下拉停在被编辑那家,表单状态自相矛盾,
    // 随后点「新建凭证」会默认拿这家厂商
    setProvider('ollama');
    setApiKey('');
    setBaseUrl('');
    setBaseUrlTouched(false);
    setModel('');
  };

  const save = async () => {
    clear();
    // custom 没有默认接口地址(DEFAULT_BASE_URLS 里没有它)—— 服务端也会拒,同一句文案。
    // 放在这里先拦,不然要等到点「测试连接」才以 502 暴露,发现得太晚
    if (provider === 'custom' && !baseUrl.trim()) {
      setError('「custom」没有默认接口地址 —— 请先填一个');
      return;
    }
    setBusy('save');
    try {
      await client.saveProvider({
        ...(editingId ? { id: editingId } : {}),
        provider,
        // baseUrl:只有用户改过、或新建才带。不带 = 服务端保留已存的那个
        ...(!editingId || baseUrlTouched ? { baseUrl } : {}),
        // 留空 = 不改动已存的 key(用户不用每次重打)
        ...(apiKey ? { apiKey } : {}),
      });
      setNotice(editingId ? '凭证已更新。' : '凭证已保存。');
      setApiKey('');
      setEditingId(null);
      setBaseUrlTouched(false);
      // 保存后 provider/baseUrl/model 一并归零(新建、修改两条路径都做)——
      // 只留着它们的后果是连点两次「保存」会建出两条一模一样的凭证(实测过这类重复行,
      // 删起来还得分清哪条是哪条;重复凭证还会让 savedApiKey 取到哪条变得不确定)
      setProvider('ollama');
      setBaseUrl('');
      setModel('');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const remove = async (id: string) => {
    clear();
    try {
      await client.deleteProvider(id);
      if (editingId === id) cancelEdit();
      await reload();
    } catch (e) {
      // 400 的 reason 原样展示 —— "这条凭证还有模型条目在用"正是要让用户看到的
      setError((e as Error).message);
    }
  };

  const test = async () => {
    clear();
    setBusy('test');
    try {
      const r = await client.test({ provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) });
      setNotice(`连接成功,模型回了一句:${r.reply}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const providerHint = PROVIDERS.find((p) => p.value === provider)?.hint;
  const editingHasKey = !!(editingId && providers.find((p) => p.id === editingId)?.hasApiKey);

  return (
    <Card
      icon={<KeyOutlined style={{ color: 'var(--ai-accent)', fontSize: 16 }} />}
      title="服务商凭证"
      hint="一个厂商一条。API Key 只发往该厂商、只存本机(加密存储)"
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 拉列表失败时 error 已给出原因 —— 这时不能再说「还没有凭证」,两种空态要分得开 */}
        {providers.length === 0 && !error && (
          <span style={{ fontSize: 12, color: 'var(--ai-text-dim)' }}>
            还没有凭证 —— 在下面建一条。
          </span>
        )}
        {providers.map((p) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              borderBottom: '1px solid var(--ai-rule)',
            }}
          >
            <span style={{ fontSize: 13 }}>{p.provider}</span>
            <span
              style={{
                fontSize: 12,
                color: 'var(--ai-text-dim)',
                fontFamily: 'var(--ai-font-mono)',
              }}
            >
              {p.baseUrl || '默认地址'}
            </span>
            <span
              style={{
                fontSize: 12,
                color: p.hasApiKey ? 'var(--ai-ok)' : 'var(--ai-text-dim)',
              }}
            >
              {p.hasApiKey ? '已存 key' : '无 key'}
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Button size="small" onClick={() => startEdit(p)}>
                编辑
              </Button>
              <Button size="small" danger onClick={() => void remove(p.id)}>
                删除
              </Button>
            </span>
          </div>
        ))}
      </div>

      <Field label="服务商">
        <Select
          id="llm-服务商"
          value={provider}
          onChange={changeProvider}
          options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
          // 编辑已存凭证时锁死 —— 换服务商类型会静默把条目改指到新类型上
          disabled={!!editingId}
          style={{ width: 260 }}
        />
        <span style={{ fontSize: 12, color: 'var(--ai-text-dim)', marginLeft: 10 }}>
          {providerHint}
        </span>
      </Field>

      <Field label="接口地址">
        <Input
          id="llm-接口地址"
          name="llm-base-url"
          // 不是凭证,明确告诉浏览器别填
          autoComplete="off"
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl(e.target.value);
            setBaseUrlTouched(true);
          }}
          placeholder="留空用默认地址(custom 端点必填)"
          style={{ width: 420, fontFamily: 'var(--ai-font-mono)', fontSize: 12 }}
        />
      </Field>

      <Field label="API Key">
        <Input.Password
          id="llm-API-Key"
          name="llm-api-key"
          // new-password 让密码管理器别把它和上面的文本框配成"用户名+密码"
          autoComplete="new-password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={apiKeyPlaceholder(editingHasKey, provider)}
          style={{ width: 420, fontFamily: 'var(--ai-font-mono)', fontSize: 12 }}
        />
      </Field>

      <Field label="测试模型">
        <ModelPicker
          id="llm-测试模型"
          models={models}
          value={model}
          onChange={setModel}
          busy={busy === 'models'}
          onRefresh={() => void loadModels(provider)}
        />
      </Field>

      <ModelsNote note={modelsNote} />

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <Button
          type="primary"
          icon={<SaveOutlined style={{ fontSize: 14 }} />}
          loading={busy === 'save'}
          disabled={!provider}
          onClick={save}
        >
          {editingId ? '保存修改' : '新建凭证'}
        </Button>
        <Button loading={busy === 'test'} disabled={!model} onClick={test}>
          测试连接
        </Button>
        {editingId && <Button onClick={cancelEdit}>取消编辑</Button>}
      </div>

      {alerts}
    </Card>
  );
}
