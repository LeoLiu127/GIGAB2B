import { useState, useEffect, useRef } from "react";
import type { PipelineResult, FetchedProduct } from "../types";
import { normalizeBulletLine } from "../workflow";

interface CenterPanelProps {
  result: PipelineResult | null;
  isRunning: boolean;
  // v5:两段式 — 抓取数据(原始侧)+ 文案优化(优化侧)
  isFetching: boolean;
  isOptimizing: boolean;
  fetchedProduct: FetchedProduct | null;
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
  onTitleChange: (v: string) => void;
  onBulletsChange: (v: string[]) => void;
  onDescriptionChange: (v: string) => void;
  onSearchTermsChange: (v: string) => void;
  // Round2 fix Bug 3:变体共用同一原始标题时显示灰字提示
  sharedTitle?: boolean;
  sharedTitleVariantCount?: number;
}

export function CenterPanel({
  result,
  isRunning,
  isFetching,
  isOptimizing,
  fetchedProduct,
  title,
  bullets,
  description,
  searchTerms,
  onTitleChange,
  onBulletsChange,
  onDescriptionChange,
  onSearchTermsChange,
  sharedTitle,
  sharedTitleVariantCount,
}: CenterPanelProps) {
  return (
    <section style={{ padding: "32px", overflowY: "auto", maxHeight: "calc(100vh - 77px)" }}>
      {!result && !fetchedProduct && !isRunning && !isFetching && !isOptimizing && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "var(--theme-text-muted)" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect x="8" y="12" width="48" height="40" rx="3" stroke="currentColor" strokeWidth="2"/>
              <line x1="8" y1="24" x2="56" y2="24" stroke="currentColor" strokeWidth="2"/>
              <line x1="20" y1="24" x2="20" y2="52" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div style={{ fontSize: "16px", textAlign: "center", lineHeight: 1.7 }}>
            输入 SKU 并点击「抓取数据」<br/>查看 GIGA 原始产品信息
          </div>
        </div>
      )}

      {/* 抓取/优化进行中时的紧凑状态条 — 不再撑 60vh 大空白,避免覆盖下方 compare-block */}
      {(isFetching || isOptimizing) && (result || fetchedProduct) && (
        <div style={{
          padding: "10px 14px",
          background: "var(--theme-info-bg)",
          border: "1px solid var(--theme-info-border)",
          borderRadius: "4px",
          fontSize: "13px",
          color: "var(--theme-info-text)",
          marginBottom: "16px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}>
          <span style={{ animation: "pulse 1.5s infinite" }}>⏳</span>
          <span>{isFetching ? "正在从 GIGA 抓取数据…" : "AI 正在优化文案…"}</span>
        </div>
      )}

      {/* 没有 fetchedProduct/result 时的全屏 loading(原始空态) */}
      {(isFetching || isOptimizing) && !result && !fetchedProduct && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "var(--theme-text-muted)" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px", animation: "pulse 1.5s infinite" }}>⏳</div>
          <div style={{ fontSize: "16px" }}>{isFetching ? "正在从 GIGA 抓取数据…" : "AI 正在优化文案…"}</div>
        </div>
      )}

      {(result || fetchedProduct) && (
        <>
          {/* Round2 fix Bug 3:listing 多变体 + 共用同一原始标题 → 灰字提示 */}
          {sharedTitle && sharedTitleVariantCount && sharedTitleVariantCount > 1 && (
            <div style={{
              margin: "0 0 12px",
              padding: "8px 12px",
              background: "var(--theme-surface-soft)",
              border: "1px dashed var(--theme-border)",
              borderRadius: "4px",
              fontSize: "11px",
              color: "var(--theme-text-secondary)",
              lineHeight: 1.6,
            }}>
              此 listing 共 {sharedTitleVariantCount} 个变体,GIGA 共用同一原始标题;在下方「优化后」框可按变体覆写
            </div>
          )}
          <CopyEditor
            result={result}
            fetchedProduct={fetchedProduct}
            isOptimizing={isOptimizing}
            title={title}
            bullets={bullets}
            description={description}
            searchTerms={searchTerms}
            onTitleChange={onTitleChange}
            onBulletsChange={onBulletsChange}
            onDescriptionChange={onDescriptionChange}
            onSearchTermsChange={onSearchTermsChange}
          />
        </>
      )}
    </section>
  );
}

interface CopyEditorProps {
  result: PipelineResult | null;
  fetchedProduct: FetchedProduct | null;
  isOptimizing: boolean;
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
  onTitleChange: (v: string) => void;
  onBulletsChange: (v: string[]) => void;
  onDescriptionChange: (v: string) => void;
  onSearchTermsChange: (v: string) => void;
}

function CopyEditor({
  result,
  fetchedProduct,
  isOptimizing,
  title,
  bullets,
  description,
  searchTerms,
  onTitleChange,
  onBulletsChange,
  onDescriptionChange,
  onSearchTermsChange,
}: CopyEditorProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 组件卸载时清理未触发的 setTimeout(严重 S-5 修复)
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const copy = (text: string, key: string) => {
    // 失败兜底:clipboard API 在 HTTP / 隐私模式下会 reject
    const fallback = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(key);
      } catch {
        setCopied(`failed-${key}`);
      }
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(null), 1500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopied(key);
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
          copyTimerRef.current = setTimeout(() => setCopied(null), 1500);
        },
        () => fallback(),
      );
    } else {
      fallback();
    }
  };

  // AI 文案生成质量警告(B.7 修复)— 仅在有 result 时计算
  const aiStatus = result?.ai_status || "ok";
  const aiAttempts = result?.ai_attempts || 1;
  const showPartialWarn = result != null && aiStatus === "partial";
  const showEmptyWarn = result != null && aiStatus === "empty";
  const showRetryHint = result != null && aiAttempts > 1;

  // v5:原始文案来源 — 优先 result(全流水线回传),其次 fetchedProduct(仅抓取时)
  // Round2 fix Bug 4:用 fetchedProduct 优先 — result 来自最早 fetch 的 SKU,
  // 切 variant 后是陈旧数据;只有当 fetchedProduct 没有原始字段时才回退到 result
  const originalTitle =
    (fetchedProduct?.product_name ?? "") ||
    (result?.original_title ?? "");
  const originalBulletsArr =
    fetchedProduct?.original_bullets ?? result?.original_bullets ?? [];
  const originalBulletsText = originalBulletsArr.length > 0
    ? "• " + originalBulletsArr.join("\n• ")
    : "";

  const bulletRows = Array.from({ length: 5 }, (_, index) => normalizeBulletLine(bullets[index] ?? ""));
  const updateBulletAt = (index: number, value: string) => {
    const next = [...bulletRows];
    next[index] = normalizeBulletLine(value);
    onBulletsChange(next);
  };

  // 没跑过 AI 优化时,textarea 全是 placeholder
  const placeholderTitle = isOptimizing ? "AI 优化中..." : "尚未生成,点左栏「文案优化」按钮";
  const placeholderBullets = isOptimizing ? "AI 优化中..." : "SUMMARY Core selling point and customer benefit";
  const placeholderDesc = isOptimizing ? "AI 优化中..." : "尚未生成,点左栏「文案优化」按钮";
  const placeholderSt = isOptimizing ? "AI 优化中..." : "尚未生成,点左栏「文案优化」按钮";

  return (
    <>
      {/* compare-block 容器 — 对齐原型 prototype-ui-preview.html 行 156-231 */}
      <div style={{
        background: "var(--theme-surface)",
        border: "1px solid var(--theme-border-soft)",
        borderRadius: "6px",
        marginBottom: "20px",
      }}>
        {/* compare-block-head */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--theme-border-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            {result ? (
              showEmptyWarn ? (
                <div className="badge" style={{ background: "var(--theme-danger-bg)", color: "var(--theme-danger-text)", border: "1px solid var(--theme-danger-border)", padding: "2px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: 500 }}>AI 失败</div>
              ) : showPartialWarn ? (
                <div className="badge" style={{ background: "var(--theme-warning-bg)", color: "var(--theme-warning-text)", border: "1px solid var(--theme-warning-border)", padding: "2px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: 500 }}>部分缺失</div>
              ) : (
                <div className="badge badge-ok">AI 已生成</div>
              )
            ) : (
              <div className="badge" style={{ background: "var(--theme-info-bg)", color: "var(--theme-info-text)", border: "1px solid var(--theme-info-border)", padding: "2px 10px", borderRadius: "10px", fontSize: "11px", fontWeight: 500 }}>已抓取原始</div>
            )}
            <div style={{ fontSize: "13px", color: "var(--theme-text-secondary)" }}>{result?.market_name || (fetchedProduct?.market ?? "")}</div>
            {showRetryHint && (
              <div style={{ fontSize: "11px", color: "var(--theme-text-muted)" }}>
                (AI 重试 {aiAttempts} 次后成功)
              </div>
            )}
          </div>
          <div style={{ fontSize: "11px", color: "var(--theme-text-muted)" }}>
            原始文案 & 优化后文案 · 上方只读 · 下方可编辑可复制
          </div>
        </div>

        {/* AI 文案质量警告(B.7) — 放在 compare-block 内顶部 */}
        {showEmptyWarn && (
          <div style={{ padding: "12px 16px", background: "var(--theme-danger-bg)", borderBottom: "1px solid var(--theme-danger-border)", fontSize: "13px", color: "var(--theme-danger-text)" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>⚠ AI 返回内容为空</div>
            <div style={{ color: "var(--theme-danger-text)" }}>
              流水线虽然"完成",但 AI 没生成任何文案。下方字段全是空的。建议重试或检查 MiniMax API 配额/余额。
            </div>
          </div>
        )}
        {showPartialWarn && (
          <div style={{ padding: "12px 16px", background: "var(--theme-warning-bg)", borderBottom: "1px solid var(--theme-warning-border)", fontSize: "13px", color: "var(--theme-warning-text)" }}>
            <div style={{ fontWeight: 600, marginBottom: "4px" }}>⚠ AI 文案部分缺失</div>
            <div style={{ color: "var(--theme-warning-text)" }}>
              部分字段(标题/五点/描述/搜索词)可能为空。你可以直接在下方编辑框补全,或重试流水线。
            </div>
          </div>
        )}

        {/* 抓取图片渲染已迁移到第三栏 — 中栏只承担文案编辑 */}

        {/* 字段 1: 产品标题 — 原始有内容 */}
        <CompareField
          name="产品标题"
          tag="原始"
          original={originalTitle}
          emptyOriginalText="GIGA 未提供原始标题"
          optimized={title}
          placeholder={placeholderTitle}
          rows={3}
          showFoot={(title?.length ?? 0) > 0}
          footText={`${title?.length ?? 0} / 200 字符`}
          footError={title != null && title.length > 200}
          onOptimizedChange={onTitleChange}
          copied={copied === "title"}
          failed={copied === "failed-title"}
          onCopy={() => copy(title || "", "title")}
        />

        {/* 字段 2: 五点描述 — 原始有内容(多行) */}
        <BulletFields
          name="五点描述"
          tag="原始"
          original={originalBulletsText}
          emptyOriginalText="GIGA 未提供原始五点"
          bullets={bulletRows}
          placeholder={placeholderBullets}
          onBulletChange={updateBulletAt}
          copied={copied}
          onCopy={(text, key) => copy(text, key)}
        />

        {/* 字段 3: 产品描述 — GIGA 没原始,完全隐藏原始区 */}
        <CompareField
          name="产品描述"
          tag="AI 生成"
          original={null}
          emptyOriginalText=""
          optimized={description}
          placeholder={placeholderDesc}
          rows={6}
          hideOriginal
          onOptimizedChange={onDescriptionChange}
          copied={copied === "desc"}
          failed={copied === "failed-desc"}
          onCopy={() => copy(description || "", "desc")}
        />

        {/* 字段 4: Search Terms — GIGA 没原始,完全隐藏原始区 */}
        <CompareField
          name="Search Terms"
          tag="AI 生成"
          original={null}
          emptyOriginalText=""
          optimized={searchTerms}
          placeholder={placeholderSt}
          rows={3}
          hideOriginal
          onOptimizedChange={onSearchTermsChange}
          copied={copied === "st"}
          failed={copied === "failed-st"}
          onCopy={() => copy(searchTerms || "", "st")}
        />
      </div>

      {/* 未上传模板 / 未支持平台 时的浅绿提示条 */}
      {result?.template_skipped && (
        <div style={{
          padding: "12px 14px",
          background: "var(--theme-success-bg)",
          border: "1px solid var(--theme-success-border)",
          borderRadius: "4px",
          fontSize: "13px",
          color: "var(--theme-success-text)",
          lineHeight: 1.6,
          marginBottom: "20px",
        }}>
          {result.platform && result.platform !== "amazon"
            ? `本次未填写模板：平台 ${result.platform} 暂未上线模板填写功能；AI 文案已生成。`
            : "本次未使用 Amazon 模板，AI 文案已生成；如需填写 Amazon 模板，请上传后再运行一次。"}
        </div>
      )}
      {result && (
        <div style={{ padding: "16px", background: "var(--theme-surface-muted)", border: "1px solid var(--theme-border)", borderRadius: "4px", fontSize: "13px" }}>
          <div style={{ fontWeight: 500, marginBottom: "6px" }}>输出文件</div>
          <div style={{ color: "var(--theme-text-secondary)" }}>
            {result.output_file || (result.template_skipped ? "（本次未生成 .xlsm — 未提供模板）" : "")}
          </div>
          {result.output_url && (
            <a
              href={result.output_url}
              style={{ display: "inline-block", color: "var(--theme-link)", fontSize: "12px", marginTop: "8px" }}
            >
              下载 Excel 文件
            </a>
          )}
        </div>
      )}
    </>
  );
}

interface BulletFieldsProps {
  name: string;
  tag: string;
  original: string | null;
  emptyOriginalText: string;
  bullets: string[];
  placeholder: string;
  onBulletChange: (index: number, value: string) => void;
  copied: string | null;
  onCopy: (text: string, key: string) => void;
}

function BulletFields({
  name,
  tag,
  original,
  emptyOriginalText,
  bullets,
  placeholder,
  onBulletChange,
  copied,
  onCopy,
}: BulletFieldsProps) {
  const hasOriginal = !!(original && original.trim());

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--theme-border-soft)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--theme-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
          {name}
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: "var(--theme-surface-muted)", color: "var(--theme-text-secondary)", fontWeight: 500, letterSpacing: 0.2,
          }}>{tag}</span>
        </span>
      </div>

      {hasOriginal ? (
        <div style={{
          fontSize: 12, color: "var(--theme-text-secondary)", lineHeight: 1.6,
          background: "var(--theme-surface-soft)", borderLeft: "3px solid var(--theme-border)",
          padding: "10px 12px", borderRadius: "0 4px 4px 0",
          marginBottom: 12, maxHeight: 120, overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}>{original}</div>
      ) : (
        <div style={{
          fontSize: 12, color: "var(--theme-text-muted)", fontStyle: "italic", lineHeight: 1.6,
          background: "var(--theme-surface-soft)", borderLeft: "3px solid var(--theme-border-soft)",
          padding: "10px 12px", borderRadius: "0 4px 4px 0",
          marginBottom: 12,
        }}>{emptyOriginalText}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
          <span>优化后 · 五条独立可编辑可复制</span>
          {bullets.some(b => b.trim()) && (
            <span
              onClick={() => onCopy(bullets.filter(b => b.trim()).join("\n"), "bullets")}
              style={{ fontSize: 12, color: "var(--theme-link)", cursor: "pointer", textTransform: "none", letterSpacing: 0 }}
            >
              {copied === "bullets" ? "✓ 已复制全部" : copied === "failed-bullets" ? "复制失败" : "📋 复制全部"}
            </span>
          )}
        </div>
        {bullets.map((bullet, index) => {
          const key = `bullet-${index}`;
          const value = bullet ?? "";
          return (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "start" }}>
              <textarea
                className="input"
                rows={2}
                value={value}
                onChange={e => onBulletChange(index, e.target.value)}
                placeholder={placeholder}
                style={{
                  minHeight: 52,
                  fontSize: 13,
                  lineHeight: 1.55,
                  resize: "vertical",
                  fontFamily: "Menlo, Consolas, monospace",
                }}
              />
              <button
                className={value.trim() ? "btn-secondary" : ""}
                disabled={!value.trim()}
                onClick={() => onCopy(value.trim(), key)}
                style={{
                  padding: "8px 10px",
                  fontSize: 12,
                  minWidth: 72,
                  border: value.trim() ? undefined : "1px solid var(--theme-border)",
                  background: value.trim() ? undefined : "var(--theme-surface-muted)",
                  color: value.trim() ? undefined : "var(--theme-text-muted)",
                  cursor: value.trim() ? "pointer" : "not-allowed",
                }}
              >
                {copied === key ? "✓ 已复制" : copied === `failed-${key}` ? "复制失败" : "复制"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * CompareField — compare-block 单个字段组件
 * 上方:只读原始文案(有内容 → 灰底;空态 → 斜体浅灰)
 * 下方:可编辑的优化后 textarea + 复制按钮 + 可选脚注
 */
interface CompareFieldProps {
  name: string;
  tag: string;
  original: string | null;        // 传 null 强制走空态(原型字段 3/4)
  emptyOriginalText: string;
  optimized: string;
  placeholder: string;
  rows: number;
  monoFont?: boolean;
  showFoot?: boolean;
  footText?: string;
  footError?: boolean;
  hideOriginal?: boolean;         // 完全隐藏原始区(包括空态提示)— 字段 3/4 用
  onOptimizedChange: (v: string) => void;
  copied: boolean;
  failed: boolean;
  onCopy: () => void;
}

function CompareField({
  name, tag, original, emptyOriginalText,
  optimized, placeholder, rows, monoFont,
  showFoot, footText, footError, hideOriginal,
  onOptimizedChange, copied, failed, onCopy,
}: CompareFieldProps) {
  const hasOriginal = !!(original && original.trim());
  const showOriginalBlock = !hideOriginal;
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--theme-border-soft)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--theme-text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
          {name}
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 10,
            background: "var(--theme-surface-muted)", color: "var(--theme-text-secondary)", fontWeight: 500, letterSpacing: 0.2,
          }}>{tag}</span>
        </span>
      </div>

      {/* 原始区 — hideOriginal=true 时整个区域不渲染(没有空态提示框) */}
      {showOriginalBlock && hasOriginal && (
        <div style={{
          fontSize: 12, color: "var(--theme-text-secondary)", lineHeight: 1.6,
          background: "var(--theme-surface-soft)", borderLeft: "3px solid var(--theme-border)",
          padding: "10px 12px", borderRadius: "0 4px 4px 0",
          marginBottom: 12, maxHeight: 120, overflowY: "auto",
          whiteSpace: "pre-wrap",
        }}>{original}</div>
      )}
      {showOriginalBlock && !hasOriginal && (
        <div style={{
          fontSize: 12, color: "var(--theme-text-muted)", fontStyle: "italic", lineHeight: 1.6,
          background: "var(--theme-surface-soft)", borderLeft: "3px solid var(--theme-border-soft)",
          padding: "10px 12px", borderRadius: "0 4px 4px 0",
          marginBottom: 12,
        }}>{emptyOriginalText}</div>
      )}

      {/* 优化后区 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, color: "var(--theme-text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>
          <span>优化后 · 可编辑</span>
          {optimized && (
            <span onClick={onCopy} style={{ fontSize: 12, color: "var(--theme-link)", cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>
              {copied ? "✓ 已复制" : failed ? "复制失败" : "📋 复制"}
            </span>
          )}
        </div>
        <textarea
          className="input"
          rows={rows}
          value={optimized}
          onChange={e => onOptimizedChange(e.target.value)}
          placeholder={placeholder}
          style={{
            minHeight: rows * 18,
            fontSize: monoFont ? 13 : 14,
            lineHeight: 1.6,
            resize: "vertical",
            fontFamily: monoFont ? "Menlo, Consolas, monospace" : "inherit",
          }}
        />
        {showFoot && footText != null && (
          <div style={{ fontSize: 11, color: footError ? "var(--theme-danger-text)" : "var(--theme-text-muted)" }}>
            {footText}
          </div>
        )}
      </div>
    </div>
  );
}
