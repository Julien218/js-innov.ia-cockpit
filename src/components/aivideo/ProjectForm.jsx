import { useRef, useState } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Upload, Link, Loader2, X } from "lucide-react";

export default function ProjectForm({ formData, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [imageMode, setImageMode] = useState("upload"); // upload | url
  const fileRef = useRef();

  function set(key, val) {
    onChange(prev => ({ ...prev, [key]: val }));
  }

  async function handleUpload(file) {
    setUploading(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    set("image_url", file_url);
    setUploading(false);
  }

  const inputClass = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50";
  const labelClass = "block text-xs font-medium text-gray-400 mb-1.5 uppercase tracking-wide";

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
      <h2 className="font-semibold text-white text-base">Project Info</h2>

      {/* Name */}
      <div>
        <label className={labelClass}>Name <span className="text-red-400">*</span></label>
        <input value={formData.name} onChange={e => set("name", e.target.value)}
          placeholder="e.g. Alex Johnson" disabled={disabled} className={inputClass} />
      </div>

      {/* Age */}
      <div>
        <label className={labelClass}>Age</label>
        <input type="number" value={formData.age} onChange={e => set("age", e.target.value)}
          placeholder="e.g. 28" disabled={disabled} className={inputClass} />
      </div>

      {/* YouTube Channel */}
      <div>
        <label className={labelClass}>YouTube Channel</label>
        <input value={formData.youtube_channel} onChange={e => set("youtube_channel", e.target.value)}
          placeholder="e.g. @alexjohnson" disabled={disabled} className={inputClass} />
      </div>

      {/* Director */}
      <div>
        <label className={labelClass}>Director Style</label>
        <input value={formData.director} onChange={e => set("director", e.target.value)}
          placeholder="e.g. Christopher Nolan, Wes Anderson" disabled={disabled} className={inputClass} />
      </div>

      {/* Description */}
      <div>
        <label className={labelClass}>Description <span className="text-red-400">*</span></label>
        <textarea value={formData.description} onChange={e => set("description", e.target.value)}
          placeholder="Describe the subject, their content, goals, style…"
          rows={4} disabled={disabled}
          className={inputClass + " resize-none"} />
      </div>

      {/* Image */}
      <div>
        <label className={labelClass}>Image <span className="text-red-400">* (required for video)</span></label>
        <div className="flex gap-2 mb-2">
          <button onClick={() => setImageMode("upload")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${imageMode === "upload" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
            <Upload size={11} className="inline mr-1" />Upload
          </button>
          <button onClick={() => setImageMode("url")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${imageMode === "url" ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}>
            <Link size={11} className="inline mr-1" />URL
          </button>
        </div>

        {imageMode === "upload" && (
          <div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => e.target.files[0] && handleUpload(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={disabled || uploading}
              className="w-full border-2 border-dashed border-gray-700 hover:border-indigo-500 rounded-lg py-4 text-sm text-gray-400 hover:text-gray-200 transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {uploading ? "Uploading…" : "Click to upload image"}
            </button>
          </div>
        )}

        {imageMode === "url" && (
          <input value={formData.image_url} onChange={e => set("image_url", e.target.value)}
            placeholder="https://…" disabled={disabled} className={inputClass} />
        )}

        {formData.image_url && (
          <div className="mt-3 relative inline-block">
            <img src={formData.image_url} alt="Preview" className="h-24 w-auto rounded-lg object-cover border border-gray-700" />
            <button onClick={() => set("image_url", "")}
              className="absolute -top-2 -right-2 w-5 h-5 bg-gray-700 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors">
              <X size={10} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
