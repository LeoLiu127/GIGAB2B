import type { VariantView } from "../types";

interface VariantsListProps {
  variants: VariantView[];
  activeSku: string;
  onSelect: (v: VariantView) => void;
  warning?: string | null;
}

/**
 * 横向 chip 列表 — 显示当前 listing 的全部变体(颜色 / 尺寸)。
 * 主 SKU 带 ★ 标记;active chip 高亮;warning 红字透传。
 */
export function VariantsList({ variants, activeSku, onSelect, warning }: VariantsListProps) {
  if (!variants || variants.length === 0) return null;
  // 单 variant(没兄弟)不渲染整块 — 退化为单 SKU 体验
  if (variants.length === 1) return null;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {variants.map(v => {
          const isActive = v.sku === activeSku;
          const baseStyle: React.CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
            padding: "4px 10px",
            borderRadius: "14px",
            fontSize: "11px",
            cursor: "pointer",
            userSelect: "none",
            border: "1px solid",
            transition: "all 0.15s",
            minWidth: 0,
            maxWidth: "100%",
          };
          const activeStyle: React.CSSProperties = isActive
            ? {
                background: "var(--theme-info-bg)",
                borderColor: "var(--theme-link)",
                color: "var(--theme-link)",
                fontWeight: 600,
              }
            : v.is_main
            ? {
                background: "var(--theme-warning-bg)",
                borderColor: "var(--theme-warning-border)",
                color: "var(--theme-warning-text)",
              }
            : {
                background: "var(--theme-surface-soft)",
                borderColor: "var(--theme-border)",
                color: "var(--theme-text-secondary)",
              };
          return (
            <span
              key={v.sku}
              title={`${v.sku}${v.is_main ? " (主 SKU)" : ""}\n${v.label}`}
              style={{ ...baseStyle, ...activeStyle }}
              onClick={() => !isActive && onSelect(v)}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.borderColor = "var(--theme-text-muted)";
              }}
              onMouseLeave={e => {
                if (!isActive)
                  e.currentTarget.style.borderColor = v.is_main ? "var(--theme-warning-border)" : "var(--theme-border)";
              }}
            >
              {v.is_main && <span style={{ fontSize: "10px" }}>★</span>}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "160px",
                }}
              >
                {v.label}
              </span>
            </span>
          );
        })}
      </div>
      {warning && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--theme-danger-text)", lineHeight: 1.5 }}>
          ⚠ {warning}
        </div>
      )}
    </div>
  );
}
