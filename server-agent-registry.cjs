/**
 * Registre canonique JS-Innov.IA.
 *
 * Règle d'architecture : il n'existe qu'un seul agent IA public et logique,
 * Elynea. Les anciens « agents » sont désormais des compétences internes.
 * Leurs clés historiques restent stables pour ne pas casser les routes,
 * journaux, conversations ou données existantes.
 */
const { LED_AD_DIRECTOR_PROMPT } = require('./server-led-ad-director.cjs');

const ELYNEA_AGENT = Object.freeze({
  key: 'elynea',
  name: 'Elynea',
  provider: 'jsinnovia-agent',
  provider_agent_id: null,
  role: 'cockpit_orchestration',
  label: 'Agent IA unique JS-Innov.IA',
  aliases: ['elynea', 'nova', 'cockpit', 'jsinnov-agent'],
  capabilities: [
    'chat', 'orchestration', 'execute', 'supervise', 'verify', 'retry', 'crm', 'portfolio',
    'automation', 'web', 'frontend', 'seo', 'dns', 'tls', 'github', 'railway', 'deploy',
    'testing', 'mobile', 'desktop', 'electron', 'video', 'comfyui', 'ffmpeg', 'creative',
    'branding', 'billing', 'finops', 'email', 'documents', 'local-tools', 'signage', 'civic',
  ],
  status: 'active',
  architecture: 'single-agent-multi-skill',
});

const SKILL_REGISTRY = Object.freeze([
  { key: 'jsinnov-agent', name: 'Sites JS-Innov.IA', kind: 'skill', role: 'architecture_devops', label: 'Architecture, GitHub, Railway et sites JS-Innov.IA', domains: ['cockpit.jsinnovia.com', 'jsinnovia.com', 'jsinnovia.store'], aliases: ['js-innov.ia', 'jsinnovia', 'agent principal'], capabilities: ['chat', 'diagnostic', 'orchestration', 'support', 'dns', 'tls', 'https', 'seo', 'domaine', 'domain', 'hebergement', 'hébergement', 'railway', 'github', 'web', 'frontend', 'responsive', 'live-preview', 'deploy', 'testing'], legacy_base44_agent_id: '6a1845e17cc526d1e44965bc', status: 'active' },
  { key: 'assurances-dour', name: 'Assurances-Dour.be', kind: 'skill', role: 'site_assurances_dour', label: 'Site et opérations Assurances-Dour.be', domains: ['assurances-dour.be'], aliases: ['assurances dour', 'assurances-dour'], capabilities: ['diagnostic', 'support', 'dns', 'tls', 'https', 'seo', 'site', 'github', 'railway'], legacy_base44_agent_id: '6a008b3e1571ea9f6ac3839d', status: 'active' },
  { key: 'synergie-dour', name: 'Synergie Dour', kind: 'skill', role: 'site_synergie_dour', label: 'Synergie Dour : information, adhésions et événements', domains: ['synergiedour.be'], aliases: ['synergie dour', 'synergiedour', 'synergie asbl'], capabilities: ['information', 'adhesion', 'adhésion', 'event', 'événement', 'membres', 'annuaire', 'github', 'railway'], legacy_base44_agent_id: '6a0208edd1e235b62b4bda38', status: 'active' },
  { key: 'site-olivier', name: 'Olivier Trévis / Tour de Dour', kind: 'skill', role: 'site_olivier_trevis', label: 'Sites Olivier Trévis et Le Tour de Dour', domains: ['oliviertrevis.be', 'letourdedour.com'], aliases: ['olivier trevis', 'tour de dour', 'le tour de dour'], capabilities: ['information', 'landing', 'site', 'seo', 'dns', 'tls', 'https', 'github', 'railway'], legacy_base44_agent_id: '6a0371a87c9257126b051d5a', status: 'active' },
  { key: 'dourconnect', name: 'DourConnect', kind: 'skill', role: 'dourconnect_ops', label: 'DourConnect : citoyens et commerces', domains: ['dourconnect.be'], aliases: ['dourconnect', 'dour connect'], capabilities: ['civic', 'information', 'citoyens', 'commerces', 'github', 'railway'], legacy_base44_agent_id: '6a22f0c096ce009a943f4a05', status: 'active' },
  { key: 'villeconnect', name: 'VilleConnect OS', kind: 'skill', role: 'villeconnect_ops', label: 'VilleConnect OS : territoire et services', domains: ['villeconnect.be', 'villeconnectos.com'], aliases: ['villeconnect', 'ville connect'], capabilities: ['civic', 'smart-city', 'territoire', 'services', 'github', 'railway'], legacy_base44_agent_id: '6a11d1493754e75ce76ee0de', status: 'active' },
  { key: 'signelya', name: 'Signelya', kind: 'skill', role: 'signelya_ops', label: 'Signelya : affichage dynamique et écrans connectés', domains: ['signelya.jsinnovia.com', 'app.signelya.jsinnovia.com', 'signage.jsinnovia.com'], aliases: ['signelya', 'signage', 'selynea', 'synelya'], capabilities: ['chat', 'signage', 'display', 'screen', 'écran', 'playlist', 'campaign', 'monitoring', 'site', 'github', 'railway'], status: 'active' },
  { key: 'nova', name: 'Cockpit & orchestration', kind: 'skill', role: 'cockpit_orchestration', label: 'Cockpit JS-Innov.IA, orchestration et automatisations', domains: ['cockpit.jsinnovia.com'], aliases: ['elynea', 'nova', 'cockpit'], capabilities: ['chat', 'orchestration', 'execute', 'supervise', 'verify', 'retry', 'crm', 'portfolio', 'automation', 'github', 'railway', 'deploy', 'testing', 'local-tools'], legacy_base44_agent_id: '69ff4dc771a2cdab275f8a00', status: 'active' },
  { key: 'fashionistart', name: "Fashionist'art", kind: 'skill', role: 'site_fashionistart', label: "Fashionist'art Dour : art, mode et événements", domains: ['fashionistartdour.be'], aliases: ["fashionist'art", 'fashionistart', 'fashionist art'], capabilities: ['event', 'événement', 'fashion', 'art', 'site', 'github', 'railway'], legacy_base44_agent_id: '6a035427dca907aa03b71398', status: 'active' },
  { key: 'miss-mister-dour', name: 'Miss & Mister Dour', kind: 'skill', role: 'site_pageant_dour', label: 'Miss & Mister Dour : concours, candidatures et événements', domains: ['missetmisterdour.be'], aliases: ['miss & mister dour', 'miss mister dour', 'missetmisterdour'], capabilities: ['event', 'événement', 'concours', 'voting', 'vote', 'github', 'railway'], legacy_base44_agent_id: '69e732e1d54abfd1783f5d06', status: 'active' },
  { key: 'led-ad-director', name: 'Direction artistique LED', kind: 'skill', role: 'led_outdoor_ad_creative_direction', label: 'Publicité écran LED géant Espace C · Dour', domains: ['affichage-led', 'Espace C — Dour'], aliases: ['directeur artistique led', 'publicité led', 'publicite led', 'écran géant', 'ecran geant', 'espace c', 'affichage led'], capabilities: ['creative-direction', 'storyboard', 'branding', 'signage', 'led', 'outdoor-advertising', 'video', '8s', 'brand-compliance', 'copy-validation', 'ffmpeg', 'h264', 'rec709'], system_prompt: LED_AD_DIRECTOR_PROMPT, status: 'active' },
  { key: 'generatvideopro', name: 'Video Studio', kind: 'skill', role: 'video_production', label: 'Production vidéo interne', domains: ['video-studio.jsinnovia.com'], aliases: ['video studio', 'generatvideopro', 'minimax h3', 'comfyui'], capabilities: ['video', 'vidéo', 'video-generation', 'minimax', 'h3', 'comfyui', 'ffmpeg'], legacy_base44_agent_id: '69e467a9d6329bb2ead81fa3', status: 'active' },
  { key: 'creative-director', name: 'Direction créative', kind: 'skill', role: 'creative_direction', label: 'Direction créative interne JS-Innov.IA', domains: ['jsinnovia.com'], aliases: ['creative director', 'direction créative', 'direction creative'], capabilities: ['branding', 'design', 'creative-direction', 'storyboard'], legacy_base44_agent_id: '69ed0a42be17008cf11027eb', status: 'active' },
]);

function findSkill(value) {
  const needle = String(value || '').trim().toLowerCase();
  if (!needle) return null;
  return SKILL_REGISTRY.find((skill) => skill.key.toLowerCase() === needle || (skill.aliases || []).some((alias) => String(alias).toLowerCase() === needle)) || null;
}

// Compatibilité : tout code qui consomme encore AGENT_REGISTRY ne voit désormais
// qu'un seul véritable agent. Les anciennes fiches sont exposées via SKILL_REGISTRY.
const AGENT_REGISTRY = Object.freeze([ELYNEA_AGENT]);

module.exports = { ELYNEA_AGENT, SKILL_REGISTRY, AGENT_REGISTRY, findSkill };
