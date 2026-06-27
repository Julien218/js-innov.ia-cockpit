import { Clock, CheckCircle, AlertCircle, Loader2, Film, FileText, Plus } from "lucide-react";

const STATUS_ICONS = {
  idle: { icon: Clock, color: "text-gray-400" },
  validating: { icon: Loader2, color: "text-yellow-400", spin: true },
  report_generating: { icon: FileText, color: "text-blue-400", pulse: true },
  video_queued: { icon: Loader2, color: "text-purple-400", spin: true },
  video_generating: { icon: Film, color: "text-purple-400", pulse: true },
  video_downloading: { icon: Loader2, color: "text-cyan-400", spin: true },
  completed: { icon: CheckCircle, color: "text-green-400" },
  error: { icon: AlertCircle, color: "text-red-400" },
};

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function RecentProjects({ projects, onOpen, onNew }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">Recent Projects</h2>
        <button onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          <Plus size={15} /> New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-16 text-center">
          <div className="text-5xl mb-4">🎬</div>
          <p className="text-gray-400 mb-6">No projects yet. Create your first one!</p>
          <button onClick={onNew}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors">
            Get Started
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(p => {
            const cfg = STATUS_ICONS[p.status] || STATUS_ICONS.idle;
            const Icon = cfg.icon;
            return (
              <button key={p.id} onClick={() => onOpen(p)}
                className="bg-gray-900 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-xl p-5 text-left transition-all group">
                <div className="flex items-start justify-between mb-3">
                  <span className="font-semibold text-white text-sm group-hover:text-indigo-300 transition-colors line-clamp-1">{p.name}</span>
                  <Icon size={14} className={`${cfg.color} shrink-0 ml-2 mt-0.5 ${cfg.spin ? "animate-spin" : ""} ${cfg.pulse ? "animate-pulse" : ""}`} />
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 mb-3">{p.description}</p>
                <div className="flex items-center justify-between text-xs text-gray-600">
                  <span className={cfg.color}>{(p.status || "idle").replace(/_/g, " ")}</span>
                  <span>{formatDate(p.created_date)}</span>
                </div>
                {p.report && <div className="mt-2 text-xs text-blue-400">✓ Report</div>}
                {p.video_url && <div className="mt-1 text-xs text-green-400">✓ Video</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
