import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/theme/app_theme.dart';
import 'package:gratovo_toolbox/data/models/activity_log_entry.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/models/deal.dart';
import 'package:gratovo_toolbox/data/models/deliverable.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/models/team_member.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// Localized label + on-brand color for each [VettingStatus] /
/// [DealStage] value, kept in one place so a status pill looks and reads
/// identically wherever it appears (Influencer list/profile, Deal list —
/// Phase 3 — Dashboard). Feeds `StatusBadge` (core/widgets/status_badge.dart).
extension VettingStatusPresentation on VettingStatus {
  String label(AppLocalizations l10n) => switch (this) {
        VettingStatus.newlyFound => l10n.vettingStatusNewlyFound,
        VettingStatus.shortlisted => l10n.vettingStatusShortlisted,
        VettingStatus.rejected => l10n.vettingStatusRejected,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      VettingStatus.newlyFound => status?.info ?? scheme.secondary,
      VettingStatus.shortlisted => scheme.primary,
      VettingStatus.rejected => scheme.error,
    };
  }
}

extension PipelineStagePresentation on PipelineStage {
  /// The leading emoji, defined once here so it is identical in every locale
  /// and on every surface — the enum value is the shared object, the text and
  /// this glyph are just how it is drawn.
  String get glyph => switch (this) {
        PipelineStage.isNew => '✨',
        PipelineStage.contacted => '📨',
        PipelineStage.interested => '🔥',
        PipelineStage.roster => '👥',
        PipelineStage.negotiating => '🤝',
        PipelineStage.contract => '📄',
        PipelineStage.awaitingDelivery => '⏳',
        PipelineStage.paid => '💰',
        PipelineStage.lost => '❌',
      };

  String label(AppLocalizations l10n) => '$glyph ${_text(l10n)}';

  String _text(AppLocalizations l10n) => switch (this) {
        PipelineStage.isNew => l10n.pipelineStageNew,
        PipelineStage.contacted => l10n.pipelineStageContacted,
        PipelineStage.interested => l10n.pipelineStageInterested,
        PipelineStage.roster => l10n.pipelineStageRoster,
        PipelineStage.negotiating => l10n.pipelineStageNegotiating,
        PipelineStage.contract => l10n.pipelineStageContract,
        PipelineStage.awaitingDelivery => l10n.pipelineStageAwaitingDelivery,
        PipelineStage.paid => l10n.pipelineStagePaid,
        PipelineStage.lost => l10n.pipelineStageLost,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      PipelineStage.isNew => status?.info ?? scheme.secondary,
      PipelineStage.contacted => scheme.onSurfaceVariant,
      PipelineStage.interested => status?.info ?? scheme.primary,
      PipelineStage.roster => scheme.primary,
      PipelineStage.negotiating => status?.warning ?? scheme.secondary,
      PipelineStage.contract => status?.info ?? scheme.primary,
      PipelineStage.awaitingDelivery => status?.warning ?? scheme.secondary,
      PipelineStage.paid => status?.success ?? scheme.primary,
      PipelineStage.lost => scheme.error,
    };
  }
}

extension ChannelTagPresentation on ChannelTag {
  /// The leading emoji, defined once here so it is identical in every locale
  /// and on every surface — the enum value is the shared object, the text and
  /// this glyph are just how it is drawn.
  String get glyph => switch (this) {
        ChannelTag.undecided => '🤔',
        ChannelTag.qualified => '✈️',
        ChannelTag.haramStuff => '🔞',
        ChannelTag.irrelevant => '🗑️',
        ChannelTag.inactive => '🌵',
      };

  String label(AppLocalizations l10n) => '$glyph ${_text(l10n)}';

  String _text(AppLocalizations l10n) => switch (this) {
        ChannelTag.undecided => l10n.channelTagUndecided,
        ChannelTag.qualified => l10n.channelTagQualified,
        ChannelTag.haramStuff => l10n.channelTagHaramStuff,
        ChannelTag.irrelevant => l10n.channelTagIrrelevant,
        ChannelTag.inactive => l10n.channelTagInactive,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      ChannelTag.undecided => status?.info ?? scheme.secondary,
      ChannelTag.qualified => status?.success ?? scheme.primary,
      ChannelTag.haramStuff => scheme.error,
      ChannelTag.irrelevant => scheme.onSurfaceVariant,
      ChannelTag.inactive => scheme.onSurfaceVariant,
    };
  }
}

/// The one status tag a channel row shows. Which of the three kinds it is has
/// already been decided by [Influencer.statusTag]; this only renders it.
extension InfluencerStatusTagPresentation on InfluencerStatusTag {
  String label(AppLocalizations l10n) => switch (kind) {
        InfluencerStatusTagKind.stage =>
          (stage ?? PipelineStage.isNew).label(l10n),
        InfluencerStatusTagKind.attempts =>
          l10n.influencerTagContactAttempts(count ?? 0),
        InfluencerStatusTagKind.daysSinceDeal =>
          l10n.influencerTagDaysSinceDeal(count ?? 0),
      };

  /// A days-since-deal tag is colored by how stale the relationship is, not by
  /// a fixed palette entry: the number is the point of the tag, and a tag that
  /// looks identical at 5 days and at 500 buries it. The thresholds are a
  /// month and a quarter — long enough that a channel worked with recently
  /// stays quiet, short enough that a lapsed one is visible while it is still
  /// worth reviving.
  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (kind) {
      InfluencerStatusTagKind.stage =>
        (stage ?? PipelineStage.isNew).color(context),
      InfluencerStatusTagKind.attempts =>
        status?.warning ?? scheme.onSurfaceVariant,
      InfluencerStatusTagKind.daysSinceDeal => switch (count ?? 0) {
          < 30 => status?.success ?? scheme.primary,
          < 90 => status?.warning ?? scheme.secondary,
          _ => scheme.error,
        },
    };
  }
}

extension DealStagePresentation on DealStage {
  String label(AppLocalizations l10n) => switch (this) {
        DealStage.proposed => l10n.dealStageProposed,
        DealStage.negotiating => l10n.dealStageNegotiating,
        DealStage.agreed => l10n.dealStageAgreed,
        DealStage.contractSent => l10n.dealStageContractSent,
        DealStage.signed => l10n.dealStageSigned,
        DealStage.live => l10n.dealStageLive,
        DealStage.closed => l10n.dealStageClosed,
        DealStage.lost => l10n.dealStageLost,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      DealStage.proposed => scheme.onSurfaceVariant,
      DealStage.negotiating => status?.warning ?? scheme.secondary,
      DealStage.agreed => status?.info ?? scheme.primary,
      DealStage.contractSent => status?.info ?? scheme.primary,
      DealStage.signed => scheme.primary,
      DealStage.live => scheme.primary,
      DealStage.closed => status?.success ?? scheme.primary,
      DealStage.lost => scheme.error,
    };
  }
}

extension ThreadStatusPresentation on ThreadStatus {
  String label(AppLocalizations l10n) => switch (this) {
        ThreadStatus.notContactedYet => l10n.outreachStatusNotContactedYet,
        ThreadStatus.awaitingReply => l10n.outreachStatusAwaitingReply,
        ThreadStatus.replied => l10n.outreachStatusReplied,
        ThreadStatus.needsFollowUp => l10n.outreachStatusNeedsFollowUp,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      ThreadStatus.notContactedYet => scheme.onSurfaceVariant,
      ThreadStatus.awaitingReply => status?.warning ?? scheme.secondary,
      ThreadStatus.replied => status?.success ?? scheme.primary,
      ThreadStatus.needsFollowUp => scheme.error,
    };
  }
}

/// What an inbound reply actually said, once somebody has tagged it. Feeds
/// the small classification badge on a message and the thread list's
/// classification filter (see `lib/features/outreach/`).
extension MessageClassificationPresentation on MessageClassification {
  String label(AppLocalizations l10n) => switch (this) {
        MessageClassification.interested =>
          l10n.outreachClassificationInterested,
        MessageClassification.askingRate =>
          l10n.outreachClassificationAskingRate,
        MessageClassification.notNow => l10n.outreachClassificationNotNow,
        MessageClassification.decline => l10n.outreachClassificationDecline,
        MessageClassification.wrongContact =>
          l10n.outreachClassificationWrongContact,
        MessageClassification.autoReply => l10n.outreachClassificationAutoReply,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      MessageClassification.interested => status?.success ?? scheme.primary,
      MessageClassification.askingRate => status?.info ?? scheme.primary,
      MessageClassification.notNow => status?.warning ?? scheme.secondary,
      MessageClassification.decline => scheme.error,
      MessageClassification.wrongContact => scheme.onSurfaceVariant,
      MessageClassification.autoReply => scheme.onSurfaceVariant,
    };
  }
}

/// How one recorded action reads, and what it looks like.
///
/// The colors are deliberately restrained. A log is a reference, not a
/// dashboard: the only entries worth coloring away from the neutral are the
/// ones that changed something outside the app (an email actually left) or
/// that removed something. coloring all thirteen would make the page a
/// rainbow in which nothing stands out, which is the same as coloring none.
extension ActivityActionPresentation on ActivityAction {
  String label(AppLocalizations l10n) => switch (this) {
        ActivityAction.created => l10n.logsActionCreated,
        ActivityAction.updated => l10n.logsActionUpdated,
        ActivityAction.deleted => l10n.logsActionDeleted,
        ActivityAction.tagsChanged => l10n.logsActionTagsChanged,
        ActivityAction.stageChanged => l10n.logsActionStageChanged,
        ActivityAction.vettingChanged => l10n.logsActionVettingChanged,
        ActivityAction.notesChanged => l10n.logsActionNotesChanged,
        ActivityAction.contactsChanged => l10n.logsActionContactsChanged,
        ActivityAction.contactAttempt => l10n.logsActionContactAttempt,
        ActivityAction.emailSent => l10n.logsActionEmailSent,
        ActivityAction.replyReceived => l10n.logsActionReplyReceived,
        ActivityAction.searchStarted => l10n.logsActionSearchStarted,
        ActivityAction.videosPulled => l10n.logsActionVideosPulled,
        ActivityAction.unknown => l10n.logsActionUnknown,
      };

  IconData get icon => switch (this) {
        ActivityAction.created => Icons.add_circle_outline,
        ActivityAction.updated => Icons.edit_outlined,
        ActivityAction.deleted => Icons.delete_outline,
        ActivityAction.tagsChanged => Icons.sell_outlined,
        ActivityAction.stageChanged => Icons.trending_up,
        ActivityAction.vettingChanged => Icons.fact_check_outlined,
        ActivityAction.notesChanged => Icons.sticky_note_2_outlined,
        ActivityAction.contactsChanged => Icons.contacts_outlined,
        ActivityAction.contactAttempt => Icons.campaign_outlined,
        ActivityAction.emailSent => Icons.north_east,
        ActivityAction.replyReceived => Icons.south_west,
        ActivityAction.searchStarted => Icons.search,
        ActivityAction.videosPulled => Icons.video_library_outlined,
        ActivityAction.unknown => Icons.help_outline,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      ActivityAction.deleted => scheme.error,
      ActivityAction.created => status?.success ?? scheme.primary,
      ActivityAction.emailSent => status?.info ?? scheme.primary,
      ActivityAction.replyReceived => status?.success ?? scheme.primary,
      _ => scheme.onSurfaceVariant,
    };
  }
}

/// The authority someone held. Used on log entries, where it is the authority
/// held AT THE TIME and not the one they hold now — see [ActivityLogEntry].
extension AccessLevelPresentation on AccessLevel {
  String label(AppLocalizations l10n) => switch (this) {
        AccessLevel.full => l10n.accessLevelFull,
        AccessLevel.basic => l10n.accessLevelBasic,
        AccessLevel.unauthorized => l10n.accessLevelUnauthorized,
      };
}

/// What kind of content a [Deliverable] is — the label shown in its type
/// dropdown on the deal detail screen's Deliverables section.
extension DeliverableTypePresentation on DeliverableType {
  String label(AppLocalizations l10n) => switch (this) {
        DeliverableType.integration => l10n.deliverableTypeIntegration,
        DeliverableType.dedicated => l10n.deliverableTypeDedicated,
        DeliverableType.short => l10n.deliverableTypeShort,
        DeliverableType.communityPost => l10n.deliverableTypeCommunityPost,
        DeliverableType.other => l10n.deliverableTypeOther,
      };
}

/// Where one [Deliverable] is in its pending → drafted → approved →
/// published pipeline. Colored progressively, the same idea as
/// [DealStagePresentation]: neutral while nothing has happened yet, warmer
/// as it nears done.
extension DeliverableStatusPresentation on DeliverableStatus {
  String label(AppLocalizations l10n) => switch (this) {
        DeliverableStatus.pending => l10n.deliverableStatusPending,
        DeliverableStatus.drafted => l10n.deliverableStatusDrafted,
        DeliverableStatus.approved => l10n.deliverableStatusApproved,
        DeliverableStatus.published => l10n.deliverableStatusPublished,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      DeliverableStatus.pending => scheme.onSurfaceVariant,
      DeliverableStatus.drafted => status?.info ?? scheme.secondary,
      DeliverableStatus.approved => scheme.primary,
      DeliverableStatus.published => status?.success ?? scheme.primary,
    };
  }
}

/// Whether a [Campaign] is still being worked or has been wrapped up — the
/// badge on the brand profile's Campaigns section and the campaign detail
/// screen. Deliberately two-tone: a campaign is either open or it isn't,
/// unlike [DealStage]'s pipeline of intermediate steps.
extension CampaignStatusPresentation on CampaignStatus {
  String label(AppLocalizations l10n) => switch (this) {
        CampaignStatus.active => l10n.campaignStatusActive,
        CampaignStatus.closed => l10n.campaignStatusClosed,
      };

  Color color(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final status = Theme.of(context).extension<GratovoStatusColors>();
    return switch (this) {
      CampaignStatus.active => status?.success ?? scheme.primary,
      CampaignStatus.closed => scheme.onSurfaceVariant,
    };
  }
}

/// The kind of record an action was taken on.
///
/// Takes a plain string rather than an enum because the vocabulary is shared
/// with the presence system's editing targets, which are strings, and an
/// unrecognised type from a newer build must still render as something.
String activityEntityLabel(String entityType, AppLocalizations l10n) =>
    switch (entityType) {
      'channel' => l10n.logsEntityChannel,
      'deal' => l10n.logsEntityDeal,
      'brand' => l10n.logsEntityBrand,
      'thread' => l10n.logsEntityThread,
      'run' => l10n.logsEntityRun,
      'settings' => l10n.logsEntitySettings,
      _ => l10n.logsEntityOther,
    };
