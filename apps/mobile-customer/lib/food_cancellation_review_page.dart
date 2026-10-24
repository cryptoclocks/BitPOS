import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/mobile_api.dart';

import 'food_cancellation_review_panel.dart';
import 'presentation/customer_navigation.dart';

class FoodCancellationReviewPage extends StatelessWidget {
  const FoodCancellationReviewPage({
    super.key,
    required this.api,
    required this.orderId,
    required this.shipmentId,
    required this.thai,
    required this.owner,
    required this.onAuthenticationRequired,
    this.onNavigationSelected,
  });

  final MobileApi api;
  final String orderId;
  final String shipmentId;
  final bool thai;
  final ValueListenable<bool>? owner;
  final VoidCallback onAuthenticationRequired;
  final ValueChanged<int>? onNavigationSelected;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xfff8f5fc),
    bottomNavigationBar: SafeArea(
      top: false,
      child: CustomerNavigation(
        thai: thai,
        selectedIndex: 1,
        onSelected: onNavigationSelected,
      ),
    ),
    body: SafeArea(
      child: Column(
        children: [
          SizedBox(
            height: 44,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Row(
                children: [
                  SizedBox(
                    width: 44,
                    height: 44,
                    child: IconButton.filledTonal(
                      tooltip: MaterialLocalizations.of(context)
                          .backButtonTooltip,
                      onPressed: () => Navigator.of(context).maybePop(),
                      icon: const Icon(Icons.chevron_left, size: 22),
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.white,
                        foregroundColor: const Color(0xff64188a),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                          side: const BorderSide(color: Color(0xffe9e1f1)),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      thai ? 'ยกเลิกออเดอร์' : 'Cancel order',
                      style: const TextStyle(
                        fontFamily: BitPosDesignTokens.fontLatin,
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                        color: Color(0xff29183f),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(24, 44, 24, 24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  FoodCancellationReviewPanel(
                    api: api,
                    orderId: orderId,
                    shipmentId: shipmentId,
                    thai: thai,
                    owner: owner,
                    onAuthenticationRequired: onAuthenticationRequired,
                    standalone: true,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
