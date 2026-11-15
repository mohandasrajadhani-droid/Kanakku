import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './ui';

// Shared building blocks: sheets, buttons, chips and the app's styles.

/**
 * Bottom sheet drawn inside the main screen (not a separate Android window), so typing never freezes it.
 * Buttons sit in a fixed footer above the navigation bar and the keyboard; the Back key closes it.
 */
export function Sheet({ visible, onClose, children, footer }: {
  visible: boolean; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const kbTop = useKeyboardTop();
  const [rootH, setRootH] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeRef.current(); return true; });
    return () => sub.remove();
  }, [visible]);
  if (!visible) return null;
  // Lift the sheet by however much the keyboard covers it.
  const covered = kbTop != null && rootH > 0 ? Math.max(0, rootH - kbTop) : 0;
  const bottom = covered > 0 ? covered + 8 : Math.max(insets.bottom, NAV_BAR_MIN) + 12;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10, elevation: 10 }]} onLayout={e => setRootH(e.nativeEvent.layout.height)}>
      <Pressable style={s.backdrop} onPress={() => { Keyboard.dismiss(); onClose(); }} />
      <View style={[s.sheet, { paddingBottom: bottom, maxHeight: '92%' }]}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView>
        {footer && <View style={s.footer}>{footer}</View>}
      </View>
    </View>
  );
}

// Space kept clear for the phone's navigation bar (3-button bar is ~48dp), even if the system reports less.
const NAV_BAR_MIN = 48;

/** Screen Y of the keyboard's top edge, or null when the keyboard is closed. */
function useKeyboardTop() {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', e => setTop(e.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTop(null));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return top;
}

export const Stat = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <View style={{ flex: 1 }}>
    <Text style={s.label}>{label.toUpperCase()}</Text>
    <Text style={[s.statVal, color ? { color } : null]}>{value}</Text>
  </View>
);
export const Chip = ({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) => (
  <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]}><Text style={[s.chipText, on && { color: C.bg }]}>{label}</Text></Pressable>
);
export const Btn = ({ label, onPress, primary, danger, disabled }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean }) => (
  <Pressable disabled={disabled} onPress={onPress}
    style={[s.btn, primary && { backgroundColor: C.gold, borderColor: C.gold }, danger && { borderColor: C.red }, disabled && { opacity: 0.5 }]}>
    <Text style={[s.btnText, primary && { color: C.bg }, danger && { color: C.red }]}>{label}</Text>
  </Pressable>
);
export const TabBtn = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
  <Pressable style={s.tabBtn} onPress={onPress}>
    <Text style={[s.tabText, on && { color: C.gold }]}>{label}</Text>
    <View style={[s.tabLine, on && { backgroundColor: C.gold }]} />
  </Pressable>
);

const serif = 'serif';
export const s = StyleSheet.create({
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
  txnNote: { color: C.gold, fontSize: 12, marginTop: 3, fontStyle: 'italic' },
  noteInput: { minHeight: 48, textAlignVertical: 'top' },
  newForm: { backgroundColor: C.card2, borderRadius: 12, padding: 12, marginTop: 10, borderWidth: 1, borderColor: C.line },
  iconCell: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  manageRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line, gap: 10 },
  sheetAmt: { color: C.gold, fontSize: 32, fontFamily: serif, fontWeight: '600', marginBottom: 4 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  smsBox: { color: C.mute, fontSize: 12, lineHeight: 18, backgroundColor: C.card2, borderRadius: 10, padding: 12 },
  input: { backgroundColor: C.card2, color: C.text, borderRadius: 12, padding: 14, fontSize: 16, marginBottom: 10, borderWidth: 1, borderColor: C.line },
});
