export interface ImageType {
  type: "main" | "sub" | "detail";
}

export const IMAGE_TYPE_OPTIONS: { value: ImageType["type"]; label: string; hint: string }[] = [
  { value: "main",   label: "主图",   hint: "白底/纯色居中，主体占比 ≥80%" },
  { value: "sub",    label: "副图",   hint: "尺寸图或场景图，1600×1600" },
  { value: "detail", label: "详情图", hint: "场景/特写，展示材质工艺细节" },
];

export const SIZE_OPTIONS: { value: string; label: string; sizeParam: string; imageSizeParam: string }[] = [
  { value: "1600x1600", label: "1600 × 1600（1:1 主图标准）",     sizeParam: "1600x1600", imageSizeParam: "1024x1024" },
  { value: "1464x600",  label: "1464 × 600（A+ 横长条）",          sizeParam: "1464x600",  imageSizeParam: "1024x512"  },
  { value: "1200x900",  label: "1200 × 900（4:3 详情图）",         sizeParam: "1200x900",  imageSizeParam: "1024x768"  },
  { value: "2000x1000", label: "2000 × 1000（2:1 大图）",          sizeParam: "2000x1000", imageSizeParam: "1024x512"  },
];

interface PromptFormProps {
  imageType: ImageType["type"];
  onImageTypeChange: (v: ImageType["type"]) => void;
  size: string;
  onSizeChange: (v: string) => void;
  promptExtra: string;
  onPromptExtraChange: (v: string) => void;
  onGenerate: () => void;
  generating: boolean;
  canGenerate: boolean;
  selectedCount: number;
  uploadedCount: number;
}

export function PromptForm({
  imageType,
  onImageTypeChange,
  size,
  onSizeChange,
  promptExtra,
  onPromptExtraChange,
  onGenerate,
  generating,
  canGenerate,
  selectedCount,
  uploadedCount,
}: PromptFormProps) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <div className="section-title" style={{ margin: "0 0 8px" }}>生成参数</div>

      {/* 主图 / 详情图 单选 */}
      <div style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", gap: "6px" }}>
          {IMAGE_TYPE_OPTIONS.map(o => {
            const active = imageType === o.value;
            return (
              <button
                key={o.value}
                type="button"
                className={active ? "theme-action" : ""}
                onClick={() => onImageTypeChange(o.value)}
                style={{
                  flex: 1,
                  padding: "8px 6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  background: active ? "var(--theme-action-bg)" : "var(--theme-surface-soft)",
                  color: active ? "var(--theme-action-fg)" : "var(--theme-text-primary)",
                  border: active ? "1px solid var(--theme-action-bg)" : "1px solid var(--theme-border)",
                  borderRadius: "4px",
                  textAlign: "left",
                  lineHeight: 1.3,
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontWeight: 600 }}>{o.label}</div>
                <div style={{ fontSize: "10px", opacity: 0.85, marginTop: "2px" }}>{o.hint}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 尺寸下拉 */}
      <div style={{ marginBottom: "10px" }}>
        <div style={{ fontSize: "11px", color: "var(--theme-text-secondary)", marginBottom: "3px" }}>尺寸</div>
        <select
          className="input"
          style={{ padding: "6px 8px", fontSize: "12px", width: "100%" }}
          value={size}
          onChange={e => onSizeChange(e.target.value)}
        >
          {SIZE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 附加要求 */}
      <textarea
        className="input"
        style={{ minHeight: "50px", fontSize: "12px", resize: "vertical", padding: "8px" }}
        value={promptExtra}
        onChange={e => onPromptExtraChange(e.target.value)}
        placeholder="附加要求（可选）：如「主体占画面 70%、不要文字、不要水印」"
      />

      <button
        className="btn-primary"
        style={{ width: "100%", marginTop: "8px", padding: "10px" }}
        disabled={!canGenerate || generating}
        onClick={onGenerate}
      >
        {generating ? "生成中…" : `生成 (${selectedCount} 勾选 + ${uploadedCount} 本地)`}
      </button>
    </div>
  );
}
