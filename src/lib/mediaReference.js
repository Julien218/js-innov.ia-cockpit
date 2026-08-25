function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function inspectMediaFile(file) {
  if (!file || typeof URL === 'undefined' || typeof document === 'undefined') return {};
  const isVideo = String(file.type || '').startsWith('video/');
  const isImage = String(file.type || '').startsWith('image/');
  if (!isVideo && !isImage) return {};

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const element = document.createElement(isVideo ? 'video' : 'img');
      let settled = false;
      const finish = (metadata = {}) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(Object.keys(metadata).length ? { source: 'browser-media-metadata', ...metadata } : {});
      };
      const timeout = window.setTimeout(() => finish(), 8000);
      element.onerror = () => finish();
      if (isVideo) {
        element.preload = 'metadata';
        element.onloadedmetadata = () => finish({
          width: finitePositive(element.videoWidth),
          height: finitePositive(element.videoHeight),
          durationSeconds: finitePositive(element.duration),
        });
      } else {
        element.onload = () => finish({
          width: finitePositive(element.naturalWidth),
          height: finitePositive(element.naturalHeight),
        });
      }
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
