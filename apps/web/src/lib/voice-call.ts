import type { OrderView } from '../../../../packages/contracts/src/index';

export type SpeakResult = 'spoken' | 'unsupported' | 'no_voice';
/** What the speaker says for a ready order: the same short code printed on the cup label, and where to collect. */
export function queuePhrase(order: Pick<OrderView, 'id' | 'authority'>, language: 'th' | 'en'): string {
  const code = order.id.slice(0, 4).toUpperCase().split('').join(' ');
  const where = order.authority.serving.label;
  return language === 'th' ? `คิวหมายเลข ${code} พร้อมรับแล้วค่ะ ที่ ${where}` : `Order ${code} is ready for pickup at ${where}`;
}
/** Uses the browser's own speech engine; nothing is sent anywhere. Reports honestly when no voice for the language is installed. */
export function speak(phrase: string, language: 'th' | 'en'): SpeakResult {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return 'unsupported';
  const tag = language === 'th' ? 'th' : 'en', voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith(tag));
  if (!voice) return 'no_voice';
  const utterance = new SpeechSynthesisUtterance(phrase);
  utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = 0.95;
  window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance);
  return 'spoken';
}
