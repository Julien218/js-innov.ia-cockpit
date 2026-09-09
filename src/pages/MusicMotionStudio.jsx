import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  ImagePlus,
  Loader2,
  Music2,
  Play,
  Save,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import PageHeader from '@/components/shared/PageHeader';

const MODE_OPTIONS = [
  {
    id: 'auto',
    label: 'Adaptation automatique',
    description: 'L’IA choisit entre danse, narration et plans d’ambiance.',
  },
  {
    id: 'dance',
    label: 'Clip dansé',
    description: 'Une chorégraphie maître est répétée sur chaque refrain.',
  },
  {
    id: 'cinematic',
    label: 'Bande-son de film',
    description: 'Narration visuelle, tension et émotion, sans danse imposée.',
  },
  {
    id: 'advertising',
    label: 'Publicité / marque',
    description: 'Rythme lisible, message, produit et signature finale.',
  },
  {
    id: 'custom',
    label: 'Direction personnalisée',
    description: 'Vous imposez les règles scène par scène.',
  },
];

const FORMAT_OPTIONS = [
  { id: 'vertical', label: '9:16', detail: 'TikTok · Reels · Shorts' },
  { id: 'square', label: '1:1', detail: 'Publications sociales' },
  { id: 'landscape', label: '16:9', detail: 'YouTube · écran' },
];

const DEFAULT_BRIEF = [
  'Univers premium futuriste JS‑Innov.IA, bleu nuit, or, cyan et violet.',
  'Conserver strictement l’identité visuelle d’Elynea : visage, mèche, casque, micro, ailes et proportions.',
  'Aucun changement de personnage entre les plans. Mouvements propres, lisibles et réutilisables.',
].join('\n');

function formatTime(value) {
  const seconds = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return minutes + ':' + rest;
}

function buildTimeline(duration, mode, danceAllowed) {
  const total = Math.max(20, Number(duration) || 234);
  const sections = [
    {
      type: 'intro',
      label: 'Intro · Innovation',
      ratio: 0.08,
      dance: false,
      motion: 'Révélation lente, particules lumineuses, interface futuriste et apparition d’Elynea.',
      prompt: 'Open on a dark premium digital space. Golden and cyan particles assemble into the JS-Innov.IA universe. Elynea appears with a controlled cinematic reveal. No dance. Stable character identity.',
    },
    {
      type: 'couplet',
      label: 'Couplet 1 · Découverte',
      ratio: 0.18,
      dance: false,
      motion: 'Travelling doux, gestes de présentation, découverte de l’innovation.',
      prompt: 'Elynea explores a luminous innovation environment. Use elegant hand gestures, slow camera movement, readable composition and premium corporate lighting.',
    },
    {
      type: 'refrain',
      label: 'Refrain 1 · Mouvement maître',
      ratio: 0.13,
      dance: danceAllowed,
      motion: danceAllowed
        ? 'Créer 3 gestes simples : ouverture vers l’avant, mouvement latéral, signature vers le logo.'
        : 'Accent musical et mouvements de caméra synchronisés, sans chorégraphie.',
      prompt: danceAllowed
        ? 'Introduce the master social dance: three simple repeatable gestures, opening forward, side sweep, then a clear signature gesture toward the JS-Innov.IA emblem. Keep the exact same choreography for every chorus.'
        : 'Build the first musical peak with camera movement, light pulses and rhythmic cuts. No forced choreography.',
    },
    {
      type: 'couplet',
      label: 'Couplet 2 · L’humain amplifié',
      ratio: 0.18,
      dance: false,
      motion: 'Alternance entre technologie et présence humaine, avec mouvements naturels.',
      prompt: 'Show technology amplifying human ideas. Alternate close-ups of Elynea, flowing data light and human-inspired gestures. Preserve the reference character exactly.',
    },
    {
      type: 'pont',
      label: 'Pont · Transition',
      ratio: 0.10,
      dance: false,
      motion: 'Respiration visuelle, ralentissement, transition vers la montée finale.',
      prompt: 'Create an emotional bridge: reduce visual density, use a slow orbit and a calm luminous atmosphere before the final musical lift.',
    },
    {
      type: 'refrain',
      label: 'Refrain 2 · Reprise identique',
      ratio: 0.13,
      dance: danceAllowed,
      motion: danceAllowed
        ? 'Reprendre exactement les 3 gestes du mouvement maître, avec un cadrage légèrement plus large.'
        : 'Reprendre la grammaire visuelle du premier refrain sans danse.',
      prompt: danceAllowed
        ? 'Repeat the exact master choreography from chorus one with the same gesture order and timing. Slightly wider framing, no new dance moves, no character drift.'
        : 'Repeat the visual rhythm of the first chorus with a stronger light build. No choreography unless explicitly requested.',
    },
    {
      type: 'final',
      label: 'Refrain final · Participation',
      ratio: 0.15,
      dance: danceAllowed,
      motion: danceAllowed
        ? 'Elynea invite le public à reproduire le mouvement maître, puis pose finale.'
        : 'Climax visuel, logo, énergie et message final.',
      prompt: danceAllowed
        ? 'Final social-media climax. Elynea performs the exact master gesture sequence and invites the viewer to repeat it. End on a confident pose with the JS-Innov.IA signature.'
        : 'Final cinematic climax with Elynea, the JS-Innov.IA emblem and a confident closing pose. Keep the visual language coherent and avoid dance.',
    },
    {
      type: 'outro',
      label: 'Outro · Signature',
      ratio: 0.05,
      dance: false,
      motion: 'Logo, signature JS‑Innov.IA et fondu propre.',
      prompt: 'Clean premium outro with the JS-Innov.IA logo, subtle golden particles and a polished fade to dark.',
    },
  ];

  let cursor = 0;
  return sections.map((section, index) => {
    const start = cursor;
    const end = index === sections.length - 1 ? total : cursor + total * section.ratio;
    cursor = end;
    return {
      id: 'scene-' + (index + 1),
      ...section,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
    };
  });
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}


function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Lecture du fichier audio impossible.'));
    reader.readAsDataURL(file);
  });
}

function normalizeAnalyzedScenes(analysis, fallback) {
  const sections = analysis?.creative_plan?.sections;
  if (!Array.isArray(sections) || sections.length === 0) return fallback;
  return sections.map((scene, index) => ({
    id: String(scene.id || 'local-scene-' + (index + 1)),
    type: String(scene.type || 'scene'),
    label: String(scene.label || 'Scène ' + (index + 1)),
    start: Math.max(0, Number(scene.start) || 0),
    end: Math.max(0, Number(scene.end) || 0),
    dance: Boolean(scene.dance),
    motion: String(scene.motion || ''),
    prompt: String(scene.prompt || ''),
  }));
}

export default function MusicMotionStudio() {
  const navigate = useNavigate();
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [references, setReferences] = useState([]);
  const [mode, setMode] = useState('auto');
  const [danceAllowed, setDanceAllowed] = useState(true);
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [selectedScene, setSelectedScene] = useState(0);
  const [scenes, setScenes] = useState([]);
  const [formats, setFormats] = useState(['vertical', 'square', 'landscape']);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [analysisMeta, setAnalysisMeta] = useState(null);

  const selected = scenes[selectedScene] || null;
  const currentMode = useMemo(() => MODE_OPTIONS.find((item) => item.id === mode), [mode]);

  const handleAudioChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextUrl = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      setDuration(Number(probe.duration) || 0);
    };
    probe.onerror = () => setNotice({ type: 'error', text: 'La durée de la chanson n’a pas pu être lue.' });
    probe.src = nextUrl;
    setAudioFile(file);
    setAudioUrl(nextUrl);
    setScenes([]);
    setNotice({ type: 'success', text: 'Chanson chargée. Ajoutez vos références puis lancez la préparation.' });
  };

  const handleReferenceChange = (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    const additions = files.map((file) => ({
      id: 'ref-' + Date.now() + '-' + Math.random().toString(16).slice(2),
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setReferences((current) => [...current, ...additions].slice(0, 8));
  };

  const removeReference = (reference) => {
    URL.revokeObjectURL(reference.url);
    setReferences((current) => current.filter((item) => item.id !== reference.id));
  };

  const analyze = async () => {
    if (!audioFile) {
      setNotice({ type: 'error', text: 'Importez d’abord une chanson.' });
      return;
    }
    setIsAnalyzing(true);
    setNotice(null);
    setAnalysisMeta(null);
    const fallback = buildTimeline(duration || 234, mode, danceAllowed && mode !== 'cinematic');

    try {
      const audioDataUrl = await fileToDataUrl(audioFile);
      const response = await fetch('http://127.0.0.1:8787/api/music-motion/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_data_url: audioDataUrl,
          audio_name: audioFile.name,
          duration_seconds: duration || null,
          mode,
          dance_allowed: danceAllowed,
          brief,
          references: references.map((item) => item.name),
        }),
        signal: AbortSignal.timeout(20 * 60 * 1000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.details || result.error || 'Le service local a refusé l’analyse.');
      }

      const nextScenes = normalizeAnalyzedScenes(result, fallback);
      setScenes(nextScenes);
      setSelectedScene(0);
      setAnalysisMeta({
        source: result.source || 'local-agent',
        transcription_ok: Boolean(result.transcription?.ok),
        llm_ok: Boolean(result.llm?.available),
        model: result.transcription?.model || result.llm?.model || null,
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
      });
      setNotice({
        type: 'success',
        text: result.transcription?.ok
          ? 'Analyse locale terminée : timecodes Whisper et proposition créative reçus.'
          : 'Agent local joignable, mais la transcription doit encore être installée ou vérifiée.',
      });
    } catch (error) {
      setScenes(fallback);
      setSelectedScene(0);
      setAnalysisMeta({
        source: 'fallback',
        transcription_ok: false,
        llm_ok: false,
        model: null,
        warnings: ['Analyse locale indisponible : ' + error.message],
      });
      setNotice({
        type: 'error',
        text: 'Le plan de secours est prêt, mais l’analyse Whisper locale n’a pas répondu : ' + error.message,
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const updateScene = (patch) => {
    setScenes((current) => current.map((scene, index) => (
      index === selectedScene ? { ...scene, ...patch } : scene
    )));
  };

  const toggleFormat = (id) => {
    setFormats((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const projectPayload = useMemo(() => ({
    schema_version: 'music-motion.v1',
    title: audioFile?.name?.replace(/\.[^/.]+$/, '') || 'Nouveau projet musical',
    audio: {
      name: audioFile?.name || '',
      preview_url: audioUrl || '',
      duration_seconds: duration || null,
    },
    direction: {
      mode,
      mode_label: currentMode?.label || '',
      dance_allowed: danceAllowed,
      master_choreography: mode === 'dance' || (mode === 'auto' && danceAllowed),
      brief,
      formats,
    },
    references: references.map((item) => ({ name: item.name })),
    scenes,
    analysis: analysisMeta,
    created_at: new Date().toISOString(),
  }), [audioFile, audioUrl, duration, mode, currentMode, danceAllowed, brief, formats, references, scenes, analysisMeta]);

  const saveDraft = () => {
    localStorage.setItem('jsinnovia.music-motion.draft', JSON.stringify(projectPayload));
    setNotice({ type: 'success', text: 'Projet enregistré sur ce poste. Les fichiers restent locaux.' });
  };

  const sendToVideoStudio = () => {
    localStorage.setItem('jsinnovia.music-motion.draft', JSON.stringify(projectPayload));
    navigate('/video-studio/new?music_motion=1');
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Elynea Music Motion Studio"
        subtitle="Synchroniser une chanson, une direction visuelle et un montage modulable"
      />

      <section className="workspace-hero">
        <div className="relative z-10 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p className="workspace-eyebrow">Production locale · JS‑Innov.IA®</p>
            <h2 className="text-2xl font-semibold">Une même intelligence pour un clip dansé, une bande-son ou une publicité</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Importez l’audio et vos références. Le studio prépare une timeline où la danse est optionnelle,
              répétable sur les refrains et modifiable scène par scène avant la génération.
            </p>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 font-semibold text-primary"><Sparkles size={16} /> Analyse contrôlable</div>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">L’IA propose. Julien valide et peut réécrire chaque consigne.</p>
          </div>
        </div>
      </section>

      {notice && (
        <div className={'rounded-xl border px-4 py-3 text-sm ' + (
          notice.type === 'error'
            ? 'border-red-500/30 bg-red-500/10 text-red-600'
            : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
        )}>
          {notice.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <section className="workspace-card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="workspace-eyebrow">1 · Source audio</p>
              <h3 className="font-semibold">Chanson ou bande-son</h3>
            </div>
            <AudioLines className="text-primary" size={20} />
          </div>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 text-center hover:bg-primary/10">
            <Music2 className="mb-2 text-primary" size={24} />
            <span className="text-sm font-medium">{audioFile ? audioFile.name : 'Importer un fichier audio'}</span>
            <span className="mt-1 text-xs text-muted-foreground">M4A, MP3, WAV · fichier conservé localement</span>
            <input type="file" accept="audio/*" onChange={handleAudioChange} className="hidden" />
          </label>
          {audioUrl && (
            <div className="rounded-xl border border-border bg-background/60 p-3">
              <audio controls src={audioUrl} className="w-full" />
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>Durée détectée</span>
                <span className="font-mono text-foreground">{formatTime(duration)}</span>
              </div>
            </div>
          )}
        </section>

        <section className="workspace-card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="workspace-eyebrow">2 · Cohérence visuelle</p>
              <h3 className="font-semibold">Références Elynea / marque</h3>
            </div>
            <ImagePlus className="text-primary" size={20} />
          </div>
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 text-center hover:bg-primary/10">
            <ImagePlus className="mb-2 text-primary" size={24} />
            <span className="text-sm font-medium">Ajouter une image ou une planche</span>
            <span className="mt-1 text-xs text-muted-foreground">Jusqu’à 8 références · identité verrouillable</span>
            <input type="file" accept="image/*" multiple onChange={handleReferenceChange} className="hidden" />
          </label>
          {references.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {references.map((reference) => (
                <div key={reference.id} className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  <img src={reference.url} alt={reference.name} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => removeReference(reference)} className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100" aria-label={'Supprimer ' + reference.name}>
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="workspace-card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <WandSparkles className="text-primary" size={19} />
          <div>
            <p className="workspace-eyebrow">3 · Direction de réalisation</p>
            <h3 className="font-semibold">Le style dépend du projet</h3>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {MODE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              onClick={() => setMode(option.id)}
              className={'rounded-xl border p-3 text-left transition-colors ' + (
                mode === option.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background/40 text-muted-foreground hover:border-primary/40'
              )}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-1 block text-xs leading-5">{option.description}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <textarea
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            placeholder="Règles visuelles et créatives..."
          />
          <div className="min-w-64 rounded-xl border border-border bg-background/50 p-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={danceAllowed} onChange={(event) => setDanceAllowed(event.target.checked)} className="mt-1" />
              <span>
                <span className="block font-medium">Danse autorisée</span>
                <span className="mt-1 block text-xs text-muted-foreground">L’IA pourra l’activer si la musique et votre consigne s’y prêtent.</span>
              </span>
            </label>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold text-foreground">Formats à préparer</p>
              <div className="mt-2 space-y-2">
                {FORMAT_OPTIONS.map((format) => (
                  <label key={format.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={formats.includes(format.id)} onChange={() => toggleFormat(format.id)} />
                    <span><strong className="text-foreground">{format.label}</strong> · {format.detail}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={isAnalyzing}
          className="btn-gold inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm disabled:opacity-60"
        >
          {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isAnalyzing ? 'Préparation en cours…' : 'Analyser et préparer la timeline'}
        </button>
      </section>

      {analysisMeta && (
        <div className="rounded-xl border border-border bg-background/60 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span className={analysisMeta.transcription_ok ? 'text-emerald-600' : 'text-amber-600'}>
              {analysisMeta.transcription_ok ? '✓ Whisper local actif' : '⚠ Whisper local à vérifier'}
            </span>
            <span className={analysisMeta.llm_ok ? 'text-emerald-600' : 'text-amber-600'}>
              {analysisMeta.llm_ok ? '✓ Plan Ollama reçu' : '⚠ Plan créatif de secours'}
            </span>
            {analysisMeta.model ? <span>Modèle : {analysisMeta.model}</span> : null}
          </div>
          {analysisMeta.warnings?.length > 0 && (
            <p className="mt-2">{analysisMeta.warnings.slice(0, 2).join(' · ')}</p>
          )}
        </div>
      )}

      {scenes.length > 0 && (
        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="workspace-card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="workspace-eyebrow">4 · Timeline proposée</p>
                <h3 className="font-semibold">{scenes.length} scènes · {formatTime(duration)}</h3>
              </div>
              <Film size={20} className="text-primary" />
            </div>
            <div className="space-y-2">
              {scenes.map((scene, index) => (
                <button
                  type="button"
                  key={scene.id}
                  onClick={() => setSelectedScene(index)}
                  className={'w-full rounded-xl border p-3 text-left transition-colors ' + (
                    selectedScene === index
                      ? 'border-primary bg-primary/10'
                      : 'border-border bg-background/40 hover:border-primary/40'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{scene.label}</span>
                    {scene.dance ? <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent-foreground">DANSE</span> : null}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatTime(scene.start)} → {formatTime(scene.end)}</span>
                    <span>{Math.round(scene.end - scene.start)} s</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{scene.motion}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="workspace-card space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="workspace-eyebrow">5 · Édition manuelle</p>
                <h3 className="font-semibold">{selected?.label || 'Sélectionnez une scène'}</h3>
              </div>
              <Clapperboard size={20} className="text-primary" />
            </div>
            {selected && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs text-muted-foreground">
                    Début
                    <input type="number" min="0" step="0.1" value={selected.start} onChange={(event) => updateScene({ start: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                  </label>
                  <label className="text-xs text-muted-foreground">
                    Fin
                    <input type="number" min="0" step="0.1" value={selected.end} onChange={(event) => updateScene({ end: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                  </label>
                </div>
                <label className="block text-xs text-muted-foreground">
                  Intention du mouvement
                  <input value={selected.motion} onChange={(event) => updateScene({ motion: event.target.value })} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="block text-xs text-muted-foreground">
                  Prompt de génération
                  <textarea value={selected.prompt} onChange={(event) => updateScene({ prompt: event.target.value })} rows={8} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={Boolean(selected.dance)} onChange={(event) => updateScene({ dance: event.target.checked })} />
                  <span>Autoriser la chorégraphie dans cette scène</span>
                </label>
              </>
            )}
          </div>
        </section>
      )}

      <section className="workspace-card flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="workspace-eyebrow">6 · Validation</p>
          <h3 className="font-semibold">Prêt pour le Studio vidéo local</h3>
          <p className="mt-1 text-xs text-muted-foreground">Le projet est conservé dans le navigateur avant son envoi à la génération ComfyUI.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={saveDraft} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:border-primary/50">
            <Save size={15} /> Enregistrer
          </button>
          <button type="button" onClick={() => downloadJson(projectPayload, 'music-motion-project.json')} className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:border-primary/50">
            <Download size={15} /> Exporter le storyboard
          </button>
          <button type="button" onClick={sendToVideoStudio} className="btn-gold inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm">
            <Play size={15} /> Préparer dans le Studio vidéo
          </button>
        </div>
      </section>

      <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs text-muted-foreground">
        <CheckCircle2 size={16} className="shrink-0 text-primary" />
        <span>Les références restent maîtresses : aucune nouvelle danse, transformation du personnage ou variation de style ne sera imposée sans votre validation.</span>
      </div>
    </div>
  );
}
