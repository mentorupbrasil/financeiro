import {
  COMMITMENT_TYPES,
  ENTRY_TYPES,
  PAY_STATUS,
  TYPE_LABEL,
  addMonths,
  advanceInstallmentCommitment,
  createEmptyState,
  currentMonthKey,
  deleteEntryScope,
  deleteCommitmentScope,
  ensureMonth,
  formatDateBR,
  history,
  installmentMeta,
  listCommitments,
  markPaid,
  monthEntries,
  monthLabel,
  normalizeState,
  overview,
  projection,
  registerPayment,
  undoPayment,
  makeId,
  toISODate,
  dueDateInMonth,
} from './model.js';
import { APP_PIN } from './config.js';
import { fetchRemoteState, pushRemoteState } from './sync.js';
import {
  createVault,
  downloadEncryptedBackup,
  hasVault,
  lockVault,
  parseImportFile,
  restoreEncryptedBackup,
  saveVault,
  unlockVault,
  wipeVault,
} from './storage.js';
import { brl, emptyState, escapeHtml, metric, statusPill } from './templates.js';

const SESSION_FLAG = 'respira:session-open';
const views = {
  overview: ['HOJE', 'Visão geral'],
  month: ['MÊS', 'Mês atual'],
  commitments: ['FIXOS', 'Compromissos'],
  history: ['PASSADO', 'Histórico'],
  settings: ['SISTEMA', 'Configurações'],
};

const refs = {
  boot: document.querySelector('#boot-screen'),
  lock: document.querySelector('#lock-screen'),
  unlockForm: document.querySelector('#unlock-form'),
  unlockPin: document.querySelector('#unlock-pin'),
  unlockError: document.querySelector('#unlock-error'),
  app: document.querySelector('#app'),
  viewRoot: document.querySelector('#view-root'),
  viewTitle: document.querySelector('#view-title'),
  viewEyebrow: document.querySelector('#view-eyebrow'),
  monthLabelBtn: document.querySelector('#month-label'),
  monthPrev: document.querySelector('#month-prev'),
  monthNext: document.querySelector('#month-next'),
  monthToday: document.querySelector('#month-today'),
  entityDialog: document.querySelector('#entity-dialog'),
  entityForm: document.querySelector('#entity-form'),
  dialogEyebrow: document.querySelector('#dialog-eyebrow'),
  dialogTitle: document.querySelector('#dialog-title'),
  dialogFields: document.querySelector('#dialog-fields'),
  dialogError: document.querySelector('#dialog-error'),
  dialogSubmit: document.querySelector('#dialog-submit'),
  confirmDialog: document.querySelector('#confirm-dialog'),
  confirmTitle: document.querySelector('#confirm-title'),
  confirmCopy: document.querySelector('#confirm-copy'),
  confirmAction: document.querySelector('#confirm-action'),
  importFile: document.querySelector('#import-file'),
  installApp: document.querySelector('#install-app'),
  toastRegion: document.querySelector('#toast-region'),
  syncDot: document.querySelector('#sync-dot'),
  syncLabel: document.querySelector('#sync-label'),
};

let state = null;
let currentView = 'overview';
let monthFilter = 'all';
let dialogContext = null;
let installPrompt = null;
let idleTimer = null;
let saving = false;
let cloudOnline = false;

init();

async function init() {
  bindEvents();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch {}
  }
  refs.boot.classList.add('hidden');
  if (refs.unlockPin) refs.unlockPin.value = APP_PIN;
  if (sessionStorage.getItem(SESSION_FLAG) === '1') {
    try {
      await openWithPin(APP_PIN, { quiet: true });
      return;
    } catch {
      sessionStorage.removeItem(SESSION_FLAG);
    }
  }
  showLock();
}

function bindEvents() {
  refs.unlockForm.addEventListener('submit', handleUnlock);
  document.querySelector('#lock-now').addEventListener('click', () => lockApp(true));
  document.querySelector('#quick-add').addEventListener('click', openAddMenu);
  refs.monthPrev.addEventListener('click', () => shiftMonth(-1));
  refs.monthNext.addEventListener('click', () => shiftMonth(1));
  refs.monthToday.addEventListener('click', () => goToMonth(currentMonthKey()));
  refs.monthLabelBtn.addEventListener('click', () => goToMonth(currentMonthKey()));
  refs.entityForm.addEventListener('submit', handleEntitySubmit);
  refs.entityDialog.addEventListener('click', async (event) => {
    if (event.target.closest('[data-close-dialog]')) refs.entityDialog.close();
    const choice = event.target.closest('[data-create-type]');
    if (choice) {
      refs.entityDialog.close();
      setTimeout(() => openCreate(choice.dataset.createType), 60);
      return;
    }
    const del = event.target.closest('[data-action="confirm-delete"]');
    if (del) {
      event.preventDefault();
      const scope = del.dataset.scope || 'one';
      const targetId = del.dataset.id;
      const kind = del.dataset.kind || 'entry';
      refs.entityDialog.close();
      dialogContext = null;
      if (kind === 'commitment') deleteCommitmentScope(state, targetId, state.currentMonth, scope);
      else deleteEntryScope(state, targetId, state.currentMonth, scope);
      await persist('Excluído', 'Alteração gravada na nuvem.', { requireCloud: true });
    }
  });
  refs.viewRoot.addEventListener('click', handleViewClick);
  refs.viewRoot.addEventListener('submit', handleViewSubmit);
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  document.querySelectorAll('[data-nav]').forEach((anchor) => anchor.addEventListener('click', (event) => {
    event.preventDefault();
    setView(anchor.dataset.nav);
  }));
  refs.importFile.addEventListener('change', handleImportFile);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    refs.installApp.classList.remove('hidden');
  });
  refs.installApp.addEventListener('click', async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    installPrompt = null;
    refs.installApp.classList.add('hidden');
  });
  ['pointerdown', 'keydown', 'touchstart'].forEach((name) => document.addEventListener(name, resetIdleTimer, { passive: true }));
}

function showLock() {
  refs.lock.classList.remove('hidden');
  refs.app.classList.add('hidden');
  if (refs.unlockPin) refs.unlockPin.value = APP_PIN;
  hideError(refs.unlockError);
}

async function handleUnlock(event) {
  event.preventDefault();
  try {
    hideError(refs.unlockError);
    await openWithPin(refs.unlockPin.value.trim() || APP_PIN);
  } catch (error) {
    showError(refs.unlockError, error.message || 'Não foi possível entrar.');
  }
}

async function openWithPin(pin, { quiet = false } = {}) {
  if (pin !== APP_PIN) throw new Error('PIN incorreto.');
  let localState = null;
  if (hasVault()) {
    try { localState = normalizeState(await unlockVault(pin)); }
    catch { wipeVault(); localState = null; }
  }
  let remote = null;
  try {
    remote = await fetchRemoteState(pin);
    cloudOnline = true;
  } catch (error) {
    cloudOnline = false;
    setSyncStatus('error', 'Neon offline');
  }
  if (remote?.state) {
    const remoteState = normalizeState(remote.state);
    if (remote.updatedAt) remoteState.updatedAt = new Date(remote.updatedAt).toISOString();
    const remoteTime = Date.parse(remote.updatedAt || remoteState.updatedAt || 0) || 0;
    const localTime = Date.parse(localState?.updatedAt || 0) || 0;
    if (!localState || remoteTime > localTime) {
      state = remoteState;
      if (hasVault()) await saveVault(state);
      else await createVault(pin, state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    } else if (localTime > remoteTime) {
      state = localState;
      try {
        const saved = await pushRemoteState(state, pin);
        if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
        await saveVault(state);
        cloudOnline = true;
        setSyncStatus('online', 'Neon sincronizada');
      } catch {
        cloudOnline = false;
        setSyncStatus('error', 'Falha ao enviar local');
      }
    } else {
      state = localState || remoteState;
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    }
  } else if (localState) {
    state = localState;
    try {
      const saved = await pushRemoteState(state, pin);
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
      await saveVault(state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    } catch {
      cloudOnline = false;
      setSyncStatus('error', 'Neon desatualizada');
    }
  } else {
    state = createEmptyState();
    await createVault(pin, state);
    try {
      const saved = await pushRemoteState(state, pin);
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
      await saveVault(state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    } catch {
      cloudOnline = false;
      setSyncStatus('error', 'Neon desatualizada');
    }
    if (!quiet) toast('Pronto', 'Comece pelo botão Adicionar.');
  }
  sessionStorage.setItem(SESSION_FLAG, '1');
  launchApp();
}

function setSyncStatus(mode, label) {
  if (!refs.syncDot || !refs.syncLabel) return;
  refs.syncDot.classList.toggle('is-offline', mode === 'offline');
  refs.syncDot.classList.toggle('is-error', mode === 'error');
  refs.syncLabel.textContent = label;
}

function launchApp() {
  refs.lock.classList.add('hidden');
  refs.app.classList.remove('hidden');
  refs.monthLabelBtn.textContent = monthLabel(state.currentMonth, true);
  updateMonthNav();
  currentView = 'overview';
  ensureMonth(state, state.currentMonth);
  render();
  resetIdleTimer();
}

function lockApp() {
  if (!state) return;
  lockVault();
  clearTimeout(idleTimer);
  state = null;
  sessionStorage.removeItem(SESSION_FLAG);
  showLock();
}

function resetIdleTimer() {
  if (!state) return;
  clearTimeout(idleTimer);
  const minutes = Number(state.settings.lockAfterMinutes) || 0;
  if (minutes > 0) idleTimer = setTimeout(() => lockApp(), minutes * 60 * 1000);
}

function setView(view) {
  if (!views[view]) return;
  currentView = view;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function render() {
  if (!state) return;
  const [eyebrow, title] = views[currentView];
  refs.viewEyebrow.textContent = eyebrow;
  refs.viewTitle.textContent = title;
  updateMonthNav();
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));
  const map = {
    overview: renderOverview,
    month: renderMonth,
    commitments: renderCommitments,
    history: renderHistory,
    settings: renderSettings,
  };
  refs.viewRoot.innerHTML = map[currentView]();
}

function renderOverview() {
  const data = overview(state);
  const daily = data.daily;
  const proj = projection(state, state.currentMonth, 6);
  const fmtNeed = (value) => (value == null ? '—' : String(value));
  return `
    <section class="grid grid--4">
      ${metric('Dinheiro disponível', data.available, 'positive')}
      ${metric('Receitas recebidas', data.receivedTotal, 'positive')}
      ${metric('Total das contas', data.totalBills)}
      ${metric('Total pago', data.totalPaid, 'positive')}
      ${metric('Falta pagar', data.totalPending, 'negative')}
      ${metric('Atrasadas', data.overdueTotal, data.overdueCount ? 'negative' : '')}
      ${metric('Reservado', data.reserved)}
      ${metric('Sobra', data.free, data.free >= 0 ? 'positive' : 'negative')}
    </section>

    <section class="card section-gap">
      <div class="card-header"><div><h2>Diárias</h2><p>Meta do mês com base nas regras</p></div></div>
      <div class="card-body">
        ${daily.dailyNet <= 0 ? `<div class="callout callout--warning"><div class="callout-icon">!</div><div><strong>Defina o valor líquido da diária</strong><p>Vá em Configurações e informe quanto entra por diária.</p></div></div>` : `
        <div class="stat-strip">
          <div><span>Meta mensal</span><strong>${brl(daily.monthlyGoal)}</strong></div>
          <div><span>Planejadas</span><strong>${fmtNeed(daily.plannedDailies)}</strong></div>
          <div><span>Ainda faltam</span><strong>${fmtNeed(daily.missing)}</strong></div>
          <div><span>Valor da diária</span><strong>${brl(daily.dailyNet)}</strong></div>
        </div>
        <div class="list" style="margin-top:12px">
          <div class="list-item"><div class="list-main"><strong>Para pagar as contas</strong></div><div class="list-value">${fmtNeed(daily.needForBills)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para proteger a margem</strong></div><div class="list-value">${fmtNeed(daily.needForSafety)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para a meta de guardar</strong></div><div class="list-value">${fmtNeed(daily.needForSave)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para o fundo das dívidas congeladas</strong></div><div class="list-value">${fmtNeed(daily.needForFrozen)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Total necessário</strong></div><div class="list-value">${fmtNeed(daily.needForGoal)}</div></div>
        </div>`}
      </div>
    </section>

    <section class="grid grid--2 section-gap">
      <div class="card">
        <div class="card-header"><div><h2>Próximas contas</h2><p>O que ainda falta pagar</p></div></div>
        <div class="card-body">
          ${data.upcoming.length ? `<div class="list">${data.upcoming.map((item) => listRow(item)).join('')}</div>` : emptyState('✓', 'Nada pendente', 'Nenhuma conta para pagar neste mês.')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div><h2>Parcelas que terminam em breve</h2><p>Até 3 parcelas restantes</p></div></div>
        <div class="card-body">
          ${data.endingSoon.length ? `<div class="list">${data.endingSoon.map(({ commitment, meta }) => `
            <div class="list-item">
              <div class="list-main"><strong>${escapeHtml(commitment.name)}</strong><small>Parcela ${meta.current} de ${meta.total} · Faltam ${meta.remainingCount} · Termina em ${escapeHtml(monthLabel(meta.endMonth))}</small></div>
              <div class="list-value">${brl(meta.value)}</div>
            </div>`).join('')}</div>` : emptyState('◎', 'Nenhuma parcela curta', 'Quando restarem poucas parcelas, elas aparecem aqui.')}
        </div>
      </div>
    </section>

    <section class="card section-gap">
      <div class="card-header"><div><h2>Projeção</h2><p>Entradas, saídas, reserva, dívidas e o que termina</p></div></div>
      <div class="card-body">
        ${proj.lightest ? `<p class="muted" style="margin:0 0 12px">Mês mais leve: <strong>${escapeHtml(monthLabel(proj.lightest.monthKey))}</strong> · sai ${brl(proj.lightest.out)}</p>` : ''}
        <div class="table-wrap"><table class="data-table"><thead><tr>
          <th>Mês</th><th class="number">Entra</th><th class="number">Sai</th><th class="number">Reserva</th><th class="number">Dívidas</th><th class="number">Disponível</th><th class="number">Sobra</th><th>Termina</th>
        </tr></thead><tbody>
          ${proj.rows.map((row) => `<tr>
            <td>${escapeHtml(monthLabel(row.monthKey))}</td>
            <td class="number">${brl(row.income)}</td>
            <td class="number">${brl(row.out)}</td>
            <td class="number">${brl(row.toReserve)}</td>
            <td class="number">${brl(row.toDebts)}</td>
            <td class="number">${brl(row.available)}</td>
            <td class="number"><strong>${brl(row.balance)}</strong></td>
            <td>${row.ending.length ? escapeHtml(row.ending.join(', ')) : '—'}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    </section>`;
}

function renderMonth() {
  const entries = monthEntries(state, state.currentMonth, monthFilter);
  const filters = [
    ['all', 'Tudo'],
    ['pending', 'Pendente'],
    ['paid', 'Pago'],
    ['overdue', 'Atrasado'],
    ['in', 'Entradas'],
    ['out', 'Saídas'],
  ];
  return `
    <div class="filter-bar">
      ${filters.map(([id, label]) => `<button class="chip ${monthFilter === id ? 'active' : ''}" type="button" data-action="filter" data-id="${id}">${label}</button>`).join('')}
    </div>
    <section class="card section-gap">
      ${entries.length ? `<div class="list list--actions">${entries.map((item) => `
        <div class="list-item entry-row">
          <div class="list-main">
            <strong>${escapeHtml(item.name)} ${item.needsInfo ? '<span class="pill pill--warning">Precisa completar</span>' : ''}</strong>
            <small>${escapeHtml(TYPE_LABEL[item.type] || item.type)} · ${escapeHtml(item.category)} · Vence ${formatDateBR(item.dueDate)}${item.installmentNumber ? ` · Parcela ${item.installmentNumber} de ${item.totalInstallments}` : ''}</small>
          </div>
          <div class="list-value">${brl(item.amount)}<small>${statusPill(item.status)}</small></div>
          <div class="row-actions">
            ${item.status !== PAY_STATUS.PAID && item.status !== PAY_STATUS.CANCELLED ? `<button class="button button--primary button--tiny" type="button" data-action="pay-full" data-id="${item.id}">Pago</button>` : ''}
            ${item.status !== PAY_STATUS.PAID && item.status !== PAY_STATUS.CANCELLED ? `<button class="button button--secondary button--tiny" type="button" data-action="pay-partial" data-id="${item.id}">Parcial</button>` : ''}
            ${item.paidAmount > 0 ? `<button class="button button--ghost button--tiny" type="button" data-action="undo-pay" data-id="${item.id}">Desfazer</button>` : ''}
            <button class="button button--ghost button--tiny" type="button" data-action="edit-entry" data-id="${item.id}">Editar</button>
            <button class="button button--ghost button--tiny" type="button" data-action="delete-entry" data-id="${item.id}">Excluir</button>
          </div>
        </div>`).join('')}</div>` : emptyState('▤', 'Nada neste filtro', 'Use Adicionar para incluir receitas, contas, parcelas, gastos, dívidas ou reservas.', 'Adicionar', 'open-add')}
    </section>`;
}

function renderCommitments() {
  const rows = listCommitments(state);
  return `<section class="card">
    <div class="card-header"><div><h2>Compromissos</h2><p>Fixas, parcelas, assinaturas, financiamentos, acordos e dívidas</p></div><button class="button button--primary" type="button" data-action="open-add">Adicionar</button></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th class="number">Valor</th><th>Status</th><th>Vence</th><th>Termina</th><th>Parcelas</th><th class="number">Restante</th><th></th></tr></thead><tbody>
      ${rows.map((item) => `<tr>
        <td><div class="table-title">${escapeHtml(item.name)} ${item.needsInfo ? statusPill('pending').replace('Pendente', 'Completar') : ''}</div><div class="table-subtitle">${escapeHtml(item.category)}</div></td>
        <td>${escapeHtml(item.typeLabel)}</td>
        <td class="number">${brl(item.installmentValue || item.amount)}</td>
        <td>${escapeHtml(item.paused ? 'Pausado' : item.status === 'finished' ? 'Encerrado' : item.needsInfo ? 'Incompleto' : 'Ativo')}</td>
        <td>${formatDateBR(item.nextDue)}</td>
        <td>${item.meta.endMonth ? escapeHtml(monthLabel(item.meta.endMonth)) : (item.endDate ? formatDateBR(item.endDate) : 'Sem fim')}</td>
        <td>${item.meta.total ? `${item.meta.current}/${item.meta.total} · faltam ${item.meta.remainingCount}` : '—'}</td>
        <td class="number">${brl(item.meta.remainingValue)}</td>
        <td class="actions">
          <button class="icon-button" type="button" title="Editar" data-action="edit-commitment" data-id="${item.id}">✎</button>
          <button class="icon-button" type="button" title="Pausar" data-action="pause-commitment" data-id="${item.id}">❚❚</button>
          <button class="icon-button" type="button" title="Quitar" data-action="finish-commitment" data-id="${item.id}">✓</button>
          <button class="icon-button" type="button" title="Excluir" data-action="delete-commitment" data-id="${item.id}">×</button>
        </td>
      </tr>`).join('')}
    </tbody></table></div>` : emptyState('◎', 'Nenhum compromisso', 'Cadastre contas fixas, compras parceladas ou dívidas.', 'Adicionar', 'open-add')}
  </section>`;
}

function renderHistory() {
  const rows = history(state);
  return `<section class="card">
    <div class="card-header"><div><h2>Histórico</h2><p>Meses anteriores</p></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th class="number">Entrou</th><th class="number">Saiu</th><th class="number">Contas pagas</th><th class="number">Atrasadas</th><th class="number">Saldo final</th></tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td>${escapeHtml(monthLabel(row.monthKey))}</td>
        <td class="number">${brl(row.income)}</td>
        <td class="number">${brl(row.out)}</td>
        <td class="number">${row.paidCount}</td>
        <td class="number">${row.overdueCount}</td>
        <td class="number"><strong>${brl(row.balance)}</strong></td>
      </tr>`).join('')}
    </tbody></table></div>` : emptyState('⌁', 'Sem histórico', 'Feche ou avance meses para ver o passado aqui.')}
  </section>`;
}

function renderSettings() {
  const s = state.settings;
  return `<div class="grid grid--settings">
    <section class="card">
      <div class="card-header"><div><h2>Regras</h2><p>Diárias, metas e margem</p></div></div>
      <form class="settings-section" data-form="settings">
        <div class="form-grid">
          <label class="field"><span>Valor líquido de uma diária (R$)</span><input name="dailyNetValue" type="number" min="0" step="0.01" value="${s.dailyNetValue || 0}" required /></label>
          <label class="field"><span>Meta mensal para guardar (R$)</span><input name="saveGoal" type="number" min="0" step="0.01" value="${s.saveGoal || 0}" required /></label>
          <label class="field"><span>Fundo mensal dívidas congeladas (R$)</span><input name="frozenDebtFund" type="number" min="0" step="0.01" value="${s.frozenDebtFund || 0}" required /></label>
          <label class="field"><span>Margem mínima de segurança (R$)</span><input name="safetyMargin" type="number" min="0" step="0.01" value="${s.safetyMargin}" required /></label>
          <label class="field"><span>Bloquear após (minutos)</span><input name="lockAfterMinutes" type="number" min="0" max="240" value="${s.lockAfterMinutes}" required /></label>
          <label class="field"><span>Seu nome</span><input name="ownerName" type="text" maxlength="60" value="${escapeHtml(s.ownerName)}" /></label>
        </div>
        <button class="button button--primary" type="submit">Salvar</button>
      </form>
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Dados</h2><p>PIN ${APP_PIN}</p></div></div>
      <div class="settings-section backup-actions">
        <div id="sync-banner" class="callout ${cloudOnline ? '' : 'callout--warning'}"><div class="callout-icon">${cloudOnline ? '✓' : '!'}</div><div><strong>${cloudOnline ? 'Neon sincronizada' : 'Neon desatualizada'}</strong><p>${cloudOnline ? 'Último salvamento na nuvem ok.' : 'Salve de novo ou toque em Sincronizar.'}</p></div></div>
        <button class="button button--secondary button--full" type="button" data-action="sync-now">Sincronizar agora</button>
        <button class="button button--primary button--full" type="button" data-action="export-backup">Baixar backup</button>
        <button class="button button--secondary button--full" type="button" data-action="import-data">Importar</button>
        <button class="button button--ghost button--full" type="button" data-action="wipe-local">Zerar tudo (local + Neon)</button>
      </div>
    </section>
  </div>`;
}

function listRow(item) {
  return `<div class="list-item">
    <div class="list-main"><strong>${escapeHtml(item.name)}</strong><small>Vence ${formatDateBR(item.dueDate)} · ${statusPill(item.status)}</small></div>
    <div class="list-value">${brl(item.pendingAmount || item.amount)}</div>
  </div>`;
}

function openAddMenu() {
  refs.dialogEyebrow.textContent = 'ADICIONAR';
  refs.dialogTitle.textContent = 'O que deseja incluir?';
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  refs.dialogFields.innerHTML = [
    ['income', 'Receita'],
    ['bill', 'Conta'],
    ['installment', 'Compra parcelada'],
    ['expense', 'Gasto'],
    ['debt', 'Dívida'],
    ['reserve', 'Reserva'],
  ].map(([id, label]) => `<button class="choice-card" type="button" data-create-type="${id}"><strong>${label}</strong></button>`).join('');
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

function openCreate(type, entry = null) {
  dialogContext = { mode: entry ? 'edit' : 'create', type, id: entry?.id || null };
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  refs.dialogEyebrow.textContent = entry ? 'EDITAR' : 'NOVO';
  refs.dialogTitle.textContent = entry ? entry.name : (TYPE_LABEL[type] || 'Item');
  const today = toISODate(new Date());
  const common = `
    <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" /></label>
    <label class="field"><span>Valor</span><input name="amount" type="number" min="0" step="0.01" required value="${entry?.amount ?? ''}" /></label>
    <label class="field"><span>Categoria</span><input name="category" value="${escapeHtml(entry?.category || '')}" placeholder="Ex.: Casa" /></label>
  `;
  if (type === 'income') {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Data</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field"><span>Quantidade</span><input name="quantity" type="number" min="0" step="0.01" value="${entry?.quantity ?? 1}" /></label>
      <label class="check-row span-2"><input name="isDaily" type="checkbox" ${entry?.isDaily ? 'checked' : ''}/><span>É diária/viagem (valor = qtd × líquido da diária)</span></label>
      <label class="check-row span-2"><input name="received" type="checkbox" ${entry?.received || entry?.status === PAY_STATUS.PAID ? 'checked' : ''}/><span>Já recebi</span></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  } else if (type === 'installment') {
    const commitment = entry?.commitmentId ? state.commitments.find((item) => item.id === entry.commitmentId) : null;
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || commitment?.name || '')}" /></label>
      <label class="field"><span>Valor da parcela</span><input name="installmentValue" type="number" min="0" step="0.01" required value="${entry?.amount ?? commitment?.installmentValue ?? ''}" /></label>
      <label class="field"><span>Total de parcelas</span><input name="totalInstallments" type="number" min="1" step="1" required value="${entry?.totalInstallments ?? commitment?.totalInstallments ?? ''}" /></label>
      <label class="field"><span>Parcela atual</span><input name="currentInstallment" type="number" min="1" step="1" required value="${entry?.installmentNumber ?? commitment?.currentInstallment ?? 1}" /></label>
      <label class="field"><span>Próximo vencimento</span><input name="nextDueDate" type="date" required value="${entry?.dueDate || commitment?.nextDueDate || today}" /></label>
      <label class="field"><span>Categoria</span><input name="category" value="${escapeHtml(entry?.category || commitment?.category || '')}" /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || commitment?.note || '')}</textarea></label>
      ${entry ? `<label class="field span-2"><span>Editar</span><select name="editScope"><option value="one">Só esta parcela</option><option value="forward">Esta e as próximas</option></select></label>` : ''}`;
  } else if (type === 'bill') {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Dia do vencimento</span><input name="dueDay" type="number" min="1" max="31" value="${entry?.dueDate ? Number(entry.dueDate.slice(8, 10)) : 10}" /></label>
      <label class="field"><span>Data inicial</span><input name="startDate" type="date" value="${entry?.dueDate || `${state.currentMonth}-01`}" /></label>
      <label class="field"><span>Data final (opcional)</span><input name="endDate" type="date" value="" /></label>
      <label class="check-row span-2"><input name="recurring" type="checkbox" checked /><span>Repete todo mês</span></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  } else {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Vencimento</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  }
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

async function handleEntitySubmit(event) {
  event.preventDefault();
  if (!dialogContext) return;
  const data = Object.fromEntries(new FormData(refs.entityForm));
  try {
    if (dialogContext.mode === 'partial') {
      const month = ensureMonth(state, state.currentMonth);
      const entry = month.entries.find((item) => item.id === dialogContext.id);
      if (!entry) throw new Error('Item não encontrado.');
      registerPayment(entry, data);
      refs.entityDialog.close();
      dialogContext = null;
      await persist('Pagamento registrado', entry.name);
      return;
    }
    if (dialogContext.mode === 'edit-commitment') {
      const commitment = state.commitments.find((item) => item.id === dialogContext.id);
      if (!commitment) throw new Error('Compromisso não encontrado.');
      if (dialogContext.type === 'installment') {
        commitment.name = data.name;
        commitment.installmentValue = Number(data.installmentValue);
        commitment.amount = Number(data.installmentValue);
        commitment.totalInstallments = Number(data.totalInstallments);
        commitment.currentInstallment = Number(data.currentInstallment);
        commitment.nextDueDate = data.nextDueDate;
        commitment.category = data.category || commitment.category;
        commitment.note = data.note || '';
        commitment.needsInfo = !(commitment.totalInstallments && commitment.currentInstallment);
        if (data.editScope !== 'one') {
          const month = ensureMonth(state, state.currentMonth);
          for (const entry of month.entries) {
            if (entry.commitmentId === commitment.id) {
              entry.name = commitment.name;
              entry.amount = commitment.installmentValue;
              entry.totalInstallments = commitment.totalInstallments;
              entry.category = commitment.category;
            }
          }
        }
      } else {
        commitment.name = data.name;
        commitment.amount = Number(data.amount);
        commitment.category = data.category || commitment.category;
        commitment.dueDay = Number(data.dueDay) || commitment.dueDay || 1;
        commitment.startDate = data.startDate || commitment.startDate;
        commitment.endDate = data.endDate || '';
        commitment.note = data.note || '';
      }
      refs.entityDialog.close();
      dialogContext = null;
      await persist('Compromisso atualizado', commitment.name);
      return;
    }
    if (dialogContext.mode === 'edit') await saveEdit(data);
    else await saveCreate(data);
    refs.entityDialog.close();
    dialogContext = null;
    await persist('Salvo', 'Atualizado.');
  } catch (error) {
    showError(refs.dialogError, error.message);
  }
}

async function saveCreate(data) {
  const month = ensureMonth(state, state.currentMonth);
  const type = dialogContext.type;
  if (type === 'installment') {
    const total = Number(data.totalInstallments);
    const current = Number(data.currentInstallment);
    if (!total || !current) throw new Error('Informe total e parcela atual.');
    const commitment = {
      id: makeId('commit'),
      type: COMMITMENT_TYPES.INSTALLMENT,
      name: data.name,
      amount: Number(data.installmentValue),
      installmentValue: Number(data.installmentValue),
      totalInstallments: total,
      currentInstallment: current,
      nextDueDate: data.nextDueDate,
      dueDay: Number(String(data.nextDueDate).slice(8, 10)) || 1,
      category: data.category || 'Parcelado',
      note: data.note || '',
      needsInfo: false,
      status: 'active',
      startDate: data.nextDueDate,
    };
    state.commitments.push(commitment);
    month.entries.push({
      id: makeId('entry'),
      commitmentId: commitment.id,
      type: ENTRY_TYPES.INSTALLMENT,
      name: commitment.name,
      amount: commitment.installmentValue,
      category: commitment.category,
      dueDate: commitment.nextDueDate,
      installmentNumber: current,
      totalInstallments: total,
      note: commitment.note,
      payments: [],
      status: PAY_STATUS.PENDING,
    });
    return;
  }
  if (type === 'bill' && data.recurring === 'on') {
    const commitment = {
      id: makeId('commit'),
      type: COMMITMENT_TYPES.RECURRING,
      name: data.name,
      amount: Number(data.amount),
      category: data.category || 'Conta',
      dueDay: Number(data.dueDay) || 1,
      startDate: data.startDate || `${state.currentMonth}-01`,
      endDate: data.endDate || '',
      note: data.note || '',
      status: 'active',
    };
    state.commitments.push(commitment);
    month.entries.push({
      id: makeId('entry'),
      commitmentId: commitment.id,
      type: ENTRY_TYPES.BILL,
      name: commitment.name,
      amount: commitment.amount,
      category: commitment.category,
      dueDate: dueDateInMonth(state.currentMonth, commitment.dueDay),
      note: commitment.note,
      payments: [],
      status: PAY_STATUS.PENDING,
    });
    return;
  }
  const entryType = {
    income: ENTRY_TYPES.INCOME,
    bill: ENTRY_TYPES.BILL,
    expense: ENTRY_TYPES.EXPENSE,
    debt: ENTRY_TYPES.DEBT,
    reserve: ENTRY_TYPES.RESERVE,
  }[type] || ENTRY_TYPES.BILL;
  const entry = {
    id: makeId('entry'),
    type: entryType,
    name: data.name,
    amount: Number(data.amount),
    category: data.category || TYPE_LABEL[entryType],
    dueDate: data.dueDate || dueDateInMonth(state.currentMonth, Number(data.dueDay) || 1),
    note: data.note || '',
    received: data.received === 'on',
    payments: [],
    status: PAY_STATUS.PENDING,
  };
  if (entry.type === ENTRY_TYPES.INCOME) applyIncomeFields(entry, data);
  if (entry.type === ENTRY_TYPES.INCOME && entry.received) {
    entry.payments = [{ id: makeId('pay'), date: entry.dueDate || toISODate(new Date()), amount: entry.amount, method: 'Recebido', note: '' }];
    entry.status = PAY_STATUS.PAID;
  }
  if (entry.type === ENTRY_TYPES.DEBT) {
    state.commitments.push({
      id: makeId('commit'),
      type: COMMITMENT_TYPES.DEBT,
      name: entry.name,
      amount: entry.amount,
      category: 'Dívida',
      note: entry.note,
      dueDay: Number(String(entry.dueDate).slice(8, 10)) || 1,
      nextDueDate: entry.dueDate,
      startDate: entry.dueDate,
      status: 'active',
    });
    entry.commitmentId = state.commitments.at(-1).id;
  }
  month.entries.push(entry);
}

async function saveEdit(data) {
  const month = ensureMonth(state, state.currentMonth);
  const entry = month.entries.find((item) => item.id === dialogContext.id);
  if (!entry) throw new Error('Item não encontrado.');
  if (dialogContext.type === 'installment') {
    entry.name = data.name;
    entry.amount = Number(data.installmentValue);
    entry.category = data.category || entry.category;
    entry.dueDate = data.nextDueDate;
    entry.note = data.note || '';
    entry.installmentNumber = Number(data.currentInstallment);
    entry.totalInstallments = Number(data.totalInstallments);
    entry.needsInfo = !(entry.installmentNumber && entry.totalInstallments);
    const commitment = state.commitments.find((item) => item.id === entry.commitmentId);
    if (commitment && data.editScope !== 'one') {
      commitment.name = entry.name;
      commitment.installmentValue = entry.amount;
      commitment.amount = entry.amount;
      commitment.totalInstallments = entry.totalInstallments;
      commitment.currentInstallment = entry.installmentNumber;
      commitment.nextDueDate = entry.dueDate;
      commitment.category = entry.category;
      commitment.note = entry.note;
      commitment.needsInfo = false;
    } else if (commitment && data.editScope === 'one') {
      // only this entry
    } else if (!commitment) {
      // create commitment from completed info
      if (entry.totalInstallments && entry.installmentNumber) {
        const created = {
          id: makeId('commit'),
          type: COMMITMENT_TYPES.INSTALLMENT,
          name: entry.name,
          installmentValue: entry.amount,
          amount: entry.amount,
          totalInstallments: entry.totalInstallments,
          currentInstallment: entry.installmentNumber,
          nextDueDate: entry.dueDate,
          category: entry.category,
          note: entry.note,
          needsInfo: false,
          status: 'active',
          startDate: entry.dueDate,
        };
        state.commitments.push(created);
        entry.commitmentId = created.id;
      }
    }
    return;
  }
  entry.name = data.name;
  entry.amount = Number(data.amount);
  entry.category = data.category || entry.category;
  entry.dueDate = data.dueDate || entry.dueDate;
  entry.note = data.note || '';
  if (entry.type === ENTRY_TYPES.INCOME) {
    applyIncomeFields(entry, data);
    entry.received = data.received === 'on';
    if (entry.received && !(entry.payments || []).length) {
      entry.payments = [{ id: makeId('pay'), date: entry.dueDate || toISODate(new Date()), amount: entry.amount, method: 'Recebido', note: '' }];
    }
    if (!entry.received) entry.payments = [];
  }
}

function applyIncomeFields(entry, data) {
  entry.isDaily = data.isDaily === 'on';
  entry.quantity = Math.max(0, Number(data.quantity) || (entry.isDaily ? 1 : 0));
  if (entry.isDaily) {
    const dailyNet = Number(state.settings.dailyNetValue) || 0;
    if (dailyNet > 0 && entry.quantity > 0) entry.amount = Math.round(entry.quantity * dailyNet * 100) / 100;
    if (!data.category) entry.category = 'Diária';
  }
}

async function handleViewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const month = ensureMonth(state, state.currentMonth);
  const entry = month.entries.find((item) => item.id === id);

  if (action === 'filter') {
    monthFilter = id;
    render();
    return;
  }
  if (action === 'open-add') return openAddMenu();
  if (action === 'pay-full' && entry) {
    markPaid(entry);
    if (entry.type === ENTRY_TYPES.INSTALLMENT && entry.commitmentId) {
      const commitment = state.commitments.find((item) => item.id === entry.commitmentId);
      if (commitment) advanceInstallmentCommitment(commitment, 1);
    }
    await persist('Pago', entry.name);
    return;
  }
  if (action === 'pay-partial' && entry) {
    openPartialPay(entry);
    return;
  }
  if (action === 'undo-pay' && entry) {
    undoPayment(entry);
    await persist('Desfeito', entry.name);
    return;
  }
  if (action === 'edit-entry' && entry) {
    openCreate(entry.type === ENTRY_TYPES.INSTALLMENT ? 'installment' : entry.type, entry);
    return;
  }
  if (action === 'delete-entry' && entry) {
    openDeleteScope(entry);
    return;
  }
  if (action === 'edit-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    if (commitment.type === COMMITMENT_TYPES.INSTALLMENT) {
      openCreate('installment', {
        id: `tmp_${commitment.id}`,
        commitmentId: commitment.id,
        type: ENTRY_TYPES.INSTALLMENT,
        name: commitment.name,
        amount: commitment.installmentValue,
        category: commitment.category,
        dueDate: commitment.nextDueDate,
        installmentNumber: commitment.currentInstallment,
        totalInstallments: commitment.totalInstallments,
        note: commitment.note,
      });
      dialogContext = { mode: 'edit-commitment', type: 'installment', id: commitment.id };
    } else {
      openCreate('bill', {
        id: `tmp_${commitment.id}`,
        name: commitment.name,
        amount: commitment.amount,
        category: commitment.category,
        dueDate: dueDateInMonth(state.currentMonth, commitment.dueDay || 1),
        note: commitment.note,
      });
      dialogContext = { mode: 'edit-commitment', type: 'bill', id: commitment.id };
    }
    return;
  }
  if (action === 'pause-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    commitment.paused = !commitment.paused;
    commitment.status = commitment.paused ? 'paused' : 'active';
    await persist(commitment.paused ? 'Pausado' : 'Reativado', commitment.name);
    return;
  }
  if (action === 'finish-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    commitment.status = 'finished';
    commitment.paused = false;
    if (commitment.totalInstallments) commitment.currentInstallment = commitment.totalInstallments + 1;
    await persist('Quitado', commitment.name);
    return;
  }
  if (action === 'delete-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    openDeleteCommitment(commitment);
    return;
  }
  if (action === 'sync-now') return syncNow();
  if (action === 'export-backup') {
    try { downloadEncryptedBackup(); toast('Backup', 'Arquivo baixado.'); }
    catch (error) { toast('Erro', error.message, 'error'); }
    return;
  }
  if (action === 'import-data') return refs.importFile.click();
  if (action === 'wipe-local') {
    const ok = await confirmDialog('Zerar tudo?', 'Apaga local e Neon. Começa do zero.', 'Zerar');
    if (!ok) return;
    state = createEmptyState();
    try {
      const saved = await pushRemoteState(state, APP_PIN);
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
    } catch (error) {
      toast('Neon falhou', error.message, 'error');
      return;
    }
    wipeVault();
    await createVault(APP_PIN, state);
    sessionStorage.removeItem(SESSION_FLAG);
    toast('Zerado', 'Pode começar a lançar.');
    location.reload();
  }
}

function openPartialPay(entry) {
  dialogContext = { mode: 'partial', id: entry.id, type: entry.type };
  refs.dialogEyebrow.textContent = 'PAGAMENTO';
  refs.dialogTitle.textContent = entry.name;
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  const pending = Math.max(0, entry.amount - (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0));
  refs.dialogFields.innerHTML = `
    <label class="field"><span>Valor pago</span><input name="amount" type="number" min="0.01" step="0.01" required value="${pending}" /></label>
    <label class="field"><span>Data</span><input name="date" type="date" required value="${toISODate(new Date())}" /></label>
    <label class="field"><span>Forma</span><select name="method"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Boleto</option></select></label>
    <label class="field span-2"><span>Observação</span><textarea name="note"></textarea></label>
    <p class="muted span-2">Falta pagar: ${brl(pending)}</p>`;
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

async function handleViewSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'settings') {
    state.settings.dailyNetValue = Number(data.dailyNetValue);
    state.settings.saveGoal = Number(data.saveGoal);
    state.settings.frozenDebtFund = Number(data.frozenDebtFund);
    state.settings.safetyMargin = Number(data.safetyMargin);
    state.settings.lockAfterMinutes = Number(data.lockAfterMinutes);
    state.settings.ownerName = String(data.ownerName || '').trim();
    await persist('Salvo', 'Configurações atualizadas.');
  }
}

function updateMonthNav() {
  if (!state || !refs.monthLabelBtn) return;
  refs.monthLabelBtn.textContent = monthLabel(state.currentMonth, true).replace('.', '');
  const isCurrent = state.currentMonth === currentMonthKey();
  refs.monthToday.classList.toggle('hidden', isCurrent);
  refs.monthLabelBtn.title = isCurrent ? 'Mês atual' : 'Voltar para este mês';
}

async function shiftMonth(delta) {
  await goToMonth(addMonths(state.currentMonth, delta));
}

async function goToMonth(target) {
  if (!target || target === state.currentMonth) {
    updateMonthNav();
    return;
  }
  ensureMonth(state, target);
  state.currentMonth = target;
  const stamp = state.updatedAt;
  state = normalizeState(state);
  state.updatedAt = stamp;
  await saveVault(state);
  render();
  updateMonthNav();
}

async function handleMonthChange() {
  // mantido por compatibilidade — navegação usa goToMonth
}

async function persist(title = '', message = '', { requireCloud = false } = {}) {
  if (saving) return false;
  saving = true;
  try {
    const previousUpdatedAt = state.updatedAt;
    state = normalizeState(state);
    state.updatedAt = previousUpdatedAt || state.updatedAt;
    state.updatedAt = new Date().toISOString();
    await saveVault(state);
    try {
      const saved = await pushRemoteState(state, APP_PIN);
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
      await saveVault(state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
      render();
      if (title) toast(title, message);
      return true;
    } catch (error) {
      cloudOnline = false;
      setSyncStatus('error', 'Falha no Neon');
      render();
      if (requireCloud) {
        toast('Não gravou na nuvem', error.message, 'error');
        return false;
      }
      toast(title || 'Salvo local', message || 'Neon falhou. Toque em Sincronizar.', title ? 'success' : 'error');
      return !requireCloud;
    }
  } catch (error) {
    toast('Erro', error.message, 'error');
    return false;
  } finally {
    saving = false;
  }
}

async function syncNow() {
  try {
    const remote = await fetchRemoteState(APP_PIN);
    const remoteTime = Date.parse(remote.updatedAt || 0) || 0;
    const localTime = Date.parse(state.updatedAt || 0) || 0;
    if (remote?.state && remoteTime > localTime) {
      state = normalizeState(remote.state);
      if (remote.updatedAt) state.updatedAt = new Date(remote.updatedAt).toISOString();
      await saveVault(state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
      render();
      toast('Sincronizado', 'Versão da nuvem aplicada.');
      return;
    }
    const saved = await pushRemoteState(state, APP_PIN);
    if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
    await saveVault(state);
    cloudOnline = true;
    setSyncStatus('online', 'Neon sincronizada');
    render();
    toast('Sincronizado', 'Dados enviados.');
  } catch (error) {
    cloudOnline = false;
    setSyncStatus('error', 'Falha no Neon');
    render();
    toast('Sync falhou', error.message, 'error');
  }
}

function openDeleteScope(entry) {
  dialogContext = { mode: 'delete-scope', id: entry.id };
  refs.dialogEyebrow.textContent = 'EXCLUIR';
  refs.dialogTitle.textContent = entry.name;
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  const options = entry.commitmentId
    ? [
        ['one', 'Só este mês'],
        ['forward', 'Este e os próximos'],
        ['all', 'Compromisso completo'],
      ]
    : [['one', 'Excluir este lançamento']];
  refs.dialogFields.innerHTML = options.map(([scope, label]) => `<button class="choice-card" type="button" data-action="confirm-delete" data-kind="entry" data-id="${entry.id}" data-scope="${scope}"><strong>${label}</strong></button>`).join('');
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

function openDeleteCommitment(commitment) {
  dialogContext = { mode: 'delete-scope', id: commitment.id };
  refs.dialogEyebrow.textContent = 'EXCLUIR';
  refs.dialogTitle.textContent = commitment.name;
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  const options = [
    ['one', 'Só este mês'],
    ['forward', 'Este e os próximos'],
    ['all', 'Compromisso completo'],
  ];
  refs.dialogFields.innerHTML = options.map(([scope, label]) => `<button class="choice-card" type="button" data-action="confirm-delete" data-kind="commitment" data-id="${commitment.id}" data-scope="${scope}"><strong>${label}</strong></button>`).join('');
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

async function handleImportFile() {
  const file = refs.importFile.files?.[0];
  refs.importFile.value = '';
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    if (imported.type === 'encrypted-backup') {
      const ok = await confirmDialog('Restaurar backup?', 'Substitui os dados locais.', 'Restaurar');
      if (!ok) return;
      restoreEncryptedBackup(imported.value);
      location.reload();
      return;
    }
    const ok = await confirmDialog('Importar dados?', 'Substitui o conteúdo atual.', 'Importar');
    if (!ok) return;
    state = normalizeState(imported.value);
    await persist('Importado', 'Dados carregados.');
  } catch (error) {
    toast('Erro', error.message, 'error');
  }
}

function confirmDialog(title, copy, actionLabel = 'Confirmar') {
  refs.confirmTitle.textContent = title;
  refs.confirmCopy.textContent = copy;
  refs.confirmAction.textContent = actionLabel;
  refs.confirmDialog.showModal();
  return new Promise((resolve) => {
    const onClose = () => {
      refs.confirmDialog.removeEventListener('close', onClose);
      resolve(refs.confirmDialog.returnValue === 'confirm');
    };
    refs.confirmDialog.addEventListener('close', onClose);
  });
}

function toast(title, copy, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="callout-icon">${type === 'error' ? '!' : '✓'}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy || '')}</span></div>`;
  refs.toastRegion.append(el);
  setTimeout(() => el.remove(), 3200);
}

function showError(el, message) {
  el.textContent = message;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}
