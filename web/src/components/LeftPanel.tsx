import { useRef } from "react";
import type { MarketInfo } from "../types";

interface LeftPanelProps {
  selectedMarket: string;
  onMarketChange: (m: string) => void;
  markets: Record<string, MarketInfo>;
  sku: string;
  onSkuChange: (v: string) => void;
  templateFile: string;
  onTemplateUpload: (f: File) => void;
  onRun: () => void;
  isRunning: boolean;
  steps: Array<{ step: string; status: string; [k: string]: unknown }>;
  error: string | null;
}

export function LeftPanel({
  selectedMarket,
  onMarketChange,
  markets,
  sku,
  onSkuChange,
  templateFile,
  onTemplateUpload,
  onRun,
  isRunning,
  steps,
  error,
}: LeftPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const stepLabels: Record<string, string> = {
    fetch: "1. GIGA 取数",
    ai_copy: "2. AI 文案生成",
    fill: "3. 填入 Excel",
  };

  // 简易 spinner keyframes（不进全局 CSS，避免影响其他面板）
  const spinnerKeyframes = `
    @keyframes lp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;

  const marketList = Object.entries(markets);

  return (
    <section style={{ padding: "32px", borderRight: "1px solid #eee", overflowY: "auto", maxHeight: "calc(100vh - 77px)" }}>
      {/* 市场选择 */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">目标市场</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {marketList.map(([key, info]) => {
            const hasCreds = info.has_creds;
            const isSelected = selectedMarket === key;
            return (
              <label key={key} style={{
                display: "flex",
                alignItems: "center",
                gap: "10px",
                padding: "11px 14px",
                border: `1px solid ${isSelected ? "#000" : hasCreds ? "#e0e0e0" : "#f5d5d5"}`,
                background: isSelected ? "#f5f5f5" : hasCreds ? "#fff" : "#fafafa",
                cursor: hasCreds ? "pointer" : "not-allowed",
                fontSize: "14px",
                transition: "all 0.15s",
                opacity: hasCreds ? 1 : 0.6,
              }}>
                <input type="radio" name="market" value={key} checked={isSelected}
                  onChange={() => hasCreds && onMarketChange(key)}
                  disabled={!hasCreds}
                  style={{ accentColor: "#000", cursor: hasCreds ? "pointer" : "not-allowed" }} />
                <span style={{ flex: 1 }}>{info.name}</span>
                <span className={`badge ${hasCreds ? "badge-ok" : "badge-error"}`}>
                  {hasCreds ? "OK" : "无凭证"}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* SKU */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">SKU</div>
        <input
          className="input"
          value={sku}
          onChange={e => onSkuChange(e.target.value)}
          placeholder="例如：W3372P314940"
          disabled={isRunning}
        />
      </div>

      {/* 模板上传（可选） */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">
          Amazon 模板 <span style={{ fontWeight: 400, fontSize: "11px", color: "#999" }}>（可选）</span>
        </div>
        <div
          style={{ border: "1px dashed #e0e0e0", padding: "24px", textAlign: "center", cursor: "pointer", background: "#fafafa" }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx" style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) onTemplateUpload(e.target.files[0]); }} />
          <div style={{ fontSize: "14px", color: "#666" }}>
            {templateFile
              ? `已上传: ${templateFile}`
              : "点击上传 Amazon 模板文件（.xlsm / .xlsx）\n系统将自动检测目标市场；未上传也可生成 AI 文案与产品图"
            }
          </div>
        </div>
        {templateFile && (
          <div style={{ marginTop: "6px", fontSize: "11px", color: "#2e7d32" }}>
            模板将自动检测市场，语言自动匹配
          </div>
        )}
      </div>

      {/* 进度步骤 */}
      {steps.length > 0 && (
        <div style={{ marginBottom: "28px" }}>
          <style>{spinnerKeyframes}</style>
          <div className="section-title">处理进度</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {steps.map((s, i) => {
              const isError  = s.status === "error";
              const isOk     = s.status === "ok";
              const isSkipped = s.status === "skipped";
              const isRunning = s.status === "running";
              const icon     = isError ? "✕" : isOk ? "✓" : isSkipped ? "↷" : isRunning ? "↻" : "○";
              const iconColor = isError ? "#c62828" : isOk ? "#2e7d32" : isSkipped ? "#9e9e9e" : isRunning ? "#1976d2" : "#999";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                  <span
                    style={{
                      color: iconColor,
                      display: "inline-block",
                      animation: isRunning ? "lp-spin 1s linear infinite" : "none",
                    }}
                  >{icon}</span>
                  <span style={{ color: isError ? "#c62828" : "#333" }}>
                    {stepLabels[s.step] || (s as { label?: string }).label || s.step}
                  </span>
                  {isRunning && (
                    <span style={{ color: "#1976d2", fontSize: "12px", marginLeft: "auto" }}>进行中…</span>
                  )}
                  {isOk && s.step === "ai_copy" && typeof s.title === "string" && (
                    <span style={{ color: "#666", fontSize: "12px", marginLeft: "auto", maxWidth: "100px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.title}
                    </span>
                  )}
                  {isOk && s.step === "fetch" && typeof s.product_name === "string" && (
                    <span style={{ color: "#666", fontSize: "12px", marginLeft: "auto" }}>
                      {s.product_name.slice(0, 25)}...
                    </span>
                  )}
                  {isOk && s.step === "fill" && typeof s.output === "string" && (
                    <span style={{ color: "#2e7d32", fontSize: "12px", marginLeft: "auto" }}>{s.output}</span>
                  )}
                  {isSkipped && s.step === "fill" && (
                    <span style={{ color: "#9e9e9e", fontSize: "12px", marginLeft: "auto" }}>已跳过</span>
                  )}
                  {isError && (
                    <span style={{ color: "#c62828", fontSize: "12px", marginLeft: "auto" }}>{String(s.message || "")}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 错误 */}
      {error && (
        <div style={{ marginBottom: "28px", padding: "14px", background: "#ffebee", border: "1px solid #ffcdd2", borderRadius: "4px", fontSize: "13px", color: "#c62828" }}>
          {error}
        </div>
      )}

      {/* 执行按钮 */}
      <button className="btn-primary" style={{ width: "100%" }}
        disabled={isRunning || !sku.trim() || !selectedMarket}
        onClick={onRun}>
        {isRunning ? "处理中..." : "执行流水线"}
      </button>

      {/* 提示 */}
      {!isRunning && (
        <div style={{ marginTop: "14px", fontSize: "12px", color: "#999", lineHeight: 1.6 }}>
          自动流程：GIGA 取数 → AI 文案优化（{markets[selectedMarket]?.lang || ""}）→ 填入 Excel
        </div>
      )}
    </section>
  );
}