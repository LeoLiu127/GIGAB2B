import { useState } from "react";
import { Lightbox } from "./Lightbox";

export interface GeneratedImage {
  slot: string;
  image_url: string;
  filename: string;
  sceneParams?: { scene_type: string; background: string; lighting: string; angle: string };
  generatedAt: number;
}

const SLOT_LABEL: Record<string, string> = {
  main: "主图",
  sub: "副图",
  detail: "详情图",
  pt1: "辅图 1",
  pt2: "辅图 2",
  pt3: "辅图 3",
  pt4: "辅图 4",
  pt5: "辅图 5",
  pt6: "辅图 6",
  pt7: "辅图 7",
  pt8: "辅图 8",
};

interface GeneratedGalleryProps {
  images: GeneratedImage[];
  onClear: () => void;
  onDelete?: (img: GeneratedImage) => void;  // 累积保存后允许单张删除(可选)
}

export function GeneratedGallery({ images, onClear, onDelete }: GeneratedGalleryProps) {
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const [hovered, setHovered] = useState<{ key: string; rect: DOMRect; url: string; label: string } | null>(null);

  const handleDownload = (img: GeneratedImage) => {
    const a = document.createElement("a");
    a.href = img.image_url;
    a.download = img.filename || `${img.slot}.jpg`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // 排序:新生成的图排在最前(按 generatedAt 倒序);同 slot 内也是新的在前;
  // 之前按 SLOT_ORDER 排,导致新生成的反而在后面,用户找最新的要扫整个列表
  const sorted = [...images].sort((a, b) => b.generatedAt - a.generatedAt);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div className="section-title" style={{ margin: 0 }}>生成结果（{images.length}）</div>
        {images.length > 0 && (
          <button
            onClick={onClear}
            style={{ background: "none", border: "none", color: "#999", fontSize: "11px", cursor: "pointer", textDecoration: "underline" }}
          >清空</button>
        )}
      </div>

      {images.length === 0 ? (
        <div style={{ fontSize: "11px", color: "#ccc", padding: "12px 0", textAlign: "center" }}>
          点击「生成」后，图片会显示在这里
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px" }}>
          {sorted.map((img) => {
            const isMain = img.slot === "main";
            const label = SLOT_LABEL[img.slot] || img.slot;
            const key = `${img.slot}-${img.generatedAt}`;
            return (
              <div
                key={key}
                style={{
                  position: "relative",
                  borderRadius: "4px",
                  overflow: "hidden",
                  border: isMain ? "2px solid #000" : "1px solid #e0e0e0",
                  background: "#f5f5f5",
                  aspectRatio: "1/1",
                }}
              >
                <div
                  onMouseEnter={e => {
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    setHovered({ key, rect, url: img.image_url, label });
                  }}
                  onMouseLeave={() => setHovered(prev => (prev?.key === key ? null : prev))}
                  style={{ cursor: "zoom-in", overflow: "hidden", width: "100%", height: "100%" }}
                >
                  <img
                    src={img.image_url}
                    alt={label}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onClick={() => setLightbox({ url: img.image_url, label })}
                  />
                </div>
                <div style={{
                  position: "absolute", top: "4px", left: "4px",
                  background: isMain ? "#000" : "rgba(21,101,192,0.9)",
                  color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "2px",
                  fontWeight: 500,
                }}>{label}</div>
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(img); }}
                    title="删除这张"
                    style={{
                      position: "absolute", top: "4px", right: "32px",
                      background: "rgba(198,40,40,0.85)", color: "#fff", border: "none",
                      borderRadius: "2px", fontSize: "10px", cursor: "pointer",
                      padding: "2px 6px", lineHeight: 1,
                    }}
                  >×</button>
                )}
                <button
                  onClick={() => handleDownload(img)}
                  title="下载"
                  style={{
                    position: "absolute", top: "4px", right: "4px",
                    background: "rgba(0,0,0,0.55)", color: "#fff", border: "none",
                    borderRadius: "2px", fontSize: "10px", cursor: "pointer",
                    padding: "2px 6px", lineHeight: 1,
                  }}
                >↓</button>
              </div>
            );
          })}
        </div>
      )}

      {lightbox && <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />}

      {/* hover 放大预览叠加层 — position: fixed，最大 320px */}
      {hovered && (() => {
        const { rect, url, label } = hovered;
        const ZOOM_W = 320;
        const ZOOM_H = 320;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        let left = rect.right + 12;
        if (left + ZOOM_W > viewportW - 8) left = rect.left - ZOOM_W - 12;
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
              border: "2px solid #000",
              borderRadius: "6px",
              boxShadow: "0 16px 40px rgba(0,0,0,0.3)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <img
                src={url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "contain", background: "#fff" }}
              />
            </div>
            <div style={{ padding: "4px 8px", background: "#000", color: "#fff", fontSize: "10px", textAlign: "center" }}>
              {label} · 悬浮放大
            </div>
          </div>
        );
      })()}
    </div>
  );
}