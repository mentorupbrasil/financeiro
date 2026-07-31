export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function brl(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

export function formatMoneyMask(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  return brl(amount);
}

export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Math.round(Number(digits)) / 100;
}

export function applyMoneyMask(input) {
  if (!input) return;
  const digits = String(input.value || '').replace(/\D/g, '').slice(0, 12);
  const cents = Number(digits || '0');
  input.value = brl(cents / 100);
}

export function moneyInput(name, value = '', { required = false, placeholder = 'R$ 0,00' } = {}) {
  const shown = value === '' || value == null ? '' : formatMoneyMask(value);
  return `<input class="money-input input" name="${escapeHtml(name)}" type="text" inputmode="numeric" autocomplete="off" data-money="1" ${required ? 'required' : ''} placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(shown)}" />`;
}

export function number(value, digits = 0) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value) || 0);
}

export function statusPill(status) {
  const map = {
    pending: ['warning', 'Pendente'],
    paid: ['success', 'Pago'],
    partial: ['info', 'Parcial'],
    overdue: ['danger', 'Atrasado'],
    cancelled: ['neutral', 'Cancelado'],
    renegotiated: ['neutral', 'Renegociado'],
    Pendente: ['warning', 'Pendente'],
    Pago: ['success', 'Pago'],
  };
  const [type, label] = map[status] || ['neutral', status || '—'];
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

export function metric(label, value, tone = '') {
  return `<article class="card metric-card"><div class="metric-top"><span class="metric-label">${escapeHtml(label)}</span></div><strong class="metric-value ${tone}">${brl(value)}</strong></article>`;
}
