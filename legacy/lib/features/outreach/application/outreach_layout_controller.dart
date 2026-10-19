import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether the docked influencer-profile pane is showing, on the widest
/// (three-pane) Outreach layout.
///
/// Session-only on purpose — it is a "give me more room to read the thread
/// right now" toggle, not a setting worth persisting across launches. The
/// pane also only exists above ~1200px and only when a thread is open; this
/// just gates the third slot when there is room for it.
class OutreachProfilePaneVisibleNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void toggle() => state = !state;

  // ignore: avoid_positional_boolean_parameters
  void set(bool value) => state = value;
}

final outreachProfilePaneVisibleProvider =
    NotifierProvider<OutreachProfilePaneVisibleNotifier, bool>(
  OutreachProfilePaneVisibleNotifier.new,
);

/// Whether the conversation list is docked open beside the open thread.
///
/// Session-only, same reasoning as the profile pane above: closing the list is
/// something somebody does to read one long thread, not a preference about how
/// the page should look tomorrow. Collapsing it leaves a slim rail with the
/// reopen button on it, so the list is never lost — only out of the way.
class OutreachThreadListVisibleNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void toggle() => state = !state;

  // ignore: avoid_positional_boolean_parameters
  void set(bool value) => state = value;
}

final outreachThreadListVisibleProvider =
    NotifierProvider<OutreachThreadListVisibleNotifier, bool>(
  OutreachThreadListVisibleNotifier.new,
);

/// How wide the conversation list is, in logical pixels, when it is open.
///
/// Dragged by the divider between the list and the open thread. The bounds are
/// not cosmetic: below [minWidth] a row shows a truncated handle and a status
/// pill and stops being a list anyone can scan, and past [maxWidth] the thread
/// beside it — the thing actually being read — is squeezed by a pane full of
/// whitespace. The pane widget clamps again against the *available* width, so
/// a narrowed window cannot leave the list wider than the page.
class OutreachThreadListWidthNotifier extends Notifier<double> {
  static const minWidth = 250.0;
  static const maxWidth = 560.0;
  static const defaultWidth = 470.0;

  @override
  double build() => defaultWidth;

  void set(double value) => state = value.clamp(minWidth, maxWidth).toDouble();

  /// Applies one drag delta. Separate from [set] so the handle does not have
  /// to know the current width — a read inside a drag callback is a frame
  /// behind by the time several deltas arrive in one gesture.
  void nudge(double delta) => set(state + delta);
}

final outreachThreadListWidthProvider =
    NotifierProvider<OutreachThreadListWidthNotifier, double>(
  OutreachThreadListWidthNotifier.new,
);
