export function createTemplateProject(template, date = new Date()) {
    const now = date.getTime();
    const tracks = template.tracks.map(track => ({
      ...track,
      clips: track.clips.map(clip => ({ ...clip, id: `${clip.id}_${now}` })),
    }));
    return {
      title: `${template.label} — ${date.toLocaleDateString("fr-FR")}`,
      // Placeholder scenes and text overlays are not source media.
      clips: tracks.filter(t => ["video", "image"].includes(t.type)).flatMap(t => t.clips).filter(c => c.url),
      transition: template.transitions,
      status: "draft",
      ai_prompt: "",
      audio_name: "",
      audio_url: "",
      texts: tracks.filter(t => t.type === "text").flatMap(t =>
        t.clips.map(c => ({
          content: c.content,
          position: c.style?.position || "center",
          color: c.style?.color || "#ffffff",
          size: `${c.style?.fontSize || 36}px`,
          bold: c.style?.bold || false,
          animation: c.style?.animation || "fadeIn",
          startTime: c.startTime,
          duration: c.duration,
        }))
      ),
      // Stocker les données de template enrichies
      metadata: { template_id: template.id, template_colors: template.colors },
      template_tracks: tracks,
      template_duration: template.duration,
      template_format: template.format,

    };
}

export function templateDimensions(format) {
  return ({'9:16':[1080,1920], '1:1':[1080,1080], '16:9':[1920,1080], '2:3':[1080,1620]})[format] || [1920,1080];
}
