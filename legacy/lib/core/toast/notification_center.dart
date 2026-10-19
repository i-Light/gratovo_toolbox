import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/notification_entry.dart';
import 'package:gratovo_toolbox/core/toast/toast_action.dart';
import 'package:gratovo_toolbox/core/toast/toast_severity.dart';

@immutable
class NotificationCenterState {
  const NotificationCenterState({
    this.history = const [],
    this.active = const [],
    this.unreadCount = 0,
  });

  /// Every toast this session, newest first — what the notifications log
  /// shows. Capped at [NotificationCenter.historyLimit].
  final List<NotificationEntry> history;

  /// What's currently animating on screen, newest first — what
  /// [ToastOverlay] draws. Disjoint from "seen" in any way: an entry leaves
  /// this list once it dismisses, whether or not anyone read it.
  final List<NotificationEntry> active;

  /// How many [history] entries haven't been looked at yet — the Dashboard
  /// bell's badge count. Cleared by [NotificationCenter.acknowledge].
  final int unreadCount;

  NotificationCenterState copyWith({
    List<NotificationEntry>? history,
    List<NotificationEntry>? active,
    int? unreadCount,
  }) {
    return NotificationCenterState(
      history: history ?? this.history,
      active: active ?? this.active,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }
}

/// Everything about toasts that outlives the widget that raised one.
///
/// A single [Notifier] (not a family, not scoped per screen) so one toast
/// fired from anywhere in the app reaches the one overlay and the one log —
/// the same "held alive from the app root, whichever page is open" shape as
/// `PipelineBadgeNotifier`/`NewsBadgeNotifier`, and [acknowledge] mirrors
/// their "hold an unseen count until the person actually looks" contract.
///
/// Session-only by design: [history] starts empty on every launch. See
/// [NotificationEntry]'s doc comment for why that's deliberate.
class NotificationCenter extends Notifier<NotificationCenterState> {
  static const historyLimit = 200;

  int _nextId = 0;
  final Map<String, Timer> _timers = {};

  @override
  NotificationCenterState build() {
    ref.onDispose(() {
      for (final timer in _timers.values) {
        timer.cancel();
      }
    });
    return const NotificationCenterState();
  }

  /// Raises a new toast: pushes it onto [NotificationCenterState.active] (so
  /// [ToastOverlay] animates it in) and onto the front of
  /// [NotificationCenterState.history], then schedules its own dismissal
  /// after [duration] (defaults to [ToastSeverity.displayDuration] — pass one
  /// explicitly only when a toast needs longer, e.g. because it carries an
  /// [action] worth having time to notice and press).
  NotificationEntry notify(
    String message,
    ToastSeverity severity, {
    ToastAction? action,
    Duration? duration,
  }) {
    final entry = NotificationEntry(
      id: (_nextId++).toString(),
      message: message,
      severity: severity,
      createdAt: DateTime.now(),
      action: action,
    );
    final history = [entry, ...state.history];
    state = state.copyWith(
      active: [entry, ...state.active],
      history: history.length > historyLimit
          ? history.sublist(0, historyLimit)
          : history,
      unreadCount: state.unreadCount + 1,
    );
    _timers[entry.id] =
        Timer(duration ?? severity.displayDuration, () => dismiss(entry.id));
    return entry;
  }

  /// Takes a toast off the active on-screen stack — called by its own timer,
  /// or early when the person dismisses it (a tap, a swipe).
  void dismiss(String id) {
    _timers.remove(id)?.cancel();
    if (state.active.every((entry) => entry.id != id)) return;
    state = state.copyWith(
      active: state.active.where((entry) => entry.id != id).toList(),
    );
  }

  /// Called when the notifications log is opened — clears the unread badge
  /// without touching [NotificationCenterState.history] itself.
  void acknowledge() {
    if (state.unreadCount == 0) return;
    state = state.copyWith(unreadCount: 0);
  }

  /// The log's "Clear all". Leaves anything still animating on screen alone
  /// — clearing the record is not the same as cutting off a toast in flight.
  void clearHistory() {
    state = state.copyWith(history: const [], unreadCount: 0);
  }
}

final notificationCenterProvider =
    NotifierProvider<NotificationCenter, NotificationCenterState>(
  NotificationCenter.new,
);
