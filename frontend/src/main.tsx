import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8080';
type ClassItem = { id:string; name:string; totalSeats:number; heldSeats:number; confirmedSeats:number; availableSeats:number };
type Hold = { holdId:string; classId:string; className?:string; status:string; expiresAt:string };

async function api<T>(path:string, options:RequestInit = {}, studentId?:string):Promise<T> {
  const headers = new Headers(options.headers); headers.set('Content-Type','application/json');
  if (studentId) headers.set('X-Student-Id', studentId);
  const response = await fetch(`${API}${path}`, {...options, headers});
  if (!response.ok) { let message = `Request failed (${response.status}).`; try { message = (await response.json()).message || message; } catch {} throw new Error(message); }
  return response.status === 204 ? undefined as T : response.json();
}

function App() {
  const [studentId, setStudentId] = useState(() => localStorage.getItem('studentId') || '');
  const [classes, setClasses] = useState<ClassItem[]>([]); const [holds, setHolds] = useState<Hold[]>([]);
  const [name, setName] = useState(''); const [seats, setSeats] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const saveStudent = (value:string) => { setStudentId(value); localStorage.setItem('studentId', value); };
  const refresh = useCallback(async () => { try { setClasses(await api<ClassItem[]>('/classes')); if (/^\d{17}$/.test(studentId)) setHolds(await api<Hold[]>('/me/holds', {}, studentId)); } catch(e) { setError((e as Error).message); } }, [studentId]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setHolds(h => [...h]), 1000); return () => clearInterval(timer); }, []);
  const activeHolds = useMemo(() => holds.filter(h => h.status === 'HELD'), [holds]);
  const createClass = async (e:React.FormEvent) => { e.preventDefault(); setError(''); try { await api('/classes',{method:'POST',body:JSON.stringify({name,totalSeats:Number(seats)})}); setName(''); setSeats(''); setNotice('Class created.'); refresh(); } catch(e) { setError((e as Error).message); } };
  const hold = async (classId:string) => { setError(''); if (!/^\d{17}$/.test(studentId)) return setError('Enter a valid 17-digit student registration number first.'); try { await api(`/classes/${classId}/holds`,{method:'POST'},studentId); setNotice('Seat held successfully.'); refresh(); } catch(e) { setError((e as Error).message); } };
  const confirm = async (id:string) => { setError(''); try { await api(`/holds/${id}/confirm`,{method:'POST'},studentId); setNotice('Admission fee recorded and seat confirmed.'); refresh(); } catch(e) { setError((e as Error).message); } };
  const cancel = async (id:string) => { setError(''); try { await api(`/holds/${id}`,{method:'DELETE'},studentId); setNotice('Application cancelled.'); refresh(); } catch(e) { setError((e as Error).message); } };
  const remaining = (h:Hold) => Math.max(0, Math.ceil((new Date(h.expiresAt).getTime()-Date.now())/1000));
  return <main><header><div><p className="eyebrow">ONNOROKOM ADMISSIONS</p><h1>School admission, without the queue.</h1><p className="sub">Choose a class, hold a seat for a few minutes, and confirm your admission.</p></div><label className="student">Student registration number<input value={studentId} onChange={e=>saveStudent(e.target.value)} placeholder="17 digits" maxLength={17}/></label></header>
    {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
    <section className="panel"><div className="section-title"><div><p className="eyebrow">AVAILABLE CLASSES</p><h2>Find your seat</h2></div><span className="live">● Live updates</span></div><div className="cards">{classes.length ? classes.map(c=><article className="card" key={c.id}><div><h3>{c.name}</h3><p className="muted">{c.confirmedSeats} confirmed · {c.heldSeats} currently held</p></div><div className="seat"><strong>{c.availableSeats}</strong><span>available</span></div><button disabled={!c.availableSeats} onClick={()=>hold(c.id)}>{c.availableSeats ? 'Apply for seat' : 'Full'}</button></article>) : <p className="empty">No classes yet. Create the first one below.</p>}</div></section>
    <section className="grid"><div className="panel"><p className="eyebrow">STUDENT VIEW</p><h2>My applications</h2>{activeHolds.length === 0 && holds.filter(h=>h.status!=='HELD').length===0 ? <p className="empty">Your applications will appear here.</p> : <div className="applications">{holds.map(h=><div className="application" key={h.holdId}><div><strong>{h.className || h.classId}</strong><p className="muted">{h.status === 'HELD' ? `${remaining(h)} seconds remaining` : `Status: ${h.status}`}</p></div><span className={`badge ${h.status.toLowerCase()}`}>{h.status}</span>{h.status==='HELD' && <div className="actions"><button onClick={()=>confirm(h.holdId)}>Pay admission fee</button><button className="secondary" onClick={()=>cancel(h.holdId)}>Cancel</button></div>}</div>)}</div>}</div>
    <div className="panel admin"><p className="eyebrow">SCHOOL ADMIN</p><h2>Create a class</h2><p className="muted">Each class/shift receives its own seat capacity.</p><form onSubmit={createClass}><label>Class and shift<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Class 6 - Morning Shift"/></label><label>Total seats<input required min="1" type="number" value={seats} onChange={e=>setSeats(e.target.value)} placeholder="120"/></label><button>Create class</button></form></div></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
