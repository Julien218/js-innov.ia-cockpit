const EMOJI_RE = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]/gu;

export function cleanSpeechText(text) {
  return String(text || '')
    .replace(/\[Contexte Dropbox[^\]]*\]/gi, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/https?:\/\/\S+/gi, 'lien internet')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, 'identifiant du journal')
    .replace(EMOJI_RE, ' ')
    .replace(/[#*_~>|]/g, ' ')
    .replace(/[\uFE0E\uFE0F]/g, '')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.{2,}/g, '.')
    .trim();
}

export function chunkSpeechText(text, maxChars = 260) {
  const clean = cleanSpeechText(text);
  if (!clean) return [];

  const sentences = clean.match(/[^.!?;:]+[.!?;:]?|.+$/g) || [clean];
  const chunks = [];
  let current = '';

  const flush = () => {
    const value = current.trim();
    if (value) chunks.push(value);
    current = '';
  };

  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if (part.length <= maxChars) {
      const combined = current ? `${current} ${part}` : part;
      if (combined.length <= maxChars) current = combined;
      else { flush(); current = part; }
      continue;
    }

    flush();
    const words = part.split(/\s+/);
    for (const word of words) {
      const combined = current ? `${current} ${word}` : word;
      if (combined.length <= maxChars) current = combined;
      else {
        flush();
        if (word.length <= maxChars) current = word;
        else {
          for (let i = 0; i < word.length; i += maxChars) chunks.push(word.slice(i, i + maxChars));
        }
      }
    }
    flush();
  }
  flush();
  return chunks;
}

export function speakAll({ text, voice, lang = 'fr-BE', rate = 0.96, pitch = 1, onStart, onDone, onError }) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onDone?.();
    return () => {};
  }

  const chunks = chunkSpeechText(text);
  if (!chunks.length) {
    onDone?.();
    return () => {};
  }

  let cancelled = false;
  let index = 0;
  window.speechSynthesis.cancel();
  onStart?.();

  const next = () => {
    if (cancelled) return;
    if (index >= chunks.length) {
      onDone?.();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunks[index]);
    utterance.lang = voice?.lang || lang;
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (voice) utterance.voice = voice;
    utterance.onend = () => { index += 1; next(); };
    utterance.onerror = (event) => {
      if (cancelled) return;
      onError?.(event);
      onDone?.();
    };
    window.speechSynthesis.speak(utterance);
  };

  next();
  return () => {
    cancelled = true;
    window.speechSynthesis.cancel();
  };
}
