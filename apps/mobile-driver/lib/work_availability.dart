import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/driver_mutation.dart';

import 'presentation/driver_presentation.dart';

/// Explicit server-CAS availability. Never starts GPS, claims work or auto-renews.
class WorkAvailability extends StatefulWidget {
  const WorkAvailability({super.key, required this.api, required this.thai});
  final MobileApi api;
  final bool thai;
  @override
  State<WorkAvailability> createState() => _WorkAvailabilityState();
}

class _WorkAvailabilityState extends State<WorkAvailability>
    with WidgetsBindingObserver {
  DriverProfile? profile;
  DriverMutation? pending;
  bool busy = false, stale = true, retired = false;
  String? error;
  int epoch = 0;
  Timer? timer;
  late final owner = widget.api.sessionScope;
  StreamSubscription<({String accountId, String sessionId})?>? changes;
  String t(String th, String en) => widget.thai ? th : en;
  bool get current =>
      mounted &&
      !retired &&
      widget.api.signedIn &&
      widget.api.sessionScope == owner;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    changes = widget.api.sessionScopes.listen((next) {
      if (next != owner && mounted) {
        epoch++;
        timer?.cancel();
        setState(() {
          retired = true;
          profile = null;
          pending = null;
          busy = false;
        });
      }
    });
    unawaited(load());
  }

  @override
  void dispose() {
    epoch++;
    timer?.cancel();
    unawaited(changes?.cancel());
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!mounted) return;
    epoch++;
    timer?.cancel();
    setState(() {
      stale = true;
      busy = false;
      profile = null;
    });
    if (state == AppLifecycleState.resumed && current) unawaited(load());
  }

  void adopt(DriverProfile? value) {
    profile = value;
    stale = value == null;
    timer?.cancel();
    if (value == null) return;
    final dates = [
      DateTime.parse(value.application.licenseExpiresAt),
      DateTime.parse(value.application.registrationExpiresAt),
      if (value.verifiedUntil != null) DateTime.parse(value.verifiedUntil!),
      if (value.availability.online &&
          value.availability.heartbeatExpiresAt != null)
        DateTime.parse(value.availability.heartbeatExpiresAt!),
    ];
    final until = dates.reduce((a, b) => a.isBefore(b) ? a : b),
        remaining = until.difference(DateTime.now());
    if (remaining <= Duration.zero) {
      stale = true;
    } else {
      timer = Timer(remaining, () {
        if (mounted) setState(() => stale = true);
      });
    }
  }

  Future<void> load({DriverMutation? command}) async {
    if (busy || !current) return;
    final run = ++epoch;
    setState(() {
      busy = true;
      if (command != null) pending = command;
      error = null;
      stale = true;
    });
    try {
      if (command != null) await widget.api.submitDriverMutation(command);
      final saved = await widget.api.pendingDriverMutation();
      if (!current || run != epoch) return;
      final result = await widget.api.driverProfile();
      if (!current || run != epoch) return;
      setState(() {
        pending = saved;
        adopt(result.driver);
      });
    } catch (e) {
      if (current && run == epoch) {
        try {
          final saved = await widget.api.pendingDriverMutation();
          if (current && run == epoch) pending = saved;
        } catch (_) {
          /* Keep existing unresolved command. */
        }
        if (current && run == epoch) {
          setState(
            () => error = t(
              'ยังยืนยันสถานะไม่ได้ โหลดใหม่หรือกู้คืนคำสั่งเดิม',
              'Status not confirmed. Refresh or recover the saved command.',
            ),
          );
        }
      }
    } finally {
      if (current && run == epoch) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (retired) return const SizedBox.shrink();
    final p = profile, frozen = busy || pending != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (busy) const LinearProgressIndicator(),
        if (error != null) Semantics(liveRegion: true, child: Text(error!)),
        DriverAvailabilityCard(
          label: stale
              ? t(
                  'สถานะยังไม่ยืนยัน โหลดล่าสุด',
                  'Availability unconfirmed. Refresh.',
                )
              : p!.availability.online
              ? t('ออนไลน์ตามเซิร์ฟเวอร์', 'Online according to server')
              : t('ออฟไลน์ตามเซิร์ฟเวอร์', 'Offline according to server'),
          online: p?.availability.online ?? false,
          stale: stale,
          onToggle:
              frozen ||
                  stale ||
                  p == null ||
                  (!p.availability.online &&
                      !p.availability.verificationCurrent)
              ? null
              : () => load(
                  command: widget.api.driverAvailabilityCommand(
                    p,
                    !p.availability.online,
                  ),
                ),
        ),
        const SizedBox(height: 12),
        BitPosInfoLine(
          key: const ValueKey('availability-info'),
          thai: widget.thai,
          summary: t('ออนไลน์ไม่ใช่การรับงาน', 'Online is not accepting work'),
          title: t('เกี่ยวกับการออนไลน์', 'About going online'),
          paragraphs: [
            t(
              'ออนไลน์ไม่ใช่การรับงานหรือเปิดแชร์ตำแหน่ง ต้องยินยอมแยกต่างหาก',
              'Going online does not accept work or share location. Location consent is separate.',
            ),
          ],
          style: const TextStyle(fontSize: 13),
        ),
        if (pending != null)
          FilledButton(
            onPressed: busy ? null : () => load(command: pending),
            child: Text(t('กู้คืนคำสั่งเดิม', 'Recover saved driver command')),
          ),
        Wrap(
          spacing: 12,
          children: [
            TextButton(
              onPressed: busy ? null : () => load(),
              child: Text(t('โหลดสถานะออนไลน์', 'Refresh availability')),
            ),
            if (p != null && p.availability.online)
              OutlinedButton(
                onPressed:
                    frozen || stale || !p.availability.verificationCurrent
                    ? null
                    : () => load(
                        command: widget.api.driverAvailabilityCommand(p, true),
                      ),
                child: Text(t('ต่ออายุออนไลน์', 'Renew availability')),
              ),
          ],
        ),
      ],
    );
  }
}
