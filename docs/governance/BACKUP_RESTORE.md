# Backup & Restauration — Cockpit JS-Innov.IA

## Architecture

### Railway
- **Backend**: Express (cockpit-v3) + jsinnovia-agent
- **DB**: Supabase PostgreSQL (hébergé séparément)
- **Déploiements**: auto-deploy depuis GitHub `main`, historique des déploiements conservé

### Supabase (deux projets)
1. **rzvvwcwyaddzsaattwqt** (js-innovia-cockpit) — Auth + Assets
2. **gfjpryakxzdzwnazlsfz** — Business data (CRM, factures, governance)

### Dropbox
- Coffre documentaire: `/Cockpit/Clients/<client>/Factures/`, `/Documents/`, etc.
- Versioning Dropbox: historique de 30/180 jours selon le plan

## Sauvegardes

### Supabase
- **Backups automatiques**: Supabase Pro fournit des backups journaliers avec 7 jours de rétention
- **Point-in-Time Recovery (PITR)**: disponible sur les plans Pro+
- ⚠️ **À VÉRIFIER**: confirmer le plan Supabase actuel et la rétention réelle
- **Action requise**: vérifier dans le dashboard Supabase que les backups sont actifs

### Dropbox
- **Versioning**: les fichiers supprimés/modifiés sont récupérables pendant 30 jours minimum
- ⚠️ **À VÉRIFIER**: confirmer le plan Dropbox et la durée de rétention

### Code (GitHub)
- **Repo privé**: Julien218/js-innov.ia-cockpit
- **Historique complet**: toutes les branches et commits sont conservés
- **Releases**: tagger les versions stables

## Restauration

### Procédure de restauration Supabase
1. Se connecter au dashboard Supabase
2. Aller dans Database > Backups
3. Sélectionner le point de restauration désiré
4. Restaurer vers un nouveau projet (recommandé) ou en place
5. Vérifier l'intégrité des données après restauration
6. Mettre à jour les variables Railway si l'URL change

### Procédure de restauration Dropbox
1. Se connecter à Dropbox
2. Aller dans les fichiers supprimés (dropbox.com/deleted)
3. Restaurer les fichiers/dossiers nécessaires
4. Vérifier que le DocumentIndex dans Supabase est cohérent

### Procédure de restauration Railway
1. Aller sur railway.app > projet > déploiements
2. Rollback vers le déploiement précédent (si problème de code)
3. Vérifier les logs après rollback

## RPO/RTO proposés

| Système | RPO (perte max) | RTO (récupération) |
|---------|-----------------|-------------------|
| Supabase DB | 24h (backup daily) | 1-2h |
| Dropbox | 30 jours | <1h |
| Code GitHub | 0 (git) | <30min |
| Railway deploy | 0 (auto-deploy) | <5min |

⚠️ Ces valeurs sont des **objectifs proposés** et non des garanties — à valider avec les fournisseurs.

## Tests de restauration

- ⚠️ **À FAIRE**: effectuer un test de restauration Supabase (restaurer un backup vers un projet test)
- ⚠️ **À FAIRE**: effectuer un test de restauration Dropbox (récupérer un fichier supprimé)
- Ne jamais déclarer un backup opérationnel uniquement parce qu'une option existe dans un dashboard
