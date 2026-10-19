import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/ai/ai_provider.dart';
import 'package:gratovo_toolbox/core/ai/anthropic_api_provider.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/sync/local_id.dart';
import 'package:gratovo_toolbox/core/time/instant_format.dart';
import 'package:gratovo_toolbox/core/utils/number_format.dart';
import 'package:gratovo_toolbox/data/models/email_template.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/models/scheduled_email.dart';
import 'package:gratovo_toolbox/data/models/video.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_scheduler_controller.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outbound_recorder.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_label.dart';
import 'package:gratovo_toolbox/features/outreach/application/scheduled_send_controller.dart';
import 'package:gratovo_toolbox/features/settings/application/credential_health_controller.dart';

/// A `mailto:` body longer than this is left out of the URL and copied to the
/// clipboard instead — Windows and several mail clients silently truncate or
/// reject a command line past ~2000 characters, and a half-sent draft is
/// worse than an obvious "paste the body in" step.
const _mailtoBodyLimit = 1500;

/// Everything the composer holds for one thread. Immutable; every edit
/// produces a new instance so the family notifier's listeners rebuild.
class ComposeState {
  const ComposeState({
    this.method = ContactMethod.email,
    this.recipientValue,
    this.subject = '',
    this.body = '',
    this.templateId,
    this.lastDraftWasAi = false,
    this.isGenerating = false,
    this.needsContact = false,
    this.isSending = false,
  });

  /// How this message will go out. Drives the whole composer shape — email
  /// gets To + Subject + mailto; everything else is body-only + copy buttons.
  final ContactMethod method;

  /// The address/handle actually being written to, taken from the channel's
  /// [InfluencerContact] list (never free-typed).
  final String? recipientValue;

  final String subject;
  final String body;
  final String? templateId;

  /// Whether the current [body] started life as an AI draft — recorded on the
  /// message so "which of these did the model write" stays answerable.
  final bool lastDraftWasAi;

  final bool isGenerating;

  /// True when the channel has no contacts at all — the composer shows the
  /// inline add-a-contact row instead of the method picker.
  final bool needsContact;

  /// A Gmail send is in flight. Distinct from [isGenerating]: both disable the
  /// send button, and conflating them made the AI spinner appear during a send.
  final bool isSending;

  bool get hasRecipient => (recipientValue?.trim() ?? '').isNotEmpty;

  bool get isEmpty => subject.trim().isEmpty && body.trim().isEmpty;

  ComposeState copyWith({
    ContactMethod? method,
    Object? recipientValue = _unset,
    String? subject,
    String? body,
    Object? templateId = _unset,
    bool? lastDraftWasAi,
    bool? isGenerating,
    bool? needsContact,
    bool? isSending,
  }) {
    return ComposeState(
      method: method ?? this.method,
      recipientValue: recipientValue == _unset
          ? this.recipientValue
          : recipientValue as String?,
      subject: subject ?? this.subject,
      body: body ?? this.body,
      templateId:
          templateId == _unset ? this.templateId : templateId as String?,
      lastDraftWasAi: lastDraftWasAi ?? this.lastDraftWasAi,
      isGenerating: isGenerating ?? this.isGenerating,
      needsContact: needsContact ?? this.needsContact,
      isSending: isSending ?? this.isSending,
    );
  }
}

const _unset = Object();

/// Per-thread compose state + the send / draft / reply actions that were
/// scattered through `thread_detail_panel.dart`.
///
/// A `.family` keyed by thread id so switching conversations does not carry a
/// half-written draft across, and so a wide layout showing one thread while
/// another is composed keeps them apart.
class ComposeController extends Notifier<ComposeState> {
  ComposeController(this._threadId);

  /// Riverpod 3 hands a family's argument to the notifier's constructor
  /// rather than to `build` — held here so the AI-draft fallback label can
  /// use it when the influencer hasn't loaded.
  final String _threadId;

  bool _initialised = false;

  @override
  ComposeState build() => const ComposeState();

  /// Seeds the method and the recipient from the channel's contacts, once.
  /// Safe to call on every widget mount — only the first call for this thread
  /// seeds anything.
  ///
  /// No follow-ups are armed here any more (owner's decision, 2026-10-18):
  /// every message waits for a person, so a follow-up is written and approved
  /// when it is due. Sending schedules the reminder for it instead (see
  /// `follow_up_cadence.dart`).
  void initFor(Influencer influencer) {
    if (_initialised) return;
    _initialised = true;

    final contacts = influencer.contacts;
    if (contacts.isEmpty) {
      state = state.copyWith(needsContact: true);
      return;
    }
    final pick = influencer.primaryContact ?? contacts.first;
    state = state.copyWith(
      method: pick.method,
      recipientValue: pick.value,
      needsContact: false,
    );
  }

  void setMethod(ContactMethod method, {String? recipient}) {
    state = state.copyWith(
      method: method,
      recipientValue: recipient,
    );
  }

  void setRecipient(String? value) =>
      state = state.copyWith(recipientValue: value);

  void setSubject(String value) => state = state.copyWith(subject: value);

  void setBody(String value) => state = state.copyWith(body: value);

  void setTemplate(String? id) => state = state.copyWith(templateId: id);

  /// Puts a draft that was written outside [generateDraft] — the "Draft with
  /// Gemini" stepper's clean email — into the composer exactly as a generated
  /// one lands: the subject only where the method has one, and marked as AI
  /// so the activity log records it the same way.
  ///
  /// Follow-ups a drafter wrote with it are not carried over: a follow-up is
  /// written and approved when it is due, never queued behind a send.
  void applyExternalDraft({required String subject, required String body}) {
    state = state.copyWith(
      subject: state.method == ContactMethod.email ? subject : state.subject,
      body: body,
      lastDraftWasAi: true,
    );
  }

  /// Called by the inline add-contact row after it has written a new contact —
  /// continue composing to the address just added.
  void adoptContact(InfluencerContact contact) {
    _initialised = true;
    state = state.copyWith(
      method: contact.method,
      recipientValue: contact.value,
      needsContact: false,
    );
  }

  /// Clears the draft fields but keeps the chosen method/recipient — the next
  /// message in the same thread almost always goes the same way.
  void clearDraft() {
    state = state.copyWith(
      subject: '',
      body: '',
      templateId: null,
      lastDraftWasAi: false,
    );
  }

  /// Generates a draft into [subject]/[body] via [provider]. Returns null on
  /// success, or the provider's error message to surface in a snackbar
  /// (`TemplateFillAiProvider` never throws; a real hosted provider can).
  Future<String?> generateDraft({
    required Influencer? influencer,
    required List<Video> videos,
    required List<String> writingRules,
    required List<EmailTemplate> templates,
    required AiProvider provider,
  }) async {
    state = state.copyWith(isGenerating: true);
    try {
      EmailTemplate? template;
      final id = state.templateId;
      if (id != null) {
        for (final candidate in templates) {
          if (candidate.id == id) {
            template = candidate;
            break;
          }
        }
      }

      final fmt = ref.read(instantFormatterProvider);
      final latestVideo = videos.isNotEmpty ? videos.first : null;
      final latestUpload = latestVideo?.publishedAt;

      final result = await provider.draftEmail(
        AiDraftContext(
          influencerHandle: influencer?.handle ?? _threadId,
          influencerName: influencer?.name,
          templateSubject: template?.subject,
          templateBody: template?.body,
          recentVideoTitles: [for (final video in videos) video.title],
          relevanceCriteria: influencer?.relevanceCriteria ?? const [],
          writingRules: writingRules,
          lastVideoTitle: latestVideo?.title,
          lastVideoDate: latestUpload == null ? null : fmt.date(latestUpload),
          subscriberCount: influencer == null
              ? null
              : formatCount(
                  influencer.subscriberCount,
                  locale: fmt.locale,
                ),
          country: influencer?.country,
        ),
      );

      // A draft that came back is the only proof the key still works, and
      // this is the one place in the app that finds out.
      unawaited(
        ref
            .read(credentialHealthProvider.notifier)
            .report(CredentialArea.aiProvider, CredentialOutcome.ok),
      );
      state = state.copyWith(
        subject: state.method == ContactMethod.email
            ? result.subject
            : state.subject,
        body: result.body,
        lastDraftWasAi: true,
        isGenerating: false,
      );
      return null;
    } on AiProviderException catch (error) {
      // Only a refusal of the key itself is recorded. A rate limit or a
      // provider outage leaves the last known verdict standing, because
      // neither is evidence about the credential.
      if (error.isAuthFailure) {
        unawaited(
          ref
              .read(credentialHealthProvider.notifier)
              .report(CredentialArea.aiProvider, CredentialOutcome.rejected),
        );
      }
      state = state.copyWith(isGenerating: false);
      return error.message;
    }
  }

  /// A `mailto:` URL for the current draft, or null when the method is not
  /// email or there is no recipient. A very long body is omitted from the URL
  /// (see [mailtoOmitsBody]) and should be copied to the clipboard instead.
  String? buildMailto() {
    if (state.method != ContactMethod.email) return null;
    final to = state.recipientValue?.trim() ?? '';
    if (to.isEmpty) return null;

    final params = <String>[];
    if (state.subject.trim().isNotEmpty) {
      params.add('subject=${Uri.encodeComponent(state.subject)}');
    }
    if (state.body.trim().isNotEmpty && !mailtoOmitsBody) {
      params.add('body=${Uri.encodeComponent(state.body)}');
    }
    return 'mailto:$to${params.isEmpty ? '' : '?${params.join('&')}'}';
  }

  bool get mailtoOmitsBody =>
      state.method == ContactMethod.email &&
      state.body.length > _mailtoBodyLimit;

  /// Records the current draft as an outbound message, advances the thread
  /// (and, on the very first contact, the channel's pipeline stage), logs it,
  /// and clears the draft. Returns false — doing nothing — for an empty draft.
  Future<bool> markSent({
    required OutreachThread thread,
    required Influencer influencer,
  }) async {
    if (state.isEmpty) return false;
    await _recordOutbound(thread: thread, influencer: influencer);
    clearDraft();
    return true;
  }

  /// See [recordOutboundMessage] -- the same bookkeeping a scheduled send
  /// does, applied to what is in the composer now.
  Future<void> _recordOutbound({
    required OutreachThread thread,
    required Influencer influencer,
  }) {
    return recordOutboundMessage(
      ref,
      thread: thread,
      influencer: influencer,
      subject: state.subject,
      body: state.body,
      method: state.method,
      peerAddress: state.recipientValue?.trim(),
      isAiDrafted: state.lastDraftWasAi,
      templateId: state.templateId,
    );
  }

  /// Sends the draft through the team's Gmail mailbox and records it.
  ///
  /// The difference from [markSent] is what "sent" means. [markSent] records
  /// that a human said they sent something — through a mail client this app
  /// cannot see into, leaving a conversation it cannot follow. This one sends
  /// it, so three things become possible that were not before: the message
  /// threads, a follow-up can be queued behind it, and a reply is noticed
  /// automatically (see `outreach_inbox_controller.dart`).
  ///
  /// The order is send-then-record, and the failure it is chosen for is the
  /// asymmetric one. A message recorded but not sent is a CRM that lies about
  /// having contacted somebody — invisible, and it stops anyone from sending
  /// the real thing. A message sent but not recorded is visible in Gmail, and
  /// the next sweep still finds its replies. So nothing is written until Gmail
  /// has confirmed the send.
  Future<GmailSendOutcomeForUi> sendViaGmail({
    required OutreachThread thread,
    required Influencer influencer,
  }) async {
    if (state.isEmpty) return const GmailSendOutcomeForUi.nothingToSend();
    final recipient = state.recipientValue?.trim() ?? '';
    if (state.method != ContactMethod.email || recipient.isEmpty) {
      return const GmailSendOutcomeForUi.notEmail();
    }

    state = state.copyWith(isSending: true);
    try {
      final outcome = await ref.read(gmailGatewayProvider).send(
            GmailSendRequest(
              // The outreach thread id is the conversation key on the mailbox
              // side too, which is what lets a reply come back naming the
              // thread it belongs to without any mapping in between.
              conversationKey: thread.id,
              channelId: influencer.id,
              to: recipient,
              subject: state.subject.trim(),
              body: state.body,
              // Audience + stage, filed under the mailbox's parent label. The
              // stage is resolved to what the funnel will read as *after* this
              // send (see outreach_label.dart) — a cold first email is
              // "Contacted", not "New".
              labels: outreachInfluencerLabels(
                pipelineStage: influencer.pipelineStage,
                threadStatus: thread.status,
              ),
              // Nothing is queued behind the message: a follow-up is drafted
              // and approved when it is due (owner's decision, 2026-10-18).
            ),
          );

      if (!outcome.succeeded) {
        state = state.copyWith(isSending: false);
        return GmailSendOutcomeForUi.failed(outcome.error!);
      }

      final receipt = outcome.value!;
      await _recordOutbound(thread: thread, influencer: influencer);
      state = state.copyWith(isSending: false);
      clearDraft();
      return GmailSendOutcomeForUi.sent(receipt);
    } catch (error) {
      state = state.copyWith(isSending: false);
      return GmailSendOutcomeForUi.failed(GmailError.unavailable('$error'));
    }
  }

  /// Puts the draft on the "Send later" list, to go out through the mailbox
  /// at [sendAtUtc], and clears the composer.
  ///
  /// Everything is taken now -- recipient and words -- so what goes out later
  /// is what the person was looking at when they chose the time. Refuses (returning why) the
  /// same drafts [sendViaGmail] would refuse, so a message that could not be
  /// sent now is not discovered to be unsendable at 9 tomorrow morning.
  Future<ScheduleSendResult> scheduleSend({
    required OutreachThread thread,
    required Influencer influencer,
    required DateTime sendAtUtc,
  }) async {
    if (state.isEmpty) return ScheduleSendResult.nothingToSend;
    final recipient = state.recipientValue?.trim() ?? '';
    if (state.method != ContactMethod.email || recipient.isEmpty) {
      return ScheduleSendResult.notEmail;
    }
    final now = ref.read(scheduledSendClockProvider)();
    await ref.read(scheduledSendProvider.notifier).add(
          ScheduledEmail(
            id: localUuid(),
            threadId: thread.id,
            influencerId: influencer.id,
            handle: influencer.handle,
            to: recipient,
            subject: state.subject.trim(),
            body: state.body,
            templateId: state.templateId,
            isAiDrafted: state.lastDraftWasAi,
            sendAt: sendAtUtc.toUtc(),
            createdAt: now,
          ),
        );
    clearDraft();
    return ScheduleSendResult.scheduled;
  }

  /// Puts a scheduled email back into the composer to be changed -- its
  /// words and recipient exactly as they were queued. The caller
  /// has already taken it off the list; sending it is up to the person again.
  void restoreScheduled(ScheduledEmail email) {
    _initialised = true;
    state = state.copyWith(
      method: ContactMethod.email,
      recipientValue: email.to,
      needsContact: false,
      subject: email.subject,
      body: email.body,
      templateId: email.templateId,
      lastDraftWasAi: email.isAiDrafted,
    );
  }

  /// Records an inbound message and flips the thread to `replied`, clearing
  /// any outstanding follow-up nudges for this channel.
  Future<void> logReply({
    required OutreachThread thread,
    required Influencer influencer,
    required String body,
    required ContactMethod method,
    required DateTime at,
  }) async {
    final outreach = ref.read(outreachRepositoryProvider);
    await outreach.recordMessage(
      threadId: thread.id,
      direction: MessageDirection.inbound,
      subject: '',
      body: body,
      method: method,
      at: at,
    );
    await outreach.updateThreadStatus(thread.id, ThreadStatus.replied);
    await ref
        .read(followUpSchedulerProvider)
        .clearAllForInfluencer(influencer.id);

    _announceThreadChange();
  }

  void _announceThreadChange() => announceThreadChange(ref);
}

/// Why [ComposeController.scheduleSend] did or did not queue the draft.
enum ScheduleSendResult { scheduled, nothingToSend, notEmail }

/// What a Gmail send did, in the terms the composer has to render.
///
/// A sealed-ish result rather than a thrown exception or a bare bool: three of
/// these four outcomes are ordinary states with different things to say, and
/// only one of them is a failure at all.
class GmailSendOutcomeForUi {
  const GmailSendOutcomeForUi.sent(GmailSendReceipt this.receipt)
      : error = null,
        isEmptyDraft = false,
        isWrongMethod = false;

  const GmailSendOutcomeForUi.nothingToSend()
      : receipt = null,
        error = null,
        isEmptyDraft = true,
        isWrongMethod = false;

  /// The composer is on WhatsApp/Instagram/etc. The mailbox sends email; the
  /// copy-and-open hand-off is the right path for everything else.
  const GmailSendOutcomeForUi.notEmail()
      : receipt = null,
        error = null,
        isEmptyDraft = false,
        isWrongMethod = true;

  const GmailSendOutcomeForUi.failed(GmailError this.error)
      : receipt = null,
        isEmptyDraft = false,
        isWrongMethod = false;

  final GmailSendReceipt? receipt;
  final GmailError? error;
  final bool isEmptyDraft;
  final bool isWrongMethod;

  bool get succeeded => receipt != null;
}

final composeControllerProvider =
    NotifierProvider.family<ComposeController, ComposeState, String>(
  ComposeController.new,
);
