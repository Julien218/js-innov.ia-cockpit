import React, { useState, useMemo } from "react";
import PageHeader from "@/components/shared/PageHeader";
import { cn } from "@/lib/utils";
import {
  Globe, CheckCircle2, XCircle, AlertCircle, Mail,
  Shield, Search,
} from "lucide-react";

// ─── DATA: domaines (inventaire 2026-07-25) ────────────────────────────────
const DOMAINS = [
  { name: "jsinnovia.com", http: 200, www: false, dest: "Base44", app: "JS-INNOV.IA", dns: "Base44", email: "IONOS (alias → julien.pagin.pv@gmail.com)", spf: "À vérifier", dkim: "À vérifier", dmarc: "À vérifier", action: "Ajouter www → Base44" },
  { name: "cockpit.jsinnovia.com", http: 200, www: null, dest: "Railway", app: "cockpit-v3", dns: "Railway CNAME", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "OK — production" },
  { name: "jsinnovia.store", http: 0, www: null, dest: "—", app: "—", dns: "Ne résout pas", email: "IONOS (info@jsinnovia.store)", spf: "À configurer", dkim: "À configurer", dmarc: "À configurer", action: "DNS à créer" },
  { name: "assurances-dour.be", http: 200, www: true, dest: "Base44", app: "assurances-dour.be", dns: "Base44", email: "IONOS (info@assurances-dour.be)", spf: "À corriger", dkim: "À corriger", dmarc: "À configurer", action: "SPF/DKIM pour envoi SMTP" },
  { name: "letourdedour.com", http: 0, www: true, dest: "Base44", app: "Multi site", dns: "www OK, apex non", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "Ajouter A/AAAA apex" },
  { name: "oliviertrevis.be", http: 0, www: true, dest: "Base44", app: "Multi site", dns: "www OK, apex non", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "Ajouter A/AAAA apex" },
  { name: "synergiedour.be", http: 0, www: true, dest: "Base44", app: "SynergieDour.be", dns: "www OK, apex non", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "Ajouter A/AAAA apex" },
  { name: "missetmisterdour.be", http: 200, www: null, dest: "Base44", app: "Miss DOUR", dns: "Base44", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "OK" },
  { name: "fashionistartdour.be", http: 0, www: false, dest: "Base44", app: "Fashionist'ART", dns: "Ne résout pas (www non plus)", email: "—", spf: "—", dkim: "—", dmarc: "—", action: "DNS à créer" },
];

function StatusIcon({ ok, label }) {
  if (ok === true) return <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="w-3.5 h-3.5" /> {label}</span>;
  if (ok === false) return <span className="flex items-center gap-1 text-red-600"><XCircle className="w-3.5 h-3.5" /> {label}</span>;
  return <span className="flex items-center gap-1 text-muted-foreground"><AlertCircle className="w-3.5 h-3.5" /> {label}</span>;
}

function DomainRow({ d }) {
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">{d.name}</p>
            <p className="text-[10px] text-muted-foreground">{d.dest}</p>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <StatusIcon ok={d.http === 200} label={d.http === 200 ? "200" : d.http === 0 ? "Down" : `${d.http}`} />
      </td>
      <td className="py-2.5 px-3">
        {d.www === true ? <StatusIcon ok={true} label="www OK" /> :
         d.www === false ? <StatusIcon ok={false} label="www down" /> :
         <span className="text-muted-foreground text-xs">—</span>}
      </td>
      <td className="py-2.5 px-3 text-xs">{d.app}</td>
      <td className="py-2.5 px-3 text-xs">
        {d.email !== "—" ? (
          <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-muted-foreground" /> {d.email}</span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="py-2.5 px-3 text-xs">
        <span className={cn(
          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]",
          d.spf === "OK" ? "bg-emerald-500/10 text-emerald-600" :
          d.spf.includes("configurer") || d.spf.includes("corriger") ? "bg-red-500/10 text-red-600" :
          "bg-muted text-muted-foreground"
        )}>
          <Shield className="w-3 h-3" /> SPF: {d.spf}
        </span>
      </td>
      <td className="py-2.5 px-3 text-xs text-amber-600">
        {d.action}
      </td>
    </tr>
  );
}

export default function Domaines() {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return DOMAINS;
    const s = search.toLowerCase();
    return DOMAINS.filter(d =>
      d.name.includes(s) || d.app?.toLowerCase().includes(s) || d.dest?.toLowerCase().includes(s)
    );
  }, [search]);

  const stats = useMemo(() => ({
    total: DOMAINS.length,
    ok: DOMAINS.filter(d => d.http === 200).length,
    down: DOMAINS.filter(d => d.http === 0).length,
    dnsIssues: DOMAINS.filter(d => d.action !== "OK" && d.action !== "OK — production" && !d.action.includes("OK")).length,
  }), []);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Domaines"
        subtitle="Statut DNS, HTTP, email et sécurité de tous les domaines JS-Innov.IA"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <span className="text-lg font-bold">{stats.total}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Total domaines</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-lg font-bold">{stats.ok}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">En ligne (200)</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-lg font-bold">{stats.down}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Hors ligne</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="text-lg font-bold">{stats.dnsIssues}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">Actions requises</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
        <Search className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un domaine..."
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">Domaine</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">HTTP</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">WWW</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">App liée</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">Email</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">SPF</th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground py-2.5 px-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(d => <DomainRow key={d.name} d={d} />)}
          </tbody>
        </table>
      </div>

      {/* Note */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
        <p className="text-xs text-muted-foreground">
          ⚠️ Les corrections DNS doivent être validées par Julien avant application. Les valeurs exactes seront préparées séparément.
        </p>
      </div>
    </div>
  );
}
