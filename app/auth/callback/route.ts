import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  if (code) { const supabase = await createClient(); await supabase.auth.exchangeCodeForSession(code) }
  // Sign-up confirmation goes straight to the roster. Password reset passes
  // ?next=/auth/update-password so the new session lands on the page that asks
  // for a new password.
  //
  // Only ever forward somewhere on this site. A `next` of //example.com reads
  // as a protocol-relative URL and would send people off the site with a valid
  // session in hand, which is how an open redirect becomes a phishing link.
  const next = url.searchParams.get('next')
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app'
  return NextResponse.redirect(new URL(target, request.url))
}
