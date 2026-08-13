# Politiques de Conservation des Données — JS-Innov.IA Cockpit

**Projet :** JS-Innov.IA Cockpit
**Statut juridique :** **A VALIDER JURIDIQUEMENT** (Toutes les durées et actions proposées sont soumises à validation juridique formelle)
**Version :** 1.0.0
**Date :** 13 août 2026

---

## 1. Principes de Rétention & Fin de Durée

Conformément à l'article 5.1.e du RGPD, les données à caractère personnel ne doivent pas être conservées au-delà de la durée nécessaire aux finalités pour lesquelles elles sont traitées.

Le Cockpit JS-Innov.IA met en œuvre la table de référence `governance.retention_policy` qui définit pour chaque catégorie de données :
1. La durée maximale de conservation active.
2. L'action à réaliser à l'échéance (`delete`, `anonymize`, `archive`, `review`).
3. Le statut de validation juridique (`pending`, `validated`, `rejected`).

---

## 2. Table Synthétique des Durées de Conservation Proposées

> **REMARQUE IMPORTANTE :** L'intégralité des valeurs de ce tableau porte le statut **`A VALIDER JURIDIQUEMENT`** (`validation_status = 'pending'`).

| Catégorie (`category`) | Libellé / Périmètre | Durée Proposée (`retention_period_days`) | Durée Équivalente | Action à l'Échéance | Justification & Référence Légale Proposée | Statut Juridique |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`lead`** | Prospects & Contacts commerciaux | `1095` jours | **3 ans** | `anonymize` | Recommandation CNIL / DPA prospect B2B à compter du dernier contact entrant. | **A VALIDER JURIDIQUEMENT** |
| **`client`** | Données Clients & Comptes actifs | `1825` jours | **5 ans** | `review` | Prescriptions civiles et commerciales post-fin de contrat (Code de commerce). | **A VALIDER JURIDIQUEMENT** |
| **`invoice`** | Factures & Pièces comptables | `3650` jours | **10 ans** | `archive` | Obligation légale comptable et fiscale (Code de commerce / Code général des impôts). | **A VALIDER JURIDIQUEMENT** |
| **`quote`** | Devis non signés / refusés | `730` jours | **2 ans** | `delete` | Droit de la preuve contractuelle et gestion commerciale. | **A VALIDER JURIDIQUEMENT** |
| **`project`** | Projets, Tâches, Livrables | `1825` jours | **5 ans** | `archive` | Garantie légale et responsabilité contractuelle post-livraison. | **A VALIDER JURIDIQUEMENT** |
| **`audit_log`** | Journal d'audit de sécurité | `365` jours | **1 an** | `delete` | Recommandations sécurité CNIL / ANSSI pour traçabilité des accès. | **A VALIDER JURIDIQUEMENT** |
| **`consent_record`** | Registre des consentements | `1825` jours | **5 ans** | `archive` | Durée de preuve du consentement post-retrait (sécurité juridique). | **A VALIDER JURIDIQUEMENT** |
| **`dsr_request`** | Demandes d'exercice de droits RGPD | `1825` jours | **5 ans** | `archive` | Preuve du respect des obligations légales face aux autorités de contrôle. | **A VALIDER JURIDIQUEMENT** |
| **`user_session`** | Sessions & Tokens de connexion | `30` jours | **1 mois** | `delete` | Hygiène de sécurité des accès et nettoyage des tokens expirés. | **A VALIDER JURIDIQUEMENT** |
| **`email_log`** | Logs de messagerie & métadonnées | `180` jours | **6 mois** | `delete` | Diagnostic technique et prévention des abus. | **A VALIDER JURIDIQUEMENT** |

---

## 3. Détail des Actions en Fin de Période (`action_on_expiry`)

- **`delete` (Suppression définitive) :** Effacement irréversible de l'enregistrement de la base de données PostgreSQL et purge des fichiers associés dans Dropbox.
- **`anonymize` (Anonymisation) :** Suppression des champs identifiants (nom, prénom, email, téléphone, IP) et conservation des métadonnées agrégées à des fins purement statistiques (ex: montant total devisé sans nom de prospect).
- **`archive` (Archivage intermédiaire) :** Transfert de la donnée ou du document vers une table ou un dossier d'archivage à accès restreint (accès `superadmin` uniquement sur justification), avec blocage de toute modification.
- **`review` (Revue manuelle) :** Alerte transmise à l'administrateur pour décider d'une prolongation justifiée ou de la suppression du dossier.

---

## 4. Procédure d'Exécution des Purgés

1. **Calcul Automatisé :** Un job périodique de gouvernance interroge la table `governance.retention_policy` et compare les dates `created_at` ou `updated_at` des enregistrements métier avec `retention_period_days`.
2. **Phase de Prévisibilité :** Un rapport d'avertissement est généré avant toute suppression irréversible.
3. **Mise en Œuvre & Audit :** Chaque opération de purge ou d'anonymisation fait l'objet d'un enregistrement dans `governance.audit_log` avec la sévérité `warning`.

---

## 5. Reserve de Validation Juridique

> **STATUT : A VALIDER JURIDIQUEMENT**
> Les durées de rétention inscrites ci-dessus sont des propositions techniques formulées à partir des usages courants du secteur. Elles ne constituent en aucun cas une règle juridique contraignante tant qu'elles n'ont pas été formellement validées et signées par le DPO ou le conseil juridique de l'entreprise.
