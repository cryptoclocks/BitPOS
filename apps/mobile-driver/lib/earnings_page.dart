import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'payout_beneficiary_page.dart';
import 'presentation/driver_presentation.dart';

/// R16/R17/R18. Amounts and payout state are only server-owned projections.
class DriverEarningsPage extends StatefulWidget {
  const DriverEarningsPage({super.key, required this.api, required this.thai});

  final MobileApi api;
  final bool thai;

  @override
  State<DriverEarningsPage> createState() => _DriverEarningsPageState();
}

class _DriverEarningsPageState extends State<DriverEarningsPage>
    with WidgetsBindingObserver {
  final List<SettlementEarningItem> _items = [];
  final ScrollController _scroll = ScrollController();
  final List<({int view, String? batchId, double offset})> _viewTrail = [];
  SettlementDriverPage? _page;
  bool _busy = false, _retired = false, _stale = false;
  Object? _error;
  int _generation = 0, _view = 0;
  String? _statementBatchId;
  late final Object? _owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? _ownerChanges;

  String t(String th, String en) => widget.thai ? th : en;

  void _showView(int view, {String? batchId}) {
    final selectedBatchId = view == 2 ? batchId ?? _statementBatchId : null;
    if (_view == view && (view != 2 || selectedBatchId == _statementBatchId)) return;
    _viewTrail.add((
      view: _view,
      batchId: _statementBatchId,
      offset: _scroll.hasClients ? _scroll.offset : 0,
    ));
    setState(() {
      _view = view;
      if (view == 2) _statementBatchId = selectedBatchId;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  void _backView() {
    if (_viewTrail.isEmpty) {
      Navigator.of(context).maybePop();
      return;
    }
    final previous = _viewTrail.removeLast();
    setState(() {
      _view = previous.view;
      _statementBatchId = previous.batchId;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients) return;
      _scroll.jumpTo(previous.offset.clamp(0, _scroll.position.maxScrollExtent));
    });
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ownerChanges = widget.api.sessionScopes.listen((owner) {
      if (owner != _owner && mounted) {
        _generation++;
        setState(() {
          _retired = true;
          _busy = false;
          _items.clear();
          _page = null;
          _statementBatchId = null;
        });
      }
    });
    unawaited(_load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      setState(() => _stale = true);
      unawaited(_load());
    } else if (state != AppLifecycleState.resumed) {
      _generation++;
      setState(() {
        _items.clear();
        _page = null;
        _statementBatchId = null;
        _stale = true;
        _busy = false;
      });
    }
  }

  Future<void> _load({bool more = false}) async {
    if (_busy || _retired) return;
    final generation = ++_generation;
    if (widget.api.sessionScope != _owner || !widget.api.signedIn) {
      setState(() {
        _retired = true;
        _items.clear();
        _page = null;
        _statementBatchId = null;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _stale = true;
      if (!more) {
        _items.clear();
        _page = null;
        _statementBatchId = null;
      }
    });
    try {
      final page = await widget.api.driverEarnings(
        afterId: more ? _page?.nextAfterId : null,
      );
      if (!mounted || generation != _generation) return;
      if (widget.api.sessionScope != _owner) {
        setState(() {
          _retired = true;
          _items.clear();
          _page = null;
          _statementBatchId = null;
        });
        return;
      }
      final known = _items.map((item) => item.accrualId).toSet();
      if (page.items.any((item) => known.contains(item.accrualId))) {
        throw const FormatException('Repeated earning cursor');
      }
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _page = page;
        _stale = false;
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() {
          _error = error;
          _stale = true;
          if (!widget.api.signedIn || widget.api.sessionScope != _owner) {
            _retired = true;
            _items.clear();
            _page = null;
            _statementBatchId = null;
          }
        });
      }
    } finally {
      if (mounted && generation == _generation) setState(() => _busy = false);
    }
  }

  String money(MobileMoney value) =>
      formatMinorUnits(value.amountMinor, value.decimals, value.currency);
  String assetIdentity(SettlementAsset asset) =>
      '${asset.displayLabel} · ${asset.cluster} · ${asset.issuerTestAsset ? t('สินทรัพย์ทดสอบ', 'Test asset') : t('สินทรัพย์', 'Asset')}';

  String state(String value) => switch (value) {
    'ACCRUED' => t('ภาระรายได้จากงานสำเร็จ', 'Delivered earning obligation'),
    'HELD' => t('พักสิทธิ์การจ่ายตามการตรวจสอบ', 'Eligibility held for review'),
    'AVAILABLE' => t('ผ่านเกณฑ์การจ่าย — ไม่ใช่เงินโอนแล้ว', 'Eligible — not transferred'),
    'RESERVED' => t('กันสิทธิ์รอบจ่ายแล้ว — ยังไม่ยืนยันโอน', 'Reserved — no verified transfer'),
    'SETTLED' => t('ยืนยันการจ่ายขั้นสุดท้ายแล้ว', 'Finalized verified settlement'),
    'DRAFT' => t('ร่างรอบจ่าย รออนุมัติ', 'Draft awaiting approval'),
    'SIGNING' => t('เตรียมรายการที่ระบุตัวตนแล้ว', 'Preparing allocated transaction'),
    'PREPARED' => t('บันทึกรายการแล้ว ยังไม่ยืนยันโอน', 'Transaction saved, not confirmed'),
    'SUBMITTED' => t('ส่งรายการแล้ว ต้องตรวจสอบผล', 'Submitted, reconciliation required'),
    'UNKNOWN' => t('ยังไม่ทราบผล ห้ามสร้างรายการทดแทน', 'Outcome unknown; replacement prohibited'),
    'CONFIRMED' => t('ตรวจสอบการโอนขั้นสุดท้ายแล้ว', 'Finalized transfer verified'),
    'FAILED' => t('ตรวจสอบล้มเหลว ปล่อยสิทธิ์เพื่อรอบใหม่', 'Verified failure; released for a new batch'),
    'CANCELLED' => t('ยกเลิกเฉพาะร่างรอบจ่าย', 'Draft cancelled'),
    'REVERSED' => t('กลับรายการบัญชีแล้ว', 'Accounting reversed'),
    _ => value,
  };

  String readiness(String value) => switch (value) {
    'CLOSED' => t('รอบจ่ายสิ้นสุดแล้ว สถานะนี้อย่างเดียวไม่ใช่หลักฐานโอน', 'Batch closed; closure alone is not transfer proof'),
    'BENEFICIARY_PENDING' => t('รอตรวจสอบสิทธิ์เจ้าของกระเป๋าผู้รับ', 'Beneficiary ownership verification pending'),
    'PROVIDER_UNAVAILABLE' => t('ผู้ให้บริการยังไม่พร้อมหรือตั้งค่าไม่ครบ ยังไม่โอน', 'Provider unavailable or unconfigured; not transferred'),
    'AWAITING_APPROVAL' => t('รออนุมัติกันสิทธิ์ทางบัญชี ยังไม่โอน', 'Awaiting accounting reserve approval; not transferred'),
    'VERIFIED_FUNDING_REQUIRED' => t('ต้องมีเงินทุนที่ตรวจสอบแล้ว ยอดภาระบัญชีไม่ใช่เงินพร้อมโอน', 'Verified funding required; payable obligations are not liquidity'),
    'FUNDING_RECONCILIATION_REQUIRED' => t('ต้องตรวจสอบกระทบยอดเงินทุน ห้ามอนุมานว่าโอนแล้วหรือพร้อมจ่ายใหม่', 'Funding reconciliation required; do not infer payment or replacement readiness'),
    'SOURCE_RECONCILIATION_REQUIRED' => t('ต้องตรวจสอบผลจ่ายเดิมที่ขัดแย้ง ห้ามอนุมานว่าโอนแล้วหรือพร้อมจ่ายใหม่', 'Source reconciliation required after contradictory prior payment evidence; do not infer payment or replacement readiness'),
    'AWAITING_SIGNATURE' => t('รอผู้ปฏิบัติงานลงนาม ยังไม่ถือว่าจ่ายแล้ว', 'Awaiting worker signature; not paid'),
    'READY_FOR_INITIAL_BROADCAST' => t('พร้อมส่งรายการที่กำหนด ยังไม่ยืนยันโอน', 'Ready for initial broadcast; not transfer confirmation'),
    'EXACT_REBROADCAST_OR_RECONCILIATION_ONLY' => t('ส่งซ้ำได้เฉพาะรายการเดิมหรือตรวจสอบผล ห้ามสร้างรายการทดแทน', 'Exact rebroadcast or reconciliation only; never a replacement transfer'),
    _ => value,
  };

  List<SettlementSummary> get _batches {
    final batches = <String, SettlementSummary>{};
    for (final item in _items) {
      final batch = item.settlement;
      if (batch != null) batches[batch.batchId] = batch;
    }
    return batches.values.toList(growable: false);
  }

  Color _statusColor(BuildContext context, String value) => switch (value) {
    'SETTLED' || 'CONFIRMED' => Colors.green.shade700,
    'FAILED' || 'UNKNOWN' => Theme.of(context).colorScheme.error,
    _ => Theme.of(context).colorScheme.primary,
  };

  Widget _surface(BuildContext context, Widget child, {VoidCallback? onTap}) {
    final theme = Theme.of(context);
    final content = Padding(padding: const EdgeInsets.all(18), child: child);
    return Material(
      color: theme.colorScheme.surface,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Ink(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: theme.colorScheme.outlineVariant),
          ),
          child: content,
        ),
      ),
    );
  }

  Widget _chip(BuildContext context, String label, String value) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    decoration: BoxDecoration(
      color: _statusColor(context, value).withValues(alpha: .10),
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      label,
      style: TextStyle(color: _statusColor(context, value), fontSize: 12),
    ),
  );

  Widget _earning(BuildContext context, SettlementEarningItem item) => _surface(
    context,
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              foregroundColor: Theme.of(context).colorScheme.primary,
              child: const Icon(Icons.account_balance_wallet_outlined),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(t('รายการรายได้', 'Earning record'), style: Theme.of(context).textTheme.titleMedium)),
            Text(money(item.money), style: Theme.of(context).textTheme.titleMedium?.copyWith(color: Theme.of(context).colorScheme.primary)),
          ],
        ),
        const SizedBox(height: 14),
        _chip(context, state(item.state), item.state),
        const SizedBox(height: 10),
        Text('${t('บันทึกเมื่อ', 'Recorded')}: ${DateTime.parse(item.createdAt).toLocal()}'),
        if (item.payout case SettlementPayoutAvailable payout) ...[
          const SizedBox(height: 6),
          Text('${t('จำนวนตามนโยบายที่บันทึก', 'Recorded policy amount')}: ${money(payout.payoutMoney)} · ${assetIdentity(payout.asset)}'),
        ] else if (item.payout case SettlementPayoutSetupRequired _) ...[
          const SizedBox(height: 6),
          Text(t('ข้อมูลการแปลงหน่วยเดิมยังไม่พร้อม ไม่ประมาณยอดจ่าย', 'Original denomination evidence unavailable; no estimated payout')),
        ],
        if (item.eligibilityDecision != null) ...[
          const SizedBox(height: 6),
          Text('${t('การตรวจเกณฑ์ล่าสุด', 'Latest eligibility review')}: ${item.eligibilityDecision!.decision}'),
        ],
        const SizedBox(height: 6),
        Material(
          color: Colors.transparent,
          child: ExpansionTile(
            key: ValueKey(item.accrualId),
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            title: Text(t('รายละเอียดรายการรายได้', 'Earning reference details')),
            children: [
              Align(alignment: Alignment.centerLeft, child: SelectableText('${t('งานส่ง', 'Delivery')}: ${item.assignmentId}')),
              const SizedBox(height: 8),
              Align(alignment: Alignment.centerLeft, child: SelectableText('${t('ออร์เดอร์', 'Order')}: ${item.orderId}')),
            ],
          ),
        ),
      ],
    ),
    onTap: item.settlement == null ? null : () => _showView(1),
  );

  Widget _payout(BuildContext context, SettlementSummary batch) => _surface(
    context,
    Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            CircleAvatar(
              backgroundColor: Theme.of(context).colorScheme.primaryContainer,
              foregroundColor: Theme.of(context).colorScheme.primary,
              child: const Icon(Icons.receipt_long_outlined),
            ),
            const SizedBox(width: 12),
            Expanded(child: Text(t('รอบจ่ายที่อ้างอิง', 'Referenced payout round'), style: Theme.of(context).textTheme.titleMedium)),
            const Icon(Icons.chevron_right),
          ],
        ),
        const SizedBox(height: 14),
        Text(money(batch.payoutMoney), style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Theme.of(context).colorScheme.primary, fontWeight: FontWeight.w700)),
        Text('${t('สินทรัพย์สำหรับรอบจ่าย', 'Payout asset')}: ${assetIdentity(batch.asset)}'),
        const SizedBox(height: 6),
        Text('${t('ภาระบัญชี', 'Accounting obligation')}: ${money(batch.money)}'),
        const SizedBox(height: 10),
        _chip(context, state(batch.state), batch.state),
        const SizedBox(height: 10),
        Text(readiness(batch.readiness)),
        const SizedBox(height: 8),
        Text(
          batch.receiptId == null
              ? t('ยังไม่มีหลักฐานการโอนขั้นสุดท้าย ยอดนี้ไม่ใช่ยอดเงินได้รับแล้ว', 'No finalized transfer receipt. This is not money received.')
              : '${t('หลักฐานที่ตรวจสอบแล้ว', 'Verified receipt')}: ${batch.receiptId}',
        ),
      ],
    ),
    onTap: _view == 2 ? null : () => _showView(2, batchId: batch.batchId),
  );

  Widget _hero(BuildContext context, List<SettlementSummary> batches) {
    final selected = _view == 2
        ? batches.where((batch) => batch.batchId == _statementBatchId).firstOrNull
        : batches.length == 1
        ? batches.single
        : null;
    final sameDenomination = _items.isNotEmpty && _items.every((item) =>
        item.money.currency == _items.first.money.currency &&
        item.money.decimals == _items.first.money.decimals);
    final obligation = sameDenomination
        ? formatMinorUnits(
            _items.fold<BigInt>(BigInt.zero, (sum, item) =>
                sum + BigInt.parse(item.money.amountMinor)).toString(),
            _items.first.money.decimals,
            _items.first.money.currency,
          )
        : null;
    final title = _view == 0
        ? t('ภาระรายได้ในหน้าที่โหลด', 'Loaded-page earning obligations')
        : selected != null
        ? t('ยอดอ้างอิงรอบจ่าย', 'Referenced payout amount')
        : t('รอบจ่ายที่อ้างอิง', 'Referenced payout rounds');
    final headline = _view == 0
        ? obligation ?? '${_items.length}'
        : selected == null ? '${batches.length}' : money(selected.payoutMoney);
    return Container(
      key: const ValueKey('driver-earnings-summary'),
      constraints: const BoxConstraints(minHeight: 149),
      padding: const EdgeInsets.all(21),
      decoration: BoxDecoration(color: Theme.of(context).colorScheme.primary, borderRadius: BorderRadius.circular(24)),
      child: DefaultTextStyle(
        style: Theme.of(context).textTheme.bodyMedium!.copyWith(color: Theme.of(context).colorScheme.onPrimary, height: 1.5),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(title, style: const TextStyle(fontSize: 14)),
          const SizedBox(height: 8),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(headline, style: const TextStyle(fontSize: 39, height: 1.2, fontWeight: FontWeight.w600)),
          ),
          const SizedBox(height: 8),
          Text(
            _view == 0 && obligation == null && _items.isNotEmpty
                ? t('หลายสกุลเงิน ดูยอดแยกด้านล่าง · ไม่ใช่เงินโอน', 'Mixed denominations: see separate amounts below; not a transfer')
                : t('ข้อมูลจากหน้าปัจจุบัน · ไม่ใช่ยอดเงินพร้อมถอนหรือเงินโอน', 'Current-page facts · not withdrawable or transferred funds'),
            style: const TextStyle(fontSize: 12),
          ),
        ]),
      ),
    );
  }

  Widget _earningStates(BuildContext context) {
    final counts = <String, int>{};
    final denominations = <String, ({MobileMoney unit, BigInt total})>{};
    for (final item in _items) {
      counts.update(item.state, (count) => count + 1, ifAbsent: () => 1);
      final key = '${item.money.currency}/${item.money.decimals}';
      final prior = denominations[key];
      denominations[key] = (
        unit: item.money,
        total: (prior?.total ?? BigInt.zero) + BigInt.parse(item.money.amountMinor),
      );
    }
    final stageNames = <String, String>{
      'ACCRUED': t('สะสม', 'Accrued'),
      'HELD': t('พักตรวจ', 'Held'),
      'AVAILABLE': t('ผ่านเกณฑ์', 'Eligible'),
      'RESERVED': t('กันรอบจ่าย', 'Reserved'),
      'SETTLED': t('ยืนยันจ่าย', 'Settled'),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (counts.isNotEmpty)
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final entry in counts.entries)
              _chip(context, '${stageNames[entry.key] ?? state(entry.key)} ${entry.value}', entry.key),
          ]),
        if (denominations.length > 1) ...[
          const SizedBox(height: 10),
          for (final entry in denominations.values)
            Text(
              formatMinorUnits(entry.total.toString(), entry.unit.decimals, entry.unit.currency),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
        ],
      ],
    );
  }

  Widget _tabs(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final labels = [
        t('รายได้', 'Earnings'),
        t('รอบจ่าย', 'Payouts'),
        t('รายละเอียด', 'Statement'),
      ];
      final stacked = constraints.maxWidth < 320 ||
          MediaQuery.textScalerOf(context).scale(14) > 16.8;
      if (stacked) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var index = 0; index < labels.length; index++) ...[
              if (index > 0) const SizedBox(height: 8),
              OutlinedButton(
                onPressed: () => _showView(index),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  backgroundColor: _view == index
                      ? Theme.of(context).colorScheme.secondaryContainer
                      : null,
                ),
                child: Text(labels[index], maxLines: 1),
              ),
            ],
          ],
        );
      }
      return Row(
        children: [
          for (var index = 0; index < labels.length; index++)
            Expanded(
              child: Semantics(
                selected: _view == index,
                child: TextButton(
                  onPressed: () => _showView(index),
                  style: TextButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    backgroundColor: _view == index
                        ? Theme.of(context).colorScheme.secondaryContainer
                        : null,
                  ),
                  child: Text(labels[index], maxLines: 1, softWrap: false),
                ),
              ),
            ),
        ],
      );
    },
  );

  Widget _grid(BuildContext context, List<Widget> cards) => LayoutBuilder(
    builder: (context, constraints) {
      final columns = constraints.maxWidth >= 760 ? 2 : 1;
      final width = (constraints.maxWidth - (columns - 1) * 16) / columns;
      return Wrap(
        spacing: 16,
        runSpacing: 16,
        children: [for (final card in cards) SizedBox(width: width, child: card)],
      );
    },
  );

  Widget _statement(BuildContext context, List<SettlementSummary> batches) {
    final batch = batches.where((value) => value.batchId == _statementBatchId).firstOrNull;
    if (batch == null) {
      return _surface(context, Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(t(
            'รอบที่เลือกไม่อยู่ในหน้าข้อมูลนี้ เลือกรอบจากหน้ารอบจ่ายอีกครั้ง',
            'The selected round is not in this loaded page. Choose a round from Payouts again.',
          )),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => _showView(1),
            child: Text(t('กลับไปรอบจ่าย', 'Back to payouts')),
          ),
        ],
      ));
    }
    final linked = _items.where((item) => item.settlement?.batchId == batch.batchId).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      _payout(context, batch),
      const SizedBox(height: 16),
      Text(t('รายการรายได้ที่อ้างอิงรอบนี้', 'Earnings referencing this round'), style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 12),
      if (linked.isEmpty)
        _surface(context, Text(t('รอบนี้ถูกอ้างอิงจากข้อมูลฝังในหน้าปัจจุบันเท่านั้น ไม่มี API รายละเอียดรอบแยกต่างหาก', 'This round is only an embedded current-page reference; no separate batch-detail API is available.')))
      else
        _grid(context, [for (final item in linked) _earning(context, item)]),
      const SizedBox(height: 12),
      Text(t('แสดงเลขอ้างอิงและหลักฐานที่เซิร์ฟเวอร์ส่งมาเท่านั้น ไม่รวมรายการข้ามหน้าและไม่สร้างข้อเท็จจริงของรอบจ่ายเพิ่ม', 'Only server-returned references and evidence are shown. Cross-page items are not included and no batch facts are invented.'), style: Theme.of(context).textTheme.bodySmall),
    ]);
  }

  @override
  Widget build(BuildContext context) => DriverPresentation(
    child: Builder(builder: (context) {
      final batches = _batches;
      final title = _view == 0 ? t('รายได้ของคุณ', 'Your earnings') : _view == 1 ? t('รอบโอนเงิน', 'Payouts') : t('รายละเอียดรอบโอน', 'Payout statement');
      return Scaffold(
        appBar: AppBar(
          toolbarHeight: 88 + (MediaQuery.textScalerOf(context).scale(20) - 20) * 2,
          leadingWidth: 76,
          titleSpacing: 0,
          leading: Padding(
            padding: const EdgeInsets.only(left: 18, right: 10, top: 12),
            child: Center(
              child: IconButton(
                tooltip: t('กลับ', 'Back'),
                onPressed: _backView,
                style: IconButton.styleFrom(
                  minimumSize: const Size(44, 44),
                  backgroundColor: Theme.of(context).colorScheme.surface,
                  foregroundColor: Theme.of(context).colorScheme.primary,
                  side: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                ),
                icon: const Icon(Icons.chevron_left, size: 22),
              ),
            ),
          ),
          title: Text(title, maxLines: 2, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 980),
              child: ListView(
                controller: _scroll,
                padding: const EdgeInsets.fromLTRB(24, 28, 24, 32),
                children: [
                  _hero(context, batches),
                  if (_view == 0 && _items.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    _earningStates(context),
                  ],
                  const SizedBox(height: 20),
                  _tabs(context),
                  const SizedBox(height: 20),
                  if (widget.api.fixture) Text(t('ข้อมูลในเครื่อง / AVD ไม่ใช่เงินโอนจริง', 'LOCAL / AVD FIXTURE — not a real transfer'), style: Theme.of(context).textTheme.bodySmall),
                  if (_busy) ...[const SizedBox(height: 12), const LinearProgressIndicator()],
                  if (_retired) Padding(padding: const EdgeInsets.only(top: 12), child: Text(t('เซสชันเปลี่ยนแล้ว กลับไปเข้าสู่ระบบใหม่', 'Session changed. Return and sign in again.'), key: const ValueKey('driver-earnings-retired'))),
                  if (_error != null) Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Semantics(liveRegion: true, child: Text(
                      _error is MobileApiException && (_error as MobileApiException).code == 'CONFIGURATION_REQUIRED'
                          ? t('บริการรายได้ยังไม่ได้ตั้งค่า', 'Earning service configuration unavailable')
                          : t('โหลดรายได้ไม่สำเร็จ ไม่อนุมานว่าไม่มีรายได้หรือชำระแล้ว', 'Earnings unavailable. Do not infer zero balance or successful payment.'),
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                    )),
                  ),
                  if (_stale && !_retired) Padding(padding: const EdgeInsets.only(top: 12), child: Text(t('ข้อมูลยังไม่ยืนยันล่าสุด กรุณาโหลดใหม่', 'Snapshot is stale or unconfirmed. Refresh.'))),
                  if (_page != null) ...[
                    const SizedBox(height: 16),
                    Text('${t('ข้อมูล ณ', 'Snapshot')}: ${DateTime.parse(_page!.snapshotAt).toLocal()}', style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 16),
                    if (_view == 0) ...[
                      Text(t('รายละเอียดรายได้', 'Earning details'), style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      if (_items.isEmpty) _surface(context, Text(t('ยังไม่มีภาระรายได้จากงานส่งสำเร็จ', 'No delivered earning obligations recorded.'))),
                      if (_items.isNotEmpty) _grid(context, [for (final item in _items) _earning(context, item)]),
                    ],
                    if (_view == 1) ...[
                      Text(t('รอบจ่ายจากรายการที่โหลด', 'Payout rounds in loaded entries'), style: Theme.of(context).textTheme.titleLarge),
                      const SizedBox(height: 12),
                      if (batches.isEmpty) _surface(context, Text(t('ยังไม่มีรอบจ่ายสำหรับรายการที่โหลด', 'No payout batch for the loaded earnings.'))),
                      if (batches.isNotEmpty) _grid(context, [for (final batch in batches) _payout(context, batch)]),
                    ],
                    if (_view == 2) _statement(context, batches),
                    const SizedBox(height: 18),
                    if (_page!.nextAfterId != null) OutlinedButton(onPressed: _busy || _retired ? null : () => _load(more: true), child: Text(t('หน้าถัดไป', 'Next page'))),
                    Text(t('แสดงข้อมูลปัจจุบันทีละหน้า เรียงตามรหัส ไม่ใช่ยอดรวมรายวัน โหลดใหม่เพื่อกลับหน้าแรกและพบรายการที่เพิ่มระหว่างเปิดหน้า', 'One observed page at a time, ordered by ID; not a daily total. Refresh returns to the first page and discovers concurrent additions.'), style: Theme.of(context).textTheme.bodySmall),
                    const SizedBox(height: 4),
                    Text(t('ภาระบัญชีและสิทธิ์จ่ายไม่ใช่เงินสดหรือเงินโอนแล้ว ไม่รวมสกุลเงินต่างกัน', 'Obligations and eligibility are not liquidity or transferred funds. Different currencies are not summed.'), style: Theme.of(context).textTheme.bodySmall),
                  ],
                  const SizedBox(height: 18),
                  OutlinedButton(onPressed: _retired ? null : () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PayoutBeneficiaryPage(api: widget.api, thai: widget.thai))), child: Text(t('ลงทะเบียน / ตรวจสอบกระเป๋ารับเงิน', 'Enroll / verify payout destination'))),
                  OutlinedButton(onPressed: _busy || _retired ? null : () => _load(), child: Text(t('โหลดข้อมูลเซิร์ฟเวอร์ใหม่', 'Refresh server snapshot'))),
                ],
              ),
            ),
          ),
        ),
      );
    }),
  );

  @override
  void dispose() {
    _generation++;
    unawaited(_ownerChanges?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    _scroll.dispose();
    super.dispose();
  }
}
