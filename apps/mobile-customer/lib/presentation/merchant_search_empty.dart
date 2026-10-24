import 'package:flutter/material.dart';

/// U07 empty results with explicit reset; unavailable and loading are separate.
class MerchantSearchEmpty extends StatelessWidget {
  const MerchantSearchEmpty({
    super.key,
    required this.thai,
    required this.query,
    required this.filtered,
    this.onReset,
  });
  final bool thai, filtered;
  final String query;
  final VoidCallback? onReset;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
      border: Border.all(color: const Color(0xFFE9E1F1)),
    ),
    child: Column(
      children: [
        const Icon(
          Icons.search_off_rounded,
          size: 40,
          color: Color(0xFF64188A),
        ),
        const SizedBox(height: 16),
        Text(
          thai
              ? 'ไม่พบร้านที่ตรงกับการค้นหา'
              : 'No merchants match this search.',
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: Color(0xFF29183F),
          ),
        ),
        const SizedBox(height: 8),
        Text(
          query.isEmpty
              ? (thai
                    ? 'ลองเปลี่ยนรูปแบบรับอาหาร หรือโหลดรายชื่อร้านอีกครั้ง'
                    : 'Try a different service filter or refresh the merchant list.')
              : (thai
                    ? 'ลองเปลี่ยนชื่อร้าน สาขา หรือที่อยู่ที่ค้นหา'
                    : 'Try a different merchant name, branch or address.'),
          textAlign: TextAlign.center,
          style: const TextStyle(fontSize: 14, color: Color(0xFF7B7088)),
        ),
        if (query.isNotEmpty || filtered) ...[
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onReset,
            icon: const Icon(Icons.restart_alt),
            label: Text(
              thai ? 'ล้างการค้นหาและตัวกรอง' : 'Clear search and filters',
            ),
          ),
        ],
      ],
    ),
  );
}
