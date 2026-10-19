import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/localization/locale_provider.dart';
import 'package:gratovo_toolbox/core/logging/activity_logger.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The bookkeeping every outbound message needs, however it left.
///
/// Shared by Mark as sent, Send with Gmail and a scheduled send rather than
/// written once each: they differ entirely in how the message travels and not
/// at all in what it means afterwards. Keeping them separate is how one path
/// would quietly stop advancing the pipeline stage the day somebody edits
/// another.
Future<void> recordOutboundMessage(
  Ref ref, {
  required OutreachThread thread,
  required Influencer influencer,
  required String subject,
  required String body,
  required ContactMethod method,
  String? peerAddress,
  bool isAiDrafted = false,
  String? templateId,
}) async {
  final outreach = ref.read(outreachRepositoryProvider);

  await outreach.recordMessage(
    threadId: thread.id,
    direction: MessageDirection.outbound,
    subject: subject,
    body: body,
    method: method,
    peerAddress: peerAddress,
    isAiDrafted: isAiDrafted,
    templateId: templateId,
  );

  final wasFirstContact = thread.status == ThreadStatus.notContactedYet;
  if (wasFirstContact) {
    await outreach.updateThreadStatus(
      thread.id,
      ThreadStatus.awaitingReply,
    );
  }

  // First outbound message also nudges the sourcing funnel forward — but
  // only from `new`, and never past whatever a human has already set it to.
  // Done directly rather than through `guardInfluencerMutation` (a widget
  // helper needing a BuildContext this code does not have); the plan names
  // this as the accepted fallback.
  if (wasFirstContact && influencer.pipelineStage == PipelineStage.isNew) {
    try {
      await ref.read(influencerRepositoryProvider).updatePipelineStage(
            influencer.id,
            PipelineStage.contacted,
            base: PipelineStage.isNew,
          );
      ref.read(activityLoggerProvider).channelStageChanged(
            influencer,
            before: PipelineStage.isNew,
            after: PipelineStage.contacted,
          );
    } catch (_) {
      // A refused stage write must not block the message that was already
      // recorded; the thread status is the load-bearing signal here.
    }
  }

  // The next follow-up's reminder, timed from the house choices. It sends
  // nothing: the follow-up is written and approved when it is due.
  try {
    final messages = await outreach.getMessages(thread.id);
    final l10n = lookupAppLocalizations(ref.read(localeProvider));
    await ref.read(followUpSchedulerProvider).rollForward(
          influencerId: influencer.id,
          next: nextFollowUp(messages),
          title: (n) => l10n.outreachFollowUpNumbered(n, kMaxFollowUps),
        );
  } catch (_) {
    // A reminder that could not be set must not undo a message already sent
    // and recorded; the thread still shows it is awaiting a reply.
  }

  ref.read(activityLoggerProvider).emailSent(
        threadId: thread.id,
        label: influencer.handle,
        subject: subject.trim(),
      );

  announceThreadChange(ref);
}

/// Channels is announced alongside outreach because the channel row carries
/// the outbound-message count the influencer list and profile show.
void announceThreadChange(Ref ref) {
  ref.bumpData(const {
    DataDomain.outreach,
    DataDomain.channels,
    DataDomain.activity,
  });
}
