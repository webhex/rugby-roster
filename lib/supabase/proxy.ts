import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => request.cookies.getAll(), setAll: (items) => { items.forEach(({ name, value }) => request.cookies.set(name, value)); response = NextResponse.next({ request }); items.forEach(({ name, value, options }) => response.cookies.set(name, value, options)) } },
  })
  const { data: { user } } = await supabase.auth.getUser()
  const path = request.nextUrl.pathname
  if (!user && path.startsWith('/app')) return NextResponse.redirect(new URL('/auth/login', request.url))
  // Two paths under /auth have to stay reachable while signed in. /auth/callback
  // is what creates the session in the first place, and password reset
  // deliberately lands an already-signed-in person on /auth/update-password to
  // choose a new password. Bouncing either to /app breaks the reset flow.
  const signedInMayVisit = path === '/auth/callback' || path === '/auth/update-password'
  if (user && path.startsWith('/auth') && !signedInMayVisit) return NextResponse.redirect(new URL('/app', request.url))
  return response
}
