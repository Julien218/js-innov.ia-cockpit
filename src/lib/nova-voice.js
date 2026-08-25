function voiceScore(voice, preferredName = '') {
  const name = String(voice?.name || '');
  const lang = String(voice?.lang || '').toLowerCase();
  let score = name === preferredName ? 1000 : 0;
  if (lang === 'fr-be') score += 400;
  else if (lang === 'fr-fr') score += 300;
  else if (lang.startsWith('fr')) score += 120;
  if (/natural|online/i.test(name)) score += 80;
  if (/charline|denise|vivienne|hortense|julie|audrey|sylvie/i.test(name)) score += 60;
  if (/canada|canadian|fr-ca/i.test(`${name} ${lang}`)) score -= 200;
  return score;
}

export function chooseNovaVoice(voices = [], preferredName = '') {
  return [...voices]
    .filter((voice) => String(voice?.lang || '').toLowerCase().startsWith('fr'))
    .sort((a, b) => voiceScore(b, preferredName) - voiceScore(a, preferredName))[0] || null;
}

