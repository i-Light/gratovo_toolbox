import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/theme/gradient_widgets.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/toast/notification_center.dart';
import 'package:gratovo_toolbox/core/toast/notification_entry.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every toast raised this session, newest first — reached from the bell
/// button in the Dashboard's app bar. Session-only, same as the toasts
/// themselves; see [NotificationEntry]'s doc comment for why.
class NotificationsLogScreen extends ConsumerWidget {
  const NotificationsLogScreen({super.key, this.onClose});

  /// Set when hosted inside [showAsDialog] rather than a route — draws a
  /// close button in the app bar's leading slot, matching [LogsScreen].
  final VoidCallback? onClose;

  /// Opens the notifications log in a centered modal, the same shape as
  /// `LogsScreen.showAsDialog`.
  static Future<void> showAsDialog(BuildContext context) {
    return showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        insetPadding: const EdgeInsets.all(24),
        clipBehavior: Clip.antiAlias,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640, maxHeight: 820),
          child: NotificationsLogScreen(onClose: () => Navigator.of(ctx).pop()),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final history = ref.watch(
      notificationCenterProvider.select((state) => state.history),
    );
    final fmt = ref.watch(instantFormatterProvider);

    return Scaffold(
      appBar: GradientAppBar(
        leading: onClose == null
            ? null
            : IconButton(icon: const Icon(Icons.close), onPressed: onClose),
        title: GradientText(l10n.notificationsTitle),
        actions: [
          if (history.isNotEmpty)
            IconButton(
              tooltip: l10n.notificationsClearAll,
              icon: const Icon(Icons.clear_all),
              onPressed: () =>
                  ref.read(notificationCenterProvider.notifier).clearHistory(),
            ),
          const SizedBox(width: 4),
        ],
      ),
      body: history.isEmpty
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  l10n.notificationsEmpty,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              itemCount: history.length,
              itemBuilder: (context, index) {
                final entry = history[index];
                return _NotificationTile(
                  entry: entry,
                  timestamp: fmt.dateTime(entry.createdAt),
                );
              },
            ),
    );
  }
}

class _NotificationTile extends StatelessWidget {
  const _NotificationTile({required this.entry, required this.timestamp});

  final NotificationEntry entry;
  final String timestamp;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = entry.severity.color(context);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              margin: const EdgeInsets.only(top: 2),
              padding: const EdgeInsets.all(5),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.16),
                shape: BoxShape.circle,
              ),
              child: Icon(entry.severity.icon, size: 16, color: color),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(entry.message, style: theme.textTheme.bodyMedium),
                  const SizedBox(height: 4),
                  Text(
                    timestamp,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
