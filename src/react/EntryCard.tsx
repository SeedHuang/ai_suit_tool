import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Select } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type { EntryView, ModelMeta, ProviderView } from '../contract/types.js';
import { Card } from './Card.js';
import { Field } from './Field.js';
import { fetchModels, loadModelList, ModelPicker, ModelsNote } from './ModelPicker.js';
import { fetchWithAlive, removeCardItem, useAiCard } from './cardBase.js';

// ── 卡 2:模型条目 ───────────────────────────────────────

export function EntryCard() {
  const { client, reload, version, error, setError, setNotice, clear, alerts } = useAiCard();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<ModelMeta[]>([]);
  const [modelsNote, setModelsNote] = useState('');
  const [busy, setBusy] = useState<'' | 'models' | 'add'>('');
  /** 模型列表请求序号 —— 只认最后一次请求的结果(为什么,见 loadModelList) */
  const modelsSeqRef = useRef(0);

  useEffect(
    () =>
      fetchWithAlive(
        setError,
        () => Promise.all([client.providers(), client.entries()]),
        ([p, e]) => {
          setProviders(p);
          setEntries(e);
        },
      ),
    // version:添加/删除条目后要重拉这两张列表(以前靠 key 重挂载,现在靠版本号)
    [client, version, setError],
  );

  const selected = providers.find((p) => p.id === providerId);

  const loadModels = useCallback(async () => {
    if (!selected) {
      // 上面已自增序号作废在途请求,它的 finally 会被序号守卫跳过 —— 这里不兜底清 busy
      // 的话,busy 会永久停在 'models',「刷新」按钮一直转(选中凭证被删时走到这里)
      ++modelsSeqRef.current;
      setModels([]);
      setModelsNote('');
      setBusy('');
      return;
    }
    // apiKey 传空 = 用这条凭证已存的 key(表单里从来拿不到明文)
    await loadModelList(modelsSeqRef, () => fetchModels(client, selected.provider, selected.baseUrl, ''), {
      setModels, setModelsNote, setError, setBusy,
    });
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

  const remove = (id: string) =>
    removeCardItem(() => client.deleteEntry(id), { clear, reload, setError });

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
