import React from "react";
import { AlertTriangle, RefreshCw, Home, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("[AppErrorBoundary]", error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      const isDev = import.meta.env?.DEV;
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
          <div className="bg-red-500/10 rounded-full p-5 mb-6">
            <AlertTriangle className="w-10 h-10 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            Une erreur est survenue sur cette page.
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mb-6">
            {this.state.error?.message || "Erreur inconnue"}
          </p>
          {isDev && this.state.error?.stack && (
            <pre className="text-[11px] text-red-400/70 bg-red-500/5 border border-red-500/10 rounded-lg p-4 max-w-2xl max-h-48 overflow-auto mb-6 text-left font-mono">
              {this.state.error.stack}
            </pre>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Retour
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Recharger
            </Button>
            <a href="/">
              <Button
                size="sm"
                className="gap-2 gradient-primary border-0 text-white"
              >
                <Home className="w-3.5 h-3.5" /> Dashboard
              </Button>
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
