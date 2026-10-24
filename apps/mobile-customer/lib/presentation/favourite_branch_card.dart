import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import '../food_labels.dart';

class FavouriteBranchCard extends StatelessWidget {
  const FavouriteBranchCard({
    super.key,
    required this.item,
    required this.thai,
    this.onOpen,
    this.onRemove,
  });
  final MobileFavouriteBranch item;
  final bool thai;
  final VoidCallback? onOpen, onRemove;
  @override
  Widget build(BuildContext context) {
    final branch = item.branch;
    return Card(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: Color(0xFFE9E1F1)),
      ),
      clipBehavior: Clip.antiAlias,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 82),
        child: InkWell(
          onTap: branch == null ? null : onOpen,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 9.5, 4, 9.5),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Semantics(
                  label: thai ? 'ร้านอาหาร' : 'Restaurant',
                  image: true,
                  child: Container(
                    key: ValueKey('favourite-branch-image.${item.branchId}'),
                    width: 60,
                    height: 60,
                    decoration: BoxDecoration(
                      color: const Color(0xFFEFE6F8),
                      borderRadius: BorderRadius.circular(13),
                    ),
                    child: const Icon(
                      Icons.storefront_outlined,
                      color: Color(0xFF64188A),
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        branch == null
                            ? (thai
                                  ? 'ร้านนี้ยังไม่เปิดให้บริการ'
                                  : 'Merchant currently unavailable')
                            : merchantBranchLabel(
                                thai: thai,
                                name: branch.name,
                                nameEn: branch.nameEn,
                                merchantName: branch.merchantName,
                              ),
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF29183F),
                        ),
                      ),
                      if (branch != null) ...[
                        const SizedBox(height: 4),
                        Text(
                          branch.addressLabel.isNotEmpty
                              ? branch.addressLabel
                              : (thai
                                    ? 'เลือกดูเมนูของร้าน'
                                    : 'Open this merchant’s menu'),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF7B7088),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                IconButton(
                  tooltip: thai ? 'นำออกจากร้านโปรด' : 'Remove favourite',
                  onPressed: onRemove,
                  constraints: const BoxConstraints(
                    minWidth: 48,
                    minHeight: 48,
                  ),
                  padding: EdgeInsets.zero,
                  icon: const Icon(Icons.favorite, color: Color(0xFF64188A)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
