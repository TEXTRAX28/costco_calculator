import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { STORAGE_KEY } from "./lib/storage";
import "./styles.css";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean; error?: string }
> {
  state: { failed: boolean; error?: string } = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="fatal">
          <h1>Let’s give that another go.</h1>
          <p>
            The app hit an unexpected error. Reload to recover your saved draft,
            or delete it to start fresh.
          </p>
          <button onClick={() => location.reload()}>Reload app</button>
          <button
            onClick={() => {
              if (!window.confirm("Clear this browser’s saved Gather draft?"))
                return;
              try {
                localStorage.removeItem(STORAGE_KEY);
                location.reload();
              } catch {
                this.setState({
                  error:
                    "Could not clear the saved draft. Use the browser’s site settings to clear Gather data.",
                });
              }
            }}
          >
            Delete local draft
          </button>
          {this.state.error && <p role="alert">{this.state.error}</p>}
        </main>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
