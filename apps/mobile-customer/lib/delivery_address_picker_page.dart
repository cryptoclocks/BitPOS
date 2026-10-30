import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'presentation/customer_navigation.dart';

/// U12 address selection. Only server-owned addresses inside the current
/// branch's service bounds can be returned to checkout.
class DeliveryAddressPickerPage extends StatefulWidget {
  const DeliveryAddressPickerPage({
    super.key,
    required this.addresses,
    required this.selected,
    required this.thai,
    required this.isEligible,
    required this.onAddAddress,
    required this.hasMore,
    required this.onLoadMore,
    required this.onNavigate,
  });

  final List<MobileAddress> addresses;
  final MobileAddress? selected;
  final bool thai;
  final bool Function(MobileAddress address) isEligible;
  final Future<List<MobileAddress>> Function() onAddAddress;
  final bool Function() hasMore;
  final Future<List<MobileAddress>> Function() onLoadMore;
  final Future<void> Function(int index) onNavigate;

  @override
  State<DeliveryAddressPickerPage> createState() =>
      _DeliveryAddressPickerPageState();
}

class _DeliveryAddressPickerPageState extends State<DeliveryAddressPickerPage> {
  late List<MobileAddress> _addresses = [...widget.addresses];
  bool _adding = false;
  bool _loadingMore = false;
  String? _error;

  String t(String thai, String english) => widget.thai ? thai : english;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      automaticallyImplyLeading: false,
      toolbarHeight:
          (112.0 - MediaQuery.paddingOf(context).top).clamp(48.0, 68.0) +
          (MediaQuery.textScalerOf(context).scale(20) - 20) * 2,
      leadingWidth: 84,
      titleSpacing: 0,
      leading: Padding(
        padding: const EdgeInsets.only(left: 24, right: 12),
        child: Align(
          alignment: Alignment.centerLeft,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Material(
              color: Theme.of(context).cardTheme.color,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: BorderSide(
                  color: Theme.of(context).colorScheme.outlineVariant,
                ),
              ),
              child: IconButton(
                tooltip: MaterialLocalizations.of(context).backButtonTooltip,
                onPressed: () => Navigator.of(context).maybePop(),
                icon: Icon(
                  Icons.chevron_left,
                  color: Theme.of(context).colorScheme.primary,
                  size: 22,
                ),
                padding: EdgeInsets.zero,
              ),
            ),
          ),
        ),
      ),
      title: Text(t('ที่อยู่จัดส่ง', 'Delivery addresses')),
    ),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 520),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(24, 27, 24, 32),
          children: [
            if (_adding || _loadingMore)
              Semantics(
                liveRegion: true,
                label: t('กำลังโหลดที่อยู่', 'Loading addresses'),
                child: const LinearProgressIndicator(),
              ),
            for (final address in _addresses) _addressCard(address),
            if (widget.hasMore())
              OutlinedButton(
                onPressed: _loadingMore || _adding ? null : _loadMore,
                child: Text(t('โหลดที่อยู่เพิ่มเติม', 'Load more addresses')),
              ),
            if (_addresses.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text(
                  t(
                    'ยังไม่มีที่อยู่จัดส่ง เพิ่มที่อยู่พร้อมพิกัดในบัญชีของคุณ',
                    'No saved delivery addresses. Add an address with coordinates in your account.',
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 20),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(double.infinity, 52),
              ),
              onPressed: _adding || _loadingMore ? null : _add,
              icon: const Icon(Icons.add),
              label: Text(t('เพิ่มที่อยู่ใหม่', 'Add a new address')),
            ),
          ],
        ),
      ),
    ),
    bottomNavigationBar: SafeArea(
      top: false,
      child: CustomerNavigation(
        thai: widget.thai,
        selectedIndex: 0,
        onSelected: (index) async {
          if (index == 0) {
            Navigator.of(context).pop();
            return;
          }
          Navigator.of(context).pop();
          await widget.onNavigate(index);
        },
      ),
    ),
  );

  Widget _addressCard(MobileAddress address) {
    final value = address.address;
    final eligible = !address.archived && widget.isEligible(address);
    final selected = eligible && widget.selected?.id == address.id;
    return Semantics(
      button: eligible,
      enabled: eligible,
      selected: selected,
      label: '${value.label}, ${value.addressText}',
      child: InkWell(
        key: ValueKey('delivery-address-${address.id}'),
        onTap: eligible ? () => Navigator.of(context).pop(address) : null,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          constraints: const BoxConstraints(minHeight: 82),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            color: Theme.of(context).cardTheme.color,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected
                  ? Theme.of(context).colorScheme.primary
                  : Theme.of(context).colorScheme.outlineVariant,
              width: selected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.primaryContainer,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(
                  _iconForLabel(value.label),
                  color: Theme.of(context).colorScheme.onPrimaryContainer,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      value.label,
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontSize: 15),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      value.addressText,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                    if (!eligible) ...[
                      const SizedBox(height: 6),
                      Text(
                        t(
                          address.archived
                              ? 'ที่อยู่นี้ถูกเก็บถาวรแล้ว'
                              : 'นอกพื้นที่จัดส่งหรือไม่มีพิกัด',
                          address.archived
                              ? 'This address is archived'
                              : 'Outside delivery area or missing coordinates',
                        ),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                selected ? Icons.check_circle : Icons.chevron_right,
                color: eligible
                    ? Theme.of(context).colorScheme.primary
                    : Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }

  IconData _iconForLabel(String label) {
    final normalized = label.trim().toLowerCase();
    if (normalized == 'home' || normalized == 'บ้าน') {
      return Icons.home_outlined;
    }
    if (normalized == 'office' ||
        normalized == 'work' ||
        normalized == 'ที่ทำงาน') {
      return Icons.inventory_2_outlined;
    }
    return Icons.location_on_outlined;
  }

  Future<void> _add() async {
    if (_adding || _loadingMore) return;
    setState(() {
      _adding = true;
      _error = null;
    });
    try {
      final addresses = await widget.onAddAddress();
      if (mounted) setState(() => _addresses = addresses);
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = t(
            'โหลดที่อยู่ไม่สำเร็จ กรุณาลองอีกครั้ง',
            'Could not reload addresses. Try again.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _loadMore() async {
    if (_adding || _loadingMore) return;
    setState(() {
      _loadingMore = true;
      _error = null;
    });
    try {
      final addresses = await widget.onLoadMore();
      if (mounted) setState(() => _addresses = addresses);
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = t(
            'โหลดที่อยู่ไม่สำเร็จ กรุณาลองอีกครั้ง',
            'Could not load more addresses. Try again.',
          );
        });
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }
}
