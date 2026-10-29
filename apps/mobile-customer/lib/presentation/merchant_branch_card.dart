import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import '../food_labels.dart';

/// Actual catalogue facts only. Service configuration is not opening/coverage.
class MerchantBranchCard extends StatelessWidget {
  const MerchantBranchCard({
    super.key,
    required this.branch,
    required this.thai,
    this.onOpen,
    this.onFavourite,
  });
  final MobileBranch branch;
  final bool thai;
  final VoidCallback? onOpen, onFavourite;

  @override
  Widget build(BuildContext context) {
    final title = merchantBranchLabel(
      thai: thai,
      name: branch.name,
      nameEn: branch.nameEn,
      merchantName: branch.merchantName,
    );
    final colors = Theme.of(context).colorScheme;
    final brand = branch.merchantName.trim();
    return Card(
      color: Theme.of(context).cardTheme.color,
      margin: const EdgeInsets.only(bottom: 12),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: colors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 82),
        child: Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: onOpen,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(12, 11, 0, 11),
                  child: Row(
                    children: [
                      Container(
                        width: 60,
                        height: 60,
                        decoration: BoxDecoration(
                          color: colors.primaryContainer,
                          borderRadius: BorderRadius.circular(13),
                        ),
                        child: Icon(
                          Icons.storefront_outlined,
                          size: 28,
                          color: colors.onPrimaryContainer,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              title,
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            if (brand.isNotEmpty && brand != title)
                              Text(
                                brand,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            if (branch.addressLabel.trim().isNotEmpty)
                              Text(
                                branch.addressLabel.trim(),
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            IconButton(
              tooltip: thai ? 'บันทึกร้านโปรด' : 'Save favourite',
              onPressed: onFavourite,
              style: IconButton.styleFrom(
                minimumSize: const Size(48, 48),
                foregroundColor: colors.primary,
              ),
              icon: const Icon(Icons.favorite_border),
            ),
            const SizedBox(width: 4),
          ],
        ),
      ),
    );
  }
}
