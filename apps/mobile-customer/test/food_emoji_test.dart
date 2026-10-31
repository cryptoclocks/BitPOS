import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/food_presentation.dart';

void main() {
  test('specific dishes get their own emoji, category is the fallback', () {
    expect(foodEmoji(name: 'ลาเต้เย็น', nameEn: 'Iced Latte', category: 'Coffee'), '🧊');
    expect(foodEmoji(name: 'ชาเขียว', nameEn: 'Matcha', category: 'Tea & Chocolate'), '🍵');
    expect(foodEmoji(name: 'ครัวซองต์', nameEn: 'Croissant', category: 'Bakery'), '🥐');
    expect(foodEmoji(name: 'มัฟฟินบลูเบอร์รี', nameEn: 'Blueberry Muffin', category: 'Bakery'), '🧁');
    expect(foodEmoji(name: 'บราวนีช็อกโกแลต', nameEn: 'Chocolate Brownie', category: 'Desserts'), '🍫');
    expect(foodEmoji(name: 'ชีสเค้ก', nameEn: 'Cheesecake', category: 'Desserts'), '🍰');
    expect(foodEmoji(name: 'แซนด์วิชชีสย่าง', nameEn: 'Grilled Cheese Sandwich', category: 'Savory'), '🥪');
  });

  test('items that cannot be told apart share the category emoji', () {
    for (final n in ['Espresso', 'Americano', 'Latte', 'Cappuccino']) {
      expect(foodEmoji(nameEn: n, category: 'Coffee'), '☕');
    }
    expect(foodEmoji(name: 'ช็อกโกแลตร้อน', nameEn: 'Hot Chocolate', category: 'Tea & Chocolate'), '☕');
  });

  test('unknown items keep the plain icon and "steak" is not tea', () {
    expect(foodEmoji(nameEn: 'Mystery', category: 'Specials'), isNull);
    expect(foodEmoji(nameEn: 'Steak', category: 'Specials'), isNull);
    expect(foodEmoji(nameEn: 'Iced Tea', category: 'Specials'), '🧊');
    expect(foodEmoji(nameEn: 'Thai Tea', category: 'Specials'), '🍵');
  });
}
