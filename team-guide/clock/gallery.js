'use strict';
const screens=window.BitPosClock.screens;
const imagePath=screen=>`../assets/bitposclock/${screen.id.toLowerCase()}-${screen.key}.png`;
const groups=['ทั้งหมด',...new Set(screens.map(screen=>screen.group))];
let selected=0;
const grid=document.querySelector('#screen-grid');
grid.innerHTML=screens.map((screen,index)=>`<button class="screen-card" data-index="${index}" data-group="${screen.group}" aria-pressed="false"><img src="${imagePath(screen)}" width="480" height="320" loading="lazy" alt="ภาพจำลอง ${screen.title}"><span class="card-label"><span>${screen.id}</span><span>เฟส ${screen.phase}</span></span><h3>${screen.title}</h3></button>`).join('');
function selectScreen(index,scroll=false){
  selected=(index+screens.length)%screens.length;
  const screen=screens[selected];
  document.querySelector('#selected-image').src=imagePath(screen);
  document.querySelector('#selected-image').alt=`${screen.id} · ${screen.title} · ภาพจำลอง`;
  document.querySelector('#download-image').href=imagePath(screen);
  document.querySelector('#stage-id').textContent=screen.id;
  document.querySelector('#screen-category').textContent=`${screen.group} / เฟส ${screen.phase}`;
  document.querySelector('#screen-title').textContent=screen.title;
  for(const name of ['trigger','contract','next'])document.querySelector(`#screen-${name}`).textContent=screen[name];
  document.querySelector('#screen-counter').textContent=`${String(selected+1).padStart(2,'0')} / 18`;
  grid.querySelectorAll('button').forEach(card=>card.setAttribute('aria-pressed',String(Number(card.dataset.index)===selected)));
  history.replaceState(null,'',`#${screen.id.toLowerCase()}`);
  if(scroll)document.querySelector('.viewer-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
grid.addEventListener('click',event=>{const card=event.target.closest('.screen-card');if(card)selectScreen(Number(card.dataset.index),true)});
document.querySelector('#previous').addEventListener('click',()=>selectScreen(selected-1));
document.querySelector('#next').addEventListener('click',()=>selectScreen(selected+1));
document.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||event.altKey||event.ctrlKey||event.metaKey)return;event.preventDefault();selectScreen(selected+(event.key==='ArrowRight'?1:-1))});
document.querySelector('.screen-filters').innerHTML=groups.map((group,index)=>`<button data-filter="${group}" aria-pressed="${index===0}" class="${index===0?'active':''}">${group}</button>`).join('');
document.querySelector('.screen-filters').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  const group=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});
  let count=0;grid.querySelectorAll('.screen-card').forEach(card=>{card.hidden=group!=='ทั้งหมด'&&card.dataset.group!==group;if(!card.hidden)count++});
  document.querySelector('#visible-count').textContent=`${count} หน้าจอ`;
});
const initial=screens.findIndex(screen=>`#${screen.id.toLowerCase()}`===location.hash);
selectScreen(initial>=0?initial:0);
window.addEventListener('hashchange',()=>{
  const index=screens.findIndex(screen=>`#${screen.id.toLowerCase()}`===location.hash);
  if(index>=0&&index!==selected)selectScreen(index);
});
