# Checklist — Validation Juridique Humaine (RGPD)

> ⚠️ Tous les éléments ci-dessous nécessitent une validation par un professionnel du droit (RGPD/juriste).
> L'implémentation technique est terminée mais ne constitue pas une conformité juridique en soi.

## Registre des traitements (Art. 30 RGPD)
- [ ] Valider chaque traitement déclaré dans `governance.processing_activity`
- [ ] Confirmer la base légale de chaque traitement (consentement, contrat, obligation légale, intérêt légitime)
- [ ] Valider les destinataires et sous-traitants pour chaque traitement
- [ ] Confirmer les mesures de sécurité décrites

## Bases légales
- [ ] Art. 6(1)(a) — Consentement: pour quels traitements?
- [ ] Art. 6(1)(b) — Exécution du contrat: clients, factures, projets
- [ ] Art. 6(1)(c) — Obligation légale: conservation comptable 7 ans
- [ ] Art. 6(1)(f) — Intérêt légitime: prospection, sécurité

## Durées de conservation
- [ ] Factures: 7 ans (Code comptable belge) — à confirmer
- [ ] Devis: 2 ans — à confirmer
- [ ] Données client: durée relation + prescription — à confirmer
- [ ] Leads: 3 ans — à confirmer
- [ ] Logs: 1 an — à confirmer
- [ ] Consentements: 3 ans après retrait — à confirmer

## DPA (Data Processing Agreement)
- [ ] Railway — DPA à signer
- [ ] Supabase — DPA à signer
- [ ] Dropbox — DPA à signer
- [ ] OpenAI — DPA à vérifier/signer
- [ ] xAI — DPA à signer
- [ ] IONOS — DPA à signer
- [ ] Stripe — DPA à vérifier
- [ ] Peppol — DPA à vérifier
- [ ] Google — DPA à vérifier
- [ ] Base44 — DPA à signer

## Transferts internationaux
- [ ] Identifier tous les transferts hors EEE (USA notamment)
- [ ] Vérifier les mécanismes de transfert (décision d'adéquacy, SCC, BCR)
- [ ] Évaluer l'impact des transferts (Schrems II)

## Documentation externe
- [ ] Politique de confidentialité à rédiger/publier
- [ ] Mentions légales à rédiger/publier
- [ ] Gestion des cookies à évaluer (si traceurs facultatifs présents)
- [ ] Responsabilités responsable/sous-traitant à formaliser

## AIPD / DPIA (Art. 35 RGPD)
- [ ] Évaluer la nécessité d'une AIPD pour les traitements à risque élevé
- [ ] Notamment: IA (profiling, analyse automatique), vidéosurveillance, données sensibles

## Procédures d'incident
- [ ] Procédure de notification de violation de données (Art. 33-34 RGPD)
- [ ] Délai de 72h pour notification à l'APD
- [ ] Communication aux personnes concernées si risque élevé

## Registre des violations
- [ ] Documenter toute violation de données (même non notifiable)
- [ ] Consigner: nature, catégories, nombre de personnes, conséquences, mesures prises

## Désignation DPO
- [ ] Évaluer l'obligation de désignation d'un DPO (Art. 37 RGPD)
- [ ] Si désignation: publier les coordonnées du DPO
