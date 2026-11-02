import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseSms, Txn } from './src/parser';
import {
  Category, catMeta, CUSTOM_COLORS, CUSTOM_ICONS, CustomCategory, expenseList, incomeList, isBuiltIn, registerCustom,
} from './src/categories';
import { ensureSmsPermission, readInbox } from './src/sms';
import {
  applyRule, loadAll, loadMail, MailState, mergeTxns, Rules, saveCats, saveLastScan, saveMail, saveRules, saveTxns,
} from './src/storage';
import { connectGmail, disconnectGmail, fetchBankEmails } from './src/gmail';
import { ago, C, fmtDate, fmtDay, inr, monthLabel } from './src/ui';

const DAY = 86400000;
const FIRST_SCAN_DAYS = 120;
type Tab = 'overview' | 'txns';
type Filter = 'all' | 'debit' | 'credit';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

function monthStart(ms = Date.now()) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}
function shiftMonth(ms: number, by: number) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + by, 1).getTime();
}

function Main() {
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [rules, setRules] = useState<Rules>({});
  const [lastScan, setLastScan] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [month, setMonth] = useState(monthStart());
  const [filter, setFilter] = useState<Filter>('all');
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Txn | null>(null);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [cats, setCats] = useState<CustomCategory[]>([]);
  const [mail, setMail] = useState<MailState>({ account: null, lastScan: 0 });
  const [mailBusy, setMailBusy] = useState(false);

  const runScan = useCallback(async (base: Txn[], baseRules: Rules, baseLast: number, silent: boolean): Promise<Txn[]> => {
    setScanning(true);
    try {
      const ok = await ensureSmsPermission();
      if (!ok) {
        if (!silent) Alert.alert('SMS access needed', 'Allow SMS access so Kanakku can read bank and UPI alerts. Nothing leaves your phone.');
        return base;
      }
      const from = baseLast ? baseLast - 2 * DAY : Date.now() - FIRST_SCAN_DAYS * DAY;
      const sms = await readInbox(from);
      const parsed = sms.map(parseSms).filter((t): t is Txn => !!t).map(t => applyRule(t, baseRules));
      const { merged, added } = mergeTxns(base, parsed);
      const now = Date.now();
      setTxns(merged);
      setLastScan(now);
      await Promise.all([saveTxns(merged), saveLastScan(now)]);
      if (!silent) Alert.alert('Scan complete', added ? `${added} new transaction${added > 1 ? 's' : ''} added.` : 'No new transactions.');
      return merged;
    } catch (e: any) {
      if (!silent) Alert.alert('Scan failed', String(e?.message ?? e));
      return base;
    } finally {
      setScanning(false);
    }
  }, []);

  const runMail = useCallback(async (base: Txn[], baseRules: Rules, m: MailState, silent: boolean): Promise<Txn[]> => {
    if (!m.account) return base;
    setMailBusy(true);
    try {
      const since = m.lastScan ? m.lastScan - 2 * DAY : Date.now() - FIRST_SCAN_DAYS * DAY;
      const seen = new Set(base.map(t => t.smsId).filter((x): x is string => !!x));
      const found = (await fetchBankEmails(since, seen)).map(t => applyRule(t, baseRules));
      const { merged, added } = mergeTxns(base, found);
      const next = { ...m, lastScan: Date.now() };
      setTxns(merged); setMail(next);
      await Promise.all([saveTxns(merged), saveMail(next)]);
      if (!silent) Alert.alert('Email check complete', added ? `${added} new transaction${added > 1 ? 's' : ''} from bank emails.` : 'No new transactions in email.');
      return merged;
    } catch (e: any) {
      if (!silent) Alert.alert('Email check failed', String(e?.message ?? e));
      return base;
    } finally {
      setMailBusy(false);
    }
  }, []);

  const onConnectMail = async () => {
    try {
      const account = await connectGmail();
      if (!account) return;
      const m = { account, lastScan: 0 };
      setMail(m); await saveMail(m);
      await runMail(txns, rules, m, false);
    } catch (e: any) {
      Alert.alert('Could not connect Gmail', String(e?.message ?? e));
    }
  };

  const onDisconnectMail = () => Alert.alert('Disconnect Gmail?', 'Entries already added from email stay in Kanakku.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Disconnect', style: 'destructive', onPress: async () => {
        await disconnectGmail();
        const m = { account: null, lastScan: 0 };
        setMail(m); await saveMail(m);
      },
    },
  ]);

  // Load saved data, then pick up new SMS automatically.
  useEffect(() => {
    (async () => {
      const [d, m] = await Promise.all([loadAll(), loadMail()]);
      registerCustom(d.cats);
      setTxns(d.txns); setRules(d.rules); setLastScan(d.lastScan); setCats(d.cats); setMail(m);
      setReady(true);
      let cur = d.txns;
      if (d.lastScan) cur = await runScan(cur, d.rules, d.lastScan, true);
      if (m.account) await runMail(cur, d.rules, m, true);
    })();
  }, [runScan, runMail]);

  // Re-scan when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active' || !ready || scanning || mailBusy) return;
      (async () => {
        let cur = txns;
        if (lastScan) cur = await runScan(cur, rules, lastScan, true);
        if (mail.account) await runMail(cur, rules, mail, true);
      })();
    });
    return () => sub.remove();
  }, [ready, lastScan, scanning, mailBusy, mail, txns, rules, runScan, runMail]);

  const persist = async (next: Txn[]) => { setTxns(next); await saveTxns(next); };

  const updateTxn = async (id: string, patch: Partial<Txn>, remember: boolean) => {
    const orig = txns.find(t => t.id === id);
    if (!orig) return;
    let next = txns.map(t => (t.id === id ? { ...t, ...patch } : t));
    if (remember && patch.category && !orig.manual) {
      const key = orig.merchant.toLowerCase();
      const r = { ...rules, [key]: patch.category };
      setRules(r); await saveRules(r);
      next = next.map(t => (!t.manual && t.type === orig.type && t.merchant.toLowerCase() === key ? { ...t, category: patch.category! } : t));
    }
    await persist(next);
    setSelected(next.find(t => t.id === id) || null);
  };

  const deleteTxn = async (id: string) => { await persist(txns.filter(t => t.id !== id)); setSelected(null); };

  const addEntry = async (type: 'debit' | 'credit', amount: number, note: string, category: string) => {
    const t: Txn = {
      id: `cash-${Date.now()}`, date: Date.now(), amount, type,
      merchant: note || (type === 'debit' ? 'Cash expense' : 'Cash received'),
      mode: 'Cash', category, manual: true,
    };
    await persist([t, ...txns]);
    setAdding(false);
  };

  const addCategory = async (c: CustomCategory): Promise<boolean> => {
    const name = c.name.trim();
    const clash = isBuiltIn(name) || cats.some(x => x.name.toLowerCase() === name.toLowerCase());
    if (!name || clash) {
      Alert.alert(clash ? 'Category already exists' : 'Enter a name');
      return false;
    }
    const next = [...cats, { ...c, name }];
    registerCustom(next); setCats(next); await saveCats(next);
    return true;
  };

  const deleteCategory = (c: CustomCategory) => {
    const used = txns.filter(t => t.category === c.name).length;
    const fallback = c.income ? 'Received' : 'Others';
    Alert.alert(`Delete “${c.name}”?`, used ? `${used} entr${used > 1 ? 'ies' : 'y'} will move to ${fallback}.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          const next = cats.filter(x => x.name !== c.name);
          const r = Object.fromEntries(Object.entries(rules).filter(([, v]) => v !== c.name));
          registerCustom(next); setCats(next); setRules(r);
          await Promise.all([saveCats(next), saveRules(r)]);
          await persist(txns.map(t => (t.category === c.name ? { ...t, category: fallback } : t)));
        },
      },
    ]);
  };

  const monthTx = useMemo(() => {
    const end = shiftMonth(month, 1);
    return txns.filter(t => t.date >= month && t.date < end).sort((a, b) => b.date - a.date);
  }, [txns, month]);

  const stats = useMemo(() => {
    let spent = 0, received = 0, count = 0;
    const byCat: Record<string, number> = {};
    const byPayee: Record<string, { amt: number; n: number }> = {};
    for (const t of monthTx) {
      if (t.excluded) continue;
      count++;
      if (t.type === 'debit') {
        spent += t.amount;
        byCat[t.category] = (byCat[t.category] || 0) + t.amount;
        const p = byPayee[t.merchant] || (byPayee[t.merchant] = { amt: 0, n: 0 });
        p.amt += t.amount; p.n++;
      } else received += t.amount;
    }
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const payees = Object.entries(byPayee).sort((a, b) => b[1].amt - a[1].amt).slice(0, 5);
    return { spent, received, count, cats, payees };
  }, [monthTx]);

  const listTx = useMemo(
    () => monthTx.filter(t => (filter === 'all' || t.type === filter) && (!catFilter || t.category === catFilter)),
    [monthTx, filter, catFilter],
  );

  const exportCsv = async () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Amount', 'Payee', 'Category', 'Mode', 'Bank', 'Account', 'Reference', 'Counted']];
    for (const t of [...monthTx].reverse()) {
      rows.push([fmtDay(t.date), t.type === 'debit' ? 'Paid' : 'Received', t.amount.toFixed(2), t.merchant, t.category, t.mode,
        t.bank ?? '', t.account ? `xx${t.account}` : '', t.ref ?? '', t.excluded ? 'No' : 'Yes']);
    }
    await Share.share({ title: `Kanakku ${monthLabel(month)}`, message: rows.map(r => r.map(q).join(',')).join('\n') });
  };

  if (!ready) return <View style={[s.fill, s.center]}><ActivityIndicator color={C.gold} /></View>;

  return (
    <View style={[s.fill, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.brand}>Kanakku</Text>
        <Text style={s.sub}>{scanning ? 'Reading messages…' : mailBusy ? 'Reading email…' : `Updated ${ago(Math.max(lastScan, mail.lastScan))}`}</Text>
      </View>

      <View style={s.monthRow}>
        <Pressable hitSlop={12} onPress={() => setMonth(shiftMonth(month, -1))}><Text style={s.arrow}>‹</Text></Pressable>
        <Text style={s.month}>{monthLabel(month)}</Text>
        <Pressable hitSlop={12} disabled={month >= monthStart()} onPress={() => setMonth(shiftMonth(month, 1))}>
          <Text style={[s.arrow, month >= monthStart() && { opacity: 0.25 }]}>›</Text>
        </Pressable>
      </View>

      {tab === 'overview' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
          {!lastScan && (
            <View style={[s.card, { borderColor: C.goldDeep }]}>
              <Text style={s.h2}>Start with your messages</Text>
              <Text style={s.body}>Kanakku reads bank and UPI SMS from the last {FIRST_SCAN_DAYS} days and builds your expense book. After that it updates by itself each time you open the app.</Text>
              <Btn label={scanning ? 'Reading…' : 'Read my bank messages'} onPress={() => runScan(txns, rules, 0, false)} disabled={scanning} primary />
            </View>
          )}

          <View style={s.card}>
            <Text style={s.label}>SPENT</Text>
            <Text style={s.big}>{inr(stats.spent)}</Text>
            <View style={s.row3}>
              <Stat label="Received" value={inr(stats.received)} color={C.green} />
              <Stat label="Net" value={inr(stats.received - stats.spent)} color={stats.received - stats.spent >= 0 ? C.green : C.red} />
              <Stat label="Entries" value={String(stats.count)} />
            </View>
          </View>

          {stats.cats.length > 0 && (
            <View style={s.card}>
              <Text style={s.h2}>Where it went</Text>
              {stats.cats.map(([name, amt]) => {
                const m = catMeta(name);
                const pct = stats.spent ? amt / stats.spent : 0;
                return (
                  <Pressable key={name} style={s.catRow} onPress={() => { setCatFilter(name); setFilter('debit'); setTab('txns'); }}>
                    <View style={s.catTop}>
                      <Text style={s.catName}>{m.icon}  {name}</Text>
                      <Text style={s.catAmt}>{inr(amt)} <Text style={s.mute}> {Math.round(pct * 100)}%</Text></Text>
                    </View>
                    <View style={s.track}><View style={[s.bar, { width: `${Math.max(pct * 100, 2)}%`, backgroundColor: m.color }]} /></View>
                  </Pressable>
                );
              })}
            </View>
          )}

          {stats.payees.length > 0 && (
            <View style={s.card}>
              <Text style={s.h2}>Top payees</Text>
              {stats.payees.map(([name, p]) => (
                <View key={name} style={s.payee}>
                  <Text style={s.payeeName} numberOfLines={1}>{name}</Text>
                  <Text style={s.mute}>{p.n}×  </Text>
                  <Text style={s.catAmt}>{inr(p.amt)}</Text>
                </View>
              ))}
            </View>
          )}

          {!!lastScan && (
            <View style={s.btnRow}>
              <Btn label={scanning ? 'Reading…' : 'Check messages now'} onPress={() => runScan(txns, rules, lastScan, false)} disabled={scanning} />
              <Btn label="Export month (CSV)" onPress={exportCsv} />
            </View>
          )}

          <View style={[s.card, { marginTop: 14 }]}>
            <Text style={s.h2}>Bank emails</Text>
            {mail.account ? (
              <>
                <Text style={s.body}>Gmail: {mail.account}</Text>
                <Text style={s.mute}>Checked {ago(mail.lastScan)} · payments seen in both SMS and email are counted once</Text>
                <View style={s.btnRow}>
                  <Btn label={mailBusy ? 'Reading…' : 'Check email now'} onPress={() => runMail(txns, rules, mail, false)} disabled={mailBusy} />
                  <Btn label="Disconnect" onPress={onDisconnectMail} danger />
                </View>
              </>
            ) : (
              <>
                <Text style={s.body}>Also read bank alert emails (card spends, NEFT, UPI) from Gmail. Read-only access; emails stay in Gmail.</Text>
                <View style={s.btnRow}><Btn label={mailBusy ? 'Connecting…' : 'Connect Gmail'} onPress={onConnectMail} disabled={mailBusy} primary /></View>
              </>
            )}
          </View>

          <View style={s.btnRow}>
            <Btn label="Manage categories" onPress={() => setManaging(true)} />
          </View>
        </ScrollView>
      ) : (
        <View style={s.fill}>
          <View style={s.chips}>
            {(['all', 'debit', 'credit'] as Filter[]).map(f => (
              <Chip key={f} label={f === 'all' ? 'All' : f === 'debit' ? 'Paid' : 'Received'} on={filter === f} onPress={() => setFilter(f)} />
            ))}
            {catFilter && <Chip label={`${catFilter}  ✕`} on onPress={() => setCatFilter(null)} />}
          </View>
          <FlatList
            data={listTx}
            keyExtractor={t => t.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
            ListEmptyComponent={<Text style={[s.mute, { textAlign: 'center', marginTop: 40 }]}>No entries for this month.</Text>}
            renderItem={({ item: t }) => <TxnRow t={t} onPress={() => setSelected(t)} />}
          />
        </View>
      )}

      <Pressable style={[s.fab, { bottom: 76 + insets.bottom }]} onPress={() => setAdding(true)}>
        <Text style={s.fabText}>＋ Add</Text>
      </Pressable>

      <View style={[s.tabs, { paddingBottom: insets.bottom + 6 }]}>
        <TabBtn label="Overview" on={tab === 'overview'} onPress={() => setTab('overview')} />
        <TabBtn label="Transactions" on={tab === 'txns'} onPress={() => setTab('txns')} />
      </View>

      <TxnModal t={selected} cats={cats} onAddCat={addCategory} onClose={() => setSelected(null)} onUpdate={updateTxn} onDelete={deleteTxn} />
      <EntryModal visible={adding} cats={cats} onAddCat={addCategory} onClose={() => setAdding(false)} onSave={addEntry} />
      <CategoriesModal visible={managing} cats={cats} onAdd={addCategory} onDelete={deleteCategory} onClose={() => setManaging(false)} />
    </View>
  );
}

function TxnRow({ t, onPress }: { t: Txn; onPress: () => void }) {
  const m = catMeta(t.category);
  return (
    <Pressable style={[s.txn, t.excluded && { opacity: 0.45 }]} onPress={onPress}>
      <View style={[s.dot, { backgroundColor: m.color + '33' }]}><Text>{m.icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.txnName} numberOfLines={1}>{t.merchant}</Text>
        <Text style={s.txnMeta} numberOfLines={1}>
          {t.source === 'email' ? '✉ ' : ''}{t.category} · {t.mode}{t.bank ? ` · ${t.bank}` : ''}{t.account ? ` xx${t.account}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.txnAmt, { color: t.type === 'credit' ? C.green : C.text }]}>
          {t.type === 'credit' ? '+' : '−'}{inr(t.amount, true).replace('₹', '₹ ')}
        </Text>
        <Text style={s.txnMeta}>{fmtDate(t.date)}</Text>
      </View>
    </Pressable>
  );
}

/** Bottom sheet that stays above the keyboard and the phone's navigation bar; buttons sit in a fixed footer. */
function Sheet({ visible, onClose, children, footer }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      {/* A modal is its own window, so it needs its own safe-area measurement. */}
      <SafeAreaProvider>
        <SheetBody onClose={onClose} footer={footer}>{children}</SheetBody>
      </SafeAreaProvider>
    </Modal>
  );
}

// Space kept clear for the phone's navigation bar (3-button bar is ~48dp), even if the system reports less.
const NAV_BAR_MIN = 48;

function SheetBody({ onClose, children, footer }: { onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: Math.max(insets.bottom, NAV_BAR_MIN) + 12 }]}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
        {footer && <View style={s.footer}>{footer}</View>}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Inline form to create a category; used inside pickers and the manage screen. */
function NewCategoryForm({ income, onAdd, onDone, allowTypeSwitch }: {
  income: boolean; onAdd: (c: CustomCategory) => Promise<boolean>; onDone: (name?: string) => void; allowTypeSwitch?: boolean;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(CUSTOM_ICONS[0]);
  const [isIncome, setIsIncome] = useState(income);
  const save = async () => {
    const color = CUSTOM_COLORS[Math.floor(Math.random() * CUSTOM_COLORS.length)];
    const ok = await onAdd({ name, icon, color, income: isIncome, custom: true });
    if (ok) { onDone(name.trim()); setName(''); }
  };
  return (
    <View style={s.newForm}>
      {allowTypeSwitch && (
        <View style={[s.catGrid, { marginBottom: 10 }]}>
          <Chip label="Expense" on={!isIncome} onPress={() => setIsIncome(false)} />
          <Chip label="Income" on={isIncome} onPress={() => setIsIncome(true)} />
        </View>
      )}
      <TextInput style={s.input} placeholder={isIncome ? 'Income category (e.g. Rent received)' : 'Expense category (e.g. House rent)'}
        placeholderTextColor={C.mute} value={name} onChangeText={setName} maxLength={24} />
      <View style={[s.catGrid, { gap: 4 }]}>
        {CUSTOM_ICONS.map(i => (
          <Pressable key={i} onPress={() => setIcon(i)} style={[s.iconCell, icon === i && { borderColor: C.gold, backgroundColor: C.card }]}>
            <Text style={{ fontSize: 20 }}>{i}</Text>
          </Pressable>
        ))}
      </View>
      <View style={s.btnRow}>
        <Btn label="Cancel" onPress={() => onDone()} />
        <Btn label="Add category" onPress={save} primary />
      </View>
    </View>
  );
}

/** Category chips plus a "＋ New" chip that opens the inline form. */
function CategoryPicker({ list, value, income, onPick, onAddCat }: {
  list: Category[]; value: string; income: boolean; onPick: (name: string) => void; onAddCat: (c: CustomCategory) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <View style={s.catGrid}>
        {list.map(c => <Chip key={c.name} label={`${c.icon} ${c.name}`} on={value === c.name} onPress={() => onPick(c.name)} />)}
        {!creating && <Chip label="＋ New" onPress={() => setCreating(true)} />}
      </View>
      {creating && (
        <NewCategoryForm income={income} onAdd={onAddCat} onDone={n => { setCreating(false); if (n) onPick(n); }} />
      )}
    </>
  );
}

function TxnModal({ t, cats, onAddCat, onClose, onUpdate, onDelete }: {
  t: Txn | null; cats: CustomCategory[]; onAddCat: (c: CustomCategory) => Promise<boolean>; onClose: () => void;
  onUpdate: (id: string, p: Partial<Txn>, remember: boolean) => void; onDelete: (id: string) => void;
}) {
  const [remember, setRemember] = useState(true);
  if (!t) return null;
  const income = t.type === 'credit';
  const list = income ? incomeList(cats) : expenseList(cats);
  return (
    <Sheet visible onClose={onClose} footer={<>
      {t.manual && <Btn label="Delete" onPress={() => onDelete(t.id)} danger />}
      <Btn label="Done" onPress={onClose} primary />
    </>}>
      <Text style={s.sheetAmt}>{income ? '+' : '−'}{inr(t.amount, true)}</Text>
      <Text style={s.h2}>{t.merchant}</Text>
      <Text style={s.mute}>
        {fmtDate(t.date)} · {t.mode}{t.bank ? ` · ${t.bank}` : ''}{t.account ? ` xx${t.account}` : ''}{t.ref ? `\nRef ${t.ref}` : ''}
      </Text>

      <Text style={[s.label, { marginTop: 18 }]}>CATEGORY</Text>
      <CategoryPicker list={list} value={t.category} income={income} onAddCat={onAddCat}
        onPick={name => onUpdate(t.id, { category: name, ...(name === 'Card Bill' ? { excluded: true } : {}) }, remember)} />
      {!t.manual && (
        <View style={s.switchRow}>
          <Text style={s.body}>Use this category for all “{t.merchant}” entries</Text>
          <Switch value={remember} onValueChange={setRemember} thumbColor={remember ? C.gold : '#888'} trackColor={{ true: C.goldDeep, false: C.line }} />
        </View>
      )}
      <View style={s.switchRow}>
        <Text style={s.body}>Leave out of totals{'\n'}<Text style={s.mute}>For self-transfers or card bills</Text></Text>
        <Switch value={!!t.excluded} onValueChange={v => onUpdate(t.id, { excluded: v }, false)} thumbColor={t.excluded ? C.gold : '#888'} trackColor={{ true: C.goldDeep, false: C.line }} />
      </View>

      {t.body && (
        <>
          <Text style={[s.label, { marginTop: 14 }]}>{t.source === 'email' ? 'FROM BANK EMAIL' : 'ORIGINAL MESSAGE'}</Text>
          <Text style={s.smsBox}>{t.body}</Text>
        </>
      )}
    </Sheet>
  );
}

function EntryModal({ visible, cats, onAddCat, onClose, onSave }: {
  visible: boolean; cats: CustomCategory[]; onAddCat: (c: CustomCategory) => Promise<boolean>; onClose: () => void;
  onSave: (type: 'debit' | 'credit', a: number, n: string, c: string) => void;
}) {
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [cat, setCat] = useState('Food & Dining');
  const income = type === 'credit';
  const list = (income ? incomeList(cats) : expenseList(cats)).filter(c => !['Card Bill', 'Cash Withdrawal'].includes(c.name));
  const switchType = (t: 'debit' | 'credit') => { setType(t); setCat(t === 'credit' ? 'Received' : 'Food & Dining'); };
  const save = () => {
    const a = parseFloat(amount.replace(/,/g, ''));
    if (!(a > 0)) { Alert.alert('Enter an amount'); return; }
    onSave(type, a, note.trim(), cat);
    setAmount(''); setNote('');
  };
  return (
    <Sheet visible={visible} onClose={onClose} footer={<>
      <Btn label="Cancel" onPress={onClose} />
      <Btn label="Save" onPress={save} primary />
    </>}>
      <Text style={s.h2}>Add entry</Text>
      <View style={[s.catGrid, { marginBottom: 12 }]}>
        <Chip label="Paid" on={!income} onPress={() => switchType('debit')} />
        <Chip label="Received" on={income} onPress={() => switchType('credit')} />
      </View>
      <TextInput style={s.input} placeholder="Amount (₹)" placeholderTextColor={C.mute} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      <TextInput style={s.input} placeholder={income ? 'From / what for? (e.g. Rent)' : 'What for? (e.g. Vegetables)'} placeholderTextColor={C.mute} value={note} onChangeText={setNote} />
      <Text style={s.label}>CATEGORY</Text>
      <CategoryPicker list={list} value={cat} income={income} onPick={setCat} onAddCat={onAddCat} />
      {!income && <Text style={[s.mute, { marginTop: 10 }]}>Tip: mark ATM withdrawals “Leave out of totals” if you log cash spends here, so cash isn’t counted twice.</Text>}
    </Sheet>
  );
}

function CategoriesModal({ visible, cats, onAdd, onDelete, onClose }: {
  visible: boolean; cats: CustomCategory[]; onAdd: (c: CustomCategory) => Promise<boolean>;
  onDelete: (c: CustomCategory) => void; onClose: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const section = (title: string, list: CustomCategory[]) => (
    <>
      <Text style={[s.label, { marginTop: 14 }]}>{title}</Text>
      {list.length === 0 && <Text style={s.mute}>None added yet.</Text>}
      {list.map(c => (
        <View key={c.name} style={s.manageRow}>
          <Text style={{ fontSize: 18 }}>{c.icon}</Text>
          <Text style={[s.body, { flex: 1 }]}>{c.name}</Text>
          <Pressable hitSlop={10} onPress={() => onDelete(c)}><Text style={{ color: C.red, fontSize: 13 }}>Delete</Text></Pressable>
        </View>
      ))}
    </>
  );
  return (
    <Sheet visible={visible} onClose={onClose} footer={<Btn label="Done" onPress={onClose} primary />}>
      <Text style={s.h2}>Your categories</Text>
      <Text style={s.mute}>Built-in categories stay; these are the ones you added.</Text>
      {section('EXPENSE', cats.filter(c => !c.income))}
      {section('INCOME', cats.filter(c => c.income))}
      {creating
        ? <NewCategoryForm income={false} allowTypeSwitch onAdd={onAdd} onDone={() => setCreating(false)} />
        : <View style={s.btnRow}><Btn label="＋ New category" onPress={() => setCreating(true)} /></View>}
    </Sheet>
  );
}

const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <View style={{ flex: 1 }}>
    <Text style={s.label}>{label.toUpperCase()}</Text>
    <Text style={[s.statVal, color ? { color } : null]}>{value}</Text>
  </View>
);
const Chip = ({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && { color: C.bg }]}>{label}</Text></Pressable>
);
const Btn = ({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) => (
  <Pressable disabled={disabled} onPress={onPress}
    style={[s.btn, primary && { backgroundColor: C.gold, borderColor: C.gold }, danger && { borderColor: C.red }, disabled && { opacity: 0.5 }]}>
    <Text style={[s.btnText, primary && { color: C.bg }, danger && { color: C.red }]}>{label}</Text>
  </Pressable>
);
const TabBtn = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable style={s.tabBtn} onPress={onPress}>
    <Text style={[s.tabText, on && { color: C.gold }]}>{label}</Text>
    <View style={[s.tabLine, on && { backgroundColor: C.gold }]} />
  </Pressable>
);

const serif = 'serif';
const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  brand: { color: C.gold, fontSize: 30, fontFamily: serif, fontWeight: '600', letterSpacing: 0.5 },
  sub: { color: C.mute, fontSize: 12 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  month: { color: C.text, fontSize: 16, fontWeight: '600' },
  arrow: { color: C.gold, fontSize: 30, paddingHorizontal: 8 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  label: { color: C.mute, fontSize: 11, letterSpacing: 1.2, marginBottom: 4 },
  big: { color: C.gold, fontSize: 40, fontFamily: serif, fontWeight: '600', marginBottom: 14 },
  row3: { flexDirection: 'row', gap: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 },
  statVal: { color: C.text, fontSize: 15, fontWeight: '600' },
  h2: { color: C.text, fontSize: 18, fontFamily: serif, fontWeight: '600', marginBottom: 10 },
  body: { color: C.text, fontSize: 14, lineHeight: 20, flex: 1 },
  mute: { color: C.mute, fontSize: 12 },
  catRow: { marginBottom: 12 },
  catTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  catName: { color: C.text, fontSize: 14 },
  catAmt: { color: C.text, fontSize: 14, fontWeight: '600' },
  track: { height: 6, backgroundColor: C.card2, borderRadius: 3, overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3 },
  payee: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.line },
  payeeName: { color: C.text, flex: 1, fontSize: 14 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  btn: { flex: 1, borderWidth: 1, borderColor: C.goldDeep, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: C.gold, fontWeight: '600', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.card },
  chipOn: { backgroundColor: C.gold, borderColor: C.gold },
  chipText: { color: C.text, fontSize: 13 },
  txn: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  dot: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  txnName: { color: C.text, fontSize: 15, fontWeight: '500' },
  txnMeta: { color: C.mute, fontSize: 12, marginTop: 2 },
  txnAmt: { fontSize: 15, fontWeight: '600' },
  fab: { position: 'absolute', right: 16, backgroundColor: C.gold, borderRadius: 26, paddingHorizontal: 18, paddingVertical: 12, elevation: 6 },
  fabText: { color: C.bg, fontWeight: '700' },
  tabs: { flexDirection: 'row', backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line },
  tabBtn: { flex: 1, alignItems: 'center', paddingTop: 12 },
  tabText: { color: C.mute, fontSize: 14, fontWeight: '600' },
  tabLine: { height: 2, width: 28, marginTop: 6, borderRadius: 1, backgroundColor: 'transparent' },
  backdrop: { flex: 1, backgroundColor: '#0009' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 20, maxHeight: '88%', borderTopWidth: 1, borderColor: C.line },
  footer: { flexDirection: 'row', gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line, marginTop: 8 },
  newForm: { backgroundColor: C.card2, borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: C.line },
  iconCell: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  manageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 },
  sheetAmt: { color: C.gold, fontSize: 32, fontFamily: serif, fontWeight: '600', marginBottom: 4 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  smsBox: { color: C.mute, fontSize: 12, lineHeight: 18, backgroundColor: C.card2, borderRadius: 10, padding: 12 },
  input: { backgroundColor: C.card2, color: C.text, borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 10, borderWidth: 1, borderColor: C.line },
});
