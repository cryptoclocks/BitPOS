import 'presentation/favourite_branch_card.dart';
import 'presentation/customer_navigation.dart';

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class FavouritesSheet extends StatefulWidget {
  const FavouritesSheet({
    super.key,
    required this.api,
    required this.firstPage,
    required this.thai,
    required this.onAuthenticationRequired,
    this.onNavigate,
  });
  final MobileApi api;
  final MobileFavourites firstPage;
  final bool thai;
  final VoidCallback onAuthenticationRequired;
  final ValueChanged<int>? onNavigate;
  @override
  State<FavouritesSheet> createState() => _FavouritesSheetState();
}

class _FavouritesSheetState extends State<FavouritesSheet> {
  late MobileFavourites page = widget.firstPage;
  bool busy = false;
  String? error;
  final search = TextEditingController();
  String query = '';
  @override
  void dispose() {
    search.dispose();
    super.dispose();
  }

  String t(String th, String en) => widget.thai ? th : en;
  Future<void> run(Future<void> Function() action) async {
    if (busy) return;
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) {
        if (e is MobileApiException &&
            e.code == 'AUTH_REQUIRED' &&
            !widget.api.signedIn) {
          widget.onAuthenticationRequired();
          return;
        }
        setState(
          () => error = t(
            'โหลดหรือบันทึกไม่สำเร็จ กรุณาโหลดสถานะล่าสุดก่อนลองใหม่',
            'Could not load or save. Refresh server state before retrying.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  bool matches(MobileFavouriteBranch item) {
    final branch = item.branch;
    return query.isEmpty ||
        branch != null &&
            [
              branch.name,
              branch.nameEn,
              branch.merchantName,
              branch.addressLabel,
            ].any((value) => value.toLowerCase().contains(query));
  }

  @override
  Widget build(BuildContext context) {
    final safeTop = MediaQuery.paddingOf(context).top;
    final insetScale = ((safeTop - 24) / 28).clamp(0.0, 1.0);
    final content = SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(24, 24 + 4 * insetScale, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Transform.translate(
              offset: const Offset(-6, 0),
              child: Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Row(
                  children: [
                    SizedBox(
                      width: 44,
                      height: 44,
                      child: IconButton(
                        tooltip: t('กลับ', 'Back'),
                        onPressed: () => Navigator.pop(context),
                        style: IconButton.styleFrom(
                          backgroundColor: Colors.white,
                          foregroundColor: const Color(0xff64188a),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                            side: const BorderSide(color: Color(0xffe9e1f1)),
                          ),
                        ),
                        icon: const Icon(Icons.chevron_left, size: 22),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Text(
                        t('ร้านโปรดของคุณ', 'Your favourites'),
                        style: const TextStyle(
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
            SizedBox(height: 22 + 10 * insetScale),
            ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 52),
              child: TextField(
                controller: search,
                onChanged: (value) =>
                    setState(() => query = value.trim().toLowerCase()),
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: t(
                    'ค้นหาร้าน เมนู หรือเครื่องดื่ม',
                    'Search restaurants, menu or drinks',
                  ),
                  suffixIcon: query.isEmpty
                      ? null
                      : IconButton(
                          tooltip: t('ล้างคำค้น', 'Clear search'),
                          onPressed: () {
                            search.clear();
                            setState(() => query = '');
                          },
                          icon: const Icon(Icons.close),
                        ),
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 14,
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                    borderSide: const BorderSide(color: Color(0xffe9e1f1)),
                  ),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(14),
                  ),
                ),
              ),
            ),
            SizedBox(height: 28 - 3 * insetScale),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                t(
                  'บันทึกร้านอร่อยไว้ แล้วกลับมาสั่งได้เสมอ',
                  'Save favourites to order again.',
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: Color(0xff7b7088)),
              ),
            ),
            const SizedBox(height: 5),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                t('ร้านที่คุณเลือก', 'Your saved places'),
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w600,
                  color: Color(0xff29183f),
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (busy) const LinearProgressIndicator(),
            if (error != null)
              Text(
                error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            Expanded(
              child: ListView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                shrinkWrap: false,
                children: [
                  if (page.items.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 32),
                      child: Text(
                        t(
                          'ยังไม่มีร้านโปรด กดหัวใจที่รายการร้านเพื่อบันทึก',
                          'No favourites yet. Tap a merchant’s heart to save it.',
                        ),
                      ),
                    ),
                  if (page.items.isNotEmpty && !page.items.any(matches))
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        t(
                          'ไม่พบร้านโปรดที่ตรงคำค้นในหน้านี้',
                          'No matching favourites on this page.',
                        ),
                      ),
                    ),
                  for (final item in page.items.where(matches))
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: FavouriteBranchCard(
                        item: item,
                        thai: widget.thai,
                        onOpen: busy || item.branch == null
                            ? null
                            : () => Navigator.pop(context, item.branch),
                        onRemove: busy
                            ? null
                            : () => run(() async {
                                await widget.api.setFavourite(
                                  item.branchId,
                                  false,
                                );
                                final next = await widget.api.favourites();
                                if (mounted) setState(() => page = next);
                              }),
                      ),
                    ),
                ],
              ),
            ),
            Wrap(
              spacing: 12,
              children: [
                OutlinedButton(
                  onPressed: busy
                      ? null
                      : () => run(() async {
                          final next = await widget.api.favourites();
                          if (mounted) setState(() => page = next);
                        }),
                  child: Text(t('โหลดใหม่', 'Refresh')),
                ),
                if (page.nextCursor != null)
                  OutlinedButton(
                    onPressed: busy
                        ? null
                        : () => run(() async {
                            final next = await widget.api.favourites(
                              cursor: page.nextCursor,
                            );
                            if (mounted) setState(() => page = next);
                          }),
                    child: Text(t('หน้าถัดไป', 'Next page')),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
    if (widget.onNavigate == null) return content;
    return Scaffold(
      backgroundColor: const Color(0xfff8f5fc),
      // Keep search visible while the OS keyboard covers the lower list.
      resizeToAvoidBottomInset: false,
      body: content,
      bottomNavigationBar: MediaQuery.viewInsetsOf(context).bottom > 0
          ? null
          : CustomerNavigation(
              thai: widget.thai,
              selectedIndex: 2,
              onSelected: busy ? null : widget.onNavigate,
            ),
    );
  }
}
