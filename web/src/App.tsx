import { useState, useEffect, useRef } from "react";
import { api } from "./api";
import type { PipelineResult, ServerStatus, MarketInfo, FetchedProduct } from "./types";
import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { CenterPanel } from "./components/CenterPanel";
import { ReferenceImages } from "./components/ReferenceImages";
import { PromptForm, type ImageType } from "./components/PromptForm";
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
  headerTitle: { fontSize: "22px", fontWeight: 300, letterSpacing: "-0.3px", display: "flex", alignItems: "baseline", gap: "10px" } as React.CSSProperties,
  // 原型规定三栏:320px 固定 + 中/右等分剩余 (1fr 1fr)
  main: { display: "grid", gridTemplateColumns: "320px 1fr 1fr", minHeight: "calc(100vh - 77px)" } as React.CSSProperties,
  // 右栏:整体不滚动,内部 3 段各自管自己。生成按钮 + 图片类型 + 尺寸必须直接可见,不被滚动条遮挡
  colRight: { padding: "20px", borderLeft: "1px solid #eee", height: "calc(100vh - 77px)", display: "flex", flexDirection: "column", overflow: "hidden" } as React.CSSProperties,
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

  // 抓取数据 → 文案优化 两段式流水线 (v5)
  const [fetchedProduct, setFetchedProduct] = useState<FetchedProduct | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // AI 生图状态
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [uploadedDataUrls, setUploadedDataUrls] = useState<string[]>([]);
  const [imageType, setImageType] = useState<ImageType["type"]>("main");
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

  // 优化输入(v4 新增,提交 run-pipeline 时带上)
  const [copyPromptExtra, setCopyPromptExtra] = useState("");
  const [keywordsList, setKeywordsList] = useState<string[]>([]);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [keywordsBusy, setKeywordsBusy] = useState(false);

  // 流水线 AbortController：用于切换市场/重跑时取消正在进行的 SSE（致命 F-6 修复）
  const pipelineAbortRef = useRef<AbortController | null>(null);
  // 抓取数据按钮的 AbortController（与 AI 流式分两套，避免互相干扰）
  const fetchAbortRef = useRef<AbortController | null>(null);
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
      fetchAbortRef.current?.abort();
      ctrl.abort();
    };
  }, []);

  const handleMarketChange = (m: string) => {
    setSelectedMarket(m);
    setResult(null);
    setSteps([]);
    setError(null);
    setSelectedIndices(new Set());
    // 切市场时清空抓取结果,避免上一 SKU 的原始残留
    setFetchedProduct(null);
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

  // 关键词文件上传解析(降级:失败仅警告,不阻塞流水线)
  // 多次上传是**追加**(去重),不是覆盖 — 用户常分多个文件给关键词,覆盖会让前一份丢失
  const handleKeywordsUpload = async (file: File) => {
    setKeywordsBusy(true);
    setKeywordsError(null);
    try {
      const res = await api.parseKeywords(file);
      setKeywordsList((prev) => {
        const merged = [...prev, ...(res.keywords || [])];
        // 按 lowercase 去重,保留第一次出现的形态
        const seen = new Set<string>();
        const out: string[] = [];
        for (const k of merged) {
          const key = k.toLowerCase();
          if (!seen.has(key)) { seen.add(key); out.push(k); }
        }
        return out;
      });
    } catch (e) {
      setKeywordsError(String(e instanceof Error ? e.message : e));
    } finally {
      setKeywordsBusy(false);
    }
  };

  const handleFetch = async () => {
    if (!sku.trim()) return;
    // 取消上一次还在跑的抓取
    fetchAbortRef.current?.abort();
    const ctrl = new AbortController();
    fetchAbortRef.current = ctrl;

    setIsFetching(true);
    setError(null);
    // 不清空 fetchedProduct:让用户能看到前一次的抓取结果作底
    // 但清掉旧的 result(AI 部分)和 steps(进度),让 UI 干净
    // generatedImages 不清空:换产品时保留已生成的图片(用户可对比不同产品的图)
    setResult(null);
    setSteps([{ step: "fetch", status: "running" }]);

    try {
      const res = await api.fetchProduct(sku.trim(), selectedMarket, ctrl.signal);
      if (!mountedRef.current || ctrl.signal.aborted) return;
      setFetchedProduct(res);
      // 把 running 步骤标记为 ok
      setSteps((prev) => prev.map(s =>
        s.step === "fetch" && s.status === "running"
          ? { ...s, status: "ok", product_name: (res.product_name || "").slice(0, 80) }
          : s
      ));
    } catch (e) {
      if (ctrl.signal.aborted) {
        // 用户主动取消/被新一轮 fetch 顶替:把 running 步骤清掉,避免 UI 永远转圈
        setSteps((prev) => prev.filter(s => !(s.step === "fetch" && s.status === "running")));
      } else if (mountedRef.current) {
        setSteps((prev) => prev.map(s =>
          s.step === "fetch" && s.status === "running"
            ? { ...s, status: "error", message: String(e) }
            : s
        ));
        setError(String(e));
      }
    } finally {
      if (mountedRef.current) setIsFetching(false);
      if (fetchAbortRef.current === ctrl) fetchAbortRef.current = null;
    }
  };

  const handleOptimize = async () => {
    if (!sku.trim()) return;
    // 必须先有 fetchedProduct,否则拒绝执行(由按钮 disabled 守住,这里再兜底一次)
    if (!fetchedProduct) {
      setError("请先点击「抓取数据」,再点「文案优化」。");
      return;
    }
    // 取消上一次还在跑的流水线（致命 F-6 修复）
    pipelineAbortRef.current?.abort();
    const ctrl = new AbortController();
    pipelineAbortRef.current = ctrl;

    setIsRunning(true);
    setIsOptimizing(true);
    setError(null);
    setResult(null);
    // 清空受控文案副本,防止 SSE done 事件覆盖用户中途编辑(B1 修复)
    setCopyTitle("");
    setCopyBullets([]);
    setCopyDescription("");
    setCopySearchTerms("");
    // 重置 steps:之前 fetch 的 ok 行不要保留,避免和新的 ai_copy 行重复显示
    // (fetchedProduct 已经在 state 里,compare-block 上半部分继续显示原始侧)
    // generatedImages 不清空:用户重跑优化时保留之前生成的图片(可对比多次结果)
    setSteps([{ step: "ai_copy", status: "running" }]);

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
          // 实时把已完成步骤累加到 steps（同名 step 替换,不重复追加 — 修 "1.GIGA 取数 出现两次" 等 bug）
          if (evt.type === "step") {
            const incoming = evt as { step: string; status: string; [k: string]: unknown };
            setSteps((prev) => {
              // 同名 step 只保留最新一条,后续 status=running/ok/skipped/error 直接替换
              const filtered = prev.filter((s) => s.step !== incoming.step);
              return [...filtered, incoming as unknown as { step: string; status: string }];
            });
          }
        },
        ctrl.signal,
        { prompt_extra: copyPromptExtra, keywords: keywordsList },
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
      if (mountedRef.current) {
        setIsRunning(false);
        setIsOptimizing(false);
      }
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
          // 累积保存：每次生成的图都追加到数组(用户可以多角度对比同 slot 的多次生成)
          // 之前是"同 slot 替换旧的",会丢历史;后端 outputs/ 磁盘其实已经永久保存了,
          // 前端只是不显示而已 — 现在让前端也保留历史
          return [
            ...prev,
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

  // 单张删除 — 后端文件保留在 outputs/(不动磁盘),只从前端列表里移除
  const handleDeleteGenerated = (img: GeneratedImage) => {
    setGeneratedImages(prev => prev.filter(g => g !== img));
  };

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.headerTitle}>
          <span style={{ fontSize: "22px", fontWeight: 300, color: "#333" }}>Listing Creator &amp; Optimizer</span>
          <span style={{ fontSize: "14px", fontWeight: 400, color: "#999" }}>for GIGAB2B</span>
        </div>
        <Header status={serverStatus} />
      </header>

      <main style={S.main}>
        <LeftPanel
          selectedMarket={selectedMarket}
          onMarketChange={handleMarketChange}
          markets={markets}
          sku={sku}
          onSkuChange={v => {
            setSku(v);
            setResult(null);
            setSteps([]);
            setError(null);
            // 换 SKU 时清空关键词 — 不同产品的关键词不能混(否则 AI 会因为产品/关键词不匹配而拒答)
            setKeywordsList([]);
            setKeywordsError(null);
            // 取消可能正在飞的抓取,防止旧 SKU 的 fetch 后到达覆盖新 SKU state(B2 修复)
            fetchAbortRef.current?.abort();
            setIsFetching(false);
            // fetchedProduct 不清:用户可能只是微调 SKU,保留上次抓取结果作底;handleFetch 自己会覆盖
          }}
          templateFile={templateFile}
          onTemplateUpload={handleTemplateUpload}
          onFetch={handleFetch}
          onOptimize={handleOptimize}
          isFetching={isFetching}
          isOptimizing={isOptimizing}
          isRunning={isRunning}
          fetchedProduct={fetchedProduct}
          steps={steps}
          error={error}
          copyPromptExtra={copyPromptExtra}
          onCopyPromptExtraChange={setCopyPromptExtra}
          keywordsList={keywordsList}
          keywordsBusy={keywordsBusy}
          keywordsError={keywordsError}
          onKeywordsUpload={handleKeywordsUpload}
          onClearKeywords={() => { setKeywordsList([]); setKeywordsError(null); }}
        />
        <CenterPanel
          result={result}
          isRunning={isRunning}
          isFetching={isFetching}
          isOptimizing={isOptimizing}
          fetchedProduct={fetchedProduct}
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
          {(result || fetchedProduct) ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              {/* 上:参考图 — 最多占 45% 高度,超出可滚动,确保下方生成结果区始终有空间 */}
              <section style={{ ...S.colRightSection, flex: "1 1 45%", minHeight: 0, overflowY: "auto" }}>
                <ReferenceImages
                  sku={result?.sku || fetchedProduct?.sku || ""}
                  market={selectedMarket}
                  imageUrls={result?.imageUrls || fetchedProduct?.imageUrls || []}
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

              {/* 中:表单 — 不滚动,生成按钮始终可见 */}
              <section style={{ ...S.colRightSection, flex: "0 0 auto", marginTop: "8px" }}>
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

              {/* 下:生成结果 — 占满剩余空间,默认至少 50% 高度,保证图片可见 */}
              <section style={{ flex: "1 1 55%", minHeight: 200, overflowY: "auto" }}>
                <GeneratedGallery images={generatedImages} onClear={clearGenerated} onDelete={handleDeleteGenerated} />
              </section>
            </div>
          ) : (
            <div style={{ fontSize: "12px", color: "#999", padding: "12px", background: "#fafafa", border: "1px dashed #e0e0e0", borderRadius: "4px", textAlign: "center" }}>
              请先抓取产品数据
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}