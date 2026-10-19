import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/toast/notification_entry.dart';

/// The visual card for one toast — rounded, themed surface color, an outline
/// and icon both tinted to [NotificationEntry.severity] so the two read as
/// one signal, and a close button for dismissing it before its timer does.
///
/// [animation] drives the enter/exit: [ToastOverlay] passes the same
/// `Animation<double>` an `AnimatedList` item builder gets, so sliding in
/// (0→1, on insert) and sliding out (1→0, on remove) are the same transition
/// run forward and backward — no separate "exit" widget to keep in sync.
class ToastCard extends StatelessWidget {
  const ToastCard({
    super.key,
    required this.entry,
    required this.animation,
    this.onDismiss,
  });

  final NotificationEntry entry;
  final Animation<double> animation;
  final VoidCallback? onDismiss;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = entry.severity.color(context);
    final curved = CurvedAnimation(
      parent: animation,
      curve: Curves.easeOutCubic,
      reverseCurve: Curves.easeInCubic,
    );

    return SlideTransition(
      position: Tween<Offset>(
        begin: const Offset(0, -0.35),
        end: Offset.zero,
      ).animate(curved),
      child: FadeTransition(
        opacity: curved,
        child: Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Material(
            color: Colors.transparent,
            child: Container(
              padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHigh,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: color, width: 1.4),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.22),
                    blurRadius: 18,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.16),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(entry.severity.icon, color: color, size: 18),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        entry.message,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                  ),
                  if (entry.action case final action?)
                    TextButton(
                      onPressed: action.onPressed,
                      style: TextButton.styleFrom(
                        foregroundColor: color,
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      child: Text(action.label),
                    ),
                  InkWell(
                    borderRadius: BorderRadius.circular(999),
                    onTap: onDismiss,
                    child: Padding(
                      padding: const EdgeInsets.all(4),
                      child: Icon(
                        Icons.close,
                        size: 16,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
