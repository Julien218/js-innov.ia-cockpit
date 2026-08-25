# AI Cost Control — règles comptables

Le Cockpit sépare quatre catégories qui ne doivent jamais être additionnées sans distinction :

- `actual` : montant réel reçu d'une API fournisseur avec une référence vérifiable ;
- `manual_verified` : montant saisi depuis une facture ou un justificatif identifié ;
- `estimated` : calcul interne documenté (tokens, temps machine, énergie, amortissement) ;
- `unverified` : information incomplète, exclue des totaux vérifiés et des factures.

Le coût interne et le montant facturable restent deux champs séparés. La marge, le forfait, l'inclusion ou la refacturation au prix coûtant sont appliqués par `client_billing_rules` et ne modifient jamais la dépense fournisseur d'origine.

Tant qu'une source utilisée par JS-Innov.IA n'est pas connectée ou couverte par un justificatif, le Cockpit affiche **Total comptable incomplet**. AI Cost Control reste alors un registre opérationnel et ne doit pas être repris comme total comptable exhaustif.

## Rattachements externes

Chaque identifiant externe actif ne peut appartenir qu'à un seul centre de coût. Types pris en charge :

- `openai_project` : projet OpenAI ;
- `railway_project`, `railway_service` : projet Railway complet ou service précis (le service conserve l'identifiant de son projet parent) ;
- `github_user`, `github_org`, `github_repo` : compte, organisation ou dépôt GitHub ;
- `twilio_account` : compte ou sous-compte Twilio ;
- `supabase_project`, `dropbox_account`, `storage_account`, `media_provider`, `api_provider` : rattachements utilisés pour les justificatifs ou remontées d'usage.

## Sources automatiques

- OpenAI : endpoint officiel Organization Costs, avec pagination complète.
- GitHub : Billing Usage API, montant net après remises, filtrable par dépôt.
- Twilio : Usage Records `totalprice`, afin de ne pas additionner deux fois les catégories.
- Railway : import par projet ou service via `RAILWAY_COSTS_ENDPOINT`. L'adaptateur monétaire doit déclarer `accounting_status: "actual"` et fournir un `verification_ref` pour chaque ligne.
- Supabase, Dropbox et générateurs vidéo/image : adaptateurs monétaires dédiés (`SUPABASE_COSTS_ENDPOINT`, `DROPBOX_COSTS_ENDPOINT`, `MEDIA_COSTS_ENDPOINT`) protégés par `COST_IMPORT_ADAPTER_TOKEN`. Le même contrat de preuve s'applique.

Si un fournisseur ne fournit pas de coût facturé exploitable par API, sa facture reste importable depuis l'interface. L'ingestion manuelle exige `evidence_status=manual_verified` et `verification_ref`; elle n'est jamais confondue avec un coût `actual` reçu d'une API.

## Change USD/EUR

Toute conversion exige `BILLING_EUR_PER_USD` et `BILLING_FX_SOURCE`. Sans les deux, l'import est bloqué. Le taux et sa source sont conservés dans les métadonnées de chaque ligne.

## IA locale

Le calcul exige les trois valeurs suivantes :

- `LOCAL_AI_POWER_WATTS` ;
- `LOCAL_AI_ENERGY_EUR_KWH` ;
- `LOCAL_AI_MACHINE_EUR_HOUR`.

Le résultat reste classé comme estimation et conserve la durée, la puissance, le prix de l'énergie et le coût horaire machine utilisés.

Ces trois valeurs peuvent être enregistrées dans AI Cost Control. Elles sont stockées côté serveur dans `cost_accounting_settings`; aucune valeur manquante n'est remplacée implicitement par zéro.

## Tableau de couverture unique

Le tableau fournisseur expose toujours des colonnes distinctes :

- **Réel API** ;
- **Manuel vérifié** ;
- **Estimé** ;
- **Non vérifié**.

La catégorie non vérifiée conserve son montant pour l'audit, mais elle est exclue des totaux vérifiés et de la facturation.

## Facturation

Les événements `unverified` sont toujours exclus. Les lignes déjà rattachées à une facture sont verrouillées. Les références externes incluent la période et empêchent les doublons sans empêcher l'import du mois suivant.
