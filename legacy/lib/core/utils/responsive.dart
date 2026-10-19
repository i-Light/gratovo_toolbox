import 'package:flutter/widgets.dart';

/// Screen-size breakpoints and a single dynamic scale factor used
/// everywhere instead of hard-coded font sizes.
///
/// The app is used on very different screens (a phone, a 1080p laptop, a
/// 2K monitor), and a font size that looks right on one looks wrong on the
/// others. [uiScale] maps the current window width to a multiplier that:
///   * shrinks text/controls slightly on narrow phones,
///   * stays close to 1.0 on typical 1080p laptop windows,
///   * grows moderately on very wide / high-resolution monitors,
/// and is always clamped so nothing becomes unreadably small or
/// comically large.
extension ResponsiveContext on BuildContext {
  Size get _size => MediaQuery.sizeOf(this);

  double get screenWidth => _size.width;
  double get screenHeight => _size.height;

  /// Phones and small windows.
  bool get isMobile => screenWidth < 700;

  /// Tablets / split-screen / small windows that aren't quite desktop.
  bool get isTablet => screenWidth >= 700 && screenWidth < 1100;

  /// Laptops, desktops, and wide browser windows.
  bool get isDesktop => screenWidth >= 1100;

  /// Dynamic multiplier applied to font sizes, icon sizes and spacing.
  ///
  /// Reference baselines:
  ///   * Desktop baseline: 1440 logical px (a typical 1080p window).
  ///   * Tablet baseline: 900 logical px.
  ///   * Phone baseline: 390 logical px (an average modern phone).
  double get uiScale {
    final width = screenWidth;
    if (isDesktop) {
      return (width / 1440).clamp(0.85, 1.45).toDouble();
    }
    if (isTablet) {
      return (width / 900).clamp(0.9, 1.1).toDouble();
    }
    return (width / 390).clamp(0.82, 1.2).toDouble();
  }

  /// Scales a base font/icon size by [uiScale].
  double sp(double base) => base * uiScale * 14;
}
