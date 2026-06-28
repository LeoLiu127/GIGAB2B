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
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // 一次可能拿到多条事件，按 \n\n 切片
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
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
  getStatus() {
    return request<{ image_studio: { ok: boolean; providers: Record<string, string> }; giga_markets: Record<string, boolean>; has_giga_creds: boolean; port: number }>("/server-status");
  },

  listMarkets() {
    return request<Record<string, { name: string; lang: string; has_creds: boolean }>>("/markets");
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

  runPipeline(
    sku: string,
    market: string,
    template_filename?: string,
    imageStrategy: string = "use_giga",
    onEvent?: (e: Record<string, unknown>) => void,
  ) {
    return request<{
      type: "done";
      status: "ok";
      steps: Array<{ step: string; status: string; [key: string]: unknown }>;
      result: import("./types").PipelineResult;
    }>("/run-pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market, template_filename, image_strategy: imageStrategy }),
      // 流式：AI 文案单步可到 50s+，给 5 分钟兜底，远大于实际可能耗时
      timeout: 300_000,
      stream: true,
      onEvent,
    } as RequestInit & { timeout: number; stream: boolean; onEvent: (e: Record<string, unknown>) => void });
  },

  generateImage(opts: {
    slot: "main" | "detail";
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

  fetchImages(sku: string, market: string) {
    return request<{ success: boolean; sku: string; market: string; images: import("./types").GigaImage[] }>("/fetch-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market }),
    });
  },
};
