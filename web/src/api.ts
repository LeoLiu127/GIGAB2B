const BASE = "/api";

// 默认 60s，足以覆盖一次完整 pipeline；调用方可在 opts.timeout 覆盖
const DEFAULT_TIMEOUT_MS = 60_000;

async function request<T>(path: string, opts?: RequestInit & { timeout?: number; stream?: boolean }): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, stream = false, signal: externalSignal, ...fetchOpts } = opts ?? {};
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(new Error("Request timeout")), timeout);
  // 把外部 signal 也接进来（用户可自行 cancel）
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", () => ctrl.abort(externalSignal.reason), { once: true });
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...fetchOpts, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`请求超时（${timeout}ms）：${path}`);
    throw e;
  } finally {
    clearTimeout(tid);
  }

  // 流式响应（SSE）：把 text/event-stream 按 "data: {...}\n\n" 切分，逐块回调
  if (stream) {
    if (!res.ok) {
      // 错误也尝试读一下 body
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    if (!res.body) throw new Error("SSE: 空响应 body");
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buf = "";
    let lastEvent: Record<string, unknown> | null = null;
    // SSE 标准事件分隔符是 \r\n\r\n，但 Flask/werkzeug 在 Windows 上可能发 \n\n
    // 用正则匹配两种都覆盖（修复致命 F-4）
    const SSE_SEP = /\r?\n\r?\n/;
    try {
      while (true) {
        // 提前响应 abort（致命 F-5 修复）
        if (ctrl.signal.aborted) {
          await reader.cancel().catch(() => {});
          throw new Error(ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : "请求已取消");
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 一次可能拿到多条事件，按 SSE_SEP 切片
        let match: RegExpExecArray | null;
        while ((match = SSE_SEP.exec(buf)) !== null) {
          const chunk = buf.slice(0, match.index);
          buf = buf.slice(match.index + match[0].length);
          // 取出所有 data: 行
          const lines = chunk.split(/\r?\n/);
          for (const line of lines) {
            const m = /^data:\s?(.*)$/.exec(line);
            if (!m) continue;
            try {
              const obj = JSON.parse(m[1]);
              lastEvent = obj;
              const onEvent = (fetchOpts as { onEvent?: (e: Record<string, unknown>) => void }).onEvent;
              if (onEvent) onEvent(obj);
              // 错误事件立刻抛出
              if (obj.type === "error") {
                throw new Error(String(obj.error || "SSE 错误"));
              }
            } catch (e) {
              // JSON 解析失败：抛
              if (e instanceof SyntaxError) {
                throw new Error(`SSE: 无法解析事件: ${m[1].slice(0, 120)}`);
              }
              throw e;
            }
          }
        }
      }
    } catch (err) {
      // 抛错时主动 cancel reader，避免 fetch 仍在后台跑（致命 F-5 修复）
      await reader.cancel().catch(() => {});
      // 如果外部 signal 已经 abort,把超时/取消错误透传
      if (ctrl.signal.aborted && !(err instanceof Error && err.message)) {
        const reason = ctrl.signal.reason;
        throw reason instanceof Error ? reason : new Error("请求已取消");
      }
      throw err;
    } finally {
      try { reader.releaseLock(); } catch { /* noop */ }
    }
    // 流结束：以最后一个事件作为返回值（约定 done 事件在最末尾）
    if (!lastEvent) throw new Error("SSE: 无任何事件");
    return lastEvent as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  getStatus(opts?: { signal?: AbortSignal }) {
    return request<{ image_studio: { ok: boolean; providers: Record<string, string> }; giga_markets: Record<string, boolean>; has_giga_creds: boolean; port: number }>("/server-status", { signal: opts?.signal });
  },

  listMarkets(opts?: { signal?: AbortSignal }) {
    return request<Record<string, { name: string; lang: string; has_creds: boolean }>>("/markets", { signal: opts?.signal });
  },

  /**
   * 获取平台注册表(amazon / walmart / wayfair)。
   * 返回 { platform_name: supported } — false 的平台只展示在 UI 占位,后端走 template_skipped。
   */
  listPlatforms(opts?: { signal?: AbortSignal }) {
    return request<Record<string, boolean>>("/platforms", { signal: opts?.signal });
  },

  detectMarket(body: { template_filename?: string; sku?: string }) {
    return request<{ market: string; name: string; lang: string; source: string }>("/detect-market", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },

  uploadTemplate(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    return request<{ filename: string; detected_market: string | null; market_name: string | null; market_lang: string | null }>("/upload-template", {
      method: "POST",
      body: fd,
    });
  },

  /**
   * 解析关键词文件 (.txt / .csv / .xlsx),返回 list[str].
   * 失败抛出 Error,前端降级处理(警告 + 跳过该文件,不影响流水线)。
   */
  parseKeywords(file: File, signal?: AbortSignal) {
    const fd = new FormData();
    fd.append("keywords_file", file);
    return request<{ filename: string; keywords: string[]; count: number }>("/parse-keywords", {
      method: "POST",
      body: fd,
      signal,
    });
  },

  runPipeline(
    sku: string,
    market: string,
    template_filename?: string,
    imageStrategy: string = "use_giga",
    onEvent?: (e: Record<string, unknown>) => void,
    externalSignal?: AbortSignal,
    extra?: { prompt_extra?: string; keywords?: string[]; platform?: string },
  ) {
    return request<{
      type: "done";
      status: "ok";
      steps: Array<{ step: string; status: string; [key: string]: unknown }>;
      result: import("./types").PipelineResult;
    }>("/run-pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        market,
        template_filename,
        image_strategy: imageStrategy,
        prompt_extra: extra?.prompt_extra ?? "",
        keywords: extra?.keywords ?? [],
        platform: extra?.platform ?? "amazon",
      }),
      // 流式：AI 文案单步可到 50s+，给 5 分钟兜底，远大于实际可能耗时
      timeout: 300_000,
      stream: true,
      onEvent,
      signal: externalSignal,
    } as RequestInit & { timeout: number; stream: boolean; onEvent: (e: Record<string, unknown>) => void; signal?: AbortSignal });
  },

  generateImage(opts: {
    slot: "main" | "sub" | "detail";
    sku?: string;
    size: string;
    prompt_extra?: string;
    reference_images: Array<
      | { source: "giga"; index: number; url: string }
      | { source: "upload"; data_url: string }
    >;
    product?: Record<string, unknown>;
    copy?: {
      title?: string;
      bullets?: string[];
      description?: string;
      search_terms?: string;
    };
  }) {
    return request<{
      success: boolean;
      slot: string;
      image_url: string;
      thumbnail_url: string;
      filename: string;
      size: string;
      prompt_used: string;
    }>("/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
      timeout: 200_000,
    });
  },

  fetchImages(sku: string, market: string, signal?: AbortSignal) {
    // 加 signal 支持切换 SKU 时取消(B3 修复 — 旧 SKU 代理图不再覆盖新 SKU state)
    return request<{ success: boolean; sku: string; market: string; images: import("./types").GigaImage[] }>("/fetch-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market }),
      signal,
    });
  },

  fetchProduct(sku: string, market: string, signal?: AbortSignal) {
    // 「抓取数据」按钮单独用：只调 GIGA, 不调 AI, 不填 Excel
    return request<import("./types").FetchedProduct>("/fetch-product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market }),
      timeout: 30_000,
      signal,
    });
  },

  fetchListing(
    sku: string,
    market: string,
    opts?: { includeVariants?: boolean; signal?: AbortSignal }
  ) {
    // 「抓取数据」按钮的增强版:同时拉取同 Listing 全部变体(颜色 / 尺寸)
    // 后端 /api/fetch-listing 返回 ListingFetchedProduct(含 variants[] + active_variant)
    // active_variant 字段与原 FetchedProduct 同形,CenterPanel / ReferenceImages 不需要改
    return request<import("./types").ListingFetchedProduct>("/fetch-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sku,
        market,
        include_variants: opts?.includeVariants ?? true,
      }),
      timeout: 30_000,
      signal: opts?.signal,
    });
  },
};
