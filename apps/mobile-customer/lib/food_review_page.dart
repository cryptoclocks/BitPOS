import 'presentation/review_rating_group.dart';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/review_mutation.dart';
import 'package:mobile_shared/owned_route.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'presentation/customer_navigation.dart';

class FoodReviewPage extends StatefulWidget {
  const FoodReviewPage({
    super.key,
    required this.api,
    required this.orderId,
    required this.thai,
    required this.owner,
    required this.onAuthenticationRequired,
    this.deliveryCompleteScreen = false,
    this.orderTotal,
    this.onViewReceipt,
    this.onNavigationSelected,
  });
  final MobileApi api;
  final String orderId;
  final bool thai;
  final ValueListenable<bool>? owner;
  final VoidCallback onAuthenticationRequired;
  final bool deliveryCompleteScreen;
  final MobileMoney? orderTotal;
  final VoidCallback? onViewReceipt;
  final ValueChanged<int>? onNavigationSelected;
  @override
  State<FoodReviewPage> createState() => _FoodReviewPageState();
}

class _FoodReviewPageState extends State<FoodReviewPage> {
  final body = TextEditingController();
  MobileFoodReviewSnapshot? snapshot;
  ReviewMutation? pending;
  int stars = 0;
  int? driverStars;
  bool busy = true;
  String? error;
  ModalRoute<dynamic>? route;
  bool get current => mounted && (widget.owner?.value ?? true);
  String t(String th, String en) => widget.thai ? th : en;
  @override
  void initState() {
    super.initState();
    widget.owner?.addListener(ownerChanged);
    if (widget.owner?.value ?? true) run(load, initial: true);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    route = ModalRoute.of(context);
    if (widget.owner?.value == false) {
      WidgetsBinding.instance.addPostFrameCallback((_) => ownerChanged());
    }
  }

  void ownerChanged() {
    if (widget.owner?.value == false) removeOwnedRoute(route);
  }

  @override
  void dispose() {
    widget.owner?.removeListener(ownerChanged);
    body.dispose();
    super.dispose();
  }

  Future<void> run(
    Future<void> Function() action, {
    bool initial = false,
  }) async {
    if (!current || busy && !initial) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (current) {
        if (e is MobileApiException &&
            e.code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn) {
          widget.onAuthenticationRequired();
        } else {
          setState(
            () =>
                error = e is MobileApiException && e.code == 'VERSION_CONFLICT'
                ? t(
                    'สถานะเปลี่ยนแล้ว โหลดข้อมูลล่าสุดก่อนส่งอีกครั้ง',
                    'Facts changed. Refresh before submitting again.',
                  )
                : t(
                    'ดำเนินการไม่สำเร็จ โหลดข้อมูลหรือกู้คืนคำขอเดิม',
                    'Could not complete. Refresh or recover the saved request.',
                  ),
          );
        }
      }
    } finally {
      if (current) setState(() => busy = false);
    }
  }

  Future<void> load() async {
    final saved = await widget.api.pendingReviewMutation();
    if (!current) return;
    pending = saved;
    final next = await widget.api.foodReview(widget.orderId);
    if (!current) return;
    setState(() {
      snapshot = next;
      stars = next.review?.stars ?? 0;
      driverStars = next.review?.driverStars;
      body.text = next.review?.body ?? '';
    });
  }

  Future<void> submit(ReviewMutation command) async {
    setState(() => pending = command);
    try {
      await widget.api.submitReviewMutation(command);
    } finally {
      if (current) {
        final saved = await widget.api.pendingReviewMutation();
        if (current) setState(() => pending = saved);
      }
    }
    if (current) await load();
  }

  String state(String value) => switch (value) {
    'PUBLISHED' => t('เผยแพร่แล้ว', 'Published'),
    'REJECTED' => t(
      'กรุณาแก้ไขก่อนส่งตรวจอีกครั้ง',
      'Update before resubmitting',
    ),
    'WITHDRAWN' => t('ถอนรีวิวแล้ว', 'Withdrawn'),
    _ => t('รอตรวจสอบก่อนเผยแพร่', 'Awaiting moderation'),
  };
  @override
  Widget build(BuildContext context) {
    final data = snapshot,
        review = data?.review,
        locked = busy || pending != null;
    final changed =
        review == null ||
        review.state == 'WITHDRAWN' ||
        review.stars != stars ||
        review.driverStars != driverStars ||
        review.body != body.text.trim();
    return Scaffold(
      bottomNavigationBar: widget.deliveryCompleteScreen
          ? ColoredBox(
              color: Colors.white,
              child: SafeArea(
                top: false,
                child: CustomerNavigation(
                  thai: widget.thai,
                  selectedIndex: 1,
                  onSelected: widget.onNavigationSelected,
                ),
              ),
            )
          : null,
      appBar: AppBar(
        centerTitle: false,
        toolbarHeight: 72,
        leadingWidth: 84,
        titleSpacing: 0,
        leading: Padding(
          padding: const EdgeInsets.fromLTRB(24, 12, 12, 12),
          child: IconButton.filledTonal(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            onPressed: () => Navigator.maybePop(context),
            style: IconButton.styleFrom(
              backgroundColor: Theme.of(context).brightness == Brightness.dark
                  ? Theme.of(context).colorScheme.surface
                  : Colors.white,
              foregroundColor: Theme.of(context).brightness == Brightness.dark
                  ? Theme.of(context).colorScheme.onSurface
                  : const Color(0xff64188a),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
            icon: const Icon(Icons.chevron_left, size: 22),
          ),
        ),
        title: widget.deliveryCompleteScreen
            ? Text(
                t('อิ่มอร่อยได้เลย', 'Enjoy your meal'),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              )
            : Text(
                t('มื้อนี้เป็นอย่างไรบ้าง?', 'How was your meal?'),
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w600,
                ),
              ),
      ),
      body: ListView(
        primary: widget.deliveryCompleteScreen ? false : null,
        padding: widget.deliveryCompleteScreen
            ? const EdgeInsets.fromLTRB(24, 31, 24, 16)
            : const EdgeInsets.all(24),
        children: widget.deliveryCompleteScreen
            ? [
                if (busy) const LinearProgressIndicator(),
                if (error != null)
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (data != null) ...[
                  Center(
                    child: CircleAvatar(
                      radius: 54,
                      backgroundColor: const Color(0xffe8f5ed),
                      child: const Icon(
                        Icons.check,
                        size: 48,
                        color: Color(0xff217657),
                      ),
                    ),
                  ),
                  const SizedBox(height: 32),
                  Text(
                    t('ส่งถึงมือคุณแล้ว', 'Delivered to you'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${t('ออเดอร์', 'Order')} #${widget.orderId.substring(0, 8)}${widget.orderTotal == null ? '' : ' · ${formatMinorUnits(widget.orderTotal!.amountMinor, widget.orderTotal!.decimals, widget.orderTotal!.currency)}'}',
                    textAlign: TextAlign.center,
                  ),
                  if (review != null) ...[
                    const SizedBox(height: 8),
                    Text(state(review.state), textAlign: TextAlign.center),
                  ],
                  const SizedBox(height: 40),
                  Transform.translate(
                    offset: const Offset(-8.5, 0),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        for (var n = 1; n <= 5; n++)
                          SizedBox(
                            width: 51,
                            child: IconButton(
                              tooltip: '$n / 5',
                              onPressed: locked || !data.eligible
                                  ? null
                                  : () => setState(() => stars = n),
                              icon: Icon(
                                n <= stars ? Icons.star : Icons.star_border,
                                size: 32,
                                color: const Color(0xffff8500),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 36),
                  Text(
                    t('บอกเล่าประสบการณ์ของคุณ', 'Share your experience'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 3),
                  TextField(
                    controller: body,
                    onChanged: (_) => setState(() {}),
                    enabled: !locked && data.eligible,
                    maxLength: 2000,
                    minLines: 1,
                    maxLines: 1,
                    style: const TextStyle(fontSize: 15),
                    decoration: InputDecoration(
                      counterText: widget.deliveryCompleteScreen ? '' : null,
                      filled: true,
                      fillColor: Theme.of(context).brightness == Brightness.dark
                          ? Theme.of(context).colorScheme.surface
                          : Colors.white,
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(
                          color: Theme.of(context).brightness == Brightness.dark
                              ? Theme.of(context).colorScheme.outline
                              : const Color(0xffe9e1f1),
                        ),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      hintText: t(
                        'อาหารอร่อย ไรเดอร์ส่งไว...',
                        'Great food, delivered quickly...',
                      ),
                    ),
                  ),
                  const SizedBox(height: 76),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed:
                        locked || !data.eligible || stars == 0 || !changed
                        ? null
                        : () => run(
                            () => submit(
                              widget.api.newFoodReview(
                                widget.orderId,
                                review?.version ?? '0',
                                stars: stars,
                                driverStars: driverStars,
                                body: body.text,
                              ),
                            ),
                          ),
                    child: Text(t('ส่งรีวิว', 'Submit review')),
                  ),
                  const SizedBox(height: 11),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(52),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: widget.onViewReceipt,
                    child: Text(t('ดูใบเสร็จ', 'View receipt')),
                  ),
                  if (!data.eligible) ...[
                    const SizedBox(height: 12),
                    Text(
                      t(
                        'รีวิวได้เมื่อเซิร์ฟเวอร์ยืนยันการส่งมอบแล้ว',
                        'Reviews open after the server confirms delivery',
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ],
                const SizedBox(height: 16),
              ]
            : [
                if (busy) const LinearProgressIndicator(),
                if (error != null)
                  Text(
                    error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                if (pending != null)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          Text(
                            t(
                              'มีรีวิวที่ยังไม่ได้ยืนยันผล กู้คืนคำขอเดิมก่อน',
                              'A saved review has an unconfirmed result. Recover it first.',
                            ),
                          ),
                          FilledButton(
                            onPressed: busy
                                ? null
                                : () => run(() => submit(pending!)),
                            child: Text(
                              t('กู้คืนรีวิวเดิม', 'Recover saved review'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (data != null) ...[
                  const SizedBox(height: 24),
                  Center(
                    child: CircleAvatar(
                      radius: 54,
                      backgroundColor: data.eligible
                          ? const Color(0xffe8f5ed)
                          : Theme.of(context)
                                .colorScheme
                                .surfaceContainerHighest,
                      child: Icon(
                        data.eligible ? Icons.check : Icons.schedule,
                        size: 38,
                        color: data.eligible
                            ? const Color(0xff147b55)
                            : Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    data.eligible
                        ? t(
                            'มื้ออาหารนี้เสร็จสมบูรณ์แล้ว',
                            'Your meal is complete',
                          )
                        : t(
                            'รับอาหารแล้วจึงรีวิวได้',
                            'Reviews open after your meal is complete',
                          ),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 23,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${t('ออเดอร์', 'Order')} #${widget.orderId.substring(0, 8)}',
                    textAlign: TextAlign.center,
                  ),
                  if (review != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      child: Text(
                        state(review.state),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  if (review?.feedback.isNotEmpty ?? false)
                    Text(review!.feedback),
                  const SizedBox(height: 24),
                  ReviewRatingGroup(
                    title: t('ให้คะแนนมื้อนี้', 'Rate your meal'),
                    value: stars,
                    thai: widget.thai,
                    onChanged: locked || !data.eligible
                        ? null
                        : (value) => setState(() => stars = value),
                  ),
                  if (data.canRateDriver) ...[
                    const SizedBox(height: 16),
                    ReviewRatingGroup(
                      title: t(
                        'ให้คะแนนไรเดอร์ (ไม่บังคับ)',
                        'Rate your rider (optional)',
                      ),
                      value: driverStars ?? 0,
                      thai: widget.thai,
                      onChanged: locked || !data.eligible
                          ? null
                          : (value) => setState(() => driverStars = value),
                      onClear: driverStars == null || locked
                          ? null
                          : () => setState(() => driverStars = null),
                    ),
                  ],
                  const SizedBox(height: 24),
                  Text(
                    t('บอกเล่าประสบการณ์ของคุณ', 'Share your experience'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: body,
                    onChanged: (_) => setState(() {}),
                    enabled: !locked && data.eligible,
                    maxLength: 2000,
                    minLines: 1,
                    maxLines: 4,
                    style: const TextStyle(fontSize: 15),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: Theme.of(context).brightness == Brightness.dark
                          ? Theme.of(context).colorScheme.surface
                          : Colors.white,
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(
                          color: Theme.of(context).brightness == Brightness.dark
                              ? Theme.of(context).colorScheme.outline
                              : const Color(0xffe9e1f1),
                        ),
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 14,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                      hintText: t(
                        'บอกเล่ามื้ออาหารนี้…',
                        'Tell us about your meal…',
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed:
                        locked || !data.eligible || stars == 0 || !changed
                        ? null
                        : () => run(
                            () => submit(
                              widget.api.newFoodReview(
                                widget.orderId,
                                review?.version ?? '0',
                                stars: stars,
                                driverStars: driverStars,
                                body: body.text,
                              ),
                            ),
                          ),
                    child: Text(
                      review == null || review.state == 'WITHDRAWN'
                          ? t('ส่งรีวิว', 'Submit review')
                          : t('อัปเดตรีวิว', 'Update review'),
                    ),
                  ),
                  if (review != null && review.state != 'WITHDRAWN') ...[
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: locked
                          ? null
                          : () => run(
                              () =>
                                  submit(widget.api.withdrawFoodReview(review)),
                            ),
                      child: Text(
                        t('ถอนรีวิวออกจากหน้าร้าน', 'Withdraw public review'),
                      ),
                    ),
                  ],
                  const SizedBox(height: 12),
                  Text(
                    t(
                      'คะแนนและข้อความจะแสดงต่อสาธารณะหลังผ่านการตรวจเท่านั้น โปรดไม่ใส่เบอร์โทรหรือข้อมูลส่วนตัว',
                      'Ratings and comments become public after moderation. Please omit phone numbers and private information.',
                    ),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: busy ? null : () => run(load),
                  child: Text(t('โหลดสถานะล่าสุด', 'Refresh latest state')),
                ),
              ],
      ),
    );
  }
}
