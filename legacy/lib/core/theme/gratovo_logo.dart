import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// The Gratovo mark, rendered from the vector source (assets/images/logo.svg)
/// rather than the ~1MB PNG export — the same gradient icon at a fraction of
/// the asset weight, and crisp at every size this is drawn at (AppBar
/// branding, the nav-rail Home icon).
class GratovoLogo extends StatelessWidget {
  const GratovoLogo({super.key, this.size = 40, this.flat = false});

  final double size;

  /// When true, the gradient is dropped in favor of a single flat color
  /// taken from the ambient [IconTheme] — for use as a nav-bar/rail icon,
  /// so the Home destination dims/tints in step with every other
  /// destination's icon rather than staying permanently full-color.
  final bool flat;

  @override
  Widget build(BuildContext context) {
    final tint = flat ? IconTheme.of(context).color : null;
    return SvgPicture.asset(
      'assets/images/logo.svg',
      width: size,
      height: size,
      colorFilter:
          tint == null ? null : ColorFilter.mode(tint, BlendMode.srcIn),
    );
  }
}
