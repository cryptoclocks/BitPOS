// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Whether the signed-in shop is paid through the NEAR Living Bill. Until the answer arrives (or if the read fails)
// it is false: the merchant app shows exactly what it showed before and no NEAR tab.
import {useEffect, useState} from 'react';
import {api} from '../../lib/api';

export function useNearShop(token: string | undefined): boolean {
  const [nearShop, setNearShop] = useState(false);
  useEffect(() => {
    setNearShop(false);
    if (!token) return;
    let live = true;
    api<{enabled: boolean}>('/near/account', undefined, token).then(a => { if (live) setNearShop(a.enabled === true); }).catch(() => { /* no NEAR tab */ });
    return () => { live = false; };
  }, [token]);
  return nearShop;
}
