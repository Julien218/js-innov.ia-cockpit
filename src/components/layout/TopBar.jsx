import React, { useCallback, useEffect, useState } from "react";
import { Bell, BellRing, CheckCircle2, CircleAlert, LogOut, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/AuthContext";

function applicationServerKey(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), character => character.charCodeAt(0));
}

function notificationPresentation(event) {
  const payload = event?.payload || {};
  if (event?.event_type === "screen.offline_confirmed") {
    return {
      title: "Écran hors ligne",
      body: `${payload.clientName || "Client"} · ${payload.playerName || "Écran SIGNELYA"} ne transmet plus.`,
      tone: "alert"
    };
  }
  if (event?.event_type === "screen.online_restored") {
    return {
      title: "Écran de nouveau en ligne",
      body: `${payload.clientName || "Client"} · la connexion de ${payload.playerName || "l’écran"} est rétablie.`,
      tone: "success"
    };
  }
  if (event?.event_type === "videos.online") {
    return {
      title: "Nouveaux médias diffusés",
      body: `${payload.clientName || "Client"} · le programme est actif sur ${payload.playerName || "l’écran"}.`,
      tone: "success"
    };
  }
  return {
    title: "Information SIGNELYA",
    body: payload.message || "Une nouvelle activité a été détectée.",
    tone: "neutral"
  };
}

function formatNotificationDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("fr-BE", { dateStyle: "short", timeStyle: "short" });
}

export default function TopBar({ onOpenMobileMenu }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [pushState, setPushState] = useState("idle");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const initial = user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || "S";
  const firstName = (user?.first_name || user?.full_name || user?.email?.split("@")[0] || "").split(/[ ._-]/)[0];
  const isSuperadmin = user?.role === "superadmin";

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user?.email) return;
    if (!silent) setNotificationLoading(true);
    try {
      const response = await fetch("/api/whatsapp/notifications?limit=20", { credentials: "include" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Notifications indisponibles");
      setNotifications(Array.isArray(data.events) ? data.events : []);
      setUnreadCount(Number(data.unreadCount || 0));
      setNotificationError("");
    } catch (error) {
      setNotificationError(error.message || "Notifications indisponibles");
    } finally {
      if (!silent) setNotificationLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    if (!user?.email) return undefined;
    refreshNotifications();
    const timer = window.setInterval(() => refreshNotifications({ silent: true }), 60000);
    return () => window.clearInterval(timer);
  }, [refreshNotifications, user?.email]);

  useEffect(() => {
    if (!isSuperadmin) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushState("unsupported");
      return;
    }
    navigator.serviceWorker
      .getRegistration("/signelya-sw.js")
      .then(registration => registration?.pushManager.getSubscription())
      .then(subscription => setPushState(subscription ? "active" : "idle"))
      .catch(() => setPushState("idle"));
  }, [isSuperadmin]);

  async function enableMobileNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPushState("unsupported");
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
      setNotificationError(error.message || "Impossible d’activer les notifications mobiles.");
    }
  }

  async function markAllRead() {
    try {
      const response = await fetch("/api/whatsapp/notifications/read-all", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Mise à jour impossible");
      setNotifications(current => current.map(event => ({ ...event, read: true })));
      setUnreadCount(0);
      setNotificationError("");
    } catch (error) {
      setNotificationError(error.message || "Mise à jour impossible");
    }
  }

  function toggleNotificationCenter() {
    setNotificationOpen(current => {
      const next = !current;
      if (next) refreshNotifications();
      return next;
    });
  }

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return <header className="sticky top-0 z-20 shrink-0 border-b border-cyan-400/15 bg-[#040817]/95 pt-[env(safe-area-inset-top)] text-white shadow-[0_8px_28px_rgba(0,0,0,.18)] backdrop-blur-xl">
    <div className="flex min-h-16 min-w-0 items-center gap-3 px-[max(.75rem,env(safe-area-inset-left))] pr-[max(.75rem,env(safe-area-inset-right))] sm:px-5">
      <button onClick={onOpenMobileMenu} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white md:hidden" aria-label="Ouvrir le menu"><Menu className="h-6 w-6" /></button>
      <div className="mobile-signelya-brand md:hidden" aria-label="SIGNELYA"><span>SIGNELYA</span></div>
      <div className="hidden min-w-0 flex-1 md:block">
        <p className="truncate text-lg font-bold text-white">Bienvenue {firstName ? firstName.charAt(0).toUpperCase() + firstName.slice(1) : ""} !</p>
        <p className="truncate text-xs text-slate-300">Gérez, diffusez et inspirez avec SIGNELYA.</p>
      </div>
      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-3 rounded-xl border border-cyan-400/25 bg-[#06132b]/75 px-4 py-2 lg:flex"><span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.9)]"/><div><p className="text-xs font-semibold text-cyan-300">Surveillance active</p><p className="text-[10px] text-white/55">État contrôlé automatiquement</p></div></div>
        <button type="button" onClick={toggleNotificationCenter} className="relative shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label={unreadCount ? `${unreadCount} notifications non lues` : "Ouvrir les notifications"}>
          {unreadCount > 0 || pushState === "active" ? <BellRing className="h-5 w-5 text-cyan-300" /> : <Bell className="h-5 w-5" />}
          {unreadCount > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[10px] font-bold text-white">{Math.min(99, unreadCount)}</span>}
        </button>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#00D4FF,#8A2BE2,#FF00CC)] text-sm font-bold text-white shadow-[0_0_20px_rgba(0,212,255,.28)]">{initial}</div>
        <button type="button" onClick={handleLogout} className="shrink-0 rounded-xl p-2 text-white/75 hover:bg-white/10 hover:text-white" aria-label="Se déconnecter"><LogOut className="h-5 w-5" /></button>
        <span className="hidden whitespace-nowrap text-[10px] font-semibold uppercase tracking-[.22em] text-cyan-300 xl:block">Diffusez · Captivez · Sécurisez</span>
      </div>
    </div>

    {notificationOpen && <section className="absolute right-[max(.75rem,env(safe-area-inset-right))] top-[calc(100%+.5rem)] z-50 flex max-h-[min(34rem,calc(100dvh-6rem))] w-[min(26rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#070B1C] text-left shadow-[0_24px_80px_rgba(0,0,0,.5)]">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4">
        <div>
          <p className="font-bold text-white">Centre de notifications</p>
          <p className="mt-0.5 text-xs text-slate-400">{unreadCount ? `${unreadCount} alerte${unreadCount > 1 ? "s" : ""} non lue${unreadCount > 1 ? "s" : ""}` : "Vous êtes à jour"}</p>
        </div>
        {unreadCount > 0 && <button type="button" onClick={markAllRead} className="rounded-lg border border-cyan-400/25 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-400/10">Tout marquer comme lu</button>}
      </div>

      {isSuperadmin && <div className="border-b border-white/10 bg-white/[.03] p-3">
        {pushState === "active" ? <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Alertes mobiles activées sur ce téléphone</div> :
          pushState === "unsupported" ? <p className="text-xs leading-relaxed text-amber-200">Sur iPhone, ajoutez d’abord SIGNELYA à l’écran d’accueil, ouvrez l’application installée puis activez les alertes ici.</p> :
          <button type="button" onClick={enableMobileNotifications} disabled={pushState === "loading"} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#00D4FF,#8A2BE2)] px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"><BellRing className="h-4 w-4" />{pushState === "loading" ? "Activation…" : pushState === "error" ? "Réessayer d’activer les alertes" : "Activer les alertes sur ce téléphone"}</button>}
      </div>}

      {notificationError && <div className="m-3 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100">{notificationError}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {notificationLoading && !notifications.length ? <p className="py-8 text-center text-sm text-slate-400">Chargement des alertes…</p> :
          notifications.length ? <div className="space-y-2">{notifications.map(event => {
            const item = notificationPresentation(event);
            const success = item.tone === "success";
            return <article key={event.id} className={`rounded-xl border p-3 ${event.read ? "border-white/10 bg-white/[.025]" : success ? "border-emerald-400/30 bg-emerald-400/10" : "border-fuchsia-400/30 bg-fuchsia-400/10"}`}>
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${success ? "bg-emerald-400/15 text-emerald-300" : "bg-fuchsia-400/15 text-fuchsia-200"}`}>{success ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold text-white">{item.title}</p>{!event.read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-300" />}</div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">{item.body}</p>
                  <p className="mt-1.5 text-[10px] text-slate-500">{formatNotificationDate(event.created_at)}</p>
                </div>
              </div>
            </article>;
          })}</div> : <div className="py-8 text-center"><Bell className="mx-auto h-7 w-7 text-slate-600" /><p className="mt-2 text-sm font-semibold text-slate-300">Aucune alerte enregistrée</p><p className="mt-1 text-xs text-slate-500">Les pannes, retours en ligne et nouvelles diffusions apparaîtront ici.</p></div>}
      </div>
    </section>}
  </header>;
}

