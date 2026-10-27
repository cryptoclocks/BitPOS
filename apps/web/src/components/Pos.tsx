import {requestId} from '../lib/request-id';
import MerchantIcon, { LocaleFlag } from './MerchantIcon';
import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatMoney, lineTotal } from '../lib/money';
import { canEditOffers, displayProduct, watchMenu, type Menu, type MenuWatcher, type Product } from '../lib/menu';
import { acceptReview, counterJournal, counterScope, editDraft, emptyDraft, prepareSubmission, refuseSubmission, setQuantity, type CounterJournal, type CounterState } from '../lib/counter';
import type { Device, PrivateOrder, Register, ReviewQuote, Session, Table } from '../lib/table';
import type { FulfillmentStatus } from '../../../../packages/contracts/src/index';
import { latestOrder, nextFulfillment, type FulfillmentAction } from '../lib/fulfillment';
import CustomerCard from './CustomerCard';
import OrderBill, { FrozenRouting, SettlementTrust } from './OrderBill';
import ProductOfferEditor from './ProductOfferEditor';
import RegistrySettings from './RegistrySettings';
import PricingSettings from './PricingSettings';
import OnlineOptionsSettings from './OnlineOptionsSettings';
import IncomingOrders from './IncomingOrders';
import Promotions from './Promotions';
import Customers from './Customers';
import '../styles/app.css';
import PosGuide from './PosGuide';
import PosOverview from './PosOverview';
import CatalogList from './CatalogList';
import PosReports from './PosReports';
import OpeningHoursSettings from './OpeningHoursSettings';
import ActivityHistory from './ActivityHistory';
import '../styles/pos-workspace.css';
import '../styles/merchant-shell.css';
import '../styles/pos-login.css';
import '../styles/catalog-list.css';

function ProductPrice({ product, language }: { product: Product; language: 'th' | 'en' }) {
  const t = (th: string, en: string) => language === 'th' ? th : en;
  if (!product.unitPrice) return <small>{t('ต้องให้เจ้าของร้านตั้งราคาก่อน', 'Owner pricing setup required')}</small>;
  return <span className="product-price">{product.promotion && product.basePrice && <><del>{formatMoney(product.basePrice)}</del><span className="promotion-badge">{product.promotion.discount.kind === 'percent' ? `${t('ลด ', '')}${product.promotion.discount.percent}%${t('', ' off')}` : `${t('ลด ', '')}${formatMoney({ ...product.basePrice, amountMinor: product.promotion.discount.amountMinor })}${t('', ' off')}`}</span></>}<span>{formatMoney(product.unitPrice)}</span></span>;
}
export default function Pos() {
  const [session, setSession] = useState<Session>(); const [language, setLanguage] = useState<'th' | 'en'>('en');
  const [guideOpen, setGuideOpen] = useState(false);
  const [workspaceExpanded,setWorkspaceExpanded]=useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  useEffect(() => { let active = true; void api<{ enabled: boolean }>('/demo-session').then(result => { if (active) setDemoEnabled(result.enabled === true); }).catch(() => { if (active) setError('Quick sign-in unavailable. You can still sign in with email.'); }); return () => { active = false; }; }, []);
  const [products, setProducts] = useState<Product[]>([]); const [menu, setMenu] = useState<Menu>(); const [menuValid, setMenuValid] = useState(false); const [menuError, setMenuError] = useState('');
  const [tables, setTables] = useState<Table[]>([]); const [devices, setDevices] = useState<Device[]>([]); const [registers, setRegisters] = useState<Register[]>([]); const [registerId, setRegisterId] = useState(''); const [registryError, setRegistryError] = useState('');
  const [counter, setCounter] = useState<CounterState>({ ...emptyDraft }); const [restored, setRestored] = useState(false); const [order, setOrder] = useState<PrivateOrder>(); const [qr, setQr] = useState('');
  const [incoming, setIncoming] = useState<PrivateOrder[]>([]); const [incomingError, setIncomingError] = useState<unknown>(''); const [detail, setDetail] = useState<PrivateOrder>();
  const [incomingReadError, setIncomingReadError] = useState<unknown>('');
  const [incomingReady, setIncomingReady] = useState(false);
  const incomingFailure = incomingError || incomingReadError;
  const [pendingFulfillment, setPendingFulfillment] = useState<FulfillmentAction>();
  const incomingGeneration = useRef(0);
  const detailIntent=useRef(0);
  useEffect(() => { setPendingFulfillment(undefined); ++incomingGeneration.current;++detailIntent.current;setDetail(undefined);setIncoming([]);setIncomingReady(false);setIncomingError('');setIncomingReadError(''); }, [session]);
  const [returnAt,setReturnAt]=useState(0);
  useEffect(()=>{if(!returnAt)return;const timer=setTimeout(()=>{setTab('menu');setReturnAt(0);},Math.max(0,returnAt-Date.now()));return()=>clearTimeout(timer);},[returnAt]);
  const [settingsSection,setSettingsSection]=useState<'floor'|'prices'|'wallet'|'users'|'audit'|'printer'|'hours'>('floor');
  const [tab, setTab] = useState<'overview' | 'catalog' | 'reports' | 'menu' | 'cart' | 'incoming' | 'promotions' | 'customers' | 'settings'>('menu');const [wideShell,setWideShell]=useState(()=>typeof matchMedia==='function'&&matchMedia('(min-width:1100px)').matches);useEffect(()=>{if(typeof matchMedia!=='function')return;const query=matchMedia('(min-width:1100px)'),update=()=>setWideShell(query.matches);query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]); const [treasury, setTreasury] = useState(''); const [treasuryLoaded, setTreasuryLoaded] = useState(false);
  const [kitchenView,setKitchenView]=useState(false);const [deliveryView,setDeliveryView]=useState(false);
  useEffect(()=>setWorkspaceExpanded(false),[tab,kitchenView,detail?.id]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [search, setSearch] = useState(''); const [category, setCategory] = useState(''); const [offerProductId, setOfferProductId] = useState(''); const [clock, setClock] = useState(0); const [online, setOnline] = useState(true);
  const watcher = useRef<MenuWatcher | undefined>(undefined); const journal = useRef<CounterJournal | undefined>(undefined); const acting = useRef(false); const activeSession = useRef(session); activeSession.current = session;
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const activeSettings=session?.role==='owner'?settingsSection:'floor';
  const register = registers.find(r => r.id === registerId && !r.retiredAt); const target = devices.find(d => d.id === register?.deviceId);
  const scope = session && register ? counterScope(session, register.id) : '';
  function incomingAction(run: () => Promise<void>) {
    void action(async () => {
      setIncomingError('');
      try { await run(); } catch (error) { setIncomingError(error); }
    });
  }
  async function refreshIncoming(orderId = detail?.id) {
    if (!session) return;
    const generation = ++incomingGeneration.current;
    try {
      const [list, selected] = await Promise.all([
        api<{ orders: PrivateOrder[] }>('/orders', undefined, session.token),
        orderId ? api<PrivateOrder>(`/orders/${encodeURIComponent(orderId)}`, undefined, session.token) : undefined,
      ]);
      if (activeSession.current !== session || generation !== incomingGeneration.current) return;
      setIncoming(current => list.orders.map(row => latestOrder(current.find(prior => prior.id === row.id), row)));
      setIncomingReadError('');
      if (selected) setDetail(current => current?.id === selected.id ? latestOrder(current, selected) : current);
    } finally {
      if (activeSession.current === session && generation === incomingGeneration.current) setIncomingReady(true);
    }
  }
  function closeIncoming(){++detailIntent.current;setDetail(undefined);}
  function selectIncoming(id:string){
    const intent=++detailIntent.current,owner=session;
    incomingAction(async()=>{
      if(!owner)return;
      const next=await api<PrivateOrder>(`/orders/${encodeURIComponent(id)}`,undefined,owner.token);
      if(activeSession.current!==owner||intent!==detailIntent.current)return;
      setDetail(current=>current?.id===next.id?latestOrder(current,next):next);
    });
  }
  async function sendFulfillment(request: FulfillmentAction) {
    if (!session) return;
    ++incomingGeneration.current;
    setPendingFulfillment(request);
    try {
      await api(`/orders/${encodeURIComponent(request.orderId)}/${request.kind}`, request.body, session.token);
    } catch (error) {
      if (error instanceof ApiError && error.definiteRefusal) {
        setPendingFulfillment(undefined);
        await refreshIncoming(request.orderId).catch(() => undefined);
      }
      throw error;
    }
    // A successful mutation must not be resent merely because the following GET failed.
    setPendingFulfillment(undefined);
    await refreshIncoming(request.orderId);
  }
  function advanceFulfillment(status: FulfillmentStatus|'ACCEPTED'|'REJECTED',reason?:string,preparationMinutes?:number) {
    incomingAction(async () => {
      if(status==='ACCEPTED'||status==='REJECTED'){
        if(pendingFulfillment||!detail?.onlineAcceptance||detail.onlineAcceptance.status!=='PENDING'||status==='REJECTED'&&!reason?.trim()||status==='ACCEPTED'&&(!Number.isInteger(preparationMinutes)||preparationMinutes!<1||preparationMinutes!>1440))return;
        const decision=status==='REJECTED'?{status,reason:reason!.trim()}:{status,preparationMinutes:preparationMinutes!};
        await sendFulfillment({orderId:detail.id,kind:'acceptance',body:{...decision,expectedVersion:detail.onlineAcceptance.version,idempotencyKey:requestId()}});
        return;
      }
      if (pendingFulfillment || !detail?.fulfillment || detail.status !== 'PAID' || nextFulfillment[detail.fulfillment.status] !== status) return;
      await sendFulfillment({ orderId: detail.id, kind: 'fulfillment', body: { status, expectedVersion: detail.fulfillment.version, idempotencyKey: requestId() } });
    });
  }
  function resendPickup(device: Device) {
    incomingAction(async () => {
      if (pendingFulfillment || !detail?.fulfillment || detail.status !== 'PAID' || detail.fulfillment.status !== 'READY') return;
      await sendFulfillment({ orderId: detail.id, kind: 'notification/retry', body: { expectedVersion: detail.fulfillment.version, idempotencyKey: requestId(), targetDeviceId: device.id, assignmentGeneration: device.assignmentGeneration, confirmTarget: true } });
    });
  }
  async function action(run: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError('');
    try { await run(); } catch (error) { setError(errorMessage(error)); }
    finally { acting.current = false; setBusy(false); }
  }
  async function persist(next: CounterState) {
    if (!scope || !restored || !journal.current) throw new Error('Select an authenticated register and restore its draft first.');
    const saved = await journal.current.save(scope, next); setCounter(saved); return saved;
  }
  async function refreshRegistry() {
    if (!session) return;
    const [t, d, r] = await Promise.all([api<{ tables: Table[] }>('/tables', undefined, session.token), api<{ devices: Device[] }>('/devices', undefined, session.token), api<{ registers: Register[] }>('/registers', undefined, session.token)]);
    if (activeSession.current !== session) return;
    setTables(t.tables); setDevices(d.devices); setRegisters(r.registers); setRegistryError('');
  }
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    journal.current = counterJournal(); setOnline(navigator.onLine);
    const update = () => setOnline(navigator.onLine); window.addEventListener('online', update); window.addEventListener('offline', update);
    const timer = setInterval(() => setClock(performance.now()), 500);
    return () => { clearInterval(timer); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true; let inFlight = false;
    setMenuValid(false); setMenuError('');
    const next = watchMenu(() => api<Menu>('/menu', undefined, session.token), (nextMenu, valid) => {
      setProducts(nextMenu.products.map(product => displayProduct(product, valid, nextMenu.asOf))); setMenu(nextMenu); setMenuValid(valid); setMenuError('');
    }, error => { setMenuError(error instanceof Error ? error.message : 'Menu unavailable'); setMenuValid(false); });
    watcher.current = next;
    const poll = async () => {
      if (inFlight || acting.current) return; inFlight = true;
      const generation = incomingGeneration.current;
      try { await refreshRegistry(); const result = await api<{ orders: PrivateOrder[] }>('/orders', undefined, session.token); if (active && generation === incomingGeneration.current && !acting.current) { setIncoming(current => result.orders.map(row => latestOrder(current.find(p => p.id === row.id), row))); setIncomingReadError('');setIncomingReady(true); } }
      catch (error) { if (active && generation === incomingGeneration.current && !acting.current) { setRegistryError('Reconnecting to POSClock. Please wait.'); setIncomingReadError(error);setIncomingReady(true); } }
      finally { inFlight = false; }
    };
    void poll(); const timer = setInterval(poll, 2000);
    return () => { active = false; next.stop(); watcher.current = undefined; clearInterval(timer); };
  }, [session]);
  useEffect(() => {
    if (!session || registerId || !registers.length) return;
    try {
      const stored = localStorage.getItem(`bitpos-register:${session.merchantId}:${session.userId}`);
      if (stored && registers.some(r => r.id === stored && !r.retiredAt)) setRegisterId(stored);
    } catch { setError('Register preference storage unavailable. Select a register manually.'); }
  }, [session, registers, registerId]);
  useEffect(() => {
    setRestored(false); setOrder(undefined); setQr('');
    if (!scope || !journal.current) return;
    let active = true;
    void journal.current.load(scope).then(async saved => {
      if (!active) return; setCounter(saved); setRestored(true);
      if (saved.phase === 'order') {
        const next = await api<PrivateOrder>(`/orders/${encodeURIComponent(saved.orderId)}`, undefined, session!.token); if (active) setOrder(next);
      } else if (saved.phase === 'pending') {
        const result = await api<{ order: PrivateOrder | null }>(`/registers/${encodeURIComponent(registerId)}/submissions/${encodeURIComponent(saved.request.idempotencyKey)}`, undefined, session!.token);
        if (active && result.order) { const committed = await journal.current!.save(scope, { items: saved.items, customerId: saved.customerId, serving: saved.serving, revision: saved.revision, phase: 'order', orderId: result.order.id }); if (active) { setCounter(committed); setOrder(result.order); } }
      }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : 'Draft recovery unavailable. Do not start a replacement submission.'); });
    return () => { active = false; };
  }, [scope]);
  useEffect(() => {
    if (!order || !session) return;
    let active = true; let inFlight = false;
    setQr(''); void QRCode.toDataURL(order.paymentUrl, { width: 240, margin: 2 }).then(value => { if (active) setQr(value); }).catch(() => { if (active) setError('QR unavailable. Use the exact payment page link.'); });
    const poll = async () => { if (inFlight) return; inFlight = true; try { const next = await api<PrivateOrder>(`/orders/${encodeURIComponent(order.id)}`, undefined, session.token); if (active) setOrder(current => !current || next.version >= current.version ? next : current); } catch (error) { if (active) setError(error instanceof Error ? error.message : 'Order connection unavailable'); } finally { inFlight = false; } };
    const timer = setInterval(poll, 2000); return () => { active = false; clearInterval(timer); };
  }, [order?.id, order?.paymentUrl, session]);
  useEffect(() => { setDetail(current => { if (!current) return current; const next = incoming.find(row => row.id === current.id); return next ? latestOrder(current, next) : current; }); }, [incoming]);
  const locked = !restored || busy || counter.phase === 'pending' || counter.phase === 'order';
  const selected = new Map(counter.items.map(item => [item.productId, item.qty]));
  const categories = [...new Set(products.map(product => product.category).filter(Boolean))];
  const visible = products.filter(product => (!category || product.category === category) && `${product.name} ${product.nameEn} ${product.category} ${product.description}`.toLowerCase().includes(search.toLowerCase()));
  const offerProduct = products.find(product => product.id === offerProductId);
  const estimate = products.reduce((sum, product) => sum + BigInt(product.unitPrice?.amountMinor ?? '0') * BigInt(selected.get(product.id) ?? 0), 0n);
  const review = counter.phase === 'review' || counter.phase === 'pending' ? counter.quote : undefined;
  const reviewCurrent = counter.phase === 'review' && clock < counter.deadline && menuValid && menu?.priceVersion === counter.quote.priceVersion && menu.pricingRevision === counter.quote.pricingRevision && register?.pairingGeneration === counter.quote.pairingGeneration && counter.quote.authority.kind === 'versioned' && !!counter.quote.authority.target && !!target && target.id === counter.quote.authority.target.deviceId && target.assignmentGeneration === counter.quote.authority.target.assignmentGeneration;
  const canReview = !locked && online && menuValid && !!register && !!target?.online && target.screen.kind === 'idle' && !registryError && !!menu?.priceVersion && counter.items.length > 0;
  const reviewBlockedReason = !register ? text('เลือกจุดขายของร้านก่อนตรวจบิล', 'Choose a register to start.') : !restored ? text('กำลังกู้คืนตะกร้าเดิม กรุณารอสักครู่', 'Restoring your saved cart…') : busy ? text('กำลังดำเนินการ กรุณารอ', 'Please wait…') : counter.phase === 'pending' ? text('ยังไม่ทราบผลออร์เดอร์เดิม ให้ตรวจสอบคำขอเดิม ห้ามสร้างซ้ำ', 'Checking your order. Do not create another bill.') : counter.phase === 'order' ? text('จบออร์เดอร์เดิมด้วยปุ่มรีเซ็ตที่เซิร์ฟเวอร์อนุญาตก่อน', 'Close the current bill to start another.') : !online ? text('ออฟไลน์ ตะกร้ายังอยู่ เชื่อมต่อใหม่ก่อนตรวจบิล', 'Offline. Your cart is saved.') : registryError ? text('สถานะจอไม่เป็นปัจจุบัน รอการเชื่อมต่อกลับมา', 'Reconnecting to POSClock…') : !target ? text('จุดขายยังไม่มีจอที่จับคู่ ให้เจ้าของตั้งค่าการจับคู่', 'Connect a POSClock in Settings.') : !target.online ? text('จอที่จับคู่ออฟไลน์ ตรวจไฟและการเชื่อมต่อของจอ', 'POSClock is offline. Check its connection.') : target.screen.kind === 'cart' ? text('จอมีตะกร้าที่ใช้งานอยู่ จบหรือทิ้งตะกร้าที่ต้นทางก่อน ห้ามเขียนทับ', 'Someone is ordering on this POSClock. Please wait.') : target.screen.kind === 'order' ? text('จอกำลังแสดงออร์เดอร์เดิม จบการชำระหรือรีเซ็ตบิลที่อนุญาตก่อน', 'POSClock has an open bill. Close it before starting another.') : !menu?.priceVersion ? text('เจ้าของต้องตั้งค่าราคา USD/USDG ก่อน', 'Ask the owner to set menu prices.') : !menuValid ? text('ราคาเมนูหมดอายุ รีเฟรชราคาแล้วตรวจบิลใหม่ ตะกร้ายังอยู่', 'Refresh menu prices to review your saved cart.') : !counter.items.length ? text('เพิ่มสินค้าในตะกร้าก่อนตรวจบิล', 'Add an item to the cart before reviewing.') : '';
  const orderTargetId = order?.authority.kind === 'versioned' ? order.authority.target?.deviceId ?? null : null;
  const orderTarget = devices.find(device => device.id === orderTargetId);
  async function clearReceipt() {
    await persist({ ...emptyDraft, revision: counter.revision }); setOrder(undefined); setQr(''); setError(''); await refreshRegistry();setReturnAt(Date.now()+10000);
  }
  async function dismissReceipt() {
    if (!session || !order || order.authority.kind !== 'versioned' || !order.authority.target || order.authority.source.kind !== 'register') throw new Error('Refresh the order and try again.');
    const registry = await api<{ devices: Device[] }>('/devices', undefined, session.token);
    const targetId = order.authority.target.deviceId;
    const device = registry.devices.find(row => row.id === targetId);
    if (!device) throw new Error('Display unavailable. Try again after reconnecting.');
    // Timeout/cancel may already have released this display. Closing a local receipt must not dismiss a newer order.
    if (device.screen.kind !== 'order' || device.screen.orderId !== order.id) {
      const latest = await api<PrivateOrder>(`/orders/${encodeURIComponent(order.id)}`, undefined, session.token);
      if (!['EXPIRED', 'PAID'].includes(latest.status)) throw new Error('Payment is still being checked.');
      await clearReceipt(); return;
    }
    await api(`/registers/${encodeURIComponent(order.authority.source.registerId)}/orders/${encodeURIComponent(order.id)}/dismiss`, { orderVersion: order.version, screenGeneration: device.screen.screenGeneration }, session.token);
    await clearReceipt();
  }
  useEffect(()=>{if(order?.status==='PAID'&&orderTarget?.screen.kind==='idle'&&!registryError&&!busy)void action(dismissReceipt);},[order?.id,order?.status,orderTarget?.screen.kind,registryError]);
  async function cancelReceipt() {
    if (!session || !order || order.authority.kind !== 'versioned' || !order.authority.target) return;
    const registry = await api<{ devices: Device[] }>('/devices', undefined, session.token);
    const targetId = order.authority.target.deviceId;
    const device = registry.devices.find(row => row.id === targetId);
    if (!device || device.screen.orderId !== order.id) throw new Error('This bill is no longer on the display. Refresh its status.');
    await api(`/orders/${encodeURIComponent(order.id)}/cancel`, { deviceId: device.id, orderVersion: order.version, screenGeneration: device.screen.screenGeneration }, session.token);
    await clearReceipt();
  }
  async function submit() {
    if (!online || !session || !register) throw new Error('Offline or unauthorized. Draft retained; nothing sent.');
    if (counter.phase !== 'pending' && !reviewCurrent) throw new Error('Review prices and routing again before confirming.');
    const pending = counter.phase === 'pending' ? counter : await persist(prepareSubmission(counter, performance.now(), requestId()));
    if (pending.phase !== 'pending') return;
    try {
      const next = await api<PrivateOrder>(`/registers/${encodeURIComponent(register.id)}/orders`, pending.request, session.token);
      // Do not downgrade to a new draft if the order committed but the local receipt write fails.
      const saved = await persist({ items: pending.items, customerId: pending.customerId, serving: pending.serving, revision: pending.revision, phase: 'order', orderId: next.id });
      setOrder(next); setCounter(saved);
    } catch (error) {
      if (error instanceof ApiError && error.definiteRefusal && ![401, 403, 404].includes(error.status)) await persist(refuseSubmission(pending, error.message));
      throw error;
    }
  }
  const sidebar=!!session&&(tab==='incoming'||wideShell);
  const merchantNavigation=[
    {label:text('ภาพรวม','Overview'),icon:'chart',tab:'overview'},
    {label:text('หน้าขาย','Sales'),icon:'cart',tab:'menu'},
    {label:text('ศูนย์ออร์เดอร์','Order center'),icon:'receipt',tab:'incoming',kitchen:false},
    {label:text('คิวครัว','Kitchen queue'),icon:'coffee',tab:'incoming',kitchen:true},
    {label:text('จัดส่ง','Delivery'),icon:'bike',tab:'incoming',kitchen:false,delivery:true},
    {label:text('สินค้าและคลัง','Products & inventory'),icon:'box',tab:'catalog'},
    {label:text('ลูกค้า','Customers'),icon:'staff',tab:'customers'},
    {label:text('โปรโมชัน','Promotions'),icon:'card',tab:'promotions'},
    {label:text('รายงาน','Reports'),icon:'chart',tab:'reports'},
    {label:text('ตั้งค่า','Settings'),icon:'settings',tab:'settings'},
  ] as const;
  return <div className="shell" lang={language} data-workspace-expanded={workspaceExpanded} data-merchant-shell={sidebar&&tab!=='incoming'?'true':undefined}><div className="order-mobile-shell" hidden={tab!=='incoming'||!session||!!detail}><button type="button" aria-label={text('กลับหน้าขาย','Back to sales')} onClick={()=>setTab('menu')}><span aria-hidden="true">‹</span></button><h1>{kitchenView?text('คิวครัว','Kitchen queue'):text('ศูนย์ออร์เดอร์','Order center')}</h1><button type="button" aria-expanded={workspaceExpanded} aria-label={text('เมนูและบัญชีร้าน','Workspace navigation and account')} onClick={()=>setWorkspaceExpanded(!workspaceExpanded)}><MerchantIcon name="menu"/></button></div><header><a className="brand" href="/">◈ BitPOS <small>{menu?.merchant.name ?? 'Merchant workspace'}</small></a><div className="toolbar"><button type="button" className="secondary workspace-help" onClick={() => setGuideOpen(true)}><MerchantIcon name="help" />{text('วิธีใช้งาน', 'Guide')}</button><button className="secondary language-toggle" aria-label={text('เปลี่ยนเป็นภาษาอังกฤษ', 'Switch to Thai')} title={text('เปลี่ยนเป็นภาษาอังกฤษ', 'Switch to Thai')} aria-pressed={language === 'th'} onClick={() => setLanguage(language === 'th' ? 'en' : 'th')}><LocaleFlag language={language === 'en' ? 'th' : 'en'} /></button>{session && <><span className="badge" data-role={session.role}><MerchantIcon name={session.role === 'owner' ? 'owner' : session.role === 'manager' ? 'manager' : 'staff'} />{session.role === 'owner' ? text('เจ้าของร้าน', 'Owner') : session.role === 'manager' ? text('ผู้จัดการ', 'Manager') : text('พนักงาน', 'Staff')}</span><button className="secondary" disabled={busy} onClick={() => void action(async () => { await api('/session', undefined, session.token, 'DELETE'); setSession(undefined); setRegisterId(''); setProducts([]); setRegisters([]); setDevices([]); setTables([]); setIncoming([]); setDetail(undefined); setCounter({ ...emptyDraft }); setRestored(false); setOrder(undefined); setMenu(undefined); setTreasuryLoaded(false); setOfferProductId(''); })}><MerchantIcon name="logout" />{text('ออกจากระบบ', 'Log out')}</button></>}</div></header>
    {guideOpen && <PosGuide language={language} page={tab === 'overview' || tab === 'catalog' || tab === 'reports' ? 'menu' : tab} role={session?.role} onClose={() => setGuideOpen(false)} onNavigate={setTab} />}
    {!session ? <main className="login panel"><aside className="login-brand" aria-hidden="true"><img className="login-brand-logo" src="/images/bitpos-logo.png" alt=""/><img className="login-brand-photo" src="/images/menu/latte.jpg" alt=""/><strong>{text('ร้านของคุณ พร้อมทุกออเดอร์','Your shop, ready for every order')}</strong><span>{text('ขายหน้าร้าน รับออเดอร์ออนไลน์ และดูแลลูกค้า','Sell in store, take online orders and look after customers')}</span></aside><div className="login-form"><p className="eyebrow">MERCHANT WORKSPACE</p><h1>{text('สวัสดี ร้านของคุณ', 'Welcome to your shop')}</h1><form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void action(async () => { const next = await api<Session>('/session', { email: data.get('email'), password: data.get('password'), ...(data.get('merchantId') ? { merchantId: data.get('merchantId') } : {}) }); if (!next.userId) throw new Error('Authenticated user identity missing; durable draft cannot be scoped safely.'); setSession(next); }); }}><label>{text('อีเมล', 'Email')}<input name="email" type="email" required autoComplete="username" /></label><label>{text('รหัสผ่าน', 'Password')}<input name="password" type="password" required autoComplete="current-password" /></label><details className="bill-details"><summary>{text('ตัวเลือกเพิ่มเติม', 'More sign-in options')}</summary><label>{text('รหัสร้าน (ไม่บังคับ)', 'Merchant ID (optional)')}<input name="merchantId" /></label></details><button disabled={busy}><MerchantIcon name="login" />{text('เข้าสู่ระบบ', 'Sign in')}</button></form>{demoEnabled && <section className="demo-signin" aria-label="Quick sign-in"><p>{text('เข้าสู่ระบบด่วน', 'Quick sign-in')}</p><div className="toolbar">{(['owner', 'manager', 'staff'] as const).map(role => <button className="secondary" key={role} data-demo-role={role} disabled={busy} onClick={() => void action(async () => { const next = await api<Session>('/demo-session', { role }); if (!next.userId || next.role !== role) throw new Error('Account identity or membership mismatch.'); setSession(next); })}><MerchantIcon name={role} />{role === 'owner' ? text('เจ้าของร้าน', 'Owner') : role === 'manager' ? text('ผู้จัดการ', 'Manager') : text('พนักงาน', 'Staff')}</button>)}</div><small>{text('เลือกบทบาทเพื่อเข้าใช้งาน', 'Choose your role to sign in.')}</small></section>}</div></main> : <>
    <section className={`workspace-bar ${(tab === "menu" || tab === "cart") ? "with-register" : "without-register"}`}>
      <label className="workspace-register">{text('จุดขาย','Register')}<select aria-label={text('จุดขาย','Register')} value={registerId} disabled={busy||counter.phase==='pending'} onChange={event=>{const id=event.target.value;try{localStorage.setItem(`bitpos-register:${session.merchantId}:${session.userId}`,id);}catch{setError('Register preference unavailable; the selected register still requires server authorization.');}setRegisterId(id);}}><option value="">{text('เลือกจุดขาย','Select a register')}</option>{registers.filter(r=>!r.retiredAt).map(r=><option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
      <p className="notice workspace-status" role="status">{!online?text('ออฟไลน์ · บันทึกตะกร้าไว้แล้ว','Offline · Your cart is saved.'):!register?text('เลือกจุดขายเพื่อเริ่มรับออเดอร์','Choose a register to start taking orders.'):!target?text('ผูก BitPOS Mini ในหน้าตั้งค่า','Connect a BitPOS Mini in Settings.'):`${target.label} · ${target.online?text('ออนไลน์','Online'):text('ออฟไลน์','Offline')} · ${target.screen.kind==='idle'?text('ว่าง','Available'):text('กำลังใช้งาน','In use')}`}</p>
      {registryError&&<p className="error" role="status">{registryError}</p>}
      <nav className="workspace-tabs" aria-label={text('พื้นที่ทำงาน','Workspace')}>
        {sidebar&&<><a className="merchant-sidebar-logo" href="/" aria-label="BitPOS"><img src="/images/bitpos-logo.png" alt="BitPOS"/></a><div className="merchant-sidebar-account"><strong>{menu?.merchant.name??text('พื้นที่ร้านค้า','Merchant workspace')}</strong><small>{text('บัญชีร้านค้าที่เข้าสู่ระบบ','Signed-in merchant account')}</small></div>{merchantNavigation.map(item=><button key={item.label} type="button" disabled={!item.tab} title={!item.tab?text('ยังไม่มีหน้าร้านค้าที่เชื่อมต่อ','Merchant destination not connected'):undefined} aria-current={(item.tab===tab||item.tab==='menu'&&tab==='cart')&&(!('kitchen' in item)||item.kitchen===kitchenView)&&(!('kitchen' in item)||('delivery' in item)===deliveryView)?'page':undefined} onClick={()=>{if(item.tab){if(item.tab==='incoming'){closeIncoming();setKitchenView('kitchen' in item&&item.kitchen);setDeliveryView('delivery' in item);}setTab(item.tab);}}}><MerchantIcon name={item.icon}/>{item.label}</button>)}<p className="merchant-sidebar-limit">{text('รายการสีจางยังไม่มีหน้าร้านค้าที่เชื่อมต่อ','Dimmed destinations have no connected merchant page.')}</p></>}
        <div className={sidebar?'merchant-navigation-extras':undefined}>
          <button aria-current={tab==='overview'?'page':undefined} onClick={()=>setTab('overview')}><MerchantIcon name="chart"/>{text('ภาพรวม','Overview')}</button>
          <button aria-current={tab==='reports'?'page':undefined} onClick={()=>setTab('reports')}><MerchantIcon name="chart"/>{text('รายงาน','Reports')}</button>
          <button aria-current={tab==='catalog'?'page':undefined} onClick={()=>setTab('catalog')}><MerchantIcon name="box"/>{text('สินค้า','Products')}</button>
          <button aria-current={tab==='menu'?'page':undefined} onClick={()=>setTab('menu')}><MerchantIcon name="menu"/>{text('เมนู','Menu')}</button>
          <button aria-current={tab==='cart'?'page':undefined} onClick={()=>setTab('cart')}><MerchantIcon name="cart"/>{text('ตะกร้า','Cart')} ({counter.items.reduce((sum,item)=>sum+item.qty,0)})</button>
          <button aria-current={tab==='incoming'?'page':undefined} onClick={()=>{closeIncoming();setKitchenView(false);setDeliveryView(false);setTab('incoming');}}><MerchantIcon name="receipt"/>{text('ออเดอร์','Orders')} ({incoming.filter(row=>!['PAID','EXPIRED'].includes(row.status)).length})</button>
          <button aria-current={tab==='promotions'?'page':undefined} onClick={()=>setTab('promotions')}><MerchantIcon name="edit"/>{text('โปรโมชัน','Promotions')}</button>
          <button aria-current={tab==='customers'?'page':undefined} onClick={()=>setTab('customers')}><MerchantIcon name="staff"/>{text('ลูกค้า','Customers')}</button>
          <button aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}><MerchantIcon name="settings"/>{text('ตั้งค่า','Settings')}</button>
        </div>
      </nav>
    </section>
    {tab === 'customers' && <Customers session={session} language={language} />}
    {tab === 'promotions' && <Promotions key={`${session.merchantId}:${session.userId}`} session={session} language={language} products={products} tables={tables} devices={devices} registryCurrent={!registryError} refreshRegistry={refreshRegistry} />}
    {tab === 'overview' && <PosOverview orders={incoming} ready={incomingReady} failed={!!incomingFailure} language={language} onOpenOrders={() => { closeIncoming(); setKitchenView(false); setDeliveryView(false); setTab('incoming'); }} />}
    {tab === 'catalog' && <><CatalogList products={products} language={language} canEdit={canEditOffers(session.role)} stockToken={canEditOffers(session.role) ? session.token : undefined} onChanged={() => void watcher.current?.refresh()} menuReady={menuValid} onEditOffer={setOfferProductId} onOpenPricing={session.role === 'owner' ? () => { setSettingsSection('prices'); setTab('settings'); } : undefined} editor={offerProduct && canEditOffers(session.role) ? <ProductOfferEditor key={`${session.merchantId}:${offerProduct.id}`} product={offerProduct} token={session.token} language={language} onClose={() => setOfferProductId('')} onSaved={() => void watcher.current?.refresh()} /> : undefined} /></>}
    {tab === 'reports' && <PosReports products={products} orders={incoming} ready={incomingReady} failed={!!incomingFailure} language={language} token={canEditOffers(session.role) ? session.token : undefined} />}
    {(tab === 'promotions' || tab === 'customers' || tab === 'overview' || tab === 'catalog' || tab === 'reports') ? null : tab === 'settings' ? <main className="settings-workspace settings-categories"><aside className="settings-sidebar"><p className="eyebrow">{text('จัดการร้าน','YOUR SHOP')}</p><h1>{text('ตั้งค่า','Settings')}</h1><nav aria-label={text('หมวดการตั้งค่า','Settings categories')}>{([{id:'floor',icon:'menu' as const,label:text('ผังร้านและอุปกรณ์','Floor & devices'),hint:text('โต๊ะ · POSClock · จุดขาย','Tables · POSClock · Registers')},...(session.role==='owner'?[{id:'prices',icon:'receipt' as const,label:text('เมนูและราคา','Menu & prices'),hint:text('ราคาและสกุลเงิน','Prices & currency')},{id:'wallet',icon:'owner' as const,label:text('กระเป๋ารับเงิน','Payment wallet'),hint:text('บัญชีที่ร้านรับชำระ','Where payments arrive')},{id:'users',icon:'staff' as const,label:text('ผู้ใช้งานและสิทธิ์','Users & permissions'),hint:text('ยังไม่เปิดใช้งาน','Not available yet')},{id:'audit',icon:'receipt' as const,label:text('ประวัติการใช้งาน','Activity history'),hint:text('เหตุการณ์ที่เซิร์ฟเวอร์บันทึก','Events the server recorded')},{id:'printer',icon:'receipt' as const,label:text('เครื่องพิมพ์ใบเสร็จ','Receipt printer'),hint:text('ยังไม่เปิดใช้งาน','Not available yet')},{id:'hours',icon:'menu' as const,label:text('สาขาและเวลาทำการ','Branch & opening hours'),hint:text('เวลาเปิด-ปิดรายสัปดาห์','Weekly opening hours')}]:[])] as const).map(item=><button key={item.id} type="button" aria-current={activeSettings===item.id?'page':undefined} onClick={()=>setSettingsSection(item.id as 'floor'|'prices'|'wallet'|'users'|'audit'|'printer'|'hours')}><MerchantIcon name={item.icon}/><span><strong>{item.label}</strong><small>{item.hint}</small></span><span className="settings-chevron" aria-hidden="true">›</span></button>)}</nav></aside><div className="settings-content"><div className="settings-panel" hidden={activeSettings!=='floor'}><RegistrySettings session={session} tables={tables} devices={devices} registers={registers} refresh={refreshRegistry} language={language} /></div>{session.role === 'owner' && <><div className="settings-panel" hidden={activeSettings!=='prices'}><><PricingSettings session={session} products={products} language={language} saved={() => { void watcher.current?.refresh(); }} /><OnlineOptionsSettings session={session} products={products} language={language} /></></div><div className="settings-panel" hidden={activeSettings!=='users'}><section className="panel"><h2>{text('ผู้ใช้งานและสิทธิ์','Users & permissions')}</h2><p>{text(`คุณเข้าสู่ระบบด้วยบทบาท: ${session.role}`,`You are signed in with the role: ${session.role}`)}</p><p className="notice" role="status">{text('ยังไม่เปิดใช้งาน เซิร์ฟเวอร์ยังไม่มีรายการสมาชิกและการเชิญ จึงไม่มีปุ่มที่แก้สิทธิ์ได้ สิทธิ์ยังถูกบังคับที่เซิร์ฟเวอร์ทุกคำขอ','Not available yet. The server has no member listing or invitations, so nothing here can change permissions. Roles are still enforced by the server on every request.')}</p></section></div><div className="settings-panel" hidden={activeSettings!=='audit'}>{activeSettings==='audit'&&<ActivityHistory session={session} language={language} />}</div><div className="settings-panel" hidden={activeSettings!=='printer'}><section className="panel"><h2>{text('เครื่องพิมพ์ใบเสร็จ','Receipt printer')}</h2><p className="notice" role="status">{text('ยังไม่เปิดใช้งาน ระบบยังไม่มีการเชื่อมต่อหรือตั้งค่าเครื่องพิมพ์ ใบเสร็จดูได้จากหน้าบิลของออเดอร์','Not available yet. No printer connection or configuration exists. Receipts can still be read on the order bill.')}</p></section></div><div className="settings-panel" hidden={activeSettings!=='hours'}>{activeSettings==='hours'&&<OpeningHoursSettings session={session} language={language} />}</div><div className="settings-panel" hidden={activeSettings!=='wallet'}><section className="panel"><h2>{text('กระเป๋ารับเงิน','Payment wallet')}</h2><p>{text('กระเป๋าที่ร้านใช้รับเงินจากลูกค้า','The wallet where your cafe receives payments.')}</p><button className="secondary" disabled={busy} onClick={() => void action(async () => { const next = await api<{ treasury: string }>('/settings', undefined, session.token); setTreasury(next.treasury); setTreasuryLoaded(true); })}><MerchantIcon name="refresh" />{text('ดูกระเป๋า','View wallet')}</button>{treasuryLoaded && <form onSubmit={event => { event.preventDefault(); void action(async () => { await api('/settings', { treasury }, session.token, 'PUT'); setTreasuryLoaded(false); }); }}><label>{text('ที่อยู่กระเป๋า Solana','Solana wallet address')}<input value={treasury} required onChange={event => setTreasury(event.target.value)} /></label><button disabled={busy}><MerchantIcon name="save" />{text('บันทึกกระเป๋า','Save wallet')}</button></form>}</section></div></>}</div></main> : tab === 'incoming' ? <IncomingOrders key={kitchenView?'kitchen':deliveryView?'delivery':'orders'} initialChannel={deliveryView?'delivery':'all'} kitchenOnly={kitchenView} session={session} orders={incoming} detail={detail} error={incomingFailure ? errorMessage(incomingFailure) : ''} errorDenied={incomingFailure instanceof ApiError && (incomingFailure.status === 401 || incomingFailure.status === 403)} busy={busy || !incomingReady} language={language} canReview={canEditOffers(session.role)} canFulfill={['owner','manager','staff'].includes(session.role)} devices={devices} registryError={registryError} pending={pendingFulfillment} close={closeIncoming} select={selectIncoming} refresh={refreshIncoming} refreshTargets={()=>incomingAction(async()=>{try{await refreshRegistry();}catch(error){setRegistryError(errorMessage(error));throw error;}})} fulfill={advanceFulfillment} resend={resendPickup} retryAction={()=>incomingAction(async()=>{if(pendingFulfillment)await sendFulfillment(pendingFulfillment);})} review={()=>incomingAction(async()=>{if(!detail)return;await api(`/orders/${encodeURIComponent(detail.id)}/recovery`,{resolution:'acknowledged'},session.token);await refreshIncoming(detail.id);})} /> : <main className={`workspace tablet-${tab}`}>
    <section className="menu-pane"><div className="section-heading"><div><p className="eyebrow">FRESH PICKS</p><h1>{text('เมนูของร้าน', 'Shop menu')}</h1></div><div className="menu-filters"><input aria-label={text('ค้นหาเมนู', 'Search menu')} value={search} placeholder={text('ค้นหาเมนู…', 'Search menu…')} onChange={event => setSearch(event.target.value)} />{categories.length > 0 && <select aria-label={text('หมวดหมู่เมนู', 'Menu category')} value={category} onChange={event => setCategory(event.target.value)}><option value="">{text('ทุกหมวดหมู่', 'All categories')}</option>{categories.map(value => <option key={value}>{value}</option>)}</select>}<button className="secondary" onClick={() => void watcher.current?.refresh()}><MerchantIcon name="refresh" />{text('รีเฟรชราคาเมนู', 'Refresh menu prices')}</button></div></div>
    {offerProduct && canEditOffers(session.role) && <ProductOfferEditor key={`${session.merchantId}:${offerProduct.id}`} product={offerProduct} token={session.token} language={language} onClose={() => setOfferProductId('')} onSaved={() => void watcher.current?.refresh()} />}{(!menuValid || !menu?.priceVersion) && <p className="notice" role="status">{!menu && !menuError ? text('กำลังโหลดเมนูและราคา…', 'Loading menu and prices…') : !menu?.priceVersion ? text('ตั้งราคาเมนูในหน้าตั้งค่าเพื่อเริ่มขาย', 'Set menu prices in Settings to start selling.') : text('กำลังอัปเดตราคา ตะกร้าของคุณถูกบันทึกไว้', 'Prices are updating. Your cart is saved.')}</p>}{menuError && <p className="error" role="alert">{menuError}</p>}<div className="menu">{visible.map(product => <div className="product-card" key={product.id}><button className="product" aria-label={`Add ${product.nameEn}`} disabled={locked || !online || !menuValid || !product.unitPrice || product.available <= (selected.get(product.id) ?? 0) || (selected.get(product.id) ?? 0) >= 100} onClick={() => void action(async () => { await persist(setQuantity(counter, product.id, (selected.get(product.id) ?? 0) + 1)); })}><MerchantIcon name="plus" />{product.imageUrl && <img className="product-photo" src={product.imageUrl} alt="" loading="lazy" decoding="async" />}{product.category && <small className="product-category">{product.category}</small>}<strong>{language === 'th' ? product.name : product.nameEn}</strong>{product.description && <small className="product-description">{product.description}</small>}<span className="product-bottom"><ProductPrice product={product} language={language} /><small>{product.available ? text(`เหลือ ${product.available}`, `${product.available} available`) : text('สินค้าหมด', 'Sold out')}</small></span></button>{canEditOffers(session.role) && product.basePrice && <button className="secondary offer-edit-button" aria-label={`Edit offer for ${product.nameEn}`} onClick={() => setOfferProductId(product.id)}><MerchantIcon name="edit" />{text('แก้ไขข้อเสนอ', 'Edit offer')}</button>}</div>)}</div>{visible.length === 0 && <p>No menu items found.</p>}</section>
    <aside className="panel cart"><p className="eyebrow">{text('รายการของคุณ','YOUR ORDER')}</p><h2>{text('ตะกร้า', 'Cart')}</h2>{!restored && <p className="notice">{text('เลือกจุดขายเพื่อโหลดตะกร้า','Choose a register to load your cart.')}</p>}{counter.phase === 'order' && order ? <><><OrderBill order={order} language={language} /><CustomerCard session={session} customerId={order.customerId ?? counter.customerId} disabled={true} language={language} select={async () => { throw new Error('Existing order customer is frozen; contact editing does not bind payment.'); }} /></><section className="order">{qr && online && !['PAID', 'EXPIRED', 'RECOVERY'].includes(order.status) && Date.parse(order.quoteExpiresAt) > Date.now() && <img className="qr" src={qr} alt={text('QR ชำระเงินเฉพาะบิลนี้','Order-specific payment QR')} />}{!['PAID', 'EXPIRED', 'RECOVERY'].includes(order.status) && <a className="button" href={order.paymentUrl} target="_blank" rel="noreferrer"><MerchantIcon name="arrow" />{text('เปิดหน้าชำระเงิน','Open payment')}</a>}{['PAID', 'EXPIRED', 'RECOVERY'].includes(order.status) && order.authority.kind === 'versioned' && order.authority.source.kind === 'register' && <><button disabled={busy || !online || !!registryError || !orderTarget} onClick={() => void action(dismissReceipt)}><MerchantIcon name="check" />{text('ปิดบิลและเริ่มใหม่', 'Done')}</button></>}{order.canCancel && <button className="secondary" disabled={busy || !online} onClick={() => void action(cancelReceipt)}><MerchantIcon name="close" />{text('ยกเลิกบิล', 'Cancel bill')}</button>}</section></> : <>
      <label>{text('รูปแบบรับสินค้า','Serving')}<select aria-label={text('จุดรับสินค้า','Serving place')} disabled={locked} value={counter.serving.kind === 'table' ? counter.serving.tableId : counter.serving.kind} onChange={event => void action(async () => { const value = event.target.value; await persist(editDraft(counter, { serving: value === 'counter' || value === 'takeaway' ? { kind: value } : { kind: 'table', tableId: value } })); })}><option value="counter">{text('หน้าร้าน','Counter')}</option><option value="takeaway">{text('นำกลับ','Takeaway')}</option>{tables.filter(table => !table.retiredAt).map(table => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label>
      {counter.items.map(item => { const product = products.find(p => p.id === item.productId); const name = product ? language === 'th' ? product.name : product.nameEn : item.productId; return <div className="cart-row" key={item.productId}><span>{name}{product && <ProductPrice product={product} language={language} />}{!product && <small>{text('สินค้านี้ไม่พร้อมขาย นำออกก่อนดำเนินการต่อ','Item unavailable. Remove it to continue.')}</small>}</span><div className="quantity"><button aria-label={`${text('ลดจำนวน','Decrease')} ${name}`} disabled={locked} onClick={() => void action(async () => { await persist(setQuantity(counter, item.productId, item.qty - 1)); })}><MerchantIcon name="minus" /></button><span>{item.qty}</span><button aria-label={`${text('เพิ่มจำนวน','Increase')} ${name}`} disabled={locked || item.qty >= 100 || !product || item.qty >= product.available} onClick={() => void action(async () => { await persist(setQuantity(counter, item.productId, item.qty + 1)); })}><MerchantIcon name="plus" /></button></div></div>; })}
      {counter.phase === 'draft' && counter.reason && <p className="notice" role="status">{errorMessage(new Error(counter.reason))} · {text('ตะกร้าถูกบันทึกไว้แล้ว กรุณาตรวจบิลอีกครั้ง','Your cart is saved. Review it again.')}</p>}{review && <section className="canonical-review" aria-label={text('ตรวจบิล','Review order')}><h3>{text('ตรวจบิลจากเซิร์ฟเวอร์', 'Review order')}</h3><details className="bill-details"><summary>{text('รายละเอียดจุดรับสินค้า','Routing details')}</summary><FrozenRouting authority={review.authority} language={language} /></details><ul className="bill">{review.lines.map(line => <li key={line.productId}><span>{line.qty} × {language === 'th' ? line.name : line.nameEn}<small>{formatMoney(line.unitPrice)} {text('ต่อหน่วย','each')}</small></span><strong>{formatMoney(lineTotal(line))}</strong></li>)}</ul><div className="total"><span>{text('ยอดรวม','Total')}</span><strong>{formatMoney(review.total)}</strong></div><small>{text('บิลใช้ได้ถึง','Bill valid until')} {new Date(review.validUntil).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-US')}</small><details className="bill-details"><summary>{text('รายละเอียดการชำระเงิน','Payment details')}</summary><SettlementTrust settlement={review.settlement} language={language} /></details>{counter.phase === 'review' && !reviewCurrent && <p className="error" role="status">{text('บิลเปลี่ยนแปลงหรือหมดอายุแล้ว กรุณาตรวจบิลอีกครั้ง','This bill has changed or expired. Review the order again.')}</p>}</section>}
      <CustomerCard session={session} customerId={counter.customerId} disabled={locked} language={language} select={async id => { await persist(editDraft(counter, { customerId: id })); }} />
      <div className="cart-actions"><div className="total"><span>{text('ยอดประมาณ (ยังไม่ส่ง)', 'Estimated total')}</span><strong>{menu?.currency ? formatMoney(menu.currency === 'USDG' ? { currency: 'USDG', decimals: 6, amountMinor: estimate.toString() } : { currency: 'USD', decimals: menu?.decimals===4?4:2, amountMinor: estimate.toString() }) : text('ต้องตั้งค่าก่อน','Setup required')}</strong></div>{counter.phase === 'pending' ? <><p className="notice" role="status">{text('กำลังตรวจสอบออร์เดอร์ กรุณาอย่าสร้างบิลใหม่','Checking your order. Please do not create another bill.')}</p><button disabled={busy || !online} onClick={() => void action(submit)}><MerchantIcon name="refresh" />{text('ตรวจสอบออร์เดอร์','Check order')}</button></> : <>{!canReview && <p id="review-blocked-reason" className="notice" role="status">{reviewBlockedReason}</p>}<button className="checkout" disabled={!canReview} aria-describedby={!canReview ? 'review-blocked-reason' : undefined} title={reviewBlockedReason || undefined} onClick={() => void action(async () => { const started = performance.now(); const quote = await api<ReviewQuote>(`/registers/${encodeURIComponent(registerId)}/quotes`, { items: counter.items, ...(counter.customerId ? { customerId: counter.customerId } : {}), serving: counter.serving }, session.token); await persist(acceptReview(counter, quote, performance.now(), performance.now() - started)); })}><MerchantIcon name="receipt" />{text('ตรวจบิล', 'Review order')}</button>{counter.phase === 'review' && <button className="checkout" disabled={busy || !reviewCurrent || !online || !target?.online || target.screen.kind !== 'idle' || !!registryError} onClick={() => void action(submit)}><MerchantIcon name="check" />{text('ยืนยันและสร้างออร์เดอร์', 'Create order')}</button>}<button className="secondary" disabled={locked || !counter.items.length} onClick={() => void action(async () => { await persist(editDraft(counter, { items: [] })); })}><MerchantIcon name="trash" />{text('ล้างตะกร้า','Clear cart')}</button></>}</div>
    </>}</aside></main>}
    {tab === 'menu' && <div className="mobile-cart-bar"><span>{counter.items.reduce((sum, item) => sum + item.qty, 0)} {text('รายการ','items')} · {counter.phase === 'pending' ? text('กำลังตรวจสอบออร์เดอร์','Checking order') : counter.phase === 'order' ? order?.status ?? text('กำลังโหลดออร์เดอร์','Loading order') : text('ในตะกร้า','In cart')}</span><button onClick={() => setTab('cart')}><MerchantIcon name="cart" />{text('ดูตะกร้า','View cart')}</button></div>}
    </>}{error && <div className="error floating" role="alert"><span>{error}</span><button className="secondary" onClick={() => setError('')}><MerchantIcon name="close" />Close notice</button></div>}{returnAt>0&&<div className="working" role="status">Done · Back to menu in {Math.max(0,Math.ceil((returnAt-Date.now())/1000))}s</div>}{busy && <div className="working" role="status">Working…</div>}<footer>BitPOS · Solana Devnet</footer></div>;
}
