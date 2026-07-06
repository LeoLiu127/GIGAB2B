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
  // 平台标识（amazon / walmart / wayfair）
  // 当 platform 不在 supported 列表中时，后端走 template_skipped 兜底
  platform?: string;
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
  // ── v6:listing 多 variant 支持 ──
  // 如果本次优化属于 listing 模式,记下 parent(便于 UI 标记)
  listing_parent_sku?: string;
  listing_variant_label?: string;
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

/**
 * 单个 variant 的轻量视图 — 后端 /api/fetch-listing 返回的每个变体的精简形态。
 * 字段集合是 FetchedProduct 的真子集 + 三个 listing 专有字段。
 */
export interface VariantView {
  sku: string;
  product_name: string;
  imageUrls: string[];
  image_count: number;
  original_bullets: string[];
  mainColor?: string;
  mainMaterial?: string;
  texture?: string;
  size?: string;
  attributes?: Record<string, string>;
  is_main: boolean;
  label: string; // "主SKU" 或 "颜色: Red · 尺寸: M"
}

/**
 * 「抓取数据」按钮调 /api/fetch-listing 的响应 — 整 listing(同 SKU 下的全部变体)。
 *
 * 向后兼容:顶层字段(active_variant.sku / imageUrls / mainColor / ...)与原 FetchedProduct 同形,
 * 所以 CenterPanel / ReferenceImages 既能消费旧 FetchedProduct,也能消费 ListingFetchedProduct.active_variant。
 *
 * variants[] 第一项 = 主 SKU(is_main=true,label="主SKU");其余为兄弟变体。
 */
export interface ListingFetchedProduct {
  success: boolean;
  parent_sku: string;
  market: string;
  variant_count: number;
  variants: VariantView[];
  active_variant: VariantView; // 默认 = variants[0](主 SKU)
  // ── 向后兼容顶层字段(与 FetchedProduct 等价,等于 active_variant 内容) ──
  sku: string;
  product_name: string;
  imageUrls: string[];
  image_count: number;
  original_bullets: string[];
  mainColor?: string;
  mainMaterial?: string;
  texture?: string;
  size?: string;
  attributes?: Record<string, string>;
  // ── listing 扩展 ──
  combo_flag: boolean;
  warning?: string | null;
}

export interface GigaImage {
  index: number;
  originalUrl: string;
  dataUrl: string;
  label?: string;
  failed?: boolean;
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
