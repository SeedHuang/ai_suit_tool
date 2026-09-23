import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Select } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { useAiClient, useAiReload, useAiVersion } from './index.js';
import type { EntryView, ModelMeta, ProviderView } from '../contract/types.js';
import { Card } from './Card.js';
import { Field } from './Field.js';
import { fetchModels, ModelPicker, ModelsNote } from './ModelPicker.js';
import { useCardFeedback } from './useCardFeedback.js';

// ── 卡 2:模型条目 ───────────────────────────────────────

export function EntryCard() {
  const client = useAiClient();
  const reload = useAiReload();
  /** reload 递增的刷新版本号 —— 加进拉数据 effect 的依赖里重拉,而不是靠重挂载子树 */
  const version = useAiVersion();
  const { error, setError, setNotice, clear, alerts } = useCardFeedback();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [modelsNote, setModelsNote] = useState('');
  const [busy, setBusy] = useState<'' | 'models' | 'add'>('');
  /** 模型列表请求序号 —— 只认最后一次请求的结果。快速在两条凭证之间切换时,上一个
   *  provider 的响应可能后到并覆盖当前列表;而 addEntry 只传 providerId + model,
   *  于是会把 A 厂商的模型名加到 B 厂商的条目下。非最新请求直接丢弃。 */
  const modelsSeqRef = useRef(0);

  useEffect(() => {
    let alive = true;
    // 重拉前先清掉上一次的失败 —— 否则拉成功之后那句错误还挂在界面上
    setError('');
    Promise.all([client.providers(), client.entries()])
      .then(([p, e]) => {
        if (alive) {
          setProviders(p);
          setEntries(e);
        }
      })
      .catch((e) => {
        // 不能吞:列表保持 [] 时界面上是「还没有模型条目。」,和「确实一条都没建」
        // 长得一模一样,用户会以为条目丢了并去重建
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
    // version:添加/删除条目后要重拉这两张列表(以前靠 key 重挂载,现在靠版本号)
  }, [client, version, setError]);

  const selected = providers.find((p) => p.id === providerId);

  const loadModels = useCallback(async () => {
    const seq = ++modelsSeqRef.current;
    if (!selected) {
      // 上面已自增序号作废在途请求,它的 finally 会被序号守卫跳过 —— 这里不兜底清 busy
      // 的话,busy 会永久停在 'models',「刷新」按钮一直转(选中凭证被删时走到这里)
      setModels([]);
      setModelsNote('');
      setBusy('');
      return;
    }
    setError('');
    setModelsNote('');
    setBusy('models');
    try {
      // apiKey 传空 = 用这条凭证已存的 key(表单里从来拿不到明文)
      const r = await fetchModels(client, selected.provider, selected.baseUrl, '');
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
  }, [selected, client, setError]);

  useEffect(() => {
    void loadModels();
    // version:条目变更后模型列表也跟着刷新(与旧的重挂载行为一致)
  }, [loadModels, version]);

  const add = async () => {
    clear();
    setBusy('add');
    try {
      await client.addEntry({ providerId, model });
      setNotice('条目已添加。首条会自动指给所有用途,可在下面那张卡改。');
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
      await client.deleteEntry(id);
      await reload();
    } catch (e) {
      // 400 原样:"这个条目正被用途引用(...)—— 先在「用途分配」里改指别的条目"
      setError((e as Error).message);
    }
  };

  // 表里查得到就看它自己的 verified;查不到(手打的名字,或从厂商拉来但注册表没收录)
  // **就是未确认** —— 服务端给的那两个数字是兜底值,必须让用户核对:
  // 数字填错等于 batchSize 算错,要么批到超上下文,要么跑一整天。
  const chosen = models.find((m) => m.model === model);
  const unverified = chosen ? chosen.verified === false : !!model;

  return (
    <Card
      icon={<ThunderboltOutlined style={{ color: 'var(--ai-accent)', fontSize: 16 }} />}
      title="模型条目"
      hint="一个模型一条。上下文 / 最大输出由服务端按注册表算,前端不填"
    >
      <Field label="凭据">
        <Select
          id="llm-凭据"
          value={providerId || undefined}
          onChange={setProviderId}
          // label 带上地址:存储层不禁止同 provider 多条凭证,只显示厂商名会出现两个
          // 一模一样的「ark」,分不清该选哪条(值仍是 id)
          options={providers.map((p) => ({
            value: p.id,
            label: p.baseUrl ? `${p.provider} · ${p.baseUrl}` : p.provider,
          }))}
          placeholder={providers.length ? '选一条凭证' : '先在上面建一条凭证'}
          disabled={providers.length === 0}
          style={{ width: 260 }}
        />
      </Field>

      <Field label="模型">
        <ModelPicker
          id="llm-模型"
          models={models}
          value={model}
          onChange={setModel}
          busy={busy === 'models'}
          onRefresh={() => void loadModels()}
        />
        {unverified && (
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ai-warn)' }}>
            ⚠️ 这个模型的上下文是估算值,请核对
          </span>
        )}
      </Field>

      <ModelsNote note={modelsNote} />

      <div>
        <Button
          type="primary"
          disabled={!providerId || !model}
          loading={busy === 'add'}
          onClick={add}
        >
          添加条目
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* 拉列表失败时 error 已给出原因 —— 这时不能再说「还没有模型条目」,两种空态要分得开 */}
        {entries.length === 0 && !error && (
          <span style={{ fontSize: 12, color: 'var(--ai-text-dim)' }}>
            还没有模型条目。
          </span>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              borderBottom: '1px solid var(--ai-rule)',
            }}
          >
            {!e.verified && <span style={{ color: 'var(--ai-warn)' }}>⚠️</span>}
            <span style={{ fontSize: 13 }}>
              {e.provider} · {e.model}
            </span>
            <span className="num" style={{ fontSize: 12, color: 'var(--ai-text-dim)' }}>
              {Math.round(e.contextWindow / 1000)}K / {Math.round(e.maxOutput / 1000)}K
            </span>
            {!e.verified && e.note && (
              <span style={{ fontSize: 12, color: 'var(--ai-text-dim)' }}>{e.note}</span>
            )}
            <Button
              size="small"
              danger
              style={{ marginLeft: 'auto' }}
              onClick={() => void remove(e.id)}
            >
              删除
            </Button>
          </div>
        ))}
      </div>

      {alerts}
    </Card>
  );
}
