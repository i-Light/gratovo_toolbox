import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/core/toast/notification_entry.dart';
import 'package:gratovo_toolbox/core/toast/toast_card.dart';

/// Hosts the on-screen toast stack above [child] — wrap the whole app in it
/// once (see `app.dart`'s `MaterialApp.router` `builder`) so a toast raised
/// from any screen, including one shown as a modal dialog, animates in at
/// the same top-center spot regardless of which page is underneath.
///
/// Mirrors [NotificationCenterState.active] into an [AnimatedList] rather
/// than rebuilding a plain [Column] on every change: an `AnimatedList` is
/// what lets an item just removed from the data still render its own exit
/// animation for [_removeDuration], instead of vanishing the instant its
/// timer fires.
class ToastOverlay extends ConsumerStatefulWidget {
  const ToastOverlay({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<ToastOverlay> createState() => _ToastOverlayState();
}

class _ToastOverlayState extends ConsumerState<ToastOverlay> {
  static const _insertDuration = Duration(milliseconds: 320);
  static const _removeDuration = Duration(milliseconds: 220);

  final _listKey = GlobalKey<AnimatedListState>();

  /// This widget's own mirror of the active list, a beat behind the
  /// provider — an item just removed from provider state still needs to be
  /// here for [AnimatedList.removeItem]'s builder to render its exit.
  final List<NotificationEntry> _items = [];

  @override
  void initState() {
    super.initState();
    _items.addAll(ref.read(notificationCenterProvider).active);
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(
      notificationCenterProvider.select((state) => state.active),
      _syncWith,
    );

    return Stack(
      children: [
        widget.child,
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: IgnorePointer(
            ignoring: _items.isEmpty,
            child: SafeArea(
              child: Align(
                alignment: Alignment.topCenter,
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                    child: AnimatedList(
                      key: _listKey,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      initialItemCount: _items.length,
                      itemBuilder: (context, index, animation) =>
                          _buildItem(_items[index], animation),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildItem(NotificationEntry entry, Animation<double> animation) {
    return ToastCard(
      entry: entry,
      animation: animation,
      onDismiss: () =>
          ref.read(notificationCenterProvider.notifier).dismiss(entry.id),
    );
  }

  void _syncWith(
    List<NotificationEntry>? previous,
    List<NotificationEntry> next,
  ) {
    final nextIds = next.map((e) => e.id).toSet();
    final currentIds = _items.map((e) => e.id).toSet();

    // setState, not a bare mutation: this widget's own build() reads
    // `_items.isEmpty` (to decide whether the overlay should still absorb
    // pointer events at all) — without setState that check stays frozen at
    // whatever it was on the first build, and the very first toast of a
    // session would render but never be tappable.
    setState(() {
      // New entries land at the head of `next` (NotificationCenter.notify
      // prepends) — insert them at the head here too, in the same order.
      final added = next.where((e) => !currentIds.contains(e.id)).toList();
      for (final entry in added.reversed) {
        _items.insert(0, entry);
        _listKey.currentState?.insertItem(0, duration: _insertDuration);
      }

      // Anything in the mirror no longer in the provider's list has
      // dismissed — remove it here with the matching exit animation.
      final removed = _items.where((e) => !nextIds.contains(e.id)).toList();
      for (final entry in removed) {
        final index = _items.indexOf(entry);
        if (index == -1) continue;
        _items.removeAt(index);
        _listKey.currentState?.removeItem(
          index,
          (context, animation) => _buildItem(entry, animation),
          duration: _removeDuration,
        );
      }
    });
  }
}
