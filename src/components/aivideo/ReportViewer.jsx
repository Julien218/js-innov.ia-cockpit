import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Download, Copy, Check, ChevronDown, ChevronUp } from "lucide-react";

export default function ReportViewer({ report, projectName }) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload(format) {
    const ext = format === "md" ? "md" : "txt";
    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(projectName || "report").replace(/\s+/g, "_")}_report.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="font-semibold text-white text-base">Generated Report</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-xs text-gray-300 transition-colors">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            {copied ? "Copied!" : "Copy"}
          </button>
          <button onClick={() => handleDownload("md")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-xs text-gray-300 transition-colors">
            <Download size={12} /> .md
          </button>
          <button onClick={() => handleDownload("txt")}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-xs text-gray-300 transition-colors">
            <Download size={12} /> .txt
          </button>
          <button onClick={() => setCollapsed(c => !c)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors">
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-5 max-h-[600px] overflow-y-auto">
          <ReactMarkdown
            className="prose prose-sm prose-invert max-w-none [&_h1]:text-white [&_h2]:text-indigo-300 [&_h3]:text-gray-200 [&_strong]:text-white [&_p]:text-gray-300 [&_li]:text-gray-300 [&_h2]:mt-5 [&_h2]:mb-2"
          >
            {report}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}
