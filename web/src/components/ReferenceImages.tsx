import { useEffect, useRef, useState } from "react";
import { api } from "../api";

interface ReferenceImagesProps {
  sku: string;
  market: string;
  imageUrls: string[];
  selectedIndices: Set<number>;
  onToggle: (index: number) => void;
  onUploadedAdd: (dataUrl: string) => void;
  onSelectAll?: () => void;
  onClearAll?: () => void;
}

export function ReferenceImages({
  sku,
  market,
  imageUrls,
  selectedIndices,
  onToggle,
  onUploadedAdd,
  onSelectAll,
  onClearAll,
}: ReferenceImagesProps) {
  const [proxyImages, setProxyImages] = useState<Record<number, string>>({});
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [hovered, setHovered] = useState<{ index: number; rect: DOMRect } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 代理拉图 AbortController — 切换 SKU 或卸载时取消正在飞的请求(B3 修复)
  const proxyAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setProxyImages({});
    setFetched(false);
    // SKU/market 切换时取消正在飞的代理 fetch,防止旧数据覆盖新 SKU state
    proxyAbortRef.current?.abort();
    proxyAbortRef.current = null;
  }, [sku, market]);

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
      const res = await api.fetchImages(sku, market, ctrl.signal);
      // 如果请求期间被取消,res 可能是 undefined / 抛 AbortError
      if (!res || !res.images) return;
      const map: Record<number, string> = {};
      res.images.forEach((img) => { map[img.index] = img.dataUrl; });
      // 再次检查:如果用户在此期间切了 SKU,不要写回 state
      if (ctrl.signal.aborted) return;
      setProxyImages(map);
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
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={onSelectAll} disabled={imageUrls.length === 0}>全选</button>
          )}
          {onClearAll && (
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} onClick={onClearAll} disabled={selectedIndices.size === 0}>清选</button>
          )}
          {!fetched && imageUrls.length > 0 && (
            <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: "11px" }} disabled={fetching} onClick={fetchProxyImages}>
              {fetching ? "加载中" : "代理"}
            </button>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "4px" }}>
        {imageUrls.slice(0, 9).map((url, i) => {
          const displayUrl = proxyImages[i] || url;
          const isSelected = selectedIndices.has(i);
          return (
            <div
              key={i}
              title={i === 0 ? "主图" : `图片 ${i + 1}`}
              onClick={() => onToggle(i)}
              onMouseEnter={e => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                setHovered({ index: i, rect });
              }}
              onMouseLeave={() => setHovered(prev => (prev?.index === i ? null : prev))}
              style={{
                position: "relative",
                aspectRatio: "1/1",
                borderRadius: "3px",
                overflow: "hidden",
                cursor: "pointer",
                border: isSelected ? "2px solid #1565c0" : "1px solid #e0e0e0",
                background: "#f5f5f5",
              }}
            >
              <img
                src={displayUrl}
                alt={`图片 ${i + 1}`}
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: isSelected ? 1 : 0.7 }}
                onError={e => { (e.target as HTMLImageElement).src = url; }}
              />
              {isSelected && (
                <div style={{ position: "absolute", top: "1px", right: "1px", background: "#1565c0", color: "#fff", fontSize: "9px", padding: "0 3px", borderRadius: "2px", lineHeight: "14px" }}>✓</div>
              )}
              {i === 0 && (
                <div style={{ position: "absolute", bottom: "1px", left: "1px", background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: "8px", padding: "0 3px", borderRadius: "2px", lineHeight: "12px" }}>主</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "6px", fontSize: "11px", color: "#999" }}>
        已选 {selectedIndices.size} / 9 · 蓝框为已选 · 悬浮放大预览
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
              background: "#fff",
              border: "2px solid #1565c0",
              borderRadius: "4px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
              overflow: "hidden",
            }}
          >
            <img
              src={proxyImages[hovered.index] || imageUrls[hovered.index]}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }}
            />
          </div>
        );
      })()}
    </div>
  );
}