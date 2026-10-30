// One emoji per menu item so categories read at a glance (guest table menu, no-photo placeholder).
// Mirrors apps/mobile-customer foodEmoji: specific dishes first, then category; indistinguishable items share the category's emoji.
export function foodEmoji(item:{name?:string;nameEn?:string;category?:string}):string|null{
 const text=`${item.name??''} ${item.nameEn??''}`.toLowerCase();
 const has=(words:string[])=>words.some(w=>text.includes(w));
 if(has(['iced','เย็น','frappe','ปั่น']))return '🧊';
 if(has(['matcha','ชาเขียว','ชาไทย','ชานม'])||/\btea\b/.test(text))return '🍵';
 if(has(['croissant','ครัวซอง']))return '🥐';
 if(has(['muffin','มัฟฟิน','cupcake']))return '🧁';
 if(has(['brownie','บราวนี']))return '🍫';
 if(has(['cheesecake','cake','เค้ก']))return '🍰';
 if(has(['sandwich','แซนด์วิช','toast','ขนมปัง']))return '🥪';
 switch((item.category??'').trim().toLowerCase()){
  case 'coffee':case 'tea & chocolate':return '☕';
  case 'bakery':return '🥐';
  case 'desserts':return '🍰';
  case 'savory':return '🥪';
 }
 return null;
}
