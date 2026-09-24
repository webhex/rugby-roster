'use client'
import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const [email,setEmail]=useState(''); const [sent,setSent]=useState(false); const [error,setError]=useState(''); const [loading,setLoading]=useState(false)
  async function submit(e:React.FormEvent){
    e.preventDefault();setLoading(true);setError('')
    // The link in the email goes to /auth/callback, which signs the person in
    // and then forwards them to the page where they choose a new password.
    const {error}=await createClient().auth.resetPasswordForEmail(email,{redirectTo:`${window.location.origin}/auth/callback?next=/auth/update-password`})
    if(!error)setSent(true)
    else if(error.code==='over_email_send_rate_limit')setError('Too many reset emails have been sent recently. Wait a few minutes and try again.')
    else setError('Something went wrong. Please try again.')
    setLoading(false)
  }
  // Supabase deliberately reports success for an address that has no account,
  // and this page repeats that, so it cannot be used to work out who is a
  // member of the club.
  if(sent)return <AuthCard title="Check your email" description="If that address has an account, a reset link is on its way.">
    <div className="space-y-5 text-sm text-[#668070]">
      <p>The link signs you in once and then asks for a new password. It expires after an hour, and stops working once it has been used.</p>
      <p>Nothing arrived? Check the spam folder, then <button className="font-semibold text-[#185c3a] hover:underline" onClick={()=>setSent(false)}>try a different address</button>.</p>
      <p className="text-center"><Link className="font-semibold text-[#185c3a] hover:underline" href="/auth/login">Back to sign in</Link></p>
    </div>
  </AuthCard>
  return <AuthCard title="Forgot your password?" description="We will email you a link to set a new one.">
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></div>
      {error&&<p className="text-sm text-red-700">{error}</p>}
      <Button disabled={loading} className="w-full bg-[#185c3a] hover:bg-[#12482d]">{loading?'Sending…':'Send reset link'}</Button>
      <p className="text-center text-sm text-[#668070]">Remembered it? <Link className="font-semibold text-[#185c3a] hover:underline" href="/auth/login">Back to sign in</Link></p>
    </form>
  </AuthCard>
}
function AuthCard({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <main className="flex min-h-svh items-center justify-center bg-[#f5f7f4] px-5 py-10"><Card className="w-full max-w-md border-[#dbe7df] shadow-sm"><CardHeader><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5c7d6a]">Rugby club bar</p><CardTitle className="text-2xl text-[#12372a]">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card> </main>}
