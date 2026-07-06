import { useRef } from "react";
import type { MarketInfo, FetchedProduct, VariantView } from "../types";
import { VariantsList } from "./VariantsList";

interface LeftPanelProps {
  selectedMarket: string;
  onMarketChange: (m: string) => void;
  markets: Record<string, MarketInfo>;
  sku: string;
  onSkuChange: (v: string) => void;
  templateFile: string;
  onTemplateUpload: (f: File) => void;
  // v5:两段式流水线 — 抓取数据 + 文案优化 取代旧的 onRun
  onFetch: () => void;
  onOptimize: () => void;
  isFetching: boolean;
  isOptimizing: boolean;
  isRunning: boolean;
  // 平台选择（amazon 已实现；walmart / wayfair 仅占位，走 template_skipped）
  platform: string;
  onPlatformChange: (p: string) => void;
  // 平台是否已实际实现（控制"提示"文案；amazon=true，其他平台=false）
  supportedPlatforms: Record<string, boolean>;
  fetchedProduct: FetchedProduct | null;
  steps: Array<{ step: string; status: string; [k: string]: unknown }>;
  error: string | null;
  // v4 新增 - 优化输入
  copyPromptExtra: string;
  onCopyPromptExtraChange: (v: string) => void;
  keywordsList: string[];
  keywordsBusy: boolean;
  keywordsError: string | null;
  onKeywordsUpload: (f: File) => void;
  onClearKeywords: () => void;
  // v6:listing 多 variant 支持
  listingVariants: VariantView[];
  activeVariantSku: string;
  onVariantSelect: (v: VariantView) => void;
  includeVariants: boolean;
  onIncludeVariantsChange: (v: boolean) => void;
  listingWarning?: string | null;
}

export function LeftPanel({
  selectedMarket,
  onMarketChange,
  markets,
  sku,
  onSkuChange,
  templateFile,
  onTemplateUpload,
  onFetch,
  onOptimize,
  isFetching,
  isOptimizing,
  isRunning,
  fetchedProduct,
  steps,
  error,
  copyPromptExtra,
  onCopyPromptExtraChange,
  keywordsList,
  keywordsBusy,
  keywordsError,
  onKeywordsUpload,
  onClearKeywords,
  listingVariants,
  activeVariantSku,
  onVariantSelect,
  includeVariants,
  onIncludeVariantsChange,
  listingWarning,
  platform,
  onPlatformChange,
  supportedPlatforms,
}: LeftPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const kwFileRef = useRef<HTMLInputElement>(null);

  // 平台下拉顺序：已实现优先（amazon），其余按字母序跟在后面
  const PLATFORM_ORDER = ["amazon", "walmart", "wayfair"] as const;
  const platformList = PLATFORM_ORDER.filter(p => p in supportedPlatforms);

  const stepLabels: Record<string, string> = {
    fetch: "1. GIGA 取数",
    ai_copy: "2. AI 文案生成",
    fill: "3. 填入 Excel",
  };

  // 简易 spinner keyframes（不进全局 CSS，避免影响其他面板）
  const spinnerKeyframes = `
    @keyframes lp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  `;

  // 原型:市场下拉顺序固定 US → UK → DE_TAX → DE_TAXFREE → FR
  const MARKET_ORDER = ["US", "UK", "DE_TAX", "DE_TAXFREE", "FR"] as const;
  const marketList = MARKET_ORDER
    .filter(k => k in markets)
    .map(k => [k, markets[k]] as const);

  const currentMarket = markets[selectedMarket];
  const credsHint = currentMarket
    ? `当前选中: ${currentMarket.name} · ${currentMarket.has_creds ? "凭证 OK" : "无凭证"}`
    : "请选择目标市场";

  return (
    <section style={{ padding: "32px", borderRight: "1px solid #eee", overflowY: "auto", maxHeight: "calc(100vh - 77px)" }}>
      {/* 市场选择 — 原型 v4:下拉菜单(顺序固定),下方状态 hint */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">目标市场</div>
        <select
          className="input"
          value={selectedMarket}
          onChange={e => onMarketChange(e.target.value)}
          disabled={marketList.length === 0}
          style={{ cursor: "pointer" }}
        >
          {marketList.length === 0 && <option value="">加载中...</option>}
          {marketList.map(([key, info]) => (
            <option key={key} value={key} disabled={!info.has_creds}>
              {info.name}{!info.has_creds ? " (无凭证)" : ""}
            </option>
          ))}
        </select>
        <div style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
          {credsHint}
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
          disabled={isRunning || isFetching}
        />
        {/* v6:抓取同 Listing 全部变体 开关 */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            marginTop: "8px",
            fontSize: "12px",
            color: "#666",
            cursor: isRunning || isFetching ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={includeVariants}
            onChange={e => onIncludeVariantsChange(e.target.checked)}
            disabled={isRunning || isFetching}
            style={{ cursor: "inherit" }}
          />
          抓取同 Listing 全部变体（颜色 / 尺寸）
        </label>
      </div>

      {/* v6:同 Listing 变体 chip 列表 — 抓取完成后显示 */}
      {listingVariants.length > 1 && (
        <div style={{ marginBottom: "28px" }}>
          <div className="section-title">
            同 Listing 变体 ({listingVariants.length})
          </div>
          <VariantsList
            variants={listingVariants}
            activeSku={activeVariantSku}
            onSelect={onVariantSelect}
            warning={listingWarning}
          />
          <div style={{ marginTop: "6px", fontSize: "11px", color: "#999" }}>
            点击 chip 切换;「文案优化」只针对当前选中变体跑 AI
          </div>
        </div>
      )}

      {/* 平台选择 — amazon 已实现；walmart / wayfair 仅占位 */}
      <div style={{ marginBottom: "16px" }}>
        <div className="section-title">
          平台 <span style={{ fontWeight: 400, fontSize: "11px", color: "#999" }}>（amazon 已上线）</span>
        </div>
        <select
          className="input"
          value={platform}
          onChange={e => onPlatformChange(e.target.value)}
          disabled={platformList.length === 0 || isRunning || isFetching}
          style={{ cursor: "pointer" }}
        >
          {platformList.map(p => (
            <option key={p} value={p} disabled={!supportedPlatforms[p]}>
              {p}{!supportedPlatforms[p] ? "（敬请期待）" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* 模板上传（可选） */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">
          {platform === "amazon" ? "Amazon" : platform} 模板 <span style={{ fontWeight: 400, fontSize: "11px", color: "#999" }}>（可选）</span>
        </div>
        <div
          style={{
            border: "1px dashed #e0e0e0",
            padding: "12px",
            textAlign: "center",
            cursor: supportedPlatforms[platform] ? "pointer" : "not-allowed",
            background: supportedPlatforms[platform] ? "#fafafa" : "#f0f0f0",
            fontSize: "13px",
            color: supportedPlatforms[platform] ? "#666" : "#999",
          }}
          onClick={() => supportedPlatforms[platform] && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx" style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) onTemplateUpload(e.target.files[0]); }} />
          {supportedPlatforms[platform]
            ? (templateFile ? `已上传: ${templateFile}` : "点击上传 .xlsm / .xlsx 模板（可选）")
            : "该平台尚不支持模板填写（敬请期待）"}
        </div>
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

      {/* v5:两段式按钮 — 抓取数据 + 文案优化 */}
      <button className="btn-primary" style={{ width: "100%" }}
        disabled={isFetching || isOptimizing || !sku.trim() || !selectedMarket}
        onClick={onFetch}>
        {isFetching ? "抓取中..." : "抓取数据"}
      </button>
      <div style={{ marginTop: "6px", fontSize: "12px", color: "#999", lineHeight: 1.6 }}>
        仅从 GIGA 拉取产品信息，不出 AI 文案
      </div>

      <button
        className="btn-primary"
        style={{ width: "100%", marginTop: "12px" }}
        disabled={isOptimizing || isFetching || !sku.trim() || !fetchedProduct}
        onClick={onOptimize}
        title={!fetchedProduct ? "请先点「抓取数据」" : ""}
      >
        {isOptimizing ? "AI 优化中..." : "文案优化"}
      </button>
      <div style={{ marginTop: "6px", fontSize: "12px", color: "#999", lineHeight: 1.6 }}>
        基于已抓取的产品数据生成 AI 文案（{markets[selectedMarket]?.lang || ""}），可选填入 Excel
      </div>

      {/* ─────────────────────────────────────────────
          优化输入(v4 新增,两块:提示词 + 关键词文件)
         ───────────────────────────────────────────── */}
      <div style={{ marginTop: "32px" }}>
        <div className="section-title">优化输入</div>

        {/* 块 1: 提示词 */}
        <div style={{ marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
              提示词 <span style={{ color: "#999", fontWeight: 400, fontSize: "11px", marginLeft: "4px" }}>可选</span>
            </span>
            <span
              onClick={() => onCopyPromptExtraChange("")}
              style={{ fontSize: "12px", color: "#1565c0", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
            >清空</span>
          </div>
          <textarea
            className="input"
            rows={6}
            value={copyPromptExtra}
            onChange={e => onCopyPromptExtraChange(e.target.value)}
            disabled={isRunning}
            placeholder="例:突出 0.6mm 加厚钢板的耐用性,标题包含 5 年质保关键词…"
            style={{ resize: "vertical", lineHeight: 1.5 }}
          />
        </div>

        {/* 块 2: 关键词文件 */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: 500, color: "#333" }}>
              关键词文件 <span style={{ color: "#999", fontWeight: 400, fontSize: "11px", marginLeft: "4px" }}>可选 · .txt/.csv/.xlsx</span>
            </span>
            {(keywordsList.length > 0 || keywordsError) && (
              <span
                onClick={onClearKeywords}
                style={{ fontSize: "12px", color: "#1565c0", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
              >清空</span>
            )}
          </div>
          <div
            style={{
              border: "1px dashed #e0e0e0",
              padding: "12px",
              textAlign: "center",
              cursor: keywordsBusy ? "wait" : "pointer",
              background: "#fafafa",
              fontSize: "13px",
              color: "#666",
            }}
            onClick={() => !keywordsBusy && kwFileRef.current?.click()}
          >
            <input
              ref={kwFileRef}
              type="file"
              accept=".txt,.csv,.xlsx"
              style={{ display: "none" }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) onKeywordsUpload(f);
                e.target.value = ""; // 允许重复上传同名文件
              }}
            />
            {keywordsBusy ? "解析中…" : "+ 上传关键词文件"}
          </div>
          {keywordsList.length > 0 && (
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#2e7d32" }}>
              ✓ 已解析 {keywordsList.length} 个关键词
            </div>
          )}
          {keywordsError && (
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#c62828" }}>
              ⚠ {keywordsError}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}