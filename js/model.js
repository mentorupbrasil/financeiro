const DEFAULT_SETTINGS = {
  safetyMargin: 300,
  dailyNetValue: 0,
  saveGoal: 0,
  frozenDebtFund: 0,
  lockAfterMinutes: 0,
  ownerName: '',
};

export const PAY_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  PARTIAL: 'partial',
  OVERDUE: 'overdue',
  CANCELLED: 'cancelled',
  RENEGOTIATED: 'renegotiated',
};

export const ENTRY_TYPES = {
  INCOME: 'income',
  BILL: 'bill',
  INSTALLMENT: 'installment',
  DEBT: 'debt',
  EXPENSE: 'expense',
  RESERVE: 'reserve',
};

export const COMMITMENT_TYPES = {
  RECURRING: 'recurring',
  INSTALLMENT: 'installment',
  SUBSCRIPTION: 'subscription',
  FINANCING: 'financing',
  AGREEMENT: 'agreement',
};

export const INCOME_CERTAINTY = {
  RECEIVED: 'received',
  GUARANTEED: 'guaranteed',
  FORECAST: 'forecast',
};

export const DEBT_STATUS = {
  ATTACK: 'attack',
  INTEREST: 'interest',
  FROZEN: 'frozen',
  PAID: 'paid',
  RENEGOTIATED: 'renegotiated',
};

export const DEBT_STATUS_LABEL = {
  attack: 'Atacar',
  interest: 'Só juros',
  frozen: 'Congelada',
  paid: 'Quitada',
  renegotiated: 'Renegociada',
};

export const STATUS_LABEL = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Pago parcialmente',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
  renegotiated: 'Renegociado',
  active: 'Ativo',
  paused: 'Pausado',
  finished: 'Encerrado',
};

export const TYPE_LABEL = {
  income: 'Receita',
  bill: 'Conta',
  installment: 'Parcela',
  debt: 'Dívida',
  expense: 'Gasto',
  reserve: 'Reserva',
  recurring: 'Conta fixa',
  subscription: 'Assinatura',
  financing: 'Financiamento',
  agreement: 'Acordo',
};

export function makeId(prefix = 'item') {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function currentMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split('-').map(Number);
  const date = new Date(year, month - 1 + amount, 1, 12);
  return currentMonthKey(date);
}

export function monthLabel(monthKey, short = false) {
  const [year, month] = monthKey.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    month: short ? 'short' : 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function formatDateBR(value) {
  if (!value) return '—';
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const [y, m, d] = text.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toISODate(date) {
  if (!date) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function monthKeyFromDate(date) {
  return currentMonthKey(new Date(date.getUTCFullYear(), date.getUTCMonth(), 1, 12));
}

function dueDateInMonth(monthKey, dueDay) {
  const [year, month] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(1, dueDay || 1), last);
  return toISODate(new Date(Date.UTC(year, month - 1, day)));
}

function addCalendarMonths(isoDate, amount) {
  const date = parseDate(isoDate);
  if (!date) return '';
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, last));
  return toISODate(next);
}

function normalizePayment(item = {}) {
  return {
    id: item.id || makeId('pay'),
    date: String(item.date || toISODate(new Date()) || ''),
    amount: Math.max(0, toNumber(item.amount)),
    method: String(item.method || 'Pix'),
    note: String(item.note || ''),
  };
}

function paidTotal(entry) {
  return (entry.payments || []).reduce((sum, pay) => sum + toNumber(pay.amount), 0);
}

export function deriveStatus(entry, today = new Date()) {
  if (entry.status === PAY_STATUS.CANCELLED || entry.status === PAY_STATUS.RENEGOTIATED) return entry.status;
  if (entry.type === ENTRY_TYPES.INCOME) {
    const paid = paidTotal(entry);
    if (entry.certainty === INCOME_CERTAINTY.RECEIVED || entry.received || paid > 0) {
      if (paid >= toNumber(entry.amount) - 0.009 || (entry.certainty === INCOME_CERTAINTY.RECEIVED && paid <= 0)) return PAY_STATUS.PAID;
      if (paid > 0 && paid < toNumber(entry.amount) - 0.009) return PAY_STATUS.PARTIAL;
      return PAY_STATUS.PAID;
    }
    return PAY_STATUS.PENDING;
  }
  const paid = paidTotal(entry);
  const amount = toNumber(entry.amount);
  if (amount <= 0) return PAY_STATUS.PAID;
  if (paid >= amount - 0.009) return PAY_STATUS.PAID;
  if (paid > 0) return PAY_STATUS.PARTIAL;
  const due = parseDate(entry.dueDate);
  const todayUtc = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  if (due && due < todayUtc) return PAY_STATUS.OVERDUE;
  return PAY_STATUS.PENDING;
}

function incomeReceivedAmount(entry) {
  if (entry.type !== ENTRY_TYPES.INCOME) return 0;
  const paid = paidTotal(entry);
  if (paid > 0) return paid;
  if (entry.certainty === INCOME_CERTAINTY.RECEIVED || entry.received) return toNumber(entry.amount);
  return 0;
}

function incomeCountsAsGuaranteed(entry) {
  if (entry.type !== ENTRY_TYPES.INCOME) return false;
  if (entry.isDaily) return false;
  if (entry.certainty === INCOME_CERTAINTY.RECEIVED || entry.received) return true;
  if (entry.certainty === INCOME_CERTAINTY.GUARANTEED) return true;
  return false;
}

function normalizeEntry(item = {}) {
  const type = Object.values(ENTRY_TYPES).includes(item.type) ? item.type : ENTRY_TYPES.BILL;
  const payments = Array.isArray(item.payments) ? item.payments.map(normalizePayment) : [];
  let certainty = item.certainty;
  if (!Object.values(INCOME_CERTAINTY).includes(certainty)) {
    if (item.received || paidTotal({ payments }) > 0) certainty = INCOME_CERTAINTY.RECEIVED;
    else certainty = INCOME_CERTAINTY.FORECAST;
  }
  const entry = {
    id: item.id || makeId('entry'),
    commitmentId: item.commitmentId || null,
    debtId: item.debtId || null,
    type,
    name: String(item.name || TYPE_LABEL[type] || 'Item'),
    amount: Math.max(0, toNumber(item.amount)),
    category: String(item.category || 'Geral'),
    dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '',
    note: String(item.note || ''),
    installmentNumber: item.installmentNumber != null ? Math.max(1, Math.round(toNumber(item.installmentNumber, 1))) : null,
    totalInstallments: item.totalInstallments != null ? Math.max(1, Math.round(toNumber(item.totalInstallments, 1))) : null,
    received: Boolean(item.received) || certainty === INCOME_CERTAINTY.RECEIVED,
    certainty: type === ENTRY_TYPES.INCOME ? certainty : null,
    isDaily: Boolean(item.isDaily) || String(item.category || '').toLowerCase() === 'diária' || String(item.category || '').toLowerCase() === 'diaria',
    quantity: Math.max(0, toNumber(item.quantity, item.isDaily ? 1 : 0)),
    payments,
    status: item.status || PAY_STATUS.PENDING,
    needsInfo: Boolean(item.needsInfo),
    direction: type === ENTRY_TYPES.INCOME ? 'in' : 'out',
  };
  if (type === ENTRY_TYPES.INCOME && entry.certainty === INCOME_CERTAINTY.RECEIVED && !payments.length) {
    entry.payments = [normalizePayment({ amount: entry.amount, date: entry.dueDate || toISODate(new Date()), method: 'Recebido', note: '' })];
    entry.received = true;
  }
  entry.status = deriveStatus(entry);
  entry.paidAmount = type === ENTRY_TYPES.INCOME ? incomeReceivedAmount(entry) : paidTotal(entry);
  entry.pendingAmount = Math.max(0, entry.amount - (type === ENTRY_TYPES.INCOME ? entry.paidAmount : paidTotal(entry)));
  return entry;
}

export function installmentMeta(commitment) {
  const total = Math.max(1, toNumber(commitment.totalInstallments, 1));
  let current = Math.max(1, toNumber(commitment.currentInstallment, 1));
  const finished = commitment.status === 'finished' || current > total;
  if (finished) {
    return {
      total,
      current: total + 1,
      value: Math.max(0, toNumber(commitment.installmentValue || commitment.amount)),
      remainingCount: 0,
      remainingValue: 0,
      endDate: commitment.endDate || commitment.nextDueDate || '',
      endMonth: (commitment.endDate || commitment.nextDueDate || '').slice(0, 7) || null,
      finished: true,
    };
  }
  current = Math.min(total, current);
  const value = Math.max(0, toNumber(commitment.installmentValue || commitment.amount));
  const remainingCount = Math.max(0, total - current + 1);
  const nextDue = commitment.nextDueDate || '';
  const endDate = nextDue ? addCalendarMonths(nextDue, Math.max(0, remainingCount - 1)) : '';
  return {
    total,
    current,
    value,
    remainingCount,
    remainingValue: remainingCount * value,
    endDate,
    endMonth: endDate ? monthKeyFromDate(parseDate(endDate)) : null,
    finished: false,
  };
}

function normalizeCommitment(item = {}) {
  const type = Object.values(COMMITMENT_TYPES).includes(item.type) ? item.type : COMMITMENT_TYPES.RECURRING;
  const commitment = {
    id: item.id || makeId('commit'),
    type,
    name: String(item.name || TYPE_LABEL[type] || 'Compromisso'),
    amount: Math.max(0, toNumber(item.amount)),
    category: String(item.category || 'Geral'),
    note: String(item.note || ''),
    dueDay: Math.min(31, Math.max(0, Math.round(toNumber(item.dueDay)))),
    startDate: item.startDate ? String(item.startDate).slice(0, 10) : '',
    endDate: item.endDate ? String(item.endDate).slice(0, 10) : '',
    installmentValue: Math.max(0, toNumber(item.installmentValue || item.amount)),
    totalInstallments: item.totalInstallments != null ? Math.max(1, Math.round(toNumber(item.totalInstallments))) : null,
    currentInstallment: item.currentInstallment != null ? Math.max(1, Math.round(toNumber(item.currentInstallment))) : null,
    nextDueDate: item.nextDueDate ? String(item.nextDueDate).slice(0, 10) : '',
    paused: Boolean(item.paused),
    needsInfo: Boolean(item.needsInfo),
    status: item.status || 'active',
    paymentLog: Array.isArray(item.paymentLog) ? item.paymentLog : [],
  };
  if (type === COMMITMENT_TYPES.INSTALLMENT || type === COMMITMENT_TYPES.FINANCING || type === COMMITMENT_TYPES.AGREEMENT) {
    if (!commitment.totalInstallments || !commitment.currentInstallment) commitment.needsInfo = true;
    if (commitment.currentInstallment > commitment.totalInstallments) commitment.status = 'finished';
  }
  return commitment;
}

function normalizeDebt(item = {}) {
  const status = Object.values(DEBT_STATUS).includes(item.status) ? item.status : DEBT_STATUS.ATTACK;
  const balance = Math.max(0, toNumber(item.balance ?? item.amount));
  const paidTotalAmount = Math.max(0, toNumber(item.paidTotal));
  return {
    id: item.id || makeId('debt'),
    creditor: String(item.creditor || item.name || 'Credor'),
    balance,
    plannedMonthly: Math.max(0, toNumber(item.plannedMonthly ?? item.plannedPayment)),
    monthlyCost: Math.max(0, toNumber(item.monthlyCost ?? item.interest)),
    priority: Math.max(1, Math.round(toNumber(item.priority, 3))),
    status,
    note: String(item.note || ''),
    paidTotal: paidTotalAmount,
    remaining: Math.max(0, balance),
  };
}

function emptyMonth() {
  return {
    entries: [],
    skippedCommitmentIds: [],
    closed: false,
    closedAt: null,
    snapshot: null,
    notes: '',
  };
}

export function createEmptyState(monthKey = currentMonthKey()) {
  return {
    version: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentMonth: monthKey,
    settings: { ...DEFAULT_SETTINGS },
    commitments: [],
    debts: [],
    months: { [monthKey]: emptyMonth() },
  };
}

function cloneState(state) {
  return structuredClone(state);
}

export function normalizeState(input) {
  const previousUpdatedAt = input && typeof input === 'object' ? input.updatedAt : null;
  const raw = input && typeof input === 'object' ? structuredClone(input) : createEmptyState();
  const state = raw.version >= 2 ? raw : createEmptyState(raw.currentMonth);

  // Drop legacy v1-only shapes; keep entries/commitments if present.
  state.version = 3;
  state.createdAt = state.createdAt || new Date().toISOString();
  state.updatedAt = previousUpdatedAt || state.updatedAt || state.createdAt;
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.settings.safetyMargin = Math.max(0, toNumber(state.settings.safetyMargin, 300));
  state.settings.dailyNetValue = Math.max(0, toNumber(state.settings.dailyNetValue, 0));
  state.settings.saveGoal = Math.max(0, toNumber(state.settings.saveGoal, 0));
  state.settings.frozenDebtFund = Math.max(0, toNumber(state.settings.frozenDebtFund, 0));
  state.settings.lockAfterMinutes = Math.max(0, toNumber(state.settings.lockAfterMinutes, 0));
  state.settings.ownerName = String(state.settings.ownerName || '');

  let debts = Array.isArray(state.debts) ? state.debts.map(normalizeDebt) : [];
  const commitments = [];
  for (const item of Array.isArray(state.commitments) ? state.commitments : []) {
    if (item.type === 'debt') {
      debts.push(normalizeDebt({
        id: item.id,
        creditor: item.name,
        balance: item.amount,
        plannedMonthly: item.amount,
        note: item.note,
        status: item.status === 'finished' ? DEBT_STATUS.PAID : item.status === 'paused' ? DEBT_STATUS.FROZEN : DEBT_STATUS.ATTACK,
      }));
      continue;
    }
    commitments.push(normalizeCommitment(item));
  }
  state.commitments = commitments;
  state.debts = debts;

  state.months = state.months && typeof state.months === 'object' ? state.months : {};
  for (const [key, month] of Object.entries(state.months)) {
    const entries = Array.isArray(month.entries) ? month.entries.map(normalizeEntry) : [];
    state.months[key] = {
      entries,
      skippedCommitmentIds: Array.isArray(month.skippedCommitmentIds) ? month.skippedCommitmentIds.map(String) : [],
      closed: Boolean(month.closed),
      closedAt: month.closedAt || null,
      snapshot: month.snapshot || null,
      notes: String(month.notes || ''),
    };
  }
  state.currentMonth = state.currentMonth && state.months[state.currentMonth]
    ? state.currentMonth
    : Object.keys(state.months).sort().at(-1) || currentMonthKey();
  if (!state.months[state.currentMonth]) state.months[state.currentMonth] = emptyMonth();
  return state;
}

export function commitmentActiveInMonth(commitment, monthKey) {
  if (commitment.paused || commitment.status === 'paused' || commitment.status === 'finished' || commitment.status === 'cancelled') return false;
  if (commitment.startDate && monthKey < commitment.startDate.slice(0, 7)) return false;
  if (commitment.endDate && monthKey > commitment.endDate.slice(0, 7)) return false;

  if ([COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)) {
    if (commitment.needsInfo || !commitment.totalInstallments || !commitment.currentInstallment || !commitment.nextDueDate) return false;
    const meta = installmentMeta(commitment);
    if (meta.finished || meta.remainingCount <= 0) return false;
    if (!meta.endMonth) return false;
    const startKey = commitment.nextDueDate.slice(0, 7);
    return monthKey >= startKey && monthKey <= meta.endMonth;
  }
  return true;
}

function installmentNumberForMonth(commitment, monthKey) {
  const nextKey = commitment.nextDueDate?.slice(0, 7);
  if (!nextKey) return commitment.currentInstallment || 1;
  const [sy, sm] = nextKey.split('-').map(Number);
  const [ty, tm] = monthKey.split('-').map(Number);
  const diff = (ty - sy) * 12 + (tm - sm);
  return (commitment.currentInstallment || 1) + diff;
}

function buildEntryFromCommitment(commitment, monthKey) {
  if (commitment.category === 'Receita' && commitment.type === COMMITMENT_TYPES.RECURRING) {
    return normalizeEntry({
      commitmentId: commitment.id,
      type: ENTRY_TYPES.INCOME,
      name: commitment.name,
      amount: commitment.amount,
      category: commitment.category,
      dueDate: dueDateInMonth(monthKey, commitment.dueDay || 1),
      note: commitment.note,
      certainty: INCOME_CERTAINTY.FORECAST,
      isDaily: false,
    });
  }
  if ([COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)) {
    const number = installmentNumberForMonth(commitment, monthKey);
    if (number < 1 || number > commitment.totalInstallments) return null;
    return normalizeEntry({
      commitmentId: commitment.id,
      type: ENTRY_TYPES.INSTALLMENT,
      name: commitment.name,
      amount: commitment.installmentValue || commitment.amount,
      category: commitment.category,
      dueDate: dueDateInMonth(monthKey, commitment.dueDay || parseDate(commitment.nextDueDate)?.getUTCDate() || 1),
      installmentNumber: number,
      totalInstallments: commitment.totalInstallments,
      note: commitment.note,
      needsInfo: commitment.needsInfo,
    });
  }
  return normalizeEntry({
    commitmentId: commitment.id,
    type: ENTRY_TYPES.BILL,
    name: commitment.name,
    amount: commitment.amount,
    category: commitment.category,
    dueDate: dueDateInMonth(monthKey, commitment.dueDay || 1),
    note: commitment.note,
  });
}

function buildDebtEntry(debt, monthKey) {
  if (debt.status === DEBT_STATUS.PAID || debt.status === DEBT_STATUS.RENEGOTIATED) return null;
  if (debt.status === DEBT_STATUS.FROZEN) return null;
  const amount = toNumber(debt.plannedMonthly);
  if (amount <= 0) return null;
  return normalizeEntry({
    debtId: debt.id,
    type: ENTRY_TYPES.DEBT,
    name: debt.creditor,
    amount,
    category: 'Dívida',
    dueDate: dueDateInMonth(monthKey, 10),
    note: debt.note,
  });
}

export function materializeCommitments(state, monthKey) {
  const month = state.months[monthKey];
  if (!month) return;
  if (!Array.isArray(month.skippedCommitmentIds)) month.skippedCommitmentIds = [];
  const existingCommit = new Set(month.entries.filter((item) => item.commitmentId).map((item) => item.commitmentId));
  for (const commitment of state.commitments) {
    if (!commitmentActiveInMonth(commitment, monthKey)) continue;
    if (month.skippedCommitmentIds.includes(commitment.id)) continue;
    if (existingCommit.has(commitment.id)) continue;
    const entry = buildEntryFromCommitment(commitment, monthKey);
    if (entry) month.entries.push(entry);
  }
  const existingDebt = new Set(month.entries.filter((item) => item.debtId).map((item) => item.debtId));
  for (const debt of state.debts || []) {
    if (existingDebt.has(debt.id)) continue;
    if (month.skippedCommitmentIds.includes(debt.id)) continue;
    const entry = buildDebtEntry(debt, monthKey);
    if (entry) month.entries.push(entry);
  }
}

export function ensureMonth(state, monthKey) {
  if (!state.months[monthKey]) state.months[monthKey] = emptyMonth();
  materializeCommitments(state, monthKey);
  return state.months[monthKey];
}

function peekMonthEntries(state, monthKey) {
  const month = state.months[monthKey];
  if (!month) return [];
  return month.entries.map((item) => {
    const entry = normalizeEntry(item);
    entry.status = deriveStatus(entry);
    return entry;
  });
}

export function monthEntries(state, monthKey = state.currentMonth, filter = 'all') {
  ensureMonth(state, monthKey);
  const entries = peekMonthEntries(state, monthKey);
  return entries.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return entry.status === PAY_STATUS.PENDING || entry.status === PAY_STATUS.PARTIAL;
    if (filter === 'paid') return entry.status === PAY_STATUS.PAID;
    if (filter === 'overdue') return entry.status === PAY_STATUS.OVERDUE;
    if (filter === 'in') return entry.type === ENTRY_TYPES.INCOME;
    if (filter === 'out') return entry.type !== ENTRY_TYPES.INCOME;
    return true;
  }).toSorted((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)) || a.name.localeCompare(b.name));
}

function reserveSeparated(entries) {
  return entries
    .filter((item) => item.type === ENTRY_TYPES.RESERVE && item.status !== PAY_STATUS.CANCELLED)
    .reduce((sum, item) => sum + item.paidAmount, 0);
}

function reserveRemaining(state, entries) {
  const goal = toNumber(state.settings.saveGoal);
  return Math.max(0, goal - reserveSeparated(entries));
}

function frozenFundSeparated(entries) {
  return entries
    .filter((item) => item.type === ENTRY_TYPES.RESERVE && /congelad/i.test(`${item.name} ${item.category} ${item.note}`))
    .reduce((sum, item) => sum + item.paidAmount, 0);
}

function frozenFundRemaining(state, entries) {
  const goal = toNumber(state.settings.frozenDebtFund);
  const separated = frozenFundSeparated(entries);
  // If no dedicated frozen reserve entries, treat general remaining of frozen goal.
  if (separated <= 0 && goal > 0) {
    // Use tagged reserves first; otherwise remaining is full goal minus any "fundo" reserves already counted in reserveSeparated with tag
    return goal;
  }
  return Math.max(0, goal - separated);
}

function remainingSaveAndFrozen(state, entries) {
  const saveGoal = toNumber(state.settings.saveGoal);
  const frozenGoal = toNumber(state.settings.frozenDebtFund);
  const allReservePaid = reserveSeparated(entries);
  const taggedFrozen = frozenFundSeparated(entries);
  const savePaid = Math.max(0, allReservePaid - taggedFrozen);
  const remainingSave = Math.max(0, saveGoal - savePaid);
  const remainingFrozen = Math.max(0, frozenGoal - taggedFrozen);
  return { remainingSave, remainingFrozen, savePaid, taggedFrozen, allReservePaid };
}

export function overview(state, monthKey = state.currentMonth) {
  const entries = monthEntries(state, monthKey, 'all');
  const incomes = entries.filter((item) => item.type === ENTRY_TYPES.INCOME);
  const receivedTotal = incomes.reduce((sum, item) => sum + incomeReceivedAmount(item), 0);

  const paymentsMade = entries
    .filter((item) => [ENTRY_TYPES.BILL, ENTRY_TYPES.INSTALLMENT, ENTRY_TYPES.DEBT].includes(item.type))
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const expensesMade = entries
    .filter((item) => item.type === ENTRY_TYPES.EXPENSE)
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const reservesMade = reserveSeparated(entries);

  const currentBalance = receivedTotal - paymentsMade - expensesMade - reservesMade;

  const pendingOut = entries.filter((item) =>
    [ENTRY_TYPES.BILL, ENTRY_TYPES.INSTALLMENT, ENTRY_TYPES.DEBT].includes(item.type)
    && item.status !== PAY_STATUS.CANCELLED
    && item.status !== PAY_STATUS.PAID);
  const totalPending = pendingOut.reduce((sum, item) => sum + item.pendingAmount, 0);
  const { remainingSave } = remainingSaveAndFrozen(state, entries);
  const safety = toNumber(state.settings.safetyMargin);
  const free = currentBalance - totalPending - remainingSave - safety;

  const overdue = pendingOut.filter((item) => item.status === PAY_STATUS.OVERDUE);
  const upcoming = pendingOut.slice(0, 6);
  const endingSoon = state.commitments
    .filter((item) => [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type))
    .map((item) => ({ commitment: item, meta: installmentMeta(item) }))
    .filter((item) => !item.meta.finished && item.meta.remainingCount > 0 && item.meta.remainingCount <= 3)
    .slice(0, 6);

  return {
    currentBalance,
    available: currentBalance,
    receivedTotal,
    totalBills: pendingOut.reduce((sum, item) => sum + item.amount, 0),
    totalPaid: paymentsMade + expensesMade,
    totalPending,
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((sum, item) => sum + item.pendingAmount, 0),
    reserved: reservesMade,
    remainingSave,
    safety,
    free,
    upcoming,
    endingSoon,
    overdue,
    daily: dailyPlan(state, monthKey),
    debtsSummary: debtsSummary(state, monthKey),
  };
}

function ceilDiv(value, divisor) {
  if (divisor <= 0) return null;
  return Math.max(0, Math.ceil(value / divisor));
}

export function dailyPlan(state, monthKey = state.currentMonth) {
  const entries = monthEntries(state, monthKey, 'all');
  const dailyNet = toNumber(state.settings.dailyNetValue);
  const safety = toNumber(state.settings.safetyMargin);
  const { remainingSave, remainingFrozen } = remainingSaveAndFrozen(state, entries);

  const pendingBills = entries
    .filter((item) => [ENTRY_TYPES.BILL, ENTRY_TYPES.EXPENSE].includes(item.type) && item.status !== PAY_STATUS.CANCELLED && item.status !== PAY_STATUS.PAID)
    .reduce((sum, item) => sum + item.pendingAmount, 0);
  const pendingInstallments = entries
    .filter((item) => item.type === ENTRY_TYPES.INSTALLMENT && item.status !== PAY_STATUS.CANCELLED && item.status !== PAY_STATUS.PAID)
    .reduce((sum, item) => sum + item.pendingAmount, 0);
  const plannedDebts = entries
    .filter((item) => item.type === ENTRY_TYPES.DEBT && item.status !== PAY_STATUS.CANCELLED && item.status !== PAY_STATUS.PAID)
    .reduce((sum, item) => sum + item.pendingAmount, 0);

  const guaranteedOther = entries
    .filter((item) => incomeCountsAsGuaranteed(item))
    .reduce((sum, item) => sum + (incomeReceivedAmount(item) || (item.certainty === INCOME_CERTAINTY.GUARANTEED ? item.amount : 0)), 0);

  const dailyIncomes = entries.filter((item) => item.type === ENTRY_TYPES.INCOME && item.isDaily);
  const plannedDailies = dailyIncomes.reduce((sum, item) => {
    if (item.quantity > 0) return sum + item.quantity;
    return sum + (dailyNet > 0 ? item.amount / dailyNet : 0);
  }, 0);

  const baseObligations = pendingBills + pendingInstallments + plannedDebts;
  const monthlyGoal = baseObligations + safety + remainingSave + remainingFrozen;
  const stillNeeded = Math.max(0, monthlyGoal - guaranteedOther);
  const need = (goal) => ceilDiv(Math.max(0, goal - guaranteedOther), dailyNet);
  const needTotal = need(monthlyGoal);
  const surplus = needTotal != null && dailyNet > 0
    ? Math.max(0, (plannedDailies * dailyNet + guaranteedOther) - monthlyGoal)
    : null;

  return {
    dailyNet,
    otherGuaranteed: guaranteedOther,
    pendingBills: pendingBills + pendingInstallments,
    plannedDebts,
    safety,
    saveGoal: remainingSave,
    frozenFund: remainingFrozen,
    monthlyGoal,
    stillNeeded,
    plannedDailies: Math.round(plannedDailies * 100) / 100,
    needForBills: need(pendingBills + pendingInstallments),
    needForSafety: need(pendingBills + pendingInstallments + plannedDebts + safety),
    needForSave: need(pendingBills + pendingInstallments + plannedDebts + safety + remainingSave),
    needForFrozen: need(monthlyGoal),
    needForGoal: needTotal,
    missing: needTotal == null ? null : Math.max(0, needTotal - plannedDailies),
    surplus,
  };
}

function projectedEntriesForMonth(state, monthKey) {
  const existing = state.months[monthKey] ? peekMonthEntries(state, monthKey) : [];
  const byCommit = new Map(existing.filter((e) => e.commitmentId).map((e) => [e.commitmentId, e]));
  const byDebt = new Map(existing.filter((e) => e.debtId).map((e) => [e.debtId, e]));
  const skipped = new Set(state.months[monthKey]?.skippedCommitmentIds || []);
  const list = existing.filter((e) => !e.commitmentId && !e.debtId);

  for (const commitment of state.commitments) {
    if (skipped.has(commitment.id)) continue;
    if (!commitmentActiveInMonth(commitment, monthKey)) continue;
    if (byCommit.has(commitment.id)) {
      list.push(byCommit.get(commitment.id));
      continue;
    }
    const built = buildEntryFromCommitment(commitment, monthKey);
    if (built) list.push(built);
  }
  for (const debt of state.debts || []) {
    if (skipped.has(debt.id)) continue;
    if (byDebt.has(debt.id)) {
      list.push(byDebt.get(debt.id));
      continue;
    }
    const built = buildDebtEntry(debt, monthKey);
    if (built) list.push(built);
  }
  return list;
}

export function projection(state, startMonth = state.currentMonth, length = 12) {
  const temp = cloneState(state);
  const rows = [];
  const safety = toNumber(temp.settings.safetyMargin);

  for (let index = 0; index < length; index += 1) {
    const monthKey = addMonths(startMonth, index);
    const entries = projectedEntriesForMonth(temp, monthKey);
    const income = entries.filter((item) => item.type === ENTRY_TYPES.INCOME).reduce((sum, item) => sum + item.amount, 0);
    const outItems = entries.filter((item) => item.type !== ENTRY_TYPES.INCOME && item.status !== PAY_STATUS.CANCELLED);
    const outCore = outItems
      .filter((item) => item.type !== ENTRY_TYPES.RESERVE)
      .reduce((sum, item) => sum + item.amount, 0);
    const debtOut = outItems.filter((item) => item.type === ENTRY_TYPES.DEBT).reduce((sum, item) => sum + item.amount, 0);
    const { remainingSave, remainingFrozen } = remainingSaveAndFrozen(temp, entries);
    const toReserve = remainingSave;
    const toDebts = debtOut + remainingFrozen;
    const out = outCore + toReserve + remainingFrozen;
    const beforeMargin = income - out;
    const free = beforeMargin - safety;
    const ending = temp.commitments
      .filter((item) => [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type))
      .map((item) => ({ item, meta: installmentMeta(item) }))
      .filter((row) => !row.meta.finished && row.meta.endMonth === monthKey);
    const released = ending.reduce((sum, row) => sum + row.meta.value, 0);
    rows.push({
      monthKey,
      income,
      out,
      toReserve,
      toDebts,
      beforeMargin,
      available: Math.max(0, free),
      balance: free,
      ending: ending.map((row) => row.item.name),
      released,
    });
  }
  const lightest = rows.toSorted((a, b) => a.out - b.out)[0] || null;
  return { rows, lightest };
}

export function listCommitments(state) {
  return state.commitments.map((item) => {
    const commitment = normalizeCommitment(item);
    const meta = [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)
      ? installmentMeta(commitment)
      : {
          remainingCount: null,
          remainingValue: commitment.amount,
          endDate: commitment.endDate || '',
          endMonth: commitment.endDate ? commitment.endDate.slice(0, 7) : null,
          current: null,
          total: null,
          value: commitment.amount,
          finished: commitment.status === 'finished',
        };
    return {
      ...commitment,
      meta,
      nextDue: commitment.nextDueDate || (commitment.dueDay ? dueDateInMonth(state.currentMonth, commitment.dueDay) : ''),
      typeLabel: TYPE_LABEL[commitment.type] || commitment.type,
      statusLabel: STATUS_LABEL[commitment.status] || commitment.status,
    };
  }).toSorted((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)) || a.name.localeCompare(b.name));
}

export function debtsSummary(state, monthKey = state.currentMonth) {
  const debts = (state.debts || []).map(normalizeDebt);
  const entries = peekMonthEntries(state, monthKey);
  const monthDebtPaid = entries
    .filter((item) => item.type === ENTRY_TYPES.DEBT)
    .reduce((sum, item) => sum + item.paidAmount, 0);
  const { taggedFrozen, remainingFrozen } = remainingSaveAndFrozen(state, entries.length ? entries : monthEntries(state, monthKey));
  const totalBalance = debts.filter((d) => d.status !== DEBT_STATUS.PAID).reduce((sum, d) => sum + d.balance, 0);
  const totalPaid = debts.reduce((sum, d) => sum + d.paidTotal, 0);
  const plannedMonth = debts
    .filter((d) => d.status === DEBT_STATUS.ATTACK || d.status === DEBT_STATUS.INTEREST)
    .reduce((sum, d) => sum + d.plannedMonthly, 0);
  return {
    debts,
    totalBalance,
    totalPaid,
    remaining: totalBalance,
    plannedMonth,
    monthDebtPaid,
    frozenFundAccumulated: taggedFrozen,
    frozenFundRemaining: remainingFrozen,
  };
}

export function deleteEntryScope(state, entryId, monthKey, scope) {
  const month = ensureMonth(state, monthKey);
  const entry = month.entries.find((item) => item.id === entryId);
  if (!entry) return;

  if (scope === 'one' || !entry.commitmentId) {
    month.entries = month.entries.filter((item) => item.id !== entryId);
    if (entry.commitmentId && !month.skippedCommitmentIds.includes(entry.commitmentId)) {
      month.skippedCommitmentIds.push(entry.commitmentId);
    }
    if (entry.debtId && !month.skippedCommitmentIds.includes(entry.debtId)) {
      month.skippedCommitmentIds.push(entry.debtId);
    }
    return;
  }
  if (scope === 'forward') {
    deleteCommitmentFrom(state, entry.commitmentId, monthKey);
    return;
  }
  deleteCommitmentAll(state, entry.commitmentId);
}

export function deleteCommitmentScope(state, commitmentId, monthKey, scope) {
  if (scope === 'one') {
    const month = ensureMonth(state, monthKey);
    month.entries = month.entries.filter((row) => row.commitmentId !== commitmentId);
    if (!month.skippedCommitmentIds.includes(commitmentId)) month.skippedCommitmentIds.push(commitmentId);
    return;
  }
  if (scope === 'forward') {
    deleteCommitmentFrom(state, commitmentId, monthKey);
    return;
  }
  deleteCommitmentAll(state, commitmentId);
}

function deleteCommitmentFrom(state, commitmentId, monthKey) {
  const commitment = state.commitments.find((item) => item.id === commitmentId);
  for (const [key, itemMonth] of Object.entries(state.months)) {
    if (key < monthKey) continue;
    itemMonth.entries = itemMonth.entries.filter((row) => row.commitmentId !== commitmentId);
    if (!itemMonth.skippedCommitmentIds) itemMonth.skippedCommitmentIds = [];
    if (!itemMonth.skippedCommitmentIds.includes(commitmentId)) itemMonth.skippedCommitmentIds.push(commitmentId);
  }
  if (commitment) {
    const prev = addMonths(monthKey, -1);
    commitment.endDate = `${prev}-28`;
    if ([COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)) {
      commitment.status = 'finished';
    }
  }
}

function deleteCommitmentAll(state, commitmentId) {
  state.commitments = state.commitments.filter((item) => item.id !== commitmentId);
  for (const itemMonth of Object.values(state.months)) {
    itemMonth.entries = itemMonth.entries.filter((row) => row.commitmentId !== commitmentId);
    if (itemMonth.skippedCommitmentIds) {
      itemMonth.skippedCommitmentIds = itemMonth.skippedCommitmentIds.filter((id) => id !== commitmentId);
    }
  }
}

export function history(state) {
  const current = state.currentMonth;
  return Object.keys(state.months)
    .filter((key) => key < current)
    .sort()
    .reverse()
    .map((monthKey) => {
      const entries = peekMonthEntries(state, monthKey);
      const income = entries
        .filter((item) => item.type === ENTRY_TYPES.INCOME)
        .reduce((sum, item) => sum + incomeReceivedAmount(item), 0);
      const payments = entries
        .filter((item) => [ENTRY_TYPES.BILL, ENTRY_TYPES.INSTALLMENT, ENTRY_TYPES.DEBT].includes(item.type))
        .reduce((sum, item) => sum + item.paidAmount, 0);
      const expenses = entries
        .filter((item) => item.type === ENTRY_TYPES.EXPENSE)
        .reduce((sum, item) => sum + item.paidAmount, 0);
      const reserves = reserveSeparated(entries);
      const out = payments + expenses + reserves;
      return {
        monthKey,
        income,
        out,
        paidCount: entries.filter((item) => item.type !== ENTRY_TYPES.INCOME && item.status === PAY_STATUS.PAID).length,
        overdueCount: entries.filter((item) => item.status === PAY_STATUS.OVERDUE).length,
        balance: income - out,
      };
    });
}

export function registerPayment(entry, { amount, date, method, note }) {
  const payAmount = Math.max(0, toNumber(amount));
  if (payAmount <= 0) return entry;
  entry.payments = [...(entry.payments || []), normalizePayment({ amount: payAmount, date, method, note })];
  if (entry.type === ENTRY_TYPES.INCOME) {
    entry.received = paidTotal(entry) >= entry.amount - 0.009;
    entry.certainty = entry.received ? INCOME_CERTAINTY.RECEIVED : entry.certainty;
  }
  entry.status = deriveStatus(entry);
  entry.paidAmount = entry.type === ENTRY_TYPES.INCOME ? incomeReceivedAmount(entry) : paidTotal(entry);
  entry.pendingAmount = Math.max(0, entry.amount - paidTotal(entry));
  return entry;
}

export function undoLastPayment(entry) {
  if (!(entry.payments || []).length) return entry;
  entry.payments = entry.payments.slice(0, -1);
  if (entry.type === ENTRY_TYPES.INCOME) {
    entry.received = paidTotal(entry) >= entry.amount - 0.009;
    if (!entry.received && entry.certainty === INCOME_CERTAINTY.RECEIVED) entry.certainty = INCOME_CERTAINTY.FORECAST;
  }
  entry.status = deriveStatus(entry);
  entry.paidAmount = entry.type === ENTRY_TYPES.INCOME ? incomeReceivedAmount(entry) : paidTotal(entry);
  entry.pendingAmount = Math.max(0, entry.amount - paidTotal(entry));
  return entry;
}

export function undoPayment(entry) {
  entry.payments = [];
  entry.received = false;
  if (entry.type === ENTRY_TYPES.INCOME && entry.certainty === INCOME_CERTAINTY.RECEIVED) {
    entry.certainty = INCOME_CERTAINTY.FORECAST;
  }
  if (entry.status !== PAY_STATUS.CANCELLED && entry.status !== PAY_STATUS.RENEGOTIATED) entry.status = PAY_STATUS.PENDING;
  entry.status = deriveStatus(entry);
  entry.paidAmount = 0;
  entry.pendingAmount = entry.amount;
  return entry;
}

export function markPaid(entry, date = toISODate(new Date())) {
  const pending = Math.max(0, entry.amount - paidTotal(entry));
  if (pending > 0) registerPayment(entry, { amount: pending, date, method: 'Marcado pago', note: '' });
  return entry;
}

export function applyDebtBalancePayment(state, debtId, amount) {
  const debt = (state.debts || []).find((item) => item.id === debtId);
  if (!debt || amount <= 0) return null;
  const pay = Math.max(0, toNumber(amount));
  debt.paidTotal = Math.max(0, toNumber(debt.paidTotal) + pay);
  debt.balance = Math.max(0, toNumber(debt.balance) - pay);
  debt.remaining = debt.balance;
  if (debt.balance <= 0.009) {
    debt.balance = 0;
    debt.remaining = 0;
    debt.status = DEBT_STATUS.PAID;
  }
  return debt;
}

export function reverseDebtBalancePayment(state, debtId, amount) {
  const debt = (state.debts || []).find((item) => item.id === debtId);
  if (!debt || amount <= 0) return null;
  const pay = Math.max(0, toNumber(amount));
  debt.paidTotal = Math.max(0, toNumber(debt.paidTotal) - pay);
  debt.balance = Math.max(0, toNumber(debt.balance) + pay);
  debt.remaining = debt.balance;
  if (debt.status === DEBT_STATUS.PAID && debt.balance > 0.009) {
    debt.status = DEBT_STATUS.ATTACK;
  }
  return debt;
}

export function advanceInstallmentCommitment(commitment, paidCount = 1) {
  if (!commitment.totalInstallments) return commitment;
  const current = toNumber(commitment.currentInstallment, 1);
  commitment.currentInstallment = current + paidCount;
  if (commitment.nextDueDate) commitment.nextDueDate = addCalendarMonths(commitment.nextDueDate, paidCount);
  commitment.paymentLog = [...(commitment.paymentLog || []), { at: new Date().toISOString(), count: paidCount, action: 'advance' }];
  if (commitment.currentInstallment > commitment.totalInstallments) {
    commitment.status = 'finished';
    commitment.paused = false;
    commitment.endDate = addCalendarMonths(commitment.nextDueDate || toISODate(new Date()), -1) || commitment.endDate;
  }
  return commitment;
}

export function rewindInstallmentCommitment(commitment, count = 1) {
  if (!commitment.totalInstallments) return commitment;
  const wasFinished = commitment.status === 'finished' || commitment.currentInstallment > commitment.totalInstallments;
  commitment.currentInstallment = Math.max(1, toNumber(commitment.currentInstallment, 1) - count);
  if (commitment.nextDueDate) commitment.nextDueDate = addCalendarMonths(commitment.nextDueDate, -count);
  if (wasFinished || commitment.status === 'finished') {
    commitment.status = 'active';
    commitment.endDate = '';
  }
  commitment.paymentLog = [...(commitment.paymentLog || []), { at: new Date().toISOString(), count, action: 'rewind' }];
  return commitment;
}

export function settleInstallmentCommitment(commitment) {
  const meta = installmentMeta(commitment);
  if (meta.finished) return commitment;
  const remaining = meta.remainingCount;
  if (remaining > 0) advanceInstallmentCommitment(commitment, remaining);
  return commitment;
}

export function renegotiateCommitment(commitment, { installmentValue, totalInstallments, currentInstallment, nextDueDate, note }) {
  if (installmentValue != null) {
    commitment.installmentValue = Math.max(0, toNumber(installmentValue));
    commitment.amount = commitment.installmentValue;
  }
  if (totalInstallments != null) commitment.totalInstallments = Math.max(1, Math.round(toNumber(totalInstallments)));
  if (currentInstallment != null) commitment.currentInstallment = Math.max(1, Math.round(toNumber(currentInstallment)));
  if (nextDueDate) commitment.nextDueDate = String(nextDueDate).slice(0, 10);
  if (note != null) commitment.note = String(note);
  commitment.status = 'active';
  commitment.paused = false;
  commitment.needsInfo = !(commitment.totalInstallments && commitment.currentInstallment && commitment.nextDueDate);
  return commitment;
}

export function applyInstallmentPayment(state, entry, options = {}) {
  const before = deriveStatus(entry);
  const wasPaid = before === PAY_STATUS.PAID;
  if (options.full) markPaid(entry, options.date);
  else registerPayment(entry, options);
  const after = deriveStatus(entry);
  if (!wasPaid && after === PAY_STATUS.PAID && entry.commitmentId) {
    const commitment = state.commitments.find((item) => item.id === entry.commitmentId);
    if (commitment) advanceInstallmentCommitment(commitment, 1);
  }
  return entry;
}

export function undoInstallmentPayment(state, entry) {
  const wasPaid = deriveStatus(entry) === PAY_STATUS.PAID;
  undoPayment(entry);
  if (wasPaid && entry.commitmentId) {
    const commitment = state.commitments.find((item) => item.id === entry.commitmentId);
    if (commitment) {
      rewindInstallmentCommitment(commitment, 1);
      for (const [key, month] of Object.entries(state.months)) {
        if (key <= state.currentMonth) continue;
        month.entries = month.entries.filter((row) => row.commitmentId !== commitment.id);
      }
    }
  }
  return entry;
}

export { toISODate, dueDateInMonth, addCalendarMonths, paidTotal, DEFAULT_SETTINGS, cloneState, incomeReceivedAmount };
