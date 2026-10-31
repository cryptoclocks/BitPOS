import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class DriverIdentityCard extends StatelessWidget {
  const DriverIdentityCard({
    super.key,
    required this.profile,
    required this.thai,
  });
  final DriverProfile profile;
  final bool thai;
  @override
  Widget build(BuildContext context) {
    final name = profile.application.displayName;
    final status = switch (profile.status) {
      'APPROVED' => thai ? 'อนุมัติแล้ว' : 'Approved',
      'SUSPENDED' => thai ? 'พักบัญชี' : 'Suspended',
      'REJECTED' => thai ? 'ไม่ผ่านการตรวจสอบ' : 'Rejected',
      _ => thai ? 'รอตรวจสอบ' : 'Awaiting verification',
    };
    return Container(
      constraints: const BoxConstraints(minHeight: 125),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xff64188a),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 32,
            backgroundColor: const Color(0xffe8d5f4),
            child: Text(
              name.trim().isEmpty ? '' : name.trim().characters.first,
              style: const TextStyle(fontSize: 28, color: Color(0xff64188a)),
            ),
          ),
          const SizedBox(width: 20),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  status,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xffe8d5f4),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
