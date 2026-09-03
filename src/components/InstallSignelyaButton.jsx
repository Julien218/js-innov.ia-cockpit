import React from "react";
import { Download, Share, Smartphone, X } from "lucide-react";

const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isAppleMobile = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

export default function InstallSignelyaButton() {
  const [installPrompt, setInstallPrompt] = React.useState(null);
  const [installed, setInstalled] = React.useState(() => isStandalone());
  const [showHelp, setShowHelp] = React.useState(false);

  React.useEffect(() => {
    const capturePrompt = event => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setShowHelp(false);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      setShowHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  };

  if (installed) return null;

  return <>
    <button
      type="button"
      onClick={install}
      className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#00D4FF]/40 bg-[#00D4FF]/10 px-4 py-3 text-sm font-semibold text-[#8BEAFF] transition-colors hover:bg-[#00D4FF]/20 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/60"
    >
      <Download className="h-5 w-5" />
      Installer SIGNELYA sur ce téléphone
    </button>
    <p className="mt-2 text-center text-[11px] leading-4 text-white/35">Accès rapide depuis votre écran d’accueil, comme une application.</p>

    {showHelp && <div className="fixed inset-0 z-[100000] flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="Installer SIGNELYA">
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0b1022] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3"><img src="/signelya-symbol-approved-512.png" alt="" className="h-12 w-12 rounded-xl" /><div><p className="font-semibold">Installer SIGNELYA</p><p className="text-xs text-white/50">by JS‑Innov.IA</p></div></div>
          <button type="button" onClick={() => setShowHelp(false)} className="grid h-10 w-10 place-items-center rounded-xl text-white/60 hover:bg-white/10" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </div>
        {isAppleMobile() ? <div className="mt-5 space-y-3 text-sm leading-6 text-white/75">
          <p className="flex gap-3"><Share className="mt-0.5 h-5 w-5 shrink-0 text-[#00D4FF]" /><span>Dans Safari, touchez le bouton <strong className="text-white">Partager</strong>.</span></p>
          <p className="flex gap-3"><Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#00D4FF]" /><span>Choisissez <strong className="text-white">Sur l’écran d’accueil</strong>, puis <strong className="text-white">Ajouter</strong>.</span></p>
        </div> : <div className="mt-5 text-sm leading-6 text-white/75">
          Ouvrez le menu de votre navigateur puis choisissez <strong className="text-white">Installer l’application</strong> ou <strong className="text-white">Ajouter à l’écran d’accueil</strong>.
        </div>}
      </div>
    </div>}
  </>;
}
