# Pilote Olivier Trevis — recette sur site

## Prerequis staging

- Appliquer `002_commerce_signage.sql`, puis `003_signage_runtime.sql` sur Supabase staging.
- Configurer uniquement sur Railway staging : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `COMMERCE_BRIDGE_KEY`, `DROPBOX_ACCESS_TOKEN`.
- Configurer le site staging avec la meme `COMMERCE_BRIDGE_KEY`, les cles Stripe **test** et les quatre Price IDs test.
- Brancher le mini-PC Player en HDMI sur l'entree du Colorlight X2M. Ne modifier ni le mapping LED ni la production.

## Recette bloquante

1. Effectuer une commande Stripe test `signage-surveillance` avec l'adresse du compte Olivier.
2. Verifier un seul evenement par `event_id`, une commande payee et les deux entitlements actifs.
3. Se connecter au cockpit comme Olivier : les menus Ecran geant et Videosurveillance doivent apparaitre.
4. Enroler le Player une fois, conserver son jeton dans le magasin de secrets local et verifier un heartbeat toutes les 30 s.
5. Envoyer une video test Dropbox, verifier SHA-256, transcoder H.264/yuv420p/AAC/MP4 faststart avec FFmpeg, puis publier.
6. Le Player telecharge dans un fichier temporaire, verifie le SHA-256 et la lecture, bascule atomiquement, puis envoie `ack=active`.
7. Couper Internet 10 minutes : la derniere publication valide doit continuer via HDMI vers le X2M.
8. Publier volontairement un media invalide : le Player doit refuser, conserver l'ancienne campagne et envoyer `ack=failed`.
9. Enroler la passerelle camera sur le reseau local. Les identifiants RTSP restent uniquement sur la passerelle; aucun port RTSP n'est expose sur Internet.
10. Verifier la consultation via la passerelle, la perte/reprise de connexion et l'archivage Dropbox attendu.
11. Annuler l'abonnement test et verifier la desactivation des menus apres actualisation.

## Decision

Ne pas fusionner les PR #30 et #8 et ne pas deployer en production tant que les onze controles ne sont pas verts et signes par JS-Innov.IA et Olivier.
