import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';

function json(body: unknown, status = 200): Promise<Response> {
  const response = { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
  return Promise.resolve(response as unknown as Response);
}

function stubFetch(handler: (url: string) => Promise<Response>) {
  return vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => handler(String(input))));
}

const sampleClass = { id: 'c1', name: 'Class 6 - Morning Shift', totalSeats: 120, heldSeats: 15, confirmedSeats: 80, availableSeats: 25 };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('App', () => {
  it('lists classes with total, held, confirmed and available seats', async () => {
    stubFetch(url => json(url.endsWith('/classes') ? [sampleClass] : []));
    render(<App />);

    expect(await screen.findByText('Class 6')).toBeInTheDocument();
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enroll/i })).toBeEnabled();
  });

  it('resizes the sidebar with the keyboard and remembers the width', async () => {
    stubFetch(url => json(url.endsWith('/classes') ? [sampleClass] : []));
    render(<App />);

    const separator = screen.getByRole('separator', { name: /resize sidebar/i });
    expect(separator).toHaveAttribute('aria-valuenow', '310');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '326');
    expect(localStorage.getItem('sidebarWidth')).toBe('326');
  });

  it('shows student details in the profile menu and hides them on admin pages', async () => {
    localStorage.setItem('studentId', '20152691234567890');
    stubFetch(url => json(url.endsWith('/classes') ? [sampleClass] : []));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /student account/i }));
    expect(screen.getByLabelText(/birth registration number/i)).toHaveValue('20152691234567890');
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy registration number/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('link', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Class' }));
    expect(screen.queryByRole('button', { name: /student account/i })).not.toBeInTheDocument();
  });

  it('copies the registration number from the profile menu', async () => {
    localStorage.setItem('studentId', '20152691234567890');
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    stubFetch(url => json(url.endsWith('/classes') ? [sampleClass] : []));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /student account/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy registration number/i }));

    expect(writeText).toHaveBeenCalledWith('20152691234567890');
  });

  it('shows the 17-digit requirement until the registration number is valid', async () => {
    stubFetch(url => json(url.endsWith('/classes') ? [sampleClass] : []));
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /student account/i }));
    const field = screen.getByLabelText(/birth registration number/i);

    fireEvent.change(field, { target: { value: '12345' } });
    expect(screen.getByText(/must be exactly 17 digits \(5\/17\)/i)).toBeInTheDocument();
    expect(screen.getByText('Not verified')).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '20152691234567890' } });
    expect(screen.getByText('Registration number verified.')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('disables the apply button when no seats are available', async () => {
    stubFetch(url => json(url.endsWith('/classes') ? [{ ...sampleClass, availableSeats: 0 }] : []));
    render(<App />);

    const button = await screen.findByRole('button', { name: /no seats available/i });
    expect(button).toBeDisabled();
  });

  it('opens the enrollment form and holds the seat without confirming', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push(`${method} ${url}`);
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/me/holds')) return json([]);
      if (url.endsWith('/holds') && method === 'POST') return json({ holdId: 'h1' }, 201);
      return json({});
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /enroll/i }));
    expect(screen.getByRole('heading', { name: /enroll in class 6/i })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^registration number$/i), { target: { value: '20152691234567890' } });
    fireEvent.change(screen.getByLabelText(/^student name$/i), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByLabelText(/father's name/i), { target: { value: 'Abdul Rahman' } });
    fireEvent.change(screen.getByLabelText(/mother's name/i), { target: { value: 'Fatima Begum' } });
    fireEvent.change(screen.getByLabelText(/contact information/i), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByRole('button', { name: /enroll & pay/i }));

    expect(await screen.findByText(/seat held/i)).toBeInTheDocument();
    expect(calls.some(c => c.includes('/confirm'))).toBe(false);
  });

  it('submits payment details for admin verification after a transaction ID is provided', async () => {
    localStorage.setItem('studentId', '20152691234567890');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push(`${method} ${url}`);
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/me/holds')) return json([{ holdId: 'h1', classId: 'c1', className: 'Class 6 - Morning Shift', status: 'HELD', expiresAt: new Date(Date.now() + 120000).toISOString() }]);
      return json({});
    }));
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /my applications/i }));
    fireEvent.click(await screen.findByRole('button', { name: /pay admission fee/i }));
    expect(screen.getByRole('heading', { name: /pay admission fee/i })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/mobile banking/i));
    fireEvent.change(screen.getByLabelText(/transaction id/i), { target: { value: 'TRX-2026-000123' } });
    fireEvent.click(screen.getByRole('button', { name: /submit for verification/i }));

    expect(await screen.findByText(/payment details submitted via mobile banking/i)).toBeInTheDocument();
    expect(screen.getByText(/admin will verify/i)).toBeInTheDocument();
    expect(calls.some(c => c.includes('/confirm'))).toBe(true);
  });

  it('shows PENDING and hides payment actions while the admin verifies', async () => {
    localStorage.setItem('studentId', '20152691234567890');
    stubFetch(url => {
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/me/holds')) return json([{ holdId: 'h1', classId: 'c1', className: 'Class 6 - Morning Shift', status: 'PENDING', transactionId: 'TRX-2026-000123', expiresAt: new Date(Date.now() + 120000).toISOString() }]);
      return json([]);
    });
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /my applications/i }));
    expect(await screen.findByText('PENDING')).toBeInTheDocument();
    expect(screen.getByText(/waiting for admin approval/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pay admission fee/i })).not.toBeInTheDocument();
  });

  it('lets the admin approve a payment after checking the transaction ID', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      calls.push(`${method} ${url}`);
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/me/holds')) return json([]);
      if (url.endsWith('/admin/payments/pending')) return json([{ holdId: 'h1', classId: 'c1', className: 'Class 6 - Morning Shift', studentId: '20152691234567890', studentName: 'Ayesha Rahman', contactInfo: '01712345678', paymentMethod: 'Mobile banking', transactionId: 'TRX-2026-000123', paymentSubmittedAt: new Date().toISOString(), createdAt: new Date().toISOString() }]);
      return json({ status: 'CONFIRMED' });
    }));
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: /^payments/i }));
    expect(await screen.findByText('Ayesha Rahman')).toBeInTheDocument();
    expect(screen.getByText('TRX-2026-000123')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));

    expect(await screen.findByText(/payment approved/i)).toBeInTheDocument();
    expect(calls.some(c => c === 'POST /holds/h1/approve')).toBe(true);
  });

  it('shows EXPIRED with a disabled pay button for an expired hold, without reload', async () => {
    localStorage.setItem('studentId', '20152691234567890');
    stubFetch(url => {
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/me/holds')) return json([{ holdId: 'h1', classId: 'c1', className: 'Class 6 - Morning Shift', status: 'HELD', expiresAt: new Date(Date.now() - 1000).toISOString() }]);
      return json({});
    });
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /my applications/i }));
    expect(await screen.findByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay admission fee/i })).toBeDisabled();
  });

  it('shows enrolled students with their information when an admin clicks a class name', async () => {
    stubFetch(url => {
      if (url.endsWith('/classes')) return json([sampleClass]);
      if (url.endsWith('/classes/c1/holds')) return json([{ holdId: 'h1', studentId: '20152691234567890', studentName: 'Ayesha Rahman', fatherName: 'Abdul Rahman', motherName: 'Fatima Begum', contactInfo: '01712345678', status: 'CONFIRMED', paymentMethod: 'Mobile banking', transactionId: 'TX-MOBILE-1', createdAt: new Date().toISOString(), expiresAt: new Date().toISOString() }]);
      return json([]);
    });
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /admin/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Class' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Class 6' }));

    expect(await screen.findByText('Ayesha Rahman')).toBeInTheDocument();
    expect(screen.getByText('20152691234567890')).toBeInTheDocument();
    expect(screen.getByText('Abdul Rahman')).toBeInTheDocument();
    expect(screen.getByText('Fatima Begum')).toBeInTheDocument();
    expect(screen.getByText('01712345678')).toBeInTheDocument();
    expect(screen.getByText('TX-MOBILE-1')).toBeInTheDocument();
  });

  it('shows a user-friendly message when the server is unreachable', async () => {
    stubFetch(() => Promise.reject(new Error('network down')));
    render(<App />);

    expect(await screen.findByText(/could not reach the server/i)).toBeInTheDocument();
  });

  it('lets the admin create a class from the School Admin tab', async () => {
    let classes: unknown[] = [];
    const calls: Array<{ method: string; body?: string }> = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method || 'GET';
      calls.push({ method, body: init?.body as string | undefined });
      if (String(input).endsWith('/classes') && method === 'POST') {
        classes = [...classes, sampleClass];
        return json({ id: 'c1', name: sampleClass.name, totalSeats: sampleClass.totalSeats }, 201);
      }
      return json(classes);
    }));
    render(<App />);

    fireEvent.click(screen.getByRole('link', { name: /create class/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));
    fireEvent.change(screen.getByLabelText(/class name/i), { target: { value: 'Class 6' } });
    fireEvent.change(screen.getByLabelText(/shift name/i), { target: { value: 'Morning' } });
    fireEvent.change(screen.getByLabelText(/total seats/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create class' }));

    expect(await screen.findByText('Class created.')).toBeInTheDocument();
    expect(calls.some(c => c.method === 'POST' && c.body?.includes('Class 6 - Morning Shift'))).toBe(true);
  });
});
