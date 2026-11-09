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

    expect(await screen.findByText('Class 6 - Morning Shift')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /apply/i })).toBeEnabled();
  });

  it('disables the apply button when no seats are available', async () => {
    stubFetch(url => json(url.endsWith('/classes') ? [{ ...sampleClass, availableSeats: 0 }] : []));
    render(<App />);

    const button = await screen.findByRole('button', { name: /no seats available/i });
    expect(button).toBeDisabled();
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
    fireEvent.change(screen.getByLabelText(/class and shift name/i), { target: { value: sampleClass.name } });
    fireEvent.change(screen.getByLabelText(/total seats/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /create class/i }));

    expect(await screen.findByText('Class created.')).toBeInTheDocument();
    expect(calls.some(c => c.method === 'POST' && c.body?.includes('Class 6 - Morning Shift'))).toBe(true);
  });
});
