import BundlePriceEditor from './BundlePriceEditor';
import PromotionQueues from './PromotionQueues';
import React, { useEffect, useRef, useState } from 'react';
import type { PromotionCampaign, PromotionJob, PromotionsView } from '../../../../packages/contracts/src/promotions';
import { api, ApiError, errorMessage } from '../lib/api';
import { formatMoney } from '../lib/money';
import type { Product } from '../lib/menu';
import type { Device, Session, Table } from '../lib/table';
import { requestId } from '../lib/request-id';
import { promotionJournal, type PromotionJournal, type PromotionCommand, type PromotionJournalRecord } from '../lib/promotion-journal';
import '../styles/promotions.css';
import PromotionPreview from './PromotionPreview';
import PromotionDiscount from './PromotionDiscount';
import PromotionHelp from './PromotionHelp';
import PromotionGenerate from './PromotionGenerate';
import { personalRecipientsView, type PromotionRecipientsView } from '../../../../packages/contracts/src/personal-promotions';
import { PromotionContextReview, PromotionPublication, playlistStatusLabels } from './PromotionCampaignControl';
import PromotionFloor from './PromotionFloor';
import type { FloorSelection } from './ShopFloor';

type Edit = Pick<PromotionCampaign, 'headline' | 'copy' | 'discountPercent' | 'startsAt' | 'expiresAt'>&{bundleUnitMinor?:string};
const editable = (campaign: PromotionCampaign): Edit => ({ ...(campaign.bundle?{bundleUnitMinor:campaign.unitPrice.amountMinor}:{}),headline: campaign.headline, copy: campaign.copy, discountPercent: campaign.discountPercent, startsAt: campaign.startsAt, expiresAt: campaign.expiresAt });
const localTime = (iso: string) => { const date = new Date(iso); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export default function Promotions({ session, language, products, tables, devices, registryCurrent, refreshRegistry }: { session: Session; language: 'th' | 'en'; products: Product[]; tables: Table[]; devices: Device[]; registryCurrent: boolean; refreshRegistry: () => Promise<void> }) {
  const text = (th: string, en: string) => language === 'th' ? th : en;
  const manage = session.role === 'owner' || session.role === 'manager';
  const [libraryTab, setLibraryTab] = useState<'all' | 'DRAFT' | 'APPROVED' | 'history'>('all');
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryPage, setLibraryPage] = useState(0);
  const [presentation, setPresentation] = useState<'library' | 'create' | 'review'>('library');
  const librarySearch = useRef<HTMLInputElement>(null);
  const [showAllJobs, setShowAllJobs] = useState(false);
  const [view, setView] = useState<PromotionsView>();
  const [selectedId, setSelectedId] = useState('');
  const [selectedCampaign, setSelectedCampaign] = useState<PromotionCampaign>();
  const selectedCampaignId = useRef('');
  const [floorSelection, setFloorSelection] = useState<FloorSelection>(null);
  const [inspectionCurrent, setInspectionCurrent] = useState(false);
  const [editScopeConfirmed, setEditScopeConfirmed] = useState(false);
  const [activeJobId, setActiveJobId] = useState('');
  const [publicationEpoch, setPublicationEpoch] = useState(0);
  const [edit, setEdit] = useState<Edit>();
  const [discountValid, setDiscountValid] = useState(true);
  const [editVersion, setEditVersion] = useState<number>();
  const [previewVersion, setPreviewVersion] = useState<number>();
  const [approveConfirmed, setApproveConfirmed] = useState(false);
  const [record, setRecord] = useState<PromotionJournalRecord>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [recipients, setRecipients] = useState<PromotionRecipientsView>();
  const [recipientsFresh, setRecipientsFresh] = useState(false);
  const [recipientsError, setRecipientsError] = useState('');
  const recipientsLoading = useRef(false);
  const recipientsLoadedAt = useRef(0);
  const recipientsEpoch = useRef(0);
  const [now, setNow] = useState(Date.now());
  const journal = useRef<PromotionJournal | undefined>(undefined);
  const saved = useRef<PromotionJournalRecord | undefined>(undefined);
  const acting = useRef(false);
  const alive = useRef(true);
  const campaign = selectedCampaign;
  const locked = busy || !record || !!record.pending;
  const expired = !!campaign && Date.parse(campaign.expiresAt) <= now;
  const dirty = !!campaign && !!edit && JSON.stringify(editable(campaign)) !== JSON.stringify(edit);
  const staleEdit = !!campaign && editVersion !== campaign.version;
  const approved = !!campaign?.scope && campaign.state === 'APPROVED';
  const status = (state: string) => {
    const labels: Record<string, [string, string]> = { DRAFT: ['แบบร่าง', 'Draft'], APPROVED: ['อนุมัติแล้ว', 'Approved'], QUEUED: ['รอจอว่าง / ออนไลน์', 'Queued · waiting for screen'], DELIVERED: ['ส่งถึงเครื่องแล้ว ยังไม่ยืนยันการแสดง', 'Delivered · not yet rendered'], RENDERED: ['เครื่องยืนยันแสดงแล้ว', 'Rendered on screen'], EXPIRED: ['หมดอายุ', 'Expired'], REVOKED: ['ยกเลิกแล้ว', 'Revoked'], FAILED: ['ไม่สำเร็จ', 'Failed'], RUNNING: ['กำลังสร้างแบบร่าง', 'Generating draft'], SUCCEEDED: ['สร้างแบบร่างแล้ว', 'Draft generated'], CONFIGURATION_REQUIRED: ['ต้องตั้งค่าผู้ให้บริการ AI', 'AI configuration required'] };
    Object.assign(labels, playlistStatusLabels);
    return text(...(labels[state] ?? [state, state]));
  };
  function message(error: unknown) {
    if (!(error instanceof ApiError)) return text('การเชื่อมต่อหรือพื้นที่เก็บข้อมูลขัดข้อง หากส่งคำขอแล้ว ให้ตรวจสอบคำขอเดิม ห้ามสร้างซ้ำ', 'Connection or browser storage interrupted. Resolve the saved action before creating another.');
    const errors: Record<string, [string, string]> = {
      INVALID_REQUEST: ['ตรวจข้อมูลแบบร่าง: เป้าหมายไม่เกิน 500 ตัวอักษร เขตเวลาและวันที่ต้องถูกต้อง', 'Check the draft: goal up to 500 characters, valid timezone and dates.'],
      PROMOTION_REVIEW_REQUIRED: ['ราคา สต็อก หรือรูปสินค้าเปลี่ยน ต้องรีเฟรชพรีวิวและอนุมัติใหม่', 'Price, stock or photo changed. Refresh preview and approve again.'],
      PROMOTION_VERSION_CONFLICT: ['แบบร่างเปลี่ยนแล้ว โหลดล่าสุดและตรวจใหม่', 'The draft changed. Reload and review again.'],
      PROMOTION_TARGET_CHANGED: ['การผูกจอเปลี่ยน เลือกและยืนยันจอใหม่', 'Screen generations changed. Select and confirm again.'],
      DEVICE_UNSUPPORTED: ['จอนี้ยังไม่รองรับโปรโมชัน', 'This screen does not support promotions.'],
      PROMOTION_STATE_INVALID: ['สถานะแคมเปญไม่อนุญาตคำสั่งนี้', 'This campaign state does not allow that action.'],
      IDEMPOTENCY_CONFLICT: ['คำขอเดิมขัดแย้ง ห้ามเปลี่ยนคีย์ ต้องตรวจสอบกับผู้ดูแล', 'Saved action conflicts. Keep its key and contact the owner.'],
      FORBIDDEN: ['บัญชีนี้ไม่มีสิทธิ์ทำรายการ', 'Your role cannot perform this action.'],
    };
    return errors[error.code] ? text(...errors[error.code]) : errorMessage(error);
  }
  async function refresh() {
    try {
      const next = await api<PromotionsView>('/promotions', undefined, session.token);
      const jobs = await Promise.all(next.jobs.map(async job => {
        if (job.state !== 'QUEUED' && job.state !== 'RUNNING') return job;
        const result = await api<{ job: PromotionJob }>(`/promotions/jobs/${encodeURIComponent(job.id)}`, undefined, session.token);
        return result.job;
      }));
      if (alive.current) {
        setView({ ...next, jobs }); setFresh(true);
        if (selectedCampaignId.current) {
          const selected = next.campaigns.find(item => item.id === selectedCampaignId.current);
          if (selected) setSelectedCampaign(selected);
          else {
            const id = selectedCampaignId.current;
            const result = await api<{ campaign: PromotionCampaign }>(`/promotions/${encodeURIComponent(id)}`, undefined, session.token);
            if (alive.current && selectedCampaignId.current === id) setSelectedCampaign(result.campaign);
          }
        }
      }
    } catch (error) { if (alive.current) { setFresh(false); setError(message(error)); } }
  }
  async function refreshRecipients() {
    if (recipientsLoading.current) return;
    recipientsLoading.current = true;
    const epoch = recipientsEpoch.current;
    try {
      const next = personalRecipientsView.parse(await api<unknown>('/promotions/recipients', undefined, session.token));
      if (alive.current && epoch === recipientsEpoch.current) { setRecipients(next); setRecipientsFresh(true); setRecipientsError(''); }
    } catch {
      if (alive.current && epoch === recipientsEpoch.current) { setRecipientsFresh(false); setRecipientsError(text('โหลดผู้รับจริงของร้านไม่สำเร็จ ลองโหลดใหม่ คำขอที่บันทึกยังอยู่และไม่ส่งซ้ำ', 'Could not load actual shop recipients. Refresh to retry; saved actions remain intact and are not resent.')); }
    } finally { recipientsLoading.current = false; recipientsLoadedAt.current = epoch === recipientsEpoch.current ? Date.now() : 0; }
  }
  function select(next: PromotionCampaign, scopeConfirmed = !!next.scope?.placement) { selectedCampaignId.current = next.id; setSelectedCampaign(next); setSelectedId(next.id); setEdit(editable(next)); setDiscountValid(true); setEditVersion(next.version); setPreviewVersion(undefined); setApproveConfirmed(false); setEditScopeConfirmed(scopeConfirmed); }
  function openCampaign(next: PromotionCampaign) {
    if (dirty && !window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึกและเปิดแคมเปญนี้?', 'Discard unsaved edits and open this campaign?'))) return;
    setFloorSelection(null); select(next); setPresentation('review');
  }
  function closeCampaign() {
    if (dirty && !window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึกและกลับไปคลัง?', 'Discard unsaved edits and return to the library?'))) return;
    selectedCampaignId.current = ''; setSelectedId(''); setSelectedCampaign(undefined); setEdit(undefined); setEditVersion(undefined); setApproveConfirmed(false); setEditScopeConfirmed(false); setFloorSelection(null); setPresentation('library');
    window.setTimeout(() => librarySearch.current?.focus());
  }
  async function store(pending: PromotionCommand | null) {
    if (!journal.current || !saved.current) throw Error('Journal not ready');
    const next = await journal.current.save(saved.current.revision, pending);
    saved.current = next;
    if (alive.current) setRecord(next);
  }
  async function send(command: PromotionCommand) {
    try {
      const result = await api<{ campaign?: PromotionCampaign; job?: PromotionJob }>(command.path, command.body, session.token, command.method);
      await store(null);
      if (alive.current && result.campaign) {
        if (command.path.endsWith('/revoke') && result.campaign.state === 'REVOKED') {
          selectedCampaignId.current = ''; setSelectedId(''); setSelectedCampaign(undefined); setEdit(undefined); setEditVersion(undefined); setEditScopeConfirmed(false);
          setActiveJobId(''); setFloorSelection(null); setPresentation('library');
        } else {
          setFloorSelection(null); select(result.campaign, command.path.endsWith('/derive') || editScopeConfirmed || !!result.campaign.scope?.placement);
          setPresentation('review');
          if (command.path.endsWith('/preview')) setPreviewVersion(result.campaign.version);
        }
      }
      if (alive.current && result.job) setActiveJobId(result.job.id);
      await refresh();
    } catch (error) {
      // A 5xx/timeout/lost reply is UNKNOWN, not a refusal. Never replace its key
      // or automatically resend. Backend replay resolves before version guards.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'IDEMPOTENCY_CONFLICT') await store(null);
      if (alive.current) { setApproveConfirmed(false); setPreviewVersion(undefined); setError(message(error)); }
      await refresh();
    }
  }
  async function action(run: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError('');
    try { await run(); } catch (error) {
      // A stale-tab CAS failure must expose the winning durable command, not
      // leave this tab apparently unlocked. Reloading never sends anything.
      if (journal.current) {
        try { const next = await journal.current.load(); saved.current = next; if (alive.current) setRecord(next); }
        catch { saved.current = undefined; if (alive.current) setRecord(undefined); }
      }
      if (alive.current) setError(message(error));
    }
    finally { acting.current = false; if (alive.current) setBusy(false); }
  }
  async function mutate(path: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
    if (!saved.current || saved.current.pending) throw Error('Resolve saved action first');
    const command = { path, method, body: { ...body, idempotencyKey: requestId() } };
    await store(command);
    await send(command);
  }
  useEffect(() => {
    alive.current = true; journal.current = promotionJournal(session);
    recipientsEpoch.current += 1; recipientsLoadedAt.current = 0;
    setRecipients(undefined); setRecipientsFresh(false); setRecipientsError('');
    void journal.current.load().then(next => { if (alive.current) { saved.current = next; setRecord(next); } }).catch(error => { if (alive.current) setError(message(error)); });
    let loading = false;
    async function poll() {
      if (loading || acting.current) return;
      loading = true;
      try {
        await refresh();
        if (Date.now() - recipientsLoadedAt.current >= 15000) void refreshRecipients();
        // Durable queued/running jobs are resumed from the server, not local fake output.
      } finally { loading = false; }
    }
    void poll(); const timer = window.setInterval(() => { setNow(Date.now()); void poll(); }, 3000);
    return () => { alive.current = false; recipientsEpoch.current += 1; clearInterval(timer); void journal.current?.close(); };
  }, [session.merchantId, session.userId, session.token]);

  function revokeCampaign(campaign:PromotionCampaign){const full=view?.campaigns.find(c=>c.id===campaign.id)??campaign;const destinations=[...new Set((full.playlistTargets??[]).map(t=>view?.devices.find(d=>d.deviceId===t.deviceId)?.tableLabel??view?.devices.find(d=>d.deviceId===t.deviceId)?.label??t.deviceId))];const shared=campaign.scope?.audience==='daily'&&campaign.scope.placement?.kind!=='table';if(!window.confirm(shared?text(`ลบโปรโมชันรายวันนี้ออกจากทุกเครื่องที่เคยส่ง?\n${destinations.join('\n')}`,`Remove this shared daily promotion from all its destination screens?\n${destinations.join('\n')}`):text(`ลบโปรโมชันนี้ออกจากเครื่องปลายทาง?\n${destinations.join('\n')}`,`Remove this promotion from its destination screen?\n${destinations.join('\n')}`)))return;void action(()=>mutate(`/promotions/${campaign.id}/revoke`,{expectedVersion:campaign.version}));}
  const editor = <>
    {view?.jobs.filter(job => job.id === activeJobId).map(job => <section className="panel promotion-job" key={job.id} aria-label="Requested draft job"><h3>{status(job.state)}</h3><small>#{job.id}</small>{job.blocker && <p className="notice">{job.blocker}</p>}{job.campaignId && <button className="secondary" disabled={locked} onClick={() => { const result = view.campaigns.find(c => c.id === job.campaignId); if (result && (!dirty || window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึก?', 'Discard unsaved edits?')))) { setFloorSelection(null); select(result, true); setPresentation('review'); } }}>{text('เปิดแบบร่าง', 'Open draft')}</button>}<p>{text('งานสร้างแบบร่างเท่านั้น ไม่อนุมัติหรือส่งอัตโนมัติ', 'Draft job only. Nothing is approved or sent automatically.')}</p></section>)}
      {campaign && edit && <section id="campaign-review" className="promotion-review-stage"><header className="promotion-review-heading"><button className="secondary" type="button" onClick={closeCampaign}>{text('กลับไปคลังโปรโมชัน', 'Back to campaign library')}</button><div><p className="eyebrow">P34 · {text('ตรวจร่างแคมเปญ', 'Campaign draft review')}</p><h2>{campaign.headline}</h2><p>{text('บันทึก ตรวจพรีวิว และอนุมัติเป็นขั้นตอนแยกกัน การอนุมัติไม่เผยแพร่หรือเปิดส่วนลด', 'Saving, preview review and approval are separate steps. Approval does not publish or activate a discount.')}</p></div></header><fieldset className="promotion-editor-safety" disabled={!registryCurrent}>
        <section className="panel" aria-label="Preview and edit promotion"><div className="promotion-section-title"><h2>2 · {text('พรีวิวและแก้ไข', 'Preview & edit')}</h2><PromotionHelp label={text('ข้อมูลโปรโมชันและการตรวจสอบ', 'Promotion details and review')}><p>{campaign.rationale}</p><p className="promotion-provenance">{campaign.provenance.kind === 'fixture_provider' ? text('ข้อมูลทดสอบจาก provider fixture — ไม่ใช่ AI จริง', 'Fixture provider output — not a real AI call') : `${campaign.provenance.provider} · ${campaign.provenance.model}`} · #{campaign.provenance.requestId}</p>
          <PromotionContextReview campaign={campaign} language={language} products={products} />
</PromotionHelp></div><aside className="promotion-review-preview"><PromotionPreview key={campaign.previewUrl ?? campaign.id} url={campaign.previewUrl} blocker={campaign.assetBlocker} language={language} /><div className="promotion-price"><del>{formatMoney(campaign.basePrice)}</del><strong>{formatMoney(campaign.unitPrice)}</strong><span>{campaign.bundle?.discountLabel??`−${campaign.discountPercent}%`}</span></div><p>{status(campaign.state)} · v{campaign.version} · {text('สต็อกที่ตรวจ', 'Reviewed stock')}: {campaign.stockSnapshot}</p></aside>
          {!editScopeConfirmed && campaign.state === 'DRAFT' && <p className="notice">{text('ตรวจแบบร่างเดิมเท่านั้น หากจะแก้ เลือกเครื่องบนผังแล้วเลือกขอบเขตแบบร่างใหม่ หรือเปิดแบบร่างจากงานสร้างใหม่ที่ยืนยันแล้ว', 'Existing draft is review-only. To edit, inspect a screen and explicitly choose a new draft scope, or open a draft from a newly requested generation job.')}</p>}
          {manage && campaign.scope && campaign.state === 'DRAFT' && <form onSubmit={event => { event.preventDefault(); if (!editScopeConfirmed || !discountValid) return; void action(() => mutate(`/promotions/${campaign.id}`, { expectedVersion: editVersion, ...edit }, 'PATCH')); }}><fieldset disabled={locked || !fresh || !editScopeConfirmed || campaign.state !== 'DRAFT' || staleEdit}><label>{text('หัวข้อ', 'Headline')}<input value={edit.headline} maxLength={80} required onChange={event => { setEdit({ ...edit, headline: event.target.value }); setPreviewVersion(undefined); setApproveConfirmed(false); }} /></label><label>{text('ข้อความ', 'Promotion copy')}<textarea value={edit.copy} maxLength={180} required onChange={event => { setEdit({ ...edit, copy: event.target.value }); setPreviewVersion(undefined); setApproveConfirmed(false); }} /></label><div className="promotion-form-grid">{campaign.bundle?<BundlePriceEditor key={campaign.id} base={campaign.basePrice} value={edit.bundleUnitMinor??campaign.unitPrice.amountMinor} language={language} onChange={(minor,valid)=>{setDiscountValid(valid);setEdit({...edit,bundleUnitMinor:minor});setPreviewVersion(undefined);setApproveConfirmed(false);}}/>:<PromotionDiscount key={campaign.id} base={campaign.basePrice} percent={edit.discountPercent} cap={campaign.maxDiscountPercent} language={language} onValidity={setDiscountValid} onChange={percent => { setEdit({ ...edit, discountPercent: percent }); setPreviewVersion(undefined); setApproveConfirmed(false); }} />}<label>{text('เริ่มเมื่อ', 'Draft starts at')}<input type="datetime-local" value={localTime(edit.startsAt)} onChange={event => { if (event.target.value) { setEdit({ ...edit, startsAt: new Date(event.target.value).toISOString() }); setPreviewVersion(undefined); setApproveConfirmed(false); } }} required /></label><label>{text('หมดอายุเมื่อ', 'Draft expires at')}<input type="datetime-local" value={localTime(edit.expiresAt)} onChange={event => { if (event.target.value) { setEdit({ ...edit, expiresAt: new Date(event.target.value).toISOString() }); setPreviewVersion(undefined); setApproveConfirmed(false); } }} required /></label></div><button disabled={!dirty || !discountValid}>{text('บันทึกแบบร่าง ไม่ส่งจอ', 'Save draft · no publication')}</button></fieldset></form>}
          {(staleEdit || dirty) && <p className="notice">{text('มีการแก้ไขหรือเวอร์ชันเปลี่ยน บันทึก / โหลดล่าสุดก่อนพรีวิวและอนุมัติ', 'Unsaved edits or a changed version. Save or reload before preview and approval.')}</p>}
          <div className="toolbar"><button className="secondary" disabled={locked} onClick={() => select(campaign, editScopeConfirmed)}>{text('โหลดล่าสุด แทนที่ข้อความแก้ไข', 'Reload latest · replace edits')}</button>{manage && campaign.scope && campaign.state === 'DRAFT' && <button className="secondary" disabled={locked || !fresh || !discountValid || dirty || staleEdit} onClick={() => void action(() => mutate(`/promotions/${campaign.id}/preview`, { expectedVersion: campaign.version }))}>{text('รีเฟรชพรีวิว ราคาและสต็อก', 'Refresh preview, price & stock')}</button>}</div>
          {manage && campaign.scope && campaign.state === 'DRAFT' && <div className="promotion-approval"><PromotionHelp label={text('วิธีอนุมัติแบบร่าง', 'How to approve a draft')}><p>{text('กดรีเฟรชพรีวิว แล้วตรวจภาพ ราคา สต็อก เวลา และข้อมูลที่ AI ใช้ ก่อนติ๊กยืนยันและอนุมัติ การอนุมัติยังไม่ส่งขึ้นจอ', 'Refresh the preview, then check the photo, prices, stock, timing and AI context before confirming approval. Approval does not send to screens.')}</p></PromotionHelp><label><input type="checkbox" checked={approveConfirmed} disabled={locked || !discountValid || dirty || staleEdit || previewVersion !== campaign.version || expired} onChange={event => setApproveConfirmed(event.target.checked)} />{text('ตรวจพรีวิวล่าสุดแล้ว', 'I reviewed the latest preview.')}</label><button disabled={locked || !fresh || !discountValid || dirty || staleEdit || previewVersion !== campaign.version || !approveConfirmed || expired} onClick={() => void action(() => mutate(`/promotions/${campaign.id}/approve`, { expectedVersion: campaign.version }))}>{text('อนุมัติแบบร่าง ยังไม่ส่งจอ', 'Approve draft · do not send')}</button></div>}
          {approved && <PromotionHelp label={text('การแก้ไขหลังอนุมัติ', 'Editing after approval')}><p className="promotion-caption">{text('เวอร์ชันที่อนุมัติแล้วแก้ไขหรือสร้างภาพใหม่ไม่ได้ หากข้อมูลเปลี่ยนต้องสร้างและตรวจแบบร่างใหม่', 'The approved revision is immutable. Changed data requires a new draft and review, not an edit or new asset on this revision.')}</p></PromotionHelp>}
        </section>
        {campaign.scope && <PromotionPublication key={`${campaign.id}:${campaign.version}:${publicationEpoch}`} campaign={campaign} devices={view?.devices ?? []} language={language} disabled={locked || !fresh || !approved || dirty || staleEdit || expired} publish={body => action(() => mutate(`/promotions/${campaign.id}/publish`, body))} />}
        {campaign.scope && (!approved || expired) && <p className="notice">{expired ? text('แคมเปญหมดอายุแล้ว ส่งไม่ได้', 'Campaign expired. Sending is disabled.') : text('ต้องให้เจ้าของหรือผู้จัดการอนุมัติก่อนส่ง', 'Owner or Manager approval is required before sending.')}</p>}
        {campaign.targets.length > 0 && <section className="panel" aria-label="Published target previews">
          <h2>{text('พรีวิวของจอที่ยืนยันส่งแล้ว', 'Published target previews')}</h2>
          <p>{text('ภาพแต่ละเป้าหมายใช้ QR และลิงก์เมนูเฉพาะเป้าหมายนั้น ไม่ใช้ภาพแบบร่างแทน และไม่ถือเป็นหลักฐานว่าจอแสดงแล้ว', 'Each target preview contains its own scoped menu QR. The draft image is not a substitute, and a preview does not prove the screen rendered.')}</p>
          {campaign.targets.map(item => <div key={item.id} className="promotion-target" data-preview-target={item.id}>
            <h3>{view?.devices.find(device => device.deviceId === item.targetDeviceId)?.label ?? item.targetDeviceId}</h3>
            <PromotionPreview key={item.previewUrl ?? item.id} url={item.previewUrl} blocker={item.failure} language={language} />
            <p className="promotion-caption">480 × 320 · {status(item.state)}</p>
          </div>)}
        </section>}
        <section className="panel" aria-label="Promotion delivery lifecycle"><div className="promotion-section-title"><h2>{text('การส่งและการแสดงผล', 'Delivery & rendering')}</h2><PromotionHelp label={text('สถานะการส่งหมายถึงอะไร', 'About delivery status')}><p>{text('แยกผลรายเครื่อง การส่งถึงเครื่องไม่เท่ากับแสดงผล ACK ของเครื่องเดียวไม่ยืนยันว่าแสดงครบ', 'Results are per device. Delivered is not rendered; one device ACK does not prove all screens rendered.')}</p></PromotionHelp></div>
          {campaign.scope ? (campaign.playlistTargets ?? []).map(item => <article className="promotion-delivery" key={item.id}><strong>{view?.devices.find(device => device.deviceId === item.deviceId)?.label ?? item.deviceId}</strong><span className="badge" data-promotion-state={item.state}>{status(item.state)}</span><small>v{item.campaignVersion} · {text('แคมเปญหมดอายุ', 'Campaign expires')}: {new Date(campaign.expiresAt).toLocaleString(language)}</small>{item.renderedAt && <small>{text('เครื่องนี้ยืนยันแสดงเมื่อ', 'This device rendered at')}: {new Date(item.renderedAt).toLocaleString(language)}</small>}{item.failure && <small>{text('เหตุผลจากเซิร์ฟเวอร์', 'Server reason')}: {item.failure}</small>}</article>) : campaign.targets.map(item => <article className="promotion-delivery" key={item.id}><strong>{view?.devices.find(device => device.deviceId === item.targetDeviceId)?.label ?? item.targetDeviceId}</strong><span className="badge" data-promotion-state={item.state}>{status(item.state)}</span><small>{text('หมดอายุ', 'Expires')}: {new Date(item.expiresAt).toLocaleString(language)}</small><small>{item.assignmentGeneration} / {item.authGeneration} / {item.screenGeneration}</small>{item.failure && <small>{item.failure}</small>}</article>)}
          {campaign.scope && !campaign.playlistTargets?.length && <p className="promotion-caption">{text('ยังไม่มีผลส่งรายเครื่องจากเซิร์ฟเวอร์ ไม่ถือว่าแสดงแล้ว', 'No per-device publication results returned by the server yet. Rendering is not assumed.')}</p>}
          {manage && campaign.scope && <button className="secondary" disabled={locked || !fresh || campaign.state === 'REVOKED'} onClick={()=>revokeCampaign(campaign)}>{text('เพิกถอนแคมเปญนี้และเป้าหมายเดิม', 'Revoke this campaign and its original targets')}</button>}
          <PromotionHelp label={text('การยกเลิกโปรโมชัน', 'About revocation')}><p className="promotion-safety">{text('เพิกถอนเฉพาะแคมเปญนี้ ไม่ย้ายเครื่อง ไม่เปลี่ยนยอดบิลที่สร้างแล้ว และไม่แก้ราคาปกติในแค็ตตาล็อก', 'Revocation is scoped to this campaign. It does not retarget, rewrite frozen bills or change catalog base prices.')}</p></PromotionHelp>
        </section>
      </fieldset></section>}
  </>;
  const recovery = <>
    {record?.pending && <section className="promotion-pending" role="status"><strong>{text('ยังไม่ทราบผลคำขอเดิม', 'Saved action · outcome unknown')}</strong><p>{text('ตรวจสอบด้วยคำขอและคีย์เดิมเท่านั้น ไม่มีส่งซ้ำอัตโนมัติ', 'Only the exact saved action and key can be retried. Nothing is resent automatically.')}</p><button disabled={busy} onClick={() => void action(async () => { const next = await journal.current!.load(); saved.current = next; setRecord(next); if (next.pending) await send(next.pending); })}>{text('ตรวจสอบ / ลองคำขอเดิม', 'Resolve / retry exact action')}</button></section>}
  </>;
  return <main className="promotions-workspace" aria-label="Promotions workspace" data-presentation={presentation}>
    <header className="promotion-heading"><div><h1>{presentation === 'review' ? text('ตรวจร่างแคมเปญ', 'Review campaign') : presentation === 'create' ? text('สร้างโปรโมชัน', 'Create promotion') : text('โปรโมชัน', 'Promotions')}</h1><p>{presentation === 'library' ? text('จัดการแคมเปญของคุณในที่เดียว', 'Manage your campaigns in one place.') : text('เลือกประจำวัน ลูกค้า หรือจากออเดอร์ สร้างแบบร่าง ตรวจสอบ แล้วจึงยืนยันส่ง', 'Choose daily, customer or from-order. Generate a draft, review it, then explicitly confirm publication.')}</p></div><button className="secondary" disabled={busy} onClick={() => void action(async () => { await refresh(); await refreshRecipients(); })}>{text('รีเฟรชสถานะ', 'Refresh promotions')}</button></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!fresh && <p className="notice" role="status">{text('สถานะยังไม่เป็นปัจจุบัน ปิดการส่งจนกว่าจะเชื่อมต่อได้', 'Status is not current. Sending is disabled until refreshed.')}</p>}
    {!floorSelection && recovery}
    {presentation === 'create' && <><PromotionQueues session={session} devices={view?.devices??[]} campaigns={view?.campaigns??[]} language={language} inspect={deviceId=>setFloorSelection({kind:'device',deviceId})}/>
    <PromotionFloor revoke={revokeCampaign} session={session} language={language} tables={tables} devices={devices} promotionDevices={view?.devices ?? []} registryCurrent={registryCurrent} promotionsCurrent={fresh} selection={floorSelection} setSelection={setFloorSelection} onCurrentChange={setInspectionCurrent} disabled={locked} configured={!!view?.provider.configured} openCampaign={openCampaign} derive={(source, body) => action(async () => {
      if (dirty && !window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึกและสร้างแบบร่างใหม่?', 'Discard unsaved edits and create a new draft?'))) return;
      await mutate(`/promotions/${encodeURIComponent(source.id)}/derive`, { ...body, ...(body.mode === 'regenerate' ? { language } : {}) });
    })} refresh={async () => { setApproveConfirmed(false); setPreviewVersion(undefined); setPublicationEpoch(epoch => epoch + 1); recipientsEpoch.current += 1; setRecipientsFresh(false); await refreshRegistry(); await refresh(); await refreshRecipients(); }}>{floorSelection && <>{error && <p className="error" role="alert">{error}</p>}{recovery}<div className="promotion-content">{editor}</div></>}</PromotionFloor></>}
    {presentation === 'library' && <div className="promotion-layout"><section id="campaign-library" className="promotion-library panel" aria-label="Campaign library">
      <div className="promotion-library-heading"><div><p className="eyebrow">P33 · {text('โปรโมชัน', 'Promotions')}</p><h2>{text('คลังแคมเปญ', 'Campaign library')}</h2><p>{text('ค้นหา เลือก และตรวจร่างก่อนดำเนินการ', 'Search, select and review drafts before taking action.')}</p></div></div>
      <div className="promotion-library-toolbar"><label className="promotion-search">{text('ค้นหารายการ', 'Search campaigns')}<input ref={librarySearch} value={libraryQuery} placeholder={text('ค้นหารายการ', 'Search campaigns')} onChange={event => { setLibraryQuery(event.target.value); setLibraryPage(0); }} /></label>{manage && <button className="promotion-create" type="button" disabled={locked || !fresh} onClick={() => { setFloorSelection(null); setPresentation('create'); }}>＋ {text('สร้างโปรโมชัน', 'Create promotion')}</button>}<div className="promotion-library-tabs" role="group" aria-label={text('ตัวกรองแคมเปญ', 'Campaign filters')}>
        {(['all', 'DRAFT', 'APPROVED', 'history'] as const).map(tab => <button className="secondary" key={tab} aria-pressed={libraryTab === tab} onClick={() => { setLibraryTab(tab); setLibraryPage(0); }}>{tab === 'all' ? text('ทั้งหมด', 'All') : tab === 'DRAFT' ? text('ฉบับร่าง', 'Drafts') : tab === 'APPROVED' ? text('อนุมัติแล้ว', 'Approved') : text('ประวัติ', 'History')}</button>)}
      </div></div>
      {(() => {
        const query = libraryQuery.trim().toLocaleLowerCase();
        const items = (view?.campaigns ?? []).filter(item => {
          const inTab = libraryTab === 'all' || (libraryTab === 'history' ? !['DRAFT', 'APPROVED'].includes(item.state) : item.state === libraryTab);
          return inTab && (!query || [item.headline, item.copy, status(item.state)].some(value => value.toLocaleLowerCase().includes(query)));
        });
        const page = Math.min(libraryPage, Math.max(0, Math.ceil(items.length / 6) - 1));
        return <><p className="promotion-caption">{items.length} {text('รายการ', 'campaigns')}</p>
          <div className="promotion-library-table" role="list">
            <div className="promotion-library-columns" aria-hidden="true"><span>{text('รายการ', 'Campaign')}</span><span>{text('รายละเอียด', 'Details')}</span><span>{text('สถานะ', 'Status')}</span><span>{text('หมดอายุ', 'Expires')}</span></div>
            {!fresh ? <p className="promotion-library-state" role="status">{text('กำลังโหลดรายการจากเซิร์ฟเวอร์', 'Loading campaigns from the server…')}</p> : !items.length ? <p className="promotion-library-state">{query ? text('ไม่พบรายการที่ตรงกับการค้นหา', 'No campaigns match this search.') : text('ยังไม่มีรายการในหมวดนี้', 'No campaigns in this filter.')}</p> : items.slice(page * 6, page * 6 + 6).map(item => <article className="promotion-library-card" key={item.id}>
              <button className="promotion-library-item secondary" aria-pressed={selectedId === item.id} disabled={locked} onClick={() => openCampaign(item)}><strong>{item.headline}</strong><small>{item.copy}</small><span className="promotion-library-status">{status(item.state)}</span><time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleDateString(language)}</time></button>
              {manage && item.state === 'DRAFT' && !item.targets.length && !item.playlistTargets?.length && <button className="promotion-delete secondary" disabled={locked || !fresh} aria-label={text(`ลบแบบร่าง ${item.headline}`, `Delete draft ${item.headline}`)} onClick={() => {
                if (!window.confirm(text('ลบแบบร่างนี้ออกจากรายการ? ประวัติจะเก็บไว้ และไม่มีการส่งไปหน้าจอ', 'Remove this draft? Its history is retained and nothing is sent to screens.'))) return;
                void action(async () => { await mutate(`/promotions/${item.id}/revoke`, { expectedVersion: item.version }); });
              }}>{text('ลบแบบร่าง', 'Delete draft')}</button>}
            </article>)}
          </div>
          {items.length > 6 && <div className="promotion-pagination"><button className="secondary" disabled={page === 0} onClick={() => setLibraryPage(page - 1)}>{text('ก่อนหน้า', 'Previous')}</button><span>{page + 1} / {Math.ceil(items.length / 6)}</span><button className="secondary" disabled={(page + 1) * 6 >= items.length} onClick={() => setLibraryPage(page + 1)}>{text('ถัดไป', 'Next')}</button></div>}
        </>;
      })()}
      <details className="promotion-job-history"><summary>{text('ประวัติการสร้าง', 'Generation history')} ({view?.jobs.length ?? 0})</summary>
        {(showAllJobs ? view?.jobs : view?.jobs.slice(0, 5))?.map(job => <div className="promotion-job" key={job.id}><strong>{status(job.state)}</strong><small>{new Date(job.createdAt).toLocaleString(language)}</small>{job.blocker && <p>{text('สร้างไม่สำเร็จ', 'Generation failed')}: {job.blocker}</p>}{job.campaignId && <button className="secondary" disabled={locked} onClick={() => { const result = view?.campaigns.find(item => item.id === job.campaignId); if (result && (!dirty || window.confirm(text('ทิ้งข้อความที่ยังไม่บันทึก?', 'Discard unsaved edits?')))) openCampaign(result); }}>{text('เปิดรายการ', 'Open result')}</button>}</div>)}
        {(view?.jobs.length ?? 0) > 5 && <button className="secondary" onClick={() => setShowAllJobs(!showAllJobs)}>{showAllJobs ? text('แสดงน้อยลง', 'Show less') : text('ดูเพิ่มเติม', 'Show more')}</button>}
      </details>
    </section></div>}
    {presentation === 'create' && <section id="promotion-generate" className="panel promotion-create-stage" aria-label="Generate promotion"><button className="secondary" type="button" onClick={() => { setFloorSelection(null); setPresentation('library'); }}>{text('กลับไปคลังโปรโมชัน', 'Back to campaign library')}</button><h2>{text('สร้างโปรโมชัน', 'Create promotion')}</h2>{view?.jobs.filter(job => job.id === activeJobId).map(job => <section className="promotion-job" key={job.id} aria-label="Requested draft job"><h3>{status(job.state)}</h3>{job.blocker && <p className="notice">{job.blocker}</p>}{job.campaignId && <button className="secondary" disabled={locked} onClick={() => { const result = view.campaigns.find(c => c.id === job.campaignId); if (result) { setFloorSelection(null); select(result, true); setPresentation('review'); } }}>{text('เปิดรายการ', 'Open result')}</button>}</section>)}
      {manage ? <>{view && !view.provider.configured && <p className="promotion-blocker" role="status">{text('ยังไม่ได้ตั้งค่า AI: ต้องมีผู้ให้บริการ โมเดล คีย์ส่วนตัว และงบประมาณที่อนุมัติบนเซิร์ฟเวอร์ ขณะนี้ไม่เรียกโมเดลและไม่สร้างข้อความ AI จำลอง แบบร่างเดิมยังตรวจสอบและจัดการได้', 'AI is not configured: server provider, model, private credential and approved budgets are required. No model call or fabricated AI copy is made. Existing drafts remain reviewable.')}</p>}
      <PromotionGenerate devices={view?.devices??[]} language={language} products={products} disabled={locked || !fresh || !view?.provider.configured} recipients={recipients} recipientsFresh={recipientsFresh} recipientsError={recipientsError} reloadRecipients={() => { void refreshRecipients(); }} generate={body => action(() => mutate('/promotions/generate', body))} seatCustomer={async body=>{
        const result=await api<{visitId:string}>('/promotions/recipients/seat',body,session.token);
        recipientsEpoch.current+=1;setRecipientsFresh(false);
        const next=personalRecipientsView.parse(await api<unknown>('/promotions/recipients',undefined,session.token));
        setRecipients(next);setRecipientsFresh(true);setRecipientsError('');recipientsLoadedAt.current=Date.now();
        await refreshRegistry();return result;
      }} /><PromotionHelp label={text('หลังสร้างแบบร่าง', 'After creating a draft')}><p>{text('ตรวจแบบร่างและอนุมัติก่อนส่งขึ้นจอ', 'Review and approve before sending to screens.')}</p></PromotionHelp></> : <p className="notice">{text('พนักงานส่งได้เฉพาะแคมเปญที่อนุมัติแล้ว การสร้าง แก้ไข อนุมัติ และยกเลิกเป็นสิทธิ์เจ้าของ/ผู้จัดการ', 'Staff can send approved campaigns only. Generating, editing, approving and revoking require Owner or Manager.')}</p>}
    </section>}
    {presentation === 'review' && !floorSelection && editor}
  </main>;
}
