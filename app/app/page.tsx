'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, Check, Clock3, LogOut, Pencil, Plus, ShieldCheck, Trash2, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

type EventRow = { id:string; description:string; date:string; start_time:string; end_time:string; created_by:string }
type ShiftRow = { id:string; event_id:string; start_time:string; end_time:string; remarks:string|null }
type Volunteer = { id:string; name:string; phone:string|null; remarks:string|null; is_admin:boolean; auth_user_id:string; email?:string }
type Assignment = { id:string; shift_id:string; volunteer_id:string; volunteer_name:string; phone?:string|null; email?:string }
const timeOnly=(v:string)=>new Date(v).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})
const dateOnly=(v:string)=>new Date(`${v}T00:00:00`).toLocaleDateString([], {weekday:'long',day:'numeric',month:'long'})

export default function Home(){
 const supabase=useMemo(()=>createClient(),[]), router=useRouter()
 const [name,setName]=useState('Volunteer'),[volunteerId,setVolunteerId]=useState(''),[isAdmin,setIsAdmin]=useState(false)
 const [events,setEvents]=useState<EventRow[]>([]),[shifts,setShifts]=useState<ShiftRow[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]),[volunteers,setVolunteers]=useState<Volunteer[]>([])
 const [inviteCode,setInviteCode]=useState(''),[showAdmin,setShowAdmin]=useState(false),[showPast,setShowPast]=useState(false),[showEventForm,setShowEventForm]=useState(false)
 const [eventForm,setEventForm]=useState({description:'',date:'',start:'',end:''}),[shiftForm,setShiftForm]=useState<Record<string,{start:string;remarks:string}>>({}),[message,setMessage]=useState('')
 const [csvRows,setCsvRows]=useState<Array<{description:string;date:string;start_time:string;end_time:string;problems:string[]}>>([]),[csvMessage,setCsvMessage]=useState('')
 const [pickList,setPickList]=useState<Array<{id:string;name:string}>>([])
 const [editingId,setEditingId]=useState(''),[editForm,setEditForm]=useState({description:'',date:'',start:'',end:'',owner:''})
 // One dialog serves every shift. `picker` says which shift is open, `picked`
 // holds the selection while it is being edited, so nothing is written until
 // Save and Cancel really does nothing.
 const [picker,setPicker]=useState<{shiftId:string;label:string}|null>(null),[picked,setPicked]=useState<string[]>([]),[saving,setSaving]=useState(false)
 async function load(){
  const {data:auth}=await supabase.auth.getUser(); if(!auth.user)return router.push('/auth/login')
  const {data:me}=await supabase.from('volunteers').select('id,name,is_admin').eq('auth_user_id',auth.user.id).single()
  // Read the role from the row just fetched, not from state. `isAdmin` does not
  // update until after this function returns, so anything conditional on state
  // here would always take the first-load value.
  const admin=me?.is_admin??false, myId=me?.id??''
  if(me){setName(me.name);setVolunteerId(myId);setIsAdmin(admin)}
  const today=new Date().toISOString().slice(0,10); let eventQuery=supabase.from('events').select('id,description,date,start_time,end_time,created_by').order('date').order('start_time'); if(!showPast)eventQuery=eventQuery.gte('date',today)
  const [{data:e},{data:s},{data:a}]=await Promise.all([eventQuery,supabase.from('shifts').select('id,event_id,start_time,end_time,remarks').order('start_time'),supabase.rpc('roster_assignments')])
  const evs=e??[]
  setEvents(evs);setShifts(s??[]);setAssignments(((a as any[])??[]).map((x:any)=>({id:x.id,shift_id:x.shift_id,volunteer_id:x.volunteer_id,volunteer_name:x.volunteer_name,phone:x.phone,email:x.email})))
  // assignable_volunteers returns the same names whichever event it is asked
  // about; the event id only decides whether the caller gets an answer at all.
  // So ask once, naming any event this person manages.
  const mine=evs.find(x=>admin||x.created_by===myId)
  if(mine){const {data:p}=await supabase.rpc('assignable_volunteers',{target_event_id:mine.id});setPickList(p??[])}else setPickList([])
  if(admin){const {data:v}=await supabase.rpc('admin_volunteers');setVolunteers(v??[]);const {data:c}=await supabase.from('club_settings').select('invite_code').limit(1).single();setInviteCode(c?.invite_code??'')}
 }
 useEffect(()=>{load()},[showPast])
 async function toggleSignup(shiftId:string){const own=assignments.find(a=>a.shift_id===shiftId&&a.volunteer_id===volunteerId);if(own)await supabase.from('assignments').delete().eq('id',own.id);else await supabase.from('assignments').insert({shift_id:shiftId,volunteer_id:volunteerId});await load()}
 function openPicker(shift:ShiftRow){setMessage('');setPicker({shiftId:shift.id,label:`${timeOnly(shift.start_time)} – ${timeOnly(shift.end_time)}`});setPicked(assignments.filter(a=>a.shift_id===shift.id).map(a=>a.volunteer_id))}
 function togglePicked(id:string){setPicked(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id])}
 async function savePicker(){
  if(!picker)return
  const before=assignments.filter(a=>a.shift_id===picker.shiftId)
  const toAdd=picked.filter(id=>!before.some(a=>a.volunteer_id===id))
  const toRemove=before.filter(a=>!picked.includes(a.volunteer_id))
  if(!toAdd.length&&!toRemove.length)return setPicker(null)
  setSaving(true)
  // Removals first. If both halves are large, a moment where the shift holds
  // fewer people is less confusing than one where it holds too many.
  const removed=toRemove.length?await supabase.from('assignments').delete().in('id',toRemove.map(a=>a.id)):{error:null}
  const added=toAdd.length?await supabase.from('assignments').insert(toAdd.map(id=>({shift_id:picker.shiftId,volunteer_id:id}))):{error:null}
  setSaving(false);setPicker(null)
  // Either half can be refused on its own, so rather than claim what was saved,
  // reload and let the shift list show what actually happened.
  if(removed.error||added.error)setMessage('Not all of those changes were saved. The shift now shows who is really on it.')
  await load()
 }
 async function createEvent(e:React.FormEvent){e.preventDefault();const {error}=await supabase.from('events').insert({description:eventForm.description,date:eventForm.date,start_time:`${eventForm.date}T${eventForm.start}:00`,end_time:`${eventForm.date}T${eventForm.end}:00`,created_by:volunteerId});if(error)return setMessage('Could not create that event.');setShowEventForm(false);setEventForm({description:'',date:'',start:'',end:''});await load()}
 async function addShift(event:EventRow){const f=shiftForm[event.id];if(!f?.start)return;const start=`${event.date}T${f.start}:00`;const {error}=await supabase.rpc('add_shift_with_split',{target_event_id:event.id,new_start:start,new_remarks:f.remarks||null});if(error)return setMessage('Could not add that shift.');setShiftForm({...shiftForm,[event.id]:{start:'',remarks:''}});await load()}
 async function updateShift(id:string,field:'end_time'|'remarks',value:string){await supabase.from('shifts').update({[field]:field==='end_time'?value:value||null}).eq('id',id);await load()}
 // An admin, or the volunteer who owns this event. Ownership is per event and
 // grants nothing on anybody else's.
 function canManage(event:EventRow){return isAdmin||event.created_by===volunteerId}
 function openEdit(event:EventRow){setMessage('');setEditingId(event.id);setEditForm({description:event.description,date:event.date,start:event.start_time.slice(11,16),end:event.end_time.slice(11,16),owner:event.created_by})}
 async function saveEdit(e:React.FormEvent,event:EventRow){
  e.preventDefault()
  if(editForm.end<=editForm.start)return setMessage('The end time must be after the start time.')
  // Only ask about a handover when the owner has actually changed. Confirming
  // before the save means declining abandons the other edits too, rather than
  // saving them and leaving the owner behind.
  if(editForm.owner!==event.created_by){const to=pickList.find(v=>v.id===editForm.owner)?.name??'that volunteer';if(!confirm(`Hand “${event.description}” to ${to}? They will be able to edit and delete this event, and you will not. Only ${to} or an admin can change it back.`))return}
  const {error}=await supabase.from('events').update({description:editForm.description,date:editForm.date,start_time:`${editForm.date}T${editForm.start}:00`,end_time:`${editForm.date}T${editForm.end}:00`,created_by:editForm.owner}).eq('id',event.id)
  if(error)return setMessage('Could not save that event.')
  setEditingId('');await load()
 }
 async function deleteShift(event:EventRow,shift:ShiftRow){
  const people=assignments.filter(a=>a.shift_id===shift.id).length
  // Mirrors delete_shift() in the database: the latest shift starting strictly
  // before this one takes the freed time, and only if that extends it.
  const prev=shifts.filter(s=>s.event_id===event.id&&s.id!==shift.id&&s.start_time<shift.start_time).sort((a,b)=>a.start_time<b.start_time?1:-1)[0]
  const absorbs=prev&&prev.end_time<shift.end_time?` The ${timeOnly(prev.start_time)}–${timeOnly(prev.end_time)} shift will be extended to ${timeOnly(shift.end_time)}.`:''
  const losing=people?` ${people} volunteer${people===1?'':'s'} signed up and will lose their place.`:''
  if(!confirm(`Delete the ${timeOnly(shift.start_time)}–${timeOnly(shift.end_time)} shift?${losing}${absorbs}`))return
  const {error}=await supabase.rpc('delete_shift',{target_shift_id:shift.id})
  if(error)return setMessage('Could not delete that shift.')
  await load()
 }
 // Serves both cases: an admin deleting somebody, and anyone deleting
 // themselves. The database decides which is allowed; this only asks first.
 async function deleteAccount(who:{id:string;name:string}){
  const mine=who.id===volunteerId
  // The trigger would refuse anyway, but asking first turns a refusal into an
  // instruction given before anything is attempted.
  const {data:owned}=await supabase.rpc('owned_event_count',{target_id:who.id})
  if(owned)return setMessage(mine?`You own ${owned} event${owned===1?'':'s'}. Hand ${owned===1?'it':'them'} to another volunteer before deleting your account.`:`${who.name} owns ${owned} event${owned===1?'':'s'}. Hand ${owned===1?'it':'them'} to another volunteer first.`)
  if(!confirm(mine?'Delete your own account? You will be removed from every shift you signed up for, and this cannot be undone.':`Delete ${who.name}? They will be removed from every shift they signed up for, and this cannot be undone.`))return
  const {error}=await supabase.rpc('delete_account',{target_id:who.id})
  // The messages this raises are written to be read, so they are shown as they
  // come back rather than replaced with something vaguer.
  if(error)return setMessage(error.message||'Could not delete that account.')
  if(mine){await supabase.auth.signOut();router.push('/auth/login');router.refresh();return}
  await load()
 }
 async function removePerson(a:Assignment){if(!confirm(`Remove ${a.volunteer_name} from this shift?`))return;const {error}=await supabase.from('assignments').delete().eq('id',a.id);if(error)return setMessage('Could not remove that volunteer.');await load()}
 async function deleteEvent(event:EventRow){const ss=shifts.filter(s=>s.event_id===event.id);const {count}=await supabase.from('assignments').select('id',{count:'exact',head:true}).in('shift_id',ss.map(s=>s.id));if(!confirm(`Delete “${event.description}”? This will remove ${count??0} volunteer sign-ups and all shifts.`))return;await supabase.from('events').delete().eq('id',event.id);await load()}
 async function toggleAdmin(v:Volunteer){if(v.id===volunteerId)return;const adminCount=volunteers.filter(x=>x.is_admin).length;if(v.is_admin&&adminCount<=1)return setMessage('At least one admin must remain.');const {error}=await supabase.rpc('set_admin_status',{target_id:v.id,next_status:!v.is_admin});if(error)setMessage(error.message.includes('at least one')?'At least one admin must remain.':'Could not change admin status.');await load()}
 async function regenerateInvite(){const code=Math.random().toString(36).slice(2,10).toUpperCase();if(!confirm('Generate a new invite code? The current code will stop working.'))return;await supabase.from('club_settings').update({invite_code:code}).eq('invite_code',inviteCode);setInviteCode(code)}
 function parseCsv(text:string){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);if(!lines.length)return setCsvMessage('The CSV file is empty.');const h=lines[0].split(',').map(x=>x.trim().toLowerCase());const rows=lines.slice(1).map(line=>{const v=line.split(',');const r=Object.fromEntries(h.map((x,i)=>[x,(v[i]??'').trim()]));const p:string[]=[];if(!r.description)p.push('Missing description');if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||Number.isNaN(Date.parse(`${r.date}T00:00:00`)))p.push('Date cannot be parsed');if(r.end_time<=r.start_time)p.push('End time must be after start time');return {...r,problems:p}});setCsvRows(rows as any);setCsvMessage(rows.length?'Review the rows before importing.':'The CSV file has no data rows.')}
 async function importCsv(){const valid=csvRows.filter(x=>!x.problems.length);const {error}=await supabase.rpc('import_events',{rows:valid});if(error)return setCsvMessage('Only admins can import events.');setCsvMessage(`Imported ${valid.length} events; skipped ${csvRows.length-valid.length} rows.`);setCsvRows([]);await load()}
 function downloadExampleCsv(){const blob=new Blob(['description,date,start_time,end_time\nHome match,2026-10-04,12:00,18:00\nCup final,2026-10-11,13:00,19:00'],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='roster-example.csv';link.click();URL.revokeObjectURL(url)}
 async function signOut(){await supabase.auth.signOut();router.push('/auth/login');router.refresh()}
 return <main className="min-h-svh bg-[#f5f7f4] text-[#12372a]"><header className="border-b bg-white"><div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#5c7d6a]">Rugby club bar</p><h1 className="text-xl font-bold">Volunteer roster</h1></div><div className="flex items-center gap-3"><span className="hidden text-sm font-medium sm:block">{name}</span><Button variant="outline" size="sm" onClick={signOut}><LogOut className="mr-2 size-4"/>Sign out</Button></div></div></header><section className="mx-auto max-w-3xl px-5 py-8"><div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[#668070]">Upcoming fixtures and bar cover</p><h2 className="mt-1 text-2xl font-bold">Events</h2></div><div className="flex flex-wrap gap-2">{isAdmin&&<Button variant="outline" onClick={()=>setShowAdmin(!showAdmin)}><ShieldCheck className="mr-2 size-4"/>{showAdmin?'Hide admin':'Admin'}</Button>} {isAdmin&&<Button variant="outline" onClick={()=>setShowPast(!showPast)}>{showPast?'Hide past':'Show past'}</Button>}<Button onClick={()=>setShowEventForm(!showEventForm)} className="bg-[#21613f] hover:bg-[#174a2f]"><Plus className="mr-2 size-4"/>Add event</Button></div></div>{showAdmin&&isAdmin&&<div className="mb-6 space-y-5 rounded-2xl border bg-white p-5"><div><h3 className="font-semibold">Invite code</h3><div className="mt-2 flex gap-2"><Input readOnly value={inviteCode}/><Button onClick={regenerateInvite}>Generate new</Button></div></div><div className="border-t pt-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Import events</h3><p className="text-sm text-muted-foreground">Upload description, date, start_time, end_time.</p></div><Button type="button" variant="outline" onClick={downloadExampleCsv}>Download example CSV</Button></div><label className="mt-3 block cursor-pointer rounded-lg border-2 border-dashed border-[#b8cdbf] p-4 text-center text-sm font-medium hover:bg-[#f5f7f4]">Choose CSV file<input className="sr-only" type="file" accept=".csv,text/csv" onChange={event=>{const file=event.target.files?.[0];if(!file)return;if(!file.name.toLowerCase().endsWith('.csv')){setCsvMessage('Please choose a CSV file.');return}file.text().then(parseCsv)}} /></label>{csvMessage&&<p className="mt-2 text-sm text-[#21613f]">{csvMessage}</p>}{csvRows.length>0&&<div className="mt-4 overflow-x-auto rounded-lg border"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-[#f5f7f4]"><tr><th className="p-2">Description</th><th className="p-2">Date</th><th className="p-2">Start</th><th className="p-2">End</th><th className="p-2">Result</th></tr></thead><tbody>{csvRows.map((row,index)=><tr key={index} className={row.problems.length?'border-t bg-red-50 text-red-900':'border-t'}><td className="p-2">{row.description||'—'}</td><td className="p-2">{row.date||'—'}</td><td className="p-2">{row.start_time||'—'}</td><td className="p-2">{row.end_time||'—'}</td><td className="p-2">{row.problems.length?`Skipped: ${row.problems.join(', ')}`:'Ready to import'}</td></tr>)}</tbody></table></div>}<Button className="mt-4 bg-[#21613f] hover:bg-[#174a2f]" disabled={!csvRows.some(row=>row.problems.length===0)} onClick={importCsv}>Import valid rows</Button></div><div><h3 className="font-semibold">Volunteers</h3><div className="mt-2 divide-y">{volunteers.map(v=><div key={v.id} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_1fr_auto]"><div><strong>{v.name}</strong><p>{v.email??'Email available in auth'}</p></div><div><p>{v.phone||'No phone'}</p><p className="text-muted-foreground">{v.remarks||'No remarks'}</p></div><div className="flex items-center gap-2"><Button disabled={v.id===volunteerId||(v.is_admin&&volunteers.filter(x=>x.is_admin).length<=1)} variant="outline" onClick={()=>toggleAdmin(v)}>{v.is_admin?'Admin':'Volunteer'}</Button><Button variant="ghost" className="text-red-700" onClick={()=>deleteAccount(v)}>Delete</Button></div></div>)}</div></div></div>}{showEventForm&&<form onSubmit={createEvent} className="mb-6 grid gap-3 rounded-2xl border bg-white p-5"><Input required placeholder="Event description" value={eventForm.description} onChange={e=>setEventForm({...eventForm,description:e.target.value})}/><div className="grid grid-cols-3 gap-2"><Input required type="date" value={eventForm.date} onChange={e=>setEventForm({...eventForm,date:e.target.value})}/><Input required type="time" value={eventForm.start} onChange={e=>setEventForm({...eventForm,start:e.target.value})}/><Input required type="time" value={eventForm.end} onChange={e=>setEventForm({...eventForm,end:e.target.value})}/></div><Button type="submit" className="bg-[#21613f]">Create event</Button></form>}{message&&<p className="mb-4 text-sm text-red-700">{message}</p>}{events.length===0?<div className="rounded-2xl border border-dashed bg-white px-5 py-14 text-center"><CalendarDays className="mx-auto mb-3 size-8 text-[#7d9b89]"/><p className="font-medium">No upcoming events yet</p></div>:<div className="space-y-5">{events.map(event=><article key={event.id} className="rounded-2xl border bg-white p-5"><div className="flex justify-between"><div><p className="text-sm font-semibold text-[#668070]">{dateOnly(event.date)}</p><h3 className="mt-1 text-lg font-bold">{event.description}</h3><p className="text-sm"><Clock3 className="mr-1 inline size-4"/>{timeOnly(event.start_time)} – {timeOnly(event.end_time)}</p></div>{canManage(event)&&<div><Button variant="ghost" size="icon" onClick={()=>openEdit(event)}><Pencil className="size-4"/></Button><Button variant="ghost" size="icon" onClick={()=>deleteEvent(event)}><Trash2 className="size-4 text-red-700"/></Button></div>}</div>{editingId===event.id&&<form onSubmit={e=>saveEdit(e,event)} className="mt-4 grid gap-3 rounded-xl border bg-[#f5f7f4] p-4"><Input required placeholder="Event description" value={editForm.description} onChange={e=>setEditForm({...editForm,description:e.target.value})}/><div className="grid grid-cols-3 gap-2"><Input required type="date" value={editForm.date} onChange={e=>setEditForm({...editForm,date:e.target.value})}/><Input required type="time" value={editForm.start} onChange={e=>setEditForm({...editForm,start:e.target.value})}/><Input required type="time" value={editForm.end} onChange={e=>setEditForm({...editForm,end:e.target.value})}/></div>{pickList.length>0&&<label className="text-sm font-medium">Owner<select className="mt-1 block w-full rounded-md border px-3 py-2" value={editForm.owner} onChange={e=>setEditForm({...editForm,owner:e.target.value})}>{pickList.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}</select></label>}<div className="flex gap-2"><Button type="submit" className="bg-[#21613f] hover:bg-[#174a2f]">Save changes</Button><Button type="button" variant="outline" onClick={()=>setEditingId('')}>Cancel</Button></div></form>}<div className="mt-4 space-y-3">{shifts.filter(s=>s.event_id===event.id).map(shift=>{const people=assignments.filter(a=>a.shift_id===shift.id);const own=people.some(a=>a.volunteer_id===volunteerId);return <div key={shift.id} className="rounded-xl border border-[#dbe7df] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{timeOnly(shift.start_time)} – {canManage(event)?<Input className="inline-block h-8 w-28" type="time" value={shift.end_time.slice(11,16)} onChange={e=>updateShift(shift.id,'end_time',`${event.date}T${e.target.value}:00`)}/>:timeOnly(shift.end_time)}</p>{shift.remarks&&<p className="text-sm text-[#668070]">{shift.remarks}</p>}</div><div className="flex flex-wrap items-center gap-2"><Button className="min-h-12 min-w-36" variant={own?'secondary':'default'} onClick={()=>toggleSignup(shift.id)}>{own?"You're on this shift":'Sign me up'}</Button>{canManage(event)&&<Button variant="outline" className="min-h-12" onClick={()=>openPicker(shift)}><Users className="mr-2 size-4"/>Manage volunteers{people.length?` (${people.length})`:''}</Button>}{canManage(event)&&<Button variant="ghost" size="icon" title="Delete shift" onClick={()=>deleteShift(event,shift)}><Trash2 className="size-4 text-red-700"/></Button>}</div></div><div className="mt-3 text-sm">{people.length===0?<span className="text-[#668070]">No volunteers yet</span>:people.map(p=><div key={p.id} className="flex flex-wrap items-center gap-2 py-1"><span>{p.volunteer_name}</span>{(p.email||p.phone)&&<span className="text-[#668070]">{p.email??''}{p.phone?` · ${p.phone}`:''}</span>}{canManage(event)&&<Button variant="ghost" size="sm" className="h-7 px-2 text-red-700" onClick={()=>removePerson(p)}>Remove</Button>}</div>)}</div></div>})}</div>{canManage(event)&&<div className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_1fr_auto]"><Input type="time" value={shiftForm[event.id]?.start??''} onChange={e=>setShiftForm({...shiftForm,[event.id]:{start:e.target.value,remarks:shiftForm[event.id]?.remarks??''}})}/><Input placeholder="Shift remarks" value={shiftForm[event.id]?.remarks??''} onChange={e=>setShiftForm({...shiftForm,[event.id]:{start:shiftForm[event.id]?.start??'',remarks:e.target.value}})}/><Button variant="outline" onClick={()=>addShift(event)}>Add shift</Button></div>}</article>)}</div>}<div className="mt-10 rounded-2xl border border-[#dbe7df] bg-white p-5"><h3 className="font-semibold">Your account</h3><p className="mt-1 text-sm text-[#668070]">Leaving the club? Deleting your account removes you from every shift you signed up for. If you own any events, hand them to another volunteer first. This cannot be undone.</p><Button variant="outline" className="mt-3 border-red-200 text-red-700 hover:bg-red-50" onClick={()=>deleteAccount({id:volunteerId,name})}>Delete my account</Button></div><Dialog open={!!picker} onOpenChange={o=>!o&&setPicker(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Who is on this shift?</DialogTitle><DialogDescription>{picker?.label}{' · tick everyone who is covering it'}</DialogDescription></DialogHeader><Command filter={(value,search)=>{const n=pickList.find(v=>v.id.toLowerCase()===value)?.name??'';return n.toLowerCase().includes(search.trim().toLowerCase())?1:0}} className="rounded-lg border border-[#dbe7df]"><CommandInput placeholder="Search by name…"/><CommandList className="max-h-72"><CommandEmpty>Nobody by that name.</CommandEmpty>{pickList.map(v=><CommandItem key={v.id} value={v.id} onSelect={()=>togglePicked(v.id)} className="cursor-pointer"><Check className={`mr-2 size-4 ${picked.includes(v.id)?'opacity-100':'opacity-0'}`}/>{v.name}</CommandItem>)}</CommandList></Command><DialogFooter className="items-center gap-2 sm:justify-between"><span className="text-sm text-[#668070]">{picked.length} on this shift</span><div className="flex gap-2"><Button variant="outline" onClick={()=>setPicker(null)}>Cancel</Button><Button disabled={saving} className="bg-[#21613f] hover:bg-[#174a2f]" onClick={savePicker}>{saving?'Saving…':'Save'}</Button></div></DialogFooter></DialogContent></Dialog></section></main>
}
