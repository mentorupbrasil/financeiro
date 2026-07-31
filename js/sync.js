import { API_BASE } from './config.js';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

export async function loginRemote(pin) {
  const { response, body } = await request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ pin }),
  });
  if (!response.ok) throw new Error(body.error || 'Falha no login.');
  return body;
}

export async function logoutRemote() {
  await request('/api/logout', { method: 'POST', body: '{}' });
}

export async function checkSession() {
  const { response, body } = await request('/api/session', { method: 'GET' });
  return response.ok && body.ok;
}

export async function fetchRemoteState() {
  const { response, body } = await request('/api/state', { method: 'GET' });
  if (response.status === 401) throw new Error('Sessão inválida.');
  if (!response.ok) throw new Error(body.error || `Falha ao ler nuvem (${response.status})`);
  return body;
}

export async function pushRemoteState(state, expectedRevision) {
  const { response, body } = await request('/api/state', {
    method: 'PUT',
    body: JSON.stringify({ state, expectedRevision }),
  });
  if (response.status === 401) throw new Error('Sessão inválida.');
  if (response.status === 409) {
    const error = new Error(body.error || 'Conflito de revisão.');
    error.code = 409;
    error.payload = body;
    throw error;
  }
  if (!response.ok) throw new Error(body.error || `Falha ao salvar na nuvem (${response.status})`);
  return body;
}
