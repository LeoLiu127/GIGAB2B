import { describe, expect, it } from "vitest";
import {
  canGenerateFromReferences,
  formatPlatformLabel,
  normalizeBulletLine,
  splitReferenceImages,
  groupReferenceImages,
  resolveOptimizeSku,
  resolveGeneratedImageLink,
  resolveStartupView,
  templateAfterMarketChange,
} from "./workflow";

describe("workflow guards", () => {
  it("optimizes the active fetched variant instead of the original input SKU", () => {
    expect(resolveOptimizeSku("PARENT-SKU", { sku: "VARIANT-SKU" })).toBe("VARIANT-SKU");
  });

  it("allows generation from local uploads when GIGA has no images", () => {
    expect(canGenerateFromReferences([], 0, 1)).toBe(true);
  });

  it("clears an uploaded template when the market changes", () => {
    expect(templateAfterMarketChange("template-123.xlsm", "UK", "US")).toBe("");
    expect(templateAfterMarketChange("template-123.xlsm", "UK", "UK")).toBe("template-123.xlsm");
  });

  it("formats platform names with an initial capital for UI labels", () => {
    expect(formatPlatformLabel("amazon")).toBe("Amazon");
    expect(formatPlatformLabel("walmart")).toBe("Walmart");
    expect(formatPlatformLabel("wayfair")).toBe("Wayfair");
  });

  it("removes list markers from optimized bullet editor rows", () => {
    expect(normalizeBulletLine("1. DURABLE FRAME Built for daily use")).toBe("DURABLE FRAME Built for daily use");
    expect(normalizeBulletLine("2) EASY SETUP Installs quickly")).toBe("EASY SETUP Installs quickly");
    expect(normalizeBulletLine("• SPACE SAVING Folds flat")).toBe("SPACE SAVING Folds flat");
    expect(normalizeBulletLine("— VERSATILE For apartments")).toBe("VERSATILE For apartments");
    expect(normalizeBulletLine("**STYLISH SLOTTED DESIGN**: Elegant dark oak finish")).toBe(
      "STYLISH SLOTTED DESIGN: Elegant dark oak finish",
    );
  });

  it("resolves generated image copy links to absolute URLs", () => {
    expect(resolveGeneratedImageLink("/outputs/SKU-1/main.png", "", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173/outputs/SKU-1/main.png",
    );
    expect(resolveGeneratedImageLink("/outputs/SKU-1/main.png", "https://cdn.example/main.png", "http://127.0.0.1:5173")).toBe(
      "https://cdn.example/main.png",
    );
  });

  it("splits reference images into up to 9 main images and 6 detail images", () => {
    const urls = Array.from({ length: 18 }, (_, i) => `https://cdn.example/${i + 1}.jpg`);

    const grouped = splitReferenceImages(urls, 11, 9);

    expect(grouped.mainImages).toEqual(urls.slice(0, 9).map((url, index) => ({ url, index })));
    expect(grouped.detailImages).toEqual(urls.slice(9, 15).map((url, offset) => ({ url, index: 9 + offset })));
    expect(grouped.visibleImages).toHaveLength(15);
  });

  it("groups proxied images by measured metadata while preserving source indices", () => {
    const urls = Array.from({ length: 18 }, (_, i) => `https://cdn.example/${i + 1}.jpg`);
    const metadata = urls.map((url, index) => ({
      index,
      originalUrl: url,
      dataUrl: url,
      group: index % 2 === 0 ? "main" as const : "detail" as const,
    }));

    const grouped = groupReferenceImages(urls, metadata);

    expect(grouped.mainImages).toHaveLength(9);
    expect(grouped.detailImages).toHaveLength(6);
    expect(grouped.mainImages[1].index).toBe(2);
    expect(grouped.detailImages[1].index).toBe(3);
    expect(grouped.visibleImages).toHaveLength(15);
  });

  it("does not count or select provisional images that are not rendered in either group", () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://cdn.example/${i + 1}.jpg`);

    const grouped = splitReferenceImages(urls, 6, 6);

    expect(grouped.mainImages).toHaveLength(6);
    expect(grouped.detailImages).toHaveLength(6);
    expect(grouped.visibleImages).toEqual([...grouped.mainImages, ...grouped.detailImages]);
  });

  it("shows an offline state instead of a password form when auth status cannot load", () => {
    expect(resolveStartupView(null, "Error: HTTP 500")).toBe("offline");
    expect(resolveStartupView(null, null)).toBe("loading");
  });

  it("shows login only when the backend explicitly requires authentication", () => {
    expect(resolveStartupView({ required: true, authenticated: false }, null)).toBe("login");
    expect(resolveStartupView({ required: false, authenticated: true }, null)).toBe("app");
  });
});
