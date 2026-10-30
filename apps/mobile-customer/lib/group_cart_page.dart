import 'package:flutter/material.dart';
import 'package:mobile_shared/presentation/bitpos_layout.dart';
import 'package:mobile_shared/presentation/bitpos_state_view.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'ride_request_page.dart' show newRideKey, rideMoneyText;

const _bg = Color(0xfff8f5fc);
const _ink = Color(0xff29183f);
const _purple = Color(0xff64188a);
const _tile = Color(0xffefe6f8);
const _border = Color(0xffe9e1f1);
const _muted = Color(0xff7b7088);

class GroupCartGateway {
  const GroupCartGateway({
    required this.accountId,
    required this.groups,
    required this.create,
    required this.get,
    required this.invite,
    required this.join,
    required this.setLine,
    required this.lock,
    required this.cancel,
    required this.leave,
    required this.branches,
    required this.menu,
    required this.quote,
    required this.order,
    required this.addresses,
    required this.deliveryPolicy,
    required this.quoteDelivery,
  });
  factory GroupCartGateway.fromApi(MobileApi api) => GroupCartGateway(
    accountId: () => api.sessionScope?.accountId ?? '',
    groups: api.groups,
    create: api.createGroup,
    get: api.group,
    invite: api.inviteToGroup,
    join: api.joinGroup,
    setLine: api.setGroupLine,
    lock: api.lockGroup,
    cancel: api.cancelGroup,
    leave: api.leaveGroup,
    branches: () async => (await api.branches()).branches,
    menu: (id) async => (await api.menu(id)).products,
    quote: api.quoteFood,
    order: api.submitFoodOrder,
    addresses: (cursor) => api.addresses(cursor: cursor),
    deliveryPolicy: api.deliveryPolicy,
    quoteDelivery: api.quoteDelivery,
  );
  final String Function() accountId;
  final Future<MobileGroups> Function() groups;
  final Future<MobileGroup> Function() create;
  final Future<MobileGroup> Function(String) get, cancel;
  final Future<MobileGroupInvite> Function(String) invite;
  final Future<MobileGroup> Function(String) join;
  final Future<MobileGroup> Function(String, String, String, int) setLine;
  final Future<MobileGroup> Function(String, String) lock;
  final Future<MobileGroupLeft> Function(String) leave;
  final Future<List<MobileBranch>> Function() branches;
  final Future<List<MobileProduct>> Function(String) menu;
  final Future<MobileFoodQuote> Function(MobileFoodQuoteRequest) quote;
  final Future<MobileFoodOrderResult> Function(MobileFoodOrderRequest) order;
  final Future<MobileAddresses> Function(String? cursor) addresses;
  final Future<MobileCustomerDeliveryPolicy> Function(String) deliveryPolicy;
  final Future<MobileFoodQuote> Function(MobileDeliveryQuoteRequest)
  quoteDelivery;
}

/// Shared group carts: friends pick items together, the owner locks the group. A group holds
/// selections only; there is no group price or payment, so each member later orders their own
/// items from the branch through the normal food flow.
class GroupCartPage extends StatefulWidget {
  const GroupCartPage({super.key, required this.gateway, required this.thai});
  final GroupCartGateway gateway;
  final bool thai;
  @override
  State<GroupCartPage> createState() => _GroupCartPageState();
}

class _GroupCartPageState extends State<GroupCartPage> {
  List<MobileGroup> _groups = const [];
  MobileGroup? _open;
  String? _token, _error;
  bool _loading = true, _busy = false;
  List<MobileBranch> _branches = const [];
  MobileBranch? _branch;
  List<MobileProduct> _products = const [];
  final Map<String, String> _names = {};
  final Map<String, MobileFoodQuote> _quotes = {};
  final Map<String, String> _placed = {};
  final Map<String, MobileFoodOrderRequest> _pending = {};
  final Map<String, bool> _delivery = {};
  final Map<String, MobileAddress> _addresses = {};
  final Map<String, MobileCustomerDeliveryPolicy> _policies = {};
  List<MobileAddress> _savedAddresses = const [];
  String? _addressCursor;
  String _checkoutKey(String branchId) => '${_open!.id}:$branchId';
  final _code = TextEditingController();
  String t(String th, String en) => widget.thai ? th : en;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  String _message(Object error) {
    final code = error is MobileApiException ? error.code : '';
    return switch (code) {
      'GROUP_LIMIT' => t(
        'มีกลุ่มที่เปิดอยู่ครบ 5 กลุ่มแล้ว',
        'You already have 5 open groups.',
      ),
      'GROUP_FULL' => t('กลุ่มเต็ม (12 คน)', 'This group is full (12 people).'),
      'GROUP_NOT_OPEN' => t(
        'กลุ่มนี้ล็อกหรือยกเลิกแล้ว',
        'This group is locked or cancelled.',
      ),
      'GROUP_CHANGED' => t(
        'มีคนแก้ตะกร้า โหลดใหม่แล้ว ลองล็อกอีกครั้ง',
        'Someone changed the cart. Reloaded: review and lock again.',
      ),
      'EMPTY_CART' => t(
        'ต้องมีอย่างน้อย 1 รายการก่อนล็อก',
        'Add at least one item before locking.',
      ),
      'PRODUCT_UNAVAILABLE' => t(
        'รายการนี้สั่งไม่ได้ในตอนนี้',
        'That item is not available right now.',
      ),
      'RESOURCE_NOT_FOUND' => t(
        'ไม่พบกลุ่มหรือรหัสเชิญหมดอายุ',
        'Group not found, or the invite expired.',
      ),
      'INVALID_REQUEST' => t(
        'รายการนี้ต้องเลือกตัวเลือก สั่งจากหน้าเมนูของร้านแทน',
        'This item needs options or is no longer orderable. Order it from the branch menu instead.',
      ),
      'SERVING_UNAVAILABLE' => t(
        'ร้านยังไม่พร้อมจัดส่งไปที่อยู่นี้ เลือกรับที่ร้านหรือที่อยู่อื่น',
        'Delivery is unavailable for this address. Choose pickup or another address.',
      ),
      'ADDRESS_CHANGED' => t(
        'ที่อยู่เปลี่ยนแล้ว โหลดที่อยู่ใหม่และดูราคาอีกครั้ง',
        'The address changed. Reload addresses and get a new price.',
      ),
      'PENDING_ORDER_RECOVERY_REQUIRED' => t(
        'มีคำสั่งที่รอผลอยู่ เปิดหน้าอาหารเพื่อกู้คืนคำสั่งเดิมก่อน',
        'Another order has an unconfirmed result. Open Food to recover it first.',
      ),
      'QUOTE_CHANGED' || 'PRICE_VERSION_CHANGED' || 'STOCK_UNAVAILABLE' => t(
        'ราคาและสินค้ามีการเปลี่ยนแปลง ดูราคาใหม่ก่อนสั่ง',
        'Prices or availability changed. Get a new price before ordering.',
      ),
      'QUOTE_EXPIRED' => t(
        'ราคาหมดอายุแล้ว กรุณาดูราคาใหม่',
        'This price expired. Get a new price.',
      ),
      'OWNER_CANNOT_LEAVE' => t(
        'เจ้าของกลุ่มออกไม่ได้ ให้ยกเลิกกลุ่มแทน',
        'The owner cannot leave. Cancel the group instead.',
      ),
      _ => t('ทำรายการไม่สำเร็จ ลองใหม่', 'Something went wrong. Try again.'),
    };
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final groups = (await widget.gateway.groups()).groups;
      if (!mounted) return;
      setState(() {
        _groups = groups;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error);
        _loading = false;
      });
    }
  }

  Future<void> _act(Future<void> Function() action) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) {
        setState(() => _error = _message(error));
        final code = error is MobileApiException ? error.code : '';
        if (code == 'GROUP_CHANGED' && _open != null) {
          try {
            final fresh = await widget.gateway.get(_open!.id);
            if (mounted) setState(() => _open = fresh);
          } catch (_) {}
        }
      }
    }
    if (mounted) setState(() => _busy = false);
  }

  Future<void> _create() => _act(() async {
    final group = await widget.gateway.create();
    if (mounted) {
      setState(() => _open = group);
      await _load();
    }
  });

  Future<void> _join() => _act(() async {
    final token = _code.text.trim();
    final group = await widget.gateway.join(token);
    if (mounted) {
      _code.clear();
      setState(() => _open = group);
      await _load();
    }
  });

  Future<void> _show(MobileGroup g) => _act(() async {
    final fresh = await widget.gateway.get(g.id);
    if (mounted) setState(() => _open = fresh);
  });

  Future<void> _invite() => _act(() async {
    final i = await widget.gateway.invite(_open!.id);
    if (mounted) setState(() => _token = i.token);
  });

  Future<void> _lock() => _act(() async {
    final g = await widget.gateway.lock(_open!.id, _open!.version);
    if (mounted) setState(() => _open = g);
  });

  Future<void> _cancel() => _act(() async {
    final g = await widget.gateway.cancel(_open!.id);
    if (mounted) setState(() => _open = g);
  });

  Future<void> _leave() => _act(() async {
    await widget.gateway.leave(_open!.id);
    if (mounted) {
      setState(() => _open = null);
      await _load();
    }
  });

  Future<void> _loadBranches() => _act(() async {
    final b = await widget.gateway.branches();
    if (mounted) setState(() => _branches = b);
  });

  Future<void> _pickBranch(MobileBranch b) => _act(() async {
    final products = await widget.gateway.menu(b.id);
    if (mounted) {
      setState(() {
        _branch = b;
        _products = products;
        for (final p in products) {
          _names[p.id] = widget.thai ? p.name : p.nameEn;
        }
      });
    }
  });

  int _mine(String branchId, String productId) {
    final me = widget.gateway.accountId();
    return _open!.lines
        .where(
          (l) =>
              l.accountId == me &&
              l.branchId == branchId &&
              l.productId == productId,
        )
        .fold(0, (a, l) => a + l.qty);
  }

  Future<void> _setQty(MobileProduct p, int qty) => _act(() async {
    final g = await widget.gateway.setLine(
      _open!.id,
      _branch!.id,
      p.id,
      qty.clamp(0, 99),
    );
    if (mounted) setState(() => _open = g);
  });

  Future<void> _setServing(String branchId, bool delivery) => _act(() async {
    final key = _checkoutKey(branchId);
    if (_pending.containsKey(key)) return;
    setState(() {
      _delivery[key] = delivery;
      _quotes.remove(key);
      _addresses.remove(key);
      _policies.remove(key);
    });
    if (!delivery) return;
    final policy = await widget.gateway.deliveryPolicy(branchId);
    final page = await widget.gateway.addresses(null);
    if (!mounted) return;
    setState(() {
      _policies[key] = policy;
      _savedAddresses = page.addresses;
      _addressCursor = page.nextCursor;
    });
  });

  Future<void> _moreAddresses() => _act(() async {
    final cursor = _addressCursor;
    if (cursor == null) return;
    final page = await widget.gateway.addresses(cursor);
    if (page.nextCursor == cursor)
      throw const FormatException('Repeated address cursor');
    if (!mounted) return;
    setState(() {
      final ids = _savedAddresses.map((a) => a.id).toSet();
      _savedAddresses = [
        ..._savedAddresses,
        ...page.addresses.where((a) => ids.add(a.id)),
      ];
      _addressCursor = page.nextCursor;
    });
  });

  bool _availableAddress(
    MobileAddress? address,
    MobileCustomerDeliveryPolicy? policy,
  ) {
    if (address == null) return false;
    final lat = address.address.latitudeE7, lng = address.address.longitudeE7;
    return policy != null &&
        !address.archived &&
        lat != null &&
        lng != null &&
        lat >= policy.southE7 &&
        lat <= policy.northE7 &&
        lng >= policy.westE7 &&
        lng <= policy.eastE7;
  }

  /// Only this member's own lines enter the existing single-branch food flow.
  /// The server verifies address ownership/version, policy and every money amount.
  Future<void> _quoteMine(String branchId) => _act(() async {
    final key = _checkoutKey(branchId);
    final items = [
      for (final l in _open!.lines.where(
        (l) =>
            l.accountId == widget.gateway.accountId() && l.branchId == branchId,
      ))
        MobileConfiguredCartItem(
          lineId: newRideKey(),
          productId: l.productId,
          qty: l.qty,
          optionVersion: null,
          selections: const [],
          allergyNote: null,
        ),
    ];
    if (items.isEmpty) return;
    final MobileFoodQuote quote;
    if (_delivery[key] == true) {
      final address = _addresses[key], policy = _policies[key];
      if (address == null || !_availableAddress(address, policy)) {
        throw const MobileApiException('SERVING_UNAVAILABLE', 409);
      }
      quote = await widget.gateway.quoteDelivery(
        MobileDeliveryQuoteRequest(
          branchId: branchId,
          serving: 'delivery',
          items: items,
          delivery: MobileDeliverySelection(
            addressId: address.id,
            addressVersion: address.version,
            policyVersionId: policy!.policyVersionId,
          ),
        ),
      );
    } else {
      quote = await widget.gateway.quote(
        MobileFoodQuoteRequest(
          branchId: branchId,
          serving: 'pickup',
          items: items,
        ),
      );
    }
    if (mounted) setState(() => _quotes[key] = quote);
  });

  Future<void> _placeMine(String branchId) => _act(() async {
    final key = _checkoutKey(branchId);
    final quote = _quotes[key]!;
    if (!_pending.containsKey(key) &&
        !DateTime.parse(quote.validUntil).isAfter(DateTime.now())) {
      setState(() => _quotes.remove(key));
      throw const MobileApiException('QUOTE_EXPIRED', 409);
    }
    // Reuse the same command after an uncertain response. The real gateway also
    // persists it in the existing account-scoped food-order journal.
    final command = _pending.putIfAbsent(
      key,
      () => MobileFoodOrderRequest(
        branchId: branchId,
        quoteId: quote.id,
        priceVersion: quote.priceVersion,
        idempotencyKey: newRideKey(),
      ),
    );
    final MobileFoodOrderResult result;
    try {
      result = await widget.gateway.order(command);
    } on MobileApiException catch (error) {
      // Match the transport's definitive-refusal list. Unknown outcomes keep
      // the original command; a refused quote can safely be refreshed.
      if ([
        'QUOTE_EXPIRED',
        'QUOTE_CHANGED',
        'PRICE_VERSION_CHANGED',
        'STOCK_UNAVAILABLE',
        'SERVING_UNAVAILABLE',
        'RESOURCE_NOT_FOUND',
        'INVALID_REQUEST',
      ].contains(error.code)) {
        if (mounted)
          setState(() {
            _pending.remove(key);
            _quotes.remove(key);
          });
      }
      rethrow;
    }
    if (mounted) {
      setState(() {
        _placed[key] = result.order.id;
        _quotes.remove(key);
        _pending.remove(key);
      });
    }
  });

  Widget _servingControls(String branchId) {
    final key = _checkoutKey(branchId), delivery = _delivery[key] == true;
    final blocked = _busy || _pending.containsKey(key);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          children: [
            ChoiceChip(
              key: ValueKey('group-pickup.$branchId'),
              label: Text(t('รับที่ร้าน', 'Pickup')),
              selected: !delivery,
              onSelected: blocked ? null : (_) => _setServing(branchId, false),
            ),
            ChoiceChip(
              key: ValueKey('group-delivery.$branchId'),
              label: Text(t('จัดส่ง', 'Delivery')),
              selected: delivery,
              onSelected: blocked ? null : (_) => _setServing(branchId, true),
            ),
          ],
        ),
        if (delivery) ...[
          Text(
            t(
              'เลือกที่อยู่ของคุณ ร้านตรวจสอบพื้นที่และค่าจัดส่งเมื่อดูราคา',
              'Choose your own address. The branch checks coverage and delivery fees when quoting.',
            ),
          ),
          for (final address in _savedAddresses)
            Material(
              color: Colors.transparent,
              child: ListTile(
                key: ValueKey('group-address.$branchId.${address.id}'),
                contentPadding: EdgeInsets.zero,
                selected: _addresses[key]?.id == address.id,
                enabled: !blocked && _availableAddress(address, _policies[key]),
                leading: Icon(
                  _addresses[key]?.id == address.id
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                ),
                title: Text(address.address.label),
                subtitle: Text(address.address.addressText),
                onTap: () => setState(() {
                  _addresses[key] = address;
                  _quotes.remove(key);
                }),
              ),
            ),
          if (_savedAddresses.isEmpty)
            Text(
              t(
                'ยังไม่มีที่อยู่ที่ใช้ได้ เพิ่มที่อยู่พร้อมหมุดในบัญชีของคุณก่อน',
                'No saved address available. Add an address with a map pin in your account first.',
              ),
            ),
          if (_addressCursor != null)
            TextButton(
              onPressed: blocked ? null : _moreAddresses,
              child: Text(t('ที่อยู่เพิ่มเติม', 'More addresses')),
            ),
          TextButton(
            key: ValueKey('group-reload-addresses.$branchId'),
            onPressed: blocked ? null : () => _setServing(branchId, true),
            child: Text(
              t(
                'โหลดที่อยู่และพื้นที่จัดส่งใหม่',
                'Reload addresses and delivery coverage',
              ),
            ),
          ),
        ],
      ],
    );
  }

  Widget _checkout(MobileGroup g) {
    final me = widget.gateway.accountId();
    final branchIds = {
      for (final l in g.lines.where((l) => l.accountId == me)) l.branchId,
    };
    if (branchIds.isEmpty) {
      return _card([
        Text(
          t('คุณไม่มีรายการในกลุ่มนี้', 'You have no items in this group.'),
          key: const ValueKey('group-checkout-none'),
        ),
      ]);
    }
    return _card([
      Text(
        t('สั่งรายการของคุณ', 'Order your items'),
        style: const TextStyle(fontWeight: FontWeight.w600, color: _ink),
      ),
      BitPosInfoLine(
        thai: widget.thai,
        summary: t('เลือกรับที่ร้านหรือจัดส่ง ยังไม่เก็บเงินตอนสั่ง', 'Pickup or delivery. No payment when ordering'),
        title: t('เกี่ยวกับการสั่ง', 'About ordering'),
        paragraphs: [
          t(
            'เลือกรับที่ร้านหรือจัดส่ง ราคามาจากร้านโดยตรง แต่ละร้านแยกกัน ไม่มีการเก็บเงินตอนสั่ง ชำระจากหน้าออเดอร์',
            'Choose pickup or delivery. The branch prices your items; each branch is separate. Placing the order takes no payment: pay from your Orders.',
          ),
        ],
        style: const TextStyle(fontSize: 12, color: _muted),
      ),
      for (final b in branchIds) ...[
        const SizedBox(height: 10),
        Text(
          '${t('ร้าน', 'Branch')} #${b.substring(0, 8)}',
          style: const TextStyle(fontWeight: FontWeight.w600),
        ),
        if (_placed[_checkoutKey(b)] == null) _servingControls(b),
        if (_placed[_checkoutKey(b)] != null)
          Text(
            '${t('สั่งแล้ว', 'Order placed')} #${_placed[_checkoutKey(b)]!.substring(0, 8)}',
            key: ValueKey('group-placed.$b'),
          )
        else if (_quotes[_checkoutKey(b)] != null) ...[
          Text(
            rideMoneyText(_quotes[_checkoutKey(b)]!.total),
            key: ValueKey('group-quote.$b'),
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w600,
              color: _ink,
            ),
          ),
          FilledButton(
            key: ValueKey('group-place.$b'),
            onPressed: _busy ? null : () => _placeMine(b),
            child: Text(
              _pending.containsKey(_checkoutKey(b))
                  ? t('ตรวจสอบคำสั่งเดิม', 'Retry the same order')
                  : _delivery[_checkoutKey(b)] == true
                  ? t('สั่งจัดส่ง', 'Place delivery order')
                  : t('สั่งรับที่ร้าน', 'Place pickup order'),
            ),
          ),
        ] else
          OutlinedButton(
            key: ValueKey('group-quote-btn.$b'),
            onPressed:
                _busy ||
                    (_delivery[_checkoutKey(b)] == true &&
                        !_availableAddress(
                          _addresses[_checkoutKey(b)],
                          _policies[_checkoutKey(b)],
                        ))
                ? null
                : () => _quoteMine(b),
            child: Text(t('ดูราคา', 'Get my price')),
          ),
      ],
    ]);
  }

  Widget _card(List<Widget> children) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: _border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );

  String _stateText(String s) => switch (s) {
    'OPEN' => t('เปิด', 'Open'),
    'LOCKED' => t('ล็อกแล้ว', 'Locked'),
    _ => t('ยกเลิก', 'Cancelled'),
  };

  Widget _list() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _card([
        FilledButton(
          key: const ValueKey('group-create'),
          onPressed: _busy ? null : _create,
          child: Text(t('สร้างกลุ่มสั่งอาหาร', 'Create a group')),
        ),
        const SizedBox(height: 14),
        TextField(
          key: const ValueKey('group-code'),
          controller: _code,
          decoration: InputDecoration(
            labelText: t('รหัสเชิญ', 'Invite code'),
            border: const OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 10),
        OutlinedButton(
          key: const ValueKey('group-join'),
          onPressed: _busy ? null : _join,
          child: Text(t('เข้าร่วมกลุ่ม', 'Join group')),
        ),
      ]),
      if (_groups.isEmpty)
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: BitPosStateView(
            key: const ValueKey('group-empty'),
            kind: BitPosStateKind.empty,
            thai: widget.thai,
            title: t('ยังไม่มีกลุ่ม', 'No groups yet.'),
            message: t(
              'สร้างกลุ่มหรือใช้รหัสเชิญเพื่อสั่งร่วมกับเพื่อน',
              'Create a group or use an invite code to order together.',
            ),
          ),
        )
      else
        for (final g in _groups)
          _card([
            Text(
              '${_stateText(g.state)} · ${g.members.length} ${t('คน', g.members.length == 1 ? 'person' : 'people')}',
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                color: _purple,
              ),
            ),
            Text(
              g.youAreOwner
                  ? t('คุณเป็นเจ้าของ', 'You own this group')
                  : t('คุณเป็นสมาชิก', 'You are a member'),
              style: const TextStyle(color: _muted),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              key: ValueKey('group-open.${g.id}'),
              onPressed: _busy ? null : () => _show(g),
              child: Text(t('เปิด', 'Open')),
            ),
          ]),
    ],
  );

  Widget _detail(MobileGroup g) {
    final me = widget.gateway.accountId();
    final openState = g.state == 'OPEN';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _card([
          Text(
            '${_stateText(g.state)} · ${g.members.length}/12',
            key: const ValueKey('group-state'),
            style: const TextStyle(fontWeight: FontWeight.w600, color: _purple),
          ),
          const SizedBox(height: 6),
          BitPosInfoLine(
            thai: widget.thai,
            summary: t('กลุ่มไม่มีราคารวมหรือการชำระเงิน', 'No group price or payment'),
            title: t('เกี่ยวกับกลุ่ม', 'About groups'),
            paragraphs: [
              t(
                'กลุ่มเก็บเฉพาะรายการที่เลือก ไม่มีราคารวมหรือการชำระเงินของกลุ่ม แต่ละคนสั่งรายการของตัวเองจากร้านตามปกติ',
                'A group keeps selections only. There is no group price or payment: each member orders their own items from the branch as usual.',
              ),
            ],
            style: const TextStyle(fontSize: 12, color: _muted),
          ),
          if (g.state == 'LOCKED')
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                t('ล็อกแล้ว แก้ไขไม่ได้', 'Locked: no more changes.'),
                key: const ValueKey('group-locked'),
              ),
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              if (g.youAreOwner && openState)
                OutlinedButton(
                  key: const ValueKey('group-invite'),
                  onPressed: _busy ? null : _invite,
                  child: Text(t('สร้างรหัสเชิญ', 'Invite')),
                ),
              if (g.youAreOwner && openState)
                FilledButton(
                  key: const ValueKey('group-lock'),
                  onPressed: _busy || g.lines.isEmpty ? null : _lock,
                  child: Text(t('ล็อกกลุ่ม', 'Lock group')),
                ),
              if (g.youAreOwner && g.state != 'CANCELLED')
                OutlinedButton(
                  key: const ValueKey('group-cancel'),
                  onPressed: _busy ? null : _cancel,
                  child: Text(t('ยกเลิกกลุ่ม', 'Cancel group')),
                ),
              if (!g.youAreOwner && openState)
                OutlinedButton(
                  key: const ValueKey('group-leave'),
                  onPressed: _busy ? null : _leave,
                  child: Text(t('ออกจากกลุ่ม', 'Leave')),
                ),
            ],
          ),
          if (_token != null) ...[
            const SizedBox(height: 10),
            SelectableText(_token!, key: const ValueKey('group-token')),
            Row(
              children: [
                Text(
                  t('หมดอายุใน 24 ชั่วโมง', 'Expires in 24 hours'),
                  style: const TextStyle(fontSize: 12, color: _muted),
                ),
                IconButton(
                  tooltip: t('คัดลอก', 'Copy'),
                  onPressed: () =>
                      Clipboard.setData(ClipboardData(text: _token!)),
                  icon: const Icon(Icons.copy, size: 18),
                ),
              ],
            ),
          ],
        ]),
        _card([
          Text(
            t('รายการของทุกคน', 'Everyone\'s items'),
            style: const TextStyle(fontWeight: FontWeight.w600, color: _ink),
          ),
          if (g.lines.isEmpty)
            Text(
              t('ยังไม่มีรายการ', 'No items yet.'),
              key: const ValueKey('group-no-lines'),
            ),
          for (final l in g.lines)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                '${l.accountId == me ? t('คุณ', 'You') : t('สมาชิก', 'Member')} · ${_names[l.productId] ?? '#${l.productId.substring(0, 8)}'} × ${l.qty}',
                key: ValueKey('group-line.${l.accountId}.${l.productId}'),
              ),
            ),
          const SizedBox(height: 6),
          for (final b in g.branches)
            Text(
              '${t('ร้าน', 'Branch')} #${b.branchId.substring(0, 8)}: ${b.qty} ${t('ชิ้น', 'items')} · ${b.members} ${t('คน', 'people')}',
              style: const TextStyle(fontSize: 12, color: _muted),
            ),
        ]),
        if (g.state == 'LOCKED') _checkout(g),
        if (openState)
          _card([
            Text(
              t('เพิ่มรายการของคุณ', 'Add your items'),
              style: const TextStyle(fontWeight: FontWeight.w600, color: _ink),
            ),
            const SizedBox(height: 8),
            if (_branches.isEmpty)
              OutlinedButton(
                key: const ValueKey('group-load-branches'),
                onPressed: _busy ? null : _loadBranches,
                child: Text(t('เลือกร้าน', 'Choose a branch')),
              )
            else
              for (final b in _branches)
                Material(
                  color: Colors.transparent,
                  child: ListTile(
                    key: ValueKey('group-branch.${b.id}'),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    selected: _branch?.id == b.id,
                    title: Text(widget.thai ? b.name : b.nameEn),
                    onTap: _busy ? null : () => _pickBranch(b),
                  ),
                ),
            if (_branch != null)
              for (final p in _products)
                Row(
                  children: [
                    Expanded(child: Text(widget.thai ? p.name : p.nameEn)),
                    IconButton(
                      key: ValueKey('group-minus.${p.id}'),
                      onPressed: _busy || _mine(_branch!.id, p.id) == 0
                          ? null
                          : () => _setQty(p, _mine(_branch!.id, p.id) - 1),
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    Text(
                      '${_mine(_branch!.id, p.id)}',
                      key: ValueKey('group-qty.${p.id}'),
                    ),
                    IconButton(
                      key: ValueKey('group-plus.${p.id}'),
                      onPressed:
                          _busy || p.available <= _mine(_branch!.id, p.id)
                          ? null
                          : () => _setQty(p, _mine(_branch!.id, p.id) + 1),
                      icon: const Icon(Icons.add_circle_outline),
                    ),
                  ],
                ),
          ]),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: _bg,
    appBar: AppBar(
      backgroundColor: _bg,
      toolbarHeight: BitPosLayout.toolbarHeight,
      leadingWidth: BitPosLayout.leadingWidth,
      titleSpacing: 0,
      leading: _open == null
          ? const BitPosBackButton()
          : BitPosBackButton(
              key: const ValueKey('group-back'),
              onPressed: () => setState(() {
                _open = null;
                _token = null;
                _branch = null;
                _branches = const [];
                _load();
              }),
            ),
      title: Text(
        t('สั่งเป็นกลุ่ม', 'Group order'),
        style: const TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: _ink,
        ),
      ),
    ),
    body: SafeArea(
      child: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
              children: [
                if (_error != null)
                  Container(
                    key: const ValueKey('group-error'),
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _tile,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(_error!),
                  ),
                if (_open != null) _detail(_open!) else _list(),
              ],
            ),
    ),
  );
}
