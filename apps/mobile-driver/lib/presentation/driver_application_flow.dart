import 'package:flutter/material.dart';

import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/presentation/bitpos_controls.dart';

enum DriverApplicationStage {
  identity,
  vehicle,
  review;

  DriverApplicationStage get next => switch (this) {
    identity => vehicle,
    vehicle => review,
    review => review,
  };

  DriverApplicationStage get previous => switch (this) {
    identity => identity,
    vehicle => identity,
    review => vehicle,
  };
}

class DriverApplicationFlow extends StatelessWidget {
  const DriverApplicationFlow({
    super.key,
    required this.thai,
    required this.stage,
    required this.editable,
    required this.identityFields,
    required this.vehicleFields,
    required this.verificationStatus,
    required this.decisionReason,
    required this.verifiedUntil,
    this.onBack,
    this.showHeader = true,
    this.showNextAction = true,
    this.reviewDetails = const {},
    required this.onNext,
    required this.onSubmit,
  });

  final bool thai;
  final DriverApplicationStage stage;
  final bool editable;
  final bool showHeader;
  final bool showNextAction;
  final List<Widget> identityFields;
  final List<Widget> vehicleFields;
  final String verificationStatus;
  final String decisionReason;
  final String? verifiedUntil;
  final Map<String, String> reviewDetails;
  final VoidCallback? onBack;
  final VoidCallback onNext;
  final VoidCallback? onSubmit;

  String t(String th, String en) => thai ? th : en;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    final isReview = stage == DriverApplicationStage.review;
    final title = switch (stage) {
      DriverApplicationStage.identity => t(
        'ยืนยันตัวตน',
        'Confirm your identity',
      ),
      DriverApplicationStage.vehicle => t(
        'ข้อมูลรถของคุณ',
        'Your vehicle details',
      ),
      DriverApplicationStage.review => t(
        'ตรวจสอบเอกสาร',
        'Review application status',
      ),
    };
    final step = switch (stage) {
      DriverApplicationStage.identity => '1 / 3',
      DriverApplicationStage.vehicle => '2 / 3',
      DriverApplicationStage.review => '3 / 3',
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showHeader)
          Row(
            children: [
              if (onBack != null)
                IconButton(
                  key: const ValueKey('driver-application-back'),
                  onPressed: onBack,
                  style: IconButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    backgroundColor: colors.surface,
                    side: BorderSide(color: colors.outlineVariant),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  icon: const Icon(Icons.chevron_left),
                  tooltip: t('ย้อนกลับ', 'Back'),
                ),
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
            ],
          ),
        if (showHeader) const SizedBox(height: BitPosDesignTokens.s12),
        Align(
          alignment: Alignment.centerLeft,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            decoration: BoxDecoration(
              color: colors.secondaryContainer,
              borderRadius: BorderRadius.circular(15),
            ),
            child: Text(
              '${t('ขั้นตอนสมัคร', 'Application step')} · $step',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: colors.onSecondaryContainer,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
        const SizedBox(height: BitPosDesignTokens.s24),
        if (!isReview) ...[
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: BitPosDesignTokens.s20),
          ..._fieldCards(context, switch (stage) {
            DriverApplicationStage.identity => identityFields,
            DriverApplicationStage.vehicle => vehicleFields,
            DriverApplicationStage.review => const <Widget>[],
          }),
          if (stage == DriverApplicationStage.identity) ...[
            const SizedBox(height: 30),
            _documentRow(
              context,
              Icons.badge_outlined,
              t('เอกสารยืนยันตัวตน', 'Identity document'),
              t('ยังไม่พร้อมแนบเอกสารในแอพ', 'Upload unavailable in this app'),
            ),
            const SizedBox(height: 30),
            _documentRow(
              context,
              Icons.credit_card_outlined,
              t('ใบอนุญาตขับรถ', 'Driving licence'),
              t(
                'กรอกวันหมดอายุในขั้นข้อมูลรถ',
                'Enter expiry in the vehicle step',
              ),
            ),
          ],
          const SizedBox(height: BitPosDesignTokens.s8),
          _unavailableCapability(
            context,
            t(
              'แอปนี้ยังอัปโหลดเอกสารไม่ได้ การกรอกวันหมดอายุไม่ใช่การส่งเอกสารหรือการอนุมัติ',
              'Document upload is unavailable in this app. Entering dates is not document submission or approval.',
            ),
          ),
          const SizedBox(height: BitPosDesignTokens.s24),
          if (showNextAction)
            FilledButton(
              key: const ValueKey('driver-application-next'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(BitPosDesignTokens.touchMin, 52),
              ),
              onPressed: editable ? onNext : null,
              child: Text(t('ดำเนินการต่อ', 'Continue')),
            ),
        ] else ...[
          _statusCard(context),
          if (reviewDetails.isNotEmpty) ...[
            const SizedBox(height: 30),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Theme.of(context).cardTheme.color,
                border: Border.all(color: colors.outlineVariant),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    t('ตรวจข้อมูลก่อนส่ง', 'Review before submitting'),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 16),
                  for (final item in reviewDetails.entries)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final label = Text(
                            item.key,
                            style: Theme.of(context).textTheme.bodySmall
                                ?.copyWith(color: colors.onSurfaceVariant),
                          );
                          final value = Text(
                            item.value.trim().isEmpty
                                ? t('ยังไม่ได้กรอก', 'Not entered')
                                : item.value,
                            softWrap: true,
                          );
                          if (constraints.maxWidth >= 280 &&
                              MediaQuery.textScalerOf(context).scale(1) <=
                                  1.2) {
                            return Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(flex: 4, child: label),
                                const SizedBox(width: 16),
                                Expanded(flex: 5, child: value),
                              ],
                            );
                          }
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [label, const SizedBox(height: 4), value],
                          );
                        },
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: BitPosDesignTokens.s20),
          _unavailableCapability(
            context,
            t(
              'แอปนี้ยังอัปโหลดเอกสารหรือให้ผู้ตรวจสอบตรวจเอกสารไม่ได้',
              'Document upload and verifier review are unavailable in this app.',
            ),
          ),
          const SizedBox(height: BitPosDesignTokens.s24),
          FilledButton(
            key: const ValueKey('driver-application-submit'),
            style: FilledButton.styleFrom(
              minimumSize: const Size(BitPosDesignTokens.touchMin, 52),
            ),
            onPressed: onSubmit,
            child: Text(t('ส่งเพื่อตรวจสอบ', 'Submit for review')),
          ),
        ],
      ],
    );
  }

  List<Widget> _fieldCards(BuildContext context, List<Widget> fields) {
    final inputs = fields.where((field) => field is! SizedBox).toList();
    return [
      for (var index = 0; index < inputs.length; index++) ...[
        if (index > 0) const SizedBox(height: 30),
        _fieldCard(context, [inputs[index]]),
      ],
    ];
  }

  Widget _fieldCard(BuildContext context, List<Widget> fields) => Container(
    constraints: const BoxConstraints(minHeight: 82),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Theme.of(context).cardTheme.color,
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Theme(
      data: Theme.of(context).copyWith(
        inputDecorationTheme: Theme.of(context).inputDecorationTheme.copyWith(
          filled: false,
          contentPadding: EdgeInsets.zero,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          disabledBorder: InputBorder.none,
          floatingLabelBehavior: FloatingLabelBehavior.always,
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.secondaryContainer,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              stage == DriverApplicationStage.identity
                  ? Icons.person_outline
                  : Icons.two_wheeler_outlined,
              size: 22,
              color: Theme.of(context).colorScheme.onSecondaryContainer,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: fields,
            ),
          ),
        ],
      ),
    ),
  );

  Widget _documentRow(
    BuildContext context,
    IconData icon,
    String title,
    String description,
  ) {
    final theme = Theme.of(context);
    return Container(
      constraints: const BoxConstraints(minHeight: 82),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.cardTheme.color,
        border: Border.all(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: theme.colorScheme.secondaryContainer,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(
              icon,
              color: theme.colorScheme.onSecondaryContainer,
              size: 22,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(
                  description,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusCard(BuildContext context) => Container(
    padding: const EdgeInsets.all(BitPosDesignTokens.s20),
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.surface,
      border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
      borderRadius: BorderRadius.circular(18),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          t('สถานะจากเซิร์ฟเวอร์', 'Server status'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: BitPosDesignTokens.s8),
        BitPosStatusBadge(label: verificationStatus),
        if (decisionReason.isNotEmpty) ...[
          const SizedBox(height: BitPosDesignTokens.s8),
          Text(decisionReason),
        ],
        if (verifiedUntil != null) ...[
          const SizedBox(height: BitPosDesignTokens.s8),
          Text('${t('ตรวจสอบถึง', 'Verified until')}: $verifiedUntil'),
        ],
      ],
    ),
  );

  Widget _unavailableCapability(BuildContext context, String label) =>
      Container(
        padding: const EdgeInsets.all(BitPosDesignTokens.s16),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.secondaryContainer,
          borderRadius: BorderRadius.circular(BitPosDesignTokens.radiusControl),
        ),
        child: Text(
          label,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: Theme.of(context).colorScheme.onSecondaryContainer,
          ),
        ),
      );
}
