import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:gratovo_toolbox/core/status/status_presentation.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/widgets/status_badge.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:gratovo_toolbox/routing/app_routes.dart';

/// Every email exchanged with this influencer, read-only.
///
/// Read-only is the whole design, not a limitation waiting to be lifted. The
/// Emails page is where a thread is worked; duplicating a compose box here
/// would make two places that can send, and two places that have to agree
/// about what was sent. This is the summary you want while deciding whether to
/// reach out again, with a link to where the work happens.
class InfluencerEmailsCard extends ConsumerWidget {
  const InfluencerEmailsCard({
    super.key,
    required this.influencerId,
    required this.l10n,
  });

  final String influencerId;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final threadAsync = ref.watch(threadByInfluencerProvider(influencerId));
    // The dates below are for everyone; the page the button opens is not.
    // `basic` has the Outreach page hidden (see app_router.dart), so the
    // link would only bounce them to the dashboard.
    final canOpen = ref.watch(accessLevelProvider).seesSensitiveData;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.influencerProfileEmailsTitle,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                threadAsync.maybeWhen(
                  data: (thread) => thread == null || !canOpen
                      ? const SizedBox.shrink()
                      : TextButton(
                          onPressed: () =>
                              context.go(AppRoutes.outreachThread(thread.id)),
                          child: Text(l10n.influencerProfileEmailsOpen),
                        ),
                  orElse: () => const SizedBox.shrink(),
                ),
              ],
            ),
            Text(
              l10n.influencerProfileEmailsSource,
              style: theme.textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            threadAsync.when(
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 12),
                child: Center(child: CircularProgressIndicator()),
              ),
              // An unauthorized account is REFUSED by the server rather than
              // returned an empty list, so this error branch is a real and
              // expected state, not only a network failure. It says nothing
              // about whether emails exist, which is the point.
              error: (error, stackTrace) => _AccessNote(l10n: l10n),
              data: (thread) {
                if (thread == null) {
                  return Text(l10n.influencerProfileNoEmails);
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StatusBadge(
                      label: thread.status.label(l10n),
                      color: thread.status.color(context),
                    ),
                    const SizedBox(height: 8),
                    _MessageList(threadId: thread.id, l10n: l10n),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

/// A plain chronological log of what was exchanged — one line per message,
/// dated, no subject or body. The subject/body live on the Emails page; here
/// the only question is "when did we last reach out, and did they reply".
class _MessageList extends ConsumerWidget {
  const _MessageList({required this.threadId, required this.l10n});

  final String threadId;
  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final messagesAsync = ref.watch(messagesByThreadProvider(threadId));
    final fmt = ref.watch(instantFormatterProvider);

    return messagesAsync.when(
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, stackTrace) => _AccessNote(l10n: l10n),
      data: (messages) {
        if (messages.isEmpty) {
          return Text(l10n.influencerProfileNoEmails);
        }
        // The two backends disagree on order (Supabase newest-first, the mock
        // oldest-first), and "first email vs. follow-up" only makes sense read
        // in time order — so sort here rather than trust the source.
        final ordered = [...messages]..sort((a, b) => a.at.compareTo(b.at));
        var outboundSeen = false;
        final lines = <Widget>[];
        for (final message in ordered) {
          final isOutbound = message.direction == MessageDirection.outbound;
          final String label;
          if (isOutbound) {
            label = outboundSeen
                ? l10n.influencerProfileEmailEventFollowUp(fmt.date(message.at))
                : l10n.influencerProfileEmailEventSent(fmt.date(message.at));
            outboundSeen = true;
          } else {
            label = l10n.influencerProfileEmailEventReply(fmt.date(message.at));
          }
          lines.add(
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    isOutbound ? Icons.north_east : Icons.south_west,
                    size: 16,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(label, style: theme.textTheme.bodyMedium),
                  ),
                ],
              ),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: lines,
        );
      },
    );
  }
}

/// Shown when the server refused this read. Deliberately does not claim there
/// are no emails — it says access is the reason nothing is shown, which is a
/// different fact.
class _AccessNote extends StatelessWidget {
  const _AccessNote({required this.l10n});

  final AppLocalizations l10n;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.lock_outline, size: 16, color: theme.colorScheme.error),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            l10n.emailsAccessDeniedBody,
            style: theme.textTheme.bodySmall,
          ),
        ),
      ],
    );
  }
}
