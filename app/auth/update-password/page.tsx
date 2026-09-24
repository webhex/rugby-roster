'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function UpdatePasswordPage() {
  const [password,setPassword]=useState(''); const [confirm,setConfirm]=useState('')
  const [error,setError]=useState(''); const [loading,setLoading]=useState(false); const [checked,setChecked]=useState(false)
  const router=useRouter()
  // Reaching this page means the reset link has already been exchanged for a
  // session by /auth/callback. No session means the link was missing, expired
  // or already used, so there is nothing to change here.
  useEffect(()=>{createClient().auth.getUser().then(({data})=>{if(!data.user)router.replace('/auth/forgot-password');else setChecked(true)})},[router])
  async function submit(e:React.FormEvent){
    e.preventDefault()
    // Supabase rejects anything under six characters; saying so first avoids a
    // round trip to be told the same thing less clearly.
    if(password.length<6)return setError('Use at least 6 characters.')
    if(password!==confirm)return setError('The two passwords do not match.')
    setLoading(true);setError('')
    const {error}=await createClient().auth.updateUser({password})
    if(!error)router.push('/app')
    else if(error.code==='same_password')setError('That is already your password. Choose a different one.')
    else setError('Could not change your password. The link may have expired — request a new one.')
    setLoading(false)
  }
  if(!checked)return <AuthCard title="One moment" description="Checking your reset link."><p className="text-sm text-[#668070]">If this does not move on, the link has expired.</p></AuthCard>
  return <AuthCard title="Choose a new password" description="You are signed in from the email link. Set a password to finish.">
    <form onSubmit={submit} className="space-y-5">
      <div className="space-y-2"><Label htmlFor="password">New password</Label><Input id="password" type="password" required autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="confirm">Repeat it</Label><Input id="confirm" type="password" required autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} /></div>
      {error&&<p className="text-sm text-red-700">{error}</p>}
      <Button disabled={loading} className="w-full bg-[#185c3a] hover:bg-[#12482d]">{loading?'Saving…':'Save password'}</Button>
      <p className="text-center text-sm text-[#668070]">Changed your mind? <Link className="font-semibold text-[#185c3a] hover:underline" href="/app">Go to the roster</Link></p>
    </form>
  </AuthCard>
}
function AuthCard({title,description,children}:{title:string;description:string;children:React.ReactNode}){return <main className="flex min-h-svh items-center justify-center bg-[#f5f7f4] px-5 py-10"><Card className="w-full max-w-md border-[#dbe7df] shadow-sm"><CardHeader><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5c7d6a]">Rugby club bar</p><CardTitle className="text-2xl text-[#12372a]">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent>{children}</CardContent></Card> </main>}
