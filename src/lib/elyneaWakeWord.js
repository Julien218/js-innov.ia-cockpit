export const ELYNEA_WAKE_WORDS = Object.freeze([
  'elynea',
  'elyna',
  'elina',
  'elena',
  'helena',
]);

export function normalizeWakeSpeech(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractElyneaWakeCommand(value) {
  const original = String(value || '').trim();
  const normalized = normalizeWakeSpeech(original);
  if (!normalized) return { detected: false, wakeWord: null, command: '' };

  for (const wakeWord of ELYNEA_WAKE_WORDS) {
    const pattern = new RegExp(`(?:^|\\s)${wakeWord}(?:\\s|$)`, 'i');
    const match = normalized.match(pattern);
    if (!match) continue;

    const wakeIndex = normalized.indexOf(wakeWord, match.index || 0);
    const trailingNormalized = normalized.slice(wakeIndex + wakeWord.length).trim();
    let command = '';

    if (trailingNormalized) {
      const originalNormalized = normalizeWakeSpeech(original);
      const originalWakeIndex = originalNormalized.indexOf(wakeWord);
      if (originalWakeIndex >= 0) {
        const wordsBefore = originalNormalized.slice(0, originalWakeIndex).trim();
        const beforeWordCount = wordsBefore ? wordsBefore.split(/\s+/).length : 0;
        const originalWords = original.replace(/[,:;!?]+/g, ' ').trim().split(/\s+/);
        command = originalWords.slice(beforeWordCount + 1).join(' ').trim();
      }
    }

    return { detected: true, wakeWord, command };
  }

  return { detected: false, wakeWord: null, command: '' };
}
