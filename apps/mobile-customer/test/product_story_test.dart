import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/presentation/product_story_page.dart';

MobileProduct product({String story = '', String storyEn = '', String video = ''}) => MobileProduct(
  id: '11111111-1111-4111-8111-111111111111',
  name: 'ครัวซองต์',
  nameEn: 'Croissant',
  category: 'Bakery',
  description: '',
  imageUrl: '',
  story: MobileProductStory(
    story: story,
    storyEn: storyEn,
    ingredients: 'เนยฝรั่งเศส แป้งสาลี',
    ingredientsEn: 'Butter, wheat flour',
    benefits: 'กรอบนอกนุ่มใน',
    benefitsEn: '',
    videoUrl: video,
  ),
  available: 5,
  unitPrice: MobileMoney(currency: 'USD', decimals: 4, amountMinor: '1000'),
  basePrice: MobileMoney(currency: 'USD', decimals: 4, amountMinor: '1000'),
  options: MobileProductOptions(version: null, revision: '0', noteEnabled: true, groups: const []),
);

void main() {
  test('story presence', () {
    expect(hasProductStory(product()), isTrue); // ingredients are filled in the helper
    final empty = MobileProduct.fromJson({...product().toJson(), 'story': {'story': '', 'storyEn': '', 'ingredients': '', 'ingredientsEn': '', 'benefits': '', 'benefitsEn': '', 'videoUrl': ''}});
    expect(hasProductStory(empty), isFalse);
  });

  testWidgets('card shows a story button only when the shop wrote a story', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: FoodProductCard(product: product(story: 'เรื่องของเรา'), thai: true))));
    expect(find.byTooltip('ดูเรื่องราวของเมนู'), findsOneWidget);
  });

  testWidgets('story page shows text in the chosen language with fallback', (tester) async {
    tester.view.physicalSize = const Size(1000, 4000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(MaterialApp(home: ProductStoryPage(product: product(story: 'เรื่องของเรา'), thai: false, playVideo: false)));
    expect(find.text('Croissant'), findsWidgets);
    expect(find.text('เรื่องของเรา'), findsOneWidget); // no English story: falls back to Thai
    expect(find.text('Butter, wheat flour'), findsOneWidget);
    expect(find.text('กรอบนอกนุ่มใน'), findsOneWidget); // English benefits missing: Thai fallback
    expect(find.text('Ingredients'), findsOneWidget);
  });
}
