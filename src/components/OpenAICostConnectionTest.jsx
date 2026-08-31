import React, { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

export default function OpenAICostConnectionTest() {
  const { user } = useAuth();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const allowed = user?.role === 'superadmin'
    || (user?.role === 'admin' && user?.permissions?.includes('ai_cost_control'));
  if (!allowed) return null;

  const testConnection = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch('/api/client-costs/accounting/openai/connection-test', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
      });
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        setResult({ ok: false, message: 'Session administrateur et permission AI Cost Control requises.' });
      } else if (typeof data.message === 'string' && data.read_only === true) {
        setResult(data);
      } else {
        setResult({ ok: false, message: 'Diagnostic indisponible. Réessayez après le déploiement du serveur.' });
      }
    } catch {
      setResult({ ok: false, message: 'Impossible de joindre le diagnostic. Réessayez dans quelques instants.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-label="Diagnostic OpenAI">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Connexion aux coûts OpenAI</h2>
          <p className="text-xs text-muted-foreground mt-1">Administration uniquement · Lecture seule · Aucun import ni modification de facture.</p>
        </div>
        <button type="button" onClick={testConnection} disabled={testing} aria-busy={testing}
          className="min-h-10 px-3 py-2 rounded-xl border border-border hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
          <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
          {testing ? 'Test en cours…' : 'Tester la connexion OpenAI'}
        </button>
      </div>
      {result && <div role="status" aria-live="polite" className={`rounded-xl px-3 py-2 text-sm ${result.ok ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-800'}`}>
        <p>{result.message}</p>
        {result.checked_at && <p className="text-xs mt-1">Vérifié le {new Date(result.checked_at).toLocaleString('fr-BE')}{result.provider_http_status ? ` · OpenAI HTTP ${result.provider_http_status}` : ''}</p>}
      </div>}
    </section>
  );
}
