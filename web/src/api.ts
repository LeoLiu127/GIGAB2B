const BASE = "/api";

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
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

  fetchProduct(sku: string, market: string) {
    return request<{ success: boolean; product: import("./types").ProductPreview }>("/fetch-only", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market }),
    });
  },

  runPipeline(sku: string, market: string, template_filename?: string, imageStrategy: string = "use_giga") {
    return request<{
      success: boolean;
      result: import("./types").PipelineResult;
      steps: Array<{ step: string; status: string; [key: string]: unknown }>;
    }>("/run-pipeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku, market, template_filename, image_strategy: imageStrategy }),
    });
  },

  generateImage(product: Record<string, unknown>, template: string, imageUrls: string[]) {
    return request<{ success: boolean; imageUrl: string; template: string }>("/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product, template, imageUrls }),
    });
  },
};
