// Templates vidéo préconfigurés pour vidéos courtes

export const VIDEO_TEMPLATES = [
  {
    id: "tiktok",
    label: "TikTok",
    emoji: "🎵",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 15,
    category: "social",
    colors: { primary: "#ff0050", bg: "#000000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo principale", clips: [
        { id: "v1", type: "placeholder", label: "Vidéo principale", startTime: 0, duration: 15, trackId: "video_main" }
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Hook accrocheur", content: "POV : tu découvres...", startTime: 0, duration: 3, trackId: "text", style: { fontSize: 48, color: "#ffffff", bold: true, position: "center", animation: "zoomIn" } },
        { id: "t2", type: "text", label: "CTA fin", content: "Follow pour plus !", startTime: 12, duration: 3, trackId: "text", style: { fontSize: 36, color: "#ff0050", bold: true, position: "bottom", animation: "fadeIn" } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Hook", startTime: 0, duration: 3 },
      { label: "Contenu", startTime: 3, duration: 10 },
      { label: "CTA", startTime: 13, duration: 2 },
    ],
    music_style: "electro trending",
    transitions: "flash",
  },
  {
    id: "reels",
    label: "Instagram Reels",
    emoji: "📱",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 30,
    category: "social",
    colors: { primary: "#e1306c", bg: "#000000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo principale", clips: [
        { id: "v1", type: "placeholder", label: "Scène 1", startTime: 0, duration: 10, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Scène 2", startTime: 10, duration: 10, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Scène 3", startTime: 20, duration: 10, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Titre intro", content: "Découvrez notre secret...", startTime: 0, duration: 4, trackId: "text", style: { fontSize: 42, color: "#ffffff", bold: true, position: "top", animation: "slideIn" } },
        { id: "t2", type: "text", label: "Hashtags", content: "#instagood #reels", startTime: 26, duration: 4, trackId: "text", style: { fontSize: 28, color: "#e1306c", bold: false, position: "bottom", animation: "fadeIn" } }
      ]},
      { id: "logo", type: "image", label: "Logo", clips: [
        { id: "i1", type: "placeholder", label: "Logo marque", startTime: 0, duration: 30, trackId: "logo", style: { position: "top-right", opacity: 0.8, size: 80 } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Accroche", startTime: 0, duration: 4 },
      { label: "Développement", startTime: 4, duration: 22 },
      { label: "Conclusion", startTime: 26, duration: 4 },
    ],
    music_style: "pop moderne",
    transitions: "zoom",
  },
  {
    id: "shorts",
    label: "YouTube Shorts",
    emoji: "▶️",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 60,
    category: "social",
    colors: { primary: "#ff0000", bg: "#0f0f0f", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo principale", clips: [
        { id: "v1", type: "placeholder", label: "Intro", startTime: 0, duration: 5, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Corps", startTime: 5, duration: 45, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Outro", startTime: 50, duration: 10, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Titre", content: "Titre accrocheur ici", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 56, color: "#ff0000", bold: true, position: "top", animation: "zoomIn" } },
        { id: "t2", type: "text", label: "Subscribe CTA", content: "🔔 Like & Subscribe !", startTime: 50, duration: 10, trackId: "text", style: { fontSize: 38, color: "#ff0000", bold: true, position: "bottom", animation: "fadeIn" } }
      ]},
      { id: "effects", type: "effects", label: "Effets", clips: [] },
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Intro", startTime: 0, duration: 5 },
      { label: "Corps principal", startTime: 5, duration: 45 },
      { label: "Outro", startTime: 50, duration: 10 },
    ],
    music_style: "ambient dynamique",
    transitions: "fade",
  },
  {
    id: "story",
    label: "Story Instagram",
    emoji: "🌟",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 15,
    category: "social",
    colors: { primary: "#833ab4", bg: "#000000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Fond vidéo", clips: [
        { id: "v1", type: "placeholder", label: "Fond visuel", startTime: 0, duration: 15, trackId: "video_main" }
      ]},
      { id: "image", type: "image", label: "Image produit", clips: [
        { id: "i1", type: "placeholder", label: "Image produit", startTime: 2, duration: 11, trackId: "image", style: { position: "center", size: 400 } }
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Texte principal", content: "Swipe up pour plus !", startTime: 10, duration: 5, trackId: "text", style: { fontSize: 40, color: "#ffffff", bold: true, position: "bottom", animation: "slideIn" } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Accroche visuelle", startTime: 0, duration: 5 },
      { label: "Message", startTime: 5, duration: 8 },
      { label: "CTA", startTime: 13, duration: 2 },
    ],
    music_style: "pop léger",
    transitions: "fade",
  },
  {
    id: "pub_produit",
    label: "Vidéo pub produit",
    emoji: "🛍️",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 30,
    category: "publicite",
    colors: { primary: "#c8922a", bg: "#0a0a0a", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo produit", clips: [
        { id: "v1", type: "placeholder", label: "Produit intro", startTime: 0, duration: 5, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Détails produit", startTime: 5, duration: 15, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Lifestyle", startTime: 20, duration: 10, trackId: "video_main" },
      ]},
      { id: "image", type: "image", label: "Image produit", clips: [
        { id: "i1", type: "placeholder", label: "Photo packshot", startTime: 3, duration: 7, trackId: "image", style: { position: "center", size: 500 } }
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Nom produit", content: "NOM DU PRODUIT", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 52, color: "#c8922a", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Prix promo", content: "Seulement 29€ !", startTime: 15, duration: 8, trackId: "text", style: { fontSize: 44, color: "#ff4444", bold: true, position: "center", animation: "zoomIn" } },
        { id: "t3", type: "text", label: "CTA achat", content: "🛒 Commander maintenant", startTime: 25, duration: 5, trackId: "text", style: { fontSize: 36, color: "#ffffff", bold: true, position: "bottom", animation: "slideIn" } }
      ]},
      { id: "logo", type: "image", label: "Logo", clips: [
        { id: "logo1", type: "placeholder", label: "Logo marque", startTime: 0, duration: 30, trackId: "logo", style: { position: "top-left", opacity: 0.9, size: 90 } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Intro produit", startTime: 0, duration: 5 },
      { label: "Présentation", startTime: 5, duration: 15 },
      { label: "Offre", startTime: 20, duration: 5 },
      { label: "CTA", startTime: 25, duration: 5 },
    ],
    music_style: "electro corporate",
    transitions: "zoom",
  },
  {
    id: "fashion",
    label: "Vidéo fashion",
    emoji: "👗",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 20,
    category: "creative",
    colors: { primary: "#f0c040", bg: "#0a0505", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Défilé / Look", clips: [
        { id: "v1", type: "placeholder", label: "Look 1", startTime: 0, duration: 5, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Look 2", startTime: 5, duration: 5, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Look 3", startTime: 10, duration: 5, trackId: "video_main" },
        { id: "v4", type: "placeholder", label: "Look 4", startTime: 15, duration: 5, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Collection", content: "COLLECTION PRINTEMPS", startTime: 0, duration: 4, trackId: "text", style: { fontSize: 36, color: "#f0c040", bold: false, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Nom pièce 1", content: "Robe Élégance", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 28, color: "#ffffff", bold: false, position: "bottom", animation: "slideIn" } },
      ]},
      { id: "logo", type: "image", label: "Logo", clips: [
        { id: "logo1", type: "placeholder", label: "Logo marque", startTime: 0, duration: 20, trackId: "logo", style: { position: "top-center", opacity: 1, size: 100 } }
      ]},
      { id: "effects", type: "effects", label: "Effets", clips: [] },
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Look 1", startTime: 0, duration: 5 },
      { label: "Look 2", startTime: 5, duration: 5 },
      { label: "Look 3", startTime: 10, duration: 5 },
      { label: "Look 4", startTime: 15, duration: 5 },
    ],
    music_style: "house chic",
    transitions: "blur",
  },
  {
    id: "avant_apres",
    label: "Vidéo avant/après",
    emoji: "✨",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 20,
    category: "creative",
    colors: { primary: "#00d4ff", bg: "#050510", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo AVANT", clips: [
        { id: "v1", type: "placeholder", label: "Avant", startTime: 0, duration: 8, trackId: "video_main" }
      ]},
      { id: "video_secondary", type: "video", label: "Vidéo APRÈS", clips: [
        { id: "v2", type: "placeholder", label: "Après", startTime: 10, duration: 10, trackId: "video_secondary" }
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Label AVANT", content: "AVANT", startTime: 0, duration: 8, trackId: "text", style: { fontSize: 72, color: "#ff4444", bold: true, position: "center", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Séparateur", content: "↓", startTime: 8, duration: 2, trackId: "text", style: { fontSize: 80, color: "#ffffff", bold: true, position: "center", animation: "zoomIn" } },
        { id: "t3", type: "text", label: "Label APRÈS", content: "APRÈS ✨", startTime: 10, duration: 10, trackId: "text", style: { fontSize: 72, color: "#00d4ff", bold: true, position: "center", animation: "zoomIn" } },
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Avant", startTime: 0, duration: 8 },
      { label: "Transition", startTime: 8, duration: 2 },
      { label: "Après", startTime: 10, duration: 10 },
    ],
    music_style: "ambient pop",
    transitions: "flash",
  },
  {
    id: "promotion",
    label: "Vidéo promotion",
    emoji: "🔥",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 15,
    category: "publicite",
    colors: { primary: "#ff4444", bg: "#0a0000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Fond animé", clips: [
        { id: "v1", type: "placeholder", label: "Fond promo", startTime: 0, duration: 15, trackId: "video_main" }
      ]},
      { id: "image", type: "image", label: "Visuel promo", clips: [
        { id: "i1", type: "placeholder", label: "Visuel offre", startTime: 1, duration: 13, trackId: "image", style: { position: "center", size: 600 } }
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Accroche promo", content: "SOLDES -50%", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 88, color: "#ff4444", bold: true, position: "top", animation: "zoomIn" } },
        { id: "t2", type: "text", label: "Durée promo", content: "⏰ Offre limitée — 48h seulement !", startTime: 5, duration: 7, trackId: "text", style: { fontSize: 34, color: "#ffffff", bold: false, position: "center", animation: "slideIn" } },
        { id: "t3", type: "text", label: "CTA", content: "🛒 Profitez-en maintenant !", startTime: 12, duration: 3, trackId: "text", style: { fontSize: 36, color: "#ffcc00", bold: true, position: "bottom", animation: "fadeIn" } },
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Annonce promo", startTime: 0, duration: 5 },
      { label: "Détail offre", startTime: 5, duration: 7 },
      { label: "CTA urgent", startTime: 12, duration: 3 },
    ],
    music_style: "electro énergique",
    transitions: "flash",
  },
  {
    id: "tiktok_trend",
    label: "TikTok Trend",
    emoji: "🔥",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 10,
    category: "social",
    colors: { primary: "#ff0050", bg: "#000000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Clip tendance", clips: [
        { id: "v1", type: "placeholder", label: "Clip 1", startTime: 0, duration: 3, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Clip 2", startTime: 3, duration: 3, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Clip 3", startTime: 6, duration: 4, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Hook", content: "POV :", startTime: 0, duration: 2, trackId: "text", style: { fontSize: 64, color: "#ff0050", bold: true, position: "center", animation: "zoomIn" } },
        { id: "t2", type: "text", label: "Suivi", content: "Attends la fin 👀", startTime: 2, duration: 5, trackId: "text", style: { fontSize: 42, color: "#ffffff", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t3", type: "text", label: "CTA", content: "🔔 Follow pour plus !", startTime: 8, duration: 2, trackId: "text", style: { fontSize: 36, color: "#ff0050", bold: true, position: "bottom", animation: "slideIn" } },
      ]},
      { id: "audio", type: "audio", label: "Son tendance", clips: [] },
    ],
    scenes: [
      { label: "Hook (0-2s)", startTime: 0, duration: 2 },
      { label: "Contenu (2-8s)", startTime: 2, duration: 6 },
      { label: "CTA (8-10s)", startTime: 8, duration: 2 },
    ],
    music_style: "son viral TikTok",
    transitions: "flash",
  },
  {
    id: "linkedin_post",
    label: "LinkedIn Post Vidéo",
    emoji: "💼",
    format: "1:1",
    width: 1080,
    height: 1080,
    duration: 30,
    category: "corporate",
    colors: { primary: "#0a66c2", bg: "#000000", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Présentation", clips: [
        { id: "v1", type: "placeholder", label: "Intro", startTime: 0, duration: 8, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Contenu", startTime: 8, duration: 17, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "CTA", startTime: 25, duration: 5, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Titre insight", content: "3 conseils pour réussir", startTime: 0, duration: 6, trackId: "text", style: { fontSize: 44, color: "#0a66c2", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Conseil 1", content: "💡 Conseil #1 ici", startTime: 8, duration: 6, trackId: "text", style: { fontSize: 36, color: "#ffffff", bold: false, position: "bottom", animation: "slideIn" } },
        { id: "t3", type: "text", label: "CTA réseau", content: "Partagez si utile 🔁", startTime: 26, duration: 4, trackId: "text", style: { fontSize: 32, color: "#0a66c2", bold: true, position: "bottom", animation: "fadeIn" } },
      ]},
      { id: "logo", type: "image", label: "Logo / Photo profil", clips: [
        { id: "logo1", type: "placeholder", label: "Photo profil", startTime: 0, duration: 30, trackId: "logo", style: { position: "top-right", opacity: 1, size: 80 } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Intro", startTime: 0, duration: 8 },
      { label: "Valeur ajoutée", startTime: 8, duration: 17 },
      { label: "CTA", startTime: 25, duration: 5 },
    ],
    music_style: "ambient corporate",
    transitions: "fade",
  },
  {
    id: "twitter_x",
    label: "Twitter / X Vidéo",
    emoji: "🐦",
    format: "16:9",
    width: 1280,
    height: 720,
    duration: 20,
    category: "social",
    colors: { primary: "#1d9bf0", bg: "#0f1923", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Clip principal", clips: [
        { id: "v1", type: "placeholder", label: "Clip principal", startTime: 0, duration: 20, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Accroche", content: "Thread résumé en vidéo 🧵", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 38, color: "#1d9bf0", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Hashtag", content: "#Tech #Innovation", startTime: 15, duration: 5, trackId: "text", style: { fontSize: 28, color: "#ffffff", bold: false, position: "bottom", animation: "slideIn" } },
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Accroche", startTime: 0, duration: 5 },
      { label: "Contenu", startTime: 5, duration: 10 },
      { label: "Hashtags", startTime: 15, duration: 5 },
    ],
    music_style: "ambient minimal",
    transitions: "zoom",
  },
  {
    id: "pinterest",
    label: "Pinterest Vidéo",
    emoji: "📌",
    format: "2:3",
    width: 1000,
    height: 1500,
    duration: 15,
    category: "creative",
    colors: { primary: "#e60023", bg: "#1a0004", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo inspiration", clips: [
        { id: "v1", type: "placeholder", label: "Visuel inspiration", startTime: 0, duration: 15, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Titre épingle", content: "Idée déco tendance", startTime: 0, duration: 5, trackId: "text", style: { fontSize: 44, color: "#ffffff", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Astuce", content: "Sauvegardez cette idée 📌", startTime: 11, duration: 4, trackId: "text", style: { fontSize: 32, color: "#e60023", bold: false, position: "bottom", animation: "slideIn" } },
      ]},
      { id: "audio", type: "audio", label: "Audio doux", clips: [] },
    ],
    scenes: [
      { label: "Visuel", startTime: 0, duration: 10 },
      { label: "CTA save", startTime: 10, duration: 5 },
    ],
    music_style: "ambient doux",
    transitions: "fade",
  },
  {
    id: "presentation",
    label: "Présentation rapide",
    emoji: "🎤",
    format: "9:16",
    width: 1080,
    height: 1920,
    duration: 45,
    category: "corporate",
    colors: { primary: "#4a90d9", bg: "#03081a", text: "#ffffff" },
    tracks: [
      { id: "video_main", type: "video", label: "Vidéo présentateur", clips: [
        { id: "v1", type: "placeholder", label: "Intro présentateur", startTime: 0, duration: 10, trackId: "video_main" },
        { id: "v2", type: "placeholder", label: "Slides / Démo", startTime: 10, duration: 25, trackId: "video_main" },
        { id: "v3", type: "placeholder", label: "Conclusion", startTime: 35, duration: 10, trackId: "video_main" },
      ]},
      { id: "text", type: "text", label: "Texte", clips: [
        { id: "t1", type: "text", label: "Titre présentation", content: "NOM DE LA MARQUE", startTime: 0, duration: 8, trackId: "text", style: { fontSize: 48, color: "#4a90d9", bold: true, position: "top", animation: "fadeIn" } },
        { id: "t2", type: "text", label: "Point clé 1", content: "✅ Avantage 1", startTime: 10, duration: 7, trackId: "text", style: { fontSize: 36, color: "#ffffff", bold: false, position: "bottom", animation: "slideIn" } },
        { id: "t3", type: "text", label: "Point clé 2", content: "✅ Avantage 2", startTime: 18, duration: 7, trackId: "text", style: { fontSize: 36, color: "#ffffff", bold: false, position: "bottom", animation: "slideIn" } },
        { id: "t4", type: "text", label: "CTA contact", content: "📧 contact@marque.com", startTime: 38, duration: 7, trackId: "text", style: { fontSize: 32, color: "#4a90d9", bold: false, position: "bottom", animation: "fadeIn" } },
      ]},
      { id: "logo", type: "image", label: "Logo", clips: [
        { id: "logo1", type: "placeholder", label: "Logo", startTime: 0, duration: 45, trackId: "logo", style: { position: "top-right", opacity: 0.9, size: 80 } }
      ]},
      { id: "audio", type: "audio", label: "Audio", clips: [] },
    ],
    scenes: [
      { label: "Intro", startTime: 0, duration: 10 },
      { label: "Points clés", startTime: 10, duration: 25 },
      { label: "Conclusion", startTime: 35, duration: 10 },
    ],
    music_style: "electro corporate",
    transitions: "fade",
  },
];

export const TRACK_COLORS = {
  video: "bg-blue-500/20 border-blue-500/40 text-blue-300",
  text: "bg-green-500/20 border-green-500/40 text-green-300",
  image: "bg-purple-500/20 border-purple-500/40 text-purple-300",
  audio: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300",
  effects: "bg-red-500/20 border-red-500/40 text-red-300",
};

export const TRACK_ICONS = {
  video: "🎬",
  text: "T",
  image: "🖼️",
  audio: "🎵",
  effects: "✨",
};
