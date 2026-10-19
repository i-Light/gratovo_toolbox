import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/supabase/supabase_client_provider.dart';
import 'package:gratovo_toolbox/core/update/update_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/settings/application/credential_health_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/github_account_controller.dart';

/// How far past expiry a Supabase session has to be before it counts as
/// broken rather than mid-refresh.
///
/// Supabase access tokens last about an hour and `supabase_flutter` renews
/// them in the background, so a token close to expiry — or a few seconds past
/// it — is the normal state of a perfectly healthy session, not a warning.
/// What is *not* normal is one that stayed expired: that means the refresh
/// stopped happening, and the next sync will fail. The grace period is what
/// separates the two.
const kSessionRefreshGrace = Duration(minutes: 15);

/// One reason the Settings icon is lit.
enum SettingsAttentionReason {
  /// A newer release is downloaded and waiting for the Update button, or is
  /// being fetched. Patch releases that install themselves never reach here
  /// for long — they restart the app instead.
  updateAvailable,

  /// A credential the app holds was rejected the last time it was used: a
  /// revoked Gmail grant, a password changed elsewhere. Distinct from "not
  /// set up", which is not treated as needing attention — an account nobody
  /// has connected yet isn't broken, it's just unused.
  credentialRejected,

  /// A credential that still works but won't for much longer.
  ///
  /// Nothing currently produces this, and that is a statement about the
  /// credentials rather than an omission: none of the four exposes a real
  /// expiry. Supabase sessions refresh themselves hourly, Gmail refresh tokens
  /// do not expire for a published OAuth app, AWS key pairs have no expiry at
  /// all, and an AI provider key is valid until somebody revokes it. The slot
  /// is kept because the first credential that *does* carry an expiry belongs
  /// in it — but it stays unfed rather than being pointed at something that
  /// only looks like an expiry.
  credentialExpiring,
}

/// Which part of the Settings page a reason belongs to.
///
/// The badge on the nav rail says *that* something wants a look; this is what
/// lets the page itself say *what*. A lit icon that drops you on a page of
/// eight identical cards has only moved the search, not ended it.
enum SettingsAttentionTarget {
  /// The General card — where the version and the Update button live.
  general,

  /// The Supabase account card.
  account,

  /// The AI providers card.
  aiProviders,

  /// The AWS gateway credentials card.
  awsGateway,

  /// The outreach mailbox card.
  mailbox,

  /// The GitHub sign-in that updates are downloaded with.
  github,
}

/// How loudly a reason should be drawn.
enum AttentionLevel {
  /// Something is already broken.
  urgent,

  /// Something will break shortly.
  warning,

  /// News, not a fault.
  info,
}

extension SettingsAttentionReasonLevel on SettingsAttentionReason {
  AttentionLevel get level => switch (this) {
        SettingsAttentionReason.credentialRejected => AttentionLevel.urgent,
        SettingsAttentionReason.credentialExpiring => AttentionLevel.warning,
        SettingsAttentionReason.updateAvailable => AttentionLevel.info,
      };
}

/// Why the Settings nav icon is badged, how loudly, and — for each card on
/// the page — whether that card is the reason.
@immutable
class SettingsAttention {
  const SettingsAttention({this.byTarget = const {}});

  static const none = SettingsAttention();

  /// The reasons, grouped by the card they belong to. A card with no entry is
  /// not implicated in anything.
  final Map<SettingsAttentionTarget, Set<SettingsAttentionReason>> byTarget;

  Set<SettingsAttentionReason> get reasons =>
      {for (final set in byTarget.values) ...set};

  bool get isEmpty => byTarget.isEmpty;
  bool get isNotEmpty => byTarget.isNotEmpty;

  bool has(SettingsAttentionReason reason) => reasons.contains(reason);

  /// A rejected credential is something already broken; the other two are
  /// things that will be. The badge color follows this so a dead mailbox
  /// doesn't look the same as an update sitting there waiting.
  bool get isUrgent => has(SettingsAttentionReason.credentialRejected);

  /// The loudest thing wrong anywhere, or null when nothing is.
  AttentionLevel? get level => _worst(reasons);

  /// The loudest thing wrong with one card, or null when that card is fine.
  AttentionLevel? levelFor(SettingsAttentionTarget target) =>
      _worst(byTarget[target] ?? const {});

  /// Every reason attached to one card, for a tooltip or a caption.
  Set<SettingsAttentionReason> reasonsFor(SettingsAttentionTarget target) =>
      byTarget[target] ?? const {};

  static AttentionLevel? _worst(Set<SettingsAttentionReason> reasons) {
    if (reasons.isEmpty) return null;
    return reasons
        .map((r) => r.level)
        .reduce((a, b) => a.index <= b.index ? a : b);
  }
}

/// Everything that should light up the Settings icon in the nav rail, and the
/// card each of those things is about.
///
/// Composed from providers that already exist rather than from a registry that
/// each card reports into: most signals below are things the app can already
/// observe, and a card that has to remember to report is a card that will
/// eventually forget to. The two that genuinely cannot be observed — the AI
/// provider key and the AWS gateway pair, which are only ever proved by a call
/// somebody makes — report into `credentialHealthProvider` from where they are
/// used, and this reads the verdict they left.
final settingsAttentionProvider = Provider<SettingsAttention>((ref) {
  final byTarget = <SettingsAttentionTarget, Set<SettingsAttentionReason>>{};
  void flag(SettingsAttentionTarget target, SettingsAttentionReason reason) {
    (byTarget[target] ??= <SettingsAttentionReason>{}).add(reason);
  }

  // A key that was refused the last time somebody used it. Persisted, so this
  // survives the restart after the failure rather than only badging for
  // whoever happened to trigger it.
  final health = ref.watch(credentialHealthProvider);
  for (final entry in health.entries) {
    if (!entry.value.isRejected) continue;
    flag(
      switch (entry.key) {
        CredentialArea.aiProvider => SettingsAttentionTarget.aiProviders,
        CredentialArea.awsGateway => SettingsAttentionTarget.awsGateway,
      },
      SettingsAttentionReason.credentialRejected,
    );
  }

  // The update lives on the General card, beside the version it replaces.
  if (ref.watch(updateProvider).hasUpdate) {
    flag(
      SettingsAttentionTarget.general,
      SettingsAttentionReason.updateAvailable,
    );
  }

  // Gmail reports per-mailbox connectivity on every `--status`: a mailbox that
  // is present but which Google refused is exactly a rejected credential.
  // `configured` false means nothing is set up at all, which is deliberately
  // not a badge.
  ref.watch(gmailStatusProvider).whenData((status) {
    if (status.configured && status.accounts.any((a) => !a.connected)) {
      flag(
        SettingsAttentionTarget.mailbox,
        SettingsAttentionReason.credentialRejected,
      );
    }
  });

  // GitHub: the token updates are downloaded with — shared or personal —
  // cannot see the releases, or has been revoked. Either way updates will
  // silently never arrive, which is precisely the failure nobody notices on
  // their own, because a private repository answers with a 404 rather than an
  // error. A build carrying no token at all is the same dead end reached by a
  // different route.
  final github = ref.watch(githubAccountProvider);
  if (github.hasNoToken ||
      github.access == GithubReleaseAccess.denied ||
      github.access == GithubReleaseAccess.tokenRejected) {
    flag(
      SettingsAttentionTarget.github,
      SettingsAttentionReason.credentialRejected,
    );
  }

  // The Supabase session.
  //
  // Deliberately NOT warned about as "expiring soon". A Supabase access token
  // is minted with about an hour to live and the client refreshes it in the
  // background, so it spends its entire healthy life inside any warning window
  // worth the name — an earlier version of this compared it against three days
  // and lit the Account card permanently, on a session that was completely
  // fine. The only honest signal here is a session that has stayed expired
  // past [kSessionRefreshGrace], which means the refresh is no longer
  // happening.
  final expiresAt = ref.watch(currentSessionProvider)?.expiresAt;
  if (expiresAt != null) {
    final expiry = DateTime.fromMillisecondsSinceEpoch(expiresAt * 1000);
    if (DateTime.now().difference(expiry) > kSessionRefreshGrace) {
      flag(
        SettingsAttentionTarget.account,
        SettingsAttentionReason.credentialRejected,
      );
    }
  }

  return SettingsAttention(byTarget: byTarget);
});
