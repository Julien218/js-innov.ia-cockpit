// ============================================================
// src/lib/billing.js — Logique de calcul TVA / TTC
// Source unique pour tous les calculs de devis et factures
// Utilisé côté frontend (aperçu) ET côté serveur (server-billing.cjs)
// ============================================================

/**
 * Calcule le montant TTC à partir du HT et du taux de TVA.
 * @param {number} montantHT  - Montant hors taxe
 * @param {number} tvaPercent - Taux de TVA en % (défaut: 21)
 * @returns {number} - Montant TTC arrondi à 2 décimales
 */
export function calculateTTC(montantHT, tvaPercent = 21) {
  const ht = Number(montantHT) || 0;
  const tva = Number(tvaPercent) || 0;
  const ttc = ht + (ht * tva / 100);
  return Math.round(ttc * 100) / 100;
}

/**
 * Calcule le montant de la TVA.
 * @param {number} montantHT
 * @param {number} tvaPercent
 * @returns {number}
 */
export function calculateTVA(montantHT, tvaPercent = 21) {
  const ht = Number(montantHT) || 0;
  const tva = Number(tvaPercent) || 0;
  return Math.round((ht * tva / 100) * 100) / 100;
}

/**
 * Formate un nombre en devise belge (€).
 * @param {number} value
 * @returns {string} - ex: "1 212,50 €"
 */
export function formatCurrency(value) {
  if (value == null || isNaN(value)) return "0,00 €";
  return new Intl.NumberFormat("fr-BE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/**
 * Normalise les données d'un devis/facture avant envoi à l'API.
 * - Calcule/recalcule montant_ttc si montant_ht et tva sont présents
 * - Gère le fallback TVA 21 par défaut
 * - Gère les items multi-lignes si présents
 * - Nettoie les champs vides
 *
 * @param {object} data - Données brutes du formulaire
 * @returns {object} - Données normalisées prêtes pour l'API
 */
export function normalizeBillingPayload(data) {
  const payload = { ...data };

  // Si on a des items (multi-lignes), calculer les totaux
  if (Array.isArray(payload.items) && payload.items.length > 0) {
    let totalHT = 0;
    let totalTVA = 0;
    let totalTTC = 0;

    payload.items = payload.items.map(item => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.unit_price_ht) || 0;
      const lineTVA = Number(item.tva) || 21;
      const lineHT = Math.round(qty * unitPrice * 100) / 100;
      const lineTVAAmount = Math.round((lineHT * lineTVA / 100) * 100) / 100;
      const lineTTC = Math.round((lineHT + lineTVAAmount) * 100) / 100;

      totalHT += lineHT;
      totalTVA += lineTVAAmount;
      totalTTC += lineTTC;

      return {
        description: item.description || "",
        quantity: qty,
        unit_price_ht: unitPrice,
        tva: lineTVA,
        total_ht: lineHT,
        total_tva: lineTVAAmount,
        total_ttc: lineTTC,
      };
    });

    payload.montant_ht = Math.round(totalHT * 100) / 100;
    payload.tva = payload.items[0]?.tva || 21;
    payload.montant_tva = Math.round(totalTVA * 100) / 100;
    payload.montant_ttc = Math.round(totalTTC * 100) / 100;
  } else {
    // Mode simple : montant_ht + tva + montant_ttc
    const ht = Number(payload.montant_ht) || 0;
    const tva = payload.tva === "" || payload.tva == null ? 21 : Number(payload.tva);

    payload.montant_ht = ht;
    payload.tva = tva;
    payload.montant_tva = calculateTVA(ht, tva);
    payload.montant_ttc = calculateTTC(ht, tva);
  }

  return payload;
}

/**
 * Génère le prochain numéro de devis/facture.
 * @param {string} prefix - "DEV" ou "FAC"
 * @param {Array} existing - Liste des numéros existants
 * @returns {string} - ex: "DEV-2026-0005"
 */
export function generateDocumentNumber(prefix, existing = []) {
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);

  let max = 0;
  for (const item of existing) {
    const num = typeof item === "string" ? item : item?.numero;
    if (!num) continue;
    const match = num.match(pattern);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }

  const next = max + 1;
  return `${prefix}-${year}-${String(next).padStart(4, "0")}`;
}
