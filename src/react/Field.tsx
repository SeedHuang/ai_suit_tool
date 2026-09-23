import type React from 'react';

/**
 * label → 输入框 id 的唯一生成处 —— Field 的 `htmlFor` 和挂在控件上的 `id` **必须**
 * 用同一个,所以只在这里拼一次。
 *
 * 中英文都保留,其余字符(空格、斜杠)压成连字符,好当 id 用。各拼一遍的后果:消费方
 * 传入含空格/斜杠的用途 key(未命中内置表时直接显示 key)时两边生成的不一样
 * (`llm-tag/check` ≠ `llm-tag-check`),`<label for>` 直接失联;两个用途 label 相同时
 * 还会产生重复 DOM id。
 */
export function fieldId(label: string): string {
  return `llm-${label.replace(/[^\w一-龥]+/g, '-')}`;
}

/**
 * 用真 `<label for>` 而不是旁边放个 span。
 *
 * 两个原因,第二个是踩过的坑:
 * 1. 无障碍 —— 屏幕阅读器要靠 label 才知道这个输入框是干什么的
 * 2. **浏览器自动填充** —— 一个没有标注的文本框紧挨着密码框,Chrome 会按
 *    "用户名 + 密码"的启发式把它填成保存的用户名(实测被填成了 Windows 用户名),
 *    然后这个值就被当成接口地址发出去
 */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = fieldId(label);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      <label htmlFor={id} className="hud-label" style={{ width: 92, flex: 'none' }}>
        {label}
      </label>
      <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0 }}>{children}</span>
    </div>
  );
}
