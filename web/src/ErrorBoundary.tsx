import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

/**
 * 顶层 ErrorBoundary：捕获任何子组件渲染时抛出的同步错误，
 * 避免单个组件 bug 让整个应用白屏（严重 S-7 修复）。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });
    // 服务端有日志的话这里可以 fetch 上报；本项目暂无,只 console
    console.error("[ErrorBoundary]", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fafafa",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            padding: "20px",
          }}
        >
          <div
            style={{
              maxWidth: "640px",
              background: "#fff",
              border: "1px solid #ffcdd2",
              borderRadius: "8px",
              padding: "32px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>⚠️</div>
            <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "0 0 8px", color: "#c62828" }}>
              应用遇到了一个错误
            </h1>
            <p style={{ fontSize: "14px", color: "#666", margin: "0 0 20px" }}>
              页面渲染时发生异常。你可以重置组件状态后继续,或刷新页面。
            </p>
            <div
              style={{
                background: "#fff5f5",
                border: "1px solid #ffcdd2",
                borderRadius: "4px",
                padding: "12px",
                marginBottom: "20px",
                fontSize: "12px",
                color: "#c62828",
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: "200px",
                overflowY: "auto",
              }}
            >
              {String(this.state.error?.message || this.state.error || "未知错误")}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={this.handleReset}
                style={{
                  padding: "8px 16px",
                  background: "#1976d2",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                重置组件
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: "8px 16px",
                  background: "#fff",
                  color: "#333",
                  border: "1px solid #ccc",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                }}
              >
                刷新页面
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}