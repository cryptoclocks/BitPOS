import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class SavedAddressCard extends StatelessWidget {
  const SavedAddressCard({
    super.key,
    required this.address,
    required this.thai,
    this.onEdit,
    this.onRemove,
  });
  final MobileAddress address;
  final bool thai;
  final VoidCallback? onEdit, onRemove;
  @override
  Widget build(BuildContext context) {
    final value = address.address;
    final colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardTheme.color,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: colors.primaryContainer,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(
                  Icons.location_on_outlined,
                  color: colors.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      value.label,
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      value.addressText,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text('${value.recipientName} · ${value.phone}'),
          if (value.instructions.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(value.instructions),
          ],
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              TextButton.icon(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_outlined),
                label: Text(thai ? 'แก้ไข' : 'Edit'),
              ),
              TextButton(
                onPressed: onRemove,
                child: Text(
                  thai ? 'ลบที่อยู่ที่บันทึก' : 'Remove saved address',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class AddressEditorPanel extends StatelessWidget {
  const AddressEditorPanel({super.key, required this.children});
  final List<Widget> children;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: children,
  );
}
