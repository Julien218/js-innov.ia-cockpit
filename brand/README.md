# Registre ADN multi-marques du Cockpit

Ce dossier est la **porte d'entrée obligatoire** pour Elynea, les agents de campagne, les générateurs d'images/vidéos et tout module qui produit un contenu de marque.

## Règle principale

**Aucune génération de marque ne doit commencer tant que la marque active n'est pas résolue.**

1. Résoudre la marque par domaine, `brandId` ou alias via `brand/brand-registry.json`.
2. Charger le manifeste canonique indiqué pour **le dépôt et la branche de production exacts**.
3. Charger ensuite la Bible / planche référencée par ce manifeste.
4. Appliquer les assets, couleurs, typographies et interdictions de cette marque seulement.
5. Si la marque ne peut pas être résolue : retourner `BLOCK_BRAND_CONTEXT_REQUIRED`.
6. Si un asset canonique est manquant : retourner un blocage explicite ; ne jamais fabriquer de substitut.

## Interdictions absolues

- Pas de fallback automatique vers JS-Innov.IA.
- Pas de recherche du « logo le plus proche » dans un dépôt.
- Pas de mélange de palettes entre deux clients/produits.
- Pas de redessin ou génération de logo verrouillé.
- Pas d'utilisation d'une planche historique comme planche active sans déclaration dans le manifeste.
- Pas de copie d'un thème annuel précédent vers l'édition courante.

## Cockpit lui-même

`brand/cockpit.manifest.json` décrit uniquement l'interface **JS-Innov.IA Cockpit**. Elle ne doit jamais servir de Bible de secours pour une autre marque.

## Mise à jour

Lorsqu'une nouvelle marque est publiée :
- créer sa Bible + son manifeste dans son dépôt de production ;
- ajouter ici une entrée avec domaine, dépôt, branche et chemin du manifeste ;
- ne publier les modules de génération qu'après cette étape.
