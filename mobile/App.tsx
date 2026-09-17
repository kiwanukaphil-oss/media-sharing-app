import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, PermissionsAndroid, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as DocumentPicker from 'expo-document-picker';
import Native from './modules/relay-transfer/src/RelayTransferModule';
import { api, Media, pairDevice, Transfer } from './src/api';

const readableSize = (size: number) => size >= 1073741824 ? `${(size / 1073741824).toFixed(1)} GB` : `${(size / 1048576).toFixed(1)} MB`;
const showError = (error: unknown) => Alert.alert('A little interruption', error instanceof Error ? error.message : String(error));
function Button({ title, onPress, quiet = false }: { title: string; onPress: () => void; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.button, quiet && styles.quiet, pressed && { opacity: 0.65 }]}><Text style={[styles.buttonText, quiet && { color: '#252b28' }]}>{title}</Text></Pressable>;
}

// React displays journaled state; native OS jobs own every file transfer.
export default function App() {
  const [connected, setConnected] = useState(false);
  const [space, setSpace] = useState('Your shared space');
  const [items, setItems] = useState<Media[]>([]);
  const [jobs, setJobs] = useState<Transfer[]>([]);
  const [filter, setFilter] = useState<'original' | 'final'>('original');
  const [invitation, setInvitation] = useState('');
  const [deviceName, setDeviceName] = useState(Platform.OS === 'ios' ? 'My iPhone' : 'My Android');
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [camera, requestCamera] = useCameraPermissions();
  const pairing = useRef(false);
  const pairingMode = useRef(false);
  async function refreshFeed() {
    const session = await api<{ space: { name: string } }>('session');
    setSpace(session.space.name); setConnected(!pairingMode.current);
    const feed = await api<{ items: Media[] }>('feed');
    setItems(feed.items); setJobs(JSON.parse(await Native.listTransfers()));
  }
  async function connectInvitation(link: string) {
    if (pairing.current) return;
    pairing.current = true; setScanning(false);
    try { await pairDevice(link, deviceName); pairingMode.current = false; setInvitation(''); await refreshFeed(); }
    catch (error) { showError(error); }
    finally { pairing.current = false; }
  }
  useEffect(() => {
    refreshFeed().catch(() => {});
    Linking.getInitialURL().then(url => { if (url) showInvitation(url); });
    const links = Linking.addEventListener('url', ({ url }) => showInvitation(url));
    const timer = setInterval(() => { if (AppState.currentState === 'active' && !pairingMode.current) refreshFeed().catch(() => {}); }, 4000);
    return () => { links.remove(); clearInterval(timer); };
  }, []);
  async function showInvitation(link = '') {
    const pending: Transfer[] = JSON.parse(await Native.listTransfers());
    if (pending.some(job => job.state !== 'complete')) { Alert.alert('Finish your transfers first', 'Resume pending transfers before pairing to another space.'); return; }
    pairingMode.current = true; setInvitation(link); setConnected(false);
  }
  // Picking files immediately queues the batch; the native engine preserves the selected bytes.
  async function selectOriginalFiles() {
    try {
      const selection = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: Platform.OS === 'ios', type: '*/*' });
      if (selection.canceled) return;
      if (Platform.OS === 'android' && Number(Platform.Version) >= 33) await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      for (const file of selection.assets) await Native.enqueueUpload(file.uri, file.name, file.mimeType || 'application/octet-stream', filter);
      setJobs(JSON.parse(await Native.listTransfers()));
    } catch (error) { showError(error); }
  }
  async function saveOriginal(item: Media) {
    try { await Native.enqueueDownload(JSON.stringify(item)); setJobs(JSON.parse(await Native.listTransfers())); }
    catch (error) { showError(error); }
  }
  async function refreshManually() {
    setRefreshing(true);
    try { await refreshFeed(); } catch (error) { showError(error); } finally { setRefreshing(false); }
  }
  if (scanning && camera?.granted) return <SafeAreaView style={styles.page}><CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={({ data }) => connectInvitation(data)} /><View style={styles.content}><Button title="Close scanner" quiet onPress={() => setScanning(false)} /></View></SafeAreaView>;
  return <SafeAreaView style={styles.page}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.content} refreshControl={connected ? <RefreshControl refreshing={refreshing} onRefresh={refreshManually} /> : undefined}>
    <View style={styles.header}><Text style={styles.brand}>↗ relay</Text><Text style={styles.pill}>ORIGINAL QUALITY</Text></View>
    {!connected ? <View style={styles.welcome}>
      <Text style={styles.eyebrow}>A LITTLE LESS FRICTION</Text><Text style={styles.title}>From there.{'\n'}To here.</Text><Text style={styles.subtitle}>Your photos and videos, exactly as they are. Pair this phone once to join your shared drop zone.</Text>
      <TextInput accessibilityLabel="Device name" style={styles.input} value={deviceName} onChangeText={setDeviceName} placeholder="Name this phone" />
      <Button title="Scan your desktop QR" onPress={async () => { const allowed = camera?.granted || (await requestCamera()).granted; if (allowed) setScanning(true); }} />
      <Text style={styles.muted}>Or paste an invitation link</Text><TextInput accessibilityLabel="Invitation link" autoCapitalize="none" autoCorrect={false} style={styles.input} value={invitation} onChangeText={setInvitation} placeholder="https://…/#join=…" />
      <Button title="Connect this phone" quiet onPress={() => connectInvitation(invitation)} />
    </View> : <>
      <Text style={styles.eyebrow}>{space || 'YOUR SHARED SPACE'}</Text><Text style={styles.title}>Good things,{'\n'}on the move.</Text><Text style={styles.subtitle}>Drop originals. Pick them up anywhere.</Text>
      <View style={styles.tabs}>{(['original', 'final'] as const).map(value => <Pressable accessibilityRole="tab" accessibilityState={{ selected: filter === value }} key={value} onPress={() => setFilter(value)} style={[styles.tab, filter === value && styles.selected]}><Text style={styles.tabText}>{value === 'original' ? 'Originals' : 'Final cuts'}</Text></Pressable>)}</View>
      <Button title={filter === 'original' ? '+  Drop originals' : '+  Drop final cuts'} onPress={selectOriginalFiles} /><Text style={styles.hint}>Choose files to send · no compression</Text>
      {jobs.filter(job => job.state !== 'complete').map(job => <View style={styles.transfer} key={job.id}><Text numberOfLines={1} style={styles.fileName}>{job.name}</Text><Text style={styles.muted}>{job.message || job.state} · {job.progress || 0}%</Text><View style={styles.track}><View style={[styles.progress, { width: `${job.progress || 0}%` }]} /></View>{['error', 'paused'].includes(job.state) && <Button title="Resume" quiet onPress={() => Native.resume(job.id).catch(showError)} />}{job.state === 'ready-to-save' && <Button title="Save to Files" onPress={() => Native.exportFile(job.id).catch(showError)} />}</View>)}
      <View style={styles.section}><Text style={styles.sectionTitle}>The drop zone</Text><Text style={styles.muted}>{items.filter(item => item.category === filter).length} files</Text></View>
      {!items.some(item => item.category === filter) && <View style={styles.empty}><Text style={styles.emptyIcon}>↗</Text><Text style={styles.sectionTitle}>Room for your next great shot.</Text><Text style={styles.subtitle}>Files from every connected device appear here.</Text></View>}
      {items.filter(item => item.category === filter).map(item => <View style={styles.card} key={item.id}><View style={styles.fileIcon}><Text style={{ fontSize: 26 }}>{item.mime.startsWith('video/') ? '▷' : '▧'}</Text></View><Text style={styles.fileName}>{item.name}</Text><Text style={styles.muted}>{readableSize(item.size)} · {item.deviceName}</Text><Button title="Save to device ↓" quiet onPress={() => saveOriginal(item)} /></View>)}
      {jobs.some(job => job.state === 'complete') && <Text style={styles.hint}>✓ {jobs.filter(job => job.state === 'complete').length} transfers complete</Text>}
      <Button title="Pair another space" quiet onPress={() => showInvitation().catch(showError)} />
    </>}<Text style={styles.footer}>Full quality. Less back and forth.</Text>
  </ScrollView></SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fafbf8' }, content: { padding: 24, paddingTop: 36, gap: 16 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 34 }, brand: { fontSize: 29, fontWeight: '700', letterSpacing: -1.5 }, pill: { fontSize: 8, letterSpacing: 1, color: '#437b54', backgroundColor: '#e9f1e6', padding: 9, borderRadius: 20 }, welcome: { gap: 18 }, eyebrow: { fontSize: 10, letterSpacing: 2, color: '#68746b', fontWeight: '600' }, title: { fontSize: 44, lineHeight: 48, letterSpacing: -2, color: '#1d2921', fontWeight: '600' }, subtitle: { color: '#7c837c', fontSize: 15, lineHeight: 23 }, input: { borderWidth: 1, borderColor: '#dfe4dc', borderRadius: 12, padding: 16, fontSize: 15, backgroundColor: '#fff', color: '#202920' }, button: { backgroundColor: '#264f34', borderRadius: 12, padding: 17, alignItems: 'center', minHeight: 52 }, buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' }, quiet: { backgroundColor: '#edf0e9' }, tabs: { flexDirection: 'row', backgroundColor: '#edf0e9', borderRadius: 12, padding: 4, marginTop: 12 }, tab: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 9 }, selected: { backgroundColor: '#fff' }, tabText: { color: '#313d32', fontWeight: '600', fontSize: 13 }, hint: { fontSize: 11, color: '#7c837c', textAlign: 'center' }, section: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26 }, sectionTitle: { fontSize: 17, fontWeight: '600', color: '#27352a' }, muted: { color: '#7c837c', fontSize: 12, lineHeight: 18 }, card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e8e0', borderRadius: 18, padding: 18, gap: 12 }, fileIcon: { height: 94, borderRadius: 10, backgroundColor: '#f0f2ec', justifyContent: 'center', alignItems: 'center' }, fileName: { fontSize: 14, fontWeight: '600', color: '#27352a' }, empty: { paddingVertical: 36, alignItems: 'center', gap: 14 }, emptyIcon: { fontSize: 44, color: '#78957c' }, footer: { fontSize: 11, color: '#91988e', textAlign: 'center', paddingVertical: 30 }, transfer: { padding: 16, borderRadius: 12, backgroundColor: '#eef3eb', gap: 8 }, track: { height: 3, backgroundColor: '#dce5d7', borderRadius: 3 }, progress: { height: 3, backgroundColor: '#4a7f53', borderRadius: 3 },
});
