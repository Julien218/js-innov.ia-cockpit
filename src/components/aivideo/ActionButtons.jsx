import { FileText, Video, Zap, Loader2 } from "lucide-react";

export default function ActionButtons({ onReport, onVideo, onAll, loading, isVideoRunning, isReportRunning, hasImage }) {
  const reportDisabled = loading.report || loading.all || isReportRunning;
  const videoDisabled = loading.video || loading.all || isVideoRunning || !hasImage;
  const allDisabled = loading.report || loading.video || loading.all || isVideoRunning || isReportRunning;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-3">
      <h2 className="font-semibold text-white text-base mb-4">Actions</h2>

      <button onClick={onReport} disabled={reportDisabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading.report ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
        {loading.report ? "Generating Report…" : "Generate Report"}
      </button>

      <button onClick={onVideo} disabled={videoDisabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-purple-700 hover:bg-purple-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading.video ? <Loader2 size={15} className="animate-spin" /> : <Video size={15} />}
        {loading.video ? "Submitting Video…" : isVideoRunning ? "Video In Progress…" : "Generate Video"}
      </button>
      {!hasImage && (
        <p className="text-xs text-gray-500 text-center">Upload an image to enable video generation</p>
      )}

      <button onClick={onAll} disabled={allDisabled}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        {loading.all ? <Loader2 size={15} className="animate-spin" /> : <Zap size={15} />}
        {loading.all ? "Generating Everything…" : "Generate All"}
      </button>
    </div>
  );
}
