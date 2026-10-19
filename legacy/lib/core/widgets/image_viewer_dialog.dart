import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/images/remote_image.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// One picture, full size, zoomable and pannable.
///
/// Exists because judging a channel is partly a visual judgement, and the
/// avatar at 22 pixels and the banner at 72 are decorations rather than
/// something anyone can actually look at. A banner in particular is where the
/// creator writes their upload schedule, their contact address and their
/// sponsorship terms — text that is unreadable at card size and is the whole
/// reason to open it.
class ImageViewerDialog extends StatefulWidget {
  const ImageViewerDialog({
    super.key,
    required this.url,
    required this.title,
    this.circular = false,
  });

  final String url;
  final String title;

  /// Profile pictures are shown as circles everywhere else in the app; keeping
  /// that here means the enlarged view is recognisably the same thing rather
  /// than a square that appeared from nowhere.
  final bool circular;

  /// Opens the viewer, or does nothing when [url] is not a picture worth
  /// trying — so a caller can wire this to a tap without first repeating the
  /// "is there actually a banner" check.
  static Future<void> show(
    BuildContext context, {
    required String? url,
    required String title,
    bool circular = false,
  }) {
    if (!isUsableImageUrl(url)) return Future.value();
    return showDialog<void>(
      context: context,
      // Barrier tap closes it, which is what everyone tries first.
      builder: (context) => ImageViewerDialog(
        url: url!.trim(),
        title: title,
        circular: circular,
      ),
    );
  }

  @override
  State<ImageViewerDialog> createState() => _ImageViewerDialogState();
}

class _ImageViewerDialogState extends State<ImageViewerDialog> {
  final _controller = TransformationController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Double-tap toggles between fit and 2.5x, anchored on the tapped point.
  ///
  /// Without an anchor, zooming in always lands on the middle of the image,
  /// which on a 2048x1152 banner is exactly where nothing is written.
  void _toggleZoom(TapDownDetails details) {
    if (_controller.value != Matrix4.identity()) {
      setState(() => _controller.value = Matrix4.identity());
      return;
    }
    const scale = 2.5;
    final position = details.localPosition;
    setState(() {
      _controller.value = Matrix4.identity()
        ..translateByDouble(
          -position.dx * (scale - 1),
          -position.dy * (scale - 1),
          0,
          1,
        )
        ..scaleByDouble(scale, scale, scale, 1);
    });
  }

  Widget _picture() {
    final image = RemoteImage(
      url: widget.url,
      fit: BoxFit.contain,
      fallback: const Padding(
        padding: EdgeInsets.all(48),
        child: Icon(Icons.image_not_supported_outlined, size: 48),
      ),
    );
    return widget.circular ? ClipOval(child: image) : image;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final isZoomed = _controller.value != Matrix4.identity();

    return Dialog(
      // Wider than the default dialog: a banner is 16:9 and the point of
      // opening it is to see it large.
      insetPadding: const EdgeInsets.all(24),
      clipBehavior: Clip.antiAlias,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: theme.textTheme.titleMedium,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isZoomed)
                  IconButton(
                    tooltip: l10n.influencerProfileImageResetZoom,
                    icon: const Icon(Icons.zoom_out_map),
                    onPressed: () => setState(
                      () => _controller.value = Matrix4.identity(),
                    ),
                  ),
                IconButton(
                  tooltip: l10n.influencerProfileImageClose,
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          Flexible(
            child: GestureDetector(
              onDoubleTapDown: _toggleZoom,
              // The empty handler is required: without it, onDoubleTapDown
              // never fires, because the recogniser only arms when there is a
              // double-tap callback to arm it for.
              onDoubleTap: () {},
              child: InteractiveViewer(
                transformationController: _controller,
                minScale: 1,
                maxScale: 6,
                child: Center(child: _picture()),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              l10n.influencerProfileImageZoomHint,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
