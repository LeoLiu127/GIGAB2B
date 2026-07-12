export function resolveOptimizeSku(inputSku: string, fetchedProduct: { sku: string } | null): string {
  return fetchedProduct?.sku.trim() || inputSku.trim();
}

export function canGenerateFromReferences(
  imageUrls: string[],
  selectedCount: number,
  uploadedCount: number,
): boolean {
  const hasSelectedGigaImage = imageUrls.length > 0 && selectedCount > 0;
  return hasSelectedGigaImage || uploadedCount > 0;
}

export const REFERENCE_IMAGE_LIMITS = {
  main: 9,
  detail: 6,
  total: 15,
} as const;

export type StartupView = "loading" | "offline" | "login" | "app";

export function resolveStartupView(
  authState: { required: boolean; authenticated: boolean } | null,
  authError: string | null,
): StartupView {
  if (!authState) return authError ? "offline" : "loading";
  if (authState.required && !authState.authenticated) return "login";
  return "app";
}

export function splitReferenceImages(
  imageUrls: string[],
  mainImageCount: number = 1,
  detailImageCount: number = REFERENCE_IMAGE_LIMITS.detail,
): {
  visibleImages: Array<{ url: string; index: number }>;
  mainImages: Array<{ url: string; index: number }>;
  detailImages: Array<{ url: string; index: number }>;
} {
  const visibleImages = imageUrls.slice(0, REFERENCE_IMAGE_LIMITS.total).map((url, index) => ({ url, index }));
  const safeMainCount = Math.max(0, Math.min(mainImageCount, REFERENCE_IMAGE_LIMITS.main, visibleImages.length));
  const safeDetailCount = Math.max(
    0,
    Math.min(detailImageCount, REFERENCE_IMAGE_LIMITS.detail, visibleImages.length - safeMainCount),
  );
  const mainImages = visibleImages.slice(0, safeMainCount);
  const detailImages = visibleImages.slice(safeMainCount, safeMainCount + safeDetailCount);
  return {
    visibleImages: [...mainImages, ...detailImages],
    mainImages,
    detailImages,
  };
}

type ReferenceImageMetadata = {
  index: number;
  originalUrl: string;
  group?: "main" | "detail";
};

export function groupReferenceImages(imageUrls: string[], metadata: ReferenceImageMetadata[]) {
  if (!metadata.length) return splitReferenceImages(imageUrls);
  const valid = metadata.filter(item => imageUrls[item.index] === item.originalUrl);
  const mainImages = valid
    .filter(item => item.group === "main")
    .slice(0, REFERENCE_IMAGE_LIMITS.main)
    .map(item => ({ url: item.originalUrl, index: item.index }));
  const detailImages = valid
    .filter(item => item.group === "detail")
    .slice(0, REFERENCE_IMAGE_LIMITS.detail)
    .map(item => ({ url: item.originalUrl, index: item.index }));
  return { mainImages, detailImages, visibleImages: [...mainImages, ...detailImages] };
}

export function templateAfterMarketChange(
  templateFilename: string,
  previousMarket: string,
  nextMarket: string,
): string {
  return previousMarket === nextMarket ? templateFilename : "";
}

export function formatPlatformLabel(platform: string): string {
  const normalized = platform.trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

export function normalizeBulletLine(line: string): string {
  return line
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/^\s*(?:(?:\d{1,2}|[A-Za-z])\s*[.．)）:：]\s*|[-*•·●‧・]\s+|-\s+)/, "")
    .replace(/(?<!\*)\*\*([^*\n]+?)\*\*(?!\*)/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "$1")
    .trim();
}

export function resolveGeneratedImageLink(
  imageUrl: string,
  publicUrl?: string,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  const preferred = (publicUrl || "").trim();
  if (preferred) return preferred;
  const fallback = (imageUrl || "").trim();
  if (!fallback) return "";
  if (/^(?:https?:|data:)/i.test(fallback)) return fallback;
  if (!origin) return fallback;
  return new URL(fallback, origin).href;
}
