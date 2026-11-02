import React, { useEffect, useMemo, useState } from 'react';
import bs58 from 'bs58';
import { api, ApiError } from '../lib/api';
import { discoverWallets, type WalletChoice } from '../lib/wallet';
import '../styles/loyalty-bind.css';

type Phase = 'code' | 'wallet' | 'signing' | 'done';
const CODE = /^[0-9A-HJKMNP-TV-Z]{4}-?[0-9A-HJKMNP-TV-Z]{4}$/;
const format = (raw: string) => { const c = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8); return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c; };

// Public page opened from the BitPOS app. The one-time code (not a session) tells the server which account to link; the wallet's
// signature over the exact message proves the wallet. The message authorizes no payment or transfer and the page says so.
export default function LoyaltyBind() {
  const [thai, setThai] = useState(() => { try { return (localStorage.getItem('bitpos-lang') ?? navigator.language).toLowerCase().startsWith('th'); } catch { return false; } });
  const text = (th: string, en: string) => thai ? th : en;
  const [code, setCode] = useState(() => format(new URLSearchParams(location.search).get('code') ?? ''));
  const [phase, setPhase] = useState<Phase>('code');
  const [wallets, setWallets] = useState<WalletChoice[] | null>(null);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState<'code' | 'inuse' | 'nosign' | 'cancel' | 'generic' | ''>('');
  const [address, setAddress] = useState('');
  const valid = CODE.test(code);
  useEffect(() => { try { localStorage.setItem('bitpos-lang', thai ? 'th' : 'en'); } catch { /* optional */ } }, [thai]);
  // Wallet extensions can inject late, so look again whenever the wallet step opens.
  useEffect(() => { void discoverWallets().then(setWallets).catch(() => setWallets([])); }, [phase === 'wallet']);
  const steps = useMemo(() => [text('รหัส', 'Code'), text('กระเป๋า', 'Wallet'), text('เซ็นยืนยัน', 'Sign'), text('เสร็จ', 'Done')], [thai]);
  const index = phase === 'code' ? 0 : phase === 'wallet' ? 1 : phase === 'signing' ? 2 : 3;

  type Problem = 'code' | 'inuse' | 'nosign' | 'cancel' | 'generic';
  const problemText: Record<Problem, string> = {
    code: text('รหัสหมดอายุ ใช้ไปแล้ว หรือไม่ถูกต้อง — กลับไปที่แอป BitPOS แล้วสร้างรหัสใหม่', 'This code expired, was already used or is wrong. Go back to the BitPOS app and create a new one.'),
    inuse: text('กระเป๋านี้ผูกกับบัญชีอื่นอยู่แล้ว', 'This wallet is already linked to another account.'),
    nosign: text('กระเป๋านี้ไม่รองรับการเซ็นข้อความ ลองใช้ Phantom', 'This wallet cannot sign messages. Try Phantom.'),
    cancel: text('คุณยกเลิกการเซ็น ไม่มีอะไรเปลี่ยนแปลง', 'You cancelled the signature. Nothing changed.'),
    generic: text('ทำรายการไม่สำเร็จ ลองอีกครั้ง', 'Something went wrong. Try again.'),
  };
  function explain(e: unknown): Problem {
    if (e instanceof ApiError && e.status === 401) return 'code';
    if (e instanceof ApiError && e.status === 409) return 'inuse';
    if (e instanceof Error && /signMessage/i.test(e.message)) return 'nosign';
    if (e instanceof Error && /reject|denied|cancel/i.test(e.message)) return 'cancel';
    return 'generic';
  }
  async function choose(choice: WalletChoice) {
    setProblem(''); setPhase('signing');
    try {
      const wallet = await choice.connect();
      setAddress(wallet.address);
      const challenge = await api<{ message: string; issuedAt: string }>('/loyalty/bind/challenge', { code, wallet: wallet.address });
      setMessage(challenge.message);
      const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));
      await api('/loyalty/bind', { code, wallet: wallet.address, issuedAt: challenge.issuedAt, signature: bs58.encode(signature) });
      setPhase('done');
    } catch (e) { setProblem(explain(e)); setPhase('wallet'); }
  }

  return <main className="lb" data-phase={phase}>
    <header className="lb-top">
      <span className="lb-brand">BitPOS</span>
      <button type="button" className="lb-lang" onClick={() => setThai(v => !v)} aria-label={text('Switch to English', 'เปลี่ยนเป็นภาษาไทย')}>{thai ? 'EN' : 'ไทย'}</button>
    </header>
    <section className="lb-card" aria-live="polite">
      <div className="lb-medal" aria-hidden="true"><svg viewBox="0 0 120 120" width="112" height="112"><defs><linearGradient id="lbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe9a8" /><stop offset="1" stopColor="#ffb347" /></linearGradient></defs>
        <circle className="lb-ring" cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="4" />
        <circle cx="60" cy="60" r="42" fill="url(#lbg)" />
        {phase === 'done' ? <path className="lb-check" d="M40 62 l14 14 l28 -30" fill="none" stroke="#3c0f5a" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M60 36 l7 15 17 2 -12 12 3 17 -15 -8 -15 8 3 -17 -12 -12 17 -2z" fill="#3c0f5a" opacity=".85" />}
      </svg>{phase === 'done' && <span className="lb-burst">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${i * (360 / 14)}deg`, '--d': `${60 + (i % 3) * 14}px` } as React.CSSProperties} />)}</span>}</div>
      <h1>{phase === 'done' ? text('ยืนยันกระเป๋าแล้ว', 'Wallet verified') : text('ยืนยันกระเป๋าสำหรับตราสมาชิก', 'Verify your wallet for your membership badge')}</h1>
      <ol className="lb-steps" aria-label={text('ขั้นตอน', 'Steps')}>{steps.map((label, i) => <li key={label} data-state={i < index ? 'past' : i === index ? 'now' : 'next'} aria-current={i === index ? 'step' : undefined}><b>{i < index ? '✓' : i + 1}</b><span>{label}</span></li>)}</ol>
      <div className="lb-body" key={phase}>
        {phase === 'code' && <>
          <label className="lb-field">{text('รหัสจากแอป BitPOS', 'Code from the BitPOS app')}
            <input value={code} onChange={e => setCode(format(e.target.value))} inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} placeholder="ABCD-2345" aria-invalid={code.length > 0 && !valid} />
          </label>
          <button type="button" className="lb-primary" disabled={!valid} onClick={() => setPhase('wallet')}>{text('ต่อไป', 'Continue')}</button>
        </>}
        {(phase === 'wallet' || phase === 'signing') && <>
          <p className="lb-note">{text('เลือกกระเป๋า แล้วเซ็นข้อความหนึ่งข้อความ นี่ไม่ใช่การจ่ายเงิน ไม่มีค่าธรรมเนียม และไม่ให้สิทธิ์ใดๆ ในการโอนเงิน', 'Pick your wallet and sign one message. This is not a payment, costs no fee, and gives no permission to move funds.')}</p>
          {wallets === null && <p className="lb-note" role="status">{text('กำลังค้นหากระเป๋า…', 'Looking for wallets…')}</p>}
          {wallets?.length === 0 && <p className="lb-note" role="status">{text('ไม่พบกระเป๋า เปิดหน้านี้ในเบราว์เซอร์ของ Phantom', 'No wallet found. Open this page in the Phantom browser.')}</p>}
          <div className="lb-wallets">{wallets?.map(w => <button type="button" key={w.name} className="lb-wallet" disabled={phase === 'signing'} onClick={() => void choose(w)}><span>{w.name}</span><i aria-hidden="true">→</i></button>)}</div>
          {phase === 'signing' && <p className="lb-note lb-wait" role="status"><span className="lb-dots" aria-hidden="true"><i /><i /><i /></span>{text('รอการเซ็นในกระเป๋า…', 'Waiting for your wallet to sign…')}</p>}
          {message && <details className="lb-msg"><summary>{text('ดูข้อความที่เซ็น', 'View the message you sign')}</summary><pre>{message}</pre></details>}
        </>}
        {phase === 'done' && <>
          <p className="lb-note">{text('กลับไปที่แอป BitPOS ได้เลย — ตราจะถูกส่งเมื่อคุณถึงระดับและเปิดความยินยอมไว้', 'You can return to the BitPOS app. Your badge is sent once you reach a level and consent is on.')}</p>
          <p className="lb-addr" aria-label={text('กระเป๋า', 'Wallet')}>{address.slice(0, 4)}…{address.slice(-4)}</p>
        </>}
        {problem && <p className="lb-error" role="alert">{problemText[problem]}</p>}
      </div>
      <p className="lb-foot">{text('ตราไม่มีมูลค่าเงิน โอนให้ผู้อื่นไม่ได้ และบันทึกบนเครือข่ายทดสอบ Solana devnet', 'The badge has no monetary value, cannot be transferred, and lives on Solana devnet (test network).')}</p>
    </section>
  </main>;
}
