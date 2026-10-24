import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_presentation.dart';

class FoodCartLineCard extends StatelessWidget {
  const FoodCartLineCard({
    super.key,
    required this.item,
    required this.product,
    required this.thai,
    this.onEdit,
    this.onRemove,
  });
  final MobileConfiguredCartItem item;
  final MobileProduct? product;
  final bool thai;
  final VoidCallback? onEdit, onRemove;
  String t(String th, String en) => thai ? th : en;
  @override
  Widget build(BuildContext context) {
    final p = product;
    final colors = Theme.of(context).colorScheme;
    var changed = p != null && item.optionVersion != p.options.version;
    final selected = <String>[];
    if (p != null && !changed) {
      for (final s in item.selections) {
        final groups = p.options.groups.where(
          (g) => g.id == s.groupId && g.enabled,
        );
        if (groups.isEmpty) {
          changed = true;
          break;
        }
        final group = groups.first,
            choices = groups.first.choices.where(
              (c) => c.id == s.choiceId && c.enabled,
            );
        if (choices.isEmpty) {
          changed = true;
          break;
        }
        final choice = choices.first;
        selected.add(
          '${thai ? group.name : group.nameEn}: ${thai ? choice.name : choice.nameEn} × ${s.qty}',
        );
      }
    }
    final preferred = p == null ? '' : (thai ? p.name : p.nameEn);
    final title = p == null
        ? t('สินค้าไม่พร้อมใช้งาน', 'Unavailable product')
        : preferred.trim().isNotEmpty
        ? preferred
        : (thai ? p.nameEn : p.name);
    final detail = p == null
        ? t(
            'สินค้านี้ไม่อยู่ในเมนูปัจจุบัน กรุณาลบรายการ',
            'This product is no longer on the menu. Remove this line.',
          )
        : changed
        ? t(
            'ตัวเลือกเปลี่ยน กรุณาตรวจรายการนี้อีกครั้ง',
            'Options changed. Review this item.',
          )
        : selected.join('\n');
    // A configured-line quote is not supplied; base unitPrice is not its total.
    return Card(
      color: colors.surface,
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: colors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 82),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  FoodImage(url: p?.imageUrl ?? '', size: 60),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${item.qty} × $title',
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: colors.onSurface,
                          ),
                        ),
                        if (detail.isNotEmpty) ...[
                          const SizedBox(height: 6),
                          Text(
                            detail,
                            style: TextStyle(
                              fontSize: 13,
                              color: p == null || changed
                                  ? colors.error
                                  : colors.onSurfaceVariant,
                            ),
                          ),
                        ],
                        if (item.allergyNote?.isNotEmpty == true) ...[
                          const SizedBox(height: 6),
                          Text(
                            item.allergyNote!,
                            style: TextStyle(
                              fontSize: 13,
                              color: colors.onSurface,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              // Keep recovery actions labelled and outside the narrow text column.
              Wrap(
                spacing: 12,
                runSpacing: 0,
                alignment: WrapAlignment.end,
                children: [
                  if (p != null)
                    TextButton.icon(
                      onPressed: onEdit,
                      icon: const Icon(Icons.edit_outlined, size: 18),
                      label: Text(t('แก้ไขรายการ', 'Edit item')),
                    ),
                  TextButton.icon(
                    onPressed: onRemove,
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: Text(t('ลบรายการ', 'Remove item')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
