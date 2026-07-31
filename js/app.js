import {
  COMMITMENT_TYPES,
  DEBT_STATUS,
  DEBT_STATUS_LABEL,
  ENTRY_TYPES,
  INCOME_CERTAINTY,
  PAY_STATUS,
  TYPE_LABEL,
  addMonths,
  advanceInstallmentCommitment,
  applyInstallmentPayment,
  cloneState,
  createEmptyState,
  currentMonthKey,
  deleteCommitmentScope,
  deleteEntryScope,
  debtsSummary,
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
  renegotiateCommitment,
  rewindInstallmentCommitment,
  settleInstallmentCommitment,
  undoInstallmentPayment,
  undoPayment,
  makeId,
  toISODate,
  dueDateInMonth,
} from './model.js';
import { brand } from './config.js';
import { checkSession, fetchRemoteState, loginRemote, logoutRemote, pushRemoteState } from './sync.js';
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
const LOCAL_PIN_KEY = 'respira:local-key-hint';
const REVISION_KEY = 'respira:sync-revision';
const views = {
  overview: ['HOJE', 'Visão geral'],
  month: ['MÊS', 'Mês atual'],
  commitments: ['FIXOS', 'Compromissos'],
  debts: ['DÍVIDAS', 'Dívidas'],
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
let syncRevision = 0;
let sessionPin = '';
let currentView = 'overview';
let monthFilter = 'all';
let dialogContext = null;
let installPrompt = null;
let idleTimer = null;
let saving = false;
let cloudOnline = false;
let pendingConflict = null;

init();

async function init() {
  bindEvents();
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch {}
  }
  refs.boot.classList.add('hidden');
  if (refs.unlockPin) refs.unlockPin.value = '';
  if (sessionStorage.getItem(SESSION_FLAG) === '1') {
    try {
      const ok = await checkSession();
      if (ok && hasVault()) {
        const pin = sessionStorage.getItem(LOCAL_PIN_KEY) || '';
        if (pin) {
          await openWithPin(pin, { quiet: true, alreadyLoggedIn: true });
          return;
        }
      }
    } catch {
      sessionStorage.removeItem(SESSION_FLAG);
    }
  }
  showLock();
}

function bindEvents() {
  refs.unlockForm.addEventListener('submit', handleUnlock);
  document.querySelector('#lock-now').addEventListener('click', () => lockApp());
  document.querySelector('#quick-add').addEventListener('click', openAddMenu);
  refs.monthPrev.addEventListener('click', () => shiftMonth(-1));
  refs.monthNext.addEventListener('click', () => shiftMonth(1));
  refs.monthToday.addEventListener('click', () => goToMonth(currentMonthKey()));
  refs.monthLabelBtn.addEventListener('click', () => goToMonth(currentMonthKey()));
  refs.entityForm.addEventListener('submit', handleEntitySubmit);
  refs.entityDialog.addEventListener('click', handleDialogClick);
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
  hideError(refs.unlockError);
}

async function handleUnlock(event) {
  event.preventDefault();
  try {
    hideError(refs.unlockError);
    await openWithPin(refs.unlockPin.value.trim());
  } catch (error) {
    showError(refs.unlockError, error.message || 'Não foi possível entrar.');
  }
}

async function openWithPin(pin, { quiet = false, alreadyLoggedIn = false } = {}) {
  if (!pin) throw new Error('Informe o PIN.');
  sessionPin = pin;
  if (!alreadyLoggedIn) await loginRemote(pin);

  let localState = null;
  if (hasVault()) {
    try { localState = normalizeState(await unlockVault(pin)); }
    catch { wipeVault(); localState = null; }
  }

  let remote = null;
  try {
    remote = await fetchRemoteState();
    cloudOnline = true;
  } catch (error) {
    cloudOnline = false;
    setSyncStatus('error', 'Neon offline');
    if (!localState) throw error;
  }

  if (remote?.state) {
    const remoteRevision = Number(remote.revision) || 1;
    const localRevision = Number(localStorage.getItem(REVISION_KEY) || 0);
    const remoteState = normalizeState(remote.state);
    if (remote.updatedAt) remoteState.updatedAt = new Date(remote.updatedAt).toISOString();

    if (localState && localRevision && localRevision < remoteRevision) {
      // nuvem mais nova pela revisão
      state = remoteState;
      syncRevision = remoteRevision;
      if (hasVault()) await saveVault(state);
      else await createVault(pin, state);
      localStorage.setItem(REVISION_KEY, String(syncRevision));
      setSyncStatus('online', 'Neon sincronizada');
    } else if (localState && localRevision > remoteRevision) {
      state = localState;
      syncRevision = remoteRevision;
      try {
        const saved = await pushRemoteState(state, syncRevision);
        syncRevision = Number(saved.revision) || syncRevision + 1;
        if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
        await saveVault(state);
        localStorage.setItem(REVISION_KEY, String(syncRevision));
        setSyncStatus('online', 'Neon sincronizada');
      } catch (error) {
        if (error.code === 409) await handleConflict(error.payload, localState);
        else {
          cloudOnline = false;
          setSyncStatus('error', 'Neon desatualizada');
        }
      }
    } else if (localState && localRevision === remoteRevision && localState.updatedAt !== remoteState.updatedAt) {
      pendingConflict = { remote: remoteState, revision: remoteRevision, updatedAt: remote.updatedAt, local: localState };
      state = localState;
      syncRevision = remoteRevision;
      setSyncStatus('error', 'Conflito');
    } else {
      state = remoteState;
      syncRevision = remoteRevision;
      if (hasVault()) await saveVault(state);
      else await createVault(pin, state);
      localStorage.setItem(REVISION_KEY, String(syncRevision));
      setSyncStatus('online', 'Neon sincronizada');
    }
  } else if (localState) {
    state = localState;
    try {
      const saved = await pushRemoteState(state, syncRevision || 0);
      syncRevision = Number(saved.revision) || 1;
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
      await saveVault(state);
      localStorage.setItem(REVISION_KEY, String(syncRevision));
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    } catch (error) {
      if (error.code === 409) {
        await handleConflict(error.payload, state);
      } else {
        cloudOnline = false;
        setSyncStatus('error', 'Neon desatualizada');
      }
    }
  } else {
    state = createEmptyState();
    await createVault(pin, state);
    try {
      const saved = await pushRemoteState(state, 0);
      syncRevision = Number(saved.revision) || 1;
      if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
      await saveVault(state);
      localStorage.setItem(REVISION_KEY, String(syncRevision));
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
    } catch {
      cloudOnline = false;
      setSyncStatus('error', 'Neon desatualizada');
    }
    if (!quiet) toast('Pronto', 'Comece pelo botão Adicionar.');
  }

  sessionStorage.setItem(SESSION_FLAG, '1');
  sessionStorage.setItem(LOCAL_PIN_KEY, pin);
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
  updateMonthNav();
  currentView = 'overview';
  ensureMonth(state, state.currentMonth);
  render();
  resetIdleTimer();
}

async function lockApp() {
  if (!state) return;
  try { await logoutRemote(); } catch {}
  lockVault();
  clearTimeout(idleTimer);
  state = null;
  sessionPin = '';
  sessionStorage.removeItem(SESSION_FLAG);
  sessionStorage.removeItem(LOCAL_PIN_KEY);
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
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  render();
}

function render() {
  if (!state) return;
  const [eyebrow, title] = views[currentView];
  refs.viewEyebrow.textContent = eyebrow;
  refs.viewTitle.textContent = title;
  updateMonthNav();
  const map = {
    overview: renderOverview,
    month: renderMonth,
    commitments: renderCommitments,
    debts: renderDebts,
    history: renderHistory,
    settings: renderSettings,
  };
  refs.viewRoot.innerHTML = map[currentView]();
  if (pendingConflict) refs.viewRoot.insertAdjacentHTML('afterbegin', renderConflictBanner());
}

function renderConflictBanner() {
  return `<div class="callout callout--warning section-gap"><div class="callout-icon">!</div><div>
    <strong>Conflito com o Neon</strong>
    <p>Existe uma versão mais recente na nuvem. Sua cópia local foi preservada.</p>
    <div class="backup-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="button button--primary" type="button" data-action="conflict-use-cloud">Usar versão da nuvem</button>
      <button class="button button--secondary" type="button" data-action="conflict-push-local">Enviar minha versão</button>
    </div>
  </div></div>`;
}

function renderOverview() {
  const data = overview(state);
  const daily = data.daily;
  const proj = projection(state, state.currentMonth, 6);
  const fmtNeed = (value) => (value == null ? '—' : String(value));
  return `
    <section class="grid grid--4">
      ${metric('Saldo atual', data.currentBalance, data.currentBalance >= 0 ? 'positive' : 'negative')}
      ${metric('Recebido de verdade', data.receivedTotal, 'positive')}
      ${metric('Falta pagar', data.totalPending, 'negative')}
      ${metric('Valor livre', data.free, data.free >= 0 ? 'positive' : 'negative')}
      ${metric('Já reservado', data.reserved)}
      ${metric('Ainda falta reservar', data.remainingSave)}
      ${metric('Atrasadas', data.overdueTotal, data.overdueCount ? 'negative' : '')}
      ${metric('Margem de segurança', data.safety)}
    </section>

    <section class="card section-gap">
      <div class="card-header"><div><h2>Diárias</h2><p>Só receitas recebidas ou garantidas reduzem a meta</p></div></div>
      <div class="card-body">
        ${daily.dailyNet <= 0 ? `<div class="callout callout--warning"><div class="callout-icon">!</div><div><strong>Defina o valor líquido da diária</strong><p>Em Configurações.</p></div></div>` : `
        <div class="stat-strip">
          <div><span>Meta mensal</span><strong>${brl(daily.monthlyGoal)}</strong></div>
          <div><span>Planejadas</span><strong>${fmtNeed(daily.plannedDailies)}</strong></div>
          <div><span>Ainda faltam</span><strong>${fmtNeed(daily.missing)}</strong></div>
          <div><span>Sobra ao atingir</span><strong>${daily.surplus == null ? '—' : brl(daily.surplus)}</strong></div>
        </div>
        <div class="list" style="margin-top:12px">
          <div class="list-item"><div class="list-main"><strong>Para pagar as contas</strong></div><div class="list-value">${fmtNeed(daily.needForBills)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para proteger a margem</strong></div><div class="list-value">${fmtNeed(daily.needForSafety)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para a meta de guardar</strong></div><div class="list-value">${fmtNeed(daily.needForSave)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Para o fundo das dívidas congeladas</strong></div><div class="list-value">${fmtNeed(daily.needForFrozen)}</div></div>
          <div class="list-item"><div class="list-main"><strong>Total de diárias necessárias</strong></div><div class="list-value">${fmtNeed(daily.needForGoal)}</div></div>
        </div>`}
      </div>
    </section>

    <section class="grid grid--2 section-gap">
      <div class="card">
        <div class="card-header"><div><h2>Próximas contas</h2><p>Pendentes do mês</p></div></div>
        <div class="card-body">
          ${data.upcoming.length ? `<div class="list">${data.upcoming.map((item) => listRow(item)).join('')}</div>` : emptyState('✓', 'Nada pendente', 'Nenhuma conta para pagar neste mês.')}
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div><h2>Parcelas que terminam em breve</h2><p>Até 3 restantes</p></div></div>
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
      <div class="card-header"><div><h2>Projeção</h2><p>Somente leitura · não altera seus dados</p></div></div>
      <div class="card-body">
        ${proj.lightest ? `<p class="muted" style="margin:0 0 12px">Mês mais leve: <strong>${escapeHtml(monthLabel(proj.lightest.monthKey))}</strong> · sai ${brl(proj.lightest.out)}</p>` : ''}
        <div class="table-wrap"><table class="data-table"><thead><tr>
          <th>Mês</th><th class="number">Entra</th><th class="number">Sai</th><th class="number">Reserva</th><th class="number">Dívidas</th><th class="number">Antes margem</th><th class="number">Livre</th><th>Termina</th><th class="number">Libera</th>
        </tr></thead><tbody>
          ${proj.rows.map((row) => `<tr>
            <td>${escapeHtml(monthLabel(row.monthKey))}</td>
            <td class="number">${brl(row.income)}</td>
            <td class="number">${brl(row.out)}</td>
            <td class="number">${brl(row.toReserve)}</td>
            <td class="number">${brl(row.toDebts)}</td>
            <td class="number">${brl(row.beforeMargin)}</td>
            <td class="number"><strong>${brl(row.balance)}</strong></td>
            <td>${row.ending.length ? escapeHtml(row.ending.join(', ')) : '—'}</td>
            <td class="number">${brl(row.released)}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    </section>`;
}

function renderMonth() {
  const entries = monthEntries(state, state.currentMonth, monthFilter);
  const filters = [
    ['all', 'Tudo'], ['pending', 'Pendente'], ['paid', 'Pago'], ['overdue', 'Atrasado'], ['in', 'Entradas'], ['out', 'Saídas'],
  ];
  return `
    <div class="filter-bar">
      ${filters.map(([id, label]) => `<button class="chip ${monthFilter === id ? 'active' : ''}" type="button" data-action="filter" data-id="${id}">${label}</button>`).join('')}
    </div>
    <section class="card section-gap">
      ${entries.length ? `<div class="list list--actions">${entries.map((item) => `
        <div class="list-item entry-row">
          <div class="list-main">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${escapeHtml(TYPE_LABEL[item.type] || item.type)} · ${escapeHtml(item.category)} · Vence ${formatDateBR(item.dueDate)}${item.installmentNumber ? ` · Parcela ${item.installmentNumber} de ${item.totalInstallments}` : ''}${item.certainty ? ` · ${certaintyLabel(item.certainty)}` : ''}</small>
          </div>
          <div class="list-value">${brl(item.amount)}<small>${statusPill(item.status)}</small></div>
          <div class="row-actions">
            ${item.status !== PAY_STATUS.PAID && item.status !== PAY_STATUS.CANCELLED ? `<button class="button button--primary button--tiny" type="button" data-action="pay-full" data-id="${item.id}">Pago</button>` : ''}
            ${item.status !== PAY_STATUS.PAID && item.status !== PAY_STATUS.CANCELLED ? `<button class="button button--secondary button--tiny" type="button" data-action="pay-partial" data-id="${item.id}">Parcial</button>` : ''}
            ${item.paidAmount > 0 ? `<button class="button button--ghost button--tiny" type="button" data-action="undo-pay" data-id="${item.id}">Desfazer</button>` : ''}
            <button class="button button--ghost button--tiny" type="button" data-action="edit-entry" data-id="${item.id}">Editar</button>
            <button class="button button--ghost button--tiny" type="button" data-action="delete-entry" data-id="${item.id}">Excluir</button>
          </div>
        </div>`).join('')}</div>` : emptyState('▤', 'Nada neste filtro', 'Use Adicionar para incluir itens.', 'Adicionar', 'open-add')}
    </section>`;
}

function certaintyLabel(value) {
  if (value === INCOME_CERTAINTY.RECEIVED) return 'Recebida';
  if (value === INCOME_CERTAINTY.GUARANTEED) return 'Garantida';
  return 'Prevista';
}

function renderCommitments() {
  const rows = listCommitments(state);
  return `<section class="card">
    <div class="card-header"><div><h2>Compromissos</h2><p>Fixas, parcelas, assinaturas e financiamentos</p></div><button class="button button--primary" type="button" data-action="open-add">Adicionar</button></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Nome</th><th>Tipo</th><th class="number">Valor</th><th>Status</th><th>Vence</th><th>Parcelas</th><th class="number">Restante</th><th></th></tr></thead><tbody>
      ${rows.map((item) => `<tr>
        <td><div class="table-title">${escapeHtml(item.name)}</div><div class="table-subtitle">${escapeHtml(item.category)}</div></td>
        <td>${escapeHtml(item.typeLabel)}</td>
        <td class="number">${brl(item.installmentValue || item.amount)}</td>
        <td>${escapeHtml(item.statusLabel)}</td>
        <td>${formatDateBR(item.nextDue)}</td>
        <td>${item.meta.finished ? 'Encerrado' : (item.meta.total ? `${item.meta.current}/${item.meta.total}` : '—')}</td>
        <td class="number">${item.meta.remainingCount == null ? '—' : `${item.meta.remainingCount} · ${brl(item.meta.remainingValue)}`}</td>
        <td><div class="row-actions">
          ${isInstallment(item) && !item.meta.finished ? `
            <button class="button button--primary button--tiny" type="button" data-action="pay-installment" data-id="${item.id}">Pagar</button>
            <button class="button button--secondary button--tiny" type="button" data-action="partial-installment" data-id="${item.id}">Parcial</button>
            <button class="button button--ghost button--tiny" type="button" data-action="advance-installment" data-id="${item.id}">Antecipar</button>
            <button class="button button--ghost button--tiny" type="button" data-action="settle-installment" data-id="${item.id}">Quitar</button>
          ` : ''}
          ${isInstallment(item) ? `<button class="button button--ghost button--tiny" type="button" data-action="undo-installment" data-id="${item.id}">Desfazer</button>
          <button class="button button--ghost button--tiny" type="button" data-action="renegotiate" data-id="${item.id}">Renegociar</button>` : ''}
          <button class="button button--ghost button--tiny" type="button" data-action="pause-commitment" data-id="${item.id}">${item.paused ? 'Reativar' : 'Pausar'}</button>
          <button class="button button--ghost button--tiny" type="button" data-action="edit-commitment" data-id="${item.id}">Editar</button>
          <button class="button button--ghost button--tiny" type="button" data-action="delete-commitment" data-id="${item.id}">Excluir</button>
        </div></td>
      </tr>`).join('')}
    </tbody></table></div>` : emptyState('◎', 'Sem compromissos', 'Adicione contas fixas ou parcelas.', 'Adicionar', 'open-add')}
  </section>`;
}

function isInstallment(item) {
  return [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type);
}

function renderDebts() {
  const summary = debtsSummary(state);
  return `
    <section class="grid grid--4">
      ${metric('Saldo total', summary.totalBalance, 'negative')}
      ${metric('Já pago', summary.totalPaid, 'positive')}
      ${metric('Planejado no mês', summary.plannedMonth)}
      ${metric('Fundo congeladas', summary.frozenFundAccumulated)}
    </section>
    <section class="card section-gap">
      <div class="card-header"><div><h2>Dívidas</h2><p>Fundo congelado não paga automaticamente</p></div>
        <button class="button button--primary" type="button" data-action="add-debt">Nova dívida</button>
      </div>
      ${summary.debts.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>
        <th>Credor</th><th class="number">Saldo</th><th class="number">Mensal</th><th class="number">Juros/custo</th><th>Prioridade</th><th>Status</th><th></th>
      </tr></thead><tbody>
        ${summary.debts.map((debt) => `<tr>
          <td><div class="table-title">${escapeHtml(debt.creditor)}</div><div class="table-subtitle">${escapeHtml(debt.note || '')}</div></td>
          <td class="number">${brl(debt.balance)}</td>
          <td class="number">${brl(debt.plannedMonthly)}</td>
          <td class="number">${brl(debt.monthlyCost)}</td>
          <td>${debt.priority}</td>
          <td>${escapeHtml(DEBT_STATUS_LABEL[debt.status] || debt.status)}</td>
          <td><div class="row-actions">
            <button class="button button--ghost button--tiny" type="button" data-action="edit-debt" data-id="${debt.id}">Editar</button>
            <button class="button button--ghost button--tiny" type="button" data-action="delete-debt" data-id="${debt.id}">Excluir</button>
          </div></td>
        </tr>`).join('')}
      </tbody></table></div>` : emptyState('◎', 'Sem dívidas', 'Cadastre credores e saldos.', 'Nova dívida', 'add-debt')}
    </section>`;
}

function renderHistory() {
  const rows = history(state);
  return `<section class="card">
    <div class="card-header"><div><h2>Histórico</h2><p>Valores realizados</p></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>
      <th>Mês</th><th class="number">Recebido</th><th class="number">Pago</th><th class="number">Saldo final</th><th>Pagos</th><th>Atrasos</th>
    </tr></thead><tbody>
      ${rows.map((row) => `<tr>
        <td>${escapeHtml(monthLabel(row.monthKey))}</td>
        <td class="number">${brl(row.income)}</td>
        <td class="number">${brl(row.out)}</td>
        <td class="number"><strong>${brl(row.balance)}</strong></td>
        <td>${row.paidCount}</td>
        <td>${row.overdueCount}</td>
      </tr>`).join('')}
    </tbody></table></div>` : emptyState('⌁', 'Sem histórico', 'Meses anteriores aparecem aqui.')}
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
      <div class="card-header"><div><h2>Dados</h2><p>${escapeHtml(brand.domain)} · rev ${syncRevision}</p></div></div>
      <div class="settings-section backup-actions">
        <div class="callout ${cloudOnline ? '' : 'callout--warning'}"><div class="callout-icon">${cloudOnline ? '✓' : '!'}</div><div><strong>${cloudOnline ? 'Neon sincronizada' : 'Neon desatualizada'}</strong><p>${cloudOnline ? 'Último salvamento ok.' : 'Toque em Sincronizar.'}</p></div></div>
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
    <label class="field"><span>Categoria</span><input name="category" value="${escapeHtml(entry?.category || '')}" /></label>
  `;
  if (type === 'income') {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Data</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field"><span>Quantidade</span><input name="quantity" type="number" min="0" step="0.01" value="${entry?.quantity ?? 1}" /></label>
      <label class="field span-2"><span>Situação</span><select name="certainty">
        <option value="received" ${entry?.certainty === 'received' || entry?.received ? 'selected' : ''}>Recebida</option>
        <option value="guaranteed" ${entry?.certainty === 'guaranteed' ? 'selected' : ''}>Garantida</option>
        <option value="forecast" ${!entry || entry?.certainty === 'forecast' || (!entry?.received && entry?.certainty !== 'guaranteed' && entry?.certainty !== 'received') ? 'selected' : ''}>Apenas prevista</option>
      </select></label>
      <label class="check-row span-2"><input name="isDaily" type="checkbox" ${entry?.isDaily ? 'checked' : ''}/><span>É diária/viagem (valor = qtd × líquido)</span></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  } else if (type === 'installment') {
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" /></label>
      <label class="field"><span>Valor da parcela</span><input name="installmentValue" type="number" min="0" step="0.01" required value="${entry?.amount ?? ''}" /></label>
      <label class="field"><span>Categoria</span><input name="category" value="${escapeHtml(entry?.category || 'Parcelado')}" /></label>
      <label class="field"><span>Parcela atual</span><input name="currentInstallment" type="number" min="1" required value="${entry?.installmentNumber ?? 1}" /></label>
      <label class="field"><span>Total de parcelas</span><input name="totalInstallments" type="number" min="1" required value="${entry?.totalInstallments ?? ''}" /></label>
      <label class="field"><span>Próximo vencimento</span><input name="nextDueDate" type="date" required value="${entry?.dueDate || today}" /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>
      ${entry ? `<label class="field span-2"><span>Escopo</span><select name="editScope"><option value="forward">Este e os próximos</option><option value="one">Só este mês</option></select></label>` : ''}`;
  } else if (type === 'bill') {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Vencimento</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field"><span>Dia fixo</span><input name="dueDay" type="number" min="1" max="31" value="${entry?.dueDate ? Number(entry.dueDate.slice(8, 10)) : 1}" /></label>
      <label class="check-row span-2"><input name="recurring" type="checkbox" ${entry?.commitmentId ? 'checked' : 'checked'}/><span>Repetir todo mês</span></label>
      <label class="field"><span>Início</span><input name="startDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field"><span>Fim (opcional)</span><input name="endDate" type="date" value="" /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  } else if (type === 'debt') {
    openDebtForm(entry);
    return;
  } else {
    refs.dialogFields.innerHTML = `${common}
      <label class="field"><span>Vencimento</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(entry?.note || '')}</textarea></label>`;
  }
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

function openDebtForm(debt = null) {
  dialogContext = { mode: debt ? 'edit-debt' : 'create-debt', id: debt?.id || null };
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  refs.dialogEyebrow.textContent = debt ? 'EDITAR' : 'NOVA';
  refs.dialogTitle.textContent = debt ? debt.creditor : 'Dívida';
  refs.dialogFields.innerHTML = `
    <label class="field span-2"><span>Credor</span><input name="creditor" required value="${escapeHtml(debt?.creditor || '')}" /></label>
    <label class="field"><span>Saldo devedor</span><input name="balance" type="number" min="0" step="0.01" required value="${debt?.balance ?? ''}" /></label>
    <label class="field"><span>Valor planejado mensal</span><input name="plannedMonthly" type="number" min="0" step="0.01" required value="${debt?.plannedMonthly ?? ''}" /></label>
    <label class="field"><span>Juros ou custo mensal</span><input name="monthlyCost" type="number" min="0" step="0.01" value="${debt?.monthlyCost ?? 0}" /></label>
    <label class="field"><span>Prioridade</span><input name="priority" type="number" min="1" max="10" value="${debt?.priority ?? 3}" /></label>
    <label class="field span-2"><span>Status</span><select name="status">
      ${Object.entries(DEBT_STATUS_LABEL).map(([id, label]) => `<option value="${id}" ${debt?.status === id ? 'selected' : ''}>${label}</option>`).join('')}
    </select></label>
    <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(debt?.note || '')}</textarea></label>`;
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

async function handleDialogClick(event) {
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
    await mutateImportant(async () => {
      if (kind === 'commitment') deleteCommitmentScope(state, targetId, state.currentMonth, scope);
      else deleteEntryScope(state, targetId, state.currentMonth, scope);
    }, 'Excluído', 'Alteração gravada na nuvem.');
  }
}

async function handleEntitySubmit(event) {
  event.preventDefault();
  if (!dialogContext) return;
  const data = Object.fromEntries(new FormData(refs.entityForm));
  try {
    if (dialogContext.mode === 'partial') {
      await mutateImportant(async () => {
        const month = ensureMonth(state, state.currentMonth);
        const entry = month.entries.find((item) => item.id === dialogContext.id);
        if (!entry) throw new Error('Item não encontrado.');
        if (entry.type === ENTRY_TYPES.INSTALLMENT) applyInstallmentPayment(state, entry, data);
        else registerPayment(entry, data);
      }, 'Pagamento registrado', '');
      refs.entityDialog.close();
      dialogContext = null;
      return;
    }
    if (dialogContext.mode === 'advance') {
      await mutateImportant(async () => {
        const commitment = state.commitments.find((item) => item.id === dialogContext.id);
        if (!commitment) throw new Error('Compromisso não encontrado.');
        const count = Math.max(1, Number(data.count) || 1);
        advanceInstallmentCommitment(commitment, count);
        const month = ensureMonth(state, state.currentMonth);
        const entry = month.entries.find((item) => item.commitmentId === commitment.id && item.status !== PAY_STATUS.PAID);
        if (entry) markPaid(entry);
      }, 'Antecipado', '');
      refs.entityDialog.close();
      dialogContext = null;
      return;
    }
    if (dialogContext.mode === 'renegotiate') {
      await mutateImportant(async () => {
        const commitment = state.commitments.find((item) => item.id === dialogContext.id);
        if (!commitment) throw new Error('Compromisso não encontrado.');
        renegotiateCommitment(commitment, data);
      }, 'Renegociado', '');
      refs.entityDialog.close();
      dialogContext = null;
      return;
    }
    if (dialogContext.mode === 'create-debt' || dialogContext.mode === 'edit-debt') {
      await mutateImportant(async () => {
        if (dialogContext.mode === 'edit-debt') {
          const debt = state.debts.find((item) => item.id === dialogContext.id);
          if (!debt) throw new Error('Dívida não encontrada.');
          Object.assign(debt, {
            creditor: data.creditor,
            balance: Number(data.balance),
            plannedMonthly: Number(data.plannedMonthly),
            monthlyCost: Number(data.monthlyCost),
            priority: Number(data.priority),
            status: data.status,
            note: data.note || '',
            remaining: Number(data.balance),
          });
        } else {
          state.debts.push({
            id: makeId('debt'),
            creditor: data.creditor,
            balance: Number(data.balance),
            plannedMonthly: Number(data.plannedMonthly),
            monthlyCost: Number(data.monthlyCost),
            priority: Number(data.priority),
            status: data.status || DEBT_STATUS.ATTACK,
            note: data.note || '',
            paidTotal: 0,
            remaining: Number(data.balance),
          });
        }
        ensureMonth(state, state.currentMonth);
      }, 'Dívida salva', '');
      refs.entityDialog.close();
      dialogContext = null;
      return;
    }
    if (dialogContext.mode === 'edit-commitment') {
      await mutateImportant(async () => {
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
        } else {
          commitment.name = data.name;
          commitment.amount = Number(data.amount);
          commitment.category = data.category || commitment.category;
          commitment.dueDay = Number(data.dueDay) || commitment.dueDay || 1;
          commitment.startDate = data.startDate || commitment.startDate;
          commitment.endDate = data.endDate || '';
          commitment.note = data.note || '';
        }
      }, 'Compromisso atualizado', '');
      refs.entityDialog.close();
      dialogContext = null;
      return;
    }
    await mutateImportant(async () => {
      if (dialogContext.mode === 'edit') await saveEdit(data);
      else await saveCreate(data);
    }, 'Salvo', 'Atualizado.');
    refs.entityDialog.close();
    dialogContext = null;
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
      paymentLog: [],
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
  if (type === 'debt') {
    openDebtForm();
    throw new Error('Use o formulário de dívida.');
  }
  const entryType = {
    income: ENTRY_TYPES.INCOME,
    bill: ENTRY_TYPES.BILL,
    expense: ENTRY_TYPES.EXPENSE,
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
    payments: [],
    status: PAY_STATUS.PENDING,
  };
  if (entry.type === ENTRY_TYPES.INCOME) applyIncomeFields(entry, data);
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
    }
    return;
  }
  entry.name = data.name;
  entry.amount = Number(data.amount);
  entry.category = data.category || entry.category;
  entry.dueDate = data.dueDate || entry.dueDate;
  entry.note = data.note || '';
  if (entry.type === ENTRY_TYPES.INCOME) applyIncomeFields(entry, data);
}

function applyIncomeFields(entry, data) {
  entry.isDaily = data.isDaily === 'on';
  entry.quantity = Math.max(0, Number(data.quantity) || (entry.isDaily ? 1 : 0));
  entry.certainty = Object.values(INCOME_CERTAINTY).includes(data.certainty) ? data.certainty : INCOME_CERTAINTY.FORECAST;
  entry.received = entry.certainty === INCOME_CERTAINTY.RECEIVED;
  if (entry.isDaily) {
    const dailyNet = Number(state.settings.dailyNetValue) || 0;
    if (dailyNet > 0 && entry.quantity > 0) entry.amount = Math.round(entry.quantity * dailyNet * 100) / 100;
    if (!data.category) entry.category = 'Diária';
  }
  if (entry.certainty === INCOME_CERTAINTY.RECEIVED) {
    if (!(entry.payments || []).length) {
      entry.payments = [{ id: makeId('pay'), date: entry.dueDate || toISODate(new Date()), amount: entry.amount, method: 'Recebido', note: '' }];
    }
  } else if (entry.certainty !== INCOME_CERTAINTY.RECEIVED) {
    entry.payments = [];
  }
}

async function handleViewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const month = ensureMonth(state, state.currentMonth);
  const entry = month.entries.find((item) => item.id === id);

  if (action === 'filter') { monthFilter = id; render(); return; }
  if (action === 'open-add') return openAddMenu();
  if (action === 'add-debt') return openDebtForm();
  if (action === 'conflict-use-cloud') return resolveConflictCloud();
  if (action === 'conflict-push-local') return resolveConflictLocal();

  if (action === 'pay-full' && entry) {
    await mutateImportant(async () => {
      if (entry.type === ENTRY_TYPES.INSTALLMENT) applyInstallmentPayment(state, entry, { full: true });
      else markPaid(entry);
    }, 'Pago', entry.name);
    return;
  }
  if (action === 'pay-partial' && entry) return openPartialPay(entry);
  if (action === 'undo-pay' && entry) {
    await mutateImportant(async () => {
      if (entry.type === ENTRY_TYPES.INSTALLMENT) undoInstallmentPayment(state, entry);
      else undoPayment(entry);
    }, 'Desfeito', entry.name);
    return;
  }
  if (action === 'edit-entry' && entry) {
    openCreate(entry.type === ENTRY_TYPES.INSTALLMENT ? 'installment' : entry.type, entry);
    return;
  }
  if (action === 'delete-entry' && entry) return openDeleteScope(entry);

  if (action === 'pay-installment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    await mutateImportant(async () => {
      let row = month.entries.find((item) => item.commitmentId === id && item.status !== PAY_STATUS.PAID);
      if (!row) {
        ensureMonth(state, state.currentMonth);
        row = month.entries.find((item) => item.commitmentId === id);
      }
      if (row) applyInstallmentPayment(state, row, { full: true });
      else advanceInstallmentCommitment(commitment, 1);
    }, 'Parcela paga', commitment.name);
    return;
  }
  if (action === 'partial-installment') {
    const row = month.entries.find((item) => item.commitmentId === id);
    if (row) openPartialPay(row);
    return;
  }
  if (action === 'advance-installment') {
    dialogContext = { mode: 'advance', id };
    refs.dialogEyebrow.textContent = 'ANTECIPAR';
    refs.dialogTitle.textContent = 'Quantas parcelas?';
    refs.dialogSubmit.classList.remove('hidden');
    refs.dialogFields.className = 'dialog-fields';
    refs.dialogFields.innerHTML = `<label class="field"><span>Quantidade</span><input name="count" type="number" min="1" value="1" required /></label>`;
    hideError(refs.dialogError);
    refs.entityDialog.showModal();
    return;
  }
  if (action === 'settle-installment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    const ok = await confirmDialog('Quitar saldo restante?', commitment.name, 'Quitar');
    if (!ok) return;
    await mutateImportant(async () => {
      settleInstallmentCommitment(commitment);
      for (const itemMonth of Object.values(state.months)) {
        for (const row of itemMonth.entries) {
          if (row.commitmentId === id && row.status !== PAY_STATUS.PAID) markPaid(row);
        }
      }
    }, 'Quitado', commitment.name);
    return;
  }
  if (action === 'undo-installment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    await mutateImportant(async () => {
      const paid = [...month.entries].reverse().find((item) => item.commitmentId === id && item.status === PAY_STATUS.PAID);
      if (paid) undoInstallmentPayment(state, paid);
      else rewindInstallmentCommitment(commitment, 1);
    }, 'Desfeito', commitment.name);
    return;
  }
  if (action === 'renegotiate') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    dialogContext = { mode: 'renegotiate', id };
    refs.dialogEyebrow.textContent = 'RENEGOCIAR';
    refs.dialogTitle.textContent = commitment.name;
    refs.dialogSubmit.classList.remove('hidden');
    refs.dialogFields.className = 'dialog-fields';
    refs.dialogFields.innerHTML = `
      <label class="field"><span>Valor da parcela</span><input name="installmentValue" type="number" min="0" step="0.01" value="${commitment.installmentValue}" required /></label>
      <label class="field"><span>Total de parcelas</span><input name="totalInstallments" type="number" min="1" value="${commitment.totalInstallments || 1}" required /></label>
      <label class="field"><span>Parcela atual</span><input name="currentInstallment" type="number" min="1" value="${Math.min(commitment.currentInstallment || 1, commitment.totalInstallments || 1)}" required /></label>
      <label class="field"><span>Próximo vencimento</span><input name="nextDueDate" type="date" value="${commitment.nextDueDate || ''}" required /></label>
      <label class="field span-2"><span>Observação</span><textarea name="note">${escapeHtml(commitment.note || '')}</textarea></label>`;
    hideError(refs.dialogError);
    refs.entityDialog.showModal();
    return;
  }
  if (action === 'edit-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    if (isInstallment(commitment)) {
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
        commitmentId: commitment.id,
      });
      dialogContext = { mode: 'edit-commitment', type: 'bill', id: commitment.id };
    }
    return;
  }
  if (action === 'pause-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    await mutateImportant(async () => {
      commitment.paused = !commitment.paused;
      commitment.status = commitment.paused ? 'paused' : 'active';
    }, commitment.paused ? 'Pausado' : 'Reativado', commitment.name);
    return;
  }
  if (action === 'delete-commitment') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    openDeleteCommitment(commitment);
    return;
  }
  if (action === 'edit-debt') {
    const debt = state.debts.find((item) => item.id === id);
    if (debt) openDebtForm(debt);
    return;
  }
  if (action === 'delete-debt') {
    const debt = state.debts.find((item) => item.id === id);
    if (!debt) return;
    const ok = await confirmDialog('Excluir dívida?', debt.creditor, 'Excluir');
    if (!ok) return;
    await mutateImportant(async () => {
      state.debts = state.debts.filter((item) => item.id !== id);
      for (const itemMonth of Object.values(state.months)) {
        itemMonth.entries = itemMonth.entries.filter((row) => row.debtId !== id);
      }
    }, 'Excluído', debt.creditor);
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
    const ok = await confirmDialog('Zerar tudo?', 'Apaga local e Neon.', 'Zerar');
    if (!ok) return;
    const empty = createEmptyState();
    try {
      const saved = await pushRemoteState(empty, syncRevision);
      syncRevision = Number(saved.revision) || syncRevision + 1;
    } catch (error) {
      if (error.code === 409 && error.payload?.revision != null) {
        const saved = await pushRemoteState(empty, Number(error.payload.revision));
        syncRevision = Number(saved.revision);
      } else {
        toast('Neon falhou', error.message, 'error');
        return;
      }
    }
    wipeVault();
    await createVault(sessionPin, empty);
    state = empty;
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

function openDeleteScope(entry) {
  dialogContext = { mode: 'delete-scope', id: entry.id };
  refs.dialogEyebrow.textContent = 'EXCLUIR';
  refs.dialogTitle.textContent = entry.name;
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  const options = entry.commitmentId
    ? [['one', 'Só este mês'], ['forward', 'Este e os próximos'], ['all', 'Compromisso completo']]
    : [['one', 'Excluir este lançamento']];
  refs.dialogFields.innerHTML = options.map(([scope, label]) => `<button class="choice-card" type="button" data-action="confirm-delete" data-kind="entry" data-id="${entry.id}" data-scope="${scope}"><strong>${label}</strong></button>`).join('');
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

function openDeleteCommitment(commitment) {
  refs.dialogEyebrow.textContent = 'EXCLUIR';
  refs.dialogTitle.textContent = commitment.name;
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  refs.dialogFields.innerHTML = [
    ['one', 'Só este mês'],
    ['forward', 'Este e os próximos'],
    ['all', 'Compromisso completo'],
  ].map(([scope, label]) => `<button class="choice-card" type="button" data-action="confirm-delete" data-kind="commitment" data-id="${commitment.id}" data-scope="${scope}"><strong>${label}</strong></button>`).join('');
  hideError(refs.dialogError);
  refs.entityDialog.showModal();
}

async function handleViewSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'settings') {
    await mutateImportant(async () => {
      state.settings.dailyNetValue = Number(data.dailyNetValue);
      state.settings.saveGoal = Number(data.saveGoal);
      state.settings.frozenDebtFund = Number(data.frozenDebtFund);
      state.settings.safetyMargin = Number(data.safetyMargin);
      state.settings.lockAfterMinutes = Number(data.lockAfterMinutes);
      state.settings.ownerName = String(data.ownerName || '').trim();
    }, 'Salvo', 'Configurações atualizadas.');
  }
}

function updateMonthNav() {
  if (!state || !refs.monthLabelBtn) return;
  refs.monthLabelBtn.textContent = monthLabel(state.currentMonth, true).replace('.', '');
  const isCurrent = state.currentMonth === currentMonthKey();
  refs.monthToday.classList.toggle('hidden', isCurrent);
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

async function mutateImportant(mutator, title, message) {
  if (saving) return false;
  const previous = cloneState(state);
  const previousRevision = syncRevision;
  saving = true;
  try {
    await mutator();
    state = normalizeState(state);
    state.updatedAt = previous.updatedAt;
    state.updatedAt = new Date().toISOString();
    const saved = await pushRemoteState(state, syncRevision);
    syncRevision = Number(saved.revision) || syncRevision + 1;
    if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
    await saveVault(state);
    localStorage.setItem(REVISION_KEY, String(syncRevision));
    cloudOnline = true;
    setSyncStatus('online', 'Neon sincronizada');
    render();
    if (title) toast(title, message);
    return true;
  } catch (error) {
    state = previous;
    syncRevision = previousRevision;
    await saveVault(state).catch(() => {});
    render();
    if (error.code === 409) {
      await handleConflict(error.payload, previous);
      toast('Conflito', 'Nada foi alterado. Escolha a versão.', 'error');
    } else {
      cloudOnline = false;
      setSyncStatus('error', 'Falha no Neon');
      toast('Nada foi alterado', error.message || 'Falha ao gravar no Neon.', 'error');
    }
    return false;
  } finally {
    saving = false;
  }
}

async function handleConflict(payload, localCopy) {
  pendingConflict = {
    remote: payload?.state ? normalizeState(payload.state) : null,
    revision: Number(payload?.revision) || syncRevision,
    updatedAt: payload?.updatedAt || null,
    local: localCopy || cloneState(state),
  };
  if (pendingConflict.remote && payload?.updatedAt) {
    pendingConflict.remote.updatedAt = new Date(payload.updatedAt).toISOString();
  }
  cloudOnline = false;
  setSyncStatus('error', 'Conflito');
  render();
}

async function resolveConflictCloud() {
  if (!pendingConflict?.remote) {
    try {
      const remote = await fetchRemoteState();
      if (!remote.state) return;
      state = normalizeState(remote.state);
      if (remote.updatedAt) state.updatedAt = new Date(remote.updatedAt).toISOString();
      syncRevision = Number(remote.revision) || syncRevision;
    } catch (error) {
      toast('Erro', error.message, 'error');
      return;
    }
  } else {
    state = pendingConflict.remote;
    syncRevision = pendingConflict.revision;
  }
  await saveVault(state);
  localStorage.setItem(REVISION_KEY, String(syncRevision));
  pendingConflict = null;
  cloudOnline = true;
  setSyncStatus('online', 'Neon sincronizada');
  render();
  toast('Nuvem aplicada', 'Versão do Neon em uso.');
}

async function resolveConflictLocal() {
  if (!pendingConflict) return;
  try {
    const expected = pendingConflict.revision;
    const local = pendingConflict.local || state;
    local.updatedAt = new Date().toISOString();
    const saved = await pushRemoteState(local, expected);
    state = normalizeState(local);
    syncRevision = Number(saved.revision) || expected + 1;
    if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
    await saveVault(state);
    localStorage.setItem(REVISION_KEY, String(syncRevision));
    pendingConflict = null;
    cloudOnline = true;
    setSyncStatus('online', 'Neon sincronizada');
    render();
    toast('Local enviado', 'Sua versão foi gravada no Neon.');
  } catch (error) {
    toast('Falha', error.message, 'error');
  }
}

async function syncNow() {
  try {
    const remote = await fetchRemoteState();
    syncRevision = Number(remote.revision) || syncRevision;
    localStorage.setItem(REVISION_KEY, String(syncRevision));
    if (remote?.state) {
      const remoteState = normalizeState(remote.state);
      if (remote.updatedAt) remoteState.updatedAt = new Date(remote.updatedAt).toISOString();
      state = remoteState;
      await saveVault(state);
      cloudOnline = true;
      setSyncStatus('online', 'Neon sincronizada');
      render();
      toast('Sincronizado', 'Dados do Neon carregados.');
      return;
    }
    const saved = await pushRemoteState(state, syncRevision);
    syncRevision = Number(saved.revision) || syncRevision + 1;
    if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
    await saveVault(state);
    localStorage.setItem(REVISION_KEY, String(syncRevision));
    cloudOnline = true;
    setSyncStatus('online', 'Neon sincronizada');
    render();
    toast('Sincronizado', 'Dados enviados.');
  } catch (error) {
    cloudOnline = false;
    setSyncStatus('error', 'Falha no Neon');
    toast('Sync falhou', error.message, 'error');
  }
}

async function handleImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    if (imported.type === 'encrypted-backup') {
      restoreEncryptedBackup(imported.value);
      toast('Backup', 'Restaurado. Entre com o PIN.');
      await lockApp();
      return;
    }
    await mutateImportant(async () => {
      state = normalizeState(imported.value);
    }, 'Importado', 'Dados carregados.');
  } catch (error) {
    toast('Importação falhou', error.message, 'error');
  }
}

function toast(title, message = '', tone = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${message ? `<span>${escapeHtml(message)}</span>` : ''}`;
  refs.toastRegion.append(el);
  setTimeout(() => el.remove(), 4200);
}

function showError(node, message) {
  node.textContent = message;
  node.classList.remove('hidden');
}

function hideError(node) {
  node.textContent = '';
  node.classList.add('hidden');
}

function confirmDialog(title, copy, actionLabel = 'Confirmar') {
  return new Promise((resolve) => {
    refs.confirmTitle.textContent = title;
    refs.confirmCopy.textContent = copy || '';
    refs.confirmAction.textContent = actionLabel;
    const onClose = () => {
      refs.confirmDialog.removeEventListener('close', onClose);
      resolve(refs.confirmDialog.returnValue === 'confirm');
    };
    refs.confirmDialog.addEventListener('close', onClose);
    refs.confirmDialog.showModal();
  });
}
