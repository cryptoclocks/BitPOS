import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/group_cart_page.dart';

import 'food_history_test.dart' as history;

const me = '00000000-0000-4000-8000-0000000000c1';
const other = '00000000-0000-4000-8000-0000000000c2';
const gid = '00000000-0000-4000-8000-0000000000d1';
const branchId = '00000000-0000-4000-8000-0000000000b1';
const productId = '00000000-0000-4000-8000-0000000000e1';

MobileGroup group({
  String state = 'OPEN',
  bool owner = true,
  List<Map<String, Object?>> lines = const [],
  String version = '3',
}) => MobileGroup.fromJson({
  'id': gid,
  'ownerAccountId': owner ? me : other,
  'state': state,
  'version': version,
  'youAreOwner': owner,
  'members': owner ? [me] : [other, me],
  'lines': lines,
  'branches': [
    if (lines.isNotEmpty)
      {
        'branchId': branchId,
        'qty': lines.fold<int>(0, (a, l) => a + (l['qty'] as int)),
        'members': 1,
      },
  ],
});

MobileBranch branch() => MobileBranch.fromJson({
  'id': branchId,
  'merchantId': '00000000-0000-4000-8000-0000000000f1',
  'merchantName': 'Cafe',
  'name': 'สาขา',
  'nameEn': 'Main branch',
  'addressLabel': 'x',
  'pickupEnabled': true,
  'deliveryEnabled': false,
  'version': 1,
  'openNow': null,
  'nextOpenAt': null,
});

MobileMoney usd(int minor) =>
    MobileMoney(currency: 'USD', decimals: 2, amountMinor: '$minor');
MobileFoodQuote foodQuote(MobileFoodQuoteRequest request) {
  final unit = usd(270);
  final lines = [
    for (final item in request.items)
      MobileConfiguredFoodLine(
        lineId: item.lineId,
        productId: item.productId,
        name: 'ลาเต้',
        nameEn: 'Latte',
        qty: item.qty,
        priceVersion: history.id(3),
        optionVersion: item.optionVersion,
        selections: const [],
        allergyNote: item.allergyNote,
        productBasePrice: unit,
        productUnitPrice: unit,
        optionsUnitPrice: usd(0),
        basePrice: unit,
        unitPrice: unit,
        lineTotal: usd(270 * item.qty),
      ),
  ];
  final total = usd(270 * request.items.fold<int>(0, (a, i) => a + i.qty));
  return MobileFoodQuote(
    id: history.id(20),
    merchantId: history.id(2),
    branchId: request.branchId,
    priceVersion: history.id(3),
    pricingRevision: '1',
    quotedAt: DateTime.now().toUtc().toIso8601String(),
    validUntil: DateTime.now()
        .toUtc()
        .add(const Duration(minutes: 5))
        .toIso8601String(),
    lines: [
      for (final l in lines)
        MobileFoodLine(
          productId: l.productId,
          name: l.name,
          nameEn: l.nameEn,
          qty: l.qty,
          unitPrice: unit,
          basePrice: unit,
        ),
    ],
    subtotal: total,
    discount: usd(0),
    fees: usd(0),
    tax: usd(0),
    total: total,
    settlement: MobileSettlement(
      money: MobileMoney(currency: 'USDG', decimals: 6, amountMinor: '2700000'),
      recipient: 'fixture',
      network: 'solana:devnet',
      genesisHash: 'fixture',
      mint: 'fixture',
      tokenProgram: 'fixture',
      testToken: true,
    ),
    configured: MobileConfiguredFoodSnapshot(
      lines: lines,
      subtotal: total,
      discount: usd(0),
      fees: usd(0),
      tax: usd(0),
      total: total,
    ),
    delivery: null,
  );
}

MobileAddress address(int id, {bool archived = false, int? lat = 130000000}) =>
    MobileAddress(
      id: history.id(id),
      version: '2',
      archived: archived,
      updatedAt: '2026-10-27T00:00:00Z',
      address: MobileAddressFields(
        label: 'Home $id',
        recipientName: 'Fixture',
        phone: '+66800000000',
        addressText: 'Fixture address $id',
        instructions: '',
        latitudeE7: lat,
        longitudeE7: 1000000000,
      ),
    );
MobileCustomerDeliveryPolicy policy() => MobileCustomerDeliveryPolicy(
  branchId: branchId,
  policyVersionId: history.id(50),
  priceVersionId: history.id(3),
  deliveryFee: usd(100),
  serviceFee: usd(20),
  originLatitudeE7: 130000000,
  originLongitudeE7: 1000000000,
  southE7: 120000000,
  northE7: 140000000,
  westE7: 990000000,
  eastE7: 1010000000,
  fixture: true,
);
MobileFoodQuote deliveryQuote(MobileDeliveryQuoteRequest r) {
  final json = foodQuote(
    MobileFoodQuoteRequest(
      branchId: r.branchId,
      serving: 'pickup',
      items: r.items,
    ),
  ).toJson();
  final total = usd(270 * r.items.fold<int>(0, (a, i) => a + i.qty) + 120);
  json['total'] = total.toJson();
  json['fees'] = usd(120).toJson();
  final configured = json['configured'] as Map<String, dynamic>;
  configured['total'] = total.toJson();
  configured['fees'] = usd(120).toJson();
  json['delivery'] = MobileFoodDeliverySnapshot(
    addressId: r.delivery.addressId,
    addressVersion: r.delivery.addressVersion,
    policyVersionId: r.delivery.policyVersionId,
    recipientName: 'Fixture',
    phone: '+66800000000',
    addressText: 'Fixture address',
    instructions: '',
    latitudeE7: 130000000,
    longitudeE7: 1000000000,
    deliveryFee: usd(100),
    serviceFee: usd(20),
    fixture: true,
  ).toJson();
  return MobileFoodQuote.fromJson(json);
}

class Fake {
  MobileGroup? current;
  final calls = <String>[];
  Object? failNext;
  Future<T> go<T>(String n, T Function() ok) async {
    calls.add(n);
    final e = failNext;
    if (e != null) {
      failNext = null;
      throw e;
    }
    return ok();
  }

  List<MobileProduct> products = [];
  List<MobileAddress> savedAddresses = [address(40), address(41)];
  final deliveryQuotes = <MobileDeliveryQuoteRequest>[];
  final orderCommands = <MobileFoodOrderRequest>[];

  GroupCartGateway get gateway => GroupCartGateway(
    accountId: () => me,
    groups: () => go(
      'groups',
      () => MobileGroups(groups: current == null ? [] : [current!]),
    ),
    create: () => go('create', () => current = group()),
    get: (_) => go('get', () => current!),
    invite: (_) => go(
      'invite',
      () => MobileGroupInvite(
        token: 'abcdefghijklmnopqrstuvwx',
        expiresAt: '2026-10-28T00:00:00Z',
      ),
    ),
    join: (token) => go('join:$token', () => current = group(owner: false)),
    setLine: (g, b, p, q) => go(
      'line:$q',
      () => current = group(
        owner: current?.youAreOwner ?? true,
        lines: q == 0
            ? []
            : [
                {'accountId': me, 'branchId': b, 'productId': p, 'qty': q},
              ],
      ),
    ),
    lock: (g, v) => go(
      'lock:$v',
      () => current = group(
        state: 'LOCKED',
        lines: current!.lines.map((l) => l.toJson()).toList(),
      ),
    ),
    cancel: (_) => go('cancel', () => current = group(state: 'CANCELLED')),
    leave: (_) => go('leave', () {
      current = null;
      return MobileGroupLeft(left: true);
    }),
    branches: () => go('branches', () => [branch()]),
    menu: (_) => go('menu', () => products),
    quote: (r) => go(
      'quote:${r.serving}:${r.items.map((i) => '${i.productId.substring(30)}x${i.qty}').join(',')}',
      () => foodQuote(r),
    ),
    order: (r) {
      orderCommands.add(r);
      return go(
        'order:${r.quoteId}',
        () => MobileFoodOrderResult(order: history.order(2), replayed: false),
      );
    },
    addresses: (_) => go(
      'addresses',
      () => MobileAddresses(addresses: savedAddresses, nextCursor: null),
    ),
    deliveryPolicy: (_) => go('deliveryPolicy', () => policy()),
    quoteDelivery: (r) {
      deliveryQuotes.add(r);
      return go('deliveryQuote', () => deliveryQuote(r));
    },
  );
}

MobileProduct product(int available) => MobileProduct.fromJson({
  'id': productId,
  'name': 'ลาเต้',
  'nameEn': 'Latte',
  'category': '',
  'description': '',
  'imageUrl': '',
  'available': available,
  'unitPrice': null,
  'basePrice': null,
  'options': {
    'version': null,
    'revision': '0',
    'noteEnabled': true,
    'groups': <Object?>[],
  },
});

Future<void> pump(WidgetTester tester, Fake fake, {bool thai = false}) async {
  tester.view.physicalSize = const Size(800, 3200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: GroupCartPage(gateway: fake.gateway, thai: thai),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'create, add an item through the branch menu, invite, lock; locked groups are read-only',
    (tester) async {
      final fake = Fake();
      await pump(tester, fake);
      expect(find.byKey(const ValueKey('group-empty')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('group-create')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('group-state')), findsOneWidget);
      expect(find.textContaining('No group price or payment'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.byKey(const ValueKey('group-lock')))
            .onPressed,
        isNull,
        reason: 'lock needs an item',
      );
      fake.products = [product(5)];
      await tester.tap(find.byKey(const ValueKey('group-load-branches')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('group-branch.$branchId')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('group-plus.$productId')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('line:1'));
      expect(
        find.byKey(const ValueKey('group-line.$me.$productId')),
        findsOneWidget,
      );
      expect(find.textContaining('You · Latte × 1'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('group-invite')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('group-token')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('group-lock')));
      await tester.pumpAndSettle();
      expect(
        fake.calls,
        contains('lock:3'),
        reason: 'the lock names the version the owner saw',
      );
      expect(find.byKey(const ValueKey('group-locked')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('group-plus.$productId')),
        findsNothing,
        reason: 'no edits once locked',
      );
      expect(find.byKey(const ValueKey('group-lock')), findsNothing);
    },
  );

  testWidgets(
    'a member joins by code, cannot lock, and can leave; stock caps the plus button',
    (tester) async {
      final fake = Fake();
      await pump(tester, fake);
      await tester.enterText(
        find.byKey(const ValueKey('group-code')),
        'abcdefghijklmnopqrstuvwx',
      );
      await tester.tap(find.byKey(const ValueKey('group-join')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('join:abcdefghijklmnopqrstuvwx'));
      expect(
        find.byKey(const ValueKey('group-lock')),
        findsNothing,
        reason: 'only the owner locks',
      );
      expect(find.byKey(const ValueKey('group-invite')), findsNothing);
      fake.products = [product(1)];
      await tester.tap(find.byKey(const ValueKey('group-load-branches')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('group-branch.$branchId')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('group-plus.$productId')));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<IconButton>(
              find.byKey(const ValueKey('group-plus.$productId')),
            )
            .onPressed,
        isNull,
        reason: 'stock of 1 is reached',
      );
      await tester.tap(find.byKey(const ValueKey('group-leave')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('leave'));
      expect(find.byKey(const ValueKey('group-empty')), findsOneWidget);
    },
  );

  testWidgets('errors are explained and a stale lock reloads the group', (
    tester,
  ) async {
    final fake = Fake()
      ..current = group(
        lines: [
          {
            'accountId': me,
            'branchId': branchId,
            'productId': productId,
            'qty': 2,
          },
        ],
      );
    await pump(tester, fake);
    await tester.tap(find.byKey(ValueKey('group-open.$gid')));
    await tester.pumpAndSettle();
    fake.failNext = const MobileApiException('GROUP_CHANGED', 409);
    await tester.tap(find.byKey(const ValueKey('group-lock')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Someone changed the cart'), findsOneWidget);
    expect(
      fake.calls.where((c) => c == 'get').length,
      2,
      reason: 'opening plus the reload after the conflict',
    );
    fake.failNext = const MobileApiException('GROUP_FULL', 409);
    await tester.tap(find.byKey(const ValueKey('group-back')));
    await tester.pumpAndSettle();
    fake.failNext = const MobileApiException('GROUP_FULL', 409);
    await tester.enterText(
      find.byKey(const ValueKey('group-code')),
      'zzzzzzzzzzzzzzzzzzzzzzzz',
    );
    await tester.tap(find.byKey(const ValueKey('group-join')));
    await tester.pumpAndSettle();
    expect(find.textContaining('full'), findsOneWidget);
  });

  testWidgets(
    'a locked group lets each member price and order only their own items per branch, with no payment or cross-branch total',
    (tester) async {
      final other = '00000000-0000-4000-8000-0000000000c2';
      final fake = Fake()
        ..current = group(
          state: 'LOCKED',
          owner: false,
          lines: [
            {
              'accountId': me,
              'branchId': branchId,
              'productId': productId,
              'qty': 2,
            },
            {
              'accountId': other,
              'branchId': branchId,
              'productId': productId,
              'qty': 5,
            },
          ],
        );
      await pump(tester, fake);
      await tester.tap(find.byKey(ValueKey('group-open.$gid')));
      await tester.pumpAndSettle();
      expect(find.textContaining('No payment when ordering'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('group-quote-btn.$branchId')));
      await tester.pumpAndSettle();
      expect(
        fake.calls.where((c) => c.startsWith('quote:')).single,
        endsWith('x2'),
        reason: "only the caller's quantity (2), never the other member's 5",
      );
      expect(fake.calls.any((c) => c.startsWith('quote:pickup:')), isTrue);
      expect(find.text('5.40 USD'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('group-place.$branchId')));
      await tester.pumpAndSettle();
      expect(fake.calls.any((c) => c.startsWith('order:')), isTrue);
      expect(
        find.byKey(const ValueKey('group-placed.$branchId')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('group-place.$branchId')),
        findsNothing,
        reason: 'cannot place the same group order twice from here',
      );
    },
  );

  testWidgets(
    'an item that cannot be quoted explains itself; a member without items sees that',
    (tester) async {
      final fake = Fake()
        ..current = group(
          state: 'LOCKED',
          lines: [
            {
              'accountId': me,
              'branchId': branchId,
              'productId': productId,
              'qty': 1,
            },
          ],
        );
      await pump(tester, fake);
      await tester.tap(find.byKey(ValueKey('group-open.$gid')));
      await tester.pumpAndSettle();
      fake.failNext = const MobileApiException('INVALID_REQUEST', 422);
      await tester.tap(find.byKey(const ValueKey('group-quote-btn.$branchId')));
      await tester.pumpAndSettle();
      expect(find.textContaining('needs options'), findsOneWidget);
      expect(find.byKey(const ValueKey('group-place.$branchId')), findsNothing);
      await tester.pumpWidget(const SizedBox());
      final empty = Fake()..current = group(state: 'LOCKED', lines: []);
      await pump(tester, empty);
      await tester.tap(find.byKey(ValueKey('group-open.$gid')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('group-checkout-none')), findsOneWidget);
    },
  );

  testWidgets(
    'delivery uses own lines, explicit address and server fees; address and serving changes invalidate quote',
    (tester) async {
      final fake = Fake()
        ..current = group(
          state: 'LOCKED',
          owner: false,
          lines: [
            {
              'accountId': me,
              'branchId': branchId,
              'productId': productId,
              'qty': 2,
            },
            {
              'accountId': other,
              'branchId': branchId,
              'productId': productId,
              'qty': 9,
            },
          ],
        );
      await pump(tester, fake);
      Future<void> tap(String key) async {
        await tester.tap(find.byKey(ValueKey(key)));
        await tester.pumpAndSettle();
      }

      await tap('group-open.$gid');
      await tap('group-quote-btn.$branchId');
      expect(find.text('5.40 USD'), findsOneWidget);
      await tap('group-delivery.$branchId');
      expect(find.byKey(const ValueKey('group-place.$branchId')), findsNothing);
      expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const ValueKey('group-quote-btn.$branchId')),
            )
            .onPressed,
        isNull,
      );
      await tap('group-address.$branchId.${history.id(40)}');
      await tap('group-quote-btn.$branchId');
      final quote = fake.deliveryQuotes.single;
      expect(quote.items.single.qty, 2);
      expect(quote.delivery.addressId, history.id(40));
      expect(quote.delivery.addressVersion, '2');
      expect(quote.delivery.policyVersionId, policy().policyVersionId);
      expect(find.text('6.60 USD'), findsOneWidget);
      expect(find.text('Place delivery order'), findsOneWidget);
      await tap('group-address.$branchId.${history.id(41)}');
      expect(find.byKey(const ValueKey('group-place.$branchId')), findsNothing);
      await tap('group-quote-btn.$branchId');
      expect(fake.deliveryQuotes.last.delivery.addressId, history.id(41));
      await tap('group-pickup.$branchId');
      expect(find.byKey(const ValueKey('group-place.$branchId')), findsNothing);
      await tap('group-delivery.$branchId');
      await tap('group-address.$branchId.${history.id(40)}');
      await tap('group-quote-btn.$branchId');
      fake.failNext = const MobileApiException('REQUEST_UNAVAILABLE', 503);
      await tap('group-place.$branchId');
      expect(find.text('Retry the same order'), findsOneWidget);
      expect(
        tester
            .widget<ChoiceChip>(
              find.byKey(const ValueKey('group-pickup.$branchId')),
            )
            .onSelected,
        isNull,
      );
      await tap('group-place.$branchId');
      expect(fake.orderCommands.length, 2);
      expect(
        fake.orderCommands[0].idempotencyKey,
        fake.orderCommands[1].idempotencyKey,
      );
      expect(
        find.byKey(const ValueKey('group-placed.$branchId')),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'delivery blocks archived, unpinned and outside-coverage addresses and explains refusal in Thai',
    (tester) async {
      final fake = Fake()
        ..current = group(
          state: 'LOCKED',
          lines: [
            {
              'accountId': me,
              'branchId': branchId,
              'productId': productId,
              'qty': 1,
            },
          ],
        )
        ..savedAddresses = [
          address(40, archived: true),
          address(41, lat: null),
          address(42, lat: 150000000),
          address(43),
        ];
      await pump(tester, fake, thai: true);
      Future<void> tap(String key) async {
        await tester.tap(find.byKey(ValueKey(key)));
        await tester.pumpAndSettle();
      }

      await tap('group-open.$gid');
      await tap('group-delivery.$branchId');
      expect(find.text('จัดส่ง'), findsOneWidget);
      for (final id in [40, 41, 42]) {
        expect(
          tester
              .widget<ListTile>(
                find.byKey(
                  ValueKey('group-address.$branchId.${history.id(id)}'),
                ),
              )
              .enabled,
          isFalse,
        );
      }
      expect(fake.deliveryQuotes, isEmpty);
      await tap('group-address.$branchId.${history.id(43)}');
      fake.failNext = const MobileApiException('SERVING_UNAVAILABLE', 409);
      await tap('group-quote-btn.$branchId');
      expect(find.textContaining('ร้านยังไม่พร้อมจัดส่ง'), findsOneWidget);
      expect(find.byKey(const ValueKey('group-place.$branchId')), findsNothing);
    },
  );

  testWidgets('Thai renders', (tester) async {
    await pump(tester, Fake(), thai: true);
    expect(find.text('สั่งเป็นกลุ่ม'), findsOneWidget);
    expect(find.text('สร้างกลุ่มสั่งอาหาร'), findsOneWidget);
  });
}
