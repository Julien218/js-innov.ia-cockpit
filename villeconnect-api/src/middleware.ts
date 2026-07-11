import { NextRequest, NextResponse } from 'next/server';
const PUBLIC = ['/api/n8n/webhook'];
const COCKPIT = process.env.COCKPIT_URL ?? 'https://cockpit.jsinnovia.com';
const MOBILE  = (process.env.ALLOWED_MOBILE_ORIGINS ?? '').split(',').map(s=>s.trim()).filter(Boolean);
const ALLOWED = [COCKPIT, ...MOBILE];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin') ?? '';
  if (req.method === 'OPTIONS') {
    const h = new Headers({ 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-N8N-Signature,X-N8N-Timestamp,Idempotency-Key' });
    if (ALLOWED.includes(origin)) h.set('Access-Control-Allow-Origin', origin);
    return new NextResponse(null, { status: 204, headers: h });
  }
  if (PUBLIC.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (origin && !ALLOWED.includes(origin)) return NextResponse.json({ success: false, error: 'forbidden', message: 'Origin non autorisée' }, { status: 403 });
  const res = NextResponse.next();
  if (ALLOWED.includes(origin)) res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  return res;
}
export const config = { matcher: ['/api/:path*'] };
