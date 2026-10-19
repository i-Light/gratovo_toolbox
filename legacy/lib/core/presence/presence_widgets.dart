import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/presence/editing_target.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';

/// Declares "the person using this app is working on [target] for as long as
/// this widget is on screen", and stops announcing it on the way out.
///
/// Wrap a detail page in one of these with just an entity, and wrap an
/// individual field in a nested one to narrow it down:
///
///     EditingScope(
///       target: EditingTarget(type: 'channel', id: channelId),
///       child: ...
///         EditingScope(
///           target: EditingTarget(type: 'channel', id: channelId, field: 'notes'),
///           child: TextField(...),
///         )
///     )
class EditingScope extends ConsumerStatefulWidget {
  const EditingScope({
    super.key,
    required this.target,
    required this.child,
    this.active = true,
  });

  final EditingTarget target;
  final Widget child;

  /// Set false to stop announcing without unmounting — e.g. a field that is
  /// only "being edited" while it holds focus.
  final bool active;

  @override
  ConsumerState<EditingScope> createState() => _EditingScopeState();
}

class _EditingScopeState extends ConsumerState<EditingScope> {
  /// The controller, held directly rather than reached through `ref` each
  /// time.
  ///
  /// [dispose] is the reason. Riverpod resolves `ref` through the element's
  /// BuildContext, and by the time dispose runs that context is deactivated —
  /// so `ref.read` there throws "Using ref when a widget is about to or has
  /// been unmounted is unsafe". Withdrawing the announcement is exactly what
  /// dispose is for, and it has to work, or a teammate's border stays drawn
  /// around a field nobody has open any more. Capturing the controller once
  /// while the widget is alive is what makes the teardown path safe.
  PresenceController? _controller;

  @override
  void initState() {
    super.initState();
    if (widget.active) _announce(widget.target);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Read here rather than in initState: `ref.read` is only valid once
    // dependencies are resolved, and this runs before the first build.
    _controller ??= ref.read(presenceControllerProvider.notifier);
  }

  @override
  void didUpdateWidget(EditingScope oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.target != widget.target ||
        oldWidget.active != widget.active) {
      _withdraw(oldWidget.target);
      if (widget.active) _announce(widget.target);
    }
  }

  @override
  void dispose() {
    _withdraw(widget.target);
    super.dispose();
  }

  void _announce(EditingTarget target) {
    // Fire-and-forget: presence is best-effort by design, and awaiting it in
    // initState/dispose would either block a frame or outlive the element.
    final controller =
        _controller ??= ref.read(presenceControllerProvider.notifier);
    unawaited(controller!.setEditing(target));
  }

  void _withdraw(EditingTarget target) {
    // Null only if the widget was disposed before its first
    // didChangeDependencies, in which case nothing was ever announced and
    // there is nothing to withdraw.
    final controller = _controller;
    if (controller == null) return;
    unawaited(controller.clearEditing(target));
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Draws a colored border around [child] while someone ELSE has the given
/// entity (or field) open, in that person's own color, with their name.
///
/// Deliberately not a hard lock. The team is small and trusted, and a real
/// lock that mis-fires is worse than a warning that does: this makes the
/// collision visible in the moment it would happen, and leaves the decision
/// to the person. The durable `edit_claims` table is where genuine locking
/// lives, for the cases that need it.
class PresenceBorder extends ConsumerWidget {
  const PresenceBorder({
    super.key,
    required this.type,
    required this.id,
    required this.child,
    this.field,
    this.showLabel = true,
    this.borderRadius = 8,
  });

  final String type;
  final String id;

  /// When set, only borders if someone is in this exact field.
  final String? field;

  final Widget child;
  final bool showLabel;
  final double borderRadius;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final peers = field == null
        ? ref.watch(peersOnEntityProvider((type: type, id: id)))
        : ref.watch(peersOnFieldProvider((type: type, id: id, field: field!)));

    if (peers.isEmpty) return child;

    // More than one person on the same thing is possible; border in the first
    // one's color and let the label carry the rest, rather than trying to
    // draw two borders around one box.
    final primary = peers.first;
    final color = TeamMember.parseColor(primary.colorHex);
    final label = peers.length == 1
        ? primary.displayName
        : '${primary.displayName} +${peers.length - 1}';

    return Stack(
      clipBehavior: Clip.none,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          decoration: BoxDecoration(
            border: Border.all(color: color, width: 2),
            borderRadius: BorderRadius.circular(borderRadius),
          ),
          child: child,
        ),
        if (showLabel)
          PositionedDirectional(
            top: -9,
            start: 8,
            child: IgnorePointer(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Who else has THIS entity open, as a small row of colored initials.
///
/// The entity-scoped counterpart to [PresenceBar], which shows everyone online
/// anywhere. On a detail page the useful question is narrower — "is someone
/// else already working on this channel" — and a bar showing five colleagues
/// who are all on other pages answers it with a no that looks like a yes.
///
/// Renders nothing at all when the answer is nobody, so it costs no space on
/// the overwhelmingly common case of working alone.
class EntityPresenceAvatars extends ConsumerWidget {
  const EntityPresenceAvatars({
    super.key,
    required this.type,
    required this.id,
    this.radius = 12,
  });

  final String type;
  final String id;
  final double radius;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final peers = ref.watch(peersOnEntityProvider((type: type, id: id)));
    if (peers.isEmpty) return const SizedBox.shrink();

    // One person can hold two entries (two windows, or a page-level and a
    // field-level announcement). Show each human once.
    final seen = <String, EditingPeer>{};
    for (final peer in peers) {
      seen.putIfAbsent(peer.userId, () => peer);
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final peer in seen.values)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 4),
            child: Tooltip(
              message: peer.displayName,
              child: CircleAvatar(
                radius: radius,
                backgroundColor: TeamMember.parseColor(peer.colorHex),
                child: Text(
                  peer.displayName.characters.take(1).toString().toUpperCase(),
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: radius * 0.9,
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// Small stack of avatars showing who is online right now. Meant for an app
/// bar or the top of a list page.
class PresenceBar extends ConsumerWidget {
  const PresenceBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final peers = ref.watch(presenceControllerProvider).peers;
    if (peers.isEmpty) return const SizedBox.shrink();

    // One person can have several entries (two windows open); show each
    // human once.
    final seen = <String, EditingPeer>{};
    for (final peer in peers) {
      seen.putIfAbsent(peer.userId, () => peer);
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final peer in seen.values)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 4),
            child: Tooltip(
              message: '${peer.displayName} — ${peer.target.fieldKey}',
              child: CircleAvatar(
                radius: 12,
                backgroundColor: TeamMember.parseColor(peer.colorHex),
                child: Text(
                  peer.displayName.characters.take(1).toString().toUpperCase(),
                  style: const TextStyle(color: Colors.white, fontSize: 11),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
