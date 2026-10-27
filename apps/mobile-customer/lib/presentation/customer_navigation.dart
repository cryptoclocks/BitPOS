import 'package:flutter/material.dart';

/// U06/U23/U28 account destinations; callers retain the same cart/session.
class CustomerNavigation extends StatelessWidget {
  const CustomerNavigation({
    super.key,
    required this.thai,
    required this.selectedIndex,
    this.onSelected,
    this.compact = false,
  });
  final bool thai;
  final bool compact;
  final int selectedIndex;
  final ValueChanged<int>? onSelected;
  @override
  Widget build(BuildContext context) => NavigationBarTheme(
    data: NavigationBarThemeData(
      height: compact && MediaQuery.textScalerOf(context).scale(11) <= 13.2
          ? 52
          : 62,
      backgroundColor: Theme.of(context).cardTheme.color,
      indicatorColor: Colors.transparent,
      elevation: 0,
      labelTextStyle: WidgetStateProperty.resolveWith(
        (states) => TextStyle(
          fontSize: 11,
          fontWeight: states.contains(WidgetState.selected)
              ? FontWeight.w600
              : FontWeight.w400,
          color: states.contains(WidgetState.selected)
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
      iconTheme: WidgetStateProperty.resolveWith(
        (states) => IconThemeData(
          size: 22,
          color: states.contains(WidgetState.selected)
              ? Theme.of(context).colorScheme.primary
              : Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ),
    child: DecoratedBox(
      decoration: BoxDecoration(
        border: Border(
          top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
        ),
      ),
      child: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: onSelected,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.restaurant_menu_outlined),
            label: thai ? 'สั่งอาหาร' : 'Order',
          ),
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            label: thai ? 'ออร์เดอร์' : 'Orders',
          ),
          NavigationDestination(
            icon: const Icon(Icons.favorite_border),
            selectedIcon: const Icon(Icons.favorite),
            label: thai ? 'ร้านโปรด' : 'Favourites',
          ),
          NavigationDestination(
            icon: const Icon(Icons.account_circle_outlined),
            label: thai ? 'บัญชี' : 'Account',
          ),
        ],
      ),
    ),
  );
}
