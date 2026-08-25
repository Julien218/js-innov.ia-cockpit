const LOCAL_OPERATION = /\b(?:ffmpeg|ffprobe|comfyui|ollama|qwen|workflow local|fichier local|dossier local|outil local|agent local|windows|hors connexion|sans internet)\b/i;
const BUSINESS_OR_COMPLEX = /\b(?:architecture|impl[eé]mente|corrige|d[eé]ploie|refactor|debug|s[eé]curis|client|projet|facture|devis|budget|co[uû]t|llm|api|dns|tls|railway|github|base44|supabase|t[aâ]che)\b/i;
const SIMPLE = /^(?:bonjour|salut|merci|oui|non|ok|d'accord|qui es-tu|aide-moi)[\s!.?]*$/i;

export function shouldUseLocalFirst(message, localAvailable = true) {
  if (!localAvailable) return false;
  const text = String(message || '').trim();
  if (LOCAL_OPERATION.test(text)) return true;
  if (BUSINESS_OR_COMPLEX.test(text) || text.length > 220) return false;
  return SIMPLE.test(text);
}

