export interface ProductPreview {
  sku: string;
  productName: string;
  material: string;
  color: string;
  dimensions: string;
  imageUrls: string[];
  imageCount: number;
  category: string;
}

export interface PipelineResult {
  sku: string;
  market: string;
  market_name: string;
  ai_title: string;
  ai_bullets: string[];
  ai_description: string;
  ai_search_terms: string;
  product_name: string;
  image_count: number;
  output_file: string;
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
