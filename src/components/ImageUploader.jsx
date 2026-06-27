import { useState, useRef } from "react";
import { base44Shim as base44 } from "@/lib/supabaseVideoClient";
import { Upload, X, Image, Loader2 } from "lucide-react";

export default function ImageUploader({ images = [], onChange }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef();

  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    const urls = [];
    for (const file of files) {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      urls.push(file_url);
    }
    onChange([...images, ...urls]);
    setUploading(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    handleFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/")));
  };

  const removeImage = (idx) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-border hover:border-primary/50 rounded-xl p-6 text-center cursor-pointer transition-colors group"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFiles(Array.from(e.target.files))}
        />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span className="text-sm">Téléchargement en cours…</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground group-hover:text-foreground transition-colors">
            <Upload size={24} className="text-primary" />
            <span className="text-sm font-medium">Glissez vos images ici ou cliquez pour sélectionner</span>
            <span className="text-xs">JPG, PNG, WEBP — plusieurs fichiers acceptés</span>
          </div>
        )}
      </div>

      {/* Preview grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
          {images.map((url, idx) => (
            <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-border">
              <img src={url} alt={`Œuvre ${idx + 1}`} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => removeImage(idx)}
                  className="p-1.5 bg-destructive rounded-full text-white"
                >
                  <X size={12} />
                </button>
              </div>
              <div className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                {idx + 1}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="aspect-square rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
          >
            <Image size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
