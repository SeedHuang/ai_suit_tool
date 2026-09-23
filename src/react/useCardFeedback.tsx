import type React from 'react';
import { useCallback, useState } from 'react';
import { Alert } from 'antd';

/**
 * 三张卡共用的 error / notice 反馈。
 *
 * 抽出来是因为同一套样板被抄了三份,而且已经开始漂移(ProviderCard 的 busy 多了 'test',
 * EntryCard 是 'add')—— 每次操作前成对 `setError('')` / `setNotice('')`、末尾两行
 * `Alert … closable onClose`,修一处很容易漏掉另外两处。
 *
 * **只管这两条提示及其 setter**:`busy` 的取值各卡不同、列表加载各有各的守卫,
 * 都留在各自的卡里,别把这里做成"什么都能干"的框架。
 */
export function useCardFeedback(): {
  error: string;
  setError: (m: string) => void;
  setNotice: (m: string) => void;
  /** 每次操作前把旧提示清掉 —— 原来是两行成对的 setError('') / setNotice('') */
  clear: () => void;
  /** 卡片末尾那两行 Alert:空串不渲染,顺序与抽取前一致(成功在前、错误在后) */
  alerts: React.ReactNode;
} {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const clear = useCallback(() => {
    setError('');
    setNotice('');
  }, []);
  return {
    error,
    setError,
    setNotice,
    clear,
    alerts: (
      <>
        {notice && (
          <Alert type="success" showIcon message={notice} closable onClose={() => setNotice('')} />
        )}
        {error && (
          <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />
        )}
      </>
    ),
  };
}
