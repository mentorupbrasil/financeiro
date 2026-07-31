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
  listCommitments,
  markPaid,
  monthEntries,
  monthLabel,
  normalizeState,
  overview,
  projection,
  registerPayment,
  applyDebtBalancePayment,
  reverseDebtBalancePayment,
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
import { applyMoneyMask, brl, emptyState, escapeHtml, metric, moneyInput, parseMoney, statusPill } from './templates.js';

const SESSION_FLAG = 'respira:session-open';
const LOCAL_PIN_KEY = 'respira:local-key-hint';
const NOLOCK_FLAG = 'respira:prefer-nolock';
const REVISION_KEY = 'respira:sync-revision';
const views = {
  overview: ['HOJE', 'Visão geral'],
  month: ['MÊS', 'Mês atual'],
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
let debtFilter = 'all';
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

  const rememberedPin = localStorage.getItem(LOCAL_PIN_KEY) || sessionStorage.getItem(LOCAL_PIN_KEY) || '';
  const remembered = (localStorage.getItem(SESSION_FLAG) === '1' || sessionStorage.getItem(SESSION_FLAG) === '1') && rememberedPin;
  if (remembered) {
    try {
      const ok = await checkSession();
      if (ok && hasVault()) {
        await openWithPin(rememberedPin, { quiet: true, alreadyLoggedIn: true });
        return;
      }
      await openWithPin(rememberedPin, { quiet: true, alreadyLoggedIn: false });
      return;
    } catch {
      clearRememberedSession();
    }
  }
  showLock();
}

function rememberSession(pin) {
  localStorage.setItem(SESSION_FLAG, '1');
  localStorage.setItem(LOCAL_PIN_KEY, pin);
  sessionStorage.removeItem(SESSION_FLAG);
  sessionStorage.removeItem(LOCAL_PIN_KEY);
}

function clearRememberedSession() {
  localStorage.removeItem(SESSION_FLAG);
  localStorage.removeItem(LOCAL_PIN_KEY);
  sessionStorage.removeItem(SESSION_FLAG);
  sessionStorage.removeItem(LOCAL_PIN_KEY);
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
  refs.entityDialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
  });
  refs.confirmDialog.addEventListener('close', () => {
    document.body.classList.remove('dialog-open');
  });
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

  rememberSession(pin);
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
  if (!localStorage.getItem(NOLOCK_FLAG)) {
    if (Number(state.settings.lockAfterMinutes) > 0) {
      state.settings.lockAfterMinutes = 0;
      state.updatedAt = new Date().toISOString();
      saveVault(state).catch(() => {});
      pushRemoteState(state, syncRevision).then((saved) => {
        syncRevision = Number(saved.revision) || syncRevision + 1;
        localStorage.setItem(REVISION_KEY, String(syncRevision));
        if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
        return saveVault(state);
      }).catch(() => {});
    }
    localStorage.setItem(NOLOCK_FLAG, '1');
  }
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
  clearRememberedSession();
  showLock();
}

function resetIdleTimer() {
  if (!state) return;
  clearTimeout(idleTimer);
  const minutes = Number(state.settings.lockAfterMinutes) || 0;
  if (minutes > 0) idleTimer = setTimeout(() => lockApp(), minutes * 60 * 1000);
}

function setView(view) {
  if (view === 'commitments') view = 'debts';
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
    debts: renderDebts,
    history: renderHistory,
    settings: renderSettings,
  };
  refs.viewRoot.innerHTML = map[currentView]();
  if (pendingConflict) refs.viewRoot.insertAdjacentHTML('afterbegin', renderConflictBanner());
  bindMoneyInputs(refs.viewRoot);
}

function bindMoneyInputs(root = document) {
  root.querySelectorAll('.money-input').forEach((input) => {
    if (input.dataset.moneyBound === '1') return;
    input.dataset.moneyBound = '1';
    input.addEventListener('input', () => applyMoneyMask(input));
    input.addEventListener('focus', () => {
      requestAnimationFrame(() => input.select());
    });
    if (input.value && !input.value.includes('R$')) applyMoneyMask(input);
  });
}

function readForm(form) {
  const data = Object.fromEntries(new FormData(form));
  form.querySelectorAll('.money-input[name]').forEach((input) => {
    data[input.name] = parseMoney(input.value);
  });
  return data;
}

function showEntityDialog() {
  hideError(refs.dialogError);
  document.body.classList.add('dialog-open');
  if (!refs.entityDialog.open) refs.entityDialog.showModal();
  bindMoneyInputs(refs.entityDialog);
}

function closeEntityDialog() {
  document.body.classList.remove('dialog-open');
  if (refs.entityDialog.open) refs.entityDialog.close();
  dialogContext = null;
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
  const owner = (state.settings.ownerName || '').trim();
  const greeting = owner ? `Olá, ${escapeHtml(owner)}` : 'Orientação do mês';
  return `
    ${renderOrientation(data, greeting)}

    <section class="grid grid--4 section-gap">
      ${metric('Saldo atual', data.currentBalance, data.currentBalance >= 0 ? 'positive' : 'negative')}
      ${metric('Valor livre', data.free, data.free >= 0 ? 'positive' : 'negative')}
      ${metric('Falta pagar', data.totalPending, 'negative')}
      ${metric('Recebido', data.receivedTotal, 'positive')}
    </section>

    <section class="secondary-metrics section-gap">
      <div><span>Já reservado</span><strong>${brl(data.reserved)}</strong></div>
      <div><span>Falta reservar</span><strong>${brl(data.remainingSave)}</strong></div>
      <div><span>Atrasadas</span><strong class="${data.overdueCount ? 'negative' : ''}">${brl(data.overdueTotal)}</strong></div>
      <div><span>Margem de segurança</span><strong>${brl(data.safety)}</strong></div>
    </section>

    <section class="card section-gap">
      <div class="card-header"><div><h2>Diárias</h2><p>Só receitas recebidas ou garantidas reduzem a meta</p></div></div>
      <div class="card-body">
        ${daily.dailyNet <= 0 ? `<div class="callout callout--warning"><div class="callout-icon">!</div><div><strong>Defina o valor líquido da diária</strong><p>Em Configurações → Regras.</p></div></div>` : `
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
          <div class="list-item"><div class="list-main"><strong>Incluindo fundo das congeladas</strong></div><div class="list-value">${fmtNeed(daily.needForFrozen)}</div></div>
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
      <div class="card-header"><div><h2>Projeção</h2><p>Somente leitura · próximos 6 meses</p></div></div>
      <div class="card-body">
        ${proj.lightest ? `<p class="muted" style="margin:0 0 12px">Mês mais leve: <strong>${escapeHtml(monthLabel(proj.lightest.monthKey))}</strong> · sai ${brl(proj.lightest.out)}</p>` : ''}
        <div class="table-wrap"><table class="data-table"><thead><tr>
          <th>Mês</th><th class="number">Entra</th><th class="number">Sai</th><th class="number">Livre</th><th>Termina</th><th class="number">Libera</th>
        </tr></thead><tbody>
          ${proj.rows.map((row) => `<tr>
            <td>${escapeHtml(monthLabel(row.monthKey))}</td>
            <td class="number">${brl(row.income)}</td>
            <td class="number">${brl(row.out)}</td>
            <td class="number"><strong class="${row.balance >= 0 ? 'positive' : 'negative'}">${brl(row.balance)}</strong></td>
            <td>${row.ending.length ? escapeHtml(row.ending.join(', ')) : '—'}</td>
            <td class="number">${brl(row.released)}</td>
          </tr>`).join('')}
        </tbody></table></div>
      </div>
    </section>`;
}

function renderOrientation(data, greeting) {
  const tips = [];
  const attack = (data.debtsSummary?.debts || [])
    .filter((d) => d.status === DEBT_STATUS.ATTACK && d.balance > 0)
    .toSorted((a, b) => a.priority - b.priority || b.monthlyCost - a.monthlyCost)[0];

  if (data.overdueCount > 0) {
    tips.push(['danger', `Há ${data.overdueCount} item(ns) atrasado(s) (${brl(data.overdueTotal)}). Priorize quitar ou renegociar.`]);
  }
  if (Number(state.settings.dailyNetValue) <= 0) {
    tips.push(['warn', 'Defina o valor líquido da diária em Configurações para o plano de diárias funcionar.']);
  }
  if (data.free < 0) {
    tips.push(['warn', `Valor livre negativo (${brl(data.free)}). Evite gastos extras até as contas e a margem estarem cobertas.`]);
  } else if (data.remainingSave > 0) {
    tips.push(['ok', `Separe ${brl(data.remainingSave)} para a meta de guardar antes de gastar o que sobrar.`]);
  } else if (data.free > 0) {
    tips.push(['ok', `Há ${brl(data.free)} livres após contas, reserva e margem.`]);
  }
  if (attack) {
    tips.push(['ok', `Atacar agora: ${attack.creditor} · saldo ${brl(attack.balance)} · planejado ${brl(attack.plannedMonthly)}.`]);
  } else if ((data.debtsSummary?.debts || []).some((d) => d.status !== DEBT_STATUS.PAID)) {
    tips.push(['ok', 'Nenhuma dívida em Atacar. Revise em Dívidas (Juros / Congelada).']);
  }
  if (!tips.length) {
    tips.push(['ok', 'Mês sob controle. Marque o que entrar e pague o essencial primeiro.']);
  }

  return `<section class="orientation">
    <div class="orientation-head">
      <h2>${greeting}</h2>
      <p>${escapeHtml(monthLabel(state.currentMonth))}</p>
    </div>
    <ul class="orientation-list">
      ${tips.map(([tone, text]) => `<li><span class="tip-mark ${tone === 'ok' ? '' : tone}" aria-hidden="true">${tone === 'danger' ? '!' : tone === 'warn' ? '·' : '✓'}</span><span>${escapeHtml(text)}</span></li>`).join('')}
    </ul>
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
    <div class="segmented" role="tablist" aria-label="Filtrar lançamentos">
      ${filters.map(([id, label]) => `<button class="segmented__item ${monthFilter === id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${monthFilter === id}" data-action="filter" data-id="${id}"><span>${label}</span></button>`).join('')}
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
        </div>`).join('')}</div>` : emptyState('▤', 'Nada neste filtro', 'Use o botão Adicionar no topo para incluir itens.')}
    </section>`;
}

function certaintyLabel(value) {
  if (value === INCOME_CERTAINTY.RECEIVED) return 'Recebida';
  if (value === INCOME_CERTAINTY.GUARANTEED) return 'Garantida';
  return 'Prevista';
}

function isInstallment(item) {
  return [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type);
}

function debtModeLabel(key) {
  const map = {
    fixa: 'Fixa',
    parcelada: 'Parcelada',
    attack: 'Atacar',
    interest: 'Só juros',
    frozen: 'Congelada',
    paid: 'Quitada',
    renegotiated: 'Renegociada',
  };
  return map[key] || key;
}

function debtModePill(key) {
  const tone = key === 'attack' || key === 'parcelada' ? 'danger'
    : key === 'interest' ? 'warning'
      : key === 'frozen' ? 'info'
        : key === 'paid' ? 'success'
          : key === 'fixa' ? 'neutral'
            : 'neutral';
  return `<span class="pill pill--${tone}">${escapeHtml(debtModeLabel(key))}</span>`;
}

function listUnifiedDebts() {
  const commitments = listCommitments(state).map((item) => {
    const parcelada = isInstallment(item);
    const mode = item.paused || item.status === 'paused' ? 'frozen' : (parcelada ? 'parcelada' : 'fixa');
    return {
      source: 'commitment',
      id: item.id,
      name: item.name,
      detail: item.category,
      mode,
      value: item.installmentValue || item.amount,
      valueLabel: parcelada ? 'Parcela' : 'Mensal',
      nextDue: item.nextDue,
      extra: parcelada
        ? (item.meta.finished ? 'Encerrada' : `${item.meta.current || '—'}/${item.meta.total || '—'} · falta ${item.meta.remainingCount ?? '—'} · ${brl(item.meta.remainingValue || 0)}`)
        : (item.paused ? 'Pausada / congelada' : 'Todo mês'),
      raw: item,
    };
  });

  const balances = (state.debts || []).map((debt) => ({
    source: 'debt',
    id: debt.id,
    name: debt.creditor,
    detail: debt.note || DEBT_STATUS_LABEL[debt.status] || '',
    mode: debt.status,
    value: debt.balance,
    valueLabel: 'Saldo',
    monthly: debt.plannedMonthly,
    nextDue: '',
    extra: debt.status === DEBT_STATUS.INTEREST
      ? `Juros/mês ${brl(debt.plannedMonthly || debt.monthlyCost || 0)}`
      : debt.status === DEBT_STATUS.ATTACK
        ? `Planejado ${brl(debt.plannedMonthly)} · prioridade ${debt.priority}`
        : debt.status === DEBT_STATUS.FROZEN
          ? 'Sem pagamento por enquanto'
          : DEBT_STATUS_LABEL[debt.status] || '',
    raw: debt,
  }));

  return [...commitments, ...balances].toSorted((a, b) => {
    const order = { attack: 0, interest: 1, parcelada: 2, fixa: 3, frozen: 4, renegotiated: 5, paid: 6 };
    return (order[a.mode] ?? 9) - (order[b.mode] ?? 9) || a.name.localeCompare(b.name);
  });
}

function renderDebts() {
  const rows = listUnifiedDebts().filter((row) => {
    if (debtFilter === 'all') return row.mode !== 'paid';
    if (debtFilter === 'fixa') return row.mode === 'fixa';
    if (debtFilter === 'parcelada') return row.mode === 'parcelada';
    if (debtFilter === 'attack') return row.mode === 'attack';
    if (debtFilter === 'interest') return row.mode === 'interest';
    if (debtFilter === 'frozen') return row.mode === 'frozen';
    return true;
  });

  const openBalances = (state.debts || []).filter((d) => d.status !== DEBT_STATUS.PAID);
  const balanceTotal = openBalances.reduce((sum, d) => sum + Number(d.balance || 0), 0);
  const parcelRemaining = listCommitments(state)
    .filter((c) => isInstallment(c) && !c.meta.finished)
    .reduce((sum, c) => sum + Number(c.meta.remainingValue || 0), 0);
  const monthlyFixed = listCommitments(state)
    .filter((c) => !isInstallment(c) && !c.paused && c.status !== 'finished')
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const monthlyAttack = openBalances
    .filter((d) => d.status === DEBT_STATUS.ATTACK || d.status === DEBT_STATUS.INTEREST)
    .reduce((sum, d) => sum + Number(d.plannedMonthly || 0), 0);

  const filters = [
    ['all', 'Tudo'],
    ['fixa', 'Fixas'],
    ['parcelada', 'Parceladas'],
    ['attack', 'Atacar'],
    ['interest', 'Juros'],
    ['frozen', 'Congeladas'],
  ];

  const commitmentActions = (item) => {
    const buttons = [];
    if (isInstallment(item) && !item.meta.finished) {
      buttons.push(`<button class="button button--primary button--tiny" type="button" data-action="pay-installment" data-id="${item.id}">Pagar</button>`);
    }
    buttons.push(`<button class="button button--ghost button--tiny" type="button" data-action="commitment-more" data-id="${item.id}">Mais</button>`);
    return buttons.join('');
  };

  return `
    <div class="callout">
      <div class="callout-icon">◈</div>
      <div>
        <strong>Tudo aqui é dívida — o que muda é o jeito de pagar</strong>
        <p>Fixa = todo mês (internet). Parcelada = em X vezes. Atacar = quando sobrar. Só juros = mínimo. Congelada = não paga agora.</p>
      </div>
    </div>

    <section class="grid grid--4 section-gap">
      ${metric('Saldos abertos', balanceTotal, balanceTotal ? 'negative' : '')}
      ${metric('Parcelas restantes', parcelRemaining, parcelRemaining ? 'negative' : '')}
      ${metric('Fixas no mês', monthlyFixed)}
      ${metric('Atacar / juros no mês', monthlyAttack)}
    </section>

    <div class="segmented section-gap" role="tablist" aria-label="Filtrar dívidas">
      ${filters.map(([id, label]) => `<button class="segmented__item ${debtFilter === id ? 'is-active' : ''}" type="button" role="tab" aria-selected="${debtFilter === id}" data-action="debt-filter" data-id="${id}"><span>${label}</span></button>`).join('')}
    </div>

    <section class="card section-gap">
      <div class="card-header"><div><h2>Suas dívidas</h2><p>Adicionar no topo · Conta fixa, Parcelada ou Saldo aberto</p></div></div>
      ${rows.length ? `
        <div class="table-wrap commitments-table"><table class="data-table"><thead><tr>
          <th>Nome</th><th>Tipo</th><th class="number">Valor</th><th>Detalhe</th><th>Vence</th><th></th>
        </tr></thead><tbody>
          ${rows.map((row) => `<tr class="${row.mode === 'attack' ? 'debt-row--attack' : ''}">
            <td><div class="table-title">${escapeHtml(row.name)}</div><div class="table-subtitle">${escapeHtml(row.detail || '')}</div></td>
            <td>${debtModePill(row.mode)}</td>
            <td class="number">${brl(row.value)}<div class="table-subtitle">${escapeHtml(row.valueLabel)}</div></td>
            <td>${escapeHtml(row.extra || '—')}</td>
            <td>${row.nextDue ? formatDateBR(row.nextDue) : '—'}</td>
            <td><div class="row-actions">
              ${row.source === 'commitment' ? commitmentActions(row.raw) : `
                ${row.mode !== 'paid' ? `<button class="button button--primary button--tiny" type="button" data-action="pay-debt" data-id="${row.id}">Pagar</button>` : ''}
                <button class="button button--ghost button--tiny" type="button" data-action="edit-debt" data-id="${row.id}">Editar</button>
                <button class="button button--ghost button--tiny" type="button" data-action="delete-debt" data-id="${row.id}">Excluir</button>
              `}
            </div></td>
          </tr>`).join('')}
        </tbody></table></div>
        <div class="commitment-cards">
          ${rows.map((row) => `<div class="commitment-card">
            <div class="commitment-card__top">
              <div>
                <strong>${escapeHtml(row.name)}</strong>
                <div class="commitment-card__meta">${debtModePill(row.mode)} · ${escapeHtml(row.extra || '')}${row.nextDue ? ` · Vence ${formatDateBR(row.nextDue)}` : ''}</div>
              </div>
              <div class="list-value">${brl(row.value)}<small>${escapeHtml(row.valueLabel)}</small></div>
            </div>
            <div class="commitment-card__actions">
              ${row.source === 'commitment' ? commitmentActions(row.raw) : `
                ${row.mode !== 'paid' ? `<button class="button button--primary button--tiny" type="button" data-action="pay-debt" data-id="${row.id}">Pagar</button>` : ''}
                <button class="button button--ghost button--tiny" type="button" data-action="edit-debt" data-id="${row.id}">Editar</button>
                <button class="button button--ghost button--tiny" type="button" data-action="delete-debt" data-id="${row.id}">Excluir</button>
              `}
            </div>
          </div>`).join('')}
        </div>` : emptyState('◈', 'Nenhuma dívida neste filtro', 'Internet = Conta fixa. Compra em X vezes = Parcelada. Empréstimo/agiota/amigo = Saldo aberto (Atacar, Juros ou Congelada).')}
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
          <label class="field"><span>Valor líquido de uma diária</span>${moneyInput('dailyNetValue', s.dailyNetValue || 0, { required: true })}</label>
          <label class="field"><span>Meta mensal para guardar</span>${moneyInput('saveGoal', s.saveGoal || 0, { required: true })}</label>
          <label class="field"><span>Fundo mensal dívidas congeladas</span>${moneyInput('frozenDebtFund', s.frozenDebtFund || 0, { required: true })}</label>
          <label class="field"><span>Margem mínima de segurança</span>${moneyInput('safetyMargin', s.safetyMargin, { required: true })}</label>
          <label class="field"><span>Bloquear após (minutos)</span><input name="lockAfterMinutes" type="number" min="0" max="240" value="${s.lockAfterMinutes}" required /><small class="muted" style="margin-top:-2px">0 = ficar logado (recomendado no uso pessoal)</small></label>
          <label class="field"><span>Seu nome</span><input name="ownerName" type="text" maxlength="60" value="${escapeHtml(s.ownerName)}" placeholder="Aparece na visão geral" /></label>
        </div>
        <button class="button button--primary" type="submit">Salvar</button>
      </form>
    </section>
    <div class="stack" style="gap:14px">
      <section class="card">
        <div class="card-header"><div><h2>Dados</h2><p>${escapeHtml(brand.domain)} · rev ${syncRevision}</p></div></div>
        <div class="settings-section backup-actions">
          <div class="callout ${cloudOnline ? '' : 'callout--warning'}"><div class="callout-icon">${cloudOnline ? '✓' : '!'}</div><div><strong>${cloudOnline ? 'Neon sincronizada' : 'Neon desatualizada'}</strong><p>${cloudOnline ? 'Último salvamento ok.' : 'Toque em Sincronizar para puxar ou enviar.'}</p></div></div>
          <button class="button button--secondary button--full" type="button" data-action="sync-now">Sincronizar agora</button>
          <button class="button button--primary button--full" type="button" data-action="export-backup">Baixar backup</button>
          <button class="button button--secondary button--full" type="button" data-action="import-data">Importar</button>
        </div>
      </section>
      <section class="card">
        <div class="card-header"><div><h2>Dicas rápidas</h2><p>Ordem no dia do pagamento</p></div></div>
        <div class="settings-section">
          <ul class="tips-list">
            <li><strong>1.</strong> Marque as entradas recebidas.</li>
            <li><strong>2.</strong> Pague e marque as contas essenciais.</li>
            <li><strong>3.</strong> Proteja a margem e a meta de guardar.</li>
            <li><strong>4.</strong> Ataque uma dívida por vez (status Atacar).</li>
            <li><strong>5.</strong> Baixe um backup depois de mudanças grandes.</li>
          </ul>
        </div>
      </section>
      <section class="card danger-zone">
        <div class="card-header"><div><h2>Zona de risco</h2><p>Não tem volta</p></div></div>
        <div class="settings-section">
          <button class="button button--danger button--full" type="button" data-action="wipe-local">Zerar tudo (local + Neon)</button>
        </div>
      </section>
    </div>
  </div>`;
}

function listRow(item) {
  return `<div class="list-item">
    <div class="list-main"><strong>${escapeHtml(item.name)}</strong><small>Vence ${formatDateBR(item.dueDate)} · ${statusPill(item.status)}</small></div>
    <div class="list-value">${brl(item.pendingAmount || item.amount)}</div>
  </div>`;
}

const CATEGORY_OPTIONS = {
  income: ['Salário', 'Diária', 'Extra', 'Reembolso', 'Outros'],
  bill: ['Moradia', 'Energia', 'Água', 'Internet', 'Telefone', 'Transporte', 'Saúde', 'Educação', 'Assinatura', 'Outros'],
  expense: ['Alimentação', 'Transporte', 'Lazer', 'Compras', 'Saúde', 'Outros'],
  installment: ['Parcelado', 'Cartão', 'Financiamento', 'Acordo', 'Outros'],
  reserve: ['Reserva', 'Emergência', 'Meta', 'Congeladas', 'Outros'],
};

function categoryField(type, current = '') {
  const options = CATEGORY_OPTIONS[type] || CATEGORY_OPTIONS.bill;
  const value = current || options[0];
  const list = options.includes(value) ? options : [value, ...options];
  return `<label class="field"><span>Categoria</span><select name="category">${list.map((item) => `<option value="${escapeHtml(item)}" ${item === value ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>`;
}

function openAddMenu() {
  refs.dialogEyebrow.textContent = 'ADICIONAR';
  refs.dialogTitle.textContent = 'O que deseja incluir?';
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  refs.dialogFields.innerHTML = [
    ['income', 'Receita'],
    ['bill', 'Conta fixa'],
    ['installment', 'Parcelada'],
    ['debt', 'Saldo aberto'],
    ['expense', 'Gasto'],
    ['reserve', 'Reserva'],
  ].map(([id, label]) => `<button class="choice-card" type="button" data-create-type="${id}"><strong>${label}</strong></button>`).join('');
  showEntityDialog();
}

function openCreate(type, entry = null) {
  dialogContext = { mode: entry ? 'edit' : 'create', type, id: entry?.id || null };
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  refs.dialogEyebrow.textContent = entry ? 'EDITAR' : 'NOVO';
  refs.dialogTitle.textContent = entry ? entry.name : (TYPE_LABEL[type] || 'Item');
  const today = toISODate(new Date());
  if (type === 'income') {
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" placeholder="Ex.: Diárias da semana" /></label>
      <label class="field"><span>Valor</span>${moneyInput('amount', entry?.amount ?? '', { required: true })}</label>
      ${categoryField('income', entry?.category || 'Diária')}
      <label class="field"><span>Data</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="field"><span>Situação</span><select name="certainty">
        <option value="received" ${entry?.certainty === 'received' || entry?.received ? 'selected' : ''}>Recebida</option>
        <option value="guaranteed" ${entry?.certainty === 'guaranteed' ? 'selected' : ''}>Garantida</option>
        <option value="forecast" ${!entry || entry?.certainty === 'forecast' || (!entry?.received && entry?.certainty !== 'guaranteed' && entry?.certainty !== 'received') ? 'selected' : ''}>Prevista</option>
      </select></label>
      <label class="field"><span>Qtd. diárias</span><input name="quantity" type="number" min="0" step="0.01" value="${entry?.quantity ?? 1}" /></label>
      <label class="check-row span-2"><input name="isDaily" type="checkbox" ${entry?.isDaily ? 'checked' : ''}/><span>É diária (valor = qtd × líquido)</span></label>`;
  } else if (type === 'installment') {
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" /></label>
      <label class="field"><span>Valor da parcela</span>${moneyInput('installmentValue', entry?.amount ?? '', { required: true })}</label>
      ${categoryField('installment', entry?.category || 'Parcelado')}
      <label class="field"><span>Parcela atual</span><input name="currentInstallment" type="number" min="1" required value="${entry?.installmentNumber ?? 1}" /></label>
      <label class="field"><span>Total</span><input name="totalInstallments" type="number" min="1" required value="${entry?.totalInstallments ?? ''}" /></label>
      <label class="field span-2"><span>Próximo vencimento</span><input name="nextDueDate" type="date" required value="${entry?.dueDate || today}" /></label>
      ${entry ? `<label class="field span-2"><span>Aplicar em</span><select name="editScope"><option value="forward">Este e os próximos</option><option value="one">Só este mês</option></select></label>` : ''}`;
  } else if (type === 'bill') {
    const dueDay = entry?.dueDate ? Number(entry.dueDate.slice(8, 10)) : (entry?.dueDay || 1);
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" placeholder="Ex.: Aluguel" /></label>
      <label class="field"><span>Valor</span>${moneyInput('amount', entry?.amount ?? '', { required: true })}</label>
      ${categoryField('bill', entry?.category || 'Moradia')}
      <label class="field"><span>Dia do mês</span><input name="dueDay" type="number" min="1" max="31" value="${dueDay}" required /></label>
      <label class="field"><span>Vencimento</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>
      <label class="check-row span-2"><input name="recurring" type="checkbox" ${entry?.commitmentId || !entry ? 'checked' : ''}/><span>Repetir todo mês</span></label>
      <input type="hidden" name="startDate" value="${entry?.dueDate || today}" />`;
  } else if (type === 'debt') {
    openDebtForm(entry);
    return;
  } else {
    const catType = type === 'reserve' ? 'reserve' : 'expense';
    refs.dialogFields.innerHTML = `
      <label class="field span-2"><span>Nome</span><input name="name" required value="${escapeHtml(entry?.name || '')}" /></label>
      <label class="field"><span>Valor</span>${moneyInput('amount', entry?.amount ?? '', { required: true })}</label>
      ${categoryField(catType, entry?.category || (type === 'reserve' ? 'Reserva' : 'Outros'))}
      <label class="field span-2"><span>Data</span><input name="dueDate" type="date" value="${entry?.dueDate || today}" /></label>`;
  }
  showEntityDialog();
}

function openDebtForm(debt = null) {
  dialogContext = { mode: debt ? 'edit-debt' : 'create-debt', id: debt?.id || null };
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  refs.dialogEyebrow.textContent = debt ? 'EDITAR' : 'NOVA';
  refs.dialogTitle.textContent = debt ? debt.creditor : 'Saldo aberto';
  refs.dialogFields.innerHTML = `
    <label class="field span-2"><span>Credor / nome</span><input name="creditor" required value="${escapeHtml(debt?.creditor || '')}" placeholder="Ex.: Agiota, banco, amigo" /></label>
    <label class="field"><span>Saldo</span>${moneyInput('balance', debt?.balance ?? '', { required: true })}</label>
    <label class="field"><span>Valor do mês</span>${moneyInput('plannedMonthly', debt?.plannedMonthly ?? '', { required: true })}</label>
    <label class="field"><span>Juros/custo</span>${moneyInput('monthlyCost', debt?.monthlyCost ?? 0)}</label>
    <label class="field"><span>Prioridade</span><input name="priority" type="number" min="1" max="10" value="${debt?.priority ?? 3}" /></label>
    <label class="field span-2"><span>Como tratar</span><select name="status">
      <option value="attack" ${!debt || debt?.status === 'attack' ? 'selected' : ''}>Atacar — pago quando sobrar</option>
      <option value="interest" ${debt?.status === 'interest' ? 'selected' : ''}>Só juros — mínimo mensal</option>
      <option value="frozen" ${debt?.status === 'frozen' ? 'selected' : ''}>Congelada — não pago agora</option>
      <option value="paid" ${debt?.status === 'paid' ? 'selected' : ''}>Quitada</option>
      <option value="renegotiated" ${debt?.status === 'renegotiated' ? 'selected' : ''}>Renegociada</option>
    </select></label>`;
  showEntityDialog();
}

async function handleDialogClick(event) {
  if (event.target.closest('[data-close-dialog]')) {
    closeEntityDialog();
    return;
  }
  const choice = event.target.closest('[data-create-type]');
  if (choice) {
    event.preventDefault();
    openCreate(choice.dataset.createType);
    return;
  }
  const menuAction = event.target.closest('[data-from-menu][data-action]');
  if (menuAction) {
    event.preventDefault();
    closeEntityDialog();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await handleViewClick({ target: menuAction });
    return;
  }
  const del = event.target.closest('[data-action="confirm-delete"]');
  if (del) {
    event.preventDefault();
    const scope = del.dataset.scope || 'one';
    const targetId = del.dataset.id;
    const kind = del.dataset.kind || 'entry';
    closeEntityDialog();
    await mutateImportant(async () => {
      if (kind === 'commitment') deleteCommitmentScope(state, targetId, state.currentMonth, scope);
      else deleteEntryScope(state, targetId, state.currentMonth, scope);
    }, 'Excluído', 'Alteração gravada na nuvem.');
  }
}

async function handleEntitySubmit(event) {
  event.preventDefault();
  if (!dialogContext) return;
  const data = readForm(refs.entityForm);
  try {
    if (dialogContext.mode === 'partial') {
      await mutateImportant(async () => {
        const month = ensureMonth(state, state.currentMonth);
        const entry = month.entries.find((item) => item.id === dialogContext.id);
        if (!entry) throw new Error('Item não encontrado.');
        const before = (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
        if (entry.type === ENTRY_TYPES.INSTALLMENT) applyInstallmentPayment(state, entry, data);
        else registerPayment(entry, data);
        const after = (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
        if (entry.debtId) applyDebtBalancePayment(state, entry.debtId, after - before);
      }, 'Pagamento registrado', '');
      closeEntityDialog();
      return;
    }
    if (dialogContext.mode === 'pay-debt') {
      await mutateImportant(async () => {
        const debt = state.debts.find((item) => item.id === dialogContext.id);
        if (!debt) throw new Error('Dívida não encontrada.');
        const amount = Math.max(0, Number(data.amount) || 0);
        if (amount <= 0) throw new Error('Informe um valor.');
        applyDebtBalancePayment(state, debt.id, amount);
        const month = ensureMonth(state, state.currentMonth);
        let entry = month.entries.find((item) => item.debtId === debt.id);
        if (!entry) {
          entry = {
            id: makeId('entry'),
            debtId: debt.id,
            type: ENTRY_TYPES.DEBT,
            name: debt.creditor,
            amount,
            category: 'Dívida',
            dueDate: data.date || toISODate(new Date()),
            note: data.note || '',
            payments: [],
            status: PAY_STATUS.PENDING,
          };
          month.entries.push(entry);
        } else if (amount > entry.amount) {
          entry.amount = amount;
        }
        const pending = Math.max(0, entry.amount - (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0));
        if (pending > 0) {
          registerPayment(entry, {
            amount: Math.min(amount, pending),
            date: data.date,
            method: data.method,
            note: data.note,
          });
        }
      }, 'Pagamento na dívida', '');
      closeEntityDialog();
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
      closeEntityDialog();
      return;
    }
    if (dialogContext.mode === 'renegotiate') {
      await mutateImportant(async () => {
        const commitment = state.commitments.find((item) => item.id === dialogContext.id);
        if (!commitment) throw new Error('Compromisso não encontrado.');
        renegotiateCommitment(commitment, data);
      }, 'Renegociado', '');
      closeEntityDialog();
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
            note: '',
            paidTotal: 0,
            remaining: Number(data.balance),
          });
        }
        ensureMonth(state, state.currentMonth);
      }, 'Dívida salva', '');
      closeEntityDialog();
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
          commitment.needsInfo = !(commitment.totalInstallments && commitment.currentInstallment);
        } else {
          commitment.name = data.name;
          commitment.amount = Number(data.amount);
          commitment.category = data.category || commitment.category;
          commitment.dueDay = Number(data.dueDay) || commitment.dueDay || 1;
          if (data.startDate) commitment.startDate = data.startDate;
        }
      }, 'Compromisso atualizado', '');
      closeEntityDialog();
      return;
    }
    await mutateImportant(async () => {
      if (dialogContext.mode === 'edit') await saveEdit(data);
      else await saveCreate(data);
    }, 'Salvo', 'Atualizado.');
    closeEntityDialog();
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
      commitment.needsInfo = false;
    }
    return;
  }
  entry.name = data.name;
  entry.amount = Number(data.amount);
  entry.category = data.category || entry.category;
  entry.dueDate = data.dueDate || entry.dueDate;
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
  if (action === 'debt-filter') { debtFilter = id; render(); return; }
  if (action === 'open-add') return openAddMenu();
  if (action === 'add-debt') return openDebtForm();
  if (action === 'conflict-use-cloud') return resolveConflictCloud();
  if (action === 'conflict-push-local') return resolveConflictLocal();

  if (action === 'pay-full' && entry) {
    await mutateImportant(async () => {
      const pending = Math.max(0, entry.amount - (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0));
      if (entry.type === ENTRY_TYPES.INSTALLMENT) applyInstallmentPayment(state, entry, { full: true });
      else markPaid(entry);
      if (entry.debtId && pending > 0) applyDebtBalancePayment(state, entry.debtId, pending);
    }, 'Pago', entry.name);
    return;
  }
  if (action === 'pay-partial' && entry) return openPartialPay(entry);
  if (action === 'undo-pay' && entry) {
    await mutateImportant(async () => {
      const paid = (entry.payments || []).reduce((sum, pay) => sum + Number(pay.amount || 0), 0);
      if (entry.type === ENTRY_TYPES.INSTALLMENT) undoInstallmentPayment(state, entry);
      else undoPayment(entry);
      if (entry.debtId && paid > 0) reverseDebtBalancePayment(state, entry.debtId, paid);
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
    showEntityDialog();
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
      <label class="field"><span>Valor da parcela</span>${moneyInput('installmentValue', commitment.installmentValue, { required: true })}</label>
      <label class="field"><span>Total de parcelas</span><input name="totalInstallments" type="number" min="1" value="${commitment.totalInstallments || 1}" required /></label>
      <label class="field"><span>Parcela atual</span><input name="currentInstallment" type="number" min="1" value="${Math.min(commitment.currentInstallment || 1, commitment.totalInstallments || 1)}" required /></label>
      <label class="field"><span>Próximo vencimento</span><input name="nextDueDate" type="date" value="${commitment.nextDueDate || ''}" required /></label>`;
    showEntityDialog();
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
  if (action === 'pay-debt') {
    const debt = state.debts.find((item) => item.id === id);
    if (!debt) return;
    openDebtPay(debt);
    return;
  }
  if (action === 'commitment-more') {
    const commitment = state.commitments.find((item) => item.id === id);
    if (!commitment) return;
    openCommitmentMore(commitment);
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
    clearRememberedSession();
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
    <label class="field"><span>Valor pago</span>${moneyInput('amount', pending, { required: true })}</label>
    <label class="field"><span>Data</span><input name="date" type="date" required value="${toISODate(new Date())}" /></label>
    <label class="field span-2"><span>Forma</span><select name="method"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Boleto</option></select></label>
    <p class="muted span-2" style="margin:0">Falta pagar: ${brl(pending)}</p>`;
  showEntityDialog();
}

function openDebtPay(debt) {
  dialogContext = { mode: 'pay-debt', id: debt.id };
  refs.dialogEyebrow.textContent = 'PAGAR DÍVIDA';
  refs.dialogTitle.textContent = debt.creditor;
  refs.dialogSubmit.classList.remove('hidden');
  refs.dialogFields.className = 'dialog-fields';
  const suggested = Math.min(Number(debt.plannedMonthly) || Number(debt.balance) || 0, Number(debt.balance) || 0);
  refs.dialogFields.innerHTML = `
    <p class="muted span-2" style="margin:0">Saldo atual: <strong>${brl(debt.balance)}</strong></p>
    <label class="field"><span>Valor pago</span>${moneyInput('amount', suggested || '', { required: true })}</label>
    <label class="field"><span>Data</span><input name="date" type="date" required value="${toISODate(new Date())}" /></label>
    <label class="field span-2"><span>Forma</span><select name="method"><option>Pix</option><option>Dinheiro</option><option>Cartão</option><option>Transferência</option><option>Boleto</option></select></label>`;
  showEntityDialog();
}

function openCommitmentMore(commitment) {
  const item = listCommitments(state).find((row) => row.id === commitment.id) || commitment;
  refs.dialogEyebrow.textContent = 'AÇÕES';
  refs.dialogTitle.textContent = commitment.name;
  refs.dialogSubmit.classList.add('hidden');
  refs.dialogFields.className = 'dialog-fields dialog-fields--choices';
  const actions = [];
  if (isInstallment(item) && !item.meta?.finished) {
    actions.push(['partial-installment', 'Pagamento parcial']);
    actions.push(['advance-installment', 'Antecipar parcelas']);
    actions.push(['settle-installment', 'Quitar saldo']);
  }
  if (isInstallment(item)) {
    actions.push(['undo-installment', 'Desfazer último pagamento']);
    actions.push(['renegotiate', 'Renegociar']);
  }
  actions.push(['pause-commitment', item.paused ? 'Reativar' : 'Pausar']);
  actions.push(['edit-commitment', 'Editar']);
  actions.push(['delete-commitment', 'Excluir']);
  refs.dialogFields.innerHTML = actions.map(([action, label]) => `<button class="choice-card" type="button" data-action="${action}" data-id="${commitment.id}" data-from-menu="1"><strong>${label}</strong></button>`).join('');
  showEntityDialog();
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
  showEntityDialog();
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
  showEntityDialog();
}

async function handleViewSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = readForm(form);
  if (form.dataset.form === 'settings') {
    await mutateImportant(async () => {
      state.settings.dailyNetValue = Number(data.dailyNetValue) || 0;
      state.settings.saveGoal = Number(data.saveGoal) || 0;
      state.settings.frozenDebtFund = Number(data.frozenDebtFund) || 0;
      state.settings.safetyMargin = Number(data.safetyMargin) || 0;
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
    const remoteRevision = Number(remote.revision) || 0;
    if (remote?.state) {
      const remoteState = normalizeState(remote.state);
      if (remote.updatedAt) remoteState.updatedAt = new Date(remote.updatedAt).toISOString();
      const localNewer = state?.updatedAt && remoteState.updatedAt
        && new Date(state.updatedAt).getTime() > new Date(remoteState.updatedAt).getTime()
        && syncRevision >= remoteRevision;
      if (localNewer) {
        const push = await confirmDialog(
          'Sua cópia local parece mais recente',
          'Enviar para a nuvem ou carregar a versão do Neon?',
          'Enviar local',
        );
        if (push) {
          const saved = await pushRemoteState(state, remoteRevision);
          syncRevision = Number(saved.revision) || remoteRevision + 1;
          if (saved?.updatedAt) state.updatedAt = new Date(saved.updatedAt).toISOString();
          await saveVault(state);
          localStorage.setItem(REVISION_KEY, String(syncRevision));
          cloudOnline = true;
          setSyncStatus('online', 'Neon sincronizada');
          render();
          toast('Enviado', 'Sua versão foi gravada no Neon.');
          return;
        }
        const pull = await confirmDialog('Carregar Neon?', 'Isso substitui os dados locais pela nuvem.', 'Carregar nuvem');
        if (!pull) return;
      } else if (state?.updatedAt && remoteState.updatedAt && state.updatedAt !== remoteState.updatedAt) {
        const ok = await confirmDialog(
          'Carregar dados da nuvem?',
          'A versão do Neon vai substituir o que está neste dispositivo.',
          'Carregar',
        );
        if (!ok) return;
      }
      state = remoteState;
      syncRevision = remoteRevision || syncRevision;
      await saveVault(state);
      localStorage.setItem(REVISION_KEY, String(syncRevision));
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
      document.body.classList.remove('dialog-open');
      resolve(refs.confirmDialog.returnValue === 'confirm');
    };
    refs.confirmDialog.addEventListener('close', onClose);
    document.body.classList.add('dialog-open');
    if (!refs.confirmDialog.open) refs.confirmDialog.showModal();
  });
}
