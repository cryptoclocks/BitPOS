import 'package:flutter/material.dart';

/// U33 geometry, with only the authenticated account's actual display name.
class AccountIdentityCard extends StatelessWidget {
  const AccountIdentityCard({
    super.key,
    required this.name,
    required this.thai,
  });
  final String name;
  final bool thai;
  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('account-identity-card'),
    constraints: const BoxConstraints(minHeight: 125),
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: const Color(0xff64188a),
      borderRadius: BorderRadius.circular(24),
    ),
    child: Row(
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
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                name.trim().isEmpty
                    ? (thai ? 'บัญชีของคุณ' : 'Your account')
                    : name,
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                thai ? 'บัญชี BitPOS ของคุณ' : 'Your BitPOS account',
                style: const TextStyle(fontSize: 13, color: Color(0xffe8d5f4)),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
