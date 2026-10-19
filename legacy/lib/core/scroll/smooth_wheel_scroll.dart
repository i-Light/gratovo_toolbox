import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Turns discrete desktop mouse-wheel notches into a continuous eased glide.
///
/// Flutter scrolls the wheel by jumping: every notch calls `forcePixels` on the
/// [ScrollPosition] under the cursor, so a quick spin of a physical wheel lands
/// as a stack of instant ~50px steps — which is the "snappy" feel. This wraps
/// the app, lets [Scrollable] apply its jump as usual (so nested-list routing,
/// hand-off to a parent list at the edge, and platform-default suppression all
/// keep working untouched), then — in a microtask, after the jump but before
/// the frame paints — rewinds that jump and drives the same distance with a
/// [_GlideScrollActivity] instead. Consecutive notches accumulate onto one
/// moving target, so faster spinning still travels the same distance, just
/// glided.
///
/// The glide is a *chase*, not a fixed-length animation: every frame it closes
/// a constant fraction of the gap to the target. That matters for a long spin.
/// A fixed-duration eased tween has to be restarted on every notch, which
/// re-enters the head of the curve dozens of times a second — the velocity
/// pulses instead of holding steady, and the tail of each restart keeps the
/// list drifting on after the wheel stops. A chase has no phase to restart:
/// new notches only move the target, and the motion stays continuous. The
/// chase's time constant is what keeps a fast spin tracking the wheel instead
/// of floating behind it; a far-out cap on how far the target may sit ahead of
/// the list is only a backstop against a stalled ticker.
///
/// Physical mouse wheels only: trackpads already deliver smooth deltas and
/// touch never reaches a pointer signal. A no-op off desktop and on web.
class SmoothWheelScroll extends StatefulWidget {
  const SmoothWheelScroll({super.key, required this.child});

  final Widget child;

  static bool get _supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.windows ||
          defaultTargetPlatform == TargetPlatform.linux ||
          defaultTargetPlatform == TargetPlatform.macOS);

  @override
  State<SmoothWheelScroll> createState() => _SmoothWheelScrollState();
}

class _SmoothWheelScrollState extends State<SmoothWheelScroll>
    with TickerProviderStateMixin {
  /// A wheel that pauses longer than this starts its next glide from where the
  /// list actually sits, instead of piling onto the previous target.
  static const _burstGap = Duration(milliseconds: 220);

  ScrollPosition? _position;
  _GlideScrollActivity? _glide;

  /// Where the list really is, as far as this widget is concerned — the value
  /// the glide last applied, which is *not* `position.pixels` once Flutter has
  /// applied its own jump for the notch being handled.
  double _current = 0;
  double _target = 0;
  Duration _lastEvent = Duration.zero;
  bool _pending = false;

  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    if (event.kind != PointerDeviceKind.mouse) return;
    // Shift+wheel is horizontal scrolling; leave Flutter's own axis flip to it.
    if (HardwareKeyboard.instance.isShiftPressed) return;

    final double delta = event.scrollDelta.dy;
    if (delta == 0) return;

    final ScrollPosition? position = _targetPositionAt(event, delta);
    if (position == null) return;

    // This runs during event dispatch, before the pointer-signal resolver hands
    // the notch to Scrollable — so `pixels` here is still the pre-jump value.
    final Duration now = event.timeStamp;
    final bool sameBurst =
        identical(position, _position) && now - _lastEvent <= _burstGap;

    if (!sameBurst) {
      _current = position.pixels;
      _target = position.pixels;
    } else if (_glide != null) {
      _current = _glide!.value;
    }

    _position = position;
    _lastEvent = now;
    _target = (_target + delta)
        .clamp(position.minScrollExtent, position.maxScrollExtent);

    if (_target == _current || _pending) return;

    // Scrollable applies its own instant jump for this notch synchronously,
    // from the pointer-signal resolver at the end of event dispatch. Rewinding
    // it here — one microtask later, still before the next frame — is
    // invisible, and leaves the glide as the only motion the user sees. One
    // microtask covers however many notches arrived in the same batch.
    _pending = true;
    scheduleMicrotask(_startGlide);
  }

  void _startGlide() {
    _pending = false;
    final ScrollPosition? position = _position;
    if (!mounted ||
        position == null ||
        !position.hasPixels ||
        position is! ScrollActivityDelegate) {
      return;
    }
    if (position.pixels != _current) position.jumpTo(_current);
    // Flutter's own notch handling calls `goIdle`, which disposes whatever
    // activity was running — so the previous glide is already dead by now and
    // a fresh one has to pick up its value. `beginActivity` retires it either
    // way, so there is no case where two glides run on one position.
    final glide = _GlideScrollActivity(
      position: position,
      vsync: this,
      from: _current,
      target: _target,
      onValue: (double value) => _current = value,
    );
    _glide = glide;
    position.beginActivity(glide);
  }

  /// The innermost vertical list under the pointer that can still move by
  /// [delta] — the same one [Scrollable] would pick, including its rule of
  /// passing the event up to a parent list once the inner one is at its edge.
  ///
  /// Returns null when that list sits under a [NoSmoothWheelScroll], which
  /// leaves Flutter's own notch handling as the only thing that moves it.
  ScrollPosition? _targetPositionAt(PointerScrollEvent event, double delta) {
    final HitTestResult result = HitTestResult();
    GestureBinding.instance.hitTestInView(result, event.position, event.viewId);
    // The path runs innermost-first, so everything ahead of the first opt-out
    // marker is inside that marker's subtree.
    final List<HitTestEntry> path = result.path.toList(growable: false);
    int optOutAt = -1;
    for (int i = 0; i < path.length; i++) {
      if (path[i].target is _RenderNoSmoothWheelScroll) {
        optOutAt = i;
        break;
      }
    }
    for (int i = 0; i < path.length; i++) {
      final Object target = path[i].target;
      if (target is! RenderViewportBase || target.axis != Axis.vertical) {
        continue;
      }
      final ViewportOffset offset = target.offset;
      if (offset is! ScrollPosition ||
          offset is! ScrollActivityDelegate ||
          !offset.hasPixels ||
          !offset.hasContentDimensions) {
        continue;
      }
      final double edge =
          delta < 0 ? offset.minScrollExtent : offset.maxScrollExtent;
      if (offset.pixels == edge) continue;
      // An opted-out list that can still move takes the notch itself; gliding
      // the list outside it instead would scroll both at once.
      if (optOutAt >= 0 && i < optOutAt) return null;
      return offset;
    }
    return null;
  }

  @override
  void dispose() {
    _glide?.abandon();
    _glide = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!SmoothWheelScroll._supported) return widget.child;
    return Listener(onPointerSignal: _onPointerSignal, child: widget.child);
  }
}

/// Drives the scroll position toward a target by closing a fixed fraction of
/// the remaining gap each frame, rather than by playing a fixed-length curve.
class _GlideScrollActivity extends ScrollActivity {
  _GlideScrollActivity({
    required ScrollPosition position,
    required TickerProvider vsync,
    required double from,
    required double target,
    required this.onValue,
  })  : _position = position,
        _value = from,
        _target = target,
        _maxLag = position.hasViewportDimension
            ? math.min(_maxLagCap, position.viewportDimension * 1.5)
            : _maxLagCap,
        super(position as ScrollActivityDelegate) {
    _ticker = vsync.createTicker(_tick)..start();
  }

  /// Time to close ~63% of the remaining gap, so ~99% of it is closed in 3x
  /// this. Sits in the same range as Chromium's wheel smoothing; slower than
  /// this and the list reads as lagging the wheel rather than following it.
  static const double _tau = 0.13;

  /// Safety valve, not the normal path: how far the target may run ahead of
  /// the list before the list is snapped forward to keep up. Snapping is a
  /// visible jump, so this sits far enough out that only an implausibly fast
  /// spin — or a stalled ticker — can reach it. With [_tau] this short, an
  /// ordinary spin's lag settles well inside it and the chase stays smooth.
  static const double _maxLagCap = 1200;

  /// Below this the gap is not worth another frame.
  static const double _epsilon = 0.5;

  final ScrollPosition _position;
  final double _maxLag;

  /// Reports the applied value back, so the next notch can resume from it —
  /// Flutter's own notch handling disposes this activity before it can be
  /// asked.
  final ValueChanged<double> onValue;

  late final Ticker _ticker;
  double _value;
  double _target;
  double _velocity = 0;
  Duration _lastTick = Duration.zero;
  bool _tickerDead = false;

  double get value => _value;

  @override
  double get velocity => _velocity;

  @override
  bool get isScrolling => true;

  @override
  bool get shouldIgnorePointer => false;

  void _tick(Duration elapsed) {
    // Clamped so a dropped frame or a paused engine cannot teleport the list.
    final double dt = math.min(
      (elapsed - _lastTick).inMicroseconds / Duration.microsecondsPerSecond,
      1 / 30,
    );
    _lastTick = elapsed;
    if (dt <= 0) return;

    // Content can grow or shrink under a running glide.
    _target =
        _target.clamp(_position.minScrollExtent, _position.maxScrollExtent);

    double gap = _target - _value;
    if (gap.abs() > _maxLag) {
      _value = _target - (gap.isNegative ? -_maxLag : _maxLag);
      gap = _target - _value;
    }

    final double step = gap * (1 - math.exp(-dt / _tau));
    _velocity = step / dt;
    _value += step;
    bool done = false;
    if ((_target - _value).abs() < _epsilon) {
      _value = _target;
      _velocity = 0;
      done = true;
    }

    if (delegate.setPixels(_value) != 0) done = true;
    onValue(_value);
    if (done) {
      _stopTicker();
      delegate.goBallistic(0);
    }
  }

  void _stopTicker() {
    if (_tickerDead) return;
    _tickerDead = true;
    _ticker
      ..stop(canceled: true)
      ..dispose();
  }

  /// Drops the glide without touching the scroll position — for teardown,
  /// where the position may already be gone.
  void abandon() => _stopTicker();

  @override
  void dispose() {
    _stopTicker();
    super.dispose();
  }
}

/// Opts its subtree out of [SmoothWheelScroll]: lists inside it take the wheel
/// with Flutter's default per-notch jump.
///
/// Use it where the glide fights the content — a short, dense area where the
/// eased motion reads as lag rather than as travel. A list inside this still
/// hands the notch up to an ancestor list at its edge as usual, and that
/// ancestor glides normally.
class NoSmoothWheelScroll extends SingleChildRenderObjectWidget {
  const NoSmoothWheelScroll({super.key, required Widget super.child});

  @override
  RenderObject createRenderObject(BuildContext context) =>
      _RenderNoSmoothWheelScroll();
}

/// A plain proxy box. It exists only to be recognisable in the hit-test path.
class _RenderNoSmoothWheelScroll extends RenderProxyBox {}
