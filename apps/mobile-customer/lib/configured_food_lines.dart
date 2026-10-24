import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'presentation/food_presentation.dart';

/// Immutable quote/order snapshots; never substitutes current catalogue prices.
class ConfiguredFoodLines extends StatelessWidget {
  final List<MobileConfiguredFoodLine> lines;
  final bool thai;
  final bool compact;
  const ConfiguredFoodLines({
    super.key,
    required this.lines,
    required this.thai,
    this.compact = false,
  });
  String money(MobileMoney value) =>
      formatMinorUnits(value.amountMinor, value.decimals, value.currency);
  String name(String th, String en) {
    final preferred = thai ? th : en;
    return preferred.trim().isNotEmpty ? preferred : (thai ? en : th);
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: lines
        .map(
          (line) => FoodRowCard(
            key: ValueKey(line.lineId),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (compact)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      const FoodImage(),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    '${line.qty} × ${name(line.name, line.nameEn)}',
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Semantics(
                                    label: thai ? 'รวมรายการ' : 'Line total',
                                    child: Text(
                                      money(line.lineTotal),
                                      textAlign: TextAlign.end,
                                      style: TextStyle(
                                        fontSize: 14,
                                        fontWeight: FontWeight.w600,
                                        color: Theme.of(context)
                                            .colorScheme
                                            .primary,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${thai ? 'ต่อชิ้น' : 'Per item'}: ${money(line.unitPrice)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ],
                  )
                else
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const FoodImage(),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              '${line.qty} × ${name(line.name, line.nameEn)}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '${thai ? 'ต่อชิ้น' : 'Per item'}: ${money(line.unitPrice)}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                            const SizedBox(height: 8),
                            Semantics(
                              label: thai ? 'รวมรายการ' : 'Line total',
                              child: Text(
                                money(line.lineTotal),
                                textAlign: TextAlign.end,
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: Theme.of(context).colorScheme.primary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                if (line.selections.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  ...line.selections.map(
                    (selection) => Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text(
                        '${name(selection.groupName, selection.groupNameEn)} · ${name(selection.choiceName, selection.choiceNameEn)} × ${selection.qty} (+${money(selection.priceDelta)} ${thai ? 'ต่อหน่วยตัวเลือก' : 'per choice unit'})',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                  ),
                ],
                if (line.allergyNote?.trim().isNotEmpty == true) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF0DF),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      '${thai ? 'หมายเหตุอาหารแพ้ / คำแนะนำ' : 'Allergy notes / instructions'}: ${line.allergyNote}',
                      style: const TextStyle(color: Color(0xFFA94800)),
                    ),
                  ),
                ],
              ],
            ),
          ),
        )
        .toList(),
  );
}
