import { useEffect, useRef } from 'react';

export const OFFICIAL_ELYNEA_AVATAR = 'https://www.jsinnovia.com/brand/companion/companion-avatar-256.webp';

function replaceLegacyName(value) {
  return typeof value === 'string' ? value.replace(/\bNOVA\b/g, 'Elynea').replace(/\bNova\b/g, 'Elynea') : value;
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
 * Pont de migration visuelle : les routes/permissions historiques peuvent encore
 * utiliser l'identifiant technique "nova", mais le produit visible s'appelle Elynea.
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

  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}
