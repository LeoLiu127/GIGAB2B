interface LightboxProps {
  url: string;
  label: string;
  onClose: () => void;
}

export function Lightbox({ url, label, onClose }: LightboxProps) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}
      onClick={onClose}
    >
      <div style={{ position: "relative", maxWidth: "90vw", maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
        <img src={url} alt={label} style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: "4px" }} />
        <div style={{ color: "#fff", marginTop: "12px", textAlign: "center", fontSize: "14px" }}>{label}</div>
        <button
          onClick={onClose}
          style={{ position: "absolute", top: "-40px", right: "0", background: "none", border: "none", color: "#fff", fontSize: "20px", cursor: "pointer" }}
        >✕</button>
      </div>
    </div>
  );
}