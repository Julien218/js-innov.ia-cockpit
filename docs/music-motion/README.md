# Elynea Music Motion Studio — chaîne de production v2

## Périmètre livré

Module autonome, sans remplacer le Studio vidéo existant : chanson source, analyse intégrale locale, références de marque distinctes des médias de montage, import du pack ZIP historique, import/export ZIP natif avec médias, storyboard JSON, PDF comme source textuelle, tchat Ollama proposant des actions contrôlées, scènes et plans éditables, génération image/vidéo locale ou API, rendu FFmpeg et sauvegarde IndexedDB par utilisateur.

Les images ne deviennent pas des vidéos par changement d’étiquette. Les variantes non sélectionnées restent dans le projet. Le storyboard, les paroles et les raccords se valident séparément. Une animatique est explicitement distincte du clip final.

## Installation / livraison

1. Installer les dépendances npm verrouillées, puis `npm run build`. Le serveur doit inclure `server-music-motion.cjs` et `local-agent/music-motion-engine.mjs` ; le Dockerfile est mis à jour.
2. Sur Windows, remplacer le code de l’agent par cette version, conserver sa configuration et redémarrer l’agent. Les filtres Electron embarquent les nouveaux helpers. Cette livraison ne déclenche pas de nouvelle version Electron ni de mise à jour automatique du poste.
3. Installer explicitement les bibliothèques de `local-agent/requirements-music-motion.txt` dans l’interpréteur réellement utilisé par l’agent. Définir `MUSIC_MOTION_PYTHON` vers cet interpréteur. FFmpeg et FFprobe doivent être disponibles. Aucune installation de modèle n’est déclenchée par un bouton du studio.
4. Whisper utilise un modèle déjà présent en cache ou un dossier `MUSIC_MOTION_WHISPER_MODEL`. Le chargement est `local_files_only=True`. Un modèle absent produit une erreur explicite ; il doit être provisionné séparément par l’administrateur. Le repli CUDA → CPU conserve les tests existants.
5. Ouvrir le studio, importer l’audio complet, les références et/ou le ZIP, puis « Vérifier les moteurs ».

## Première production

- Importer la chanson entière et le pack. Le pack Grok historique contient 8 images et 8 scènes, mais pas la chanson ni des vidéos.
- Analyser toute la source. La mesure complète inclut décodage strict, empreinte SHA-256, durée réellement décodée, courbes énergétiques, attaques, pulsations et sections proposées. Une erreur ne crée plus une timeline de secours présentée comme une analyse.
- Vérifier les paroles proposées. Les paroles originales peuvent être jointes en texte de référence ; elles ne sont pas automatiquement alignées. La transcription chantée peut être erronée, même si le décodage est complet.
- Demander un storyboard au tchat, puis appliquer sa proposition, ou ajuster les timecodes importés. Aucun titre couplet/refrain n’est considéré comme une mesure certaine.
- Découper les scènes en plans de 8 secondes maximum, affecter leurs images, puis générer/importer les vidéos. Une scène de 63 secondes demande plusieurs plans, pas une vidéo de 7 secondes étirée.
- Contrôler les durées, entrées, cadres et raccords, puis valider le storyboard.
- Rendre d’abord une animatique ou le clip vidéo complet. Le rendu final refuse les trous, chevauchements et vidéos trop courtes, et exige une preuve d’analyse locale correspondant au SHA de l’audio courant.
- Ajouter uniquement le vrai logo importé et les sous-titres validés au montage. Les sons des vidéos générées ne remplacent jamais la chanson originale.
- Exporter le MP4 et le ZIP natif. Les sauvegardes automatiques IndexedDB restent propres au navigateur et au compte ; elles ne sont pas une sauvegarde serveur synchronisée.

## Local et API : aucune bascule implicite

### Local

`POST /api/music-motion/production/jobs` reçoit `analyze`, `image`, `video` ou `render`. L’agent utilise des identifiants opaques, un stockage local persistant et une file séquentielle. Les médias sont envoyés en binaire, pas noyés dans un JSON audio de 14 Mo.

L’image locale est une génération/variation de référence par workflow ComfyUI standard compatible avec un checkpoint installé. Le fait qu’un fichier de modèle soit listé ne garantit pas sa compatibilité avec ce workflow ni sa qualité. Aucun modèle n’est téléchargé en cas d’échec. La fidélité de la mascotte se contrôle visuellement.

La vidéo locale nécessite un workflow opérateur installé dans `MUSIC_MOTION_WORKFLOW_DIR` (par défaut `MusicMotion-workflows` à côté du stockage local). Un workflow provenant d’un ZIP de projet n’est jamais exécuté.

Descripteur requis, à remplir à partir d’un workflow ComfyUI exporté au format API et réellement testé :

```json
{
  "kind": "video",
  "label": "Nom du workflow installé",
  "workflow": { "ID": { "class_type": "Classe réelle installée", "inputs": {} } },
  "output_node": "ID_du_noeud_produisant_un_MP4_ou_WEBM",
  "bindings": {
    "prompt": { "node": "ID_du_noeud_texte", "input": "text" },
    "image": { "node": "ID_LoadImage", "input": "image" },
    "duration": { "node": "ID_configuration", "input": "duration" },
    "seed": { "node": "ID_sampler", "input": "seed" }
  }
}
```

Ce schéma est un **contrat de configuration, pas un workflow vidéo prêt à exécuter**. Les noms des nœuds et paramètres dépendent du modèle installé. La sortie doit être une vidéo effectivement décodable ; une sortie PNG est refusée pour une tâche vidéo. Arrêter le suivi ComfyUI ne force pas l’arrêt global d’une génération appartenant à un autre outil.

### API xAI (option payante)

Le serveur exige une session admin et l’autorisation `production`. `XAI_API_KEY` reste sur le serveur. `MUSIC_MOTION_DATA_DIR` doit pointer vers un volume persistant avant l’activation de l’API ; monter le volume est une opération d’infrastructure distincte de cette livraison.

Chaque appel est explicitement confirmé : une demande payante, transfert du prompt et de l’image à xAI, aucun audio transmis. Une même clé de demande n’est jamais soumise deux fois. Une réponse perdue ne déclenche pas de nouvelle dépense. Les quotas sont des plafonds **en nombre de demandes**, pas un budget monétaire. Le coût réel n’est pas calculé ici ; il doit être vérifié dans le compte fournisseur. Aucune écriture comptable fictive n’est créée.

Le serveur télécharge les résultats temporaires et les conserve, vérifie les vidéos par FFprobe et cloisonne les espaces par utilisateur. Seuls les hôtes médias xAI approuvés sont autorisés, sans redirection ni téléchargement d’URL arbitraire. Un prix, une clé ou un modèle absent bloque l’utilisation prévue ou est signalé explicitement ; pas de promesse de gratuité.

Modèles par défaut issus de la documentation consultée le 12 septembre 2026 : `grok-imagine-image-2.0` et `grok-imagine-video-1.5`. Configurables par environnement. L’accès réel au compte et les générations payantes n’ont pas été testés pendant le développement.

Références techniques :
- https://docs.x.ai/developers/model-capabilities/video/generation
- https://docs.x.ai/developers/model-capabilities/images/generation
- https://docs.x.ai/developers/model-capabilities/images/editing
- https://docs.comfy.org/development/comfyui-server/comms_routes

## Import / sauvegarde / sécurité

- ZIP natif : `project.elynea.json`, médias et prompts. Les octets médias et leurs empreintes sont inclus, pas des URLs `blob:` temporaires.
- ZIP historique : images numérotées, prompts texte et CSV de montage ; le moteur affiche les associations et les manques avant import.
- JSON storyboard : scènes/sections, timecodes, prompts. La chanson courante est conservée ; les références absentes ne sont pas inventées.
- PDF : texte source conservé avec pages, sans OCR ni interprétation automatique des graphiques. Aucune incohérence du document n’est corrigée silencieusement.
- Traversées de chemins, liens symboliques, archives chiffrées, CRC invalides et types actifs HTML/SVG sont rejetés. Les scripts présents dans un pack ne sont pas exécutés.
- Limites de protection : source/analyse 30 minutes ; média local 256 Mo ; ZIP complet 512 Mo, taille décompressée totale 512 Mo ; 200 scènes et 2 000 plans/médias. Le stockage du navigateur peut imposer une limite plus basse. Une erreur de quota est affichée.
- Après réimport sur un autre poste, relancer l’analyse locale pour créer la preuve de rendu de ce poste.
- `LOCAL_AGENT_TOKEN` reste recommandé sur les postes partagés. Les routes vérifient l’Origin et le Host en plus de l’authentification existante. Les utilisateurs du même système local ne sont pas séparés par l’agent comme des locataires cloud.

## Vérification

```sh
node --test tests/music-motion-production.test.cjs tests/music-motion-cloud.test.cjs tests/music-motion-render.test.cjs
python tests/music_motion_analysis_test.py
python tests/whisper_fallback_test.py
npm run build
```

Les tests utilisent des sons synthétiques, de faux échanges fournisseur et un vrai rendu FFmpeg. Ils ne prouvent pas la qualité esthétique d’un modèle, l’exactitude des paroles chantées, l’installation de ComfyUI sur le PC, ni l’accès d’un compte à l’API. Aucun clip client ou appel payant n’est fabriqué pendant les tests.

## Limites explicites de cette version

Le tchat produit des propositions structurées via Ollama, avec validation avant application ; ce n’est pas un agent autonome sans contrôle. Les images doivent être relues, les scènes qualifiées et les paroles corrigées. Les transitions livrées sont les coupes et fondus **par le noir**, pas une table de mixage vidéo multicouche. La prévisualisation navigateur sert aux repères ; le rendu FFmpeg applique le logo, les sous-titres et les fondus finaux. Une version 1080p peut être un agrandissement de sources 720p, jamais une preuve de détail natif supplémentaire. Le flux local vidéo et les modèles doivent être adaptés à la machine ; aucune promesse universelle sur 6 Go de VRAM.
