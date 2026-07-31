const DEFAULT_SETTINGS = {
  safetyMargin: 300,
  lockAfterMinutes: 15,
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
  DEBT: 'debt',
};

export const STATUS_LABEL = {
  pending: 'Pendente',
  paid: 'Pago',
  partial: 'Pago parcialmente',
  overdue: 'Atrasado',
  cancelled: 'Cancelado',
  renegotiated: 'Renegociado',
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
    return entry.received || paidTotal(entry) >= toNumber(entry.amount) ? PAY_STATUS.PAID : PAY_STATUS.PENDING;
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

function normalizeEntry(item = {}) {
  const type = Object.values(ENTRY_TYPES).includes(item.type) ? item.type : ENTRY_TYPES.BILL;
  const payments = Array.isArray(item.payments) ? item.payments.map(normalizePayment) : [];
  const entry = {
    id: item.id || makeId('entry'),
    commitmentId: item.commitmentId || null,
    type,
    name: String(item.name || TYPE_LABEL[type] || 'Item'),
    amount: Math.max(0, toNumber(item.amount)),
    category: String(item.category || 'Geral'),
    dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '',
    note: String(item.note || ''),
    installmentNumber: item.installmentNumber != null ? Math.max(1, Math.round(toNumber(item.installmentNumber, 1))) : null,
    totalInstallments: item.totalInstallments != null ? Math.max(1, Math.round(toNumber(item.totalInstallments, 1))) : null,
    received: Boolean(item.received),
    payments,
    status: item.status || PAY_STATUS.PENDING,
    needsInfo: Boolean(item.needsInfo),
    direction: type === ENTRY_TYPES.INCOME ? 'in' : 'out',
  };
  if (type === ENTRY_TYPES.INCOME && entry.received && !payments.length) {
    entry.payments = [normalizePayment({ amount: entry.amount, date: entry.dueDate || toISODate(new Date()), method: 'Recebido', note: 'Migrado' })];
  }
  entry.status = deriveStatus(entry);
  entry.paidAmount = paidTotal(entry);
  entry.pendingAmount = Math.max(0, entry.amount - entry.paidAmount);
  return entry;
}

export function installmentMeta(commitment) {
  const total = Math.max(1, toNumber(commitment.totalInstallments, 1));
  const current = Math.min(total, Math.max(1, toNumber(commitment.currentInstallment, 1)));
  const value = Math.max(0, toNumber(commitment.installmentValue || commitment.amount));
  const remainingCount = Math.max(0, total - current + (commitment.lastPaidFully ? 0 : 1));
  const remainingValue = Math.max(0, (total - current + 1) * value);
  const nextDue = commitment.nextDueDate || '';
  const endDate = nextDue ? addCalendarMonths(nextDue, Math.max(0, total - current)) : '';
  return {
    total,
    current,
    value,
    remainingCount: Math.max(0, total - current + 1),
    remainingValue: Math.max(0, (total - current + 1) * value),
    endDate,
    endMonth: endDate ? monthKeyFromDate(parseDate(endDate)) : null,
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
  };
  if (type === COMMITMENT_TYPES.INSTALLMENT || type === COMMITMENT_TYPES.FINANCING || type === COMMITMENT_TYPES.AGREEMENT) {
    if (!commitment.totalInstallments || !commitment.currentInstallment) commitment.needsInfo = true;
  }
  return commitment;
}

function emptyMonth() {
  return {
    entries: [],
    closed: false,
    closedAt: null,
    snapshot: null,
    notes: '',
  };
}

export function createEmptyState(monthKey = currentMonthKey()) {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentMonth: monthKey,
    settings: { ...DEFAULT_SETTINGS },
    commitments: [],
    months: { [monthKey]: emptyMonth() },
  };
}

function migrateLegacyMonth(monthKey, month, commitments) {
  const entries = [];
  for (const income of month.incomes || []) {
    const amount = toNumber(income.unitValue) * toNumber(income.quantity, 1);
    entries.push(normalizeEntry({
      id: income.id,
      type: ENTRY_TYPES.INCOME,
      name: income.source || 'Receita',
      amount,
      category: income.kind === 'daily' ? 'Diária' : income.kind === 'salary' ? 'Salário' : 'Extra',
      dueDate: dueDateInMonth(monthKey, 1),
      note: income.note || '',
      received: Boolean(income.received),
    }));
    if (income.recurring !== false) {
      const exists = commitments.find((item) => item.name === (income.source || 'Receita') && item.type === COMMITMENT_TYPES.RECURRING && item.category === 'Receita');
      if (!exists) {
        commitments.push(normalizeCommitment({
          type: COMMITMENT_TYPES.RECURRING,
          name: income.source || 'Receita',
          amount,
          category: 'Receita',
          dueDay: 1,
          startDate: `${monthKey}-01`,
          note: 'Migrado de receita recorrente',
        }));
      }
    }
  }

  for (const bill of month.bills || []) {
    const looksParcel = /parcela|x\s*\d|\d+\s*\/\s*\d+/i.test(`${bill.name} ${bill.note || ''}`);
    const needsInfo = looksParcel;
    let commitmentId = null;
    if (bill.recurring !== false || looksParcel) {
      const commitment = normalizeCommitment({
        type: looksParcel ? COMMITMENT_TYPES.INSTALLMENT : COMMITMENT_TYPES.RECURRING,
        name: bill.name,
        amount: bill.amount,
        installmentValue: bill.amount,
        category: bill.category || 'Geral',
        dueDay: bill.dueDay || 1,
        startDate: `${monthKey}-01`,
        note: bill.note || '',
        needsInfo,
        totalInstallments: null,
        currentInstallment: null,
        nextDueDate: dueDateInMonth(monthKey, bill.dueDay || 1),
      });
      commitments.push(commitment);
      commitmentId = commitment.id;
    }
    entries.push(normalizeEntry({
      id: bill.id,
      commitmentId,
      type: looksParcel ? ENTRY_TYPES.INSTALLMENT : ENTRY_TYPES.BILL,
      name: bill.name,
      amount: bill.amount,
      category: bill.category || 'Geral',
      dueDate: dueDateInMonth(monthKey, bill.dueDay || 1),
      note: bill.note || '',
      needsInfo,
      payments: bill.paid ? [{ amount: bill.amount, date: dueDateInMonth(monthKey, bill.dueDay || 1), method: 'Migrado' }] : [],
      status: bill.paid ? PAY_STATUS.PAID : PAY_STATUS.PENDING,
    }));
  }

  for (const debt of month.debts || []) {
    const commitment = normalizeCommitment({
      type: COMMITMENT_TYPES.DEBT,
      name: debt.creditor || 'Dívida',
      amount: debt.balance,
      category: 'Dívida',
      note: debt.note || '',
      dueDay: 1,
      startDate: `${monthKey}-01`,
      nextDueDate: dueDateInMonth(monthKey, 1),
      status: debt.status === 'QUITADA' ? 'finished' : debt.status === 'CONGELADA' ? 'paused' : 'active',
    });
    commitments.push(commitment);
    const pay = toNumber(debt.paidThisMonth);
    entries.push(normalizeEntry({
      id: debt.id,
      commitmentId: commitment.id,
      type: ENTRY_TYPES.DEBT,
      name: debt.creditor || 'Dívida',
      amount: toNumber(debt.plannedPayment) || toNumber(debt.monthlyCost) || toNumber(debt.balance),
      category: 'Dívida',
      dueDate: dueDateInMonth(monthKey, 1),
      note: debt.note || '',
      payments: pay > 0 ? [{ amount: pay, date: dueDateInMonth(monthKey, 1), method: 'Migrado' }] : [],
    }));
  }

  for (const envelope of month.envelopes || []) {
    if (toNumber(envelope.spent) > 0) {
      entries.push(normalizeEntry({
        id: envelope.id,
        type: ENTRY_TYPES.EXPENSE,
        name: envelope.name || 'Gasto',
        amount: envelope.spent,
        category: 'Envelope',
        dueDate: dueDateInMonth(monthKey, 28),
        payments: [{ amount: envelope.spent, date: dueDateInMonth(monthKey, 28), method: 'Migrado' }],
        status: PAY_STATUS.PAID,
      }));
    }
  }

  return {
    entries,
    closed: Boolean(month.closed),
    closedAt: month.closedAt || null,
    snapshot: month.snapshot || null,
    notes: String(month.notes || ''),
  };
}

function migrateState(input) {
  if (input?.version >= 2 && Array.isArray(input.commitments)) {
    return input;
  }
  const base = createEmptyState(input?.currentMonth || currentMonthKey());
  base.createdAt = input?.createdAt || base.createdAt;
  base.settings = {
    ...DEFAULT_SETTINGS,
    safetyMargin: toNumber(input?.settings?.minimumBuffer ?? input?.settings?.safetyMargin, 300),
    lockAfterMinutes: toNumber(input?.settings?.lockAfterMinutes, 15),
    ownerName: String(input?.settings?.ownerName || ''),
  };
  base.currentMonth = input?.currentMonth || base.currentMonth;
  const commitments = [];
  const months = {};
  for (const [key, month] of Object.entries(input?.months || {})) {
    if (Array.isArray(month?.entries)) {
      months[key] = {
        entries: month.entries.map(normalizeEntry),
        closed: Boolean(month.closed),
        closedAt: month.closedAt || null,
        snapshot: month.snapshot || null,
        notes: String(month.notes || ''),
      };
    } else {
      months[key] = migrateLegacyMonth(key, month || {}, commitments);
    }
  }
  if (!Object.keys(months).length) months[base.currentMonth] = emptyMonth();
  base.months = months;
  base.commitments = (input?.commitments || commitments).map(normalizeCommitment);
  base.version = 2;
  return base;
}

export function normalizeState(input) {
  const migrated = migrateState(input && typeof input === 'object' ? structuredClone(input) : null);
  const state = migrated;
  state.version = 2;
  state.createdAt = state.createdAt || new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.settings.safetyMargin = Math.max(0, toNumber(state.settings.safetyMargin, 300));
  state.settings.lockAfterMinutes = Math.max(0, toNumber(state.settings.lockAfterMinutes, 15));
  state.settings.ownerName = String(state.settings.ownerName || '');
  state.commitments = Array.isArray(state.commitments) ? state.commitments.map(normalizeCommitment) : [];
  state.months = state.months && typeof state.months === 'object' ? state.months : {};
  for (const [key, month] of Object.entries(state.months)) {
    state.months[key] = {
      entries: Array.isArray(month.entries) ? month.entries.map(normalizeEntry) : [],
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

function commitmentActiveInMonth(commitment, monthKey) {
  if (commitment.paused || commitment.status === 'paused' || commitment.status === 'finished' || commitment.status === 'cancelled') return false;
  if (commitment.startDate && monthKey < commitment.startDate.slice(0, 7)) return false;
  if (commitment.endDate && monthKey > commitment.endDate.slice(0, 7)) return false;

  if ([COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)) {
    if (commitment.needsInfo || !commitment.totalInstallments || !commitment.currentInstallment || !commitment.nextDueDate) return false;
    const meta = installmentMeta(commitment);
    if (!meta.endMonth) return false;
    return monthKey <= meta.endMonth && monthKey >= (commitment.nextDueDate.slice(0, 7) || monthKey);
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

export function ensureMonth(state, monthKey) {
  if (state.months[monthKey]) return state.months[monthKey];
  const month = emptyMonth();
  for (const commitment of state.commitments) {
    if (!commitmentActiveInMonth(commitment, monthKey)) continue;
    if (commitment.type === COMMITMENT_TYPES.RECURRING && commitment.category === 'Receita') {
      month.entries.push(normalizeEntry({
        commitmentId: commitment.id,
        type: ENTRY_TYPES.INCOME,
        name: commitment.name,
        amount: commitment.amount,
        category: commitment.category,
        dueDate: dueDateInMonth(monthKey, commitment.dueDay || 1),
        note: commitment.note,
      }));
      continue;
    }
    if ([COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(commitment.type)) {
      const number = installmentNumberForMonth(commitment, monthKey);
      if (number < 1 || number > commitment.totalInstallments) continue;
      month.entries.push(normalizeEntry({
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
      }));
      continue;
    }
    month.entries.push(normalizeEntry({
      commitmentId: commitment.id,
      type: commitment.type === COMMITMENT_TYPES.DEBT ? ENTRY_TYPES.DEBT : ENTRY_TYPES.BILL,
      name: commitment.name,
      amount: commitment.amount,
      category: commitment.category,
      dueDate: dueDateInMonth(monthKey, commitment.dueDay || 1),
      note: commitment.note,
    }));
  }
  state.months[monthKey] = month;
  return month;
}

export function monthEntries(state, monthKey = state.currentMonth, filter = 'all') {
  ensureMonth(state, monthKey);
  const entries = state.months[monthKey].entries.map((item) => {
    const entry = normalizeEntry(item);
    entry.status = deriveStatus(entry);
    return entry;
  });
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

export function overview(state, monthKey = state.currentMonth) {
  const entries = monthEntries(state, monthKey, 'all');
  const received = entries.filter((item) => item.type === ENTRY_TYPES.INCOME && item.status === PAY_STATUS.PAID);
  const outs = entries.filter((item) => item.type !== ENTRY_TYPES.INCOME && item.status !== PAY_STATUS.CANCELLED);
  const available = received.reduce((sum, item) => sum + item.amount, 0);
  const billLike = outs.filter((item) => item.type !== ENTRY_TYPES.RESERVE);
  const reserves = outs.filter((item) => item.type === ENTRY_TYPES.RESERVE);
  const totalBills = billLike.reduce((sum, item) => sum + item.amount, 0);
  const totalPaid = billLike.reduce((sum, item) => sum + item.paidAmount, 0);
  const totalPending = billLike.reduce((sum, item) => sum + item.pendingAmount, 0);
  const overdue = billLike.filter((item) => item.status === PAY_STATUS.OVERDUE);
  const reserved = reserves.reduce((sum, item) => sum + item.amount, 0);
  const safety = toNumber(state.settings.safetyMargin);
  const free = available - totalPending - reserved - safety;
  const upcoming = billLike
    .filter((item) => item.status === PAY_STATUS.PENDING || item.status === PAY_STATUS.PARTIAL || item.status === PAY_STATUS.OVERDUE)
    .slice(0, 6);
  const endingSoon = state.commitments
    .filter((item) => [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type))
    .map((item) => ({ commitment: item, meta: installmentMeta(item) }))
    .filter((item) => item.meta.remainingCount > 0 && item.meta.remainingCount <= 3)
    .slice(0, 6);

  return {
    available,
    receivedTotal: available,
    totalBills,
    totalPaid,
    totalPending,
    overdueCount: overdue.length,
    overdueTotal: overdue.reduce((sum, item) => sum + item.pendingAmount, 0),
    reserved,
    safety,
    free,
    upcoming,
    endingSoon,
    overdue,
  };
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
        };
    return {
      ...commitment,
      meta,
      nextDue: commitment.nextDueDate || (commitment.dueDay ? dueDateInMonth(state.currentMonth, commitment.dueDay) : ''),
      typeLabel: TYPE_LABEL[commitment.type] || commitment.type,
    };
  }).toSorted((a, b) => String(a.nextDue).localeCompare(String(b.nextDue)) || a.name.localeCompare(b.name));
}

export function projection(state, startMonth = state.currentMonth, length = 12) {
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    const monthKey = addMonths(startMonth, index);
    ensureMonth(state, monthKey);
    const entries = monthEntries(state, monthKey, 'all');
    const income = entries.filter((item) => item.type === ENTRY_TYPES.INCOME).reduce((sum, item) => sum + item.amount, 0);
    const out = entries.filter((item) => item.type !== ENTRY_TYPES.INCOME && item.status !== PAY_STATUS.CANCELLED).reduce((sum, item) => sum + item.amount, 0);
    const ending = state.commitments
      .filter((item) => [COMMITMENT_TYPES.INSTALLMENT, COMMITMENT_TYPES.FINANCING, COMMITMENT_TYPES.AGREEMENT].includes(item.type))
      .map((item) => ({ item, meta: installmentMeta(item) }))
      .filter((row) => row.meta.endMonth === monthKey);
    const released = ending.reduce((sum, row) => sum + row.meta.value, 0);
    rows.push({
      monthKey,
      income,
      out,
      balance: income - out,
      ending: ending.map((row) => row.item.name),
      released,
    });
  }
  const lightest = rows.toSorted((a, b) => a.out - b.out)[0] || null;
  return { rows, lightest };
}

export function history(state) {
  const current = state.currentMonth;
  return Object.keys(state.months)
    .filter((key) => key < current)
    .sort()
    .reverse()
    .map((monthKey) => {
      const entries = monthEntries(state, monthKey, 'all');
      const income = entries.filter((item) => item.type === ENTRY_TYPES.INCOME && item.status === PAY_STATUS.PAID).reduce((sum, item) => sum + item.amount, 0);
      const out = entries.filter((item) => item.type !== ENTRY_TYPES.INCOME).reduce((sum, item) => sum + item.paidAmount, 0);
      const paidCount = entries.filter((item) => item.type !== ENTRY_TYPES.INCOME && item.status === PAY_STATUS.PAID).length;
      const overdueCount = entries.filter((item) => item.status === PAY_STATUS.OVERDUE).length;
      return {
        monthKey,
        income,
        out,
        paidCount,
        overdueCount,
        balance: income - out,
      };
    });
}

export function registerPayment(entry, { amount, date, method, note }) {
  const payAmount = Math.max(0, toNumber(amount));
  if (payAmount <= 0) return entry;
  entry.payments = [...(entry.payments || []), normalizePayment({ amount: payAmount, date, method, note })];
  if (entry.type === ENTRY_TYPES.INCOME) entry.received = paidTotal(entry) >= entry.amount;
  entry.status = deriveStatus(entry);
  entry.paidAmount = paidTotal(entry);
  entry.pendingAmount = Math.max(0, entry.amount - entry.paidAmount);
  return entry;
}

export function undoPayment(entry) {
  entry.payments = [];
  entry.received = false;
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

export function advanceInstallmentCommitment(commitment, paidCount = 1) {
  if (!commitment.currentInstallment || !commitment.totalInstallments) return commitment;
  commitment.currentInstallment = Math.min(commitment.totalInstallments + 1, commitment.currentInstallment + paidCount);
  if (commitment.nextDueDate) commitment.nextDueDate = addCalendarMonths(commitment.nextDueDate, paidCount);
  if (commitment.currentInstallment > commitment.totalInstallments) {
    commitment.status = 'finished';
    commitment.endDate = commitment.nextDueDate || commitment.endDate;
  }
  return commitment;
}

export { toISODate, dueDateInMonth, addCalendarMonths, paidTotal, DEFAULT_SETTINGS };
