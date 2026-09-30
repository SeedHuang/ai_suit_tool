/**
 * 三张卡共用的「开头四件套 + 取数骨架」。
 *
 * 抽出来是因为同一套样板在三张卡里各抄了一份 —— 修一处很容易漏掉另外两处
 * (useCardFeedback 当年就是同一批样板漂移后抽的,这里把剩下的两块也收拢)。
 */
import { useAiClient, useAiReload, useAiVersion } from './index.js';
import { useCardFeedback } from './useCardFeedback.js';

/** 每张卡开头一模一样的四件套:client / reload / version / error+notice 反馈 */
export function useAiCard() {
  const client = useAiClient();
  const reload = useAiReload();
  /** reload 递增的刷新版本号 —— 加进拉数据 effect 的依赖里重拉,而不是靠重挂载子树 */
  const version = useAiVersion();
  return { client, reload, version, ...useCardFeedback() };
}

/**
 * 「拉数据」effect 的公共骨架。返回值就是清理函数 —— 直接
 * `useEffect(() => fetchWithAlive(...), deps)`:
 *
 * - 拉取前先清掉上一次的失败 —— 否则拉成功之后那句错误还挂在界面上
 * - alive 标志防卸载后 setState
 * - 失败必须落到 error,不能吞:列表保持 [] 时界面是「还没有…」的空态,和
 *   「确实一条都没建」长得一模一样,用户会以为数据丢了并去重建
 */
export function fetchWithAlive<T>(
  setError: (m: string) => void,
  run: () => Promise<T>,
  onOk: (data: T) => void,
): () => void {
  let alive = true;
  setError('');
  run()
    .then((data) => {
      if (alive) onOk(data);
    })
    .catch((e) => {
      if (alive) setError((e as Error).message);
    });
  return () => {
    alive = false;
  };
}

/**
 * 「删除一条并重拉列表」的公共骨架(卡 1/卡 2 各有一个删除按钮)。
 *
 * 400 的 reason 原样落到 error —— 那句话正是要让用户看到的
 * ("这条凭证还有模型条目在用" / "这个条目正被用途引用(…),先在「用途分配」里改"),
 * 所以这里不包一层,调用方也别包。
 */
export async function removeCardItem(
  del: () => Promise<unknown>,
  h: {
    clear: () => void;
    reload: () => Promise<void>;
    setError: (m: string) => void;
    /** 删除成功后、重拉前的一次性收尾(卡 1 用它退出被删凭证的编辑态) */
    onDeleted?: () => void;
  },
): Promise<void> {
  h.clear();
  try {
    await del();
    h.onDeleted?.();
    await h.reload();
  } catch (e) {
    h.setError((e as Error).message);
  }
}
