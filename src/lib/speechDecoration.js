// Keep readable wording; discard visual Markdown and decorative emoji for TTS only.
export function speechDecoration(text) {
  return String(text || '')
    .replace(/\\([*_~`#>|-])/g, '$1')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, '')
    .replace(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator})[\uFE0F\u200D\u20E3\p{Emoji_Modifier}]*/gu, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/^\s*["'’‘“”]+\s*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]*\)/g, '$1')
    .replace(/[#*_~`]/g, '')
    .replace(/^\s*[>|]\s?/gm, '')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/(?:^|\s)-{3,}(?=\s|$)/g, ' ')
    .replace(/^\s*["'’‘“”]+\s*$/gm, '')
    .trim();
}
