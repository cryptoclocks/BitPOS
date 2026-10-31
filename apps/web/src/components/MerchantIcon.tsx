const paths = {
 help:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
 menu:'M4 5h16M4 12h16M4 19h16', cart:'M3 3h2l2 12h11l3-9H6M9 20h.01M17 20h.01',
 receipt:'M6 3h12v18l-3-2-3 2-3-2-3 2V3M9 7h6M9 11h6M9 15h3', check:'m5 12 4 4L19 6',
 play:'M9 7v10l8-5-8-5Z', plus:'M12 5v14M5 12h14', minus:'M5 12h14', close:'m6 6 12 12M18 6 6 18', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
 refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6',
 edit:'m15 4 5 5-11 11H4v-5L15 4ZM12 7l5 5', save:'M5 3h12l4 4v14H3V3h2ZM7 3v6h10V3M7 21v-8h10v8',
 login:'M14 3h7v18h-7M3 12h13m-4-4 4 4-4 4', logout:'M10 3H3v18h7M9 12h12m-4-4 4 4-4 4',
 link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M16 8l2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
 owner:'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7L12 3Zm-4 9 3 3 5-6',
 manager:'M8 7V3h8v4M3 7h18v14H3V7ZM3 12h18M10 12v3h4v-3',
 staff:'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21v-3a8 8 0 0 1 16 0v3',
 chart:'M3 3v18h18 M7 16v-5 M12 16V7 M17 16V4',
 coffee:'M4 8h13v10H4z M17 9h3v6h-3 M3 22h16 M7 2v3 M12 2v3',
 bike:'M8 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M24 17a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 17l5-9 5 9H4 M9 8h8l3 9 M8 4h4 M15 4h3l2 5',
 box:'m3 7 9-4 9 4v13l-9 3-9-3z M3 7l9 4 9-4 M12 11v12',
 card:'M2 5h20v15H2z M2 10h20 M6 16h4',
 arrow:'M4 12h16m-6-6 6 6-6 6', back:'m15 6-6 6 6 6'
} as const;
export default function MerchantIcon({name}:{name:keyof typeof paths}) {
 return <svg className="merchant-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
export function LocaleFlag({language}:{language:'en'|'th'}) {
 return <svg className="locale-flag" width="28" height="20" viewBox="0 0 30 20" aria-hidden="true" focusable="false">{language==='th'?<><path fill="#a51931" d="M0 0h30v20H0z"/><path fill="#fff" d="M0 3h30v14H0z"/><path fill="#2d2a4a" d="M0 7h30v6H0z"/></>:<><path fill="#21468b" d="M0 0h30v20H0z"/><path stroke="#fff" strokeWidth="5" d="m0 0 30 20M30 0 0 20"/><path stroke="#c8102e" strokeWidth="1.6" d="m0 0 30 20M30 0 0 20"/><path fill="#fff" d="M12 0h6v20h-6zM0 7h30v6H0z"/><path fill="#c8102e" d="M13 0h4v20h-4zM0 8h30v4H0z"/></>}</svg>;
}
