# Fabrique locale de vidéos pour écran géant

## Objectif

Produire localement de 1 à 32 vidéos publicitaires, préparer trois propositions par client, générer un montage comparatif puis exporter le choix validé au format écran géant.

## Format de production

- durée de chaque master : 8 secondes ;
- format final : 1920 × 1080 ;
- cadence : 25 images/seconde ;
- codec : H.264, pixel format yuv420p ;
- création locale : MiniMax H3 dans ComfyUI ;
- file persistante : 32 vidéos maximum ;
- concurrence : un rendu GPU à la fois.

## Prérequis du poste Windows

1. Mettre ComfyUI à jour en version `0.30.0` minimum, puis le lancer sur `127.0.0.1:8188`.
2. Installer MiniMax H3 et ses modèles dans ComfyUI.
3. Installer FFmpeg et FFprobe dans le `PATH`.
4. Depuis ComfyUI, exporter le workflow H3 Image-to-Video au **format API**.
5. Ouvrir le Cockpit desktop, puis **Production → Produire 3 propositions en local**.
6. Importer une fois le workflow API. Il reste mémorisé sur ce PC.

Le voyant **Atelier local prêt** exige simultanément ComfyUI, FFmpeg et le nœud local `MiniMaxH3ImageToVideo`. Les nœuds MiniMax partenaires qui consomment une API ne sont jamais présentés comme un moteur local.

La concurrence limitée à un rendu protège contre deux charges GPU simultanées, mais ne garantit pas qu’un modèle H3 complet tienne dans 6 Go de VRAM. Le Cockpit verrouille donc la capacité à trois vidéos jusqu’à ce que le poste réussisse un lot réel complet avec durées d’exécution prouvées. La limite de 32 est débloquée uniquement après cette qualification locale.

Le Cockpit recherche automatiquement les dossiers ComfyUI portables, classiques et Comfy Desktop. Les emplacements personnalisés peuvent être indiqués avec :

- `JSINNOVIA_COMFYUI_OUTPUT_DIR`
- `JSINNOVIA_COMFYUI_INPUT_DIR`
- `JSINNOVIA_COMFYUI_PORT`

## Parcours opérateur

1. Renseigner le client, le numéro de téléphone exact, les services, la localité et le brief.
2. Générer les trois directions créatives.
3. Ajouter le logo ou visuel source à chaque proposition.
4. Vérifier ou modifier les prompts.
5. Lancer le lot local.
6. Attendre la fin des trois premières propositions.
7. Générer le comparatif **1 · 2 · 3**.
8. Après le choix du client, exporter la proposition retenue.
9. Ouvrir **Écran géant** pour préparer la diffusion.

Le client Cockpit est obligatoire. Le temps d’exécution réellement journalisé par ComfyUI est transmis à **AI Cost Control** avec un identifiant stable par vidéo. Si les tarifs machine/électricité ne sont pas configurés, le coût reste explicitement non comptabilisé et n’est pas transformé en zéro.

## Sorties locales

- comparatifs : `Vidéos/JS-Innov.IA/Validations/<Client>/<Campagne>/`
- masters validés : `Vidéos/JS-Innov.IA/Ecran-geant/<Client>/<Campagne>/`

Le master validé contient une carte finale déterministe de trois secondes avec le visuel source, le nom du client et le numéro de téléphone exact. Le nom du MP4 suit la convention JS‑Innov.IA. Les métadonnées invisibles sont vérifiées avec FFprobe, puis un fichier JSON portant le même nom enregistre le prompt, les sources, la campagne, les droits, les paramètres techniques et l’empreinte SHA‑256. Le copyright n’est attribué à JS‑Innov.IA que si la case de confirmation contractuelle a été cochée.

## Sécurité et fiabilité

- aucun service vidéo externe n’est requis ;
- les traitements locaux passent uniquement par l’adresse de bouclage ;
- la file est enregistrée dans les données de l’application desktop ;
- un redémarrage du Cockpit ne supprime pas les lots et la file perdue par ComfyUI est reprise une seule fois ;
- une seule vidéo est envoyée à la file ComfyUI à la fois ;
- un échec ou une exécution sans fichier ne peut jamais être marqué terminé ;
- l’accès aux chemins de fichiers est limité aux dossiers ComfyUI et aux productions locales du Cockpit.
