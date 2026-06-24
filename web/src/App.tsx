import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { ProductPreview, PipelineResult, ServerStatus, MarketInfo } from "./types";

// ── Shared styles ──────────────────────────────────────────────

const S = {
  root: { minHeight: "100vh", background: "#ffffff" } as React.CSSProperties,
  header: {
    padding: "28px 48px",
    borderBottom: "1px solid #eee",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,
  headerTitle: { fontSize: "22px", fontWeight: 300, letterSpacing: "-0.3px" } as React.CSSProperties,
  main: { display: "grid", gridTemplateColumns: "320px 1fr", minHeight: "calc(100vh - 77px)" } as React.CSSProperties,
  colLeft: { padding: "32px", borderRight: "1px solid #eee", overflowY: "auto" as const, maxHeight: "calc(100vh - 77px)" } as React.CSSProperties,
  colRight: { padding: "32px", overflowY: "auto" as const, maxHeight: "calc(100vh - 77px)" } as React.CSSProperties,
};

// ── StatusBar ─────────────────────────────────────────────────

function StatusBar({ status }: { status: ServerStatus | null }) {
  const [showModal, setShowModal] = useState(false);

  if (!status) return null;

  const studio = status.image_studio;
  const gigaMarkets = Object.entries(status.giga_markets).filter(([, v]) => v);

  const studioOk = studio.ok;
  const minimaxOk = studio.providers?.minimax === "configured";
  const laozhangOk = studio.providers?.laozhang === "configured";

  return (
    <>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "#999" }}>系统状态：</span>

        <span className={`badge ${studioOk ? "badge-ok" : "badge-error"}`}>
          {studioOk ? "image-studio " : "image-studio离线"}
        </span>

        <span className={`badge ${minimaxOk ? "badge-ok" : "badge-warn"}`}>
          MiniMax {minimaxOk ? "OK" : "未配置"}
        </span>

        <span className={`badge ${laozhangOk ? "badge-ok" : "badge-warn"}`}>
          laozhang {laozhangOk ? "OK" : "未配置"}
        </span>

        {gigaMarkets.length > 0 && (
          <span className="badge badge-ok">
            GIGA {gigaMarkets.length} 市场
          </span>
        )}

        <button
          onClick={() => setShowModal(true)}
          style={{ background: "none", border: "none", fontSize: "12px", color: "#999", cursor: "pointer", padding: "4px 8px", textDecoration: "underline" }}
        >
          详情
        </button>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setShowModal(false)}>
          <div style={{ background: "#fff", padding: "40px", width: "100%", maxWidth: "520px", borderRadius: "4px" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "24px" }}>系统状态详情</h3>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>image-studio Server</div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                {studio.ok
                  ? `已连接 · MiniMax: ${studio.providers?.minimax} · laozhang: ${studio.providers?.laozhang}`
                  : "未运行。请先启动 start_studio.bat（位于 image-studio 目录）"}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>GIGA 凭证</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {Object.entries(status.giga_markets).map(([market, ok]) => (
                  <div key={market} style={{ fontSize: "13px" }}>
                    <span style={{ color: ok ? "#2e7d32" : "#c62828" }}>{ok ? "OK" : "缺失"}</span>
                    {" · "}
                    {market}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#999" }}>
                凭证路径：F:\AI Projects\GIGAB2B\.env
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>API Keys</div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                MiniMax: {minimaxOk ? "已配置" : "请在 .env 中设置 MINIMAX_API_KEY"}<br/>
                laozhang: {laozhangOk ? "已配置" : "请在 .env 中设置 LAOZHANG_API_KEY"}
              </div>
            </div>

            <div style={{ fontSize: "12px", color: "#999", padding: "12px", background: "#f9f9f9", border: "1px solid #eee", borderRadius: "4px" }}>
              提示：API Keys 存储在 .env 文件中，由 Flask 后端读取，不暴露给浏览器。
            </div>

            <button className="btn-secondary" style={{ marginTop: "24px", width: "100%" }} onClick={() => setShowModal(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── LeftPanel ─────────────────────────────────────────────────

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
  result: PipelineResult | null;
}

function LeftPanel({ selectedMarket, onMarketChange, markets, sku, onSkuChange, templateFile, onTemplateUpload, onRun, isRunning, steps, error, result }: LeftPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const stepLabels: Record<string, string> = {
    fetch: "1. GIGA 取数",
    ai_copy: "2. AI 文案生成",
    fill: "3. 填入 Excel",
  };

  const marketList = Object.entries(markets);

  return (
    <section style={S.colLeft}>
      {/* 市场选择 */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">目标市场</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {marketList.map(([key, info]) => (
            <label key={key} style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "11px 14px",
              border: `1px solid ${selectedMarket === key ? "#000" : "#e0e0e0"}`,
              background: selectedMarket === key ? "#f5f5f5" : "#fff",
              cursor: "pointer",
              fontSize: "14px",
              transition: "all 0.15s",
            }}>
              <input type="radio" name="market" value={key} checked={selectedMarket === key}
                onChange={() => onMarketChange(key)} style={{ accentColor: "#000" }} />
              <span style={{ flex: 1 }}>{info.name}</span>
              <span className={`badge ${info.has_creds ? "badge-ok" : "badge-error"}`}>
                {info.has_creds ? "OK" : "无凭证"}
              </span>
            </label>
          ))}
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

      {/* 模板上传 */}
      <div style={{ marginBottom: "28px" }}>
        <div className="section-title">Amazon 模板</div>
        <div
          style={{ border: "1px dashed #e0e0e0", padding: "24px", textAlign: "center" as const, cursor: "pointer", background: "#fafafa" }}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".xlsm,.xlsx" style={{ display: "none" }}
            onChange={e => { if (e.target.files?.[0]) onTemplateUpload(e.target.files[0]); }} />
          <div style={{ fontSize: "14px", color: "#666" }}>
            {templateFile
              ? `已上传: ${templateFile}`
              : "点击上传 Amazon 模板文件（.xlsm / .xlsx）\n系统将自动检测目标市场"
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
          <div className="section-title">处理进度</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {steps.map((s, i) => {
              const isError = s.status === "error";
              const isOk    = s.status === "ok";
              const icon    = isError ? "✕" : isOk ? "✓" : "○";
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                  <span style={{ color: isError ? "#c62828" : isOk ? "#2e7d32" : "#999" }}>{icon}</span>
                  <span style={{ color: isError ? "#c62828" : "#333" }}>
                    {stepLabels[s.step] || s.step}
                  </span>
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

// ── RightPanel ────────────────────────────────────────────────

interface RightPanelProps {
  result: PipelineResult | null;
  isRunning: boolean;
}

function RightPanel({ result, isRunning }: RightPanelProps) {
  const [editingTitle, setEditingTitle] = useState("");
  const [editingBullets, setEditingBullets] = useState<string[]>([]);
  const [editingDesc, setEditingDesc] = useState("");
  const [editingST, setEditingST] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (result) {
      setEditingTitle(result.ai_title || "");
      setEditingBullets(result.ai_bullets || []);
      setEditingDesc(result.ai_description || "");
      setEditingST(result.ai_search_terms || "");
    }
  }, [result]);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  const updateBullet = (idx: number, val: string) => {
    const next = [...editingBullets];
    next[idx] = val;
    setEditingBullets(next);
  };

  return (
    <section style={S.colRight}>
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
                {editingTitle && (
                  <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
                    onClick={() => copy(editingTitle, "title")}>
                    {copied === "title" ? "已复制" : "复制"}
                  </button>
                )}
              </div>
            </div>
            <textarea
              className="input"
              style={{ minHeight: "60px", fontSize: "14px", resize: "vertical" as const, lineHeight: 1.5 }}
              value={editingTitle}
              onChange={e => setEditingTitle(e.target.value)}
            />
            <div style={{ marginTop: "4px", fontSize: "11px", color: editingTitle.length > 200 ? "#c62828" : "#999" }}>
              {editingTitle.length} / 200 字符
            </div>
          </div>

          {/* Bullets */}
          <div style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div className="section-title" style={{ margin: 0 }}>五点描述</div>
              {editingBullets.length > 0 && (
                <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
                  onClick={() => copy(editingBullets.join("\n\n"), "bullets")}>
                  {copied === "bullets" ? "已复制" : "复制全部"}
                </button>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {editingBullets.map((b, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <div style={{ width: "20px", height: "20px", background: "#000", color: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", flexShrink: 0, marginTop: "11px" }}>{i + 1}</div>
                  <textarea
                    className="input"
                    style={{ minHeight: "50px", fontSize: "13px", lineHeight: 1.5 }}
                    value={b}
                    onChange={e => updateBullet(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Search Terms */}
          <div style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div className="section-title" style={{ margin: 0 }}>Search Terms</div>
              {editingST && (
                <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
                  onClick={() => copy(editingST, "st")}>
                  {copied === "st" ? "已复制" : "复制"}
                </button>
              )}
            </div>
            <textarea
              className="input"
              style={{ minHeight: "50px", fontSize: "13px", resize: "vertical" as const }}
              value={editingST}
              onChange={e => setEditingST(e.target.value)}
              placeholder="关键词用逗号分隔..."
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <div className="section-title" style={{ margin: 0 }}>产品描述</div>
              {editingDesc && (
                <button className="btn-secondary" style={{ padding: "6px 14px", fontSize: "12px" }}
                  onClick={() => copy(editingDesc, "desc")}>
                  {copied === "desc" ? "已复制" : "复制"}
                </button>
              )}
            </div>
            <textarea
              className="input"
              style={{ minHeight: "120px", fontSize: "13px", resize: "vertical" as const, lineHeight: 1.7 }}
              value={editingDesc}
              onChange={e => setEditingDesc(e.target.value)}
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
      )}
    </section>
  );
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [markets, setMarkets] = useState<Record<string, MarketInfo>>({});
  const [selectedMarket, setSelectedMarket] = useState("DE_TAX");
  const [sku, setSku] = useState("");
  const [templateFile, setTemplateFile] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<Array<{ step: string; status: string; [k: string]: unknown }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);

  useEffect(() => {
    api.getStatus().then(setServerStatus).catch(() => {});
    api.listMarkets().then(setMarkets).catch(() => {});
  }, []);

  const handleMarketChange = async (m: string) => {
    setSelectedMarket(m);
    setResult(null);
    setSteps([]);
    setError(null);
  };

  const handleTemplateUpload = async (file: File) => {
    try {
      const res = await api.uploadTemplate(file);
      setTemplateFile(res.filename);
      if (res.detected_market) {
        setSelectedMarket(res.detected_market);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleRun = async () => {
    if (!sku.trim()) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    setSteps([]);

    try {
      const res = await api.runPipeline(sku.trim(), selectedMarket, templateFile || undefined);
      setSteps(res.steps);
      if (res.success) {
        setResult(res.result);
      } else {
        setError("流水线执行失败");
      }
    } catch (e) {
      setError(String(e));
      setSteps([]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.headerTitle}>
          GIGAB2B <span style={{ fontSize: "13px", color: "#999", fontWeight: 400, marginLeft: "8px" }}>Listing Optimizer</span>
        </div>
        <StatusBar status={serverStatus} />
      </header>

      <main style={S.main}>
        <LeftPanel
          selectedMarket={selectedMarket}
          onMarketChange={handleMarketChange}
          markets={markets}
          sku={sku}
          onSkuChange={v => { setSku(v); setResult(null); setSteps([]); setError(null); }}
          templateFile={templateFile}
          onTemplateUpload={handleTemplateUpload}
          onRun={handleRun}
          isRunning={isRunning}
          steps={steps}
          error={error}
          result={result}
        />
        <RightPanel result={result} isRunning={isRunning} />
      </main>
    </div>
  );
}
