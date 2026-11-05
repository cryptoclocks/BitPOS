// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Language of the customer pages on first visit: the choice saved on this device, otherwise the browser's language
// (Thai browsers get Thai, everyone else English). Runs in an effect, after the server-rendered page.
export function initialLanguage(): 'th' | 'en' {
 try { const saved = localStorage.getItem('bitpos.pay.language'); if (saved === 'th' || saved === 'en') return saved; } catch { /* storage unavailable: use the browser language */ }
 return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('th') ? 'th' : 'en';
}
