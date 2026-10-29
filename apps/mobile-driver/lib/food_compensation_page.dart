import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'presentation/driver_presentation.dart';

class DriverFoodCompensationPage extends StatefulWidget {
  const DriverFoodCompensationPage({
    super.key,
    required this.api,
    required this.assignmentId,
    required this.thai,
  });
  final MobileApi api;
  final String assignmentId;
  final bool thai;
  @override
  State<DriverFoodCompensationPage> createState() =>
      _DriverFoodCompensationPageState();
}

class _DriverFoodCompensationPageState extends State<DriverFoodCompensationPage>
    with WidgetsBindingObserver {
  FoodDriverCompensation? result;
  bool busy = false, retired = false;
  String? error;
  int generation = 0;
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (next != owner && mounted) {
        generation++;
        setState(() {
          retired = true;
          busy = false;
          result = null;
        });
      }
    });
  }

  @override
  void dispose() {
    generation++;
    WidgetsBinding.instance.removeObserver(this);
    unawaited(changes?.cancel());
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    if (state != AppLifecycleState.resumed) {
      generation++;
      setState(() {
        result = null;
        busy = false;
      });
    }
  }

  Future<void> load() async {
    if (busy || retired) return;
    if (owner == null ||
        widget.api.sessionScope != owner ||
        !widget.api.signedIn) {
      setState(() {
        retired = true;
        result = null;
      });
      return;
    }
    final run = ++generation;
    setState(() {
      busy = true;
      error = null;
      result = null;
    });
    try {
      final value = await widget.api.foodDriverCompensation(
        widget.assignmentId,
      );
      if (!mounted || run != generation) return;
      if (widget.api.sessionScope != owner || !widget.api.signedIn) {
        setState(() {
          retired = true;
          result = null;
        });
        return;
      }
      if (value.assignmentId != widget.assignmentId ||
          value.execution != null &&
              value.execution!.fundsTransferred !=
                  (value.execution!.state == 'FINALIZED')) {
        throw const FormatException('Compensation identity mismatch');
      }
      setState(() => result = value);
    } catch (e) {
      if (mounted && run == generation) {
        setState(() {
          result = null;
          error = t(
            'ตรวจค่าชดเชยไม่ได้ กรุณาลองอีกครั้ง',
            'Compensation unavailable. Try again.',
          );
          if (!widget.api.signedIn ||
              widget.api.sessionScope != owner ||
              e is MobileApiException &&
                  ['AUTH_REQUIRED', 'ROLE_REQUIRED'].contains(e.code)) {
            retired = true;
          }
        });
      }
    } finally {
      if (mounted && run == generation) setState(() => busy = false);
    }
  }

  String label(String state) => switch (state) {
    'NOT_DECIDED' => t('ยังไม่อนุมัติค่าชดเชย', 'Compensation not decided'),
    'ZERO_APPROVED' => t(
      'อนุมัติศูนย์ ไม่มีการโอน',
      'Zero compensation approved; no transfer',
    ),
    'PENDING' => t(
      'รอดำเนินการ ยังไม่ยืนยันโอน',
      'Compensation pending; transfer not confirmed',
    ),
    'FUNDING_REQUIRED' => t(
      'รอเงินสำรอง ยังไม่ยืนยันโอน',
      'Compensation funding required; transfer not confirmed',
    ),
    'PREPARED' => t(
      'เตรียมธุรกรรมแล้ว ยังไม่ยืนยันโอน',
      'Compensation prepared; transfer not confirmed',
    ),
    'UNKNOWN' => t(
      'ยังไม่ทราบผลโอน รอตรวจสอบ',
      'Compensation outcome unknown; reconciliation pending',
    ),
    'FINALIZED' => t(
      'ยืนยันโอนค่าชดเชยแล้ว',
      'Compensation finalized; transfer verified',
    ),
    'FAILED' => t(
      'การโอนล้มเหลว รอตรวจสอบ',
      'Compensation transfer failed; review required',
    ),
    _ => t(
      'ต้องตรวจสอบผลค่าชดเชย ยังไม่ยืนยันสำเร็จ',
      'Compensation requires reconciliation; completion unconfirmed',
    ),
  };
  @override
  Widget build(BuildContext context) => DriverPresentation(
    child: Scaffold(
      appBar: AppBar(
        title: Text(t('ค่าชดเชยงานคืนอาหาร', 'Returned food compensation')),
      ),
      body: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            t(
              'ค่าชดเชยแยกจากรายได้ส่งสำเร็จ ยอดอนุมัติไม่ใช่หลักฐานการโอน',
              'Compensation is separate from delivery earnings. Approval is not a transfer receipt.',
            ),
          ),
          const SizedBox(height: 16),
          if (retired)
            Text(t('กรุณาเข้าสู่ระบบใหม่', 'Sign in again'))
          else ...[
            if (busy) const LinearProgressIndicator(),
            if (error != null) Semantics(liveRegion: true, child: Text(error!)),
            if (result != null) ...[
              if (result!.execution == null)
                Text(
                  t('ยังไม่มีรายการค่าชดเชย', 'No compensation case recorded'),
                )
              else ...[
                Semantics(
                  liveRegion: true,
                  child: Text(
                    label(result!.execution!.state),
                    key: ValueKey('compensation-${result!.execution!.state}'),
                  ),
                ),
                if (result!.execution!.approvedAmount case final amount?)
                  Text(
                    '${t('ยอดอนุมัติ', 'Approved amount')}: ${formatMinorUnits(amount.amountMinor, amount.decimals, amount.currency)}',
                  ),
              ],
            ],
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy ? null : load,
              child: Text(t('ตรวจผลค่าชดเชย', 'Check compensation')),
            ),
          ],
        ],
      ),
    ),
  );
}
