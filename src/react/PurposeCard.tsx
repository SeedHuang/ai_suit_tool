import { useEffect, useState } from 'react';
import { Button, Select } from 'antd';
import { SlidersOutlined } from '@ant-design/icons';
import { useAiClient, useAiReload, useAiVersion } from './index.js';
import type { EntryView } from '../contract/types.js';
import { Card } from './Card.js';
import { Field, fieldId } from './Field.js';
import { useCardFeedback } from './useCardFeedback.js';

// ── 卡 3:用途分配(模型分配列,轮询/批次留在消费方)──────

/** 用途显示名 —— 包内默认表(对应 BFM 的四个用途)。消费方新增用途 key 不在表里时,直接显示 key 本身 */
const PURPOSE_LABELS: Record<string, string> = {
  rules: '规则建议',
  tag: '打标',
  tagcheck: '标签质检',
  proposals: '夹子方案生成',
};

export function PurposeCard() {
  const client = useAiClient();
  const reload = useAiReload();
  /** reload 递增的刷新版本号 —— 加进拉数据 effect 的依赖里重拉,而不是靠重挂载子树 */
  const version = useAiVersion();
  const { error, setError, clear, alerts } = useCardFeedback();
  const [entries, setEntries] = useState<EntryView[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string | null> | null>(null);
  /** 变更进行中锁住全部下拉 —— 快速连改两次时旧响应会晚到,把界面刷回旧值 */
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    // 重试前先清掉上一次的失败 —— 否则拉成功之后那句错误还挂在界面上
    setError('');
    Promise.all([client.entries(), client.assignments()])
      .then(([e, a]) => {
        if (alive) {
          setEntries(e);
          setAssignments(a);
        }
      })
      .catch((e) => {
        // 不能吞:assignments 停在 null 就永远是「加载中…」—— 既不报错也没有重试入口,
        // 用户只能刷新页面。失败要落到 error 上,和「正在加载」分得开
        if (alive) setError((e as Error).message);
      });
    return () => {
      alive = false;
    };
    // version:改了用途分配后重拉服务端的真值(以前靠 key 重挂载,现在靠版本号)
  }, [client, version, setError]);

  if (assignments === null) {
    return (
      <Card
        icon={<SlidersOutlined style={{ color: 'var(--ai-accent)', fontSize: 16 }} />}
        title="用途分配"
        hint="每个用途各自指一个条目;没配 = 未配置,不回落"
      >
        {/* 失败绝不能装成「加载中…」:给出原因(alerts 里的错误) + 一个重试入口 */}
        {error ? (
          <Button size="small" onClick={() => void reload()}>
            重试
          </Button>
        ) : (
          <p className="hud-label">加载中…</p>
        )}
        {alerts}
      </Card>
    );
  }

  const options = [
    { value: '', label: '未配置' },
    ...entries.map((e) => ({ value: e.id, label: `${e.provider} · ${e.model}` })),
  ];
  // 用途行由 client.assignments() 返回的键渲染;label 优先内置中文映射,查不到用 key 本身
  const labelOf = (key: string) => PURPOSE_LABELS[key] ?? key;

  const change = async (purpose: string, v: string) => {
    clear();
    setSaving(true);
    try {
      await client.setAssignments({ [purpose]: v || null });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      icon={<SlidersOutlined style={{ color: 'var(--ai-accent)', fontSize: 16 }} />}
      title="用途分配"
      hint="每个用途各自指一个条目;没配 = 未配置,不回落"
    >
      {Object.keys(assignments).map((p) => (
        <Field key={p} label={labelOf(p)}>
          {/* id 由 fieldId 统一生成 —— 与 Field 的 htmlFor 是同一个值 */}
          <Select
            id={fieldId(labelOf(p))}
            value={assignments[p] ?? ''}
            onChange={(v) => void change(p, v)}
            options={options}
            disabled={entries.length === 0 || saving}
            style={{ width: 320 }}
          />
        </Field>
      ))}
      {entries.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--ai-text-dim)' }}>
          先在上面加一个模型条目。
        </span>
      )}
      {alerts}
    </Card>
  );
}
