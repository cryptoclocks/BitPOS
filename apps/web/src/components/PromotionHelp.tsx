import React from 'react';
export default function PromotionHelp({label,children}:{label:string;children:React.ReactNode}) {
  return <details className="promotion-help"><summary aria-label={label} title={label}>?<span className="promotion-sr-only"> {label}</span></summary><div className="promotion-help-body">{children}</div></details>;
}
