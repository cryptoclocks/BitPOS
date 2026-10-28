import 'dart:async';

import 'package:bitpos_customer/delivery_address_picker_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

MobileAddress address(int suffix, {required String label}) => MobileAddress(
  id: 'bb000000-0000-4000-8000-${suffix.toString().padLeft(12, '0')}',
  version: '1',
  archived: false,
  updatedAt: '2026-10-20T00:00:00Z',
  address: MobileAddressFields(
    label: label,
    recipientName: 'Fixture customer',
    phone: '+66812345678',
    addressText: 'สุขุมวิท $suffix',
    instructions: '',
    latitudeE7: 137300000,
    longitudeE7: 1005600000,
  ),
);

void main() {
  testWidgets(
    'archived address cannot be selected even inside service bounds',
    (tester) async {
      final json = address(12, label: 'Archived Home').toJson()
        ..['archived'] = true;
      final archived = MobileAddress.fromJson(json);
      MobileAddress? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  selected = await Navigator.of(context).push<MobileAddress>(
                    MaterialPageRoute(
                      builder: (_) => DeliveryAddressPickerPage(
                        addresses: [archived],
                        selected: archived,
                        thai: false,
                        isEligible: (_) => true,
                        onAddAddress: () async => [],
                        hasMore: () => false,
                        onLoadMore: () async => [],
                        onNavigate: (_) async {},
                      ),
                    ),
                  );
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(find.text('This address is archived'), findsOneWidget);
      await tester.tap(find.byKey(ValueKey('delivery-address-${archived.id}')));
      await tester.pumpAndSettle();
      expect(selected, isNull);
      expect(find.byType(DeliveryAddressPickerPage), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed address page preserves prior rows and retries same page',
    (tester) async {
      final home = address(10, label: 'Home');
      var fail = true;
      var calls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: DeliveryAddressPickerPage(
            addresses: [home],
            selected: home,
            thai: false,
            isEligible: (_) => true,
            onAddAddress: () async => [home],
            hasMore: () => true,
            onLoadMore: () async {
              calls++;
              if (fail) throw Exception('fixture');
              return [home, address(11, label: 'Office')];
            },
            onNavigate: (_) async {},
          ),
        ),
      );
      await tester.tap(find.text('Load more addresses'));
      await tester.pumpAndSettle();
      expect(
        find.text('Could not load more addresses. Try again.'),
        findsOneWidget,
      );
      expect(find.text('Home'), findsNWidgets(2)); // saved address label + Home tab
      expect(find.textContaining('No saved delivery addresses'), findsNothing);
      fail = false;
      await tester.tap(find.text('Load more addresses'));
      await tester.pumpAndSettle();
      expect(calls, 2);
      expect(find.text('Home'), findsNWidgets(2)); // saved address label + Home tab
      expect(find.text('Office'), findsOneWidget);
      expect(
        find.text('Could not load more addresses. Try again.'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'address loading prevents overlapping editor and pagination replacements',
    (tester) async {
      final gate = Completer<List<MobileAddress>>();
      int edits = 0, pages = 0;
      final existing = address(1, label: 'Home');
      await tester.pumpWidget(
        MaterialApp(
          home: DeliveryAddressPickerPage(
            addresses: [existing],
            selected: existing,
            thai: false,
            isEligible: (_) => true,
            onAddAddress: () async {
              edits++;
              return [existing];
            },
            hasMore: () => true,
            onLoadMore: () {
              pages++;
              return gate.future;
            },
            onNavigate: (_) async {},
          ),
        ),
      );
      await tester.tap(find.text('Load more addresses'));
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Add a new address'),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Load more addresses'));
      await tester.pump();
      expect(pages, 1);
      expect(edits, 0);
      gate.complete([existing, address(2, label: 'Office')]);
      await tester.pumpAndSettle();
      expect(find.text('Home'), findsNWidgets(2)); // saved address label + Home tab
      expect(find.text('Office'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('U12 returns only an eligible server address', (tester) async {
    final eligible = address(1, label: 'Home');
    final outside = address(2, label: 'Office');
    MobileAddress? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                selected = await Navigator.of(context).push<MobileAddress>(
                  MaterialPageRoute(
                    builder: (_) => DeliveryAddressPickerPage(
                      addresses: [eligible, outside],
                      selected: null,
                      thai: false,
                      isEligible: (value) => value.id == eligible.id,
                      onAddAddress: () async => [eligible, outside],
                      hasMore: () => false,
                      onLoadMore: () async => [eligible, outside],
                      onNavigate: (_) async {},
                    ),
                  ),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Delivery addresses'), findsOneWidget);
    expect(
      find.text('Outside delivery area or missing coordinates'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(ValueKey('delivery-address-${outside.id}')));
    await tester.pumpAndSettle();
    expect(find.text('Delivery addresses'), findsOneWidget);
    await tester.tap(find.byKey(ValueKey('delivery-address-${eligible.id}')));
    await tester.pumpAndSettle();
    expect(selected?.id, eligible.id);
  });

  testWidgets('U12 refreshes addresses after opening account address editor', (
    tester,
  ) async {
    final existing = address(3, label: 'Home');
    final added = address(4, label: 'Office');
    await tester.pumpWidget(
      MaterialApp(
        home: DeliveryAddressPickerPage(
          addresses: [existing],
          selected: existing,
          thai: false,
          isEligible: (_) => true,
          onAddAddress: () async => [existing, added],
          hasMore: () => false,
          onLoadMore: () async => [existing, added],
          onNavigate: (_) async {},
        ),
      ),
    );
    await tester.tap(find.text('Add a new address'));
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsNWidgets(2)); // saved address label + Home tab
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Delivery addresses'), findsOneWidget);
  });

  testWidgets('U12 appends the next server address page', (tester) async {
    final home = address(5, label: 'Home');
    final office = address(6, label: 'Office');
    var more = true;
    await tester.pumpWidget(
      MaterialApp(
        home: DeliveryAddressPickerPage(
          addresses: [home],
          selected: null,
          thai: false,
          isEligible: (_) => true,
          onAddAddress: () async => [home, office],
          hasMore: () => more,
          onLoadMore: () async {
            more = false;
            return [home, office];
          },
          onNavigate: (_) async {},
        ),
      ),
    );
    expect(find.text('Load more addresses'), findsOneWidget);
    await tester.tap(find.text('Load more addresses'));
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsNWidgets(2)); // saved address label + Home tab
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Load more addresses'), findsNothing);
  });
}
