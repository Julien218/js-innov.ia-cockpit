import React, { useEffect, useState } from "react";
import { Bell, BellRing, LogOut, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";
import SignelyaWordmark from "@/components/brand/SignelyaWordmark";

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), character => character.charCodeAt(0));
}

export default function TopBar({ onOpenMobileMenu }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return <header className="sticky top-0 z-20 shrink-0 border-b border-cyan-400/10 bg-[#050817]/95 pt-[env(safe-area-inset-top)] text-white shadow-lg shadow-black/10 backdrop-blur-xl">
    <div className="flex h-14 min-w-0 items-center justify-between px-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:h-16 sm:px-5">
      <button onClick={onOpenMobileMenu} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white md:hidden" aria-label="Ouvrir le menu"><Menu className="h-5 w-5" /></button>
      <div className="hidden md:block"><p className="text-sm font-semibold text-white/90">Pilotage <SignelyaWordmark className="tracking-[0.08em]" /></p><p className="text-xs text-white/40">Écran géant & vidéosurveillance</p></div>
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1.5 sm:gap-3">
        {isSuperadmin && <button
          type="button"
          onClick={enableMobileNotifications}
          disabled={pushState === "loading"}
          className="relative shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50"
          aria-label={pushState === "active" ? "Notifications mobiles activées" : "Activer les notifications mobiles"}
          title={pushState === "active" ? "Notifications mobiles activées" : "Activer les notifications mobiles"}
        >
          {pushState === "active" ? <BellRing className="h-5 w-5 text-cyan-300" /> : <Bell className="h-5 w-5" />}
          {pushState === "active" && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400" />}
        </button>}
        <span className="hidden max-w-[180px] truncate text-xs text-white/45 lg:block">{user?.email}</span>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00D4FF,#8A2BE2,#FF00CC)] text-xs font-bold text-white shadow-[0_0_20px_rgba(0,212,255,0.28)]">{initial}</div>
        <button type="button" onClick={handleLogout} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label="Se déconnecter" title="Se déconnecter"><LogOut className="h-5 w-5" /></button>
      </div>
    </div>
  </header>;
}
