import { APP_PIN, API_BASE } from './config.js';

function headers(pin = APP_PIN) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${pin}`,
    'X-App-Pin': pin,
  };
}

export async function fetchRemoteState(pin = APP_PIN) {
  const response = await fetch(`${API_BASE}/api/state`, {
    method: 'GET',
    headers: headers(pin),
    cache: 'no-store',
  });
  if (response.status === 401) throw new Error('PIN inválido no servidor.');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Falha ao ler nuvem (${response.status})`);
  }
  return response.json();
}

export async function pushRemoteState(state, pin = APP_PIN) {
  const response = await fetch(`${API_BASE}/api/state`, {
    method: 'PUT',
    headers: headers(pin),
    body: JSON.stringify({ state }),
  });
  if (response.status === 401) throw new Error('PIN inválido no servidor.');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Falha ao salvar na nuvem (${response.status})`);
  }
  return response.json();
}

export async function pingApi() {
  try {
    const response = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
    return response.ok;
  } catch {
    return false;
  }
}
