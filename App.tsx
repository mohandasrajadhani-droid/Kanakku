import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Modal, Pressable, ScrollView, Share,
  StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseSms, Txn } from './src/parser';
import { catMeta, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './src/categories';
import { ensureSmsPermission, readInbox } from './src/sms';
import { applyRule, loadAll, mergeTxns, Rules, saveLastScan, saveRules, saveTxns } from './src/storage';
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

  const runScan = useCallback(async (base: Txn[], baseRules: Rules, baseLast: number, silent: boolean) => {
    setScanning(true);
    try {
      const ok = await ensureSmsPermission();
      if (!ok) {
        if (!silent) Alert.alert('SMS access needed', 'Allow SMS access so Kanakku can read bank and UPI alerts. Nothing leaves your phone.');
        return;
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
    } catch (e: any) {
      if (!silent) Alert.alert('Scan failed', String(e?.message ?? e));
    } finally {
      setScanning(false);
    }
  }, []);

  // Load saved data, then pick up new SMS automatically.
  useEffect(() => {
    (async () => {
      const d = await loadAll();
      setTxns(d.txns); setRules(d.rules); setLastScan(d.lastScan);
      setReady(true);
      if (d.lastScan) runScan(d.txns, d.rules, d.lastScan, true);
    })();
  }, [runScan]);

  // Re-scan when the app comes back to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && ready && lastScan && !scanning) runScan(txns, rules, lastScan, true);
    });
    return () => sub.remove();
  }, [ready, lastScan, scanning, txns, rules, runScan]);

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

  const addCash = async (amount: number, note: string, category: string) => {
    const t: Txn = {
      id: `cash-${Date.now()}`, date: Date.now(), amount, type: 'debit', merchant: note || 'Cash expense',
      mode: 'Cash', category, manual: true,
    };
    await persist([t, ...txns]);
    setAdding(false);
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
        <Text style={s.sub}>{scanning ? 'Reading messages…' : `Updated ${ago(lastScan)}`}</Text>
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
        <Text style={s.fabText}>＋ Cash</Text>
      </Pressable>

      <View style={[s.tabs, { paddingBottom: insets.bottom + 6 }]}>
        <TabBtn label="Overview" on={tab === 'overview'} onPress={() => setTab('overview')} />
        <TabBtn label="Transactions" on={tab === 'txns'} onPress={() => setTab('txns')} />
      </View>

      <TxnModal t={selected} onClose={() => setSelected(null)} onUpdate={updateTxn} onDelete={deleteTxn} />
      <CashModal visible={adding} onClose={() => setAdding(false)} onSave={addCash} />
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
          {t.category} · {t.mode}{t.bank ? ` · ${t.bank}` : ''}{t.account ? ` xx${t.account}` : ''}
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

function TxnModal({ t, onClose, onUpdate, onDelete }: {
  t: Txn | null; onClose: () => void;
  onUpdate: (id: string, p: Partial<Txn>, remember: boolean) => void; onDelete: (id: string) => void;
}) {
  const [remember, setRemember] = useState(true);
  if (!t) return null;
  const cats = t.type === 'credit' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <ScrollView>
          <Text style={s.sheetAmt}>{t.type === 'credit' ? '+' : '−'}{inr(t.amount, true)}</Text>
          <Text style={s.h2}>{t.merchant}</Text>
          <Text style={s.mute}>
            {fmtDate(t.date)} · {t.mode}{t.bank ? ` · ${t.bank}` : ''}{t.account ? ` xx${t.account}` : ''}{t.ref ? `\nRef ${t.ref}` : ''}
          </Text>

          <Text style={[s.label, { marginTop: 18 }]}>CATEGORY</Text>
          <View style={s.catGrid}>
            {cats.map(c => (
              <Chip key={c.name} label={`${c.icon} ${c.name}`} on={t.category === c.name}
                onPress={() => onUpdate(t.id, { category: c.name, ...(c.name === 'Card Bill' ? { excluded: true } : {}) }, remember)} />
            ))}
          </View>
          {!t.manual && (
            <View style={s.switchRow}>
              <Text style={s.body}>Use this category for all “{t.merchant}” payments</Text>
              <Switch value={remember} onValueChange={setRemember} thumbColor={remember ? C.gold : '#888'} trackColor={{ true: C.goldDeep, false: C.line }} />
            </View>
          )}
          <View style={s.switchRow}>
            <Text style={s.body}>Leave out of totals{'\n'}<Text style={s.mute}>For self-transfers or card bills</Text></Text>
            <Switch value={!!t.excluded} onValueChange={v => onUpdate(t.id, { excluded: v }, false)} thumbColor={t.excluded ? C.gold : '#888'} trackColor={{ true: C.goldDeep, false: C.line }} />
          </View>

          {t.body && (
            <>
              <Text style={[s.label, { marginTop: 14 }]}>ORIGINAL MESSAGE</Text>
              <Text style={s.smsBox}>{t.body}</Text>
            </>
          )}
          <View style={s.btnRow}>
            {t.manual && <Btn label="Delete" onPress={() => onDelete(t.id)} danger />}
            <Btn label="Done" onPress={onClose} primary />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function CashModal({ visible, onClose, onSave }: { visible: boolean; onClose: () => void; onSave: (a: number, n: string, c: string) => void }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [cat, setCat] = useState('Food & Dining');
  const save = () => {
    const a = parseFloat(amount.replace(/,/g, ''));
    if (!(a > 0)) { Alert.alert('Enter an amount'); return; }
    onSave(a, note.trim(), cat);
    setAmount(''); setNote('');
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <Text style={s.h2}>Cash expense</Text>
        <TextInput style={s.input} placeholder="Amount (₹)" placeholderTextColor={C.mute} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus />
        <TextInput style={s.input} placeholder="What for? (e.g. Vegetables)" placeholderTextColor={C.mute} value={note} onChangeText={setNote} />
        <View style={s.catGrid}>
          {EXPENSE_CATEGORIES.filter(c => !['Card Bill', 'Cash Withdrawal'].includes(c.name)).map(c => (
            <Chip key={c.name} label={`${c.icon} ${c.name}`} on={cat === c.name} onPress={() => setCat(c.name)} />
          ))}
        </View>
        <Text style={[s.mute, { marginTop: 8 }]}>Tip: mark ATM withdrawals “Leave out of totals” if you log cash spends here, so cash isn’t counted twice.</Text>
        <View style={s.btnRow}>
          <Btn label="Cancel" onPress={onClose} />
          <Btn label="Save" onPress={save} primary />
        </View>
      </View>
    </Modal>
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
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '85%', borderTopWidth: 1, borderColor: C.line },
  sheetAmt: { color: C.gold, fontSize: 32, fontFamily: serif, fontWeight: '600', marginBottom: 4 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  smsBox: { color: C.mute, fontSize: 12, lineHeight: 18, backgroundColor: C.card2, borderRadius: 10, padding: 12 },
  input: { backgroundColor: C.card2, color: C.text, borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 10, borderWidth: 1, borderColor: C.line },
});
