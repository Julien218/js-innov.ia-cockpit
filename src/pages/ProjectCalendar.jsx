import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, ChevronRight, Calendar, MapPin, User, CheckCircle2, Clock, AlertCircle } from "lucide-react";

export default function ProjectCalendar() {
  const [projects, setProjects] = useState([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const STATUS_CONFIG = {
    "planning": { color: "text-blue-400 bg-blue-400/10 border-blue-400/20", icon: Clock, label: "Prévu" },
    "in_production": { color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/20", icon: AlertCircle, label: "En production" },
    "in_review": { color: "text-purple-400 bg-purple-400/10 border-purple-400/20", icon: AlertCircle, label: "En révision" },
    "delivered": { color: "text-green-400 bg-green-400/10 border-green-400/20", icon: CheckCircle2, label: "Livré" },
    "archived": { color: "text-slate-400 bg-slate-400/10 border-slate-400/20", icon: Calendar, label: "Archivé" },
  };

  useEffect(() => {
    base44.entities.Project.list("-created_date", 100).then(p => {
      setProjects(p);
      setLoading(false);
    });
  }, []);

  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  
  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);
  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1));

  const getProjectsForDate = (day) => {
    const dateStr = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString().split("T")[0];
    return projects.filter(p => p.delivery_date === dateStr);
  };

  const monthName = currentDate.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

  const daysCells = [];
  for (let i = 0; i < firstDay; i++) daysCells.push(null);
  for (let day = 1; day <= daysInMonth; day++) daysCells.push(day);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-6 py-8 border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-foreground">Calendrier des projets</h1>
            <p className="text-sm text-muted-foreground mt-1">Visualisez vos projets vidéo par date de livraison</p>
          </div>
          <button
            onClick={() => navigate("/project/new")}
            className="btn-gold px-4 py-2.5 rounded-xl text-sm"
          >
            + Nouveau projet
          </button>
        </div>
      </div>

      <div className="px-6 py-8 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendrier */}
          <div className="lg:col-span-2 card-premium rounded-2xl p-6">
            {/* Navigation */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-semibold text-foreground capitalize">{monthName}</h2>
              <div className="flex gap-2">
                <button onClick={prevMonth} className="p-2 hover:bg-muted rounded-lg transition">
                  <ChevronLeft size={18} className="text-muted-foreground" />
                </button>
                <button onClick={nextMonth} className="p-2 hover:bg-muted rounded-lg transition">
                  <ChevronRight size={18} className="text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Jours de la semaine */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {days.map(day => (
                <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Jours du mois */}
            <div className="grid grid-cols-7 gap-1">
              {daysCells.map((day, idx) => {
                const dayProjects = day ? getProjectsForDate(day) : [];
                const hasProjects = dayProjects.length > 0;
                const isToday = day === new Date().getDate() && 
                  currentDate.getMonth() === new Date().getMonth() &&
                  currentDate.getFullYear() === new Date().getFullYear();

                return (
                  <div
                    key={idx}
                    onClick={() => day && setSelectedDate(day)}
                    className={`aspect-square p-2 rounded-lg cursor-pointer transition-all ${
                      day ? "border" : ""
                    } ${
                      day && selectedDate === day
                        ? "bg-primary/20 border-primary"
                        : day && hasProjects
                        ? "bg-primary/5 border-primary/40"
                        : day
                        ? "border-border hover:bg-muted/50"
                        : ""
                    } ${isToday ? "ring-1 ring-primary" : ""}`}
                  >
                    {day && (
                      <div className="flex flex-col h-full">
                        <span className={`text-xs font-semibold ${isToday ? "text-primary" : "text-foreground"}`}>
                          {day}
                        </span>
                        {hasProjects && (
                          <div className="flex gap-0.5 mt-1 flex-wrap">
                            {dayProjects.slice(0, 2).map((p, i) => (
                              <div key={i} className="w-1 h-1 bg-primary rounded-full" />
                            ))}
                            {dayProjects.length > 2 && (
                              <span className="text-[9px] text-primary font-bold">+{dayProjects.length - 2}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Légende */}
            <div className="mt-6 pt-6 border-t border-border flex flex-wrap gap-3 text-xs">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                const Icon = config.icon;
                return (
                  <div key={status} className="flex items-center gap-2">
                    <Icon size={12} className={config.color.split(" ")[0]} />
                    <span className="text-muted-foreground">{config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Détails */}
          <div className="space-y-4">
            {selectedDate && (
              <div className="card-premium rounded-2xl p-4">
                <div className="text-sm font-semibold text-foreground mb-4">
                  {new Date(currentDate.getFullYear(), currentDate.getMonth(), selectedDate).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long"
                  })}
                </div>
                {getProjectsForDate(selectedDate).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Aucun projet pour cette date</p>
                ) : (
                  <div className="space-y-2">
                    {getProjectsForDate(selectedDate).map(p => {
                      const statusConfig = STATUS_CONFIG[p.status || "planning"];
                      const StatusIcon = statusConfig.icon;
                      return (
                        <div
                          key={p.id}
                          onClick={() => navigate(`/project/${p.id}`)}
                          className={`p-3 rounded-lg border cursor-pointer transition-all ${statusConfig.color} hover:shadow-md`}
                        >
                          <div className="flex items-start gap-2 mb-1">
                            <StatusIcon size={13} className="mt-0.5 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate">{p.project_name}</p>
                            </div>
                          </div>
                          {p.client_name && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                              <User size={11} />
                              <span className="truncate">{p.client_name}</span>
                            </div>
                          )}
                          {p.event_name && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                              <MapPin size={11} />
                              <span className="truncate">{p.event_name}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Prochains projets */}
            <div className="card-premium rounded-2xl p-4">
              <div className="text-sm font-semibold text-foreground mb-3">Livraisons prochaines</div>
              {loading ? (
                <p className="text-xs text-muted-foreground">Chargement…</p>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {projects
                    .filter(p => p.delivery_date && new Date(p.delivery_date) >= new Date())
                    .sort((a, b) => new Date(a.delivery_date) - new Date(b.delivery_date))
                    .slice(0, 5)
                    .map(p => {
                      const statusConfig = STATUS_CONFIG[p.status || "planning"];
                      const StatusIcon = statusConfig.icon;
                      const daysUntil = Math.ceil(
                        (new Date(p.delivery_date) - new Date()) / (1000 * 60 * 60 * 24)
                      );
                      return (
                        <div
                          key={p.id}
                          onClick={() => navigate(`/project/${p.id}`)}
                          className="p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-all"
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate">{p.project_name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {new Date(p.delivery_date).toLocaleDateString("fr-FR")}
                              </p>
                            </div>
                            <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${statusConfig.color}`}>
                              {daysUntil === 0 ? "Aujourd'hui" : daysUntil === 1 ? "Demain" : `${daysUntil}j`}
                            </span>
                          </div>
                          {p.client_name && (
                            <p className="text-xs text-muted-foreground truncate">{p.client_name}</p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
