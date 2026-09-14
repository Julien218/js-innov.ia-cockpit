import { useEffect, useRef, useState } from 'react';
import { AudioLines, Clapperboard, Film, ImagePlus, ListVideo, SlidersHorizontal } from 'lucide-react';
import MusicMotionStudio from '@/pages/MusicMotionStudio';

const STEPS = [
  { id: 'source', label: '1. Source', icon: AudioLines, help: 'Importez la chanson complète et, si besoin, vos références de marque.' },
  { id: 'analysis', label: '2. Analyse', icon: SlidersHorizontal, help: 'Elynea analyse la durée, le rythme, les sections et les paroles disponibles.' },
  { id: 'direction', label: '3. Direction', icon: ImagePlus, help: 'Choisissez le style, le format et l’identité visuelle. Les moteurs restent dans les réglages avancés.' },
  { id: 'storyboard', label: '4. Storyboard', icon: Clapperboard, help: 'Transformez l’analyse en scènes cohérentes puis ajustez les prompts et les timecodes.' },
  { id: 'plans', label: '5. Plans', icon: ListVideo, help: 'Découpez chaque scène en plans, importez ou générez les images et vidéos nécessaires.' },
  { id: 'export', label: '6. Rendu', icon: Film, help: 'Validez le storyboard puis créez l’animatique ou le clip final.' },
];

function findStepTargets(root) {
  if (!root) return new Map();
  const map = new Map();
  const sections = [...root.querySelectorAll('section')];
  if (sections[0]) map.set('source', sections[0]);
  for (const section of sections) {
    const text = String(section.textContent || '').replace(/\s+/g, ' ').trim();
    if (/Analyse intégrale de la source/i.test(text) && !map.has('analysis')) map.set('analysis', section);
    else if (/Direction et moteurs/i.test(text) && !map.has('direction')) map.set('direction', section);
    else if (/Storyboard · scènes artistiques/i.test(text) && !map.has('storyboard')) map.set('storyboard', section);
    else if (/Plans modulables/i.test(text) && !map.has('plans')) map.set('plans', section);
    else if (/Validation et export du clip/i.test(text) && !map.has('export')) map.set('export', section);
  }
  return map;
}

export default function MusicMotionWorkspace() {
  const rootRef = useRef(null);
  const [active, setActive] = useState('source');
  const [targets, setTargets] = useState(new Map());

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const refresh = () => {
      const resolved = findStepTargets(root);
      for (const [id, element] of resolved) {
        element.id = `music-motion-${id}`;
        element.dataset.musicMotionStep = id;
      }
      setTargets(resolved);
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true });
    const timer = window.setTimeout(refresh, 250);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!targets.size) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible?.target?.dataset?.musicMotionStep) setActive(visible.target.dataset.musicMotionStep);
    }, { rootMargin: '-25% 0px -55% 0px', threshold: [0.05, 0.2, 0.5] });
    for (const element of targets.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [targets]);

  const current = STEPS.find(step => step.id === active) || STEPS[0];

  function goTo(step) {
    setActive(step.id);
    const target = targets.get(step.id) || document.getElementById(`music-motion-${step.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="relative">
      <div className="sticky top-14 z-30 border-b border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-5">
        <div className="mx-auto max-w-[1600px]">
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {STEPS.map(step => {
              const Icon = step.icon;
              const selected = step.id === active;
              return (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goTo(step)}
                  className={`flex min-w-max items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition ${selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}
                >
                  <Icon className="h-4 w-4" />
                  {step.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">{STEPS.findIndex(step => step.id === active) + 1}</span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{current.label.replace(/^\d+\.\s*/, '')}</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{current.help}</p>
            </div>
          </div>
        </div>
      </div>

      <div ref={rootRef} className="[&_section]:scroll-mt-44">
        <MusicMotionStudio />
      </div>
    </div>
  );
}
