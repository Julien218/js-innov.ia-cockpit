# Procédure de Traitement des Demandes RGPD (Data Subject Requests — DSR) — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit
**Référence réglementaire :** RGPD Articles 12 à 22
**Statut juridique :** **A VALIDER JURIDIQUEMENT**
**Version :** 1.0.0
**Date :** 13 août 2026

---

## 1. Types de Demandes Supportées (`request_type`)

Toute personne physique dont les données sont traitées par le Cockpit JS-Innov.IA peut exercer ses droits fondamentaux conformément au RGPD. La table `governance.data_subject_request` enregistre et suit chaque demande selon les types suivants :

1. **`access` (Droit d'accès — Art. 15) :** Obtenir la confirmation que des données sont traitées et en recevoir une copie complète.
2. **`rectification` (Droit de rectification — Art. 16) :** Obtenir la correction d'informations inexactes ou incomplètes.
3. **`erasure` (Droit à l'effacement / Droit à l'oubli — Art. 17) :** Demander la suppression des données à caractère personnel.
4. **`restriction` (Droit à la limitation — Art. 18) :** Demander le gel temporaire du traitement sans suppression de la donnée.
5. **`objection` (Droit d'opposition — Art. 21) :** S'opposer au traitement fondé sur l'intérêt légitime ou à la prospection commerciale.
6. **`portability` (Droit à la portabilité — Art. 20) :** Recevoir ses données dans un format structuré, couramment utilisé et lisible par machine (JSON / CSV).
7. **`withdraw_consent` (Retrait de consentement — Art. 7.3) :** Retirer à tout moment un consentement préalablement donné.

---

## 2. Cycle de Vie & Workflow de Traitement (`status`)

Le traitement de chaque demande respecte le workflow à 6 états ci-dessous :

```
[received] ──> [in_review] ──> [processing] ──┬──> [completed]
                                              ├──> [partially_completed]
                                              └──> [rejected]
```

### Étapes Clés du Workflow
1. **`received` (Réception) :** La demande est enregistrée dans `governance.data_subject_request`. L'horodatage `received_at` est fixé, et l'échéance `due_date` est automatiquement calculée à **+30 jours**.
2. **`in_review` (Examen initial) :**
   - **Vérification d'Identité :** Contrôle rigoureux de l'identité du demandeur (pièce d'identité ou authentification forte).
   - **Vérification de la Faisabilité & Périmètre :** Analyse de la portée (`scope`) de la demande.
3. **`processing` (Traitement technique) :** L'équipe technique procède aux opérations d'extraction, de modification, d'anonymisation ou d'archivage dans les bases Supabase et le coffre Dropbox.
4. **Conclusion :**
   - **`completed` :** La demande a été intégralement exécutée et confirmée au demandeur.
   - **`partially_completed` :** La demande a été partiellement exécutée (voir section 4 sur les obligations légales de conservation).
   - **`rejected` :** La demande est refusée pour motif légal légitime (avec mention obligatoire dans `rejection_reason`).

---

## 3. Délais Légaux de Traitement

- **Délai Standard :** La réponse finale doit être apportée dans un délai maximal de **30 jours révolus** (`INTERVAL '30 days'`) à compter de la réception de la demande et de la confirmation d'identité.
- **Prolongation Exceptionnelle :** En cas de complexité particulière ou de nombre élevé de demandes, ce délai peut être prolongé de **2 mois supplémentaires** (soit 90 jours au total).
  - *Condition obligatoire :* Le demandeur doit être informé de la prolongation et des motifs du report dans les 30 jours initiaux.
- **Alerte d'Échéance :** Un système d'alerte signale les demandes dont la date `due_date` approche à moins de 7 jours.

---

## 4. Arbitrage : Obligation Légale de Conservation vs Droit à l'Effacement (`erasure`)

### Le Principe des Obligations Légales Supérieures
Lorsqu'un client ou prospect formule une demande d'effacement (`erasure`), le droit à l'oubli **ne prévaut pas** sur les obligations légales impératives de conservation auxquelles est soumise l'entreprise.

### Cas Pratique : Les Documents Comptables et Factures
- **Règle :** Conformément au Code de commerce et au Code général des impôts, toutes les factures (`Facture`), devis signés (`Devis`), et pièces comptables associées conservés dans Supabase et Dropbox doivent être gardés pendant une durée minimale de **10 ans**.
- **Procédure d'Arbitrage :**
  1. Les données marketing, comptes d'accès, sessions et profils utilisateurs non financiers sont immédiatement **supprimés ou anonymisés**.
  2. Les factures et pièces comptables sont **conservées** dans un état verrouillé en accès restreint (`superadmin` uniquement), hors de la base active.
  3. Le statut de la demande passe en **`partially_completed`**.
  4. Une note explicative explicite est inscrite dans `legal_retention_note` (ex: *"Effacement partiel réalisé. Les factures de la période 2024-2026 sont conservées pendant 10 ans au titre des obligations comptables légales (Art. L123-22 du Code de commerce)."*).
  5. Un courrier officiel formalisé est transmis au demandeur pour lui notifier l'exécution partielle et les motifs légaux de conservation des pièces financières.

---

## 5. Sécurité et Journalisation

- Toutes les opérations liées à l'exécution d'une demande RGPD génèrent un enregistrement d'audit dans `governance.audit_log` avec la sévérité `info` ou `warning`.
- Les données d'identité transmises pour la vérification du demandeur ne sont conservées que pendant le temps nécessaire au traitement de la demande puis purgées.

---

## 6. Avertissement Légal

> **STATUT : A VALIDER JURIDIQUEMENT**
> Les procédures d'arbitrage entre effacement et obligations légales de conservation ainsi que les modèles de réponse au demandeur doivent être validés par le service juridique ou le DPO avant la première mise en œuvre opérationnelle.
