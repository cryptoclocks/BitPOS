// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Simulated BitPOS Mini in a browser. It speaks the same protocol as the firmware product "near":
// it polls the café's server for what to show, but it never shows PAID on the server's word. For a paid bill it
// asks NEAR itself (JSON-RPC, final finality), and only when the contract says the bill is in escrow with THIS
// screen's key as witness does it show PAID and sign "I showed it". The signing key is made here and stays here.
import React, {useEffect, useRef, useState} from 'react';
import QRCode from 'qrcode';
import {ed25519} from '@noble/curves/ed25519';
import {ApiError, api} from '../../lib/api';
import {ROLE_COLOR_DARK, nearCode, shareOf, type Lang} from '../../lib/near-shared';
import '../../styles/near.css';

type Screen = 'setup' | 'idle' | 'qr' | 'checking' | 'paid' | 'refunded' | 'offline';
interface DeviceBill { contract: string; merchant: string; id: string }
interface DeviceState {
  v: 1; screen: Screen; table: string; title: string; line1: string; line2: string; big: string; qr: string;
  splits: { label: string; amount: string }[]; bill: DeviceBill | null; rpc: string; poll_ms: number; tone: string; register?: boolean;
}
interface View { state: DeviceState | null; screen: Screen; chain: string; checkedAt: string; signed: boolean; problem: '' | 'nokey' | 'unauthorised' | 'keyconflict' }
const RPCS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs', 'https://rpc.testnet.near.org'];
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
const fromHex = (text: string) => Uint8Array.from(text.match(/../g) ?? [], pair => parseInt(pair, 16));
const store = { get(key: string) { try { return localStorage.getItem(key); } catch { return null; } }, set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* this visit only */ } } };
const SPLIT_COLORS = [ROLE_COLOR_DARK.owner, ROLE_COLOR_DARK.tax, ROLE_COLOR_DARK.tips, ROLE_COLOR_DARK.supplier, '#6B4EFF', '#F2A93B'];

/** The bill as the contract holds it, read by this screen itself. `null` means the contract has no such bill. */
async function readBill(rpc: string, bill: DeviceBill): Promise<{ state: string; witness_pk: string | null } | null> {
  if (!/^[a-z0-9._-]{2,64}$/.test(bill.contract) || !/^[a-z0-9._-]{2,64}$/.test(bill.merchant) || !/^[A-Za-z0-9_-]{1,64}$/.test(bill.id)) throw new Error('bill reference refused');
  const response = await fetch(RPCS.includes(rpc) ? rpc : RPCS[0], { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'call_function', finality: 'final', account_id: bill.contract, method_name: 'get_bill', args_base64: btoa(JSON.stringify({ merchant: bill.merchant, bill_id: bill.id })) } }) });
  const answer = await response.json() as { result?: { result?: number[] }; error?: unknown };
  if (!response.ok || answer.error || !Array.isArray(answer.result?.result) || answer.result.result.length > 8192) throw new Error('rpc refused');
  const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(answer.result.result))) as { state?: unknown; witness_pk?: unknown; merchant?: unknown; bill_id?: unknown } | null;
  if (parsed === null) return null;
  if (typeof parsed.state !== 'string' || parsed.merchant !== bill.merchant || parsed.bill_id !== bill.id) throw new Error('unexpected bill');
  return { state: parsed.state, witness_pk: typeof parsed.witness_pk === 'string' ? parsed.witness_pk : null };
}

export default function NearTerminal({deviceId}: {deviceId: string}) {
  const [language, setLanguage] = useState<Lang>('en'); const [view, setView] = useState<View>({state: null, screen: 'offline', chain: '', checkedAt: '', signed: false, problem: ''});
  const [publicKey, setPublicKey] = useState(''); const [qr, setQr] = useState(''); const [scale, setScale] = useState(1);
  const frame = useRef<HTMLDivElement>(null); const lang = useRef<Lang>('en'); const prefix = `bitpos.near.device.${deviceId}`;
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const chooseLanguage = (next: Lang) => { lang.current = next; setLanguage(next); store.set(`${prefix}.lang`, next); };

  useEffect(() => { const fit = () => setScale(Math.max(0.5, Math.min(2, ((frame.current?.clientWidth ?? 480)) / 480))); fit(); addEventListener('resize', fit); return () => removeEventListener('resize', fit); }, []);

  useEffect(() => {
    // The connection key arrives once in the URL fragment; keep it for this device and remove it from the address bar.
    const fragment = location.hash.slice(1);
    if (/^[A-Za-z0-9_-]{43}$/.test(fragment)) { store.set(`${prefix}.key`, fragment); history.replaceState(null, '', location.pathname); }
    const key = store.get(`${prefix}.key`) ?? '';
    const saved = store.get(`${prefix}.lang`); if (saved === 'th' || saved === 'en') { lang.current = saved; setLanguage(saved); }
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) { setView(v => ({...v, problem: 'nokey'})); return; }
    // The witness key: made in this browser, never sent anywhere. Only the public half is registered.
    let seedHex = store.get(`${prefix}.seed`) ?? '';
    if (!/^[0-9a-f]{64}$/.test(seedHex)) { seedHex = hex(ed25519.utils.randomPrivateKey()); store.set(`${prefix}.seed`, seedHex); }
    const seed = fromHex(seedHex), pk = hex(ed25519.getPublicKey(seed)); setPublicKey(pk);
    const acked = new Set<string>(JSON.parse(store.get(`${prefix}.acked`) ?? '[]') as string[]);
    let active = true, timer: ReturnType<typeof setTimeout> | undefined, registerAt = 0, ackAt = 0, ackWait = 2000;
    const device = (path: string, body?: unknown) => api<Record<string, unknown>>(`/near-device/${path}${path.includes('?') ? '&' : '?'}d=${deviceId}`, body, key);

    async function tick() {
      let wait = 2000;
      try {
        const state = await device(`state?l=${lang.current}`) as unknown as DeviceState;
        wait = Math.max(1000, Math.min(30000, Number(state.poll_ms) || 2000));
        let problem: View['problem'] = '';
        if (state.register && Date.now() - registerAt > 5000) {
          registerAt = Date.now();
          await device('register', {pk}).catch(e => { if (nearCode(e) === 'DEVICE_KEY_ALREADY_REGISTERED') problem = 'keyconflict'; });
        }
        let screen = state.screen, chain = '', sign = false;
        if (state.bill && (screen === 'checking' || screen === 'paid')) {
          // Never PAID on the server's word: ask the contract.
          screen = 'checking';
          try {
            const bill = await readBill(state.rpc, state.bill);
            chain = bill ? bill.state : 'not found';
            if (bill?.state === 'Escrow') { if (bill.witness_pk === pk) { screen = 'paid'; sign = !acked.has(state.bill.id); } else chain = 'Escrow (another witness)'; }
            else if (bill?.state === 'Settling' || bill?.state === 'Settled') screen = 'paid';
            else if (bill?.state === 'Refunding' || bill?.state === 'Refunded') screen = 'refunded';
          } catch { chain = 'unreachable'; }
        }
        if (!active) return;
        setView({state, screen, chain, checkedAt: chain ? new Date().toLocaleTimeString('en-GB') : '', signed: !!state.bill && acked.has(state.bill.id), problem});
        if (sign && state.bill && Date.now() - ackAt > ackWait) {
          // Like the firmware: sign only after PAID has actually been drawn.
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          ackAt = Date.now();
          const message = new TextEncoder().encode(`bitpos-near-ack:v1:${state.bill.contract}:${state.bill.merchant}:${state.bill.id}`);
          try {
            await device('ack', {bill: state.bill.id, sig: hex(ed25519.sign(message, seed)), pk});
            acked.add(state.bill.id); store.set(`${prefix}.acked`, JSON.stringify([...acked].slice(-50))); ackWait = 2000;
            if (active) setView(v => ({...v, signed: true}));
          } catch { ackWait = Math.min(32000, ackWait * 2); }
          wait = 1000;
        }
      } catch (error) {
        if (!active) return;
        const refused = error instanceof ApiError && (error.status === 401 || nearCode(error) === 'DEVICE_AUTH_REQUIRED');
        setView(v => ({...v, screen: 'offline', chain: '', problem: refused ? 'unauthorised' : ''}));
        wait = refused ? 15000 : 3000;
      }
      if (active) timer = setTimeout(tick, wait);
    }
    void tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [deviceId, prefix]);

  const state = view.state; const screen: Screen = view.problem === 'nokey' ? 'setup' : view.screen;
  const qrText = screen === 'qr' ? state?.qr ?? '' : screen === 'setup' && publicKey ? `bitpos-near-device:v1:${deviceId}:${publicKey}` : '';
  useEffect(() => { let active = true; if (!qrText) { setQr(''); return; } void QRCode.toDataURL(qrText, {margin: 1, width: 360, color: {dark: '#0B1020', light: '#FFFFFF'}}).then(url => { if (active) setQr(url); }).catch(() => { if (active) setQr(''); }); return () => { active = false; }; }, [qrText]);

  const [amount, unit] = (state?.big ?? '').split(' ');
  const total = state?.splits.reduce((sum, s) => sum + Number(s.amount), 0) ?? 0;
  let body: React.ReactNode;
  if (screen === 'setup') body = <div className="near-mini-row">
    {qr ? <img className="near-mini-qr" src={qr} alt={text('คิวอาร์กุญแจสาธารณะของจอ', 'QR of this screen\'s public key')} /> : <div className="near-mini-qr near-mini-qr-empty" />}
    <div className="near-mini-col"><p className="near-mini-title">{view.problem === 'nokey' ? text('ต้องเปิดด้วยลิงก์ตั้งค่า', 'Open this with its setup link') : view.problem === 'keyconflict' ? text('มีกุญแจอื่นลงทะเบียนไว้แล้ว', 'Another key is already registered') : text('กำลังลงทะเบียนกุญแจของจอ', 'Registering this screen\'s key')}</p>
      <p className="near-mini-line">{view.problem === 'nokey' ? text('สร้างจอในหน้า เครื่องและพยาน ของร้าน แล้วกดเปิดจอจำลอง', 'Create a screen under Devices & witness in the merchant app, then press Open simulated screen.') : text('กุญแจเกิดในเบราว์เซอร์นี้และไม่ออกจากที่นี่', 'The key was made in this browser and never leaves it.')}</p>
      {publicKey && <p className="near-mini-key">{publicKey.slice(0, 16)}…{publicKey.slice(-8)}</p>}</div>
  </div>;
  else if (screen === 'idle') body = <div className="near-mini-center"><p className="near-mini-shop">{state?.title}</p><p className="near-mini-line">{state?.line1}</p><p className="near-mini-line near-mini-faint">{state?.line2}</p></div>;
  else if (screen === 'qr') body = <div className="near-mini-row">
    {qr ? <img className="near-mini-qr" src={qr} alt={text('คิวอาร์สำหรับจ่ายบิล', 'QR to pay this bill')} /> : <div className="near-mini-qr near-mini-qr-empty" />}
    <div className="near-mini-col"><p className="near-mini-title">{state?.title}</p><p className="near-mini-amount">{amount}<small>{unit}</small></p><p className="near-mini-line">{state?.line1}</p></div>
  </div>;
  else if (screen === 'checking') body = <div className="near-mini-row">
    <div className="near-mini-spinner" aria-hidden="true" />
    <div className="near-mini-col"><p className="near-mini-title">{state?.title || text('กำลังตรวจบนเชน', 'Checking the chain')}</p><p className="near-mini-amount">{amount}<small>{unit}</small></p><p className="near-mini-line">{text('จอนี้ถาม NEAR เอง ไม่เชื่อเซิร์ฟเวอร์', 'This screen asks NEAR itself, not the server')}</p></div>
  </div>;
  else if (screen === 'paid') body = <div className="near-mini-paid">
    <div className="near-mini-paid-top"><span className="near-mini-check" aria-hidden="true">✓</span><strong>{text('จ่ายแล้ว', 'PAID')}</strong><p className="near-mini-amount near-mini-amount-mint">{amount}<small>{unit}</small></p></div>
    {total > 0 && <div className="near-mini-bar" aria-hidden="true">{state!.splits.map((s, i) => <span key={i} style={{width: `${shareOf(s.amount, String(total))}%`, background: SPLIT_COLORS[i % SPLIT_COLORS.length]}} />)}</div>}
    <ul className="near-mini-splits">{state!.splits.map((s, i) => <li key={i}><span className="near-dot" style={{background: SPLIT_COLORS[i % SPLIT_COLORS.length]}} aria-hidden="true" /><span>{s.label}</span><b>+{s.amount}</b></li>)}</ul>
    <p className="near-mini-pill">{view.signed ? text('จอนี้เซ็นเป็นพยานแล้ว', 'Witness signed') : text('อ่านจากเชนแล้ว', 'Read from the chain')}</p>
  </div>;
  else if (screen === 'refunded') body = <div className="near-mini-center"><span className="near-mini-check near-mini-check-red" aria-hidden="true">↩</span><p className="near-mini-shop">{state?.title || text('คืนเงินแล้ว', 'Refunded')}</p><p className="near-mini-line">{state?.line1}</p><p className="near-mini-amount">{amount}<small>{unit}</small></p></div>;
  else body = <div className="near-mini-center"><p className="near-mini-shop">{view.problem === 'unauthorised' ? text('ลิงก์ตั้งค่าใช้ไม่ได้', 'Setup link not valid') : text('ออฟไลน์', 'Offline')}</p><p className="near-mini-line">{view.problem === 'unauthorised' ? text('จอนี้ถูกปิดใช้งานหรือกุญแจไม่ถูกต้อง', 'This screen was deactivated or its key is wrong.') : text('กำลังเชื่อมต่อใหม่ จะไม่แสดงว่าจ่ายแล้วจนกว่าจะตรวจเชนได้', 'Reconnecting. It will not show PAID until it can check the chain.')}</p></div>;

  return <main className="near-terminal" lang={language}>
    <p className="near-terminal-label">{text('จอจำลอง · BitPOS Mini ตัวจริงใช้โปรโตคอลเดียวกัน', 'Simulated screen · the real BitPOS Mini runs the same protocol')}</p>
    <div className="near-terminal-frame" ref={frame} style={{height: 320 * scale}}>
      <div className="near-mini" data-screen={screen} style={{transform: `scale(${scale})`}}>
        <header className="near-mini-head"><span className="near-logo near-logo-small" aria-hidden="true">B</span><strong>BitPOS Mini{state?.table ? ` · ${state.table}` : ''}</strong>
          <button type="button" className="near-mini-chip" lang={language === 'th' ? 'en' : 'th'} onClick={() => chooseLanguage(language === 'th' ? 'en' : 'th')} aria-label={text('เปลี่ยนเป็นภาษาอังกฤษ', 'Switch to Thai')}>{language === 'th' ? 'EN' : 'ไทย'}</button><span className="near-mini-chip near-mini-net">NEAR testnet</span></header>
        {body}
        {view.chain && <p className="near-mini-chain">{text('เชนตอบว่า', 'chain says')}: {view.chain} · {view.checkedAt}</p>}
      </div>
    </div>
    <dl className="near-terminal-facts">
      <dt>{text('รหัสจอ', 'Screen id')}</dt><dd>{deviceId}</dd>
      <dt>{text('กุญแจสาธารณะของพยาน', 'Witness public key')}</dt><dd>{publicKey || '—'}</dd>
      <dt>{text('เชนตอบว่า', 'Chain says')}</dt><dd>{view.chain ? `${view.chain} (${view.checkedAt})` : text('ยังไม่มีบิลให้ตรวจ', 'no bill to check yet')}</dd>
      <dt>{text('ลายเซ็นพยาน', 'Witness signature')}</dt><dd>{view.signed ? text('ส่งแล้วสำหรับบิลนี้', 'sent for this bill') : '—'}</dd>
    </dl>
    <p className="near-terminal-note">{text('จอนี้ไม่แสดงว่าจ่ายแล้วตามคำบอกของเซิร์ฟเวอร์ มันถามสัญญาบน NEAR เองที่ระดับ final แล้วจึงเซ็น', 'This screen never shows PAID on the server\'s word. It asks the contract on NEAR itself at final finality, and only then signs.')}</p>
  </main>;
}
