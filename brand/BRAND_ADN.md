# SIGNELYA — Bible ADN canonique (application)

Statut : **production / branche Railway réellement déployée**  
Dernier alignement : 2026-09-23

## Identité
- Application : **SIGNELYA by JS-Innov.IA**
- Nom court : **SIGNELYA**
- Promesse : **Vos écrans prennent vie**
- Assistante intégrée : **Elynea**
- L'application doit rester visuellement distincte du Cockpit JS-Innov.IA générique.

## Wordmark officiel
`src/components/brand/SignelyaWordmark.jsx` définit la séquence :
S `#00D4FF` · I `#20B8FF` · G `#4E8BFF` · N `#755BFF` · E `#9E35F3` · L `#CA1EE4` · Y `#EA12D8` · A `#FF00CC`.

L'animation lumineuse lettre par lettre est autorisée ; elle doit respecter `prefers-reduced-motion`.

## Assets approuvés
- `public/signelya-app-icon-approved.png` — master carré approuvé 1254×1254
- `public/signelya-symbol-approved-512.png` — symbole compact
- `public/signelya-lockup-approved.png` — lockup complet
- `public/signelya-social-share.jpg` — partage social
- dérivés PWA 192/512 et maskable générés depuis le master

La note historique `__manual_release_only__/signelya-official-adn-logo-20260903.txt` confirme : pas de redessin ni modification de couleur.

## Typographies / UI
- Titres de marque / panneaux : **Space Grotesk**
- UI / messages : **Inter**
- Fond : bleu nuit/noir ; accents cyan, bleu, violet et magenta.
- Les gradients sont des accents lumineux ; conserver une surface sombre majoritaire.

## Garde-fous déjà testés
`tests/signelya-brand.test.cjs` vérifie l'identité dans navigation, authentification, wordmark, PWA, icônes, assistant Elynea et partage social. Cette suite est une partie de la qualité de marque et ne doit pas être supprimée.

## Règles agents
- Toujours utiliser les exports approuvés.
- Ne jamais réintroduire l'ancien SVG simplifié.
- Ne jamais remplacer Elynea par Nova dans l'expérience client SIGNELYA.
- Ne jamais importer palette/asset d'un autre produit.
- Toute nouvelle icône dérivée doit provenir du master approuvé, jamais d'une génération IA.
