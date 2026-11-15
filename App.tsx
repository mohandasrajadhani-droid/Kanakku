import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, BackHandler, FlatList, Keyboard, Pressable, ScrollView, Share,
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
  applyRule, BackupState, loadAccounts, loadAll, loadBackupState, loadMail, MailState, mergeTxns, replaceAll, Rules, saveBackupState,
  saveAccounts, saveCats, saveLastScan, saveMail, saveRules, saveTxns, snapshot,
} from './src/storage';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { makeBackup, parseBackup } from './src/backupFormat';
import { DriveBackup, downloadBackup, listBackups, uploadBackup } from './src/drive';
import { ensureScope, SCOPES } from './src/google';
import { connectGmail, disconnectGmail, fetchBankEmails } from './src/gmail';
import { ago, C, fmtDate, fmtDay, inr, monthLabel } from './src/ui';
import { Btn, Chip, s, Sheet, Stat, TabBtn } from './src/kit';
import { Account, accountFor, balanceOf, markSelfTransfers, reported } from './src/accounts';
import { AccountPicker, AccountSheet, AccountsTab } from './src/AccountsView';

const DAY = 86400000;
const FIRST_SCAN_DAYS = 120;
type Tab = 'overview' | 'txns' | 'accounts';
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
  const [backup, setBackup] = useState<BackupState>({ enabled: false, account: null, lastBackup: 0 });
  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreList, setRestoreList] = useState<DriveBackup[] | null>(null);
  const [newCat, setNewCat] = useState<{ income: boolean; switchable: boolean; onCreated?: (name: string) => void } | null>(null);
  const [cats, setCats] = useState<CustomCategory[]>([]);
  const [mail, setMail] = useState<MailState>({ account: null, lastScan: 0 });
  const [mailBusy, setMailBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const accountsRef = useRef<Account[]>([]);
  const [accSheet, setAccSheet] = useState<{ account: Account | null; draft?: Partial<Account> } | null>(null);
  const [accFilter, setAccFilter] = useState<string | null>(null);
  /** Re-checks which entries are moves between your own accounts (left out of totals). */
  const withTransfers = (list: Txn[]) => markSelfTransfers(list, accountsRef.current);

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
      const { merged: m0, added } = mergeTxns(base, parsed);
      const merged = withTransfers(m0);
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
      const { merged: m0, added } = mergeTxns(base, found);
      const merged = withTransfers(m0);
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
        await disconnectGmail(backup.enabled);
        const m = { account: null, lastScan: 0 };
        setMail(m); await saveMail(m);
      },
    },
  ]);

  // ---------- Backup ----------
  const runBackup = useCallback(async (b: BackupState, silent: boolean) => {
    setBackupBusy(true);
    try {
      const snap = await snapshot();
      await uploadBackup(makeBackup(snap));
      const next = { ...b, lastBackup: Date.now() };
      setBackup(next); await saveBackupState(next);
      if (!silent) Alert.alert('Backup saved', `${snap.txns.length} entries backed up to Google Drive.`);
    } catch (e: any) {
      if (!silent) Alert.alert('Backup failed', String(e?.message ?? e));
    } finally {
      setBackupBusy(false);
    }
  }, []);

  const onEnableBackup = async () => {
    try {
      const account = await ensureScope(SCOPES.drive);
      if (!account) return;
      const b = { enabled: true, account, lastBackup: 0 };
      setBackup(b); await saveBackupState(b);
      await runBackup(b, false);
    } catch (e: any) {
      Alert.alert('Could not turn on backup', String(e?.message ?? e));
    }
  };

  const onDisableBackup = () => Alert.alert('Turn off Drive backup?', 'Backups already on Drive are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Turn off', style: 'destructive', onPress: async () => { const b = { ...backup, enabled: false }; setBackup(b); await saveBackupState(b); } },
  ]);

  const onOpenRestore = async () => {
    setBackupBusy(true);
    try {
      if (!(await ensureScope(SCOPES.drive))) return;
      setRestoreList(await listBackups());
    } catch (e: any) {
      Alert.alert('Could not read backups', String(e?.message ?? e));
    } finally {
      setBackupBusy(false);
    }
  };

  /** Asks for confirmation, then replaces everything on the phone with the backup. */
  const restoreFromText = (text: string) => {
    let data: ReturnType<typeof parseBackup>;
    try { data = parseBackup(text); } catch (e: any) { Alert.alert('Cannot restore', String(e?.message ?? e)); return; }
    const when = data.createdAt ? fmtDate(data.createdAt) : 'unknown date';
    Alert.alert('Restore this backup?', `Backup from ${when} has ${data.txns.length} entries.\nIt will replace the ${txns.length} entries now on this phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore', style: 'destructive', onPress: async () => {
          await replaceAll(data);
          const [d, m, accs] = await Promise.all([loadAll(), loadMail(), loadAccounts()]);
          registerCustom(d.cats);
          accountsRef.current = accs; setAccounts(accs);
          setTxns(d.txns); setRules(d.rules); setLastScan(d.lastScan); setCats(d.cats); setMail(m);
          setRestoreList(null);
          Alert.alert('Restored', `${d.txns.length} entries are back.`);
        },
      },
    ]);
  };

  const onRestoreDrive = async (f: DriveBackup) => {
    setBackupBusy(true);
    try { restoreFromText(await downloadBackup(f.id)); } catch (e: any) { Alert.alert('Download failed', String(e?.message ?? e)); } finally { setBackupBusy(false); }
  };

  const onRestoreFile = async () => {
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream'], copyToCacheDirectory: true });
      if (r.canceled || !r.assets?.[0]) return;
      restoreFromText(await new File(r.assets[0].uri).text());
    } catch (e: any) {
      Alert.alert('Could not open file', String(e?.message ?? e));
    }
  };

  const onShareBackup = async () => {
    try {
      const snap = await snapshot();
      const f = new File(Paths.cache, `kanakku-backup-${fmtDay(Date.now())}.json`);
      if (f.exists) f.delete();
      f.write(makeBackup(snap));
      await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Save Kanakku backup' });
    } catch (e: any) {
      Alert.alert('Could not create backup file', String(e?.message ?? e));
    }
  };

  // Load saved data, then pick up new SMS automatically.
  useEffect(() => {
    (async () => {
      let d, m, b: BackupState, accs: Account[];
      try {
        [d, m, b, accs] = await Promise.all([loadAll(), loadMail(), loadBackupState(), loadAccounts()]);
      } catch (e: any) {
        Alert.alert('Could not open saved data', String(e?.message ?? e));
        return;
      }
      registerCustom(d.cats);
      accountsRef.current = accs; setAccounts(accs);
      setTxns(d.txns); setRules(d.rules); setLastScan(d.lastScan); setCats(d.cats); setMail(m); setBackup(b);
      setReady(true);
      let cur = d.txns;
      if (d.lastScan) cur = await runScan(cur, d.rules, d.lastScan, true);
      if (m.account) await runMail(cur, d.rules, m, true);
      // Weekly automatic backup.
      if (b.enabled && Date.now() - b.lastBackup > 7 * DAY) await runBackup(b, true);
    })();
  }, [runScan, runMail, runBackup]);

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
    if ('category' in patch || 'excluded' in patch) patch = { ...patch, userEdited: true, selfTransfer: undefined, preTransfer: undefined };
    let next = txns.map(t => (t.id === id ? { ...t, ...patch } : t));
    if (remember && patch.category && !orig.manual) {
      const key = orig.merchant.toLowerCase();
      const r = { ...rules, [key]: patch.category };
      setRules(r); await saveRules(r);
      next = next.map(t => (!t.manual && t.type === orig.type && t.merchant.toLowerCase() === key ? { ...t, category: patch.category! } : t));
    }
    if ('accountId' in patch) next = withTransfers(next);
    await persist(next);
    setSelected(next.find(t => t.id === id) || null);
  };

  // ---------- Accounts ----------
  const applyAccounts = async (next: Account[], txnList: Txn[] = txns) => {
    accountsRef.current = next; setAccounts(next);
    await saveAccounts(next);
    await persist(withTransfers(txnList));
  };
  const onSaveAccount = async (a: Account) => {
    const exists = accounts.some(x => x.id === a.id);
    await applyAccounts(exists ? accounts.map(x => (x.id === a.id ? a : x)) : [...accounts, a]);
    setAccSheet(null);
  };
  const onDeleteAccount = async (a: Account) => {
    await applyAccounts(accounts.filter(x => x.id !== a.id), txns.map(t => (t.accountId === a.id ? { ...t, accountId: undefined } : t)));
    if (accFilter === a.id) setAccFilter(null);
    setAccSheet(null);
  };
  const accName = (t: Txn) => accountFor(t, accounts)?.name;

  const deleteTxn = async (id: string) => { await persist(txns.filter(t => t.id !== id)); setSelected(null); };

  const addEntry = async (type: 'debit' | 'credit', amount: number, note: string, category: string, narration: string, accountId?: string) => {
    const acc = accounts.find(a => a.id === accountId);
    const cash = !acc || acc.kind === 'cash';
    const t: Txn = {
      id: `cash-${Date.now()}`, date: Date.now(), amount, type,
      merchant: note || (type === 'debit' ? (cash ? 'Cash expense' : 'Payment') : (cash ? 'Cash received' : 'Received')),
      mode: cash ? 'Cash' : 'Other', category, manual: true, note: narration || undefined,
      accountId: acc ? acc.id : accountId === 'none' ? 'none' : undefined,
    };
    await persist([t, ...txns]);
    setAdding(false);
  };

  const openNewCat: NewCatFn = (income, onCreated) => setNewCat({ income, switchable: false, onCreated });

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
    () => monthTx.filter(t => (filter === 'all' || t.type === filter) && (!catFilter || t.category === catFilter)
      && (!accFilter || accountFor(t, accounts)?.id === accFilter)),
    [monthTx, filter, catFilter, accFilter, accounts],
  );

  const exportCsv = async () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Type', 'Amount', 'Payee', 'Narration', 'Category', 'Mode', 'Account', 'Bank', 'A/c no.', 'Reference', 'Counted']];
    for (const t of [...monthTx].reverse()) {
      rows.push([fmtDay(t.date), t.type === 'debit' ? 'Paid' : 'Received', t.amount.toFixed(2), t.merchant, t.note ?? '', t.category, t.mode,
        accName(t) ?? '', t.bank ?? '', t.account ? `xx${t.account}` : '', t.ref ?? '', t.excluded ? 'No' : 'Yes']);
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

          <View style={[s.card, { marginTop: 14 }]}>
            <Text style={s.h2}>Backup</Text>
            {backup.enabled ? (
              <>
                <Text style={s.body}>Google Drive: {backup.account}</Text>
                <Text style={s.mute}>
                  Last backup {backup.lastBackup ? ago(backup.lastBackup) : 'not yet'} · automatic every week · last 5 kept
                </Text>
                <View style={s.btnRow}>
                  <Btn label={backupBusy ? 'Working…' : 'Back up now'} onPress={() => runBackup(backup, false)} disabled={backupBusy} primary />
                  <Btn label="Restore" onPress={onOpenRestore} disabled={backupBusy} />
                </View>
                <View style={s.btnRow}>
                  <Btn label="Save backup file" onPress={onShareBackup} />
                  <Btn label="Turn off" onPress={onDisableBackup} danger />
                </View>
              </>
            ) : (
              <>
                <Text style={s.body}>Your entries live only on this phone. Turn on backup to keep a copy in a private Kanakku folder on your Google Drive (only this app can see it).</Text>
                <View style={s.btnRow}>
                  <Btn label={backupBusy ? 'Working…' : 'Turn on Drive backup'} onPress={onEnableBackup} disabled={backupBusy} primary />
                </View>
                <View style={s.btnRow}>
                  <Btn label="Save backup file" onPress={onShareBackup} />
                  <Btn label="Restore" onPress={onOpenRestore} disabled={backupBusy} />
                </View>
              </>
            )}
          </View>

          <View style={s.btnRow}>
            <Btn label="Manage categories" onPress={() => setManaging(true)} />
          </View>
        </ScrollView>
      ) : tab === 'accounts' ? (
        <AccountsTab accounts={accounts} txns={txns} monthStart={month} monthEnd={shiftMonth(month, 1)}
          onOpen={a => setAccSheet({ account: a })} onAdd={draft => setAccSheet({ account: null, draft })}
          onViewEntries={a => { setAccFilter(a.id); setCatFilter(null); setFilter('all'); setTab('txns'); }} />
      ) : (
        <View style={s.fill}>
          <View style={s.chips}>
            {(['all', 'debit', 'credit'] as Filter[]).map(f => (
              <Chip key={f} label={f === 'all' ? 'All' : f === 'debit' ? 'Paid' : 'Received'} on={filter === f} onPress={() => setFilter(f)} />
            ))}
            {catFilter && <Chip label={`${catFilter}  ✕`} on onPress={() => setCatFilter(null)} />}
            {accFilter && <Chip label={`${accounts.find(a => a.id === accFilter)?.name ?? 'Account'}  ✕`} on onPress={() => setAccFilter(null)} />}
          </View>
          <FlatList
            data={listTx}
            keyExtractor={t => t.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
            ListEmptyComponent={<Text style={[s.mute, { textAlign: 'center', marginTop: 40 }]}>No entries for this month.</Text>}
            renderItem={({ item: t }) => <TxnRow t={t} accName={accName(t)} onPress={() => setSelected(t)} />}
          />
        </View>
      )}

      <Pressable style={[s.fab, { bottom: 76 + insets.bottom }]} onPress={() => setAdding(true)}>
        <Text style={s.fabText}>＋ Add</Text>
      </Pressable>

      <View style={[s.tabs, { paddingBottom: insets.bottom + 6 }]}>
        <TabBtn label="Overview" on={tab === 'overview'} onPress={() => setTab('overview')} />
        <TabBtn label="Transactions" on={tab === 'txns'} onPress={() => setTab('txns')} />
        <TabBtn label="Accounts" on={tab === 'accounts'} onPress={() => setTab('accounts')} />
      </View>

      <TxnModal t={selected} cats={cats} accounts={accounts} onNewCat={openNewCat} onClose={() => setSelected(null)} onUpdate={updateTxn} onDelete={deleteTxn} />
      <EntryModal visible={adding} cats={cats} accounts={accounts} onNewCat={openNewCat} onClose={() => setAdding(false)} onSave={addEntry} />
      <CategoriesModal visible={managing} cats={cats} onNew={() => setNewCat({ income: false, switchable: true })} onDelete={deleteCategory} onClose={() => setManaging(false)} />
      <Sheet visible={!!restoreList} onClose={() => setRestoreList(null)} footer={<>
        <Btn label="From a file" onPress={onRestoreFile} />
        <Btn label="Close" onPress={() => setRestoreList(null)} primary />
      </>}>
        <Text style={s.h2}>Restore a backup</Text>
        <Text style={s.mute}>Restoring replaces everything now on this phone.</Text>
        {restoreList?.length === 0 && <Text style={[s.body, { marginTop: 12 }]}>No backups on Google Drive yet.</Text>}
        {restoreList?.map(f => (
          <Pressable key={f.id} style={s.manageRow} onPress={() => onRestoreDrive(f)} disabled={backupBusy}>
            <Text style={{ fontSize: 18 }}>☁</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.body}>{fmtDate(new Date(f.createdTime).getTime())}</Text>
              {f.size && <Text style={s.mute}>{Math.max(1, Math.round(Number(f.size) / 1024))} KB</Text>}
            </View>
            <Text style={{ color: C.gold, fontSize: 13 }}>{backupBusy ? '…' : 'Restore'}</Text>
          </Pressable>
        ))}
      </Sheet>
      <AccountSheet visible={!!accSheet} account={accSheet?.account ?? null} draft={accSheet?.draft}
        balanceNow={accSheet?.account ? balanceOf(accSheet.account, txns, accounts, month, shiftMonth(month, 1)).value : undefined}
        onSave={onSaveAccount} onDelete={onDeleteAccount} onClose={() => setAccSheet(null)} />
      <NewCategorySheet visible={!!newCat} income={newCat?.income ?? false} allowTypeSwitch={newCat?.switchable} onAdd={addCategory}
        onDone={name => { const cb = newCat?.onCreated; setNewCat(null); if (name && cb) cb(name); }} />
    </View>
  );
}

function TxnRow({ t, accName, onPress }: { t: Txn; accName?: string; onPress: () => void }) {
  const m = catMeta(t.category);
  return (
    <Pressable style={[s.txn, t.excluded && { opacity: 0.45 }]} onPress={onPress}>
      <View style={[s.dot, { backgroundColor: m.color + '33' }]}><Text>{m.icon}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.txnName} numberOfLines={1}>{t.merchant}</Text>
        <Text style={s.txnMeta} numberOfLines={1}>
          {t.source === 'email' ? '✉ ' : ''}{t.selfTransfer ? '⇄ ' : ''}{t.category} · {accName ?? `${t.mode}${t.bank ? ` · ${t.bank}` : ''}${t.account ? ` xx${t.account}` : ''}`}
        </Text>
        {!!t.note && <Text style={s.txnNote} numberOfLines={2}>✎ {t.note}</Text>}
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

/** Separate sheet for creating a category; its Add button sits in the fixed footer so it is never hidden. */
function NewCategorySheet({ visible, income, allowTypeSwitch, onAdd, onDone }: {
  visible: boolean; income: boolean; allowTypeSwitch?: boolean;
  onAdd: (c: CustomCategory) => Promise<boolean>; onDone: (name?: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(CUSTOM_ICONS[0]);
  const [isIncome, setIsIncome] = useState(income);
  useEffect(() => { if (visible) { setIsIncome(income); setName(''); setIcon(CUSTOM_ICONS[0]); } }, [visible, income]);
  const save = async () => {
    const color = CUSTOM_COLORS[Math.floor(Math.random() * CUSTOM_COLORS.length)];
    const ok = await onAdd({ name, icon, color, income: isIncome, custom: true });
    if (ok) { Keyboard.dismiss(); onDone(name.trim()); }
  };
  return (
    <Sheet visible={visible} onClose={() => onDone()} footer={<>
      <Btn label="Cancel" onPress={() => onDone()} />
      <Btn label="Add category" onPress={save} primary />
    </>}>
      <Text style={s.h2}>New {isIncome ? 'income' : 'expense'} category</Text>
      {allowTypeSwitch && (
        <View style={[s.catGrid, { marginBottom: 10 }]}>
          <Chip label="Expense" on={!isIncome} onPress={() => setIsIncome(false)} />
          <Chip label="Income" on={isIncome} onPress={() => setIsIncome(true)} />
        </View>
      )}
      <TextInput style={s.input} placeholder={isIncome ? 'Name (e.g. Rent received)' : 'Name (e.g. House rent)'}
        placeholderTextColor={C.mute} value={name} onChangeText={setName} maxLength={24} autoFocus
        returnKeyType="done" onSubmitEditing={save} />
      <Text style={s.label}>ICON</Text>
      <View style={[s.catGrid, { gap: 4 }]}>
        {CUSTOM_ICONS.map(i => (
          <Pressable key={i} onPress={() => setIcon(i)} style={[s.iconCell, icon === i && { borderColor: C.gold, backgroundColor: C.card2 }]}>
            <Text style={{ fontSize: 20 }}>{i}</Text>
          </Pressable>
        ))}
      </View>
    </Sheet>
  );
}

/** Category chips plus a "＋ New" chip that opens the new-category sheet. */
function CategoryPicker({ list, value, onPick, onNew }: {
  list: Category[]; value: string; onPick: (name: string) => void; onNew: () => void;
}) {
  return (
    <View style={s.catGrid}>
      {list.map(c => <Chip key={c.name} label={`${c.icon} ${c.name}`} on={value === c.name} onPress={() => onPick(c.name)} />)}
      <Chip label="＋ New" onPress={() => { Keyboard.dismiss(); onNew(); }} />
    </View>
  );
}

type NewCatFn = (income: boolean, onCreated: (name: string) => void) => void;

function TxnModal({ t, cats, accounts, onNewCat, onClose, onUpdate, onDelete }: {
  t: Txn | null; cats: CustomCategory[]; accounts: Account[]; onNewCat: NewCatFn; onClose: () => void;
  onUpdate: (id: string, p: Partial<Txn>, remember: boolean) => void; onDelete: (id: string) => void;
}) {
  const [remember, setRemember] = useState(true);
  const [note, setNote] = useState('');
  useEffect(() => { setNote(t?.note ?? ''); }, [t?.id]);
  if (!t) return null;
  const income = t.type === 'credit';
  const list = income ? incomeList(cats) : expenseList(cats);
  const saveNote = () => {
    const v = note.trim();
    if (v !== (t.note ?? '')) onUpdate(t.id, { note: v || undefined }, false);
  };
  const close = () => { saveNote(); onClose(); };
  return (
    <Sheet visible onClose={close} footer={<>
      {t.manual && <Btn label="Delete" onPress={() => onDelete(t.id)} danger />}
      <Btn label="Done" onPress={close} primary />
    </>}>
      <Text style={s.sheetAmt}>{income ? '+' : '−'}{inr(t.amount, true)}</Text>
      <Text style={s.h2}>{t.merchant}</Text>
      <Text style={s.mute}>
        {fmtDate(t.date)} · {t.mode}{t.bank ? ` · ${t.bank}` : ''}{t.account ? ` xx${t.account}` : ''}{t.ref ? `\nRef ${t.ref}` : ''}
      </Text>

      <Text style={[s.label, { marginTop: 18 }]}>NARRATION</Text>
      <TextInput style={[s.input, s.noteInput]} placeholder="Add a note (e.g. Mother's medicine, shop rent Nov)" placeholderTextColor={C.mute}
        value={note} onChangeText={setNote} onEndEditing={saveNote} multiline maxLength={200} />

      <Text style={[s.label, { marginTop: 8 }]}>ACCOUNT</Text>
      <AccountPicker accounts={accounts} value={accountFor(t, accounts)?.id} allowNone onPick={id => onUpdate(t.id, { accountId: id }, false)} />
      {(() => {
        const r = reported(t);
        const parts = [r.balance != null && `Balance after: ${inr(r.balance, true)}`, r.availLimit != null && `Available limit: ${inr(r.availLimit, true)}`].filter(Boolean);
        return parts.length ? <Text style={[s.mute, { marginTop: 6 }]}>{parts.join(' · ')}</Text> : null;
      })()}
      {t.selfTransfer && <Text style={[s.mute, { marginTop: 6, color: C.gold }]}>⇄ Move between your own accounts, left out of totals</Text>}

      <Text style={[s.label, { marginTop: 14 }]}>CATEGORY</Text>
      <CategoryPicker list={list} value={t.category}
        onNew={() => onNewCat(income, name => onUpdate(t.id, { category: name }, remember))}
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

function EntryModal({ visible, cats, accounts, onNewCat, onClose, onSave }: {
  visible: boolean; cats: CustomCategory[]; accounts: Account[]; onNewCat: NewCatFn; onClose: () => void;
  onSave: (type: 'debit' | 'credit', a: number, n: string, c: string, narration: string, accountId?: string) => void;
}) {
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  useEffect(() => { if (visible) setAccountId(accounts.find(a => a.kind === 'cash')?.id); }, [visible]);
  const [type, setType] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [narration, setNarration] = useState('');
  const [cat, setCat] = useState('Food & Dining');
  const income = type === 'credit';
  const list = (income ? incomeList(cats) : expenseList(cats)).filter(c => !['Card Bill', 'Cash Withdrawal'].includes(c.name));
  const switchType = (t: 'debit' | 'credit') => { setType(t); setCat(t === 'credit' ? 'Received' : 'Food & Dining'); };
  const save = () => {
    const a = parseFloat(amount.replace(/,/g, ''));
    if (!(a > 0)) { Alert.alert('Enter an amount'); return; }
    Keyboard.dismiss();
    onSave(type, a, note.trim(), cat, narration.trim(), accountId);
    setAmount(''); setNote(''); setNarration('');
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
      <TextInput style={s.input} placeholder={income ? 'Received from (e.g. Tenant)' : 'Paid to / for (e.g. Vegetable shop)'} placeholderTextColor={C.mute} value={note} onChangeText={setNote} />
      <TextInput style={[s.input, s.noteInput]} placeholder="Narration (optional details)" placeholderTextColor={C.mute} value={narration} onChangeText={setNarration} multiline maxLength={200} />
      {accounts.length > 0 && (
        <>
          <Text style={s.label}>{income ? 'RECEIVED INTO' : 'PAID FROM'}</Text>
          <View style={{ marginBottom: 12 }}>
            <AccountPicker accounts={accounts} value={accountId === 'none' ? undefined : accountId} allowNone onPick={setAccountId} />
          </View>
        </>
      )}
      <Text style={s.label}>CATEGORY</Text>
      <CategoryPicker list={list} value={cat} onPick={setCat} onNew={() => onNewCat(income, setCat)} />
      {!income && <Text style={[s.mute, { marginTop: 10 }]}>Tip: mark ATM withdrawals “Leave out of totals” if you log cash spends here, so cash isn’t counted twice.</Text>}
    </Sheet>
  );
}

function CategoriesModal({ visible, cats, onNew, onDelete, onClose }: {
  visible: boolean; cats: CustomCategory[]; onNew: () => void;
  onDelete: (c: CustomCategory) => void; onClose: () => void;
}) {
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
    <Sheet visible={visible} onClose={onClose} footer={<>
      <Btn label="＋ New category" onPress={onNew} />
      <Btn label="Done" onPress={onClose} primary />
    </>}>
      <Text style={s.h2}>Your categories</Text>
      <Text style={s.mute}>Built-in categories stay; these are the ones you added.</Text>
      {section('EXPENSE', cats.filter(c => !c.income))}
      {section('INCOME', cats.filter(c => c.income))}
    </Sheet>
  );
}
