import React from 'react';

const CATEGORY = { miss: 'Miss', mister: 'Mister', teen_miss: 'Teen Miss', teen_mister: 'Teen Mister' };
const STATUS = { pending: 'En attente', approved: 'Validée', rejected: 'Refusée', finalist: 'Finaliste', winner: 'Lauréat·e' };

export default function RegistrationRows({ records, loading, error, formatDate }) {
  return <table className="w-full min-w-[1050px] text-sm">
    <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr>
      {['Prénom et nom', 'Coordonnées', 'Ville', 'Catégorie', 'Année', 'Origine', 'Date', 'Statut'].map(label => <th className="p-3" key={label}>{label}</th>)}
    </tr></thead>
    <tbody>{loading || error || records.length === 0
      ? <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">{loading ? 'Lecture des inscriptions du site…' : error ? 'Données indisponibles — utilisez Actualiser après rétablissement de la source.' : 'Aucune inscription ne correspond à ces filtres.'}</td></tr>
      : records.map(row => <tr key={row.id} className="border-t border-border align-top hover:bg-muted/20">
        <td className="p-3 font-semibold">{row.first_name} {row.last_name}</td>
        <td className="p-3"><div>{row.email || 'Email non renseigné'}</div><div className="text-xs text-muted-foreground">{row.phone || 'Téléphone non renseigné'}</div></td>
        <td className="p-3">{row.city || '—'}</td><td className="p-3">{CATEGORY[row.category] || row.category || '—'}</td>
        <td className="p-3">{row.year}</td><td className="p-3 text-xs">{row.source === 'application' ? 'Candidature reçue' : 'Profil candidat'}</td>
        <td className="whitespace-nowrap p-3 text-xs">{formatDate(row.created_at)}</td>
        <td className="p-3"><span className="inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold">{STATUS[row.status] || row.status || 'Non renseigné'}</span></td>
      </tr>)}</tbody>
  </table>;
}
