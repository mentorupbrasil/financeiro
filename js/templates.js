export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function brl(value, compact = false) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 2,
  }).format(Number(value) || 0);
}

export function number(value, digits = 0) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value) || 0);
}

export function percent(value) {
  return `${number(value, 1)}%`;
}

export function statusPill(status) {
  const normalized = String(status || '').toUpperCase();
  const map = {
    ATACAR: ['warning', 'Atacar'],
    JUROS: ['danger', 'Juros'],
    CONGELADA: ['info', 'Congelada'],
    QUITADA: ['success', 'Quitada'],
    RESPIRA: ['success', 'Respira'],
    APERTADO: ['warning', 'Apertado'],
    DÉFICIT: ['danger', 'Déficit'],
    PAGO: ['success', 'Pago'],
    PENDENTE: ['neutral', 'Pendente'],
    RECEBIDO: ['success', 'Recebido'],
  };
  const [type, label] = map[normalized] || ['neutral', normalized || '—'];
  return `<span class="pill pill--${type}">${escapeHtml(label)}</span>`;
}

export function emptyState(icon, title, copy, buttonLabel = '', action = '') {
  return `<div class="empty-state">
    <div class="empty-icon" aria-hidden="true">${icon}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(copy)}</p>
    ${buttonLabel ? `<button class="button button--primary" type="button" data-action="${escapeHtml(action)}">${escapeHtml(buttonLabel)}</button>` : ''}
  </div>`;
}

export function formatDueDay(day) {
  const value = Number(day) || 0;
  return value ? `Dia ${value}` : 'Sem vencimento';
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}
