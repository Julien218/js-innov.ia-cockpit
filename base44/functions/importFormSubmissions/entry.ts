import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const apiKey = Deno.env.get("VILLECONNECT_API_KEY");
    if (!apiKey) {
      return Response.json({ error: 'API key non configurée' }, { status: 500 });
    }

    // Fetch from external app
    const externalRes = await fetch(
      "https://js-innovia-contact-lead-generati-6c255464.base44.app/api/entities/FormSubmission",
      { headers: { "api_key": apiKey } }
    );

    if (!externalRes.ok) {
      return Response.json({ error: `API externe erreur ${externalRes.status}` }, { status: 500 });
    }

    const { data: submissions } = await externalRes.json();

    // Get existing merchant names to avoid duplicates
    const existing = await base44.asServiceRole.entities.MerchantSubmission.list();
    const existingNames = new Set(existing.map(m => m.nom_commerce?.toLowerCase().trim()));

    let imported = 0;
    for (const sub of submissions) {
      const name = (sub.nom_commerce || "").toLowerCase().trim();
      if (!name || existingNames.has(name)) continue;

      await base44.asServiceRole.entities.MerchantSubmission.create({
        nom_commerce: sub.nom_commerce,
        type_commerce: sub.type_commerce || null,
        categorie_activite: sub.categorie_activite || null,
        description: sub.description || null,
        logo_photo_url: sub.logo_photo_url || null,
        ville: sub.ville || "Dour",
        adresse: sub.adresse || null,
        mini_video_url: sub.mini_video_url || null,
        site_web: sub.site_web || null,
        facebook: sub.facebook || null,
        instagram: sub.instagram || null,
        tiktok: sub.tiktok || null,
        linkedin: sub.linkedin || null,
        email_interne: sub.email_interne || null,
        client_pv_assurances: sub.client_pv_assurances || false,
        consentement_rgpd: sub.consentement_rgpd || false,
        statut: "nouveau",
        source_app: "formulaire_dour",
        posts_generes: 0,
        synced_to_railway: false,
      });
      imported++;
    }

    return Response.json({ imported, total: submissions.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});