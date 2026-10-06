'use strict';
const key=new URLSearchParams(location.search).get('screen')||'idle';
const screen=window.BitPosClock.screens.find(item=>item.key===key)||window.BitPosClock.screens[0];
document.querySelector('#screen-content').innerHTML=screen.body();
document.querySelector('#screen-id').textContent=screen.id;
document.title=`${screen.id} · ${screen.title} · BitPosClock`;
document.querySelector('#header-state').textContent=screen.group==='กู้คืน / ตั้งค่า'?'สถานะเครื่อง':'BITPOS CAFE';
