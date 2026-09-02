import React, { useEffect } from "react";

const UPDATED_AT = "2 septembre 2026";

const Section = ({ id, title, children }) => (
  <section id={id} className="scroll-mt-8 rounded-2xl border border-white/10 bg-white/[0.045] p-5 sm:p-7">
    <h2 className="mb-3 text-xl font-bold text-white">{title}</h2>
    <div className="space-y-3 text-sm leading-7 text-white/70">{children}</div>
  </section>
);

export default function PrivacyPolicy() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Politique de confidentialité — SIGNELYA";
    let description = document.querySelector('meta[name="description"]');
    const previousDescription = description?.getAttribute("content");
    if (!description) {
      description = document.createElement("meta");
      description.setAttribute("name", "description");
      document.head.appendChild(description);
    }
    description.setAttribute("content", "Politique de confidentialité de SIGNELYA, solution de gestion d'écrans et de notifications.");
    return () => {
      document.title = previousTitle;
      if (previousDescription) description.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#03050A] px-4 py-8 text-white sm:px-6 sm:py-12">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-32 top-16 h-80 w-80 rounded-full bg-[#00D9FF]/10 blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-96 w-96 rounded-full bg-[#F100FF]/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl">
        <header className="mb-8 rounded-3xl border border-cyan-300/15 bg-[#090D16]/90 p-6 shadow-2xl shadow-cyan-950/20 sm:p-9">
          <a href="/login" aria-label="Retour à SIGNELYA" className="block max-w-xl">
            <img src="/signelya-lockup-horizontal.svg" alt="SIGNELYA — Vos écrans prennent vie" className="h-auto w-full" />
          </a>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Protection des données</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Politique de confidentialité</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/60">
            Cette politique explique comment SIGNELYA traite les données personnelles liées à son cockpit,
            ses écrans connectés, sa vidéosurveillance et ses notifications.
          </p>
          <p className="mt-4 text-xs text-white/40">Dernière mise à jour : {UPDATED_AT}</p>
        </header>

        <div className="space-y-5">
          <Section id="responsable" title="1. Responsable du traitement">
            <p>
              SIGNELYA est une solution exploitée par <strong className="text-white">JS‑Innov.IA</strong>.
            </p>
            <p>
              Adresse : 52, Rue Grande, 7370 Dour, Belgique<br />
              Contact vie privée : <a className="text-cyan-300 underline underline-offset-4" href="mailto:info@jsinnovia.store">info@jsinnovia.store</a>
            </p>
          </Section>

          <Section id="donnees" title="2. Données traitées">
            <ul className="list-disc space-y-2 pl-5">
              <li>données de compte : nom, adresse e-mail, rôle, organisation et droits d’accès ;</li>
              <li>données de contact nécessaires aux alertes : numéro de téléphone, adresse e-mail et préférences de notification ;</li>
              <li>données techniques : identifiant du Player, état en ligne ou hors ligne, heartbeat, version, journaux d’erreur et adresse IP de sécurité ;</li>
              <li>données de contenus : noms, métadonnées, planning, statut de publication et accusés de réception des vidéos ;</li>
              <li>données de vidéosurveillance uniquement lorsque ce module est activé pour le client concerné ;</li>
              <li>traces de sécurité, consentements et historique de livraison des notifications.</li>
            </ul>
          </Section>

          <Section id="finalites" title="3. Finalités et bases juridiques">
            <ul className="list-disc space-y-2 pl-5">
              <li>fournir, sécuriser et maintenir le service SIGNELYA : exécution du contrat et intérêt légitime ;</li>
              <li>diffuser et planifier les contenus sur les écrans : exécution du contrat ;</li>
              <li>détecter une panne confirmée et informer les personnes concernées : exécution du contrat et intérêt légitime ;</li>
              <li>envoyer des notifications mobiles : consentement, révocable à tout moment dans les réglages du téléphone ou du navigateur ;</li>
              <li>respecter les obligations comptables, légales et de sécurité : obligation légale et intérêt légitime.</li>
            </ul>
          </Section>

          <Section id="notifications" title="4. WhatsApp, e-mail et notifications mobiles">
            <p>
              Les messages WhatsApp ne sont envoyés qu’aux destinataires configurés pour un événement prévu.
              Une alerte de panne est déclenchée uniquement après confirmation que l’écran est réellement hors ligne.
              Les commerciaux reçoivent uniquement les notifications relatives aux vidéos de leurs propres clients.
            </p>
            <p>
              L’utilisation de WhatsApp implique la transmission à Meta du numéro du destinataire, du modèle de message
              et des informations techniques nécessaires à sa livraison. Les notifications opérationnelles ne sont pas
              utilisées pour vendre des listes de contacts.
            </p>
          </Section>

          <Section id="destinataires" title="5. Destinataires et prestataires">
            <p>
              Les données sont accessibles aux utilisateurs autorisés selon leur rôle : client, commercial,
              administrateur ou super administrateur. Elles peuvent être traitées par les prestataires nécessaires au service,
              notamment Railway pour l’hébergement, Supabase pour les données applicatives, Dropbox pour les médias et
              Meta Platforms Ireland pour WhatsApp Business.
            </p>
            <p>
              Chaque prestataire agit selon ses propres engagements contractuels et mesures de sécurité. Les données ne sont
              ni vendues ni louées. Lorsqu’un transfert hors de l’Espace économique européen est nécessaire, il repose sur un
              mécanisme de protection reconnu par le RGPD.
            </p>
          </Section>

          <Section id="conservation" title="6. Durées de conservation">
            <ul className="list-disc space-y-2 pl-5">
              <li>compte et droits d’accès : pendant la relation contractuelle, puis jusqu’à 3 ans si nécessaire ;</li>
              <li>journaux techniques et événements de notification : au maximum 12 mois, sauf incident de sécurité ;</li>
              <li>abonnement de notification mobile : jusqu’au retrait du consentement ou à l’invalidation de l’abonnement ;</li>
              <li>médias et plannings : jusqu’à leur suppression par une personne autorisée ou la fin du service ;</li>
              <li>données soumises à une obligation légale : pendant la durée imposée par la législation applicable.</li>
            </ul>
          </Section>

          <Section id="securite" title="7. Sécurité">
            <p>
              SIGNELYA applique des contrôles d’accès par rôle, des sessions sécurisées, le chiffrement HTTPS, une
              vérification des webhooks, une journalisation des actions sensibles et une limitation des accès techniques.
              Aucun système ne pouvant garantir un risque nul, les mesures sont réévaluées régulièrement.
            </p>
          </Section>

          <Section id="cookies" title="8. Cookies et stockage local">
            <p>
              L’application utilise les éléments strictement nécessaires à l’authentification, à la sécurité, aux préférences
              d’interface et aux notifications. Elle n’installe pas de cookies publicitaires SIGNELYA sans consentement préalable.
            </p>
          </Section>

          <Section id="droits" title="9. Vos droits">
            <p>
              Vous pouvez demander l’accès, la rectification, l’effacement, la limitation ou la portabilité de vos données,
              ainsi que vous opposer à certains traitements et retirer votre consentement.
            </p>
            <p>
              Envoyez votre demande à <a className="text-cyan-300 underline underline-offset-4" href="mailto:info@jsinnovia.store?subject=Demande%20RGPD%20SIGNELYA">info@jsinnovia.store</a>.
              Une preuve d’identité peut être demandée uniquement si elle est nécessaire pour éviter une divulgation à un tiers.
              Vous pouvez également saisir l’Autorité de protection des données belge.
            </p>
          </Section>

          <Section id="suppression" title="10. Suppression des données et du compte">
            <p>
              Pour demander la suppression de votre compte et des données associées, écrivez à
              {" "}<a className="text-cyan-300 underline underline-offset-4" href="mailto:info@jsinnovia.store?subject=Suppression%20de%20mes%20donn%C3%A9es%20SIGNELYA">info@jsinnovia.store</a>
              {" "}avec l’objet « Suppression de mes données SIGNELYA ». La demande sera vérifiée, puis exécutée dans les
              délais du RGPD, sous réserve des données devant être conservées légalement.
            </p>
          </Section>

          <Section id="modifications" title="11. Modifications">
            <p>
              Cette politique peut évoluer lorsque les fonctions, prestataires ou obligations légales changent.
              La date de mise à jour affichée en haut de page permet d’identifier la version en vigueur.
            </p>
          </Section>
        </div>

        <footer className="py-8 text-center text-xs text-white/35">
          <a href="/login" className="text-cyan-300/80 hover:text-cyan-200">Retour à SIGNELYA</a>
          <span className="mx-2">•</span>
          <a href="mailto:info@jsinnovia.store" className="hover:text-white">info@jsinnovia.store</a>
        </footer>
      </div>
    </main>
  );
}
