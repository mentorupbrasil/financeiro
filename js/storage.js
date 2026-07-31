const META_KEY = 'respira:vault-meta';
const DATA_KEY = 'respira:vault-data';
const BACKUP_FORMAT = 'respira-encrypted-backup';
const IMPORT_FORMAT = 'respira-private-import';
let sessionKey = null;
let sessionPin = null;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(pin, salt) {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptWithKey(state, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = encoder.encode(JSON.stringify(state));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { iv: bytesToBase64(iv), ciphertext: bytesToBase64(new Uint8Array(encrypted)) };
}

async function decryptWithKey(payload, key) {
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.ciphertext),
  );
  return JSON.parse(decoder.decode(decrypted));
}

export function hasVault() {
  return Boolean(localStorage.getItem(META_KEY) && localStorage.getItem(DATA_KEY));
}

export async function createVault(pin, state) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pin, salt);
  const payload = await encryptWithKey(state, key);
  localStorage.setItem(META_KEY, JSON.stringify({ version: 1, salt: bytesToBase64(salt), createdAt: new Date().toISOString() }));
  localStorage.setItem(DATA_KEY, JSON.stringify(payload));
  sessionKey = key;
  sessionPin = pin;
}

export async function unlockVault(pin) {
  const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
  const payload = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
  if (!meta || !payload) throw new Error('Cofre local não encontrado.');
  const key = await deriveKey(pin, base64ToBytes(meta.salt));
  const state = await decryptWithKey(payload, key);
  sessionKey = key;
  sessionPin = pin;
  return state;
}

export async function saveVault(state) {
  if (!sessionKey) throw new Error('O cofre está bloqueado.');
  const payload = await encryptWithKey(state, sessionKey);
  localStorage.setItem(DATA_KEY, JSON.stringify(payload));
}

export function lockVault() {
  sessionKey = null;
  sessionPin = null;
}

export function wipeVault() {
  lockVault();
  localStorage.removeItem(META_KEY);
  localStorage.removeItem(DATA_KEY);
}

export function downloadEncryptedBackup() {
  const meta = JSON.parse(localStorage.getItem(META_KEY) || 'null');
  const payload = JSON.parse(localStorage.getItem(DATA_KEY) || 'null');
  if (!meta || !payload) throw new Error('Nenhum cofre para exportar.');
  const backup = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    meta,
    payload,
  };
  downloadJson(backup, `respira-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

export function downloadPlainPrivateImport(state) {
  downloadJson({ format: IMPORT_FORMAT, version: 1, state }, `respira-dados-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function parseImportFile(file) {
  const content = await file.text();
  const parsed = JSON.parse(content);
  if (parsed?.format === BACKUP_FORMAT && parsed.meta && parsed.payload) {
    return { type: 'encrypted-backup', value: parsed };
  }
  if (parsed?.format === IMPORT_FORMAT && parsed.state) {
    return { type: 'private-import', value: parsed.state };
  }
  if (parsed?.state && typeof parsed.state === 'object') {
    return { type: 'private-import', value: parsed.state };
  }
  if (parsed?.months && parsed?.settings) {
    return { type: 'private-import', value: parsed };
  }
  throw new Error('Arquivo incompatível com o Respira.');
}

export function restoreEncryptedBackup(backup) {
  localStorage.setItem(META_KEY, JSON.stringify(backup.meta));
  localStorage.setItem(DATA_KEY, JSON.stringify(backup.payload));
  lockVault();
}

export async function changePin(state, oldPin, newPin) {
  if (!sessionPin || oldPin !== sessionPin) throw new Error('O PIN atual está incorreto.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(newPin, salt);
  const payload = await encryptWithKey(state, key);
  localStorage.setItem(META_KEY, JSON.stringify({ version: 1, salt: bytesToBase64(salt), changedAt: new Date().toISOString() }));
  localStorage.setItem(DATA_KEY, JSON.stringify(payload));
  sessionKey = key;
  sessionPin = newPin;
}

function downloadJson(value, filename) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
