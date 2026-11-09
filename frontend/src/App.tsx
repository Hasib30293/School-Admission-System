import React, { useCallback, useEffect, useState } from 'react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const NETWORK_ERROR = 'Could not reach the server. Please check that it is running and try again.';
export type ClassItem = { id: string; name: string; totalSeats: number; heldSeats: number; confirmedSeats: number; availableSeats: number };
export type Hold = { holdId: string; classId: string; className?: string; status: string; expiresAt: string };

async function api<T>(path: string, options: RequestInit = {}, studentId?: string): Promise<T> {
  const headers = new Headers(options.headers); headers.set('Content-Type', 'application/json');
  if (studentId) headers.set('X-Student-Id', studentId);
  let response: Response;
  try { response = await fetch(`${API}${path}`, { ...options, headers }); } catch { throw new Error(NETWORK_ERROR); }
  if (!response.ok) { let message = response.status >= 500 ? 'The server is temporarily unavailable. Please try again in a moment.' : `Request failed (${response.status}).`; try { message = (await response.json()).message || message; } catch { /* fallback */ } throw new Error(message); }
  return response.status === 204 ? undefined as T : response.json();
}

export function App() {
  const [studentId, setStudentId] = useState(() => localStorage.getItem('studentId') || '');
  const [classes, setClasses] = useState<ClassItem[]>([]); const [holds, setHolds] = useState<Hold[]>([]);
  const [tab, setTab] = useState<'classes' | 'applications' | 'admin'>('classes');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(''); const [seats, setSeats] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [now, setNow] = useState(() => Date.now());
  const validStudentId = /^\d{17}$/.test(studentId);
  const saveStudent = (value: string) => { setStudentId(value); localStorage.setItem('studentId', value); };
  const refresh = useCallback(async () => { try { setClasses(await api<ClassItem[]>('/classes')); if (/^\d{17}$/.test(studentId)) setHolds(await api<Hold[]>('/me/holds', {}, studentId)); else setHolds([]); setError(prev => prev === NETWORK_ERROR ? '' : prev); } catch (e) { setError((e as Error).message); } }, [studentId]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = (h: Hold) => Math.max(0, Math.ceil((new Date(h.expiresAt).getTime() - now) / 1000));
  const statusOf = (h: Hold) => h.status === 'HELD' && remaining(h) === 0 ? 'EXPIRED' : h.status;
  const myActiveClassIds = new Set(holds.filter(h => h.status === 'HELD' || h.status === 'CONFIRMED').map(h => h.classId));
  const startEdit = (c: ClassItem) => { setEditingId(c.id); setName(c.name); setSeats(String(c.totalSeats)); setError(''); setNotice(''); };
  const cancelEdit = () => { setEditingId(null); setName(''); setSeats(''); };
  const saveClass = async (e: React.FormEvent) => { e.preventDefault(); setError(''); setNotice(''); try { if (editingId) { await api(`/classes/${editingId}`, { method: 'PUT', body: JSON.stringify({ name, totalSeats: Number(seats) }) }); setNotice('Class updated.'); } else { await api('/classes', { method: 'POST', body: JSON.stringify({ name, totalSeats: Number(seats) }) }); setNotice('Class created.'); } setName(''); setSeats(''); setEditingId(null); refresh(); } catch (e) { setError((e as Error).message); } };
  const deleteClass = async (c: ClassItem) => { if (!window.confirm(`Delete "${c.name}"? This also removes its applications.`)) return; setError(''); setNotice(''); try { await api(`/classes/${c.id}`, { method: 'DELETE' }); setNotice('Class deleted.'); if (editingId === c.id) cancelEdit(); refresh(); } catch (e) { setError((e as Error).message); } };
  const hold = async (classId: string) => { setError(''); setNotice(''); if (!validStudentId) return setError('Enter a valid 17-digit student registration number first.'); try { await api(`/classes/${classId}/holds`, { method: 'POST' }, studentId); setNotice('Seat held successfully.'); refresh(); } catch (e) { setError((e as Error).message); } };
  const confirm = async (id: string) => { setError(''); setNotice(''); try { await api(`/holds/${id}/confirm`, { method: 'POST' }, studentId); setNotice('Admission fee recorded and seat confirmed.'); refresh(); } catch (e) { setError((e as Error).message); } };
  const cancel = async (id: string) => { setError(''); setNotice(''); try { await api(`/holds/${id}`, { method: 'DELETE' }, studentId); setNotice('Application cancelled.'); refresh(); } catch (e) { setError((e as Error).message); } };
  return <div className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark" aria-hidden="true">🎓</div><div><h1>Online School Admission Portal</h1><p>Simple and fast admission process</p></div></div><label className="student-field">Student birth registration number:<div className="student-input-wrap"><span aria-hidden="true">▣</span><input value={studentId} onChange={e => saveStudent(e.target.value.replace(/\D/g, ''))} placeholder="201212..." maxLength={17} inputMode="numeric" /><span className={validStudentId ? 'verified' : 'unverified'}>{validStudentId ? '✓ Verified' : '17 digits'}</span></div></label></header>
    <nav className="nav-tabs" aria-label="Primary navigation"><a className={tab === 'classes' ? 'active' : ''} href="#classes" onClick={e => { e.preventDefault(); setTab('classes'); }}>☷ <span>Class list</span></a><a className={tab === 'applications' ? 'active' : ''} href="#applications" onClick={e => { e.preventDefault(); setTab('applications'); }}>▣ <span>My applications</span>{holds.length > 0 && <b>{holds.length}</b>}</a><a className={tab === 'admin' ? 'active' : ''} href="#admin" onClick={e => { e.preventDefault(); setTab('admin'); }}>☷ <span>Create Class (School Admin)</span></a></nav>
    <main>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {tab === 'classes' && <>
        <section className="intro-card" id="classes"><div><h2>List of available classes</h2><p>Each shift is set up and displayed as a separate class</p></div><div className="info-note">● <span>After applying, you have limited time to pay the admission fee before the seat is released</span></div></section>
        <section className="table-card" aria-label="Available classes"><div className="table-scroll"><table><thead><tr><th>Class and Shift name</th><th>Total seats</th><th>On hold</th><th>Confirmed seats</th><th>Available seats</th><th>Action</th></tr></thead><tbody>{classes.length ? classes.map(c => { const applied = myActiveClassIds.has(c.id); return <tr key={c.id}><th scope="row">{c.name}</th><td>{c.totalSeats}</td><td className="held-number">{c.heldSeats}</td><td className="confirmed-number">{c.confirmedSeats}</td><td><span className={`available-pill ${c.availableSeats ? '' : 'empty-pill'}`}>{c.availableSeats}</span></td><td><button className="apply-button" disabled={!c.availableSeats || applied} onClick={() => hold(c.id)}>{applied ? 'Already applied' : c.availableSeats ? '➤ Apply' : 'No seats available'}</button></td></tr>; }) : <tr><td colSpan={6} className="empty">No classes have been created yet.</td></tr>}</tbody></table></div></section>
      </>}
      {tab === 'applications' && <div className="content-card tab-card" id="applications"><p className="eyebrow">STUDENT VIEW</p><h2>My applications</h2>{holds.length === 0 ? <p className="empty">Your applications will appear here.</p> : <div className="applications">{holds.map(h => { const status = statusOf(h); return <div className="application" key={h.holdId}><div><strong>{h.className || h.classId}</strong><p>{status === 'HELD' ? `${remaining(h)} seconds remaining` : `Status: ${status}`}</p></div><span className={`badge ${status.toLowerCase()}`}>{status}</span>{(status === 'HELD' || status === 'EXPIRED') && <div className="actions"><button disabled={status !== 'HELD'} onClick={() => confirm(h.holdId)}>Pay admission fee</button>{status === 'HELD' && <button className="secondary" onClick={() => cancel(h.holdId)}>Cancel</button>}</div>}</div>; })}</div>}</div>}
      {tab === 'admin' && <div className="content-card tab-card" id="admin"><p className="eyebrow">SCHOOL ADMIN</p><h2>{editingId ? 'Edit class' : 'Create a class'}</h2><p className="muted">Set a separate seat capacity for each class/shift.</p><form onSubmit={saveClass}><label>Class and Shift name<input required value={name} onChange={e => setName(e.target.value)} placeholder="Class 6 - Morning Shift" /></label><label>Total seats<input required min="1" type="number" value={seats} onChange={e => setSeats(e.target.value)} placeholder="120" /></label><div className="form-actions"><button>{editingId ? 'Save changes' : 'Create class'}</button>{editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div></form><div className="class-manage"><h3>Manage classes</h3>{classes.length === 0 ? <p className="muted">No classes yet.</p> : classes.map(c => <div className="manage-row" key={c.id}><div><strong>{c.name}</strong><p className="muted">{c.totalSeats} seats | {c.availableSeats} available</p></div><div className="manage-actions"><button type="button" className="secondary" onClick={() => startEdit(c)}>Edit</button><button type="button" className="danger" onClick={() => deleteClass(c)}>Delete</button></div></div>)}</div></div>}
    </main><footer>School Admission Portal UI © 2026 | No login required | Fast and simple admission process</footer>
  </div>;
}
