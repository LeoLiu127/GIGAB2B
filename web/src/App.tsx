import { useState, useEffect, useRef } from "react";
import { canGenerateFromReferences, REFERENCE_IMAGE_LIMITS, resolveOptimizeSku, resolveStartupView, templateAfterMarketChange } from "./workflow";
import { api } from "./api";
import type { PipelineResult, ServerStatus, MarketInfo, FetchedProduct, ListingFetchedProduct, VariantView } from "./types";
import { Header } from "./components/Header";
import { LeftPanel } from "./components/LeftPanel";
import { CenterPanel } from "./components/CenterPanel";
import { ReferenceImages } from "./components/ReferenceImages";
import { PromptForm, type ImageType } from "./components/PromptForm";
import { GeneratedGallery, type GeneratedImage } from "./components/GeneratedGallery";
import { readStoredTheme, THEME_TOKENS, writeStoredTheme, type ThemeId } from "./theme";

const S = {
  root: { minHeight: "100vh", background: "var(--theme-page-bg)", color: "var(--theme-text-primary)" } as React.CSSProperties,
  header: {
    padding: "28px 48px",
    borderBottom: "1px solid var(--theme-border-soft)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } as React.CSSProperties,
  headerTitle: { fontSize: "22px", fontWeight: 300, letterSpacing: "-0.3px", display: "flex", alignItems: "baseline", gap: "10px" } as React.CSSProperties,
  // 原型规定三栏:320px 固定 + 中/右等分剩余 (1fr 1fr)
  main: { display: "grid", gridTemplateColumns: "320px 1fr 1fr", minHeight: "calc(100vh - 77px)" } as React.CSSProperties,
  // 右栏:整体不滚动,内部 3 段各自管自己。生成按钮 + 图片类型 + 尺寸必须直接可见,不被滚动条遮挡
  colRight: { padding: "20px", borderLeft: "1px solid var(--theme-border-soft)", height: "calc(100vh - 77px)", display: "flex", flexDirection: "column", overflow: "hidden" } as React.CSSProperties,
  colRightSection: { paddingBottom: "16px", borderBottom: "1px solid var(--theme-border-soft)" } as React.CSSProperties,
};

export default function App() {
  const [authState, setAuthState] = useState<{ required: boolean; authenticated: boolean } | null>(null);
  const [accessPassword, setAccessPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => readStoredTheme());
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

  // v6:listing 多 variant 支持 — 整 listing 拉数 + 用户选 variant
  const [listing, setListing] = useState<ListingFetchedProduct | null>(null);
  const [activeVariantSku, setActiveVariantSku] = useState<string>("");
  const [includeVariants, setIncludeVariants] = useState<boolean>(true);

  // Round2 fix Bug 3:派生"是否共用同一标题" — listing 多 variant 且所有 product_name 相同时为 true
  const listingVariants = listing?.variants ?? [];
  const allVariantNamesEqual =
    listingVariants.length > 1 &&
    listingVariants.every(v => v.product_name === listingVariants[0].product_name);
  const sharedTitleCount = listingVariants.length;

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

  // 2026-07-08 streaming SSE 实时回显:服务端 ai_copy_chunk 事件累积到这两个 state
  // aiCopyChunkText 仅保留末尾 500 字符(防长篇 OOM),aiCopyChunkLen 是服务端报的累计字符数
  const [aiCopyChunkText, setAiCopyChunkText] = useState("");
  const [aiCopyChunkLen, setAiCopyChunkLen] = useState(0);

  // 优化输入(v4 新增,提交 run-pipeline 时带上)
  const [copyPromptExtra, setCopyPromptExtra] = useState("");
  const [keywordsList, setKeywordsList] = useState<string[]>([]);
  const [keywordsError, setKeywordsError] = useState<string | null>(null);
  const [keywordsBusy, setKeywordsBusy] = useState(false);

  // 平台选择(amazon 已上线；walmart / wayfair 仅占位,前端硬编码可见集合以保持冷启动体验)
  const [platform, setPlatform] = useState("amazon");
  const [supportedPlatforms, setSupportedPlatforms] = useState<Record<string, boolean>>({
    amazon: true, walmart: false, wayfair: false,
  });

  // 流水线 AbortController：用于切换市场/重跑时取消正在进行的 SSE（致命 F-6 修复）
  const pipelineAbortRef = useRef<AbortController | null>(null);
  // 抓取数据按钮的 AbortController（与 AI 流式分两套，避免互相干扰）
  const fetchAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    Object.entries(THEME_TOKENS[theme]).forEach(([name, value]) => root.style.setProperty(name, value));
    writeStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    mountedRef.current = true;
    // 启动时拉取状态
    const ctrl = new AbortController();
    api.getAuthStatus({ signal: ctrl.signal }).then((auth) => {
      setAuthState(auth);
      if (!auth.authenticated) return;
      api.getStatus({ signal: ctrl.signal }).then(setServerStatus).catch(() => {});
      api.listMarkets({ signal: ctrl.signal }).then(setMarkets).catch(() => {});
      api.listPlatforms({ signal: ctrl.signal })
        .then((m) => setSupportedPlatforms(m))
        .catch(() => { /* 失败则保留默认全 false */ });
    }).catch((e) => {
      if (!ctrl.signal.aborted) setAuthError(String(e));
    });
    // 组件卸载时:取消所有进行中的请求 + 标记未挂载
    return () => {
      mountedRef.current = false;
      pipelineAbortRef.current?.abort();
      fetchAbortRef.current?.abort();
      ctrl.abort();
    };
  }, []);

  const handleLogin = async () => {
    if (!accessPassword || authBusy) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      await api.login(accessPassword);
      window.location.reload();
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  // 2026-07-08 修复:切市场 / 切 SKU 时彻底清空所有产品相关 state,
  // 避免旧 SKU 的 copy / prompt / 选图 / 上传 / 生成结果渗透到新 SKU 的 AI prompt 里
  // (典型症状:用户用 A SKU 跑完流水线 + 生图,换 B SKU 直接点"生成" —
  // 老 A 的 copyTitle/Bullets 还在 memory,被作为新 B 的生图 prompt 上下文发给 laozhang,
  //  引发 laozhang 在不匹配的语义上长时间推理直到被 200s 墙挡住)。
  // 故意保留:generatedImages / keywordsList — 这两个被设计成"换产品时复用以便对比"(见 handleFetch 注释)
  const clearAllProductState = () => {
    setResult(null);
    setSteps([]);
    setError(null);
    setFetchedProduct(null);
    setListing(null);
    setActiveVariantSku("");
    setCopyTitle("");
    setCopyBullets([]);
    setCopyDescription("");
    setCopySearchTerms("");
    setCopyPromptExtra("");
    setSelectedIndices(new Set());
    setUploadedDataUrls([]);
    setPromptExtra("");
    setGenError(null);
    setAiCopyChunkText("");
    setAiCopyChunkLen(0);
    // 取消进行中的请求,防止旧 SKU 的 fetch/pipeline 后到达覆盖新 SKU state(B2/F-6)
    fetchAbortRef.current?.abort();
    pipelineAbortRef.current?.abort();
  };

  const handleMarketChange = (m: string) => {
    setTemplateFile(prev => templateAfterMarketChange(prev, selectedMarket, m));
    setSelectedMarket(m);
    clearAllProductState();
  };

  const handleTemplateUpload = async (file: File) => {
    try {
      const res = await api.uploadTemplate(file);
      if (res.detected_market && res.detected_market !== selectedMarket) {
        clearAllProductState();
        setSelectedMarket(res.detected_market);
      }
      setTemplateFile(res.filename);
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

    // v6:每次新抓取都清掉旧 listing 与 activeVariant — 不能让旧 SKU 的 variants 残留
    setListing(null);
    setActiveVariantSku("");

    try {
      // v6:主路径走 fetchListing(同时拉整 listing 的变体);失败时降级到 fetchProduct(单 SKU)
      let res: ListingFetchedProduct;
      try {
        res = await api.fetchListing(sku.trim(), selectedMarket, {
          includeVariants,
          signal: ctrl.signal,
        });
      } catch (listingErr) {
        if (ctrl.signal.aborted) throw listingErr; // 用户主动取消,不降级
        // 降级:回退到老接口,确保即使 listing 接口有问题仍能单 SKU 工作
        if (mountedRef.current) {
          console.warn("[fetch] fetchListing 失败,降级到 fetchProduct:", listingErr);
          const fallback = await api.fetchProduct(sku.trim(), selectedMarket, ctrl.signal);
          if (!mountedRef.current || ctrl.signal.aborted) return;
          // 把 fallback 包装成 ListingFetchedProduct(variants 只含主 SKU)
          const listingFallback: ListingFetchedProduct = {
            success: true,
            parent_sku: fallback.sku,
            market: fallback.market,
            variant_count: 1,
            variants: [{
              sku: fallback.sku,
              product_name: fallback.product_name,
              imageUrls: fallback.imageUrls,
              image_count: fallback.image_count,
              mainImageUrl: fallback.mainImageUrl,
              mainImageUrls: fallback.mainImageUrls,
              detailImageUrls: fallback.detailImageUrls,
              main_image_count: fallback.main_image_count,
              detail_image_count: fallback.detail_image_count,
              original_bullets: fallback.original_bullets,
              mainColor: fallback.mainColor,
              mainMaterial: fallback.mainMaterial,
              texture: fallback.texture,
              size: fallback.size,
              attributes: fallback.attributes,
              is_main: true,
              label: "主SKU",
            }],
            active_variant: {
              sku: fallback.sku,
              product_name: fallback.product_name,
              imageUrls: fallback.imageUrls,
              image_count: fallback.image_count,
              mainImageUrl: fallback.mainImageUrl,
              mainImageUrls: fallback.mainImageUrls,
              detailImageUrls: fallback.detailImageUrls,
              main_image_count: fallback.main_image_count,
              detail_image_count: fallback.detail_image_count,
              original_bullets: fallback.original_bullets,
              mainColor: fallback.mainColor,
              mainMaterial: fallback.mainMaterial,
              texture: fallback.texture,
              size: fallback.size,
              attributes: fallback.attributes,
              is_main: true,
              label: "主SKU",
            },
            sku: fallback.sku,
            product_name: fallback.product_name,
            imageUrls: fallback.imageUrls,
            image_count: fallback.image_count,
            mainImageUrl: fallback.mainImageUrl,
            mainImageUrls: fallback.mainImageUrls,
            detailImageUrls: fallback.detailImageUrls,
            main_image_count: fallback.main_image_count,
            detail_image_count: fallback.detail_image_count,
            original_bullets: fallback.original_bullets,
            mainColor: fallback.mainColor,
            mainMaterial: fallback.mainMaterial,
            texture: fallback.texture,
            size: fallback.size,
            attributes: fallback.attributes,
            combo_flag: false,
            warning: `listing 接口失败,降级为单 SKU: ${listingErr instanceof Error ? listingErr.message : String(listingErr)}`,
          };
          setListing(listingFallback);
          setActiveVariantSku(fallback.sku);
          setFetchedProduct(fallback);
          setSteps((prev) => prev.map(s =>
            s.step === "fetch" && s.status === "running"
              ? { ...s, status: "ok", product_name: (fallback.product_name || "").slice(0, 80), variant_count: 1 }
              : s
          ));
          return;
        }
        throw listingErr;
      }

      if (!mountedRef.current || ctrl.signal.aborted) return;
      setListing(res);
      setActiveVariantSku(res.active_variant.sku);

      // 把 active_variant 扁平化为 FetchedProduct(向后兼容 — CenterPanel/ReferenceImages 不用改)
      const v = res.active_variant;
      setFetchedProduct({
        success: true,
        sku: v.sku,
        market: res.market,
        product_name: v.product_name,
        original_bullets: v.original_bullets,
        imageUrls: v.imageUrls,
        image_count: v.image_count,
        mainImageUrl: v.mainImageUrl,
        mainImageUrls: v.mainImageUrls,
        detailImageUrls: v.detailImageUrls,
        main_image_count: v.main_image_count,
        detail_image_count: v.detail_image_count,
        attributes: v.attributes,
        mainColor: v.mainColor,
        mainMaterial: v.mainMaterial,
        texture: v.texture,
        size: v.size,
      });
      // 把 running 步骤标记为 ok
      setSteps((prev) => prev.map(s =>
        s.step === "fetch" && s.status === "running"
          ? { ...s, status: "ok", product_name: (res.product_name || "").slice(0, 80), variant_count: res.variant_count }
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

  // v6 + Round2:用户切换 variant — 同步 fetchedProduct 让 CenterPanel/ReferenceImages 立刻看到新 variant 的内容
  // Round2 fix:清掉旧 variant 的勾选/上传/受控文案副本,默认勾 [0] 让"生成"按钮立即可点
  const handleVariantSelect = (v: VariantView) => {
    if (!listing) return;
    setActiveVariantSku(v.sku);
    setFetchedProduct({
      success: true,
      sku: v.sku,
      market: listing.market,
      product_name: v.product_name,
      original_bullets: v.original_bullets,
      imageUrls: v.imageUrls,
      image_count: v.image_count,
      mainImageUrl: v.mainImageUrl,
      mainImageUrls: v.mainImageUrls,
      detailImageUrls: v.detailImageUrls,
      main_image_count: v.main_image_count,
      detail_image_count: v.detail_image_count,
      attributes: v.attributes,
      mainColor: v.mainColor,
      mainMaterial: v.mainMaterial,
      texture: v.texture,
      size: v.size,
    });
    // 换 variant 后旧的 AI 文案不再适用,清掉避免误导
    setResult(null);
    setSteps([]);
    setError(null);
    // 清掉旧 variant 的勾选 / 上传 / 受控文案副本 — 避免残留导致误用
    setSelectedIndices(new Set());
    setUploadedDataUrls([]);
    setCopyTitle("");
    setCopyBullets([]);
    setCopyDescription("");
    setCopySearchTerms("");
    // 默认勾选首图 — 让"生成"按钮立即可点,用户切完 chip 无需再手动勾
    // (canGenerate 里有 imageUrls.length > 0 的兜底,空图时按钮仍会 disabled)
    setSelectedIndices(new Set([0]));
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
    // 清空 streaming 实时文本(2026-07-08)
    setAiCopyChunkText("");
    setAiCopyChunkLen(0);
    // 重置 steps:之前 fetch 的 ok 行不要保留,避免和新的 ai_copy 行重复显示
    // (fetchedProduct 已经在 state 里,compare-block 上半部分继续显示原始侧)
    // generatedImages 不清空:用户重跑优化时保留之前生成的图片(可对比多次结果)
    setSteps([{ step: "ai_copy", status: "running" }]);

    try {
      // SSE：每完成一步 onEvent 推送一条 step 事件，进度实时更新
      const optimizeSku = resolveOptimizeSku(sku, fetchedProduct);
      const res = await api.runPipeline(
        optimizeSku,
        selectedMarket,
        templateFile || undefined,
        "use_giga",
        (evt) => {
          // 已被取消就不更新 UI,避免 ghost update
          if (!mountedRef.current || ctrl.signal.aborted) return;
          // 2026-07-08 streaming:服务端每个 AI token chunk 推一条 ai_copy_chunk 事件
          // 累积末尾 500 字符(防长篇 OOM),字符数走服务端报的值
          if (evt.type === "ai_copy_chunk") {
            const { delta, accumulated_len } = evt as { delta: string; accumulated_len: number };
            setAiCopyChunkText((prev) => (prev + delta).slice(-500));
            setAiCopyChunkLen(accumulated_len);
            return;
          }
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
        { prompt_extra: copyPromptExtra, keywords: keywordsList, platform },
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
        // streaming 文本保留以方便用户查看最后一段输出;切 SKU/市场时由 clearAllProductState 清
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

  // Round2 fix Bug 1:生成阶段数据源 — 有 AI result 时用 result;没跑过 AI 但有抓取数据时,
  // 用 fetchedProduct 在内存里桥接一个 stub PipelineResult。这样切 variant 后无需先跑 AI 就能生成图。
  const generateSource: PipelineResult | null = result ?? (fetchedProduct ? {
    sku: fetchedProduct.sku,
    market: fetchedProduct.market,
    market_name: fetchedProduct.market,
    ai_title: "", ai_bullets: [], ai_description: "", ai_search_terms: "",
    product_name: fetchedProduct.product_name,
    imageUrls: fetchedProduct.imageUrls,
    image_count: fetchedProduct.image_count,
    mainImageUrl: fetchedProduct.mainImageUrl,
    mainImageUrls: fetchedProduct.mainImageUrls,
    detailImageUrls: fetchedProduct.detailImageUrls,
    main_image_count: fetchedProduct.main_image_count,
    detail_image_count: fetchedProduct.detail_image_count,
    output_file: "",  // stub 阶段还没 Excel 输出
    attributes: fetchedProduct.attributes,
    mainColor: fetchedProduct.mainColor,
    mainMaterial: fetchedProduct.mainMaterial,
    texture: fetchedProduct.texture,
    size: fetchedProduct.size,
    original_title: fetchedProduct.product_name,
    original_bullets: fetchedProduct.original_bullets,
    listing_parent_sku: listing?.parent_sku,
    listing_variant_label: listing?.variants.find(x => x.sku === fetchedProduct.sku)?.label,
  } : null);

  const selectAllRef = (visibleIndices?: number[]) => {
    if (!generateSource) return;
    const indices = visibleIndices ?? (generateSource.imageUrls || [])
      .slice(0, REFERENCE_IMAGE_LIMITS.total)
      .map((_, i) => i);
    const all = new Set<number>(indices.slice(0, REFERENCE_IMAGE_LIMITS.total));
    setSelectedIndices(all);
  };

  const clearAllRef = () => setSelectedIndices(new Set());

  const addUploaded = (dataUrl: string) => {
    setUploadedDataUrls(prev => [...prev, dataUrl]);
  };

  // Round2 fix Bug 1:canGenerate 改用 generateSource 桥接,允许"已抓取未优化"也能点生成
  // imageUrls.length > 0 兜底:避免空图时 selectedIndices=[0] 假装可点
  const canGenerate =
    !!generateSource &&
    canGenerateFromReferences(
      generateSource.imageUrls ?? [],
      selectedIndices.size,
      uploadedDataUrls.length,
    );

  const handleGenerate = async () => {
    if (!generateSource || !canGenerate) return;
    setGenerating(true);
    setGenError(null);
    try {
      // Round2 fix Bug 5:防御性修复 — 显式从 fetchedProduct 取最新 imageUrls/sku/color 等,
      // 不完全依赖 generateSource stub。理论上 result ?? stub(fetchedProduct) 应该正确,
      // 但 stub 是新对象字面量,如果 React 在切 variant 后状态没及时同步,可能引用旧值
      const activeSku = result?.sku || fetchedProduct?.sku || "";
      const activeImageUrls = result?.imageUrls || fetchedProduct?.imageUrls || [];
      const activeProductName = result?.product_name || fetchedProduct?.product_name || "";
      const activeMainColor = result?.mainColor || fetchedProduct?.mainColor || "";
      const activeMainMaterial = result?.mainMaterial || fetchedProduct?.mainMaterial || "";
      const activeTexture = result?.texture || fetchedProduct?.texture || "";
      const activeSize = result?.size || fetchedProduct?.size || "";
      const activeAttrs = result?.attributes || fetchedProduct?.attributes || {};

      const reference_images: Array<
        { source: "giga"; index: number; url: string } | { source: "upload"; data_url: string }
      > = [];
      const sortedSelected = Array.from(selectedIndices).sort((a, b) => a - b);
      sortedSelected.forEach(i => {
        const url = activeImageUrls[i];
        if (url) reference_images.push({ source: "giga", index: i, url });
      });
      uploadedDataUrls.forEach(du => reference_images.push({ source: "upload", data_url: du }));

      const product = {
        productName: activeProductName,
        mainColor: activeMainColor || activeAttrs["Main Color"] || activeAttrs["Color"] || "",
        mainMaterial: activeMainMaterial || activeAttrs["Main Material"] || activeAttrs["Material"] || "",
        texture: activeTexture || activeAttrs["Texture"] || "",
        size: activeSize || activeAttrs["Size"] || activeAttrs["Dimensions"] || "",
      };

      const res = await api.generateImage({
        slot: imageType,
        sku: activeSku,
        market: selectedMarket,
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
          // 累积保存：每次生成的图**新生成的排在最前**(便于用户一眼看出最近一次的结果)
          // + 记录生成时的 sku/variant label(用于切 variant 后区分历史图属于哪个 SKU)
          // 之前是"追加到末尾",用户切 variant 后看不清哪个是最近生成的(以为是旧 variant 的图)
          return [
            {
              slot: res.slot,
              image_url: res.image_url,
              public_url: res.public_url,
              filename: res.filename,
              size: res.size,
              generatedAt: Date.now(),
              // Round2 fix Bug 5:记录生成时的 sku 和 variant label,让用户区分历史图
              sku: activeSku,
              variantLabel: listing?.variants.find(v => v.sku === activeSku)?.label,
            },
            ...prev,
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

  const startupView = resolveStartupView(authState, authError);

  if (startupView === "loading" || startupView === "offline") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f7f9", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 380, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 32, boxShadow: "0 12px 32px rgba(0,0,0,.08)" }}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>
            {startupView === "loading" ? "正在连接 GIGAB2B" : "GIGAB2B 后端未连接"}
          </h1>
          <p style={{ margin: "0 0 16px", color: "#777", fontSize: 13 }}>
            {startupView === "loading" ? "正在读取本地服务状态…" : "请先启动本地后端服务，然后重新连接。"}
          </p>
          {startupView === "offline" && (
            <>
              <div style={{ color: "var(--theme-danger-text)", fontSize: 12 }}>{authError}</div>
              <button className="btn-primary" type="button" onClick={() => window.location.reload()} style={{ width: "100%", marginTop: 16 }}>
                重新连接
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (startupView === "login") {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f6f7f9", padding: 24 }}>
        <form
          onSubmit={(event) => { event.preventDefault(); void handleLogin(); }}
          style={{ width: "100%", maxWidth: 380, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 32, boxShadow: "0 12px 32px rgba(0,0,0,.08)" }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 600 }}>GIGAB2B 登录</h1>
          <p style={{ margin: "0 0 24px", color: "#777", fontSize: 13 }}>请输入服务器配置的访问密码</p>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={accessPassword}
            onChange={event => setAccessPassword(event.target.value)}
            placeholder="访问密码"
            autoFocus
          />
          {authError && <div style={{ marginTop: 10, color: "var(--theme-danger-text)", fontSize: 12 }}>{authError}</div>}
          <button className="btn-primary" type="submit" disabled={!accessPassword || authBusy} style={{ width: "100%", marginTop: 16 }}>
            {authBusy ? "登录中…" : "登录"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={S.root}>
      <header style={S.header}>
        <div style={S.headerTitle}>
          <span style={{ fontSize: "22px", fontWeight: 300, color: "var(--theme-text-primary)" }}>Listing Creator &amp; Optimizer</span>
          <span style={{ fontSize: "14px", fontWeight: 400, color: "var(--theme-text-muted)" }}>for GIGAB2B</span>
        </div>
        <Header status={serverStatus} theme={theme} onThemeChange={setTheme} />
      </header>

      <main style={S.main}>
        <LeftPanel
          selectedMarket={selectedMarket}
          onMarketChange={handleMarketChange}
          markets={markets}
          sku={sku}
          onSkuChange={v => {
            // 2026-07-08 修复:切 SKU 用 clearAllProductState() 集中清理所有产品相关 state
            // (用户反馈"切 SKU 必须彻底清除旧 SKU 痕迹")
            // 注:keywordsList 走独立清理(它跨 SKU 复用是错的)
            // generatedImages 故意保留(详见 clearAllProductState 注释)
            setSku(v);
            setKeywordsList([]);
            setKeywordsError(null);
            setIsFetching(false);
            clearAllProductState();
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
          // 2026-07-08 streaming SSE 实时文本 + 字符数
          aiCopyChunkText={aiCopyChunkText}
          aiCopyChunkLen={aiCopyChunkLen}
          // v6:listing 多 variant 支持
          listingVariants={listing?.variants ?? []}
          activeVariantSku={activeVariantSku}
          onVariantSelect={handleVariantSelect}
          includeVariants={includeVariants}
          onIncludeVariantsChange={setIncludeVariants}
          listingWarning={listing?.warning ?? null}
          // 平台选择
          platform={platform}
          onPlatformChange={setPlatform}
          supportedPlatforms={supportedPlatforms}
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
          // Round2 fix Bug 3:共用标题 UX 提示
          sharedTitle={allVariantNamesEqual}
          sharedTitleVariantCount={sharedTitleCount}
        />
        <aside style={S.colRight}>
          {(result || fetchedProduct) ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
              {/* 上:参考图 — 最多占 45% 高度,超出可滚动,确保下方生成结果区始终有空间 */}
              <section style={{ ...S.colRightSection, flex: "1 1 45%", minHeight: 0, overflowY: "auto" }}>
                <ReferenceImages
                  // Round2 fix Bug 4:用 fetchedProduct 而不是 result — result 来自 run-pipeline,
                  // 是用户最早输入的 SKU(可能是 Silver)的优化结果,切 variant 后是陈旧数据;
                  // fetchedProduct 反映当前选中的 variant,切换 chip 时实时更新
                  sku={fetchedProduct?.sku || result?.sku || ""}
                  market={selectedMarket}
                  imageUrls={fetchedProduct?.imageUrls || result?.imageUrls || []}
                  mainImageCount={fetchedProduct?.main_image_count ?? result?.main_image_count}
                  detailImageCount={fetchedProduct?.detail_image_count ?? result?.detail_image_count}
                  selectedIndices={selectedIndices}
                  onToggle={toggleRef}
                  onUploadedAdd={addUploaded}
                  onSelectAll={selectAllRef}
                  onClearAll={clearAllRef}
                />

                {uploadedDataUrls.length > 0 && (
                  <div style={{ marginBottom: "8px", padding: "8px", background: "var(--theme-info-bg)", border: "1px solid var(--theme-info-border)", borderRadius: "4px" }}>
                    <div style={{ fontSize: "11px", color: "var(--theme-info-text)", marginBottom: "6px" }}>本地上传 ({uploadedDataUrls.length})</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "4px" }}>
                      {uploadedDataUrls.map((du, i) => (
                        <div key={i} style={{ position: "relative", aspectRatio: "1/1", overflow: "hidden", borderRadius: "3px" }}>
                          <img src={du} alt={`uploaded ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                            onClick={() => setUploadedDataUrls(prev => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: "2px", right: "2px", background: "var(--theme-danger-text)", color: "#fff", border: "none", borderRadius: "2px", fontSize: "10px", cursor: "pointer", padding: "0 4px" }}
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
                  <div style={{ marginTop: "8px", padding: "10px 12px", background: "var(--theme-danger-bg)", border: "1px solid var(--theme-danger-border)", borderRadius: "4px", fontSize: "12px", color: "var(--theme-danger-text)" }}>
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
            <div style={{ fontSize: "12px", color: "var(--theme-text-muted)", padding: "12px", background: "var(--theme-surface-soft)", border: "1px dashed var(--theme-border)", borderRadius: "4px", textAlign: "center" }}>
              请先抓取产品数据
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
