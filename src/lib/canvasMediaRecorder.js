function recorderMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)) || '';
}

function clockNow() {
  return globalThis.performance && typeof globalThis.performance.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

// Canvas capture is real-time: pacing each rendered frame keeps the WebM duration
// aligned with the audio instead of stopping after a tight CPU-bound loop.
export async function paceCanvasFrame(frame, fps = 30, startedAt = clockNow()) {
  const safeFps = Math.max(1, Number(fps) || 30);
  const target = startedAt + ((Number(frame) + 1) / safeFps) * 1000;
  const delay = target - clockNow();
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
}
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(type)) || '';
}

function stopTracks(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function waitForAudioMetadata(audio) {
  if (audio.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('error', handleError);
    };
    const handleMetadata = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error('La source audio ne peut pas être lue par le navigateur.'));
    };
    audio.addEventListener('loadedmetadata', handleMetadata, { once: true });
    audio.addEventListener('error', handleError, { once: true });
    audio.load();
  });
}

export async function createCanvasRecorder({
  canvas,
  fps = 30,
  audioUrl = '',
  videoBitsPerSecond = 8_000_000,
} = {}) {
  if (!canvas?.captureStream || typeof globalThis.MediaRecorder !== 'function') {
    throw new Error('L’enregistrement vidéo n’est pas disponible dans ce navigateur.');
  }

  const videoStream = canvas.captureStream(fps);
  let stream = videoStream;
  let audio = null;
  let audioContext = null;
  let audioSource = null;
  let audioDestination = null;
  let recorder = null;
  let stopped = false;

  const cleanup = async () => {
    audio?.pause();
    if (audio) {
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    }
    audioSource?.disconnect?.();
    audioDestination?.stream && stopTracks(audioDestination.stream);
    stopTracks(stream);
    if (stream !== videoStream) stopTracks(videoStream);
    if (audioContext) await audioContext.close().catch(() => {});
  };

  try {
    if (audioUrl) {
      const AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextImpl || typeof globalThis.MediaStream !== 'function') {
        throw new Error('La capture audio nécessite Chrome ou Edge à jour.');
      }

      audio = new globalThis.Audio();
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.src = audioUrl;
      await waitForAudioMetadata(audio);

      audioContext = new AudioContextImpl();
      audioSource = audioContext.createMediaElementSource(audio);
      audioDestination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioDestination);
      stream = new globalThis.MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDestination.stream.getAudioTracks(),
      ]);
    }

    const mimeType = recorderMimeType();
    recorder = new globalThis.MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond,
    });

    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data?.size > 0) chunks.push(event.data);
    };

    if (audio) {
      await audioContext.resume?.();
      await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          audio.removeEventListener('play', handlePlay);
          reject(error instanceof Error ? error : new Error('Lecture audio impossible.'));
        };
        const handlePlay = () => {
          if (settled) return;
          try {
            recorder.start(200);
            settled = true;
            audio.removeEventListener('play', handlePlay);
            resolve();
          } catch (error) {
            fail(error);
          }
        };
        audio.addEventListener('play', handlePlay, { once: true });
        const playPromise = audio.play();
        playPromise?.catch?.(fail);
      });
    } else {
      recorder.start(200);
    }

    return {
      recorder,
      chunks,
      async stop() {
        if (!stopped) {
          stopped = true;
          if (recorder.state !== 'inactive') {
            await new Promise((resolve) => {
              recorder.addEventListener('stop', resolve, { once: true });
              recorder.stop();
            });
          }
          await cleanup();
        }
        return new Blob(chunks, { type: 'video/webm' });
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
