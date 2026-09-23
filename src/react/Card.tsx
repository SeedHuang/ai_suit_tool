import type React from 'react';

/** 卡片外壳 + 标题行(旧 Zap 标题的样式,图标按卡片换) */
export function Card({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="hud-panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {icon}
        <span className="hud-label" style={{ color: 'var(--ai-accent)' }}>
          {title}
          <span style={{ fontSize: 12, color: 'var(--ai-text-dim)', marginLeft: 8 }}>
            {hint}
          </span>
        </span>
      </div>
      {children}
    </div>
  );
}
