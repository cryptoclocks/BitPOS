// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Whether the signed-in shop is paid with PayPal, for shared merchant screens that describe payments. Until the answer
// arrives (or if the read fails) it is false: the screen shows its existing text and nothing about money changes.
import {useEffect, useState} from 'react';
import {api} from '../../lib/api';

export function usePayPalShop(token: string | undefined): boolean {
 const [paypalShop, setPaypalShop] = useState(false);
 useEffect(() => {
  if (!token) return;
  let live = true;
  api<{paypalShop: boolean}>('/paypal/account', undefined, token).then(a => { if (live) setPaypalShop(a.paypalShop); }).catch(() => { /* existing text */ });
  return () => { live = false; };
 }, [token]);
 return paypalShop;
}
