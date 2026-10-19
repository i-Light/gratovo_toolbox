import 'package:flutter/material.dart';

/// Debug-only pixel zoom. `DebugScale` visually magnifies (or shrinks)
/// everything under it by this factor — including hardcoded pixel sizes
/// that never go through `uiScale`/`sp()` (responsive.dart) — rather than
/// only reacting to widgets that read `MediaQuery`. Only ever mounted
/// inside `kDebugMode` branches (see app.dart), so it has no effect on
/// release/profile builds.
final ValueNotifier<double> debugUiScaleNotifier = ValueNotifier<double>(1);

const double kDebugScaleMin = 0.1;
const double kDebugScaleMax = 2.5;
const double _kDebugScaleStep = 0.1;

/// Magnifies [child] by [debugUiScaleNotifier] with `Transform.scale`.
///
/// A bare `Transform.scale` isn't enough on its own: it repaints the child
/// bigger/smaller, but the *layout box* the parent reserves for it never
/// changes size, so scaling up overflows into siblings (or gets clipped)
/// and scaling down leaves dead space. This works around that the way
/// `device_preview` does — laying `child` out at a "virtual" size of
/// `realSize / scale` inside an `OverflowBox`, then scaling that box back
/// up to exactly fill `realSize`, and overriding `MediaQuery.size` to match
/// the virtual size so `uiScale`/breakpoint logic stays consistent with
/// what was actually laid out. Flutter's `Transform` already redirects
/// hit-testing through the inverse matrix, so taps land where things
/// visually appear at any scale — no extra handling needed for that part.
class DebugScale extends StatelessWidget {
  const DebugScale({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<double>(
      valueListenable: debugUiScaleNotifier,
      builder: (context, scale, child) {
        if (scale == 1) return child!;
        return LayoutBuilder(
          builder: (context, constraints) {
            final realSize = constraints.biggest;
            final virtualSize = realSize / scale;
            return ClipRect(
              child: OverflowBox(
                alignment: Alignment.topLeft,
                minWidth: virtualSize.width,
                maxWidth: virtualSize.width,
                minHeight: virtualSize.height,
                maxHeight: virtualSize.height,
                child: MediaQuery(
                  data: MediaQuery.of(context).copyWith(size: virtualSize),
                  child: Transform.scale(
                    scale: scale,
                    alignment: Alignment.topLeft,
                    child: SizedBox.fromSize(size: virtualSize, child: child),
                  ),
                ),
              ),
            );
          },
        );
      },
      child: child,
    );
  }
}

/// Floating +/- control for [debugUiScaleNotifier].
///
/// Deliberately mounted as a `Stack` sibling of [DebugScale] rather than
/// inside it, so the control's own size stays fixed and legible no matter
/// what scale it's currently driving.
class DebugScaleControls extends StatelessWidget {
  const DebugScaleControls({super.key});

  @override
  Widget build(BuildContext context) {
    return Positioned(
      right: 12,
      bottom: 12,
      child: SafeArea(
        child: Material(
          color: Colors.black38,
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: ValueListenableBuilder<double>(
              valueListenable: debugUiScaleNotifier,
              builder: (context, scale, _) {
                return Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _DebugScaleButton(
                      icon: Icons.remove,
                      tooltip: 'Simulate smaller window',
                      onPressed: () => debugUiScaleNotifier.value =
                          (scale - _kDebugScaleStep)
                              .clamp(kDebugScaleMin, kDebugScaleMax),
                    ),
                    GestureDetector(
                      onTap: () => debugUiScaleNotifier.value = 1,
                      child: SizedBox(
                        width: 36,
                        child: Text(
                          '${scale.toStringAsFixed(1)}x',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ),
                    _DebugScaleButton(
                      icon: Icons.add,
                      tooltip: 'Simulate larger window',
                      onPressed: () => debugUiScaleNotifier.value =
                          (scale + _kDebugScaleStep)
                              .clamp(kDebugScaleMin, kDebugScaleMax),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class _DebugScaleButton extends StatelessWidget {
  const _DebugScaleButton({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    // Plain InkWell rather than IconButton(tooltip: ...): this control sits
    // in MaterialApp.router's `builder`, above the Router's own Navigator —
    // so it's above that Navigator's Overlay too. Tooltip now requires an
    // Overlay ancestor just to build (not only to show), which throws here.
    // A Semantics label keeps this accessible without needing one.
    return Semantics(
      button: true,
      label: tooltip,
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(16),
        child: SizedBox(
          width: 32,
          height: 32,
          child: Icon(icon, color: Colors.white, size: 16),
        ),
      ),
    );
  }
}
