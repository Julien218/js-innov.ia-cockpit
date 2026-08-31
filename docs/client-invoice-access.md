# Client recipient invoice access

`/mes-factures` is a read-only recipient view, not a client's accounting console.
Administrators keep their existing billing and AI Cost Control permissions.

The server-only `CLIENT_INVOICE_RECIPIENTS_JSON` variable maps an existing Cockpit
user UUID to an exact email and approved CRM `Client` UUIDs:

```json
{
  "11111111-1111-4111-8111-111111111111": {
    "email": "recipient@example.invalid",
    "recipients": {
      "22222222-2222-4222-8222-222222222222": "Recipient business name"
    }
  }
}
```

Deploy this mapping and server code before enabling that user's `invoices`
permission. Keep their original organisation, role, and other permissions.
Do not infer recipient relationships merely from similar names or an email domain.
This mapping does not merge businesses, invoices, or accounting records.

Mapped clients can read only invoices whose issuer organisation is `jsinnovia`,
whose `client_id` is explicitly mapped, and whose status is `envoyee`, `payee`,
`en_retard`, or `annulee`. Drafts and internal fields are excluded. Requests and
responses are both scoped; browser filters cannot add recipients. Direct IDs are
checked too, and writes remain denied. The UI displays stored details; it does
not generate PDFs, send emails, change payment status, or expose archive paths.

An unconfigured client keeps the existing tenant-scoped behavior. Malformed
configuration fails closed. An upstream list at the API's 1000-row cap fails
explicitly instead of silently presenting a partial list. No invoice is modified.

Verification:

```sh
node --test tests/client-invoice-recipient.test.cjs tests/hainoflow-tenant.test.cjs tests/client-billing-integrity.test.cjs
npm run build
```

Tests use synthetic records and an isolated local server, never a fabricated
production session. A successful build does not replace verification from the
recipient's actual signed-in session.
