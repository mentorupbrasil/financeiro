import {
  STATUS,
  addMonths,
  calculateMonth,
  closeCurrentMonth,
  createEmptyState,
  currentMonthKey,
  dueBills,
  ensureMonth,
  makeId,
  monthLabel,
  normalizeState,
  projection,
  scenarios,
} from './model.js';
import {
  changePin,
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
import { brl, clampPercent, emptyState, escapeHtml, formatDueDay, number, percent, statusPill } from './templates.js';

const views = {
  dashboard: ['COMANDO DO MÊS', 'Visão geral'],
  incomes: ['RECEITAS', 'Entradas'],
  bills: ['PLANEJAMENTO', 'Contas do mês'],
  debts: ['PLANO DE ATAQUE', 'Dívidas'],
  envelopes: ['DINHEIRO LIVRE', 'Envelopes semanais'],
  projection: ['PRÓXIMOS PASSOS', 'Projeção de 24 meses'],
  settings: ['CONTROLE E SEGURANÇA', 'Configurações'],
};

const refs = {
  boot: document.querySelector('#boot-screen'),
  setup: document.querySelector('#setup-screen'),
  setupForm: document.querySelector('#setup-form'),
  setupError: document.querySelector('#setup-error'),
  lock: document.querySelector('#lock-screen'),
  unlockForm: document.querySelector('#unlock-form'),
  unlockPin: document.querySelector('#unlock-pin'),
  unlockError: document.querySelector('#unlock-error'),
  app: document.querySelector('#app'),
  viewRoot: document.querySelector('#view-root'),
  viewTitle: document.querySelector('#view-title'),
  viewEyebrow: document.querySelector('#view-eyebrow'),
  monthInput: document.querySelector('#month-input'),
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
};

let state = null;
let currentView = 'dashboard';
let dialogContext = null;
let installPrompt = null;
let idleTimer = null;
let saving = false;

init();

async function init() {
  bindGlobalEvents();
  registerServiceWorker();
  refs.boot.classList.add('hidden');
  if (hasVault()) showLock();
  else showSetup();
}

function bindGlobalEvents() {
  refs.setupForm.addEventListener('submit', handleSetup);
  refs.unlockForm.addEventListener('submit', handleUnlock);
  document.querySelector('#reset-local-data').addEventListener('click', handleForgotPin);
  document.querySelector('#lock-now').addEventListener('click', () => lockApp(true));
  document.querySelector('#quick-add').addEventListener('click', openQuickAdd);
  refs.monthInput.addEventListener('change', handleMonthChange);
  refs.entityForm.addEventListener('submit', handleEntitySubmit);
  refs.entityDialog.addEventListener('click', (event) => {
    const close = event.target.closest('[data-close-dialog]');
    if (close) refs.entityDialog.close();
    const choice = event.target.closest('[data-create-entity]');
    if (choice) {
      const entity = choice.dataset.createEntity;
      refs.entityDialog.close();
      setTimeout(() => openEntityDialog(entity), 80);
    }
  });
  refs.viewRoot.addEventListener('click', handleViewClick);
  refs.viewRoot.addEventListener('submit', handleViewSubmit);
  document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  refs.importFile.addEventListener('change', handleImportFile);

  document.querySelectorAll('[data-nav]').forEach((anchor) => anchor.addEventListener('click', (event) => {
    event.preventDefault();
    setView(anchor.dataset.nav);
  }));

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

  ['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => document.addEventListener(eventName, resetIdleTimer, { passive: true }));
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch (error) { console.warn('Service worker indisponível', error); }
  }
}

function showSetup() {
  refs.setup.classList.remove('hidden');
  refs.lock.classList.add('hidden');
  refs.app.classList.add('hidden');
}

function showLock() {
  refs.lock.classList.remove('hidden');
  refs.setup.classList.add('hidden');
  refs.app.classList.add('hidden');
  refs.unlockForm.reset();
  hideError(refs.unlockError);
  setTimeout(() => refs.unlockPin.focus(), 50);
}

async function handleSetup(event) {
  event.preventDefault();
  const pin = document.querySelector('#setup-pin').value.trim();
  const confirmation = document.querySelector('#setup-pin-confirm').value.trim();
  if (!/^\d{4,12}$/.test(pin)) return showError(refs.setupError, 'Use um PIN de 4 a 12 números.');
  if (pin !== confirmation) return showError(refs.setupError, 'Os dois PINs não são iguais.');
  try {
    hideError(refs.setupError);
    state = createEmptyState();
    await createVault(pin, state);
    launchApp();
    toast('Cofre criado', 'Seus dados já estão protegidos neste dispositivo.', 'success');
  } catch (error) {
    showError(refs.setupError, `Não foi possível criar o cofre: ${error.message}`);
  }
}

async function handleUnlock(event) {
  event.preventDefault();
  const pin = refs.unlockPin.value.trim();
  try {
    hideError(refs.unlockError);
    state = normalizeState(await unlockVault(pin));
    launchApp();
  } catch {
    showError(refs.unlockError, 'PIN incorreto ou dados locais corrompidos.');
  }
}

async function handleForgotPin() {
  const confirmed = await confirmDialog(
    'Apagar os dados deste navegador?',
    'Isso remove o cofre local. Só faça isso se você tiver um arquivo de backup ou quiser recomeçar.',
    'Apagar dados',
  );
  if (!confirmed) return;
  wipeVault();
  location.reload();
}

function launchApp() {
  refs.setup.classList.add('hidden');
  refs.lock.classList.add('hidden');
  refs.app.classList.remove('hidden');
  refs.monthInput.value = state.currentMonth;
  currentView = 'dashboard';
  render();
  resetIdleTimer();
}

function lockApp(manual = false) {
  if (!state) return;
  lockVault();
  clearTimeout(idleTimer);
  state = null;
  showLock();
  if (manual) document.querySelector('#lock-copy').textContent = 'Sistema bloqueado. Digite seu PIN para continuar.';
}

function resetIdleTimer() {
  if (!state) return;
  clearTimeout(idleTimer);
  const minutes = Number(state.settings.lockAfterMinutes) || 0;
  if (minutes > 0) idleTimer = setTimeout(() => lockApp(false), minutes * 60 * 1000);
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
  refs.monthInput.value = state.currentMonth;
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === currentView));

  const renderers = {
    dashboard: renderDashboard,
    incomes: renderIncomes,
    bills: renderBills,
    debts: renderDebts,
    envelopes: renderEnvelopes,
    projection: renderProjection,
    settings: renderSettings,
  };
  refs.viewRoot.innerHTML = renderers[currentView]();
}

function renderDashboard() {
  const calc = calculateMonth(state);
  const upcoming = dueBills(state);
  const scenarioRows = scenarios(state);
  const statusConfig = {
    deficit: { title: 'O mês não fecha', label: 'DÉFICIT', dot: '#f87171' },
    tight: { title: 'Fecha, mas sem respirar', label: 'APERTADO', dot: '#fbbf24' },
    breathe: { title: 'Você está respirando', label: 'MÊS PROTEGIDO', dot: '#4ade80' },
  }[calc.status];
  const targetProgress = calc.minimumBuffer > 0 ? clampPercent((Math.max(0, calc.rawSurplus) / calc.minimumBuffer) * 100) : 100;
  const attackList = calc.month.debts
    .filter((debt) => debt.status !== STATUS.PAID && debt.balance > 0)
    .toSorted((a, b) => (a.status === STATUS.ATTACK ? 0 : 1) - (b.status === STATUS.ATTACK ? 0 : 1) || a.priority - b.priority)
    .slice(0, 4);

  return `
    <div class="grid grid--dashboard">
      <section class="card card--dark status-hero">
        <div>
          <span class="status-label"><span class="status-dot" style="background:${statusConfig.dot}"></span>${statusConfig.label}</span>
          <h2>${statusConfig.title}</h2>
          <p>${escapeHtml(calc.actionText)}</p>
        </div>
        <div class="hero-footer">
          <div>
            <span class="hero-kicker">Sobra ou falta planejada</span>
            <strong class="hero-value">${brl(calc.rawSurplus)}</strong>
          </div>
          <div class="hero-action">
            ${calc.tripsToBreathe == null
              ? 'Cadastre uma entrada do tipo “diária/viagem” para calcular quantas você precisa fazer.'
              : calc.tripsMissing > 0
                ? `<strong>Próximo movimento:</strong> planejar mais ${number(calc.tripsMissing)} diária(s) para proteger a folga mínima.`
                : '<strong>Próximo movimento:</strong> executar o plano e não misturar o dinheiro dos envelopes com contas.'}
          </div>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><div><h2>Plano de distribuição</h2><p>A folga mínima é protegida antes da divisão.</p></div>${statusPill(calc.statusTitle.toUpperCase())}</div>
        <div class="card-body grid">
          <div class="progress-row">
            <div class="progress-labels"><span>Folga mínima protegida</span><span>${brl(calc.safetyReserve)} / ${brl(calc.minimumBuffer)}</span></div>
            <div class="progress ${targetProgress < 100 ? 'progress--warning' : ''}"><span style="width:${targetProgress}%"></span></div>
          </div>
          ${allocationRow('Dinheiro livre', calc.spendBudget, calc.fractions.spend * 100)}
          ${allocationRow('Guardar', calc.saveBudget, calc.fractions.save * 100)}
          ${allocationRow('Atacar dívidas', calc.debtAttack, calc.fractions.debt * 100)}
          <button class="button button--secondary button--full" type="button" data-action="go-envelopes">Ver envelopes semanais</button>
        </div>
      </section>
    </div>

    <section class="grid grid--4 section-gap">
      ${metricCard('Entradas planejadas', calc.totalIncome, '↗', `${brl(calc.receivedIncome)} já recebido`, 'positive')}
      ${metricCard('Saídas planejadas', calc.plannedOut, '▤', `${brl(calc.paidOut)} já pago`)}
      ${metricCard('Livre no mês', calc.spendBudget, '▱', `${brl(calc.envelopeRemaining)} ainda disponível`, calc.envelopeRemaining < 0 ? 'negative' : '')}
      ${metricCard('Saldo de dívidas', calc.debtTotal, '◎', `${brl(calc.frozenDebt)} está congelado`)}
    </section>

    <section class="grid grid--2 section-gap">
      <div class="card">
        <div class="card-header"><div><h2>Quantas diárias precisa?</h2><p>Comparação entre fechar o mês e realmente respirar.</p></div><button class="button button--ghost" type="button" data-action="add-income">Editar renda</button></div>
        <div class="stat-strip">
          <div><span>Planejadas</span><strong>${number(calc.dailyCount)}</strong></div>
          <div><span>Para fechar</span><strong>${calc.tripsToClose == null ? '—' : number(calc.tripsToClose)}</strong></div>
          <div><span>Para respirar</span><strong>${calc.tripsToBreathe == null ? '—' : number(calc.tripsToBreathe)}</strong></div>
        </div>
        <div class="card-body">
          <div class="scenario-grid">
            ${scenarioRows.map((row) => `<div class="scenario-card ${row.current ? 'current' : ''} ${row.surplus < 0 ? 'negative' : 'positive'}">
              <strong>${row.trips}</strong><small>diárias</small><div class="scenario-value">${brl(row.surplus, true)}</div>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><div><h2>Próximas contas</h2><p>Primeiro o que vence e ainda não foi pago.</p></div><button class="button button--ghost" type="button" data-action="go-bills">Ver todas</button></div>
        <div class="card-body">
          ${upcoming.length ? `<div class="list">${upcoming.map((bill) => `<div class="list-item">
            <div class="list-icon">${bill.overdue ? '!' : bill.dueDay || '•'}</div>
            <div class="list-main"><strong>${escapeHtml(bill.name)}</strong><small>${formatDueDay(bill.dueDay)} · ${escapeHtml(bill.category)}${bill.overdue ? ' · atrasada' : ''}</small></div>
            <div class="list-value">${brl(bill.amount)}<small>${bill.essential ? 'essencial' : 'flexível'}</small></div>
          </div>`).join('')}</div>` : emptyState('✓', 'Nenhuma conta pendente', 'As contas cadastradas para este mês estão pagas ou ainda não foram incluídas.')}
        </div>
      </div>
    </section>

    <section class="grid grid--2 section-gap">
      <div class="card">
        <div class="card-header"><div><h2>Fila de ataque</h2><p>Uma dívida por vez, na ordem definida.</p></div><button class="button button--ghost" type="button" data-action="go-debts">Abrir dívidas</button></div>
        <div class="card-body">
          ${attackList.length ? `<div class="list">${attackList.map((debt, index) => `<div class="list-item">
            <div class="list-icon">${index + 1}</div>
            <div class="list-main"><strong>${escapeHtml(debt.creditor)}</strong><small>Prioridade ${debt.priority} · ${debt.status === STATUS.ATTACK ? 'recebe a sobra' : 'aguarda negociação'}</small></div>
            <div class="list-value">${brl(debt.balance)}<small>${statusPill(debt.status)}</small></div>
          </div>`).join('')}</div>` : emptyState('◎', 'Nenhuma dívida ativa', 'Cadastre dívidas para montar a ordem de ataque.', 'Adicionar dívida', 'add-debt')}
        </div>
      </div>

      <div class="card card--accent">
        <div class="card-header"><div><h2>Fechamento do mês</h2><p>Cria o próximo mês e carrega apenas itens recorrentes.</p></div>${calc.month.closed ? statusPill('QUITADA') : ''}</div>
        <div class="card-body grid">
          <div class="callout ${calc.status === 'deficit' ? 'callout--danger' : calc.status === 'tight' ? 'callout--warning' : ''}">
            <div class="callout-icon">${calc.status === 'breathe' ? '✓' : '!'}</div>
            <div><strong>${calc.month.closed ? 'Este mês já está fechado' : 'Confira antes de fechar'}</strong><p>Marque o que foi recebido e pago, registre os gastos dos envelopes e informe quanto pagou em cada dívida.</p></div>
          </div>
          <button class="button button--primary button--full" type="button" data-action="close-month" ${calc.month.closed ? 'disabled' : ''}>Fechar ${escapeHtml(monthLabel(state.currentMonth))} e abrir ${escapeHtml(monthLabel(addMonths(state.currentMonth, 1)))}</button>
        </div>
      </div>
    </section>`;
}

function allocationRow(label, value, percentageValue) {
  return `<div class="list-item"><div class="list-main"><strong>${escapeHtml(label)}</strong><small>${percent(percentageValue)} do valor distribuível</small></div><div class="list-value">${brl(value)}</div></div>`;
}

function metricCard(label, value, icon, foot, valueClass = '') {
  return `<article class="card metric-card"><div class="metric-top"><span class="metric-label">${escapeHtml(label)}</span><span class="metric-icon">${icon}</span></div><strong class="metric-value ${valueClass}">${brl(value)}</strong><div class="metric-foot">${escapeHtml(foot)}</div></article>`;
}

function renderIncomes() {
  const calc = calculateMonth(state);
  const rows = calc.month.incomes;
  return `<section class="card">
    <div class="card-header"><div><h2>Entradas de ${escapeHtml(monthLabel(state.currentMonth))}</h2><p>Salário, diárias, viagens e qualquer dinheiro que entra.</p></div><button class="button button--primary" type="button" data-action="add-income">＋ Nova entrada</button></div>
    <div class="stat-strip"><div><span>Total planejado</span><strong>${brl(calc.totalIncome)}</strong></div><div><span>Já recebido</span><strong>${brl(calc.receivedIncome)}</strong></div><div><span>Diárias planejadas</span><strong>${number(calc.dailyCount)}</strong></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Fonte</th><th>Tipo</th><th class="number">Valor unit.</th><th class="number">Qtd.</th><th class="number">Total</th><th>Status</th><th class="actions">Ações</th></tr></thead><tbody>
      ${rows.map((item) => `<tr><td><div class="table-title">${escapeHtml(item.source)}</div><div class="table-subtitle">${escapeHtml(item.note || (item.recurring ? 'Repete todo mês' : 'Somente este mês'))}</div></td><td>${incomeKindLabel(item.kind)}</td><td class="number">${brl(item.unitValue)}</td><td class="number">${number(item.quantity, 2)}</td><td class="number"><strong>${brl(item.unitValue * item.quantity)}</strong></td><td>${statusPill(item.received ? 'RECEBIDO' : 'PENDENTE')}</td><td class="actions"><button class="icon-button" type="button" title="${item.received ? 'Marcar pendente' : 'Marcar recebido'}" data-action="toggle-income" data-id="${item.id}">${item.received ? '↶' : '✓'}</button><button class="icon-button" type="button" title="Editar" data-action="edit-income" data-id="${item.id}">✎</button><button class="icon-button" type="button" title="Excluir" data-action="delete-income" data-id="${item.id}">×</button></td></tr>`).join('')}
    </tbody></table></div>` : emptyState('↗', 'Nenhuma entrada cadastrada', 'Comece pelo salário e depois adicione diárias, viagens ou extras.', 'Adicionar primeira entrada', 'add-income')}
  </section>`;
}

function renderBills() {
  const calc = calculateMonth(state);
  const rows = calc.month.bills.toSorted((a, b) => (a.paid - b.paid) || (a.dueDay || 99) - (b.dueDay || 99));
  const unpaid = rows.filter((item) => !item.paid).reduce((total, item) => total + item.amount, 0);
  return `<section class="card">
    <div class="card-header"><div><h2>Contas de ${escapeHtml(monthLabel(state.currentMonth))}</h2><p>Tudo que já tem dono antes do dinheiro livre.</p></div><button class="button button--primary" type="button" data-action="add-bill">＋ Nova conta</button></div>
    <div class="stat-strip"><div><span>Total planejado</span><strong>${brl(calc.totalBills)}</strong></div><div><span>Essenciais</span><strong>${brl(calc.essentialBills)}</strong></div><div><span>Ainda falta pagar</span><strong>${brl(unpaid)}</strong></div></div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Conta</th><th>Categoria</th><th>Vencimento</th><th>Prioridade</th><th class="number">Valor</th><th>Status</th><th class="actions">Ações</th></tr></thead><tbody>
      ${rows.map((item) => `<tr><td><div class="table-title">${escapeHtml(item.name)}</div><div class="table-subtitle">${escapeHtml(item.note || (item.recurring ? 'Recorrente' : 'Só neste mês'))}</div></td><td>${escapeHtml(item.category)}</td><td>${formatDueDay(item.dueDay)}</td><td>${item.essential ? statusPill('ATACAR').replace('Atacar', 'Essencial') : statusPill('PENDENTE').replace('Pendente', 'Flexível')}</td><td class="number"><strong>${brl(item.amount)}</strong></td><td>${statusPill(item.paid ? 'PAGO' : 'PENDENTE')}</td><td class="actions"><button class="icon-button" type="button" title="${item.paid ? 'Desmarcar pagamento' : 'Marcar como paga'}" data-action="toggle-bill" data-id="${item.id}">${item.paid ? '↶' : '✓'}</button><button class="icon-button" type="button" title="Editar" data-action="edit-bill" data-id="${item.id}">✎</button><button class="icon-button" type="button" title="Excluir" data-action="delete-bill" data-id="${item.id}">×</button></td></tr>`).join('')}
    </tbody></table></div>` : emptyState('▤', 'Nenhuma conta cadastrada', 'Cadastre primeiro as contas essenciais e os vencimentos.', 'Adicionar primeira conta', 'add-bill')}
  </section>`;
}

function renderDebts() {
  const calc = calculateMonth(state);
  const rows = calc.month.debts.toSorted((a, b) => (a.status === STATUS.PAID) - (b.status === STATUS.PAID) || a.priority - b.priority || a.balance - b.balance);
  return `<div class="grid">
    <section class="grid grid--4">
      ${metricCard('Saldo total', calc.debtTotal, '◎', 'Todas as dívidas ativas')}
      ${metricCard('Para atacar', calc.attackDebt, '→', 'Fila de quitação')}
      ${metricCard('Congeladas', calc.frozenDebt, '❄', 'Aguardar negociação')}
      ${metricCard('Pago neste mês', calc.paidDebtTotal, '✓', 'Baixa no fechamento', 'positive')}
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Mapa de dívidas</h2><p>ATACAR recebe a sobra; JUROS mantém o custo em dia; CONGELADA espera negociação.</p></div><button class="button button--primary" type="button" data-action="add-debt">＋ Nova dívida</button></div>
      ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Credor</th><th>Status</th><th class="number">Prioridade</th><th class="number">Saldo</th><th class="number">Custo/mês</th><th class="number">Planejado</th><th class="number">Pago</th><th class="actions">Ações</th></tr></thead><tbody>
        ${rows.map((item) => `<tr><td><div class="table-title">${escapeHtml(item.creditor)}</div><div class="table-subtitle">${escapeHtml(item.note || 'Sem observação')}</div></td><td>${statusPill(item.status)}</td><td class="number">${item.priority}</td><td class="number"><strong>${brl(item.balance)}</strong></td><td class="number">${brl(item.monthlyCost)}</td><td class="number">${brl(item.plannedPayment)}</td><td class="number">${brl(item.paidThisMonth)}</td><td class="actions"><button class="icon-button" type="button" title="Editar" data-action="edit-debt" data-id="${item.id}">✎</button><button class="icon-button" type="button" title="Excluir" data-action="delete-debt" data-id="${item.id}">×</button></td></tr>`).join('')}
      </tbody></table></div>` : emptyState('◎', 'Nenhuma dívida cadastrada', 'Cadastre os saldos reais e defina o que atacar ou congelar.', 'Adicionar primeira dívida', 'add-debt')}
    </section>
    <section class="card card--accent">
      <div class="card-header"><div><h2>Recomendação automática</h2><p>Baseada na sobra depois da folga mínima.</p></div></div>
      <div class="card-body">
        ${calc.nextDebt ? `<div class="callout"><div class="callout-icon">1</div><div><strong>Atacar ${escapeHtml(calc.nextDebt.creditor)}</strong><p>Valor disponível sugerido: ${brl(calc.debtAttack)}. O saldo atual é ${brl(calc.nextDebt.balance)}.</p></div></div>
          <div class="section-gap"><button class="button button--primary" type="button" data-action="apply-attack" data-id="${calc.nextDebt.id}" ${calc.debtAttack <= 0 ? 'disabled' : ''}>Usar ${brl(Math.min(calc.debtAttack, calc.nextDebt.balance))} como pagamento planejado</button></div>`
          : `<div class="callout"><div class="callout-icon">✓</div><div><strong>Nenhuma dívida na fila ATACAR</strong><p>Você pode reforçar a reserva ou escolher a próxima dívida para negociação.</p></div></div>`}
      </div>
    </section>
  </div>`;
}

function renderEnvelopes() {
  const calc = calculateMonth(state);
  return `<div class="grid">
    <section class="card card--dark">
      <div class="card-body">
        <p class="eyebrow" style="color:#86efac">LIMITE DO MÊS</p>
        <div class="hero-footer" style="margin-top:0"><div><strong class="hero-value">${brl(calc.spendBudget)}</strong><span class="hero-kicker">Pode gastar sem mexer nas contas</span></div><div class="hero-action">Já gastou <strong>${brl(calc.envelopeSpent)}</strong>. Ainda pode <strong>${brl(calc.envelopeRemaining)}</strong>.</div></div>
        <div class="progress progress--dark" style="margin-top:22px"><span style="width:${clampPercent(calc.spendBudget > 0 ? calc.envelopeSpent / calc.spendBudget * 100 : 0)}%"></span></div>
      </div>
    </section>
    <section class="envelope-grid">
      ${calc.month.envelopes.map((item) => {
        const remaining = calc.envelopeLimit - item.spent;
        const used = calc.envelopeLimit > 0 ? clampPercent(item.spent / calc.envelopeLimit * 100) : 0;
        return `<article class="envelope-card ${remaining < 0 ? 'over' : ''}"><div class="metric-top"><div><h3>${escapeHtml(item.name)}</h3><span class="envelope-note">Limite ${brl(calc.envelopeLimit)}</span></div>${statusPill(remaining < 0 ? 'DÉFICIT' : remaining === 0 ? 'PENDENTE' : 'RESPIRA').replace(remaining < 0 ? 'Déficit' : remaining === 0 ? 'Pendente' : 'Respira', remaining < 0 ? 'Estourou' : remaining === 0 ? 'Zerado' : 'Ok')}</div><div class="envelope-value ${remaining < 0 ? 'negative' : ''}">${brl(remaining)}</div><div class="envelope-note">restante nesta semana</div><div class="progress ${remaining < 0 ? 'progress--danger' : used > 80 ? 'progress--warning' : ''}" style="margin-top:14px"><span style="width:${used}%"></span></div><div class="envelope-actions"><button class="button button--secondary" type="button" data-action="edit-envelope" data-id="${item.id}">Registrar gasto</button></div></article>`;
      }).join('')}
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Regra dos envelopes</h2><p>O dinheiro livre não pode financiar conta, dívida ou impulso da próxima semana.</p></div></div>
      <div class="card-body grid grid--3">
        <div class="callout"><div class="callout-icon">1</div><div><strong>Separe no pagamento</strong><p>Contas, reserva e ataque saem antes de qualquer gasto livre.</p></div></div>
        <div class="callout"><div class="callout-icon">2</div><div><strong>Não antecipe semana</strong><p>Se o envelope acabou, espere a próxima semana começar.</p></div></div>
        <div class="callout"><div class="callout-icon">3</div><div><strong>Registre na hora</strong><p>Atualize o gasto logo após pagar para o limite continuar verdadeiro.</p></div></div>
      </div>
    </section>
  </div>`;
}

function renderProjection() {
  const rows = projection(state);
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.surplus)));
  const debtEnd = rows.at(-1)?.remainingDebt || 0;
  return `<div class="grid">
    <section class="grid grid--3">
      ${metricCard('Sobra mensal atual', rows[0]?.surplus || 0, '⌁', 'Mantendo renda e contas atuais', (rows[0]?.surplus || 0) < 0 ? 'negative' : 'positive')}
      ${metricCard('Dívida ao final', debtEnd, '◎', 'Estimativa após 24 meses')}
      ${metricCard('Total guardado', rows.reduce((total, row) => total + row.save, 0), '▣', 'Acumulado projetado', 'positive')}
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Sobra projetada por mês</h2><p>Simulação automática; não é promessa de resultado.</p></div><button class="button button--ghost" type="button" data-action="print">Imprimir</button></div>
      <div class="card-body">
        <div class="projection-chart" aria-label="Gráfico de sobras mensais">
          ${rows.map((row, index) => `<div class="projection-bar-wrap" title="${escapeHtml(monthLabel(row.monthKey))}: ${brl(row.surplus)}"><div class="projection-bar ${row.surplus < 0 ? 'negative' : ''}" style="height:${Math.max(3, Math.abs(row.surplus) / maxAbs * 190)}px"></div>${index % 3 === 0 ? `<span class="projection-label">${escapeHtml(monthLabel(row.monthKey, true).replace(' de ', '/'))}</span>` : ''}</div>`).join('')}
        </div>
      </div>
    </section>
    <section class="card">
      <div class="card-header"><div><h2>Detalhamento de 24 meses</h2><p>A projeção ataca as dívidas na ordem de prioridade.</p></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Mês</th><th class="number">Entradas</th><th class="number">Saídas</th><th class="number">Sobra</th><th class="number">Livre</th><th class="number">Guardar</th><th class="number">Dívida paga</th><th class="number">Saldo de dívidas</th><th>Status</th></tr></thead><tbody>
        ${rows.map((row) => `<tr><td class="table-title">${escapeHtml(monthLabel(row.monthKey))}</td><td class="number">${brl(row.income)}</td><td class="number">${brl(row.out)}</td><td class="number"><strong>${brl(row.surplus)}</strong></td><td class="number">${brl(row.spend)}</td><td class="number">${brl(row.save)}</td><td class="number">${brl(row.debtAttack)}</td><td class="number">${brl(row.remainingDebt)}</td><td>${statusPill(row.status === 'breathe' ? 'RESPIRA' : row.status === 'tight' ? 'APERTADO' : 'DÉFICIT')}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
  </div>`;
}

function renderSettings() {
  const settings = state.settings;
  const totalPercent = Number(settings.spendPercent) + Number(settings.savePercent) + Number(settings.debtPercent);
  return `<div class="grid grid--settings">
    <div class="grid">
      <section class="card">
        <div class="card-header"><div><h2>Regras do comando</h2><p>Defina o que acontece com a sobra depois das contas.</p></div></div>
        <form class="settings-section" data-form="settings">
          <div class="form-grid">
            <label class="field"><span>Folga mínima (R$)</span><input name="minimumBuffer" type="number" min="0" step="0.01" value="${settings.minimumBuffer}" required /></label>
            <label class="field"><span>Bloquear após (minutos)</span><input name="lockAfterMinutes" type="number" min="0" max="240" step="1" value="${settings.lockAfterMinutes}" required /></label>
            <label class="field"><span>% dinheiro livre</span><input name="spendPercent" type="number" min="0" max="100" step="1" value="${settings.spendPercent}" required /></label>
            <label class="field"><span>% guardar</span><input name="savePercent" type="number" min="0" max="100" step="1" value="${settings.savePercent}" required /></label>
            <label class="field"><span>% atacar dívidas</span><input name="debtPercent" type="number" min="0" max="100" step="1" value="${settings.debtPercent}" required /></label>
            <label class="field"><span>Seu nome (opcional)</span><input name="ownerName" type="text" maxlength="60" value="${escapeHtml(settings.ownerName)}" placeholder="Como prefere ser chamado" /></label>
          </div>
          <div class="callout ${totalPercent === 100 ? '' : 'callout--warning'}"><div class="callout-icon">${totalPercent === 100 ? '✓' : '!'}</div><div><strong>Total da divisão: ${percent(totalPercent)}</strong><p>${totalPercent === 100 ? 'A divisão está completa.' : 'O sistema normaliza automaticamente, mas o ideal é somar exatamente 100%.'}</p></div></div>
          <div><button class="button button--primary" type="submit">Salvar regras</button></div>
        </form>
      </section>

      <section class="card">
        <div class="card-header"><div><h2>Trocar PIN</h2><p>O cofre será criptografado novamente com o novo PIN.</p></div></div>
        <form class="settings-section" data-form="change-pin">
          <div class="form-grid">
            <label class="field"><span>PIN atual</span><input name="oldPin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
            <label class="field"><span>Novo PIN</span><input name="newPin" type="password" inputmode="numeric" minlength="4" maxlength="12" required /></label>
          </div>
          <div><button class="button button--secondary" type="submit">Atualizar PIN</button></div>
        </form>
      </section>
    </div>

    <div class="grid">
      <section class="card">
        <div class="card-header"><div><h2>Backup e restauração</h2><p>Seu backup continua criptografado pelo PIN.</p></div></div>
        <div class="settings-section backup-actions">
          <button class="button button--primary button--full" type="button" data-action="export-backup">Baixar backup criptografado</button>
          <button class="button button--secondary button--full" type="button" data-action="import-data">Restaurar ou importar dados</button>
          <div class="callout callout--warning"><div class="callout-icon">!</div><div><strong>Não dependa só do navegador</strong><p>Faça um backup sempre que fechar o mês ou alterar muitas informações.</p></div></div>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><div><h2>Este mês</h2><p>${escapeHtml(monthLabel(state.currentMonth))}</p></div>${state.months[state.currentMonth].closed ? statusPill('QUITADA').replace('Quitada', 'Fechado') : statusPill('PENDENTE').replace('Pendente', 'Aberto')}</div>
        <div class="settings-section">
          <button class="button button--secondary button--full" type="button" data-action="close-month" ${state.months[state.currentMonth].closed ? 'disabled' : ''}>Fechar mês e criar o próximo</button>
          <button class="button button--ghost button--full" type="button" data-action="print">Imprimir painel</button>
        </div>
      </section>

      <section class="card danger-zone">
        <div class="card-header"><div><h2>Zona de risco</h2><p>Ações irreversíveis neste aparelho.</p></div></div>
        <div class="settings-section"><button class="button button--danger button--full" type="button" data-action="wipe-data">Apagar todos os dados locais</button></div>
      </section>
    </div>
  </div>`;
}

function incomeKindLabel(kind) {
  return ({ salary: 'Salário', daily: 'Diária / viagem', extra: 'Extra' })[kind] || 'Extra';
}

async function handleViewClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  const actionMap = {
    'add-income': () => openEntityDialog('income'),
    'add-bill': () => openEntityDialog('bill'),
    'add-debt': () => openEntityDialog('debt'),
    'edit-income': () => openEntityDialog('income', id),
    'edit-bill': () => openEntityDialog('bill', id),
    'edit-debt': () => openEntityDialog('debt', id),
    'edit-envelope': () => openEntityDialog('envelope', id),
    'toggle-income': () => toggleEntity('incomes', id, 'received'),
    'toggle-bill': () => toggleEntity('bills', id, 'paid'),
    'delete-income': () => deleteEntity('incomes', id, 'entrada'),
    'delete-bill': () => deleteEntity('bills', id, 'conta'),
    'delete-debt': () => deleteEntity('debts', id, 'dívida'),
    'go-envelopes': () => setView('envelopes'),
    'go-bills': () => setView('bills'),
    'go-debts': () => setView('debts'),
    'apply-attack': () => applyAttack(id),
    'close-month': closeMonth,
    'export-backup': exportBackup,
    'import-data': () => refs.importFile.click(),
    'print': () => window.print(),
    'wipe-data': wipeAllData,
  };
  if (actionMap[action]) await actionMap[action]();
}

async function handleViewSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'settings') {
    const total = Number(data.spendPercent) + Number(data.savePercent) + Number(data.debtPercent);
    if (total <= 0) return toast('Divisão inválida', 'Os percentuais precisam somar algum valor.', 'error');
    state.settings = {
      ...state.settings,
      minimumBuffer: Number(data.minimumBuffer),
      lockAfterMinutes: Number(data.lockAfterMinutes),
      spendPercent: Number(data.spendPercent),
      savePercent: Number(data.savePercent),
      debtPercent: Number(data.debtPercent),
      ownerName: data.ownerName.trim(),
    };
    await persist('Regras atualizadas', 'O painel foi recalculado com os novos percentuais.');
    resetIdleTimer();
  }
  if (form.dataset.form === 'change-pin') {
    if (!/^\d{4,12}$/.test(data.newPin)) return toast('PIN inválido', 'Use de 4 a 12 números.', 'error');
    try {
      await changePin(state, data.oldPin, data.newPin);
      form.reset();
      toast('PIN atualizado', 'O cofre foi criptografado novamente.', 'success');
    } catch (error) {
      toast('Não foi possível trocar', error.message, 'error');
    }
  }
}

function openQuickAdd() {
  refs.dialogEyebrow.textContent = 'ADIÇÃO RÁPIDA';
  refs.dialogTitle.textContent = 'O que deseja adicionar?';
  refs.dialogFields.innerHTML = `
    <button class="card card-body" style="text-align:left" type="button" data-create-entity="income"><span class="pill pill--success">Entrada</span><h3>Dinheiro que entra</h3><p class="muted">Salário, diária, viagem ou renda extra.</p></button>
    <button class="card card-body" style="text-align:left" type="button" data-create-entity="bill"><span class="pill pill--warning">Conta</span><h3>Dinheiro comprometido</h3><p class="muted">Conta fixa, variável ou parcela.</p></button>
    <button class="card card-body span-2" style="text-align:left" type="button" data-create-entity="debt"><span class="pill pill--danger">Dívida</span><h3>Saldo e plano de ataque</h3><p class="muted">Cadastre, congele ou coloque na fila.</p></button>`;
  refs.dialogSubmit.classList.add('hidden');
  refs.entityDialog.showModal();
}

function openEntityDialog(entity, id = null) {
  dialogContext = { entity, id };
  refs.dialogSubmit.classList.remove('hidden');
  hideError(refs.dialogError);
  const month = state.months[state.currentMonth];
  if (entity === 'income') {
    const item = month.incomes.find((entry) => entry.id === id) || { source: '', kind: 'salary', unitValue: '', quantity: 1, recurring: true, received: false, note: '' };
    setDialog(id ? 'EDITAR ENTRADA' : 'NOVA ENTRADA', id ? item.source : 'Adicionar entrada', incomeFields(item), 'Salvar entrada');
  }
  if (entity === 'bill') {
    const item = month.bills.find((entry) => entry.id === id) || { name: '', amount: '', category: 'Moradia', essential: true, dueDay: '', recurring: true, paid: false, note: '' };
    setDialog(id ? 'EDITAR CONTA' : 'NOVA CONTA', id ? item.name : 'Adicionar conta', billFields(item), 'Salvar conta');
  }
  if (entity === 'debt') {
    const item = month.debts.find((entry) => entry.id === id) || { creditor: '', balance: '', status: STATUS.ATTACK, priority: 1, monthlyCost: 0, plannedPayment: 0, paidThisMonth: 0, costAlreadyInBills: false, note: '' };
    setDialog(id ? 'EDITAR DÍVIDA' : 'NOVA DÍVIDA', id ? item.creditor : 'Adicionar dívida', debtFields(item), 'Salvar dívida');
  }
  if (entity === 'envelope') {
    const item = month.envelopes.find((entry) => entry.id === id);
    setDialog('REGISTRAR GASTO', item?.name || 'Envelope', `<label class="field span-2"><span>Total gasto nesta semana (R$)</span><input name="spent" type="number" min="0" step="0.01" value="${item?.spent || 0}" required /></label><p class="muted span-2">Informe o total acumulado da semana, não apenas a última compra.</p>`, 'Atualizar envelope');
  }
  refs.entityDialog.showModal();
  setTimeout(() => refs.dialogFields.querySelector('input, select, textarea')?.focus(), 80);
}

function setDialog(eyebrow, title, fields, submitLabel) {
  refs.dialogEyebrow.textContent = eyebrow;
  refs.dialogTitle.textContent = title;
  refs.dialogFields.innerHTML = fields;
  refs.dialogSubmit.textContent = submitLabel;
}

function incomeFields(item) {
  return `
    <label class="field span-2"><span>Fonte</span><input name="source" maxlength="80" value="${escapeHtml(item.source)}" placeholder="Ex.: Salário do mês" required /></label>
    <label class="field"><span>Tipo</span><select name="kind"><option value="salary" ${item.kind === 'salary' ? 'selected' : ''}>Salário</option><option value="daily" ${item.kind === 'daily' ? 'selected' : ''}>Diária / viagem</option><option value="extra" ${item.kind === 'extra' ? 'selected' : ''}>Extra</option></select></label>
    <label class="field"><span>Valor unitário (R$)</span><input name="unitValue" type="number" min="0" step="0.01" value="${item.unitValue}" required /></label>
    <label class="field"><span>Quantidade no mês</span><input name="quantity" type="number" min="0" step="0.01" value="${item.quantity}" required /></label>
    <label class="check-row"><input name="received" type="checkbox" ${item.received ? 'checked' : ''} /><span>Já recebi esta entrada</span></label>
    <label class="check-row"><input name="recurring" type="checkbox" ${item.recurring ? 'checked' : ''} /><span>Repetir no próximo mês</span></label>
    <label class="field span-2"><span>Observação</span><textarea name="note" maxlength="250" placeholder="Opcional">${escapeHtml(item.note)}</textarea></label>`;
}

function billFields(item) {
  const categories = ['Moradia', 'Transporte', 'Educação', 'Alimentação', 'Saúde', 'Trabalho', 'Serviços', 'Dívida / juros', 'Outros'];
  return `
    <label class="field span-2"><span>Nome da conta</span><input name="name" maxlength="80" value="${escapeHtml(item.name)}" placeholder="Ex.: Aluguel" required /></label>
    <label class="field"><span>Valor mensal (R$)</span><input name="amount" type="number" min="0" step="0.01" value="${item.amount}" required /></label>
    <label class="field"><span>Categoria</span><select name="category">${categories.map((category) => `<option ${item.category === category ? 'selected' : ''}>${category}</option>`).join('')}</select></label>
    <label class="field"><span>Dia do vencimento</span><input name="dueDay" type="number" min="0" max="31" step="1" value="${item.dueDay}" placeholder="0 = sem data" /></label>
    <label class="check-row"><input name="essential" type="checkbox" ${item.essential ? 'checked' : ''} /><span>É essencial e deve ser priorizada</span></label>
    <label class="check-row"><input name="paid" type="checkbox" ${item.paid ? 'checked' : ''} /><span>Já está paga neste mês</span></label>
    <label class="check-row"><input name="recurring" type="checkbox" ${item.recurring ? 'checked' : ''} /><span>Repetir no próximo mês</span></label>
    <label class="field span-2"><span>Observação</span><textarea name="note" maxlength="250" placeholder="Opcional">${escapeHtml(item.note)}</textarea></label>`;
}

function debtFields(item) {
  return `
    <label class="field span-2"><span>Credor</span><input name="creditor" maxlength="80" value="${escapeHtml(item.creditor)}" placeholder="Nome da pessoa ou instituição" required /></label>
    <label class="field"><span>Saldo atual (R$)</span><input name="balance" type="number" min="0" step="0.01" value="${item.balance}" required /></label>
    <label class="field"><span>Status</span><select name="status"><option ${item.status === STATUS.ATTACK ? 'selected' : ''}>ATACAR</option><option ${item.status === STATUS.INTEREST ? 'selected' : ''}>JUROS</option><option ${item.status === STATUS.FROZEN ? 'selected' : ''}>CONGELADA</option><option ${item.status === STATUS.PAID ? 'selected' : ''}>QUITADA</option></select></label>
    <label class="field"><span>Prioridade</span><input name="priority" type="number" min="0" max="999" step="1" value="${item.priority}" required /></label>
    <label class="field"><span>Custo mensal / juros (R$)</span><input name="monthlyCost" type="number" min="0" step="0.01" value="${item.monthlyCost}" /></label>
    <label class="field"><span>Pagamento planejado (R$)</span><input name="plannedPayment" type="number" min="0" step="0.01" value="${item.plannedPayment}" /></label>
    <label class="field"><span>Pago neste mês (R$)</span><input name="paidThisMonth" type="number" min="0" step="0.01" value="${item.paidThisMonth}" /></label>
    <label class="check-row span-2"><input name="costAlreadyInBills" type="checkbox" ${item.costAlreadyInBills ? 'checked' : ''} /><span>O custo mensal já está cadastrado nas Contas (evita contar duas vezes)</span></label>
    <label class="field span-2"><span>Observação</span><textarea name="note" maxlength="300" placeholder="Acordo, regra ou próximo passo">${escapeHtml(item.note)}</textarea></label>`;
}

async function handleEntitySubmit(event) {
  event.preventDefault();
  if (!dialogContext) return;
  const formData = new FormData(refs.entityForm);
  const values = Object.fromEntries(formData);
  const month = state.months[state.currentMonth];
  try {
    if (dialogContext.entity === 'income') upsert(month.incomes, dialogContext.id, {
      id: dialogContext.id || makeId('income'),
      source: values.source.trim(), kind: values.kind, unitValue: Number(values.unitValue), quantity: Number(values.quantity),
      recurring: formData.has('recurring'), received: formData.has('received'), note: values.note.trim(),
    });
    if (dialogContext.entity === 'bill') upsert(month.bills, dialogContext.id, {
      id: dialogContext.id || makeId('bill'),
      name: values.name.trim(), amount: Number(values.amount), category: values.category, dueDay: Number(values.dueDay) || 0,
      essential: formData.has('essential'), recurring: formData.has('recurring'), paid: formData.has('paid'), note: values.note.trim(),
    });
    if (dialogContext.entity === 'debt') upsert(month.debts, dialogContext.id, {
      id: dialogContext.id || makeId('debt'),
      creditor: values.creditor.trim(), balance: Number(values.balance), status: values.status, priority: Number(values.priority),
      monthlyCost: Number(values.monthlyCost) || 0, plannedPayment: Number(values.plannedPayment) || 0, paidThisMonth: Number(values.paidThisMonth) || 0,
      costAlreadyInBills: formData.has('costAlreadyInBills'), note: values.note.trim(),
    });
    if (dialogContext.entity === 'envelope') {
      const item = month.envelopes.find((entry) => entry.id === dialogContext.id);
      if (item) item.spent = Number(values.spent) || 0;
    }
    refs.entityDialog.close();
    await persist('Salvo', 'O comando do mês foi recalculado.', 'success');
  } catch (error) {
    showError(refs.dialogError, error.message);
  }
}

function upsert(collection, id, item) {
  const index = collection.findIndex((entry) => entry.id === id);
  if (index >= 0) collection[index] = item;
  else collection.push(item);
}

async function toggleEntity(collectionName, id, field) {
  const item = state.months[state.currentMonth][collectionName].find((entry) => entry.id === id);
  if (!item) return;
  item[field] = !item[field];
  await persist('Status atualizado', 'O realizado do mês foi atualizado.', 'success');
}

async function deleteEntity(collectionName, id, label) {
  const confirmed = await confirmDialog(`Excluir esta ${label}?`, 'O registro será removido somente deste mês.', 'Excluir');
  if (!confirmed) return;
  const collection = state.months[state.currentMonth][collectionName];
  const index = collection.findIndex((entry) => entry.id === id);
  if (index >= 0) collection.splice(index, 1);
  await persist('Registro excluído', `A ${label} foi removida.`, 'success');
}

async function applyAttack(id) {
  const calc = calculateMonth(state);
  const debt = calc.month.debts.find((item) => item.id === id);
  if (!debt) return;
  debt.plannedPayment = Math.min(calc.debtAttack, debt.balance);
  await persist('Ataque planejado', `${brl(debt.plannedPayment)} foi planejado para ${debt.creditor}.`, 'success');
}

async function closeMonth() {
  const month = state.months[state.currentMonth];
  if (month.closed) return toast('Mês já fechado', 'Selecione outro mês para continuar.', 'error');
  const confirmed = await confirmDialog(
    `Fechar ${monthLabel(state.currentMonth)}?`,
    'O próximo mês será criado com entradas e contas recorrentes. Os saldos das dívidas diminuem pelo valor registrado como pago neste mês.',
    'Fechar mês',
  );
  if (!confirmed) return;
  const next = closeCurrentMonth(state);
  await persist('Mês fechado', `${monthLabel(next)} foi criado e está pronto para planejamento.`, 'success');
  refs.monthInput.value = next;
}

async function handleMonthChange() {
  const target = refs.monthInput.value;
  if (!target || target === state.currentMonth) return;
  const previous = state.currentMonth;
  ensureMonth(state, target, previous);
  state.currentMonth = target;
  await persist('Mês alterado', `Exibindo ${monthLabel(target)}.`, 'success');
}

async function persist(title = '', message = '', type = 'success') {
  if (saving) return;
  saving = true;
  try {
    state = normalizeState(state);
    state.updatedAt = new Date().toISOString();
    await saveVault(state);
    render();
    if (title) toast(title, message, type);
  } catch (error) {
    toast('Erro ao salvar', error.message, 'error');
  } finally {
    saving = false;
  }
}

function exportBackup() {
  try {
    downloadEncryptedBackup();
    toast('Backup gerado', 'Guarde o arquivo em um local seguro.', 'success');
  } catch (error) {
    toast('Erro no backup', error.message, 'error');
  }
}

async function handleImportFile() {
  const file = refs.importFile.files?.[0];
  refs.importFile.value = '';
  if (!file) return;
  try {
    const imported = await parseImportFile(file);
    if (imported.type === 'encrypted-backup') {
      const confirmed = await confirmDialog('Restaurar backup completo?', 'O cofre atual será substituído. Depois, entre com o PIN usado nesse backup.', 'Restaurar');
      if (!confirmed) return;
      restoreEncryptedBackup(imported.value);
      location.reload();
      return;
    }
    const confirmed = await confirmDialog('Importar estes dados?', 'As informações atuais serão substituídas pelo conteúdo do arquivo, mantendo o PIN deste aparelho.', 'Importar');
    if (!confirmed) return;
    state = normalizeState(imported.value);
    await persist('Dados importados', 'O painel foi preenchido com o arquivo selecionado.', 'success');
  } catch (error) {
    toast('Arquivo não importado', error.message, 'error');
  }
}

async function wipeAllData() {
  const confirmed = await confirmDialog('Apagar tudo deste aparelho?', 'Esta ação remove todos os meses, contas, dívidas e backups locais. Não poderá ser desfeita.', 'Apagar tudo');
  if (!confirmed) return;
  wipeVault();
  location.reload();
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
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<div class="callout-icon">${type === 'error' ? '!' : '✓'}</div><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
  refs.toastRegion.append(element);
  setTimeout(() => element.remove(), 4200);
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove('hidden');
}

function hideError(element) {
  element.textContent = '';
  element.classList.add('hidden');
}
