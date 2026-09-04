import React, { useEffect, useState } from "react";
import { Bell, BellRing, LogOut, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

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
  const firstName = (user?.first_name || user?.full_name || user?.email?.split("@")[0] || "").split(/[ ._-]/)[0];
  const isSuperadmin = user?.role === "superadmin";

  useEffect(() => {
    if (!isSuperadmin || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.getRegistration("/signelya-sw.js").then(registration => registration?.pushManager.getSubscription()).then(subscription => setPushState(subscription ? "active" : "idle")).catch(() => setPushState("idle"));
  }, [isSuperadmin]);

  async function enableMobileNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) { window.alert("Les notifications mobiles ne sont pas prises en charge par ce navigateur."); return; }
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
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(keyData.publicKey) });
      const response = await fetch("/api/whatsapp/push/subscriptions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Abonnement mobile impossible");
      setPushState("active");
    } catch (error) { setPushState("error"); window.alert(error.message || "Impossible d'activer les notifications mobiles."); }
  }

  async function handleLogout() { await logout(); navigate("/login", { replace: true }); }

  return <header className="sticky top-0 z-20 shrink-0 border-b border-cyan-400/15 bg-[#040817]/95 pt-[env(safe-area-inset-top)] text-white shadow-[0_8px_28px_rgba(0,0,0,.18)] backdrop-blur-xl">
    <div className="flex min-h-16 min-w-0 items-center gap-3 px-[max(.75rem,env(safe-area-inset-left))] pr-[max(.75rem,env(safe-area-inset-right))] sm:px-5">
      <button onClick={onOpenMobileMenu} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white md:hidden" aria-label="Ouvrir le menu"><Menu className="h-6 w-6" /></button>
      <div className="hidden min-w-0 flex-1 md:block">
        <p className="truncate text-lg font-bold text-white">Bienvenue {firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : ""} !</p>
        <p className="truncate text-xs text-slate-300">Gérez, diffusez et inspirez avec SIGNELYA.</p>
      </div>
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-3 rounded-xl border border-cyan-400/25 bg-[#06132b]/75 px-4 py-2 lg:flex"><span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.9)]"/><div><p className="text-xs font-semibold text-cyan-300">Écran en ligne</p><p className="text-[10px] text-white/55">État actualisé automatiquement</p></div></div>
        {isSuperadmin && <button type="button" onClick={enableMobileNotifications} disabled={pushState === "loading"} className="relative shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50" aria-label={pushState === "active" ? "Notifications mobiles activées" : "Activer les notifications mobiles"}>{pushState === "active" ? <BellRing className="h-5 w-5 text-cyan-300" /> : <Bell className="h-5 w-5" />}{pushState === "active" && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-emerald-400" />}</button>}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00D4FF,#8A2BE2,#FF00CC)] text-sm font-bold text-white shadow-[0_0_20px_rgba(0,212,255,.28)]">{initial}</div>
        <button type="button" onClick={handleLogout} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label="Se déconnecter"><LogOut className="h-5 w-5" /></button>
        <span className="hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300 xl:block">Diffusez · Captivez · Sécurisez</span>
      </div>
    </div>
  </header>;
}
