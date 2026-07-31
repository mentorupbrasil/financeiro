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
