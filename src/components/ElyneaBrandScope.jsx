import { useEffect, useRef } from 'react';

const ELYNEA_AVATAR_DATA_URI = 'data:image/webp;base64,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';

/**
 * Identité visuelle canonique du Cockpit.
 *
 * Elynea est l'unique Companion visible de JS-Innov.IA. Les anciens noms/avatars
 * NOVA restent uniquement des alias techniques de compatibilité et ne doivent
 * jamais réapparaître dans l'interface utilisateur.
 */
export const ELYNEA_COMPANION = Object.freeze({
  key: 'elynea',
  name: 'Elynea',
  role: 'Companion du Cockpit',
  brand: 'JS-Innov.IA',
  avatar: ELYNEA_AVATAR_DATA_URI,
});

export const OFFICIAL_ELYNEA_AVATAR = ELYNEA_COMPANION.avatar;

function replaceLegacyName(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\bNOVA\b/g, ELYNEA_COMPANION.name)
    .replace(/\bNova\b/g, ELYNEA_COMPANION.name)
    .replace(/Elynea\s*[—-]\s*Assistant IA/gi, `${ELYNEA_COMPANION.name} — ${ELYNEA_COMPANION.role}`);
}

function normalizeNode(root) {
  if (!root) return;
  const documentRef = root.ownerDocument || document;
  const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const next = replaceLegacyName(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
    node = walker.nextNode();
  }

  if (root.nodeType === Node.ELEMENT_NODE) {
    const elements = [root, ...root.querySelectorAll('*')];
    for (const element of elements) {
      for (const attribute of ['title', 'aria-label', 'alt', 'placeholder']) {
        if (!element.hasAttribute?.(attribute)) continue;
        const current = element.getAttribute(attribute);
        const next = replaceLegacyName(current);
        if (next !== current) element.setAttribute(attribute, next);
      }
      if (element.tagName === 'IMG' && /elynea/i.test(element.getAttribute('alt') || '')) {
        if (element.src !== OFFICIAL_ELYNEA_AVATAR) element.src = OFFICIAL_ELYNEA_AVATAR;
      }
    }
  }
}

/**
 * Pont de migration visuelle : les routes, clés de stockage et permissions
 * historiques peuvent encore utiliser l'identifiant technique "nova", mais
 * l'unique identité visible du produit reste Elynea 3D.
 */
export default function ElyneaBrandScope({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;
    normalizeNode(root);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const next = replaceLegacyName(mutation.target.nodeValue);
          if (next !== mutation.target.nodeValue) mutation.target.nodeValue = next;
        }
        for (const added of mutation.addedNodes || []) {
          if (added.nodeType === Node.TEXT_NODE) {
            const next = replaceLegacyName(added.nodeValue);
            if (next !== added.nodeValue) added.nodeValue = next;
          } else if (added.nodeType === Node.ELEMENT_NODE) {
            normalizeNode(added);
          }
        }
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: false });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-jsinnovia-companion={ELYNEA_COMPANION.key}
      data-companion-role={ELYNEA_COMPANION.role}
      style={{ display: 'contents' }}
    >
      {children}
    </div>
  );
}
