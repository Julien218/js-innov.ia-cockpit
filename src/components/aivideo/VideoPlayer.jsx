import { Download } from "lucide-react";

export default function VideoPlayer({ videoUrl, projectName }) {
  function handleDownload() {
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `${(projectName || "video").replace(/\s+/g, "_")}_video.mp4`;
    a.target = "_blank";
    a.click();
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
        <h2 className="font-semibold text-white text-base">Generated Video</h2>
        <button onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 rounded-md text-xs text-white transition-colors">
          <Download size={12} /> Download
        </button>
      </div>
      <div className="p-4">
        <video
          src={videoUrl}
          controls
          className="w-full rounded-lg bg-black"
          style={{ maxHeight: "360px" }}
        />
        <p className="mt-2 text-xs text-gray-500 break-all">{videoUrl}</p>
      </div>
    </div>
  );
}
