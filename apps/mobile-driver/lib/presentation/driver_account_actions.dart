import 'package:flutter/material.dart';

/// R22 action geometry. Opening location controls never grants consent itself.
class DriverAccountActions extends StatelessWidget {
  const DriverAccountActions({
    super.key,
    required this.thai,
    this.onLocation,
    this.onEarnings,
    this.onHelp,
    this.onPassengerPreview,
    this.onRides,
  });
  final bool thai;
  final VoidCallback? onLocation, onEarnings, onHelp, onPassengerPreview, onRides;
  @override
  Widget build(BuildContext context) => Column(
    children: [
      _tile(
        Icons.location_on_outlined,
        thai ? 'การรับตำแหน่ง' : 'Location sharing',
        thai
            ? 'จัดการความยินยอมในหน้างาน'
            : 'Manage consent on the work screen',
        onLocation,
      ),
      const SizedBox(height: 16),
      _tile(
        Icons.account_balance_wallet_outlined,
        thai ? 'รายได้และบัญชีรับเงิน' : 'Earnings and payout destination',
        thai
            ? 'ดูสิทธิ์และสถานะรอบโอน'
            : 'Review eligibility and payout status',
        onEarnings,
      ),
      if (onRides != null) ...[
        const SizedBox(height: 16),
        _tile(
          Icons.directions_car,
          thai ? 'งานผู้โดยสาร' : 'Passenger jobs',
          thai ? 'รับ เริ่ม และจบเที่ยวด้วย PIN' : 'Accept, start with the PIN and complete trips',
          onRides,
        ),
      ],
      if (onPassengerPreview != null) ...[
        const SizedBox(height: 16),
        _tile(
          Icons.directions_car_outlined,
          thai ? 'งานผู้โดยสาร (ตัวอย่าง)' : 'Passenger jobs (preview)',
          thai
              ? 'ดูขั้นตอนรับส่งผู้โดยสาร ยังรับงานจริงไม่ได้'
              : 'Walk the passenger flow; real jobs are not available',
          onPassengerPreview,
        ),
      ],
      if (onHelp != null) ...[
        const SizedBox(height: 16),
        _tile(
          Icons.health_and_safety_outlined,
          thai ? 'ช่วยเหลือและความปลอดภัย' : 'Help and safety',
          thai
              ? 'ติดต่อและติดตามเรื่องที่แจ้ง'
              : 'Contact support and track requests',
          onHelp,
        ),
      ],
    ],
  );
  Widget _tile(
    IconData icon,
    String title,
    String subtitle,
    VoidCallback? action,
  ) => Material(
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(18),
      side: const BorderSide(color: Color(0xffe9e1f1)),
    ),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: action,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 82),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xffefe6f8),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, color: const Color(0xff64188a)),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: Color(0xff29183f),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xff7b7088),
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: Color(0xff64188a)),
            ],
          ),
        ),
      ),
    ),
  );
}
