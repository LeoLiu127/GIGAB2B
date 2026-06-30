import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { PipelineResult, ServerStatus, MarketInfo } from "./types";
import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { CenterPanel } from "./components/CenterPanel";
import { ReferenceImages } from "./components/ReferenceImages";
import { PromptForm } from "./components/PromptForm";
import { GeneratedGallery, type GeneratedImage } from "./components/GeneratedGallery";

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
  main: { display: "grid", gridTemplateColumns: "320px 1fr 2fr", minHeight: "calc(100vh - 77px)" } as React.CSSProperties,
  colRight: { padding: "20px", borderLeft: "1px solid #eee", overflowY: "auto", maxHeight: "calc(100vh - 77px)", display: "flex", flexDirection: "column" } as React.CSSProperties,
  colRightSection: { paddingBottom: "16px", borderBottom: "1px solid #f0f0f0" } as React.CSSProperties,
};

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

  // AI 生图状态
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [uploadedDataUrls, setUploadedDataUrls] = useState<string[]>([]);
  const [imageType, setImageType] = useState<"main" | "detail">("main");
  const [size, setSize] = useState<string>("1600x1600");
  const [promptExtra, setPromptExtra] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [genError, setGenError] = useState<string | null>(null);

  // 中间栏文案（受控）— 用于生图 prompt 拼接
  const [copyTitle, setCopyTitle] = useState("");
  const [copyBullets, setCopyBullets] = useState<string[]>([]);
  const [copyDescription, setCopyDescription] = useState("");
  const [copySearchTerms, setCopySearchTerms] = useState("");

  // 流水线 AbortController：用于切换市场/重跑时取消正在进行的 SSE（致命 F-6 修复）
  const pipelineAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // 启动时拉取状态
    const ctrl = new AbortController();
    api.getStatus({ signal: ctrl.signal }).then(setServerStatus).catch(() => {});
    api.listMarkets({ signal: ctrl.signal }).then(setMarkets).catch(() => {});
    // 组件卸载时:取消所有进行中的请求 + 标记未挂载
    return () => {
      mountedRef.current = false;
      pipelineAbortRef.current?.abort();
      ctrl.abort();
    };
  }, []);

  const handleMarketChange = (m: string) => {
    setSelectedMarket(m);
    setResult(null);
    setSteps([]);
    setError(null);
    setSelectedIndices(new Set());
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
    // 取消上一次还在跑的流水线（致命 F-6 修复）
    pipelineAbortRef.current?.abort();
    const ctrl = new AbortController();
    pipelineAbortRef.current = ctrl;

    setIsRunning(true);
    setError(null);
    setResult(null);
    setSteps([]);
    setGeneratedImages([]);

    try {
      // SSE：每完成一步 onEvent 推送一条 step 事件，进度实时更新
      const res = await api.runPipeline(
        sku.trim(),
        selectedMarket,
        templateFile || undefined,
        "use_giga",
        (evt) => {
          // 已被取消就不更新 UI,避免 ghost update
          if (!mountedRef.current || ctrl.signal.aborted) return;
          // 实时把已完成步骤累加到 steps（running 表示进行中 — 替换前一条 running 为 ok）
          if (evt.type === "step") {
            const incoming = evt as { step: string; status: string };
            setSteps((prev) => {
              // 把最近一条同名 step=step 且 status=running 的标记为 ok，再追加新的
              if (incoming.status === "ok") {
                return [...prev.map((s) => s.step === incoming.step && s.status === "running" ? { ...s, status: "ok" } : s)];
              }
              return [...prev, incoming as unknown as { step: string; status: string }];
            });
          }
        },
        ctrl.signal,
      );
      // res 是 done 事件
      // 收尾：把最后一条 running 标 ok（放到 finally 里也行,但此处更直观）
      setSteps((prev) => {
        const next = [...prev];
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].status === "running") { next[i] = { ...next[i], status: "ok" }; break; }
        }
        return next;
      });
      const result = (res as { result: import("./types").PipelineResult }).result;
      setResult(result);
      // 把新生成结果的文案同步到受控 state（CenterPanel 立即展示）
      setCopyTitle(result.ai_title || "");
      setCopyBullets(result.ai_bullets || []);
      setCopyDescription(result.ai_description || "");
      setCopySearchTerms(result.ai_search_terms || "");
    } catch (e) {
      // 主动取消(切换市场/重跑/卸载)时,不要当成错误
      if (ctrl.signal.aborted) {
        // 静默,不写 error 框
      } else if (mountedRef.current) {
        // 收尾:把最后一条 running 标 error(严重 S-6 修复)
        setSteps((prev) => {
          const next = [...prev];
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].status === "running") {
              next[i] = { ...next[i], status: "error", message: String(e) };
              break;
            }
          }
          return next;
        });
        setError(String(e));
      }
    } finally {
      if (mountedRef.current) setIsRunning(false);
      if (pipelineAbortRef.current === ctrl) pipelineAbortRef.current = null;
    }
  };

  const toggleRef = (index: number) => {
    setSelectedIndices(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const selectAllRef = () => {
    if (!result) return;
    const all = new Set<number>();
    (result.imageUrls || []).slice(0, 9).forEach((_, i) => all.add(i));
    setSelectedIndices(all);
  };

  const clearAllRef = () => setSelectedIndices(new Set());

  const addUploaded = (dataUrl: string) => {
    setUploadedDataUrls(prev => [...prev, dataUrl]);
  };

  const canGenerate = !!result && (selectedIndices.size > 0 || uploadedDataUrls.length > 0);

  const handleGenerate = async () => {
    if (!result || !canGenerate) return;
    setGenerating(true);
    setGenError(null);
    try {
      const reference_images: Array<
        { source: "giga"; index: number; url: string } | { source: "upload"; data_url: string }
      > = [];
      const sortedSelected = Array.from(selectedIndices).sort((a, b) => a - b);
      sortedSelected.forEach(i => {
        const url = (result.imageUrls || [])[i];
        if (url) reference_images.push({ source: "giga", index: i, url });
      });
      uploadedDataUrls.forEach(du => reference_images.push({ source: "upload", data_url: du }));

      const attrs = result.attributes || {};
      const product = {
        productName: result.product_name || "",
        mainColor: result.mainColor || attrs["Main Color"] || attrs["Color"] || "",
        mainMaterial: result.mainMaterial || attrs["Material"] || "",
        texture: result.texture || attrs["Texture"] || "",
        size: result.size || attrs["Size"] || attrs["Dimensions"] || "",
      };

      const res = await api.generateImage({
        slot: imageType,
        sku: result.sku,
        size,
        prompt_extra: promptExtra,
        reference_images,
        product,
        copy: {
          title: copyTitle,
          bullets: copyBullets,
          description: copyDescription,
          search_terms: copySearchTerms,
        },
      });

      if (res.success) {
        setGeneratedImages(prev => {
          // 同 slot 替换旧的；不同 slot 追加
          const filtered = prev.filter(g => g.slot !== res.slot);
          return [
            ...filtered,
            {
              slot: res.slot,
              image_url: res.image_url,
              filename: res.filename,
              size: res.size,
              generatedAt: Date.now(),
            },
          ];
        });
      } else {
        setGenError("生成失败");
      }
    } catch (e) {
      setGenError(String(e));
    } finally {
      setGenerating(false);
    }
  };

  const clearGenerated = () => setGeneratedImages([]);

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.headerTitle}>
          GIGAB2B <span style={{ fontSize: "13px", color: "#999", fontWeight: 400, marginLeft: "8px" }}>Listing Optimizer</span>
        </div>
        <Header status={serverStatus} />
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
        />
        <CenterPanel
          result={result}
          isRunning={isRunning}
          title={copyTitle}
          bullets={copyBullets}
          description={copyDescription}
          searchTerms={copySearchTerms}
          onTitleChange={setCopyTitle}
          onBulletsChange={setCopyBullets}
          onDescriptionChange={setCopyDescription}
          onSearchTermsChange={setCopySearchTerms}
        />
        <aside style={S.colRight}>
          {!result ? (
            <div style={{ fontSize: "12px", color: "#999", padding: "12px", background: "#fafafa", border: "1px dashed #e0e0e0", borderRadius: "4px", textAlign: "center" }}>
              跑完流水线后可在此生成 AI 图片
            </div>
          ) : (
            <>
              {/* 上 1/4：参考图（更窄，给结果区让出空间） */}
              <section style={{ ...S.colRightSection, flex: "0 1 25%", minHeight: 0, overflowY: "auto" }}>
                <ReferenceImages
                  sku={result.sku}
                  market={selectedMarket}
                  imageUrls={result.imageUrls || []}
                  selectedIndices={selectedIndices}
                  onToggle={toggleRef}
                  onUploadedAdd={addUploaded}
                  onSelectAll={selectAllRef}
                  onClearAll={clearAllRef}
                />

                {uploadedDataUrls.length > 0 && (
                  <div style={{ marginBottom: "8px", padding: "8px", background: "#f0f7ff", border: "1px solid #cfe2ff", borderRadius: "4px" }}>
                    <div style={{ fontSize: "11px", color: "#1565c0", marginBottom: "6px" }}>本地上传 ({uploadedDataUrls.length})</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
                      {uploadedDataUrls.map((du, i) => (
                        <div key={i} style={{ position: "relative", aspectRatio: "1/1", overflow: "hidden", borderRadius: "3px" }}>
                          <img src={du} alt={`uploaded ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button
                            onClick={() => setUploadedDataUrls(prev => prev.filter((_, j) => j !== i))}
                            style={{ position: "absolute", top: "2px", right: "2px", background: "rgba(198,40,40,0.85)", color: "#fff", border: "none", borderRadius: "2px", fontSize: "10px", cursor: "pointer", padding: "0 4px" }}
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* 中 1/4：表单（中等高度） */}
              <section style={{ ...S.colRightSection, flex: "0 1 25%", minHeight: 0, overflowY: "auto" }}>
                <PromptForm
                  imageType={imageType}
                  onImageTypeChange={setImageType}
                  size={size}
                  onSizeChange={setSize}
                  promptExtra={promptExtra}
                  onPromptExtraChange={setPromptExtra}
                  onGenerate={handleGenerate}
                  generating={generating}
                  canGenerate={canGenerate}
                  selectedCount={selectedIndices.size}
                  uploadedCount={uploadedDataUrls.length}
                />

                {genError && (
                  <div style={{ marginTop: "8px", padding: "10px 12px", background: "#ffebee", border: "1px solid #ffcdd2", borderRadius: "4px", fontSize: "12px", color: "#c62828" }}>
                    ✕ {genError}
                  </div>
                )}
              </section>

              {/* 下 1/2：生成结果（最大，给大图预留空间） */}
              <section style={{ flex: "1 1 50%", minHeight: 0, overflowY: "auto" }}>
                <GeneratedGallery images={generatedImages} onClear={clearGenerated} />
              </section>
            </>
          )}
        </aside>
      </main>
    </div>
  );
}