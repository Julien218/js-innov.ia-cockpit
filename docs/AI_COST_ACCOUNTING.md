# AI Cost Control — règles comptables

Le Cockpit sépare quatre catégories qui ne doivent jamais être additionnées sans distinction :

- `actual` : montant réel reçu d'une API fournisseur avec une référence vérifiable ;
- `manual_verified` : montant saisi depuis une facture ou un justificatif identifié ;
- `estimated` : calcul interne documenté (tokens, temps machine, énergie, amortissement) ;
- `unverified` : information incomplète, exclue des totaux vérifiés et des factures.

Le coût interne et le montant facturable restent deux champs séparés. La marge, le forfait, l'inclusion ou la refacturation au prix coûtant sont appliqués par `client_billing_rules` et ne modifient jamais la dépense fournisseur d'origine.

## Rattachements externes

Chaque identifiant externe actif ne peut appartenir qu'à un seul centre de coût. Types pris en charge :

- `openai_project` : projet OpenAI ;
- `railway_project` : projet Railway ;
- `github_user`, `github_org`, `github_repo` : compte, organisation ou dépôt GitHub ;
- `twilio_account` : compte ou sous-compte Twilio ;
- `supabase_project`, `dropbox_account`, `storage_account`, `media_provider`, `api_provider` : rattachements utilisés pour les justificatifs ou remontées d'usage.

## Sources automatiques

- OpenAI : endpoint officiel Organization Costs, avec pagination complète.
- GitHub : Billing Usage API, montant net après remises, filtrable par dépôt.
- Twilio : Usage Records `totalprice`, afin de ne pas additionner deux fois les catégories.
- Railway : adaptateur monétaire obligatoire. Il doit déclarer `accounting_status: "actual"` et fournir un `verification_ref` pour chaque ligne.

Supabase, Dropbox et les fournisseurs vidéo qui ne fournissent pas de coût facturé exploitable par API restent en mode « facture à importer ». L'ingestion manuelle exige `evidence_status=manual_verified` et `verification_ref`.

## Change USD/EUR

Toute conversion exige `BILLING_EUR_PER_USD` et `BILLING_FX_SOURCE`. Sans les deux, l'import est bloqué. Le taux et sa source sont conservés dans les métadonnées de chaque ligne.

## IA locale

Le calcul exige les trois valeurs suivantes :

- `LOCAL_AI_POWER_WATTS` ;
- `LOCAL_AI_ENERGY_EUR_KWH` ;
- `LOCAL_AI_MACHINE_EUR_HOUR`.

Le résultat reste classé comme estimation et conserve la durée, la puissance, le prix de l'énergie et le coût horaire machine utilisés.

## Facturation

Les événements `unverified` sont toujours exclus. Les lignes déjà rattachées à une facture sont verrouillées. Les références externes incluent la période et empêchent les doublons sans empêcher l'import du mois suivant.
