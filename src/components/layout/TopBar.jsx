import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MessageSquare, Search, HelpCircle, Menu } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { usePermissions } from '@/lib/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { allNavGroups } from './Sidebar';
import { searchNavigation } from '@/lib/navigation';

export default function TopBar({ onOpenMobileMenu }) {
  const { user } = useAuth();
  const { role, canAccess } = usePermissions();
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const results = searchNavigation(allNavGroups, query, {
    role, canAccess,
    insuranceAllowed: role === 'superadmin' || user?.email?.toLowerCase() === 'olivier.trevis@pv.be',
  });
  useEffect(() => { setSearchOpen(false); setQuery(''); }, [location.pathname]);
  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <header className="h-14 border-b flex items-center justify-between px-3 sm:px-5 gap-2 sm:gap-4 sticky top-0 z-20 shrink-0">
      <button onClick={onOpenMobileMenu} className="md:hidden p-2 rounded-xl" aria-label="Ouvrir le menu"><Menu className="w-5 h-5" /></button>
      <p className="hidden md:block text-xs text-muted-foreground capitalize">{today}</p>
      <div className="flex-1 max-w-md relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setSearchOpen(false); }}>
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Rechercher une page" placeholder="Aller à une page…" value={query}
          aria-expanded={searchOpen} aria-controls="navigation-results" autoComplete="off"
          onFocus={() => setSearchOpen(true)} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'Escape') setSearchOpen(false);
            if (event.key === 'Enter' && searchOpen && results[0]) { event.preventDefault(); navigate(results[0].path); setSearchOpen(false); }
          }} className="pl-9 h-9 text-xs rounded-xl" />
        {searchOpen && <nav id="navigation-results" aria-label="Résultats de recherche des pages" className="absolute top-full mt-2 left-0 right-0 max-h-[60vh] overflow-auto rounded-xl border bg-background shadow-xl p-2">
          <p className="px-2 py-1 text-xs text-muted-foreground">{query ? 'Pages accessibles' : 'Accès rapide · tapez le nom d’une page'}</p>
          {results.map(item => <Link key={item.path} to={item.path} onClick={() => setSearchOpen(false)} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted focus-visible:bg-muted">
            <item.icon className="w-4 h-4 shrink-0" /><span className="text-sm">{item.label}<span className="block text-xs text-muted-foreground">{item.group}</span></span>
          </Link>)}
          {!results.length && <p role="status" className="p-2 text-sm">Aucune page accessible ne correspond à « {query} ».</p>}
        </nav>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {canAccess('/demandes') && <Button asChild variant="ghost" size="icon" aria-label="Ouvrir les demandes" title="Demandes à traiter"><Link to="/demandes"><MessageSquare className="w-4 h-4" /></Link></Button>}
        <Button variant="ghost" size="icon" aria-label="Aide à la navigation" title="Aide à la navigation" onClick={() => setHelpOpen(true)}><HelpCircle className="w-4 h-4" /></Button>
        <span title={user?.email} className="hidden sm:flex w-8 h-8 rounded-xl bg-primary/10 items-center justify-center text-primary text-xs font-bold">{user?.full_name?.charAt(0) || user?.email?.charAt(0)?.toUpperCase() || 'J'}</span>
      </div>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Se repérer dans le Cockpit</DialogTitle><DialogDescription>Choisissez une page selon ce que vous voulez faire.</DialogDescription></DialogHeader>
          <div className="space-y-3 text-sm">
            <p><strong>Rechercher une page :</strong> saisissez son nom, puis sélectionnez un résultat. Entrée ouvre le premier résultat ; Échap ferme la recherche.</p>
            <p><strong>Suivre le travail :</strong> les Demandes rassemblent les besoins ; les Projets et les Tâches servent à suivre leur réalisation.</p>
            <p><strong>Créer et gérer :</strong> le Studio regroupe la production de contenus ; Finance contient les devis et les factures.</p>
            <p><strong>Lire les états :</strong> une autorisation requise, une information manquante et une erreur technique demandent des actions différentes. « Terminée avec preuve » indique un résultat documenté.</p>
            <p className="text-muted-foreground">La recherche porte sur les pages accessibles à votre compte, pas sur le contenu des documents. Sur mobile, ouvrez le menu en haut à gauche.</p>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
