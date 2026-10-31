import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';

import 'presentation/customer_navigation.dart';

/// U16 is a choice of an existing checkout destination, not payment authority.
/// The order's checkout keeps its own attempt journal and verifies payment.
class PaymentMethodPage extends StatefulWidget {
  const PaymentMethodPage({
    super.key,
    required this.thai,
    required this.total,
    required this.checkoutAvailable,
    required this.onOpenOriginalCheckout,
    this.onNavigate,
  });

  final bool thai;
  final String total;
  final bool checkoutAvailable;
  final Future<void> Function() onOpenOriginalCheckout;
  final Future<void> Function(int index)? onNavigate;

  @override
  State<PaymentMethodPage> createState() => _PaymentMethodPageState();
}

class _PaymentMethodPageState extends State<PaymentMethodPage> {
  bool _solanaSelected = false;
  bool _opening = false;
  String? _error;

  String t(String th, String en) => widget.thai ? th : en;

  Future<void> _open() async {
    if (_opening || !_solanaSelected || !widget.checkoutAvailable) return;
    setState(() {
      _opening = true;
      _error = null;
    });
    try {
      await widget.onOpenOriginalCheckout();
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = t(
            'เปิดหน้าชำระเดิมไม่ได้ ลองอีกครั้งหรือตรวจสถานะออเดอร์',
            'Could not open the original checkout. Retry or check order status.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Widget _method({
    required String keyName,
    required IconData icon,
    required String name,
    required String description,
    required bool enabled,
    bool selected = false,
    VoidCallback? onTap,
  }) {
    final colors = Theme.of(context).colorScheme;
    return Card(
      margin: const EdgeInsets.only(bottom: 18),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(
          color: selected ? colors.primary : colors.outlineVariant,
          width: selected ? 2 : 1,
        ),
      ),
      child: InkWell(
        key: ValueKey(keyName),
        borderRadius: BorderRadius.circular(18),
        onTap: enabled && !_opening ? onTap : null,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 82),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: colors.primaryContainer,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(icon, color: colors.onPrimaryContainer),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        name,
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        description,
                        style: Theme.of(context).textTheme.bodySmall
                            ?.copyWith(color: colors.onSurfaceVariant),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  selected ? Icons.check_circle : Icons.chevron_right,
                  color: enabled ? colors.primary : colors.onSurfaceVariant,
                  size: 22,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: bitPosAppBar(
        context,
        title: Text(t('เลือกวิธีชำระเงิน', 'Choose payment method')),
        onBack: _opening ? null : () => Navigator.of(context).maybePop(),
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 520),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(24, 24, 24, 24),
            children: [
              Text(
                '${t('ยอดชำระ', 'Amount due')} ${widget.total}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 48),
              _method(
                keyName: 'payment-method-promptpay',
                icon: Icons.qr_code_2,
                name: 'PromptPay',
                description: t('ยังไม่เปิดใช้งาน', 'Not available yet'),
                enabled: false,
              ),
              _method(
                keyName: 'payment-method-card',
                icon: Icons.credit_card_outlined,
                name: t('บัตรเครดิต / เดบิต', 'Credit / debit card'),
                description: t('ยังไม่เปิดใช้งาน', 'Not available yet'),
                enabled: false,
              ),
              _method(
                keyName: 'payment-method-solana',
                icon: Icons.account_balance_wallet_outlined,
                name: t('กระเป๋า Solana', 'Solana wallet'),
                description: widget.checkoutAvailable
                    ? t(
                        'เปิดการชำระของออเดอร์เดิม',
                        'Open this order’s checkout',
                      )
                    : t('หน้าชำระยังไม่พร้อมใช้งาน', 'Checkout is unavailable'),
                enabled: widget.checkoutAvailable,
                selected: _solanaSelected && widget.checkoutAvailable,
                onTap: () => setState(() => _solanaSelected = true),
              ),
              const SizedBox(height: 26),
              Text(
                t(
                  'ช่องทางที่ใช้ได้ขึ้นอยู่กับการตั้งค่าของร้าน หน้านี้ไม่ยืนยันการชำระเงิน',
                  'Available methods depend on store setup. This screen does not confirm payment.',
                ),
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: colors.onSurfaceVariant),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 8, 24, 0),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(_error!, style: TextStyle(color: colors.error)),
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    key: const ValueKey('payment-method-continue'),
                    onPressed:
                        _solanaSelected && widget.checkoutAvailable && !_opening
                        ? _open
                        : null,
                    child: _opening
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(t('ใช้วิธีที่เลือก', 'Use selected method')),
                  ),
                ),
              ),
            ),
            if (widget.onNavigate != null)
              CustomerNavigation(
                compact: true,
                thai: widget.thai,
                selectedIndex: 0,
                onSelected: (index) async {
                  if (_opening) return;
                  Navigator.of(context).pop();
                  await widget.onNavigate!(index);
                },
              ),
          ],
        ),
      ),
    );
  }
}
