const DEFAULT_SETTINGS = {
  minimumBuffer: 300,
  spendPercent: 40,
  savePercent: 20,
  debtPercent: 40,
  lockAfterMinutes: 15,
  ownerName: '',
};

export const STATUS = {
  ATTACK: 'ATACAR',
  INTEREST: 'JUROS',
  FROZEN: 'CONGELADA',
  PAID: 'QUITADA',
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

export function emptyMonth() {
  return {
    incomes: [],
    bills: [],
    debts: [],
    envelopes: [
      { id: 'week_1', name: 'Semana 1', spent: 0 },
      { id: 'week_2', name: 'Semana 2', spent: 0 },
      { id: 'week_3', name: 'Semana 3', spent: 0 },
      { id: 'week_4', name: 'Semana 4', spent: 0 },
    ],
    closed: false,
    closedAt: null,
    snapshot: null,
    notes: '',
  };
}

export function createEmptyState(monthKey = currentMonthKey()) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentMonth: monthKey,
    settings: { ...DEFAULT_SETTINGS },
    months: { [monthKey]: emptyMonth() },
  };
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeIncome(item = {}) {
  return {
    id: item.id || makeId('income'),
    source: String(item.source || 'Entrada'),
    kind: ['salary', 'daily', 'extra'].includes(item.kind) ? item.kind : 'extra',
    unitValue: Math.max(0, toNumber(item.unitValue)),
    quantity: Math.max(0, toNumber(item.quantity, 1)),
    recurring: item.recurring !== false,
    received: Boolean(item.received),
    note: String(item.note || ''),
  };
}

function normalizeBill(item = {}) {
  return {
    id: item.id || makeId('bill'),
    name: String(item.name || 'Conta'),
    amount: Math.max(0, toNumber(item.amount)),
    category: String(item.category || 'Outros'),
    essential: item.essential !== false,
    dueDay: Math.min(31, Math.max(0, Math.round(toNumber(item.dueDay)))),
    recurring: item.recurring !== false,
    paid: Boolean(item.paid),
    note: String(item.note || ''),
  };
}

function normalizeDebt(item = {}) {
  const status = Object.values(STATUS).includes(item.status) ? item.status : STATUS.FROZEN;
  return {
    id: item.id || makeId('debt'),
    creditor: String(item.creditor || 'Credor'),
    balance: Math.max(0, toNumber(item.balance)),
    status: toNumber(item.balance) <= 0 && status !== STATUS.INTEREST ? STATUS.PAID : status,
    priority: Math.max(0, Math.round(toNumber(item.priority, 99))),
    monthlyCost: Math.max(0, toNumber(item.monthlyCost)),
    plannedPayment: Math.max(0, toNumber(item.plannedPayment)),
    paidThisMonth: Math.max(0, toNumber(item.paidThisMonth)),
    costAlreadyInBills: Boolean(item.costAlreadyInBills),
    note: String(item.note || ''),
  };
}

function normalizeMonth(month = {}) {
  const envelopes = Array.isArray(month.envelopes) ? month.envelopes.slice(0, 4) : [];
  while (envelopes.length < 4) envelopes.push({ id: `week_${envelopes.length + 1}`, name: `Semana ${envelopes.length + 1}`, spent: 0 });
  return {
    incomes: Array.isArray(month.incomes) ? month.incomes.map(normalizeIncome) : [],
    bills: Array.isArray(month.bills) ? month.bills.map(normalizeBill) : [],
    debts: Array.isArray(month.debts) ? month.debts.map(normalizeDebt) : [],
    envelopes: envelopes.map((item, index) => ({
      id: item.id || `week_${index + 1}`,
      name: item.name || `Semana ${index + 1}`,
      spent: Math.max(0, toNumber(item.spent)),
    })),
    closed: Boolean(month.closed),
    closedAt: month.closedAt || null,
    snapshot: month.snapshot || null,
    notes: String(month.notes || ''),
  };
}

export function normalizeState(input) {
  const state = input && typeof input === 'object' ? structuredClone(input) : createEmptyState();
  state.version = 1;
  state.createdAt = state.createdAt || new Date().toISOString();
  state.updatedAt = new Date().toISOString();
  state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
  state.settings.minimumBuffer = Math.max(0, toNumber(state.settings.minimumBuffer, 300));
  state.settings.spendPercent = Math.max(0, toNumber(state.settings.spendPercent, 40));
  state.settings.savePercent = Math.max(0, toNumber(state.settings.savePercent, 20));
  state.settings.debtPercent = Math.max(0, toNumber(state.settings.debtPercent, 40));
  state.settings.lockAfterMinutes = Math.max(0, toNumber(state.settings.lockAfterMinutes, 15));
  state.months = state.months && typeof state.months === 'object' ? state.months : {};
  for (const [key, month] of Object.entries(state.months)) state.months[key] = normalizeMonth(month);
  state.currentMonth = state.currentMonth && state.months[state.currentMonth] ? state.currentMonth : Object.keys(state.months).sort().at(-1) || currentMonthKey();
  if (!state.months[state.currentMonth]) state.months[state.currentMonth] = emptyMonth();
  return state;
}

export function ensureMonth(state, monthKey, sourceKey = state.currentMonth) {
  if (state.months[monthKey]) return state.months[monthKey];
  const source = state.months[sourceKey] || emptyMonth();
  state.months[monthKey] = {
    ...emptyMonth(),
    incomes: source.incomes.filter((item) => item.recurring).map((item) => ({ ...item, id: makeId('income'), received: false })),
    bills: source.bills.filter((item) => item.recurring).map((item) => ({ ...item, id: makeId('bill'), paid: false })),
    debts: source.debts.map((item) => ({ ...item, id: makeId('debt'), paidThisMonth: 0 })),
  };
  return state.months[monthKey];
}

function sum(items, getter) {
  return items.reduce((total, item) => total + toNumber(getter(item)), 0);
}

function percentFractions(settings) {
  const values = [settings.spendPercent, settings.savePercent, settings.debtPercent].map((value) => Math.max(0, toNumber(value)));
  const total = values.reduce((acc, value) => acc + value, 0) || 100;
  return { spend: values[0] / total, save: values[1] / total, debt: values[2] / total, total };
}

export function calculateMonth(state, monthKey = state.currentMonth) {
  const month = state.months[monthKey] || emptyMonth();
  const settings = state.settings;
  const fractions = percentFractions(settings);

  const incomes = month.incomes.map((item) => ({ ...item, total: toNumber(item.unitValue) * toNumber(item.quantity) }));
  const totalIncome = sum(incomes, (item) => item.total);
  const receivedIncome = sum(incomes.filter((item) => item.received), (item) => item.total);
  const dailyItems = incomes.filter((item) => item.kind === 'daily');
  const dailyCount = sum(dailyItems, (item) => item.quantity);
  const dailyRate = dailyItems.length ? dailyItems[0].unitValue : 0;
  const nonDailyIncome = sum(incomes.filter((item) => item.kind !== 'daily'), (item) => item.total);

  const totalBills = sum(month.bills, (item) => item.amount);
  const essentialBills = sum(month.bills.filter((item) => item.essential), (item) => item.amount);
  const paidBills = sum(month.bills.filter((item) => item.paid), (item) => item.amount);
  const debtObligations = sum(month.debts, (item) => {
    if (item.status === STATUS.ATTACK) return item.plannedPayment;
    if (item.status === STATUS.INTEREST && !item.costAlreadyInBills) return item.monthlyCost || item.plannedPayment;
    return 0;
  });
  const paidDebts = sum(month.debts, (item) => item.paidThisMonth);
  const plannedOut = totalBills + debtObligations;
  const paidOut = paidBills + paidDebts;
  const rawSurplus = totalIncome - plannedOut;
  const minimumBuffer = Math.max(0, toNumber(settings.minimumBuffer));
  const safetyReserve = Math.min(Math.max(rawSurplus, 0), minimumBuffer);
  const distributable = Math.max(0, rawSurplus - minimumBuffer);
  const spendBudget = distributable * fractions.spend;
  const saveBudget = distributable * fractions.save;
  const debtAttack = distributable * fractions.debt;
  const envelopeLimit = spendBudget / 4;
  const envelopeSpent = sum(month.envelopes, (item) => item.spent);
  const envelopeRemaining = spendBudget - envelopeSpent;

  const debtTotal = sum(month.debts.filter((item) => item.status !== STATUS.PAID), (item) => item.balance);
  const frozenDebt = sum(month.debts.filter((item) => item.status === STATUS.FROZEN), (item) => item.balance);
  const attackDebt = sum(month.debts.filter((item) => item.status === STATUS.ATTACK), (item) => item.balance);
  const paidDebtTotal = sum(month.debts, (item) => item.paidThisMonth);

  const needsRate = dailyRate > 0;
  const tripsToClose = needsRate ? Math.max(0, Math.ceil((plannedOut - nonDailyIncome) / dailyRate)) : null;
  const tripsToBreathe = needsRate ? Math.max(0, Math.ceil((plannedOut + minimumBuffer - nonDailyIncome) / dailyRate)) : null;
  const tripsMissing = tripsToBreathe == null ? null : Math.max(0, tripsToBreathe - dailyCount);

  const status = rawSurplus < 0 ? 'deficit' : rawSurplus < minimumBuffer ? 'tight' : 'breathe';
  const statusTitle = status === 'deficit' ? 'Déficit' : status === 'tight' ? 'Apertado' : 'Respira';

  const activeAttackDebts = month.debts
    .filter((item) => item.status === STATUS.ATTACK && item.balance > 0)
    .toSorted((a, b) => a.priority - b.priority || a.balance - b.balance);
  const nextDebt = activeAttackDebts[0] || null;

  let actionText;
  if (!month.incomes.length) {
    actionText = 'Cadastre sua renda primeiro. Sem uma entrada real, qualquer sobra será apenas uma estimativa.';
  } else if (rawSurplus < 0) {
    actionText = `Faltam ${moneyAbs(rawSurplus)} para fechar o mês. Priorize as contas essenciais, não assuma dívida nova e aumente renda ou corte despesas antes de atacar dívidas congeladas.`;
  } else if (rawSurplus < minimumBuffer) {
    actionText = `O mês fecha, mas ainda não formou a folga mínima de ${money(minimumBuffer)}. Segure gastos livres e complete sua reserva de segurança.`;
  } else if (nextDebt) {
    actionText = `Sua folga mínima está protegida. Separe ${money(spendBudget)} para os envelopes, ${money(saveBudget)} para guardar e direcione até ${money(debtAttack)} para ${nextDebt.creditor}.`;
  } else {
    actionText = `Sua folga mínima está protegida. Separe ${money(spendBudget)} para os envelopes, ${money(saveBudget)} para guardar e use ${money(debtAttack)} para antecipar metas ou reforçar a reserva.`;
  }

  return {
    monthKey,
    month,
    settings,
    fractions,
    incomes,
    totalIncome,
    receivedIncome,
    dailyCount,
    dailyRate,
    nonDailyIncome,
    totalBills,
    essentialBills,
    paidBills,
    debtObligations,
    paidDebts,
    plannedOut,
    paidOut,
    rawSurplus,
    minimumBuffer,
    safetyReserve,
    distributable,
    spendBudget,
    saveBudget,
    debtAttack,
    envelopeLimit,
    envelopeSpent,
    envelopeRemaining,
    debtTotal,
    frozenDebt,
    attackDebt,
    paidDebtTotal,
    tripsToClose,
    tripsToBreathe,
    tripsMissing,
    status,
    statusTitle,
    nextDebt,
    actionText,
  };
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(toNumber(value));
}

function moneyAbs(value) {
  return money(Math.abs(toNumber(value)));
}

export function scenarios(state, monthKey = state.currentMonth, maxTrips = 10) {
  const calc = calculateMonth(state, monthKey);
  const rate = calc.dailyRate;
  return Array.from({ length: maxTrips + 1 }, (_, trips) => {
    const income = calc.nonDailyIncome + rate * trips;
    const surplus = income - calc.plannedOut;
    return {
      trips,
      income,
      surplus,
      status: surplus < 0 ? 'deficit' : surplus < calc.minimumBuffer ? 'tight' : 'breathe',
      current: trips === calc.dailyCount,
    };
  });
}

export function dueBills(state, monthKey = state.currentMonth, limit = 6) {
  const month = state.months[monthKey] || emptyMonth();
  const today = new Date();
  const isCurrent = monthKey === currentMonthKey(today);
  const currentDay = isCurrent ? today.getDate() : 0;
  return month.bills
    .filter((item) => !item.paid)
    .map((item) => ({ ...item, overdue: isCurrent && item.dueDay > 0 && item.dueDay < currentDay }))
    .toSorted((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      if (!a.dueDay) return 1;
      if (!b.dueDay) return -1;
      return a.dueDay - b.dueDay;
    })
    .slice(0, limit);
}

export function projection(state, startMonth = state.currentMonth, length = 24) {
  const baseMonth = structuredClone(state.months[startMonth] || emptyMonth());
  const debts = baseMonth.debts.map((item) => ({ ...item }));
  const rows = [];

  for (let index = 0; index < length; index += 1) {
    const monthKey = addMonths(startMonth, index);
    const monthState = {
      ...state,
      currentMonth: monthKey,
      months: {
        [monthKey]: {
          ...baseMonth,
          debts: debts.map((item) => ({ ...item, paidThisMonth: 0 })),
          envelopes: baseMonth.envelopes.map((item) => ({ ...item, spent: 0 })),
        },
      },
    };
    const calc = calculateMonth(monthState, monthKey);
    let attackAvailable = calc.debtAttack;
    let debtPaid = 0;

    const attackQueue = debts
      .filter((item) => item.status === STATUS.ATTACK && item.balance > 0)
      .toSorted((a, b) => a.priority - b.priority || a.balance - b.balance);

    for (const debt of attackQueue) {
      if (attackAvailable <= 0) break;
      const payment = Math.min(debt.balance, attackAvailable);
      debt.balance -= payment;
      debtPaid += payment;
      attackAvailable -= payment;
      if (debt.balance <= 0) debt.status = STATUS.PAID;
    }

    for (const debt of debts) {
      if (debt.status === STATUS.ATTACK && debt.plannedPayment > 0 && debt.balance > 0) {
        const payment = Math.min(debt.balance, debt.plannedPayment);
        debt.balance -= payment;
        debtPaid += payment;
        if (debt.balance <= 0) debt.status = STATUS.PAID;
      }
    }

    rows.push({
      monthKey,
      income: calc.totalIncome,
      out: calc.plannedOut,
      surplus: calc.rawSurplus,
      spend: calc.spendBudget,
      save: calc.saveBudget,
      debtAttack: debtPaid,
      remainingDebt: sum(debts.filter((item) => item.status !== STATUS.PAID), (item) => item.balance),
      status: calc.status,
    });
  }
  return rows;
}

export function closeCurrentMonth(state) {
  const currentKey = state.currentMonth;
  const current = state.months[currentKey];
  const calc = calculateMonth(state, currentKey);
  current.closed = true;
  current.closedAt = new Date().toISOString();
  current.snapshot = {
    totalIncome: calc.totalIncome,
    plannedOut: calc.plannedOut,
    paidOut: calc.paidOut,
    surplus: calc.rawSurplus,
    envelopeSpent: calc.envelopeSpent,
    debtPaid: calc.paidDebtTotal,
  };

  const nextKey = addMonths(currentKey, 1);
  const next = emptyMonth();
  next.incomes = current.incomes.filter((item) => item.recurring).map((item) => ({ ...item, id: makeId('income'), received: false }));
  next.bills = current.bills.filter((item) => item.recurring).map((item) => ({ ...item, id: makeId('bill'), paid: false }));
  next.debts = current.debts.map((item) => {
    const newBalance = Math.max(0, item.balance - item.paidThisMonth);
    return {
      ...item,
      id: makeId('debt'),
      balance: newBalance,
      status: newBalance <= 0 && item.status !== STATUS.INTEREST ? STATUS.PAID : item.status,
      paidThisMonth: 0,
    };
  });
  state.months[nextKey] = next;
  state.currentMonth = nextKey;
  state.updatedAt = new Date().toISOString();
  return nextKey;
}

export function remainingPercent(balance, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (balance / total) * 100));
}
