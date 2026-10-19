import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/constants/app_colors.dart';
import 'package:gratovo_toolbox/core/presence/presence_service.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/features/search/application/search_progress_parser.dart';
import 'package:gratovo_toolbox/features/search/presentation/widgets/upload_keywords_dialog.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Every teammate but the current user, each a tap target for sending
/// keywords straight to them. Moved here from the Dashboard's old
/// "searching now" card — it now doubles as the online/offline roster the
/// upload dialog used to show on its own, so it needs everyone, not only
/// whoever happens to be mid-search right now.
///
/// Lives inline in the [SearchScreen] app bar, next to the title, so each
/// chip is compact (avatar + name only, one line) rather than the taller
/// two-line card this used to be in the body — the name/keyword/count detail
/// that no longer fits on the bar surfaces as a [Tooltip] instead.
class SearchingNowRow extends ConsumerWidget {
  const SearchingNowRow({super.key});

  /// Height this row needs, for callers giving it a fixed-height slot (the
  /// app bar title area is already bounded to [kToolbarHeight], but the row
  /// still wants an explicit cross-axis size for its horizontal [ListView]).
  static const double height = 40;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final myId = ref.watch(currentProfileProvider).value?.id;
    final membersAsync = ref.watch(teamMembersProvider);
    final onlineIds =
        ref.watch(onlinePeersProvider).map((p) => p.userId).toSet();
    final searchingByUser = {
      for (final peer in ref.watch(searchingPeersProvider)) peer.userId: peer,
    };

    return membersAsync.maybeWhen(
      data: (membersById) {
        final others = membersById.values.where((m) => m.id != myId).toList()
          ..sort((a, b) {
            final aOnline = onlineIds.contains(a.id);
            final bOnline = onlineIds.contains(b.id);
            if (aOnline != bOnline) return aOnline ? -1 : 1;
            return a.displayName.compareTo(b.displayName);
          });
        if (others.isEmpty) return const SizedBox.shrink();

        return SizedBox(
          height: height,
          // `Center` + a scroll view, not `ListView`: a `ListView` always
          // pins its content to the leading edge, but with only a few
          // teammates this strip has room to spare next to the title, and it
          // should sit centered in that space rather than stuck to the left.
          // If the roster is wide enough to fill the space anyway, `Center`
          // is a no-op and this scrolls exactly like a `ListView` would.
          child: Center(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                spacing: 16,
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final member in others) ...[
                    SearchingUserChip(
                      member: member,
                      online: onlineIds.contains(member.id),
                      searching: searchingByUser[member.id],
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// One teammate as a single-line chip: avatar with an online dot, their
/// name, and — while their machine is mid-search — a small activity dot
/// next to it. The old "{keyword} · N found" (or backoff warning) line the
/// Dashboard used to show still exists, just as this chip's [Tooltip] rather
/// than a second line, since it now sits in the app bar's one-line strip.
/// Tapping an online teammate reopens [UploadKeywordsDialog] targeted
/// straight at them; offline teammates render the same but aren't tappable.
class SearchingUserChip extends StatelessWidget {
  const SearchingUserChip({
    super.key,
    required this.member,
    required this.online,
    required this.searching,
  });

  final TeamMember member;
  final bool online;
  final SearchingPeer? searching;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);
    final backedOff = searching?.status.backoffRemainingSeconds != null;

    final card = Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.info.withAlpha(50),
        border: Border.all(width: 2, color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _AvatarWithOnlineDot(member: member, online: online),
          const SizedBox(width: 12),
          Text(member.displayName, style: theme.textTheme.bodyLarge),
          if (searching != null) ...[
            const SizedBox(width: 12),
            Icon(
              backedOff ? Icons.pause_circle : Icons.search,
              size: 12,
              color: backedOff
                  ? theme.colorScheme.error
                  : theme.colorScheme.onSurfaceVariant,
            ),
          ],
        ],
      ),
    );

    final tooltip = searching == null
        ? member.displayName
        : '${member.displayName}\n${_peerLine(l10n, searching!)}';

    if (!online) {
      // Offline teammates render (they're still part of the roster) but
      // can't be sent keywords — dimmed, no tap target.
      return Opacity(opacity: 0.4, child: card);
    }

    return Tooltip(
      message: tooltip,
      child: InkWell(
        borderRadius: BorderRadius.circular(20),
        onTap: () => showDialog<void>(
          context: context,
          builder: (_) => UploadKeywordsDialog(recipient: member),
        ),
        child: card,
      ),
    );
  }

  /// The ordinary "{keyword} · N found" line, or — while that person's run
  /// is stuck waiting out a YouTube refusal — a warning line naming why and
  /// counting down, so a stale-looking keyword doesn't read as "still
  /// working" when it is actually blocked. Same logic the Dashboard's
  /// "searching now" card used before this moved here; now surfaced via
  /// this chip's tooltip instead of a second visible line.
  String _peerLine(AppLocalizations l10n, SearchingPeer peer) {
    final remaining = peer.status.backoffRemainingSeconds;
    if (remaining != null) {
      final reason = peer.status.backoffReason;
      final phrase = reason == null
          ? l10n.searchBackoffReasonRateLimited
          : switch (classifyBackoffReason(reason)) {
              BackoffReasonKind.rateLimited =>
                l10n.searchBackoffReasonRateLimited,
              BackoffReasonKind.captcha => l10n.searchBackoffReasonCaptcha,
              BackoffReasonKind.other => reason,
            };
      return l10n.dashboardSearchingBlockedLine(
        peer.displayName,
        phrase,
        remaining,
      );
    }
    return l10n.dashboardSearchingLine(
      peer.displayName,
      peer.status.keyword.isEmpty ? '…' : peer.status.keyword,
      peer.status.channelsFound,
    );
  }
}

/// A [CircleAvatar] with a small green/grey dot stacked over its bottom-right
/// edge — the same online/offline signal [UploadKeywordsDialog]'s old
/// recipient list drew beside each name, just repositioned onto the avatar.
class _AvatarWithOnlineDot extends StatelessWidget {
  const _AvatarWithOnlineDot({required this.member, required this.online});

  final TeamMember member;
  final bool online;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final onColor =
        ThemeData.estimateBrightnessForColor(member.color) == Brightness.dark
            ? Colors.white
            : Colors.black;
    final initial = member.displayName.characters.isEmpty
        ? '?'
        : member.displayName.characters.first.toUpperCase();

    return SizedBox(
      width: 24,
      height: 24,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          CircleAvatar(
            radius: 12,
            backgroundColor: member.color,
            child: Text(
              initial,
              style: theme.textTheme.labelSmall
                  ?.copyWith(color: onColor, fontWeight: FontWeight.w700),
            ),
          ),
          Positioned(
            bottom: -1,
            right: -1,
            child: Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: online
                    ? theme.extension<GratovoStatusColors>()!.success
                    : theme.colorScheme.outlineVariant,
                border: Border.all(
                  color: theme.scaffoldBackgroundColor,
                  width: 1.5,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
