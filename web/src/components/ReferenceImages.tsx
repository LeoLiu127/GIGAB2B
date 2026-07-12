import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { GigaImage } from "../types";
import { groupReferenceImages, splitReferenceImages } from "../workflow";

// Round2 fix Bug 2:模块级 cache — 切回同 variant 立即命中,0 网络请求
// key 形如: "DE_TAX|W3372P314940|0|https://giga-cdn.../img0.jpg"
type CacheEntry = { dataUrl: string; cachedAt: number };
const proxyCache: Map<string, CacheEntry> = new Map();
const PROXY_CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟

interface ReferenceImagesProps {
  sku: string;
  market: string;
  imageUrls: string[];
  mainImageCount?: number;
  detailImageCount?: number;
  selectedIndices: Set<number>;
  onToggle: (index: number) => void;
  onUploadedAdd: (dataUrl: string) => void;
  onSelectAll?: (indices?: number[]) => void;
  onClearAll?: () => void;
}

export function ReferenceImages({
  sku,
  market,
  imageUrls,
  mainImageCount,
  detailImageCount,
  selectedIndices,
  onToggle,
  onUploadedAdd,
  onSelectAll,
  onClearAll,
}: ReferenceImagesProps) {
  const [proxyImages, setProxyImages] = useState<Record<number, string>>({});
  const [proxyMetadata, setProxyMetadata] = useState<GigaImage[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [hovered, setHovered] = useState<{ index: number; rect: DOMRect } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 代理拉图 AbortController — 切换 SKU 或卸载时取消正在飞的请求(B3 修复)
  const proxyAbortRef = useRef<AbortController | null>(null);

  // Round2 fix Bug 2:useEffect deps 加入 imageUrls(序列化为 stable key)— 切 variant 时也能触发
  const imageUrlsKey = imageUrls.join("|");
  useEffect(() => {
    setProxyImages({});
    setProxyMetadata([]);
    setFetched(false);
    // SKU/market/imageUrls 变化时取消正在飞的代理 fetch,防止旧数据覆盖新 state
    proxyAbortRef.current?.abort();
    proxyAbortRef.current = null;

    // 默认自动启用代理(Round2 fix Bug 2) — 切 variant 时不需要再点"代理"按钮
    if (imageUrls.length > 0) {
      fetchProxyImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sku, market, imageUrlsKey]);

  // 组件卸载时也取消
  useEffect(() => {
    return () => {
      proxyAbortRef.current?.abort();
      proxyAbortRef.current = null;
    };
  }, []);

  const fetchProxyImages = async () => {
    // 取消上一次还在飞的代理请求
    proxyAbortRef.current?.abort();
    const ctrl = new AbortController();
    proxyAbortRef.current = ctrl;
    setFetching(true);
    try {
      const declaredMainUrls = imageUrls.slice(0, Math.max(0, mainImageCount ?? (imageUrls.length ? 1 : 0)));
      const res = await api.fetchImages(sku, market, imageUrls, declaredMainUrls, ctrl.signal);
      // 如果请求期间被取消,res 可能是 undefined / 抛 AbortError
      if (!res || !res.images) return;
      const map: Record<number, string> = {};
      const now = Date.now();
      res.images.forEach((img) => {
        if (imageUrls[img.index] !== img.originalUrl) return;
        // Round2 fix Bug 2:命中模块级缓存则复用旧 dataUrl,避免每次切 variant 都重新代理
        const cacheKey = `${market}|${sku}|${img.index}|${img.originalUrl}`;
        const prev = proxyCache.get(cacheKey);
        if (prev && now - prev.cachedAt < PROXY_CACHE_TTL_MS) {
          map[img.index] = prev.dataUrl;
        } else {
          proxyCache.set(cacheKey, { dataUrl: img.dataUrl, cachedAt: now });
          map[img.index] = img.dataUrl;
        }
      });
      // 再次检查:如果用户在此期间切了 SKU,不要写回 state
      if (ctrl.signal.aborted) return;
      setProxyImages(map);
      setProxyMetadata(res.images);
      setFetched(true);
    } catch {
      // silent fail (含 AbortError,这是正常的取消信号,不报警)
    } finally {
      if (proxyAbortRef.current === ctrl) {
        proxyAbortRef.current = null;
      }
      setFetching(false);
    }
  };

  const grouped = proxyMetadata.length
    ? groupReferenceImages(imageUrls, proxyMetadata)
    : splitReferenceImages(
        imageUrls,
        mainImageCount ?? (imageUrls.length > 0 ? 1 : 0),
        detailImageCount ?? Math.max(0, imageUrls.length - (mainImageCount ?? 1)),
      );
  const visibleCount = grouped.visibleImages.length;

  const renderThumb = (item: { url: string; index: number }, group: "main" | "detail", groupIndex: number) => {
    const displayUrl = proxyImages[item.index] || item.url;
    const isSelected = selectedIndices.has(item.index);
    const isFirst = item.index === 0;
    const title = group === "main" ? `主图 ${groupIndex + 1}` : `详情图 ${groupIndex + 1}`;
    return (
      <div
        // Round2 fix Bug 2:key 带 sku/market — 切 variant 时 React 不会复用错的 DOM/img
        key={`${sku}-${market}-${group}-${item.index}`}
        title={title}
        onClick={() => onToggle(item.index)}
        onMouseEnter={e => {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          setHovered({ index: item.index, rect });
        }}
        onMouseLeave={() => setHovered(prev => (prev?.index === item.index ? null : prev))}
        style={{
          position: "relative",
          aspectRatio: "1/1",
          borderRadius: "3px",
          overflow: "hidden",
          cursor: "pointer",
          border: isSelected ? "2px solid var(--theme-action-bg)" : "1px solid var(--theme-border)",
          background: group === "detail" ? "var(--theme-surface)" : "var(--theme-surface-muted)",
        }}
      >
        <img
          src={displayUrl}
          alt={title}
          // Round2 fix Bug 2:首图 eager + 高优先级;其余 lazy 异步
          loading={isFirst ? "eager" : "lazy"}
          // React 19 属性;tsc 报错可改 fetchpriority
          // @ts-ignore — React 19 fetchPriority
          fetchPriority={isFirst ? "high" : "auto"}
          decoding="async"
          style={{
            width: "100%",
            height: "100%",
            objectFit: group === "detail" ? "contain" : "cover",
            display: "block",
            opacity: isSelected ? 1 : 0.7,
          }}
          onError={e => { (e.target as HTMLImageElement).src = item.url; }}
        />
        {isSelected && (
          <div style={{ position: "absolute", top: "1px", right: "1px", background: "var(--theme-action-bg)", color: "var(--theme-action-fg)", fontSize: "9px", padding: "0 3px", borderRadius: "2px", lineHeight: "14px" }}>✓</div>
        )}
        <div style={{ position: "absolute", bottom: "1px", left: "1px", background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: "8px", padding: "0 3px", borderRadius: "2px", lineHeight: "12px" }}>
          {group === "main" ? "主" : "详"}
        </div>
      </div>
    );
  };

  const handleFile = async (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") onUploadedAdd(result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div className="section-title" style={{ margin: 0 }}>参考图（勾选后参与生成）</div>
        <div style={{ display: "flex", gap: "6px" }}>
          {onSelectAll && (
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={() => onSelectAll(grouped.visibleImages.map(item => item.index))} disabled={visibleCount === 0}>全选</button>
          )}
          {onClearAll && (
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={onClearAll} disabled={selectedIndices.size === 0}>清选</button>
          )}
          {/* Round2 fix Bug 2:把"代理"按钮改为"重试"按钮 — 默认已自动拉取,仅在失败时显示 */}
          {!fetched && visibleCount > 0 && !fetching && (
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={fetchProxyImages}>
              重试
            </button>
          )}
          {fetching && (
            <span style={{ fontSize: "11px", color: "var(--theme-text-muted)", alignSelf: "center" }}>加载中…</span>
          )}
          <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={() => fileRef.current?.click()}>
            + 本地
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
        </div>
      </div>

      <div style={{ maxHeight: "230px", overflowY: "auto", paddingRight: "4px" }}>
        {grouped.mainImages.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", color: "var(--theme-text-muted)", marginBottom: "4px" }}>主图 ({grouped.mainImages.length})</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px" }}>
              {grouped.mainImages.map((item, i) => renderThumb(item, "main", i))}
            </div>
          </div>
        )}
        {grouped.detailImages.length > 0 && (
          <div style={{ marginTop: grouped.mainImages.length > 0 ? "8px" : 0, paddingTop: grouped.mainImages.length > 0 ? "8px" : 0, borderTop: grouped.mainImages.length > 0 ? "1px dashed var(--theme-border)" : "none" }}>
            <div style={{ fontSize: "11px", color: "var(--theme-text-muted)", marginBottom: "4px" }}>详情图 ({grouped.detailImages.length})</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px" }}>
              {grouped.detailImages.map((item, i) => renderThumb(item, "detail", i))}
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--theme-text-muted)" }}>
        已选 {selectedIndices.size} / {visibleCount} · 蓝框为已选 · 悬浮放大预览
      </div>

      {/* hover 放大预览叠加层 — position: fixed，最大 280px */}
      {hovered && (() => {
        const { rect } = hovered;
        const ZOOM_W = 280;
        const ZOOM_H = 280;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        // 默认放到图片右侧；若超出视口右边界则翻转到左侧
        let left = rect.right + 12;
        if (left + ZOOM_W > viewportW - 8) left = rect.left - ZOOM_W - 12;
        // 垂直方向：以缩略图中心对齐，夹在视口内
        let top = rect.top + rect.height / 2 - ZOOM_H / 2;
        top = Math.max(8, Math.min(top, viewportH - ZOOM_H - 8));
        return (
          <div
            style={{
              position: "fixed",
              left,
              top,
              width: ZOOM_W,
              height: ZOOM_H,
              zIndex: 9999,
              pointerEvents: "none",
              background: "var(--theme-surface)",
              border: "2px solid var(--theme-action-bg)",
              borderRadius: "4px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            <img
              src={proxyImages[hovered.index] || imageUrls[hovered.index]}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--theme-surface)" }}
            />
          </div>
        );
      })()}
    </div>
  );
}
