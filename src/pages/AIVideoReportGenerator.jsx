import { useState, useEffect, useRef } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import ProjectForm from "@/components/aivideo/ProjectForm";
import RecentProjects from "@/components/aivideo/RecentProjects";
import StatusPanel from "@/components/aivideo/StatusPanel";
import ReportViewer from "@/components/aivideo/ReportViewer";
import VideoPlayer from "@/components/aivideo/VideoPlayer";
import ActionButtons from "@/components/aivideo/ActionButtons";
import { ArrowLeft } from "lucide-react";

const POLLING_STATUSES = ["video_queued", "video_generating", "video_downloading"];
const POLL_INTERVAL_MS = 5000;

export default function AIVideoReportGenerator() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [formData, setFormData] = useState({ name: "", age: "", youtube_channel: "", director: "", description: "", image_url: "" });
  const [loading, setLoading] = useState({ report: false, video: false, all: false });
  const [error, setError] = useState(null);
  const [view, setView] = useState("list"); // list | edit | new
  const pollRef = useRef(null);

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProject) return;
    if (POLLING_STATUSES.includes(selectedProject.status)) {
      startPolling(selectedProject.id);
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [selectedProject?.status, selectedProject?.id]);

  async function loadProjects() {
    const list = await base44.entities.AIVideoReport.list("-created_date", 20);
    setProjects(list);
  }

  function startPolling(projectId) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const [fresh] = await base44.entities.AIVideoReport.filter({ id: projectId });
      if (fresh) {
        setSelectedProject(fresh);
        if (!POLLING_STATUSES.includes(fresh.status)) {
          stopPolling();
          loadProjects();
        } else {
          // Trigger a server-side poll step
          base44.functions.invoke('pollVideoJob', { projectId }).catch(console.error);
        }
      }
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  function openNew() {
    setSelectedProject(null);
    setFormData({ name: "", age: "", youtube_channel: "", director: "", description: "", image_url: "" });
    setError(null);
    setView("new");
  }

  async function openProject(project) {
    setSelectedProject(project);
    setFormData({
      name: project.name || "",
      age: project.age ?? "",
      youtube_channel: project.youtube_channel || "",
      director: project.director || "",
      description: project.description || "",
      image_url: project.image_url || "",
    });
    setError(null);
    setView("edit");
  }

  async function saveProject() {
    const data = {
      name: formData.name.trim(),
      age: formData.age !== "" ? Number(formData.age) : null,
      youtube_channel: formData.youtube_channel.trim() || null,
      director: formData.director.trim() || null,
      description: formData.description.trim(),
      image_url: formData.image_url.trim() || null,
    };

    if (!data.name) { setError("Name is required."); return null; }
    if (!data.description) { setError("Description is required."); return null; }

    let project;
    if (selectedProject?.id) {
      project = await base44.entities.AIVideoReport.update(selectedProject.id, data);
    } else {
      project = await base44.entities.AIVideoReport.create({ ...data, status: "idle" });
    }
    setSelectedProject(project);
    setView("edit");
    await loadProjects();
    return project;
  }

  async function handleGenerateReport() {
    setError(null);
    const project = await saveProject();
    if (!project) return;
    setLoading(l => ({ ...l, report: true }));
    const res = await base44.functions.invoke('generateReport', { projectId: project.id });
    setLoading(l => ({ ...l, report: false }));
    if (!res.data?.success) {
      setError(res.data?.error || "Report generation failed.");
    }
    const [fresh] = await base44.entities.AIVideoReport.filter({ id: project.id });
    if (fresh) setSelectedProject(fresh);
    loadProjects();
  }

  async function handleGenerateVideo() {
    setError(null);
    const project = await saveProject();
    if (!project) return;
    setLoading(l => ({ ...l, video: true }));
    const res = await base44.functions.invoke('generateVideo', { projectId: project.id });
    setLoading(l => ({ ...l, video: false }));
    if (!res.data?.success) {
      setError(res.data?.error || "Video generation failed.");
    }
    const [fresh] = await base44.entities.AIVideoReport.filter({ id: project.id });
    if (fresh) setSelectedProject(fresh);
    loadProjects();
  }

  async function handleGenerateAll() {
    setError(null);
    const project = await saveProject();
    if (!project) return;
    setLoading(l => ({ ...l, all: true }));
    const res = await base44.functions.invoke('generateAll', { projectId: project.id });
    setLoading(l => ({ ...l, all: false }));
    if (res.data?.success === false) {
      setError(res.data?.error || "Generation failed.");
    } else if (res.data?.success === 'partial') {
      setError(`Report saved, but video failed: ${res.data.error}`);
    }
    const [fresh] = await base44.entities.AIVideoReport.filter({ id: project.id });
    if (fresh) setSelectedProject(fresh);
    loadProjects();
  }

  const isVideoRunning = POLLING_STATUSES.includes(selectedProject?.status);
  const isReportRunning = selectedProject?.status === "report_generating";
  const anyLoading = loading.report || loading.video || loading.all;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {view !== "list" && (
            <button onClick={() => { setView("list"); stopPolling(); }} className="text-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">AI Video Report Generator</h1>
            <p className="text-xs text-gray-500">Generate professional reports & AI videos from profiles</p>
          </div>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors">
          + New Project
        </button>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {view === "list" && (
          <RecentProjects projects={projects} onOpen={openProject} onNew={openNew} />
        )}

        {(view === "edit" || view === "new") && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left column */}
            <div className="space-y-6">
              <ProjectForm
                formData={formData}
                onChange={setFormData}
                disabled={anyLoading || isVideoRunning || isReportRunning}
              />
              <ActionButtons
                onReport={handleGenerateReport}
                onVideo={handleGenerateVideo}
                onAll={handleGenerateAll}
                loading={loading}
                isVideoRunning={isVideoRunning}
                isReportRunning={isReportRunning}
                hasImage={!!formData.image_url}
              />
              {error && (
                <div className="bg-red-900/30 border border-red-700/50 text-red-300 rounded-lg px-4 py-3 text-sm">
                  {error}
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="space-y-6">
              <StatusPanel project={selectedProject} />
              {selectedProject?.report && <ReportViewer report={selectedProject.report} projectName={selectedProject.name} />}
              {selectedProject?.video_url && <VideoPlayer videoUrl={selectedProject.video_url} projectName={selectedProject.name} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
