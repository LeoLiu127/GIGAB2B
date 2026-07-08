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
                background: "#e3f2fd",
                borderColor: "#1976d2",
                color: "#1976d2",
                fontWeight: 600,
              }
            : v.is_main
            ? {
                background: "#fff8e1",
                borderColor: "#f9a825",
                color: "#f57f17",
              }
            : {
                background: "#fafafa",
                borderColor: "#e0e0e0",
                color: "#555",
              };
          return (
            <span
              key={v.sku}
              title={`${v.sku}${v.is_main ? " (主 SKU)" : ""}\n${v.label}`}
              style={{ ...baseStyle, ...activeStyle }}
              onClick={() => !isActive && onSelect(v)}
              onMouseEnter={e => {
                if (!isActive) e.currentTarget.style.borderColor = "#999";
              }}
              onMouseLeave={e => {
                if (!isActive)
                  e.currentTarget.style.borderColor = v.is_main ? "#f9a825" : "#e0e0e0";
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
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#c62828", lineHeight: 1.5 }}>
          ⚠ {warning}
        </div>
      )}
    </div>
  );
}