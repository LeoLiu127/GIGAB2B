import { useState } from "react";
import type { ServerStatus } from "../types";

interface HeaderProps {
  status: ServerStatus | null;
}

export function Header({ status }: HeaderProps) {
  const [showModal, setShowModal] = useState(false);

  if (!status) return null;

  const studio = status.image_studio;
  const gigaMarkets = Object.entries(status.giga_markets).filter(([, v]) => v);

  const studioOk = studio.ok;
  const minimaxOk = studio.providers?.minimax === "configured";
  const laozhangOk = studio.providers?.laozhang === "configured";

  return (
    <>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{ fontSize: "11px", color: "#999" }}>系统状态：</span>

        <span className={`badge ${studioOk ? "badge-ok" : "badge-error"}`}>
          {studioOk ? "image-studio " : "image-studio离线"}
        </span>

        <span className={`badge ${minimaxOk ? "badge-ok" : "badge-warn"}`}>
          MiniMax {minimaxOk ? "OK" : "未配置"}
        </span>

        <span className={`badge ${laozhangOk ? "badge-ok" : "badge-warn"}`}>
          laozhang {laozhangOk ? "OK" : "未配置"}
        </span>

        {gigaMarkets.length > 0 && (
          <span className="badge badge-ok">
            GIGA {gigaMarkets.length} 市场
          </span>
        )}

        <button
          onClick={() => setShowModal(true)}
          style={{ background: "none", border: "none", fontSize: "12px", color: "#999", cursor: "pointer", padding: "4px 8px", textDecoration: "underline" }}
        >
          详情
        </button>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setShowModal(false)}>
          <div style={{ background: "#fff", padding: "40px", width: "100%", maxWidth: "520px", borderRadius: "4px" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "24px" }}>系统状态详情</h3>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>image-studio Server</div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                {studio.ok
                  ? `已连接 · MiniMax: ${studio.providers?.minimax} · laozhang: ${studio.providers?.laozhang}`
                  : "未运行。请先启动 start_studio.bat（位于 image-studio 目录）"}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>GIGA 凭证</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {Object.entries(status.giga_markets).map(([market, ok]) => (
                  <div key={market} style={{ fontSize: "13px" }}>
                    <span style={{ color: ok ? "#2e7d32" : "#c62828" }}>{ok ? "OK" : "缺失"}</span>
                    {" · "}
                    {market}
                  </div>
                ))}
              </div>
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#999" }}>
                凭证路径：F:\AI Projects\GIGAB2B\.env
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>API Keys</div>
              <div style={{ fontSize: "13px", color: "#666" }}>
                MiniMax: {minimaxOk ? "已配置" : "请在 .env 中设置 MINIMAX_API_KEY"}<br/>
                laozhang: {laozhangOk ? "已配置" : "请在 .env 中设置 LAOZHANG_API_KEY"}
              </div>
            </div>

            <div style={{ fontSize: "12px", color: "#999", padding: "12px", background: "#f9f9f9", border: "1px solid #eee", borderRadius: "4px" }}>
              提示：API Keys 存储在 .env 文件中，由 Flask 后端读取，不暴露给浏览器。
            </div>

            <button className="btn-secondary" style={{ marginTop: "24px", width: "100%" }} onClick={() => setShowModal(false)}>
              关闭
            </button>
          </div>
        </div>
      )}
    </>
  );
}