import React, { useEffect, useState } from "react";
import { Bell, BellRing, Menu } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), character => character.charCodeAt(0));
}

export default function TopBar({ onOpenMobileMenu }) {
  const { user } = useAuth();
  const [pushState, setPushState] = useState("idle");
  const initial = user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "S";
  const isSuperadmin = user?.role === "superadmin";

  useEffect(() => {
    if (!isSuperadmin || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.getRegistration("/signelya-sw.js")
      .then(registration => registration?.pushManager.getSubscription())
      .then(subscription => setPushState(subscription ? "active" : "idle"))
      .catch(() => setPushState("idle"));
  }, [isSuperadmin]);

  async function enableMobileNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      window.alert("Les notifications mobiles ne sont pas prises en charge par ce navigateur.");
      return;
    }
    setPushState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Autorisation de notification refusée");
      const keyResponse = await fetch("/api/whatsapp/push/public-key", { credentials: "include" });
      const keyData = await keyResponse.json();
      if (!keyResponse.ok) throw new Error(keyData.error || "Configuration mobile indisponible");
      const registration = await navigator.serviceWorker.register("/signelya-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(keyData.publicKey)
        });
      }
      const response = await fetch("/api/whatsapp/push/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Abonnement mobile impossible");
      setPushState("active");
    } catch (error) {
      setPushState("error");
      window.alert(error.message || "Impossible d'activer les notifications mobiles.");
    }
  }

  return <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-cyan-400/10 bg-[#050817]/95 px-3 text-white shadow-lg shadow-black/10 backdrop-blur-xl sm:px-5">
    <button onClick={onOpenMobileMenu} className="rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white md:hidden" aria-label="Ouvrir le menu"><Menu className="h-5 w-5" /></button>
    <div className="hidden md:block"><p className="text-sm font-semibold text-white/90">Pilotage SIGNELYA</p><p className="text-xs text-white/40">Écran géant & vidéosurveillance</p></div>
    <div className="ml-auto flex items-center gap-3">
      {isSuperadmin && <button
        type="button"
        onClick={enableMobileNotifications}
        disabled={pushState === "loading"}
        className="relative rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50"
        aria-label={pushState === "active" ? "Notifications mobiles activées" : "Activer les notifications mobiles"}
        title={pushState === "active" ? "Notifications mobiles activées" : "Activer les notifications mobiles"}
      >
        {pushState === "active" ? <BellRing className="h-5 w-5 text-cyan-300" /> : <Bell className="h-5 w-5" />}
        {pushState === "active" && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400" />}
      </button>}
      <span className="hidden text-xs text-white/45 sm:block">{user?.email}</span>
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00D4FF,#8A2BE2,#FF00CC)] text-xs font-bold text-white shadow-[0_0_20px_rgba(0,212,255,0.28)]">{initial}</div>
    </div>
  </header>;
}
