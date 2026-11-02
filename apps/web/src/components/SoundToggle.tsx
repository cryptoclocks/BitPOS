import React, { useState } from 'react';
import { isMuted, play, setMuted } from '../lib/sfx';
import '../styles/sound-toggle.css';

export default function SoundToggle({ language }: { language: 'th' | 'en' }) {
  const [muted, setState] = useState(() => isMuted());
  const label = muted ? (language === 'th' ? 'เปิดเสียงแจ้งเตือน' : 'Turn sounds on') : (language === 'th' ? 'ปิดเสียงแจ้งเตือน' : 'Mute sounds');
  return <button type="button" className="sound-toggle secondary" aria-pressed={!muted} aria-label={label} title={label}
    onClick={() => { const next = !muted; setMuted(next); setState(next); if (!next) play('add'); }}>
    <span key={String(muted)} aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
  </button>;
}
