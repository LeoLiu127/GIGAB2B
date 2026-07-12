import { useState } from "react";
import type { ServerStatus } from "../types";
import { THEME_PICKER_OPTIONS, type ThemeIcon, type ThemeId } from "../theme";

interface HeaderProps {
  status: ServerStatus | null;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}

export function Header({ status, theme, onThemeChange }: HeaderProps) {
  const [showModal, setShowModal] = useState(false);

  if (!status) return null;

  const studio = status.image_studio;
  const gigaMarkets = Object.entries(status.giga_markets).filter(([, v]) => v);

  const minimaxOk = studio.providers?.minimax === "configured";
  const laozhangOk = studio.providers?.laozhang === "configured";

  return (
    <>
      <div className="app-header-tools" style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <div className="theme-control" role="group" aria-label="Theme">
          {THEME_PICKER_OPTIONS.map(option => (
            <button
              key={option.id}
              type="button"
              className={`theme-picker-button${theme === option.id ? " is-active" : ""}`}
              aria-label={option.ariaLabel}
              aria-pressed={theme === option.id}
              title={option.label}
              onClick={() => onThemeChange(option.id)}
            >
              <ThemePickerIcon icon={option.icon} />
            </button>
          ))}
        </div>
        <span style={{ fontSize: "11px", color: "var(--theme-text-muted)" }}>系统状态：</span>

        <span className={`badge ${minimaxOk ? "badge-ok" : "badge-warn"}`}>
          文案优化大模型 {minimaxOk ? "OK" : "未配置"}
        </span>

        <span className={`badge ${laozhangOk ? "badge-ok" : "badge-warn"}`}>
          生图大模型 {laozhangOk ? "OK" : "未配置"}
        </span>

        {gigaMarkets.length > 0 && (
          <span className="badge badge-ok">
            GIGAB2B API OK
          </span>
        )}

        <button
          onClick={() => setShowModal(true)}
          style={{ background: "none", border: "none", fontSize: "12px", color: "var(--theme-text-muted)", cursor: "pointer", padding: "4px 8px", textDecoration: "underline" }}
        >
          详情
        </button>
      </div>

      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "var(--theme-overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setShowModal(false)}>
          <div style={{ background: "var(--theme-surface)", color: "var(--theme-text-primary)", padding: "40px", width: "100%", maxWidth: "520px", borderRadius: "4px" }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: "18px", fontWeight: 500, marginBottom: "24px" }}>系统状态详情</h3>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>GIGAB2B API 凭证</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                {Object.entries(status.giga_markets).map(([market, ok]) => (
                  <div key={market} style={{ fontSize: "13px" }}>
                    <span style={{ color: ok ? "#2e7d32" : "#c62828" }}>{ok ? "OK" : "缺失"}</span>
                    {" · "}
                    {market}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontWeight: 500, marginBottom: "8px" }}>大模型配置</div>
              <div style={{ fontSize: "13px", color: "var(--theme-text-secondary)" }}>
                文案优化大模型: {minimaxOk ? "已配置" : "请在服务器 .env 中设置 MINIMAX_API_KEY"}<br/>
                生图大模型: {laozhangOk ? "已配置" : "请在服务器 .env 中设置 LAOZHANG_API_KEY"}
              </div>
            </div>

            <div style={{ fontSize: "12px", color: "var(--theme-text-muted)", padding: "12px", background: "var(--theme-surface-soft)", border: "1px solid var(--theme-border-soft)", borderRadius: "4px" }}>
              提示：API Keys 仅存放在服务器本地 .env 文件（git 忽略，永不进仓库），由 Flask 后端读取，不暴露给浏览器。
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

function ThemePickerIcon({ icon }: { icon: ThemeIcon }) {
  if (icon === "circle") {
    return <span className="theme-picker-dot" aria-hidden="true" />;
  }

  if (icon === "sun") {
    return (
      <svg className="theme-picker-svg" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
      </svg>
    );
  }

  return (
    <svg className="theme-picker-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.2 14.4A7.8 7.8 0 0 1 9.6 3.8a8.2 8.2 0 1 0 10.6 10.6Z" />
    </svg>
  );
}
