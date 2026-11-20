import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { Txn } from './parser';
import { Account, AccountKind, Balance, BalanceAlert, balanceOf, detectAccounts, KINDS, Suggestion } from './accounts';
import { BALANCE_NUMBERS, checkNumberFor } from './balanceCheck';
import { Btn, Chip, s, Sheet } from './kit';
import { C, fmtDate, inr } from './ui';

const shortDate = (ms: number) => fmtDate(ms).split(',')[0];

function describe(acc: Account, b: Balance): string {
  if (acc.kind === 'cash' && b.source === 'you' && !acc.openingAt) return 'Set the cash in hand to start';
  if (b.source === 'bank') return `As per bank SMS, ${shortDate(b.sourceAt)}${b.later ? ` + ${b.later} later entr${b.later > 1 ? 'ies' : 'y'}` : ''}`;
  if (acc.openingAt) return `From balance you set, ${shortDate(acc.openingAt)}${b.later ? ` + ${b.later} entr${b.later > 1 ? 'ies' : 'y'}` : ''}`;
  return 'Balance not set yet. Tap to set it';
}

/** The Accounts tab: totals, accounts found in messages, and each account with its balance. */
export function AccountsTab({ accounts, txns, alerts, monthStart, monthEnd, checkingId, onOpen, onAdd, onViewEntries, onCheck }: {
  accounts: Account[]; txns: Txn[]; alerts: BalanceAlert[]; monthStart: number; monthEnd: number; checkingId?: string | null;
  onOpen: (a: Account) => void; onAdd: (draft?: Partial<Account>) => void; onViewEntries: (a: Account) => void; onCheck: (a: Account) => void;
}) {
  const balances = useMemo(
    () => new Map(accounts.map(a => [a.id, balanceOf(a, txns, accounts, monthStart, monthEnd, alerts)])),
    [accounts, txns, monthStart, monthEnd, alerts],
  );
  const suggestions = useMemo(() => detectAccounts(txns, accounts), [txns, accounts]);
  const money = accounts.filter(a => a.kind !== 'card').reduce((sum, a) => sum + (balances.get(a.id)?.value ?? 0), 0);
  const dues = accounts.filter(a => a.kind === 'card').reduce((sum, a) => sum + (balances.get(a.id)?.value ?? 0), 0);
  const order: AccountKind[] = ['bank', 'card', 'wallet', 'cash'];
  const sorted = [...accounts].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
      <View style={s.card}>
        <Text style={s.label}>IN BANKS, WALLETS & CASH</Text>
        <Text style={s.big}>{inr(money)}</Text>
        <View style={s.row3}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>CARD DUES</Text>
            <Text style={[s.statVal, { color: dues > 0 ? C.red : C.text }]}>{inr(dues)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>AFTER DUES</Text>
            <Text style={[s.statVal, { color: money - dues >= 0 ? C.green : C.red }]}>{inr(money - dues)}</Text>
          </View>
        </View>
      </View>

      {suggestions.length > 0 && (
        <View style={[s.card, { borderColor: C.goldDeep }]}>
          <Text style={s.h2}>Found in your messages</Text>
          <Text style={s.mute}>Add these so their entries and balances are tracked.</Text>
          {suggestions.slice(0, 8).map(g => (
            <View key={`${g.bank}|${g.last4}`} style={s.manageRow}>
              <Text style={{ fontSize: 18 }}>{KINDS[g.kind].icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.body}>{g.bank ?? 'Account'} xx{g.last4}</Text>
                <Text style={s.mute}>{KINDS[g.kind].label} · {g.count} entr{g.count > 1 ? 'ies' : 'y'}</Text>
              </View>
              <Pressable hitSlop={10} onPress={() => onAdd(fromSuggestion(g))}>
                <Text style={{ color: C.gold, fontWeight: '600' }}>＋ Add</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {sorted.map(a => {
        const b = balances.get(a.id)!;
        const card = a.kind === 'card';
        return (
          <Pressable key={a.id} style={s.card} onPress={() => onOpen(a)}>
            <View style={st.accTop}>
              <Text style={{ fontSize: 22 }}>{KINDS[a.kind].icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.txnName} numberOfLines={1}>{a.name}</Text>
                <Text style={s.txnMeta} numberOfLines={1}>{[a.bank, a.last4 && `xx${a.last4}`].filter(Boolean).join(' ') || KINDS[a.kind].label}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {card && <Text style={s.txnMeta}>DUE</Text>}
                <Text style={[st.accBal, card && b.value > 0 && { color: C.red }, !card && b.value < 0 && { color: C.red }]}>{inr(b.value, true)}</Text>
              </View>
            </View>
            {card && b.available != null && (
              <View style={{ marginTop: 10 }}>
                <View style={s.track}>
                  <View style={[s.bar, { width: `${Math.min(100, Math.max(2, (b.value / a.limit!) * 100))}%`, backgroundColor: C.red }]} />
                </View>
                <Text style={[s.mute, { marginTop: 4 }]}>Available {inr(b.available)} of {inr(a.limit!)}</Text>
              </View>
            )}
            <Text style={[s.mute, { marginTop: 8 }]}>{describe(a, b)}</Text>
            <View style={st.accFoot}>
              <Text style={s.mute}>This month: <Text style={{ color: C.green }}>+{inr(b.monthIn)}</Text>  <Text style={{ color: C.text }}>−{inr(b.monthOut)}</Text></Text>
              <Pressable hitSlop={10} onPress={() => onViewEntries(a)}><Text style={{ color: C.gold, fontSize: 13 }}>Entries ›</Text></Pressable>
            </View>
            {a.kind === 'bank' && (
              <Pressable style={st.checkBtn} onPress={() => onCheck(a)} disabled={checkingId === a.id}>
                <Text style={st.checkText}>{checkingId === a.id ? '⏳ Waiting for bank SMS…' : '📞 Check balance with bank'}</Text>
              </Pressable>
            )}
          </Pressable>
        );
      })}

      {accounts.length === 0 && suggestions.length === 0 && (
        <Text style={[s.mute, { textAlign: 'center', marginVertical: 20 }]}>No accounts yet. Add your bank accounts, cards and cash to track balances.</Text>
      )}
      <View style={s.btnRow}>
        <Btn label="＋ Add account" onPress={() => onAdd()} primary />
        {!accounts.some(a => a.kind === 'cash') && <Btn label="＋ Cash wallet" onPress={() => onAdd({ kind: 'cash', name: 'Cash in hand', atmToCash: true })} />}
      </View>
    </ScrollView>
  );
}

function fromSuggestion(g: Suggestion): Partial<Account> {
  return { kind: g.kind, bank: g.bank, last4: g.last4, name: `${g.bank ?? 'Account'} ${g.kind === 'card' ? 'Card' : 'Savings'}` };
}

/** Add or edit an account. `balanceNow` is today's figure, shown as a hint. */
export function AccountSheet({ visible, account, draft, balance, checking, onCheck, onSave, onDelete, onClose }: {
  visible: boolean; account: Account | null; draft?: Partial<Account>; balance?: Balance; checking?: boolean;
  onCheck?: (a: Account) => void; onSave: (a: Account) => void; onDelete: (a: Account) => void; onClose: () => void;
}) {
  const balanceNow = balance?.value;
  const [showSteps, setShowSteps] = useState(false);
  const [checkNo, setCheckNo] = useState('');
  const base = account ?? draft ?? {};
  const [kind, setKind] = useState<AccountKind>('bank');
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [last4, setLast4] = useState('');
  const [limit, setLimit] = useState('');
  const [bal, setBal] = useState('');
  const [atm, setAtm] = useState(true);
  useEffect(() => {
    if (!visible) return;
    setKind(base.kind ?? 'bank'); setName(base.name ?? ''); setBank(base.bank ?? ''); setLast4(base.last4 ?? '');
    setLimit(base.limit ? String(base.limit) : ''); setBal(''); setAtm(base.atmToCash ?? true);
    setCheckNo(base.checkNumber ?? ''); setShowSteps(false);
  }, [visible, account?.id, draft]);

  const parse = (v: string) => parseFloat(v.replace(/,/g, ''));
  const save = () => {
    if (!name.trim()) { Alert.alert('Enter a name for this account'); return; }
    const lim = parse(limit);
    if (kind === 'card' && !(lim > 0) && limit.trim()) { Alert.alert('Enter the credit limit as a number'); return; }
    const b = parse(bal);
    const next: Account = {
      id: account?.id ?? `acc-${Date.now()}`,
      name: name.trim(), kind,
      bank: kind === 'cash' ? undefined : bank.trim() || undefined,
      last4: kind === 'cash' ? undefined : last4.replace(/\D/g, '').slice(-4) || undefined,
      limit: kind === 'card' && lim > 0 ? lim : undefined,
      atmToCash: kind === 'cash' ? atm : undefined,
      checkNumber: kind === 'bank' && checkNo.replace(/[^\d+]/g, '') ? checkNo.replace(/[^\d+]/g, '') : undefined,
      opening: bal.trim() && !isNaN(b) ? b : account?.opening ?? 0,
      openingAt: bal.trim() && !isNaN(b) ? Date.now() : account?.openingAt ?? 0,
    };
    onSave(next);
  };
  const confirmDelete = () => account && Alert.alert(`Delete “${account.name}”?`, 'Its entries stay; they just won’t be linked to an account.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => onDelete(account) },
  ]);
  const card = kind === 'card';

  return (
    <Sheet visible={visible} onClose={onClose} footer={<>
      {account && <Btn label="Delete" onPress={confirmDelete} danger />}
      <Btn label="Cancel" onPress={onClose} />
      <Btn label="Save" onPress={save} primary />
    </>}>
      <Text style={s.h2}>{account ? account.name : 'Add account'}</Text>
      {account && balance && (
        <View style={st.breakdown}>
          <Text style={s.label}>{account.kind === 'card' ? 'AMOUNT DUE' : 'BALANCE NOW'}</Text>
          <Text style={st.accBal}>{inr(balance.value, true)}</Text>
          <Text style={[s.mute, { marginTop: 4 }]}>
            Started from {inr(balance.value - balance.steps.reduce((x, y) => x + y.amount, 0), true)}{' '}
            {balance.source === 'bank' ? `in a bank SMS, ${fmtDate(balance.sourceAt)}` : account.openingAt ? `that you set, ${fmtDate(account.openingAt)}` : '(no balance set yet)'}
            {balance.steps.length ? `, then ${balance.steps.length} entr${balance.steps.length > 1 ? 'ies' : 'y'}` : ''}
          </Text>
          {balance.steps.length > 0 && (
            <Pressable onPress={() => setShowSteps(!showSteps)} hitSlop={8}>
              <Text style={{ color: C.gold, marginTop: 6, fontSize: 13 }}>{showSteps ? 'Hide' : 'Show'} how this was worked out</Text>
            </Pressable>
          )}
          {showSteps && balance.steps.map(x => (
            <View key={x.id} style={st.stepRow}>
              <Text style={[s.mute, { width: 92 }]}>{fmtDate(x.date)}</Text>
              <Text style={[s.body, { fontSize: 13 }]} numberOfLines={1}>{x.label}</Text>
              <Text style={{ color: x.amount >= 0 ? C.green : C.text, fontSize: 13 }}>{x.amount >= 0 ? '+' : '−'}{inr(Math.abs(x.amount), true)}</Text>
            </View>
          ))}
          {account.kind === 'bank' && onCheck && (
            <Pressable style={st.checkBtn} onPress={() => onCheck(account)} disabled={checking}>
              <Text style={st.checkText}>{checking ? '⏳ Waiting for bank SMS…' : '📞 Check balance with bank'}</Text>
            </Pressable>
          )}
          <Text style={[s.mute, { marginTop: 6 }]}>Wrong? Type the correct balance below and Save.</Text>
        </View>
      )}
      <View style={[s.catGrid, { marginBottom: 12 }]}>
        {(Object.keys(KINDS) as AccountKind[]).map(k => (
          <Chip key={k} label={`${KINDS[k].icon} ${KINDS[k].label}`} on={kind === k} onPress={() => setKind(k)} />
        ))}
      </View>
      <TextInput style={s.input} placeholder="Name (e.g. Federal Savings)" placeholderTextColor={C.mute} value={name} onChangeText={setName} maxLength={30} />
      {kind !== 'cash' && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TextInput style={[s.input, { flex: 1.4 }]} placeholder={kind === 'wallet' ? 'Provider (e.g. Paytm)' : 'Bank (e.g. Federal)'} placeholderTextColor={C.mute} value={bank} onChangeText={setBank} maxLength={20} />
          <TextInput style={[s.input, { flex: 1 }]} placeholder="Last 4 digits" placeholderTextColor={C.mute} value={last4} onChangeText={setLast4} keyboardType="number-pad" maxLength={6} />
        </View>
      )}
      {kind === 'bank' && (
        <>
          <Text style={s.label}>BALANCE CHECK NUMBER (MISSED CALL)</Text>
          <TextInput style={s.input} value={checkNo} onChangeText={setCheckNo} keyboardType="phone-pad" placeholderTextColor={C.mute}
            placeholder={(() => { const k = Object.keys(BALANCE_NUMBERS).find(b => b.toLowerCase() === bank.trim().toLowerCase()); return k ? `${BALANCE_NUMBERS[k]} (${k} default)` : 'Your bank’s missed-call number'; })()} />
        </>
      )}
      {card && (
        <TextInput style={s.input} placeholder="Credit limit (₹)" placeholderTextColor={C.mute} value={limit} onChangeText={setLimit} keyboardType="decimal-pad" />
      )}
      <Text style={s.label}>{card ? 'AMOUNT DUE NOW' : kind === 'cash' ? 'CASH IN HAND NOW' : 'BALANCE NOW'}</Text>
      <TextInput style={s.input} placeholder={balanceNow != null ? `Currently ${inr(balanceNow, true)}. Type to correct` : '₹ (optional)'}
        placeholderTextColor={C.mute} value={bal} onChangeText={setBal} keyboardType="numbers-and-punctuation" />
      <Text style={[s.mute, { marginBottom: 6 }]}>
        {card
          ? 'Kanakku adds card spends and subtracts payments. If your bank SMS shows the available limit, the due is worked out from it automatically.'
          : kind === 'cash'
            ? 'Cash spends you add with ＋ Add come out of this.'
            : 'Kanakku uses the balance printed in your bank SMS whenever there is one, and adds later entries to it. Set it here if there isn’t.'}
      </Text>
      {kind === 'cash' && (
        <View style={s.switchRow}>
          <Text style={s.body}>ATM withdrawals go into this wallet{'\n'}<Text style={s.mute}>They are then not counted as spending; your cash spends are</Text></Text>
          <Switch value={atm} onValueChange={setAtm} thumbColor={atm ? C.gold : '#888'} trackColor={{ true: C.goldDeep, false: C.line }} />
        </View>
      )}
      {(kind === 'bank' || card) && (
        <Text style={[s.mute, { marginTop: 10 }]}>Entries are linked by bank name and last digits. Money moved between your own accounts is left out of spending and income.</Text>
      )}
    </Sheet>
  );
}

/** Account chips for linking an entry. */
export function AccountPicker({ accounts, value, onPick, allowNone }: {
  accounts: Account[]; value?: string; onPick: (id: string) => void; allowNone?: boolean;
}) {
  if (!accounts.length) return <Text style={s.mute}>Add accounts in the Accounts tab to link entries.</Text>;
  return (
    <View style={s.catGrid}>
      {accounts.map(a => <Chip key={a.id} label={`${KINDS[a.kind].icon} ${a.name}`} on={value === a.id} onPress={() => onPick(a.id)} />)}
      {allowNone && <Chip label="None" on={!value} onPress={() => onPick('none')} />}
    </View>
  );
}

const st = StyleSheet.create({
  accTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  accBal: { color: C.text, fontSize: 20, fontWeight: '700' },
  checkBtn: { marginTop: 10, borderWidth: 1, borderColor: C.goldDeep, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  checkText: { color: C.gold, fontWeight: '600', fontSize: 13 },
  breakdown: { backgroundColor: C.card2, borderRadius: 12, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line },
  accFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.line },
});
