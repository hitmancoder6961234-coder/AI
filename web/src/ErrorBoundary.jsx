import React from "react";

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Clarity UI Error Boundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          padding: "24px",
          background: "var(--surface, #f8fafc)",
          color: "var(--ink, #0f172a)",
          fontFamily: "var(--font-sans, system-ui, sans-serif)",
          textAlign: "center"
        }}>
          <div style={{
            maxWidth: "500px",
            padding: "32px",
            background: "var(--surface, #ffffff)",
            borderRadius: "12px",
            border: "1px solid var(--line, #e2e8f0)",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05)"
          }}>
            <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "12px", color: "var(--danger, #dc2626)" }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: "14px", color: "var(--ink-secondary, #475569)", marginBottom: "20px", lineHeight: "1.5" }}>
              An unexpected error occurred in the application UI. You can try reloading the page to resume your session.
            </p>
            {this.state.error && (
              <pre style={{
                fontSize: "12px",
                background: "var(--surface-muted, #f1f5f9)",
                padding: "10px",
                borderRadius: "6px",
                overflowX: "auto",
                textAlign: "left",
                marginBottom: "20px",
                color: "var(--danger, #b91c1c)",
                maxHeight: "120px"
              }}>
                {this.state.error.toString()}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "var(--accent, #4f46e5)",
                color: "#ffffff",
                border: "none",
                padding: "10px 20px",
                borderRadius: "8px",
                fontWeight: "600",
                fontSize: "14px",
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(79, 70, 229, 0.2)"
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
