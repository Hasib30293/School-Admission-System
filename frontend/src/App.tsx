import React, { useCallback, useEffect, useState } from 'react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const NETWORK_ERROR = 'Could not reach the server. Please check that it is running and try again.';
const SERVER_ERROR = 'The server is temporarily unavailable. Please try again in a moment.';
export type ClassItem = { id: string; name: string; totalSeats: number; heldSeats: number; confirmedSeats: number; availableSeats: number };
export type Hold = { holdId: string; classId: string; className?: string; status: string; expiresAt: string };
export type EnrolledStudent = { holdId: string; studentId: string; studentName?: string; fatherName?: string; motherName?: string; contactInfo?: string; status: string; paymentMethod?: string; transactionId?: string; createdAt: string; expiresAt: string; confirmedAt?: string };

async function api<T>(path: string, options: RequestInit = {}, studentId?: string): Promise<T> {
  const headers = new Headers(options.headers); headers.set('Content-Type', 'application/json');
  if (studentId) headers.set('X-Student-Id', studentId);
  let response: Response;
  try { response = await fetch(`${API}${path}`, { ...options, headers }); } catch { throw new Error(NETWORK_ERROR); }
  if (!response.ok) { let message = response.status >= 500 ? SERVER_ERROR : `Request failed (${response.status}).`; try { message = (await response.json()).message || message; } catch { /* fallback */ } throw new Error(message); }
  return response.status === 204 ? undefined as T : response.json();
}

export function App() {
  const [studentId, setStudentId] = useState(() => localStorage.getItem('studentId') || '');
  const [classes, setClasses] = useState<ClassItem[]>([]); const [holds, setHolds] = useState<Hold[]>([]);
  const [tab, setTab] = useState<'classes' | 'applications' | 'admin'>('classes');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClassItem | null>(null);
  const [adminView, setAdminView] = useState<'create' | 'list'>('create');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [enrollClass, setEnrollClass] = useState<ClassItem | null>(null);
  const [enrollForm, setEnrollForm] = useState({ reg: '', name: '', fatherName: '', motherName: '', contact: '' });
  const [enrollError, setEnrollError] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [payHold, setPayHold] = useState<Hold | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'Banking' | 'Mobile banking' | 'Offline'>('Banking');
  const [transactionId, setTransactionId] = useState('');
  const [payError, setPayError] = useState('');
  const [paying, setPaying] = useState(false);
  const [studentsClass, setStudentsClass] = useState<ClassItem | null>(null);
  const [students, setStudents] = useState<EnrolledStudent[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [className, setClassName] = useState(''); const [shift, setShift] = useState('Morning'); const [seats, setSeats] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [now, setNow] = useState(() => Date.now());
  const validStudentId = /^\d{17}$/.test(studentId);
  const saveStudent = (value: string) => { setStudentId(value); localStorage.setItem('studentId', value); };
  const switchTab = (next: 'classes' | 'applications' | 'admin') => { setTab(next); setNotice(''); setError(''); if (next !== 'admin') setAdminMenuOpen(false); };
  const refresh = useCallback(async () => { try { setClasses(await api<ClassItem[]>('/classes')); if (/^\d{17}$/.test(studentId)) setHolds(await api<Hold[]>('/me/holds', {}, studentId)); else setHolds([]); setError(prev => prev === NETWORK_ERROR || prev === SERVER_ERROR ? '' : prev); } catch (e) { setError((e as Error).message); } }, [studentId]);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 10000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!highlightId) return; const timer = setTimeout(() => setHighlightId(null), 4000); return () => clearTimeout(timer); }, [highlightId]);
  const remaining = (h: Hold) => Math.max(0, Math.ceil((new Date(h.expiresAt).getTime() - now) / 1000));
  const statusOf = (h: Hold) => h.status === 'HELD' && remaining(h) === 0 ? 'EXPIRED' : h.status;
  const myActiveClassIds = new Set(holds.filter(h => h.status === 'HELD' || h.status === 'CONFIRMED').map(h => h.classId));
  const parseFullName = (full: string) => { const m = full.match(/^(.*?)\s*-\s*(Morning|Day)(?:\s+Shift)?$/i); return m ? { className: m[1].trim(), shift: m[2].toLowerCase() === 'day' ? 'Day' : 'Morning' } : { className: full, shift: 'Morning' }; };
  const startEdit = (c: ClassItem) => { const parsed = parseFullName(c.name); setEditingId(c.id); setClassName(parsed.className); setShift(parsed.shift); setSeats(String(c.totalSeats)); setAdminView('create'); setError(''); setNotice(''); };
  const cancelEdit = () => { setEditingId(null); setClassName(''); setShift('Morning'); setSeats(''); };
  const saveClass = async (e: React.FormEvent) => { e.preventDefault(); setError(''); setNotice(''); const fullName = `${className.trim()} - ${shift} Shift`; try { if (editingId) { const id = editingId; await api(`/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name: fullName, totalSeats: Number(seats) }) }); setHighlightId(id); setAdminView('list'); switchTab('admin'); setNotice('Class updated.'); } else { await api('/classes', { method: 'POST', body: JSON.stringify({ name: fullName, totalSeats: Number(seats) }) }); setNotice('Class created.'); } setClassName(''); setShift('Morning'); setSeats(''); setEditingId(null); refresh(); } catch (e) { setError((e as Error).message); } };
  const askDelete = (c: ClassItem) => { setError(''); setNotice(''); setPendingDelete(c); };
  const deleteClass = async () => { if (!pendingDelete) return; const c = pendingDelete; setPendingDelete(null); setError(''); setNotice(''); try { await api(`/classes/${c.id}`, { method: 'DELETE' }); setNotice('Class deleted.'); if (editingId === c.id) cancelEdit(); refresh(); } catch (e) { setError((e as Error).message); } };
  const openEnroll = (c: ClassItem) => { setEnrollClass(c); setEnrollForm({ reg: studentId, name: '', fatherName: '', motherName: '', contact: '' }); setEnrollError(''); };
  const closeEnroll = () => { if (!enrolling) { setEnrollClass(null); setEnrollError(''); } };
  const submitEnroll = async (e: React.FormEvent) => {
    e.preventDefault(); setEnrollError('');
    const reg = enrollForm.reg.trim();
    if (!/^\d{17}$/.test(reg)) return setEnrollError('Registration number must be exactly 17 digits.');
    if (!enrollForm.name.trim() || !enrollForm.fatherName.trim() || !enrollForm.motherName.trim() || !enrollForm.contact.trim()) return setEnrollError('Please fill in all the student details.');
    if (!enrollClass) return;
    setEnrolling(true);
    try {
      await api(`/classes/${enrollClass.id}/holds`, { method: 'POST', body: JSON.stringify({ studentName: enrollForm.name.trim(), fatherName: enrollForm.fatherName.trim(), motherName: enrollForm.motherName.trim(), contactInfo: enrollForm.contact.trim() }) }, reg);
      saveStudent(reg);
      switchTab('applications');
      setNotice(`Seat held for ${enrollClass.name}. Pay the admission fee to confirm.`);
      setEnrollClass(null); setEnrollForm({ reg: '', name: '', fatherName: '', motherName: '', contact: '' });
      refresh();
    } catch (err) { setEnrollError((err as Error).message); }
    finally { setEnrolling(false); }
  };
  const openPay = (h: Hold) => { setPayHold(h); setPaymentMethod('Banking'); setTransactionId(''); setPayError(''); };
  const closePay = () => { if (!paying) { setPayHold(null); setPayError(''); } };
  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault(); setPayError('');
    if (!payHold) return;
    const tx = transactionId.trim();
    if (!tx) return setPayError('Enter the transaction ID to confirm the payment.');
    setPaying(true);
    try {
      await api(`/holds/${payHold.holdId}/confirm`, { method: 'POST', body: JSON.stringify({ paymentMethod, transactionId: tx }) }, studentId);
      setNotice(`Payment confirmed via ${paymentMethod}. Seat confirmed for ${payHold.className || 'your class'}.`);
      setPayHold(null); setTransactionId('');
      refresh();
    } catch (err) { setPayError((err as Error).message); }
    finally { setPaying(false); }
  };
  const cancel = async (id: string) => { setError(''); setNotice(''); try { await api(`/holds/${id}`, { method: 'DELETE' }, studentId); setNotice('Application cancelled.'); refresh(); } catch (e) { setError((e as Error).message); } };
  const openStudents = async (c: ClassItem) => {
    setStudentsClass(c); setStudents([]); setStudentsError(''); setStudentsLoading(true);
    try { setStudents(await api<EnrolledStudent[]>(`/classes/${c.id}/holds`)); }
    catch (e) { setStudentsError((e as Error).message); }
    finally { setStudentsLoading(false); }
  };
  const closeStudents = () => { setStudentsClass(null); setStudents([]); setStudentsError(''); };
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark" aria-hidden="true">🎓</div><div><h1>Online School Admission Portal</h1><p>Simple and fast admission process</p></div></div>
      <label className="student-field">Student birth registration number:<div className="student-input-wrap"><span aria-hidden="true">▣</span><input value={studentId} onChange={e => saveStudent(e.target.value.replace(/\D/g, ''))} placeholder="201212..." maxLength={17} inputMode="numeric" /><span className={validStudentId ? 'verified' : 'unverified'}>{validStudentId ? '✓ Verified' : '17 digits'}</span></div></label>
    </header>
    <div className="app-body">
    <aside className="sidebar">
      <nav className="nav-tabs" aria-label="Primary navigation">
        <a className={tab === 'classes' ? 'active' : ''} href="#classes" onClick={e => { e.preventDefault(); switchTab('classes'); }}><span className="nav-icon" aria-hidden="true">☷</span><span className="nav-text"><span className="nav-title">Class list</span><span className="nav-sub">Browse available shifts</span></span></a>
        <a className={tab === 'applications' ? 'active' : ''} href="#applications" onClick={e => { e.preventDefault(); switchTab('applications'); }}><span className="nav-icon" aria-hidden="true">▣</span><span className="nav-text"><span className="nav-title">My applications</span><span className="nav-sub">Track your seat holds</span></span>{holds.length > 0 && <b>{holds.length}</b>}</a>
        <div className={`nav-group ${adminMenuOpen ? 'open' : ''}`}>
          <a className={tab === 'admin' ? 'active' : ''} href="#admin" aria-expanded={adminMenuOpen} onClick={e => { e.preventDefault(); setAdminMenuOpen(open => !open); }}><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-text"><span className="nav-title">Admin</span><span className="nav-sub">{adminView === 'create' ? 'Create class' : 'Classes'}</span></span><span className="nav-caret" aria-hidden="true">▾</span></a>
          {adminMenuOpen && <div className="nav-dropdown"><button type="button" className={adminView === 'create' ? 'active' : ''} onClick={() => { setAdminView('create'); switchTab('admin'); setAdminMenuOpen(false); }}>Create classes</button><button type="button" className={adminView === 'list' ? 'active' : ''} onClick={() => { setAdminView('list'); switchTab('admin'); setAdminMenuOpen(false); }}>Classes</button></div>}
        </div>
      </nav>
      <div className="sidebar-note"><strong>Seat holds expire quickly.</strong><span>Pay the admission fee before the timer runs out.</span></div>
    </aside>
    <div className="main-area">
    <main>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {tab === 'classes' && <>
        <section className="intro-card" id="classes"><div><h2>List of available classes</h2><p>Each shift is set up and displayed as a separate class</p></div><div className="info-note">● <span>After applying, you have limited time to pay the admission fee before the seat is released</span></div></section>
        <section className="table-card" aria-label="Available classes"><div className="table-scroll"><table><thead><tr><th>Class and Shift name</th><th>Total seats</th><th>On hold</th><th>Confirmed seats</th><th>Available seats</th><th>Action</th></tr></thead><tbody>{classes.length ? classes.map(c => { const applied = myActiveClassIds.has(c.id); return <tr key={c.id}><th scope="row">{c.name}</th><td>{c.totalSeats}</td><td className="held-number">{c.heldSeats}</td><td className="confirmed-number">{c.confirmedSeats}</td><td><span className={`available-pill ${c.availableSeats ? '' : 'empty-pill'}`}>{c.availableSeats}</span></td><td><button className="apply-button" disabled={!c.availableSeats || applied} onClick={() => openEnroll(c)}>{applied ? 'Already enrolled' : c.availableSeats ? '➤ Enroll' : 'No seats available'}</button></td></tr>; }) : <tr><td colSpan={6} className="empty">No classes have been created yet.</td></tr>}</tbody></table></div></section>
      </>}
      {tab === 'applications' && <div className="content-card tab-card" id="applications"><p className="eyebrow">STUDENT VIEW</p><h2>My applications</h2>{holds.length === 0 ? <p className="empty">Your applications will appear here.</p> : <div className="applications">{holds.map(h => { const status = statusOf(h); return <div className="application" key={h.holdId}><div><strong>{h.className || h.classId}</strong><p>{status === 'HELD' ? `${remaining(h)} seconds remaining` : `Status: ${status}`}</p></div><span className={`badge ${status.toLowerCase()}`}>{status}</span>{(status === 'HELD' || status === 'EXPIRED') && <div className="actions"><button disabled={status !== 'HELD'} onClick={() => openPay(h)}>Pay admission fee</button>{status === 'HELD' && <button className="secondary" onClick={() => cancel(h.holdId)}>Cancel</button>}</div>}</div>; })}</div>}</div>}
      {tab === 'admin' && <div className="content-card tab-card" id="admin">
        <div className="admin-head">
          <div><p className="eyebrow">SCHOOL ADMIN</p><h2>{adminView === 'create' ? 'Create classes' : 'Classes'}</h2></div>
        </div>
        {adminView === 'create' ? <>
          <h3>{editingId ? 'Edit class' : 'Create a class'}</h3>
          <p className="muted">Set a separate seat capacity for each class and shift.</p>
          <form onSubmit={saveClass}>
            <label>Class name<input required value={className} onChange={e => setClassName(e.target.value)} placeholder="ex: Class 6" /></label>
            <label>Shift name<select value={shift} onChange={e => setShift(e.target.value)}><option value="Morning">Morning</option><option value="Day">Day</option></select></label>
            <label>Total seats<input required min="1" type="number" value={seats} onChange={e => setSeats(e.target.value)} placeholder="ex: 120" /></label>
            <div className="form-actions"><button>{editingId ? 'Save changes' : 'Create class'}</button>{editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div>
          </form>
        </> : <>
          <h3>Classes</h3>
          <div className="admin-scroll"><table><thead><tr><th>Class name</th><th>Total seats</th><th>Available seats</th><th>Actions</th></tr></thead><tbody>{classes.length ? classes.map(c => <tr key={c.id} className={c.id === highlightId ? 'row-highlight' : undefined}><th scope="row"><button type="button" className="class-name-button" onClick={() => openStudents(c)}>{c.name}</button></th><td>{c.totalSeats}</td><td><span className={`available-pill ${c.availableSeats ? '' : 'empty-pill'}`}>{c.availableSeats}</span></td><td><div className="manage-actions admin-actions"><button type="button" className="secondary" onClick={() => startEdit(c)}>Edit</button><button type="button" className="danger" onClick={() => askDelete(c)}>Delete</button></div></td></tr>) : <tr><td colSpan={4} className="empty">No classes yet.</td></tr>}</tbody></table></div>
        </>}
      </div>}
    </main>
    </div>
    </div>
    {enrollClass && <div className="modal-overlay" role="presentation" onClick={closeEnroll}>
      <div className="modal enroll-modal" role="dialog" aria-modal="true" aria-labelledby="enroll-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={closeEnroll}>×</button>
        <div className="modal-icon enroll-icon" aria-hidden="true">🎓</div>
        <h3 id="enroll-title">Enroll in {enrollClass.name}</h3>
        <p>Enter the student details, then pay the admission fee to confirm the seat.</p>
        {enrollError && <div className="alert error enroll-error">{enrollError}</div>}
        <form className="enroll-form" onSubmit={submitEnroll}>
          <label>Registration number<input value={enrollForm.reg} onChange={e => setEnrollForm(f => ({ ...f, reg: e.target.value.replace(/\D/g, '') }))} placeholder="ex: 20121234567890123" maxLength={17} inputMode="numeric" required /></label>
          <label>Student name<input value={enrollForm.name} onChange={e => setEnrollForm(f => ({ ...f, name: e.target.value }))} placeholder="ex: Ayesha Rahman" required /></label>
          <div className="enroll-grid">
            <label>Father's name<input value={enrollForm.fatherName} onChange={e => setEnrollForm(f => ({ ...f, fatherName: e.target.value }))} placeholder="ex: Abdul Rahman" required /></label>
            <label>Mother's name<input value={enrollForm.motherName} onChange={e => setEnrollForm(f => ({ ...f, motherName: e.target.value }))} placeholder="ex: Fatima Begum" required /></label>
          </div>
          <label>Contact information<input value={enrollForm.contact} onChange={e => setEnrollForm(f => ({ ...f, contact: e.target.value }))} placeholder="ex: 017XXXXXXXX" required /></label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={closeEnroll} disabled={enrolling}>Cancel</button>
            <button type="submit" disabled={enrolling}>{enrolling ? 'Processing payment...' : 'Enroll & pay'}</button>
          </div>
        </form>
      </div>
    </div>}
    {payHold && <div className="modal-overlay" role="presentation" onClick={closePay}>
      <div className="modal pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={closePay}>×</button>
        <div className="modal-icon pay-icon" aria-hidden="true">💳</div>
        <h3 id="pay-title">Pay admission fee</h3>
        <p>{payHold.className || 'Selected class'} — confirm your seat by recording the payment.</p>
        {payError && <div className="alert error enroll-error">{payError}</div>}
        <form className="enroll-form" onSubmit={submitPayment}>
          <fieldset className="pay-methods">
            <legend>Payment method</legend>
            {(['Banking', 'Mobile banking', 'Offline'] as const).map(m => <label key={m} className={`pay-method ${paymentMethod === m ? 'active' : ''}`}><input type="radio" name="paymentMethod" value={m} checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} /><span>{m}</span></label>)}
          </fieldset>
          <label>Transaction ID<input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="ex: TRX-2026-000123" required /></label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={closePay} disabled={paying}>Cancel</button>
            <button type="submit" disabled={paying}>{paying ? 'Confirming...' : 'Confirm payment'}</button>
          </div>
        </form>
      </div>
    </div>}
    {studentsClass && <div className="modal-overlay" role="presentation" onClick={closeStudents}>
      <div className="modal students-modal" role="dialog" aria-modal="true" aria-labelledby="students-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={closeStudents}>×</button>
        <div className="modal-icon" aria-hidden="true">👥</div>
        <h3 id="students-title">{studentsClass.name}</h3>
        <p>Enrolled students and their information.</p>
        {studentsError && <div className="alert error enroll-error">{studentsError}</div>}
        {studentsLoading ? <p className="empty">Loading students...</p> : students.length === 0 ? <p className="empty">No students have enrolled in this class yet.</p> : <div className="students-scroll"><table className="students-table"><thead><tr><th>Student name</th><th>Registration no.</th><th>Father's name</th><th>Mother's name</th><th>Contact</th><th>Status</th><th>Payment</th></tr></thead><tbody>{students.map(s => <tr key={s.holdId}><td><strong>{s.studentName || '—'}</strong></td><td>{s.studentId}</td><td>{s.fatherName || '—'}</td><td>{s.motherName || '—'}</td><td>{s.contactInfo || '—'}</td><td><span className={`badge ${s.status.toLowerCase()}`}>{s.status}</span></td><td>{s.status === 'CONFIRMED' ? <><strong>{s.paymentMethod || '—'}</strong><br /><small>{s.transactionId || '—'}</small></> : <span className="muted">Not paid</span>}</td></tr>)}</tbody></table></div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={closeStudents}>Close</button></div>
      </div>
    </div>}
    {pendingDelete && <div className="modal-overlay" role="presentation" onClick={() => setPendingDelete(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={e => e.stopPropagation()}><button type="button" className="modal-close" aria-label="Close" onClick={() => setPendingDelete(null)}>×</button><div className="modal-icon" aria-hidden="true">🗑</div><h3 id="delete-title">Delete class?</h3><p>Are you sure you want to delete <strong>{pendingDelete.name}</strong>? This also removes all applications for this class.</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button type="button" className="danger" onClick={deleteClass}>Delete class</button></div></div></div>}
  </div>;
}
