import { AlertTriangle, CheckCircle2, LockKeyhole, PlugZap, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';

const coverage = {
  meta: 'Facebook + Instagram',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
};

function connectedAccount(accounts, providerId) {
  return (accounts || []).find((account) => account.provider === providerId && account.connection_status === 'connected') || null;
}

export default function PublisyaConnections({ data, isLoading, isError, onConnect, onDisconnect, disconnectingId }) {
  const providers = data?.providers || [];
  const accounts = data?.accounts || [];

  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Connexions officielles</h3>
          <p className="mt-1 text-sm text-muted-foreground">Les autorisations passent par OAuth. Aucun mot de passe social n’est demandé ou stocké par Publisya.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <LockKeyhole className="h-4 w-4 text-primary" />
          Jetons chiffrés côté serveur
        </div>
      </div>

      {isError && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Les connexions OAuth ne peuvent pas être lues pour le moment. La publication reste verrouillée.
        </div>
      )}

      {!isLoading && data && (!data.database_ready || !data.vault_configured) && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {!data.database_ready ? 'La table OAuth Publisya doit encore être initialisée. ' : ''}
          {!data.vault_configured ? 'La clé PUBLISYA_TOKEN_ENCRYPTION_KEY doit encore être configurée côté serveur.' : ''}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {isLoading && Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-2xl bg-muted" />
        ))}

        {!isLoading && providers.map((provider) => {
          const account = connectedAccount(accounts, provider.id);
          const ready = Boolean(provider.ready && data?.database_ready && data?.vault_configured);
          return (
            <div key={provider.id} className="flex min-h-36 flex-col rounded-2xl border border-border bg-muted/25 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">{coverage[provider.id] || provider.label}</span>
                {account ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <PlugZap className="h-4 w-4 text-muted-foreground" />}
              </div>

              {account ? (
                <>
                  <p className="mt-2 truncate text-xs font-medium text-foreground">{account.account_name || 'Compte connecté'}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Connexion active · publication encore désactivée</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-auto"
                    disabled={disconnectingId === account.id}
                    onClick={() => onDisconnect(account.id)}
                  >
                    <Unplug className="mr-2 h-3.5 w-3.5" />
                    Retirer du Cockpit
                  </Button>
                </>
              ) : (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">{ready ? 'Prêt pour une autorisation officielle.' : 'Configuration développeur requise.'}</p>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-auto"
                    disabled={!ready}
                    onClick={() => onConnect(provider.id)}
                    title={ready ? `Connecter ${provider.label}` : 'Credentials, scopes, redirect URI et coffre requis'}
                  >
                    <PlugZap className="mr-2 h-3.5 w-3.5" />
                    {ready ? 'Connecter' : 'À configurer'}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
