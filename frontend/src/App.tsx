import React, { useCallback, useEffect, useRef, useState } from 'react';

const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const NETWORK_ERROR = 'Could not reach the server. Please check that it is running and try again.';
const SERVER_ERROR = 'The server is temporarily unavailable. Please try again in a moment.';
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 310;
const clampSidebar = (width: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width));
export type ClassItem = { id: string; name: string; totalSeats: number; heldSeats: number; confirmedSeats: number; availableSeats: number; pendingSeats?: number };
export type Application = { holdId: string; applicationReference: string; classId: string; className: string; shift: string; studentName: string; birthRegistrationNumber: string; dateOfBirth?: string; gender?: string; fatherName?: string; motherName?: string; contactNumber?: string; address?: string; createdAt: string; applicationStatus: string; paymentStatus: string; seatHoldExpiry?: string; paymentMethod?: string; transactionId?: string; reviewNote?: string };
export type Hold = { holdId: string; classId: string; className?: string; studentId?: string; status: string; expiresAt: string; paymentMethod?: string; transactionId?: string; paymentSubmittedAt?: string; reviewNote?: string };
export type EnrolledStudent = { holdId: string; studentId: string; studentName?: string; fatherName?: string; motherName?: string; contactInfo?: string; status: string; paymentMethod?: string; transactionId?: string; paymentSubmittedAt?: string; reviewNote?: string; createdAt: string; expiresAt: string; confirmedAt?: string };
export type PendingPayment = { holdId: string; classId: string; className: string; studentId: string; studentName?: string; fatherName?: string; motherName?: string; contactInfo?: string; paymentMethod?: string; transactionId?: string; paymentSubmittedAt?: string; createdAt: string };

async function api<T>(path: string, options: RequestInit = {}, studentId?: string): Promise<T> {
  const headers = new Headers(options.headers); headers.set('Content-Type', 'application/json');
  if (studentId) headers.set('X-Student-Id', studentId);
  let response: Response;
  try { response = await fetch(`${API}${path}`, { ...options, headers }); } catch { throw new Error(NETWORK_ERROR); }
  if (!response.ok) { let message = response.status >= 500 ? SERVER_ERROR : `Request failed (${response.status}).`; try { message = (await response.json()).message || message; } catch { /* fallback */ } throw new Error(message); }
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new Error('The server returned an unexpected response. Please reload the page and try again.'); }
}

function UserIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 12.2a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2Zm0 1.7c-4.1 0-7.4 2.3-7.4 5.2v1.1h14.8v-1.1c0-2.9-3.3-5.2-7.4-5.2Z" /></svg>;
}
function CheckIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5" /></svg>;
}

export function App() {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [studentId, setStudentId] = useState(() => localStorage.getItem('studentId') || '');
  const [profileOpen, setProfileOpen] = useState(false);
  const [application, setApplication] = useState<Application | null>(null);
  const [applicationSearch, setApplicationSearch] = useState('');
  const [searchError, setSearchError] = useState('');
  const [tab, setTab] = useState<'classes' | 'applications' | 'admin'>('classes');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClassItem | null>(null);
  const [adminView, setAdminView] = useState<'create' | 'list' | 'payments'>('create');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [enrollClass, setEnrollClass] = useState<ClassItem | null>(null);
  const [enrollForm, setEnrollForm] = useState({ reg: '', name: '', contact: '' });
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
  const [pendingPayments, setPendingPayments] = useState<PendingPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsError, setPaymentsError] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [className, setClassName] = useState(''); const [shift, setShift] = useState('Morning'); const [seats, setSeats] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [now, setNow] = useState(() => Date.now());
  const [sidebarWidth, setSidebarWidth] = useState(() => { const saved = Number(localStorage.getItem('sidebarWidth')); return Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX ? saved : SIDEBAR_DEFAULT; });
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);
  const validStudentId = /^\d{17}$/.test(studentId);
  const saveStudentId = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 17);
    setStudentId(digits);
    localStorage.setItem('studentId', digits);
  };
  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validStudentId) return;
    setNotice('Registration number saved.');
    setProfileOpen(false);
  };
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => { resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }; e.currentTarget.setPointerCapture(e.pointerId); document.body.classList.add('resizing'); e.preventDefault(); };
  const moveResize = (e: React.PointerEvent<HTMLDivElement>) => { const drag = resizeRef.current; if (drag) setSidebarWidth(clampSidebar(drag.startWidth + e.clientX - drag.startX)); };
  const endResize = (e: React.PointerEvent<HTMLDivElement>) => { if (!resizeRef.current) return; resizeRef.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); document.body.classList.remove('resizing'); };
  const resizeByKey = (e: React.KeyboardEvent<HTMLDivElement>) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setSidebarWidth(w => clampSidebar(w + (e.key === 'ArrowRight' ? 16 : -16))); } };
  const switchTab = (next: 'classes' | 'applications' | 'admin') => { setTab(next); setNotice(''); setError(''); setAdminMenuOpen(false); if (next === 'admin') setProfileOpen(false); };
  const refresh = useCallback(async () => { try { setClasses(await api<ClassItem[]>('/classes')); setError(prev => prev === NETWORK_ERROR || prev === SERVER_ERROR ? '' : prev); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 3000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (!highlightId) return; const timer = setTimeout(() => setHighlightId(null), 4000); return () => clearTimeout(timer); }, [highlightId]);
  useEffect(() => { localStorage.setItem('sidebarWidth', String(sidebarWidth)); }, [sidebarWidth]);
  useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (e: MouseEvent) => { if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false); };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('mousedown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [profileOpen]);
  const parseFullName = (full: string) => { const m = full.match(/^(.*?)\s*-\s*(Morning|Day|Evening)(?:\s+Shift)?$/i); return m ? { className: m[1].trim(), shift: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() } : { className: full, shift: 'Morning' }; };
  const startEdit = (c: ClassItem) => { const parsed = parseFullName(c.name); setEditingId(c.id); setClassName(parsed.className); setShift(parsed.shift); setSeats(String(c.totalSeats)); setAdminView('create'); setError(''); setNotice(''); };
  const cancelEdit = () => { setEditingId(null); setClassName(''); setShift('Morning'); setSeats(''); };
  const saveClass = async (e: React.FormEvent) => { e.preventDefault(); setError(''); setNotice(''); const fullName = `${className.trim()} - ${shift} Shift`; try { if (editingId) { const id = editingId; await api(`/classes/${id}`, { method: 'PUT', body: JSON.stringify({ name: fullName, totalSeats: Number(seats) }) }); setHighlightId(id); setAdminView('list'); switchTab('admin'); setNotice('Class updated.'); } else { await api('/classes', { method: 'POST', body: JSON.stringify({ name: fullName, totalSeats: Number(seats) }) }); setNotice('Class created.'); } setClassName(''); setShift('Morning'); setSeats(''); setEditingId(null); refresh(); } catch (e) { setError((e as Error).message); } };
  const askDelete = (c: ClassItem) => { setError(''); setNotice(''); setPendingDelete(c); };
  const deleteClass = async () => { if (!pendingDelete) return; const c = pendingDelete; setPendingDelete(null); setError(''); setNotice(''); try { await api(`/classes/${c.id}`, { method: 'DELETE' }); setNotice('Class deleted.'); if (editingId === c.id) cancelEdit(); refresh(); } catch (e) { setError((e as Error).message); } };
  const openEnroll = (c: ClassItem) => { setEnrollClass(c); setEnrollForm({ reg: studentId, name: '', contact: '' }); setEnrollError(''); };
  const closeEnroll = () => { if (!enrolling) { setEnrollClass(null); setEnrollError(''); } };
  const submitEnroll = async (e: React.FormEvent) => {
    e.preventDefault(); setEnrollError('');
    const reg = enrollForm.reg.trim();
    if (!/^\d{17}$/.test(reg)) return setEnrollError('Registration number must be exactly 17 digits.');
    if (!enrollForm.name.trim() || !enrollForm.contact.trim()) return setEnrollError('Please fill in all required application fields.');
    if (!/^\d{11}$/.test(enrollForm.contact.trim())) return setEnrollError('Contact number must be exactly 11 digits.');
    if (!enrollClass) return;
    setEnrolling(true);
    try {
      const created = await api<{ applicationReference: string }>(`/classes/${enrollClass.id}/holds`, { method: 'POST', body: JSON.stringify({ birthRegistrationNumber: reg, studentName: enrollForm.name.trim(), contactInfo: enrollForm.contact.trim() }) });
      switchTab('applications');
      setNotice(`Application submitted successfully. Your reference number is ${created.applicationReference}.`);
      saveStudentId(reg);
      setApplicationSearch(reg); setEnrollClass(null); setEnrollForm({ reg: '', name: '', contact: '' });
      await searchApplication(reg);
      refresh();
    } catch (err) { setEnrollError((err as Error).message); }
    finally { setEnrolling(false); }
  };
  const openPay = (h: Hold) => { setPayHold(h); setPaymentMethod('Banking'); setTransactionId(''); setPayError(''); };
  const closePay = () => { if (!paying) { setPayHold(null); setPayError(''); } };
  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault(); setPayError('');
    if (!payHold) return;
    const submitted = payHold;
    const tx = transactionId.trim();
    if (!tx) return setPayError('Enter the transaction ID to submit the payment.');
    setPaying(true);
    try {
      await api(`/holds/${submitted.holdId}/confirm`, { method: 'POST', body: JSON.stringify({ paymentMethod, transactionId: tx }) }, submitted.studentId);
      setNotice(`Payment details submitted via ${paymentMethod}. An admin will verify transaction ${tx} and approve the seat.`);
      // Close the payment dialog and update the application card immediately, so the
      // "Pay Admission Fee" button disappears as soon as the payment is submitted.
      setPayHold(null); setTransactionId('');
      setApplication(prev => prev && prev.holdId === submitted.holdId
        ? { ...prev, applicationStatus: 'Payment Under Review', paymentStatus: 'Paid', paymentMethod, transactionId: tx }
        : prev);
      if (submitted.studentId) {
        try {
          const results = await api<Application[]>(`/applications/search?birthRegistrationNumber=${submitted.studentId}`);
          setApplication(results[0] ?? null);
        } catch { /* the payment was recorded; keep the locally updated details */ }
      }
      refresh();
    } catch (err) { setPayError((err as Error).message); }
    finally { setPaying(false); }
  };
  const searchApplication = async (value = applicationSearch) => { const reg = value.replace(/\D/g, ''); setSearchError(''); setApplication(null); if (!/^\d{17}$/.test(reg)) { setSearchError('Enter exactly 17 digits.'); return; } try { const results = await api<Application[]>(`/applications/search?birthRegistrationNumber=${reg}`); if (!results.length) setSearchError('No application found for this birth registration number.'); else { setApplication(results[0]); saveStudentId(reg); } } catch (e) { setSearchError((e as Error).message); } };
  const openStudents = async (c: ClassItem) => {
    setStudentsClass(c); setStudents([]); setStudentsError(''); setStudentsLoading(true);
    try { setStudents(await api<EnrolledStudent[]>(`/classes/${c.id}/holds`)); }
    catch (e) { setStudentsError((e as Error).message); }
    finally { setStudentsLoading(false); }
  };
  const closeStudents = () => { setStudentsClass(null); setStudents([]); setStudentsError(''); };
  const loadPendingPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try { setPendingPayments(await api<PendingPayment[]>('/admin/payments/pending')); setPaymentsError(''); }
    catch (e) { setPaymentsError((e as Error).message); }
    finally { setPaymentsLoading(false); }
  }, []);
  useEffect(() => {
    if (tab !== 'admin') return;
    loadPendingPayments();
    const timer = setInterval(loadPendingPayments, 3000);
    return () => clearInterval(timer);
  }, [tab, loadPendingPayments]);
  const reviewPayment = async (payment: PendingPayment, action: 'approve' | 'reject') => {
    setReviewingId(payment.holdId); setError(''); setNotice('');
    try {
      await api(`/holds/${payment.holdId}/${action}`, { method: 'POST' });
      setNotice(action === 'approve'
        ? `Payment approved. ${payment.studentName || payment.studentId} is admitted to ${payment.className}.`
        : `Payment rejected for ${payment.studentName || payment.studentId}. The seat has been released.`);
      await loadPendingPayments();
      refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setReviewingId(null); }
  };
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark" aria-hidden="true">🎓</div><div><h1>Online School Admission Portal</h1><p>Simple and fast admission process</p></div></div>
      {tab !== 'admin' && <div className="profile" ref={profileRef}>
        <button type="button" className={`profile-chip ${validStudentId ? 'is-verified' : ''}`} aria-haspopup="dialog" aria-expanded={profileOpen} aria-label="Student account" title="Student account" onClick={() => setProfileOpen(open => !open)}>
          <span className="profile-avatar" aria-hidden="true"><UserIcon size={18} /></span>
          <span className="profile-chip-body">
            <span className="profile-chip-label">Registration no.</span>
            <span className={`profile-chip-number ${studentId ? '' : 'is-empty'}`}>{studentId || 'Not set'}</span>
          </span>
          <span className="profile-caret" aria-hidden="true">▾</span>
        </button>
        {profileOpen && <div className="profile-menu" role="dialog" aria-label="Student account">
          <div className="profile-head">
            <span className="profile-avatar" aria-hidden="true"><UserIcon size={18} /></span>
            <div className="profile-identity"><strong>Student account</strong><span className="profile-sub">Used to identify your applications.</span></div>
          </div>
          <form className="profile-body" onSubmit={saveProfile}>
            <span className="profile-label">Birth registration number</span>
            <div className="profile-number">
              <input value={studentId} onChange={e => saveStudentId(e.target.value)} placeholder="17-digit number" maxLength={17} inputMode="numeric" aria-label="Birth registration number" aria-invalid={!validStudentId} aria-describedby={validStudentId ? undefined : 'profile-reg-help'} />
              {validStudentId && <span className="profile-number-ok" aria-hidden="true"><CheckIcon size={12} /></span>}
            </div>
            {!validStudentId && <p id="profile-reg-help" className={`profile-hint ${studentId ? 'warn' : ''}`}>Birth registration number must be exactly 17 digits{studentId ? ` (${studentId.length}/17)` : ''}.</p>}
            <p className="profile-hint">Used for your applications and shown in the top bar.</p>
            <button type="submit" className="profile-save" disabled={!validStudentId}>Save</button>
          </form>
        </div>}
      </div>}
    </header>
    <div className="app-body" style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}>
    <aside className="sidebar">
      <nav className="nav-tabs" aria-label="Primary navigation">
        <a className={tab === 'classes' ? 'active' : ''} href="#classes" onClick={e => { e.preventDefault(); switchTab('classes'); }}><span className="nav-icon" aria-hidden="true">☷</span><span className="nav-text"><span className="nav-title">Class list</span><span className="nav-sub">Browse available shifts</span></span></a>
        <a className={tab === 'applications' ? 'active' : ''} href="#applications" onClick={e => { e.preventDefault(); switchTab('applications'); }}><span className="nav-icon" aria-hidden="true">▣</span><span className="nav-text"><span className="nav-title">Application</span><span className="nav-sub">Check your admission status</span></span></a>
        <div className={`nav-group ${adminMenuOpen ? 'open' : ''}`}>
          <a className={tab === 'admin' ? 'active' : ''} href="#admin" aria-expanded={adminMenuOpen} onClick={e => { e.preventDefault(); setAdminMenuOpen(open => !open); }}><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-text"><span className="nav-title">Admin</span><span className="nav-sub">{adminView === 'create' ? 'Add New Class' : adminView === 'list' ? 'Manage Classes' : 'Verify Payments'}</span></span>{pendingPayments.length > 0 && <b>{pendingPayments.length}</b>}<span className="nav-caret" aria-hidden="true">▾</span></a>
          {adminMenuOpen && <div className="nav-dropdown"><button type="button" className={adminView === 'create' ? 'active' : ''} onClick={() => { setAdminView('create'); switchTab('admin'); setAdminMenuOpen(false); }}>Add New Class</button><button type="button" className={adminView === 'list' ? 'active' : ''} onClick={() => { setAdminView('list'); switchTab('admin'); setAdminMenuOpen(false); }}>Manage Classes</button><button type="button" className={adminView === 'payments' ? 'active' : ''} onClick={() => { setAdminView('payments'); switchTab('admin'); setAdminMenuOpen(false); }}>Verify Payments{pendingPayments.length > 0 ? ` (${pendingPayments.length})` : ''}</button></div>}
        </div>
      </nav>
      <div className="sidebar-note"><strong>Seat holds expire quickly.</strong><span>Pay the admission fee before the timer runs out.</span></div>
    </aside>
    <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={SIDEBAR_MIN} aria-valuemax={SIDEBAR_MAX} aria-valuenow={sidebarWidth} tabIndex={0} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={endResize} onPointerCancel={endResize} onDoubleClick={() => setSidebarWidth(SIDEBAR_DEFAULT)} onKeyDown={resizeByKey} title="Drag to resize the sidebar (double-click to reset)" />
    <div className="main-area">
    <main className={tab === 'admin' ? 'main-flush' : undefined}>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
      {tab === 'classes' && <>
        <section className="intro-card" id="classes"><div><h2>Class List</h2><p>Choose a class and shift to start your admission application.</p></div><div className="info-note">● <span>After applying, pay the admission fee before the seat hold expires</span></div></section>
        <section className="table-card" aria-label="Available classes"><div className="table-scroll"><table className="classes-table"><thead><tr><th>Class name</th><th>Shift</th><th>Total seats</th><th>Available seats</th><th>Admission status</th><th>Action</th></tr></thead><tbody>{classes.length ? classes.map(c => { const parts = parseFullName(c.name); const status = c.availableSeats > 0 ? 'Open' : 'Full'; return <tr key={c.id}><th scope="row">{parts.className}</th><td><span className="shift-pill">{parts.shift}</span></td><td>{c.totalSeats}</td><td><span className={`available-pill ${c.availableSeats ? '' : 'empty-pill'}`}>{c.availableSeats}</span></td><td><span className={`badge ${status.toLowerCase()}`}>{status}</span></td><td><button className="apply-button" disabled={!c.availableSeats} onClick={() => openEnroll(c)}>{c.availableSeats ? 'Enroll' : 'Full'}</button></td></tr>; }) : <tr><td colSpan={6} className="empty">No classes have been created yet.</td></tr>}</tbody></table></div></section>
      </>}
      {tab === 'applications' && <div className="content-card tab-card" id="applications"><p className="eyebrow">STUDENT VIEW</p><h2>Application</h2><p>Enter your 17-digit Student Birth Registration Number to check your admission application.</p><form className="search-form" onSubmit={e => { e.preventDefault(); searchApplication(); }}><input aria-label="Birth registration number" value={applicationSearch} onChange={e => setApplicationSearch(e.target.value.replace(/\D/g, '').slice(0, 17))} placeholder="Enter 17-digit Birth Registration Number" inputMode="numeric" maxLength={17} /><button type="submit">Search</button></form>{searchError && <div className="alert error">{searchError}</div>}{application && <div className="application-detail"><div className="application-detail-head"><div><span className="eyebrow">APPLICATION {application.applicationReference}</span><h3>{application.studentName}</h3></div><span className="badge waiting">{application.applicationStatus}</span></div><div className="detail-grid"><div><span>Birth registration number</span><strong>{application.birthRegistrationNumber.slice(0, 5)}••••••••••••</strong></div><div><span>Applied class</span><strong>{application.className}</strong></div><div><span>Shift</span><strong>{application.shift}</strong></div><div><span>Submitted</span><strong>{new Date(application.createdAt).toLocaleString()}</strong></div><div><span>Payment status</span><strong>{application.paymentStatus}</strong></div>{application.paymentMethod && <div><span>Payment method</span><strong>{application.paymentMethod}</strong></div>}{application.transactionId && <div><span>Transaction ID</span><strong>{application.transactionId}</strong></div>}<div><span>Seat hold expiry</span><strong>{application.seatHoldExpiry ? new Date(application.seatHoldExpiry).toLocaleString() : '—'}</strong></div></div>{application.paymentStatus === 'Unpaid' && <button onClick={() => openPay({ holdId: application.holdId, studentId: application.birthRegistrationNumber, classId: application.classId, className: `${application.className} - ${application.shift} Shift`, status: 'HELD', expiresAt: application.seatHoldExpiry || '' })}>Pay Admission Fee</button>}</div>}</div>}
      {tab === 'admin' && <div className="content-card tab-card" id="admin">
        <div className="admin-head">
          <div><p className="eyebrow">SCHOOL ADMIN</p><h2>{adminView === 'create' ? 'Add New Class' : adminView === 'list' ? 'Manage Classes' : 'Verify Payments'}</h2></div>
        </div>
        {adminView === 'create' ? <>
          <h3>{editingId ? 'Edit class' : 'Create a class'}</h3>
          <p className="muted">Set a separate seat capacity for each class and shift.</p>
          <form onSubmit={saveClass}>
            <label>Class name<input required value={className} onChange={e => setClassName(e.target.value)} placeholder="e.g., Class 6" /></label>
            <label>Shift name<select value={shift} onChange={e => setShift(e.target.value)}><option value="Morning">Morning</option><option value="Day">Day</option><option value="Evening">Evening</option></select></label>
            <label>Total seats<input required min="1" type="number" value={seats} onChange={e => setSeats(e.target.value)} placeholder="e.g., 120" /></label>
            <div className="form-actions"><button>{editingId ? 'Save changes' : 'Create class'}</button>{editingId && <button type="button" className="secondary" onClick={cancelEdit}>Cancel</button>}</div>
          </form>
        </> : adminView === 'list' ? <>
          <h3>Class</h3>
          <div className="admin-scroll"><table className="admin-classes-table"><colgroup><col className="col-class" /><col className="col-shift" /><col className="col-seats" /><col className="col-seats" /><col className="col-action" /></colgroup><thead><tr><th>Class name</th><th>Shift</th><th>Total seats</th><th>Available seats</th><th>Actions</th></tr></thead><tbody>{classes.length ? classes.map(c => { const parts = parseFullName(c.name); return <tr key={c.id} className={c.id === highlightId ? 'row-highlight' : undefined}><th scope="row"><button type="button" className="class-name-button" onClick={() => openStudents(c)}>{parts.className}</button></th><td><span className="shift-pill">{parts.shift}</span></td><td>{c.totalSeats}</td><td><span className={`available-pill ${c.availableSeats ? '' : 'empty-pill'}`}>{c.availableSeats}</span></td><td><div className="manage-actions admin-actions"><button type="button" className="secondary" onClick={() => startEdit(c)}>Edit</button><button type="button" className="danger" onClick={() => askDelete(c)}>Delete</button></div></td></tr>; }) : <tr><td colSpan={5} className="empty">No classes yet.</td></tr>}</tbody></table></div>
        </> : <>
          <h3>Payments awaiting verification</h3>
          <p className="muted">Check the transaction ID with the payment provider, then approve the admission or reject the payment.</p>
          {paymentsError && <div className="alert error enroll-error">{paymentsError}</div>}
          {paymentsLoading && pendingPayments.length === 0 ? <p className="empty">Loading payments...</p> : <div className="admin-scroll payments-scroll"><table className="payments-table"><thead><tr><th>Class</th><th>Student</th><th>Registration no.</th><th>Contact</th><th>Method</th><th>Transaction ID</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>{pendingPayments.length === 0 ? <tr><td colSpan={8} className="empty">No payments are waiting for verification.</td></tr> : pendingPayments.map(p => <tr key={p.holdId}><td>{p.className}</td><td><strong>{p.studentName || '—'}</strong></td><td>{p.studentId}</td><td>{p.contactInfo || '—'}</td><td>{p.paymentMethod || '—'}</td><td><code>{p.transactionId || '—'}</code></td><td>{p.paymentSubmittedAt ? new Date(p.paymentSubmittedAt).toLocaleString() : '—'}</td><td><div className="review-actions"><button type="button" className="approve-button" disabled={reviewingId === p.holdId} onClick={() => reviewPayment(p, 'approve')}>Approve</button><button type="button" className="danger" disabled={reviewingId === p.holdId} onClick={() => reviewPayment(p, 'reject')}>Reject</button></div></td></tr>)}</tbody></table></div>}
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
        <p>Enter the required details to hold a seat, then submit the payment details for admin verification.</p>
        {enrollError && <div className="alert error enroll-error">{enrollError}</div>}
        <form className="enroll-form" onSubmit={submitEnroll}>
          <label>Student birth registration number <span className="required-mark" aria-hidden="true">*</span><input value={enrollForm.reg} onChange={e => setEnrollForm(f => ({ ...f, reg: e.target.value.replace(/\D/g, '') }))} placeholder="Enter exactly 17 digits" maxLength={17} inputMode="numeric" required /></label>
          <label>Student name <span className="required-mark" aria-hidden="true">*</span><input value={enrollForm.name} onChange={e => setEnrollForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g., Ayesha Rahman" required /></label>
          <label>Contact information <span className="required-mark" aria-hidden="true">*</span><input value={enrollForm.contact} onChange={e => setEnrollForm(f => ({ ...f, contact: e.target.value.replace(/\D/g, '').slice(0, 11) }))} placeholder="e.g., 01712345678" maxLength={11} inputMode="numeric" pattern="[0-9]{11}" title="Contact number must be exactly 11 digits" required /></label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={closeEnroll} disabled={enrolling}>Cancel</button>
            <button type="submit" disabled={enrolling}>{enrolling ? 'Submitting...' : 'Submit application'}</button>
          </div>
        </form>
      </div>
    </div>}
    {payHold && <div className="modal-overlay" role="presentation" onClick={closePay}>
      <div className="modal pay-modal" role="dialog" aria-modal="true" aria-labelledby="pay-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={closePay}>×</button>
        <div className="modal-icon pay-icon" aria-hidden="true">💳</div>
        <h3 id="pay-title">Pay admission fee</h3>
        <p>{payHold.className || 'Selected class'} — submit your payment details. An admin will verify the transaction ID before your seat is confirmed.</p>
        {payError && <div className="alert error enroll-error">{payError}</div>}
        <form className="enroll-form" onSubmit={submitPayment}>
          <fieldset className="pay-methods">
            <legend>Payment method</legend>
            {(['Banking', 'Mobile banking', 'Offline'] as const).map(m => <label key={m} className={`pay-method ${paymentMethod === m ? 'active' : ''}`}><input type="radio" name="paymentMethod" value={m} checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} /><span>{m}</span></label>)}
          </fieldset>
          <label>Transaction ID<input value={transactionId} onChange={e => setTransactionId(e.target.value)} placeholder="e.g., TRX-2026-000123" required /></label>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={closePay} disabled={paying}>Cancel</button>
            <button type="submit" disabled={paying}>{paying ? 'Submitting...' : 'Submit for verification'}</button>
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
        {studentsLoading ? <p className="empty">Loading students...</p> : students.length === 0 ? <p className="empty">No students have enrolled in this class yet.</p> : <div className="students-scroll"><table className="students-table"><thead><tr><th>Student name</th><th>Registration no.</th><th>Contact</th><th>Status</th><th>Payment</th></tr></thead><tbody>{students.map(s => <tr key={s.holdId}><td><strong>{s.studentName || '—'}</strong></td><td>{s.studentId}</td><td>{s.contactInfo || '—'}</td><td><span className={`badge ${s.status.toLowerCase()}`}>{s.status}</span></td><td>{s.paymentMethod ? <><strong>{s.paymentMethod}</strong><br /><small>{s.transactionId || '—'}</small></> : <span className="muted">Not paid</span>}</td></tr>)}</tbody></table></div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={closeStudents}>Close</button></div>
      </div>
    </div>}
    {pendingDelete && <div className="modal-overlay" role="presentation" onClick={() => setPendingDelete(null)}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={e => e.stopPropagation()}><button type="button" className="modal-close" aria-label="Close" onClick={() => setPendingDelete(null)}>×</button><div className="modal-icon" aria-hidden="true">🗑</div><h3 id="delete-title">Delete class?</h3><p>Are you sure you want to delete <strong>{pendingDelete.name}</strong>? This also removes all applications for this class.</p><div className="modal-actions"><button type="button" className="secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button type="button" className="danger" onClick={deleteClass}>Delete class</button></div></div></div>}
  </div>;
}
