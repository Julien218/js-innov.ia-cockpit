import { CheckCircle, AlertCircle, Loader2, Clock, Film, FileText } from "lucide-react";

const STATUS_CONFIG = {
  idle:               { label: "Ready",              color: "text-gray-400",   bg: "bg-gray-800",    icon: Clock },
  validating:         { label: "Validating…",        color: "text-yellow-400", bg: "bg-yellow-900/30", icon: Loader2, spin: true },
  report_generating:  { label: "Generating Report…", color: "text-blue-400",   bg: "bg-blue-900/30", icon: FileText, pulse: true },
  video_queued:       { label: "Video Queued…",      color: "text-purple-400", bg: "bg-purple-900/30", icon: Loader2, spin: true },
  video_generating:   { label: "Video Generating…",  color: "text-purple-400", bg: "bg-purple-900/30", icon: Film, pulse: true },
  video_downloading:  { label: "Downloading Video…", color: "text-cyan-400",   bg: "bg-cyan-900/30", icon: Loader2, spin: true },
  completed:          { label: "Completed",           color: "text-green-400",  bg: "bg-green-900/30", icon: CheckCircle },
  error:              { label: "Error",               color: "text-red-400",    bg: "bg-red-900/30",  icon: AlertCircle },
};

export default function StatusPanel({ project }) {
  if (!project) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="font-semibold text-white text-base mb-3">Status</h2>
        <p className="text-sm text-gray-500">No project selected. Fill in the form and save.</p>
      </div>
    );
  }

  const status = project.status || "idle";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  const Icon = cfg.icon;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 space-y-4">
      <h2 className="font-semibold text-white text-base">Status</h2>

      {/* Status badge */}
      <div className={`flex items-center gap-2.5 px-4 py-3 rounded-lg ${cfg.bg}`}>
        <Icon size={16} className={`${cfg.color} ${cfg.spin ? "animate-spin" : ""} ${cfg.pulse ? "animate-pulse" : ""}`} />
        <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
      </div>

      {/* Progress label */}
      {project.progress_label && (
        <p className="text-xs text-gray-400 animate-pulse">{project.progress_label}</p>
      )}

      {/* Error message */}
      {project.status === "error" && project.error_message && (
        <div className="bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2.5 text-xs text-red-300">
          {project.error_message}
        </div>
      )}

      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
        {project.video_job_id && (
          <div className="col-span-2">
            <span className="text-gray-600">Job ID: </span>
            <span className="font-mono text-gray-400">{project.video_job_id}</span>
          </div>
        )}
        {project.video_prompt && (
          <div className="col-span-2">
            <p className="text-gray-600 mb-1">Video Prompt:</p>
            <p className="text-gray-400 line-clamp-3 leading-relaxed">{project.video_prompt}</p>
          </div>
        )}
      </div>
    </div>
  );
}
