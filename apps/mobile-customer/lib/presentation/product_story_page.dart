import 'package:flutter/material.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:video_player/video_player.dart';

import 'food_presentation.dart';

/// True when the shop gave this product a story, a video or any descriptive text worth a detail page.
bool hasProductStory(MobileProduct p) {
  final s = p.story;
  return s.videoUrl.isNotEmpty ||
      [s.story, s.storyEn, s.ingredients, s.ingredientsEn, s.benefits, s.benefitsEn]
          .any((value) => value.trim().isNotEmpty);
}

/// Product detail: a short muted loop on top, then the shop's own story, ingredients and benefits as text.
/// Text is the shop's wording from the POS; the video carries no text. [playVideo] is off in widget tests.
class ProductStoryPage extends StatefulWidget {
  const ProductStoryPage({
    super.key,
    required this.product,
    required this.thai,
    this.onConfigure,
    this.playVideo = true,
  });
  final MobileProduct product;
  final bool thai;
  final VoidCallback? onConfigure;
  final bool playVideo;

  @override
  State<ProductStoryPage> createState() => _ProductStoryPageState();
}

class _ProductStoryPageState extends State<ProductStoryPage> {
  VideoPlayerController? _video;
  bool _videoFailed = false;

  @override
  void initState() {
    super.initState();
    final url = widget.product.story.videoUrl;
    if (widget.playVideo && url.isNotEmpty) {
      final controller = VideoPlayerController.networkUrl(
        Uri.parse(resolveMediaUrl(url)),
        videoPlayerOptions: VideoPlayerOptions(mixWithOthers: true),
      );
      _video = controller;
      controller
          .initialize()
          .then((_) {
            if (!mounted) return;
            controller
              ..setLooping(true)
              ..setVolume(0)
              ..play();
            setState(() {});
          })
          .catchError((Object _) {
            if (mounted) setState(() => _videoFailed = true);
          });
    }
  }

  @override
  void dispose() {
    _video?.dispose();
    super.dispose();
  }

  String t(String th, String en) => widget.thai ? th : en;

  /// The wanted language first; the other one when the shop only wrote that.
  String pick(String th, String en) {
    final first = widget.thai ? th : en, second = widget.thai ? en : th;
    return first.trim().isNotEmpty ? first : second.trim();
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product, s = p.story;
    final colors = Theme.of(context).colorScheme;
    final name = pick(p.name, p.nameEn);
    final story = pick(s.story, s.storyEn);
    final ingredients = pick(s.ingredients, s.ingredientsEn);
    final benefits = pick(s.benefits, s.benefitsEn);
    final video = _video;
    final playing =
        video != null && video.value.isInitialized && !_videoFailed;
    Widget section(IconData icon, String title, String body) => Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: colors.primary),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 4),
                Text(body, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      ),
    );
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          BitPosDesignTokens.s20,
          0,
          BitPosDesignTokens.s20,
          BitPosDesignTokens.s20,
        ),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: AspectRatio(
              aspectRatio: 1,
              child: playing
                  ? FittedBox(
                      fit: BoxFit.cover,
                      clipBehavior: Clip.hardEdge,
                      child: SizedBox(
                        width: video.value.size.width,
                        height: video.value.size.height,
                        child: VideoPlayer(video),
                      ),
                    )
                  : FoodImage(
                      url: p.imageUrl,
                      hero: true,
                      emoji: foodEmoji(
                        name: p.name,
                        nameEn: p.nameEn,
                        category: p.category,
                      ),
                    ),
            ),
          ),
          const SizedBox(height: 16),
          Text(name, style: Theme.of(context).textTheme.headlineSmall),
          if (story.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(story, style: Theme.of(context).textTheme.bodyLarge),
          ],
          if (ingredients.isNotEmpty)
            section(Icons.eco_outlined, t('ส่วนประกอบ', 'Ingredients'), ingredients),
          if (benefits.isNotEmpty)
            section(Icons.favorite_border, t('ข้อดีของเมนูนี้', 'Why you will like it'), benefits),
          if (story.isEmpty && ingredients.isEmpty && benefits.isEmpty)
            Text(
              t('ร้านยังไม่ได้เขียนเรื่องราวของเมนูนี้', 'The shop has not written a story for this item yet.'),
              style: Theme.of(context).textTheme.bodyMedium,
            ),
        ],
      ),
      bottomNavigationBar: widget.onConfigure == null
          ? null
          : SafeArea(
              minimum: const EdgeInsets.all(BitPosDesignTokens.s20),
              child: FilledButton(
                onPressed: () {
                  Navigator.of(context).pop();
                  widget.onConfigure!();
                },
                child: Text(t('เลือก / เพิ่มลงตะกร้า', 'Configure / add to cart')),
              ),
            ),
    );
  }
}
