import { useState } from "react";
import type { PipelineResult } from "../types";

interface CenterPanelProps {
  result: PipelineResult | null;
  isRunning: boolean;
  title: string;
  bullets: string[];
  description: string;
  searchTerms: string;
  onTitleChange: (v: string) => void;
  onBulletsChange: (v: string[]) => void;
  onDescriptionChange: (v: string) => void;
  onSearchTermsChange: (v: string) => void;
}

export function CenterPanel({
  result,
  isRunning,
  title,
  bullets,
  description,
  searchTerms,
  onTitleChange,
  onBulletsChange,
  onDescriptionChange,
  onSearchTermsChange,
}: CenterPanelProps) {
  return (
    <section style={{ padding: "32px", overflowY: "auto", maxHeight: "calc(100vh - 77px)" }}>
      {!result && !isRunning && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "#ccc" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <rect x="8" y="12" width="48" height="40" rx="3" stroke="currentColor" strokeWidth="2"/>
              <line x1="8" y1="24" x2="56" y2="24" stroke="currentColor" strokeWidth="2"/>
              <line x1="20" y1="24" x2="20" y2="52" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div style={{ fontSize: "16px" }}>输入 SKU 并执行流水线<br/>AI 将自动生成优化的 Listing 文案</div>
        </div>
      )}

      {isRunning && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "#999" }}>
          <div style={{ fontSize: "48px", marginBottom: "12px", animation: "pulse 1.5s infinite" }}>⏳</div>
          <div style={{ fontSize: "16px" }}>AI 正在优化文案...</div>
        </div>
      )}

      {result && (
        <CopyEditor
          result={result}
          title={title}
          bullets={bullets}
          description={description}
          searchTerms={searchTerms}
          onTitleChange={onTitleChange}
          onBulletsChange={onBulletsChange}
          onDescriptionChange={onDescriptionChange}
          onSearchTermsChange={onSearchTermsChange}
        />
      )}
    </section>
  );
}

interface CopyEditorProps {
  result: PipelineResult;
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

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  // 把 5 条 bullets 合并为带「1. xxx」行号的纯文本展示，编辑时按行拆回去
  const bulletsText = bullets
    .map((b, i) => `${i + 1}. ${b ?? ""}`)
    .join("\n");
  const updateBulletsFromText = (text: string) => {
    const lines = text.split("\n").slice(0, 5);
    const cleaned = lines.map(l => l.replace(/^\d+\.\s*/, "").trim());
    while (cleaned.length < 5) cleaned.push("");
    onBulletsChange(cleaned);
  };

  return (
    <>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
          <div className="badge badge-ok">成功</div>
          <div style={{ fontSize: "13px", color: "#666" }}>{result.market_name}</div>
        </div>
        <div style={{ fontSize: "12px", color: "#999" }}>
          {result.output_file} · {result.image_count} 张图片
        </div>
      </div>

      {/* Title */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div className="section-title" style={{ margin: 0 }}>产品标题</div>
          <div style={{ display: "flex", gap: "8px" }}>
            {title && (
              <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
                onClick={() => copy(title, "title")}>
                {copied === "title" ? "已复制" : "复制"}
              </button>
            )}
          </div>
        </div>
        <textarea
          className="input"
          style={{ minHeight: "60px", fontSize: "14px", resize: "vertical", lineHeight: 1.5 }}
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
        <div style={{ marginTop: "4px", fontSize: "11px", color: title.length > 200 ? "#c62828" : "#999" }}>
          {title.length} / 200 字符
        </div>
      </div>

      {/* Bullets — 合并到单 textarea，每行一条，保留 1./2./3./4./5. 行号 */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div className="section-title" style={{ margin: 0 }}>五点描述</div>
          {bullets.some(b => (b ?? "").trim()) && (
            <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
              onClick={() => copy(bullets.filter(b => (b ?? "").trim()).join("\n"), "bullets")}>
              {copied === "bullets" ? "已复制" : "复制全部"}
            </button>
          )}
        </div>
        <textarea
          className="input"
          style={{ minHeight: "140px", fontSize: "13px", lineHeight: 1.7, resize: "vertical", fontFamily: "Menlo, Consolas, monospace" }}
          value={bulletsText}
          onChange={e => updateBulletsFromText(e.target.value)}
          placeholder={"1. xxx\n2. xxx\n3. xxx\n4. xxx\n5. xxx"}
        />
      </div>

      {/* Search Terms */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div className="section-title" style={{ margin: 0 }}>Search Terms</div>
          {searchTerms && (
            <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
              onClick={() => copy(searchTerms, "st")}>
              {copied === "st" ? "已复制" : "复制"}
            </button>
          )}
        </div>
        <textarea
          className="input"
          style={{ minHeight: "50px", fontSize: "13px", resize: "vertical" }}
          value={searchTerms}
          onChange={e => onSearchTermsChange(e.target.value)}
          placeholder="关键词用逗号分隔..."
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <div className="section-title" style={{ margin: 0 }}>产品描述</div>
          {description && (
            <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
              onClick={() => copy(description, "desc")}>
              {copied === "desc" ? "已复制" : "复制"}
            </button>
          )}
        </div>
        <textarea
          className="input"
          style={{ minHeight: "120px", fontSize: "13px", resize: "vertical", lineHeight: 1.7 }}
          value={description}
          onChange={e => onDescriptionChange(e.target.value)}
        />
      </div>

      {/* Excel 输出 */}
      <div style={{ padding: "16px", background: "#f5f5f5", border: "1px solid #e0e0e0", borderRadius: "4px", fontSize: "13px" }}>
        <div style={{ fontWeight: 500, marginBottom: "6px" }}>输出文件</div>
        <div style={{ color: "#666" }}>{result.output_file}</div>
        <div style={{ color: "#999", fontSize: "12px", marginTop: "4px" }}>
          保存在 F:\AI Projects\GIGAB2B\
        </div>
      </div>
    </>
  );
}
