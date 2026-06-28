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
  // 产品属性（用于生图 prompt 拼接）
  mainColor?: string;
  mainMaterial?: string;
  texture?: string;
  size?: string;
  attributes?: Record<string, string>;
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
