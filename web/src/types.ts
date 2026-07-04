export interface PipelineResult {
  sku: string;
  market: string;
  market_name: string;
  ai_title: string;
  ai_bullets: string[];
  ai_description: string;
  ai_search_terms: string;
  product_name: string;
  imageUrls: string[];
  image_count: number;
  output_file: string;
  // 后端第 3 步"填入 Excel"被跳过(用户未上传模板且市场 fallback 文件缺失)时为 true
  template_skipped?: boolean;
  // AI 文案生成质量状态（B.7 修复新增）
  // - "ok":      4 个字段齐全
  // - "partial": 部分字段为空(标题有了但 bullets 缺失)
  // - "empty":   全部为空(基本等于失败,Excel 填了空内容)
  ai_status?: "ok" | "partial" | "empty";
  ai_attempts?: number;
  // 产品属性（用于生图 prompt 拼接）
  mainColor?: string;
  mainMaterial?: string;
  texture?: string;
  size?: string;
  attributes?: Record<string, string>;
  // 原始文案(从 GIGA detailInfo 接口直透) — 让第二栏 compare-block 可以"上方原始 + 下方优化后"对照展示
  // description / search_terms GIGA 没给原始,前端无需 original_* 字段,直接走空态
  original_title?: string;
  original_bullets?: string[];
}

/**
 * 「抓取数据」按钮单独调 /api/fetch-product 拿到的轻量结果。
 * 没调 AI,没填 Excel;只有 GIGA 原始字段。
 */
export interface FetchedProduct {
  success: boolean;
  sku: string;
  market: string;
  product_name: string;
  original_bullets: string[];
  imageUrls: string[];
  image_count: number;
  attributes?: Record<string, string>;
  mainColor?: string;
  mainMaterial?: string;
  texture?: string;
  size?: string;
}

export interface GigaImage {
  index: number;
  dataUrl: string;
}

export interface ServerStatus {
  image_studio: {
    ok: boolean;
    providers: Record<string, string>;
  };
  giga_markets: Record<string, boolean>;
}

export interface MarketInfo {
  name: string;
  lang: string;
  has_creds: boolean;
}
