import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/core/native/comms_protocol.dart';
import 'package:gratovo_toolbox/core/native/gemini_bridge.dart';
import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/core/sync/sync_providers.dart';
import 'package:gratovo_toolbox/data/models/comms_proposal.dart';
import 'package:gratovo_toolbox/data/models/follow_up_reminder.dart';
import 'package:gratovo_toolbox/data/models/influencer.dart';
import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/influencer_query.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';
import 'package:gratovo_toolbox/features/outreach/application/follow_up_cadence.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';
import 'package:gratovo_toolbox/features/outreach/application/outbound_recorder.dart';
import 'package:gratovo_toolbox/features/outreach/application/outreach_label.dart';
import 'package:gratovo_toolbox/features/settings/application/agency_settings_controller.dart';

/// Something waiting on us that the engine can draft: a reply to answer, a
/// follow-up that is due, a shortlisted creator never written to.
class CommsCandidate {
  const CommsCandidate({
    required this.request,
    required this.title,
    this.detail = '',
    this.dueAt,
  });

  /// What a click on Draft asks the engine for.
  final CommsRequest request;

  /// Who it is: a channel's handle, or a brand and its contact.
  final String title;

  /// Their last words, or which follow-up this is.
  final String detail;
  final DateTime? dueAt;
}

/// The Comms queue as the screen reads it.
class CommsQueueView {
  const CommsQueueView({
    this.proposals = const [],
    this.replies = const [],
    this.followUps = const [],
    this.newOutreach = const [],
    this.sentToday = 0,
    this.dailyTarget = 50,
  });

  /// Drafts waiting for a person, newest first.
  final List<CommsProposal> proposals;

  /// Items not drafted yet.
  final List<CommsCandidate> replies;
  final List<CommsCandidate> followUps;
  final List<CommsCandidate> newOutreach;

  /// Messages sent today, against the agency's daily target (decision
  /// daily-target).
  final int sentToday;
  final int dailyTarget;

  /// The engine asked a person something, or refused: shown under Decisions.
  bool isDecision(CommsProposal p) =>
      p.kind == CommsKind.decision ||
      p.engineStatus == CommsEngineStatus.needsHuman ||
      p.status == CommsQueueStatus.blocked;

  List<CommsProposal> proposalsFor(CommsKind kind) => [
        for (final p in proposals)
          if (p.kind == kind && !isDecision(p)) p,
      ];

  List<CommsProposal> get decisions => [
        for (final p in proposals)
          if (isDecision(p)) p,
      ];
}

/// What [CommsQueueController.send] did.
sealed class CommsSendResult {
  const CommsSendResult();
}

class CommsSent extends CommsSendResult {
  const CommsSent();
}

/// Edited text failed the checks: nothing went.
class CommsBlocked extends CommsSendResult {
  const CommsBlocked(this.findings);
  final List<CommsFinding> findings;
}

/// A person must confirm these first (price, terms, claim, ethics, or the
/// engine's own question). Send again with `gatesConfirmed: true`.
class CommsNeedsConfirmation extends CommsSendResult {
  const CommsNeedsConfirmation(this.gates);
  final List<CommsGate> gates;
}

/// No email address to send to.
class CommsNoRecipient extends CommsSendResult {
  const CommsNoRecipient();
}

class CommsSendFailed extends CommsSendResult {
  const CommsSendFailed(this.message);
  final String message;
}

/// The mailbox sent it, but writing it into the conversation failed. It is
/// marked sent, so it is never offered again; [error] says what to fix.
class CommsSentNotRecorded extends CommsSendResult {
  const CommsSentNotRecorded(this.error);
  final String error;
}

/// How many shortlisted, never-contacted creators the queue offers at once.
const int kCommsNewOutreachLimit = 20;

/// The Comms queue (plan step 6). The engine drafts only when a person asks,
/// one item at a time; nothing is sent until a person presses Send — edited
/// text is checked again first, and the gates are confirmed.
class CommsQueueController extends AsyncNotifier<CommsQueueView> {
  @override
  Future<CommsQueueView> build() async {
    for (final domain in const [
      DataDomain.comms,
      DataDomain.outreach,
      DataDomain.reminders,
      DataDomain.channels,
      DataDomain.brands,
    ]) {
      ref.watch(dataRevisionProvider(domain));
    }
    final agency = await ref.watch(agencySettingsProvider.future);
    final proposals = await ref.read(commsProposalRepositoryProvider).getOpen();
    final drafted = {
      for (final p in proposals) ...[
        if (p.threadId != null) 'thread:${p.threadId}',
        if (p.kind == CommsKind.first && p.channelId != null)
          'channel:${p.channelId}',
      ],
    };
    final outreach = ref.read(outreachRepositoryProvider);
    final influencers = ref.read(influencerRepositoryProvider);
    final now = DateTime.now();
    final midnight = DateTime(now.year, now.month, now.day);

    final replies = <CommsCandidate>[];
    for (final thread in await outreach.getAllThreads()) {
      if (thread.status != ThreadStatus.replied) continue;
      if (drafted.contains('thread:${thread.id}')) continue;
      final messages = await outreach.getMessages(thread.id);
      if (messages.isEmpty ||
          messages.last.direction != MessageDirection.inbound) {
        continue;
      }
      final creator = await influencers.getById(thread.influencerId);
      replies.add(CommsCandidate(
        request: CommsRequest(
          kind: CommsKind.reply,
          threadId: thread.id,
          channelId: thread.influencerId,
        ),
        title: creator?.handle ?? thread.influencerId,
        detail: _excerpt(messages.last.body),
      ));
    }
    for (final brand in await ref.read(brandRepositoryProvider).getAll()) {
      for (final thread in await outreach.getThreadsForBrand(brand.id)) {
        if (drafted.contains('thread:${thread.id}')) continue;
        final messages = await outreach.getMessages(thread.id);
        if (messages.isEmpty ||
            messages.last.direction != MessageDirection.inbound) {
          continue;
        }
        replies.add(CommsCandidate(
          request: CommsRequest(
            kind: CommsKind.reply,
            threadId: thread.id,
            brandId: brand.id,
            contactEmail: thread.contactEmail,
          ),
          title: '${brand.name} · ${thread.contactEmail ?? ''}',
          detail: _excerpt(messages.last.body),
        ));
      }
    }

    final followUps = <CommsCandidate>[];
    for (final reminder
        in await ref.read(reminderRepositoryProvider).getUpcoming()) {
      final channelId = reminder.influencerId;
      if (reminder.kind != ReminderKind.followUp ||
          channelId == null ||
          reminder.dueAt.isAfter(now)) {
        continue;
      }
      final thread = await outreach.getThreadByInfluencer(channelId);
      if (thread == null || drafted.contains('thread:${thread.id}')) continue;
      final number = followUpsSent(await outreach.getMessages(thread.id)) + 1;
      if (number > kMaxFollowUps) continue;
      final creator = await influencers.getById(channelId);
      followUps.add(CommsCandidate(
        request: CommsRequest(
          kind: CommsKind.followUp,
          threadId: thread.id,
          channelId: channelId,
          followUpNumber: number,
        ),
        title: creator?.handle ?? channelId,
        detail: reminder.title,
        dueAt: reminder.dueAt,
      ));
    }

    // Never-contacted is asked of the database, so creators already written
    // to never fill the window; the room for open drafts and the few out of
    // scope (HC-08) is added on top.
    final page = await influencers.getPage(
      offset: 0,
      limit: kCommsNewOutreachLimit * 2 + drafted.length,
      query: const InfluencerQuery(requireFlags: {
        InfluencerFlag.shortlisted,
        InfluencerFlag.neverContacted,
      }),
    );
    final newOutreach = <CommsCandidate>[
      for (final creator in page.items)
        if (creator.contactAttempts == 0 &&
            !(creator.creatorGender?.outOfScope ?? false) &&
            !drafted.contains('channel:${creator.id}'))
          CommsCandidate(
            request: CommsRequest(kind: CommsKind.first, channelId: creator.id),
            title: creator.handle,
            detail: creator.name ?? '',
          ),
    ].take(kCommsNewOutreachLimit).toList();

    return CommsQueueView(
      proposals: proposals,
      replies: replies,
      followUps: followUps,
      newOutreach: newOutreach,
      sentToday: await outreach.countOutboundSince(midnight.toUtc()),
      dailyTarget: agency.dailyTarget,
    );
  }

  static String _excerpt(String text) {
    final flat = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    return flat.length <= 160 ? flat : '${flat.substring(0, 157)}…';
  }

  void _changed() =>
      ref.read(dataRevisionsProvider.notifier).bump({DataDomain.comms});

  /// Asks the engine for [request] and puts the answer in the queue. A brand
  /// item gets its thread first, so the draft knows where it will go.
  ///
  /// An item that already has an open proposal gets that one back without
  /// asking again — one open draft per conversation, so two can never both be
  /// sent. [replacing] is the draft a redo is about to set aside.
  Future<CommsProposal> draft(CommsRequest request, {String? replacing}) async {
    final open = await _openFor(
      threadId: request.threadId,
      channelId: request.threadId == null ? request.channelId : null,
      brandId: request.threadId == null ? request.brandId : null,
      except: replacing,
    );
    if (open.isNotEmpty) return open.first;
    var asked = request;
    // A thread names who it is with: the proposal keeps that, so Send knows
    // where it goes.
    if (request.threadId != null &&
        request.channelId == null &&
        request.brandId == null) {
      final thread = await ref
          .read(outreachRepositoryProvider)
          .getThreadById(request.threadId!);
      if (thread != null) {
        asked = CommsRequest(
          kind: request.kind,
          threadId: thread.id,
          channelId: thread.isBrandThread ? null : thread.influencerId,
          brandId: thread.brandId,
          contactEmail: thread.contactEmail,
          followUpNumber: request.followUpNumber,
          steer: request.steer,
          note: request.note,
          cashOffer: request.cashOffer,
        );
      }
    }
    if (request.brandId != null &&
        request.threadId == null &&
        (request.contactEmail ?? '').isNotEmpty) {
      final thread = await ref
          .read(outreachRepositoryProvider)
          .getOrCreateThreadForBrand(request.brandId!, request.contactEmail!);
      asked = CommsRequest(
        kind: request.kind,
        threadId: thread.id,
        brandId: request.brandId,
        contactEmail: request.contactEmail,
        pitchChannelIds: request.pitchChannelIds,
        steer: request.steer,
        note: request.note,
        cashOffer: request.cashOffer,
      );
    }
    final result = await ref.read(geminiBridgeProvider).commsPropose(asked);
    final saved = await ref
        .read(commsProposalRepositoryProvider)
        .save(CommsProposal.fromResult(asked, result));
    _changed();
    return saved;
  }

  /// A first email pitching [channelIds] to a brand contact (plan step 4/6):
  /// started from a campaign's shortlist, with ready creators only. The
  /// engine refuses any that are not ready all the same (BRD-PRES-15).
  Future<CommsProposal> draftBrandPitch({
    required String brandId,
    required String contactEmail,
    required List<String> channelIds,
  }) =>
      draft(CommsRequest(
        kind: CommsKind.first,
        brandId: brandId,
        contactEmail: contactEmail,
        pitchChannelIds: channelIds,
      ));

  /// Asks again for the same item with the Steer panel's corrections; the
  /// old draft is set aside.
  Future<CommsProposal> redo(
    CommsProposal proposal, {
    Map<String, String> steer = const {},
    String? note,
    bool cashOffer = false,
  }) async {
    final next = await draft(
      CommsRequest(
        kind: proposal.kind,
        threadId: proposal.threadId,
        channelId: proposal.channelId,
        brandId: proposal.brandId,
        steer: steer,
        note: note,
        cashOffer: cashOffer,
      ),
      replacing: proposal.id,
    );
    await ref
        .read(commsProposalRepositoryProvider)
        .decide(proposal.id, CommsQueueStatus.skipped, decidedBy: _actor());
    _changed();
    return next;
  }

  Future<void> skip(CommsProposal proposal) async {
    await ref
        .read(commsProposalRepositoryProvider)
        .decide(proposal.id, CommsQueueStatus.skipped, decidedBy: _actor());
    _changed();
  }

  String? _actor() {
    try {
      return ref.read(syncActorProvider).id;
    } on Object catch (_) {
      return null;
    }
  }

  /// Sends [proposal] as [subject] and [body] — the person's words, edited or
  /// not. The text is always checked again against the case as it is now (a
  /// placeholder left in, a creator flagged since the draft); the gates must
  /// be confirmed.
  Future<CommsSendResult> send(
    CommsProposal proposal, {
    required String subject,
    required String body,
    bool gatesConfirmed = false,
  }) async {
    final edited = subject != proposal.subject || body != proposal.body;
    final check = await ref.read(geminiBridgeProvider).commsCheck(
          CommsRequest(
            kind: proposal.kind,
            threadId: proposal.threadId,
            channelId: proposal.channelId,
            brandId: proposal.brandId,
          ),
          subject: subject,
          body: body,
        );
    if (check.blocking) {
      return CommsBlocked([
        for (final f in check.findings)
          if (f.blocking) f,
      ]);
    }
    // Edited text is the person's own: the check's gates are the ones that
    // apply. Unedited text keeps the engine's gates as well.
    final gates = edited
        ? check.gates
        : [
            ...proposal.needsHuman,
            for (final g in check.gates)
              if (!proposal.needsHuman.any((n) => n.what == g.what)) g,
          ];
    if (gates.isNotEmpty && !gatesConfirmed) {
      return CommsNeedsConfirmation(gates);
    }

    final outreach = ref.read(outreachRepositoryProvider);
    final repository = ref.read(commsProposalRepositoryProvider);
    OutreachThread? thread = proposal.threadId == null
        ? null
        : await outreach.getThreadById(proposal.threadId!);
    Influencer? creator;
    String recipient;
    if (proposal.brandId != null) {
      recipient = thread?.contactEmail ?? '';
    } else {
      creator = proposal.channelId == null
          ? null
          : await ref
              .read(influencerRepositoryProvider)
              .getById(proposal.channelId!);
      recipient =
          creator == null ? '' : creatorRecipient(creator)?.address ?? '';
    }
    if (recipient.isEmpty) return const CommsNoRecipient();
    if (thread == null && creator != null) {
      thread = await outreach.getOrCreateThreadForInfluencer(creator.id);
    }
    if (thread == null) return const CommsNoRecipient();

    final outcome = await ref.read(gmailGatewayProvider).send(GmailSendRequest(
          // One key per proposal: a retry after a lost answer is answered
          // with the first send, never a second email.
          sendKey: proposal.id,
          conversationKey: thread.id,
          channelId: creator?.id,
          to: recipient,
          subject: subject.trim(),
          body: body,
          labels: creator == null
              ? const []
              : outreachInfluencerLabels(
                  pipelineStage: creator.pipelineStage,
                  threadStatus: thread.status,
                ),
        ));
    if (!outcome.succeeded) {
      final message = outcome.error?.message ?? 'The mailbox did not send it.';
      await repository.decide(proposal.id, CommsQueueStatus.failed,
          decidedBy: _actor(), error: message);
      _changed();
      return CommsSendFailed(message);
    }

    // Marked sent the moment the mailbox has it, before anything else can
    // fail: a sent message is never offered for sending again.
    await repository.decide(proposal.id, CommsQueueStatus.sent,
        decidedBy: _actor(), subject: subject.trim(), body: body);
    for (final sibling in await _openFor(
      threadId: thread.id,
      channelId: proposal.channelId,
      brandId: proposal.brandId,
      except: proposal.id,
    )) {
      await repository.decide(sibling.id, CommsQueueStatus.skipped,
          decidedBy: _actor());
    }
    try {
      if (creator != null) {
        await recordOutboundMessage(
          ref,
          thread: thread,
          influencer: creator,
          subject: subject.trim(),
          body: body,
          method: ContactMethod.email,
          peerAddress: recipient,
          isAiDrafted: true,
        );
      } else {
        await outreach.recordMessage(
          threadId: thread.id,
          direction: MessageDirection.outbound,
          subject: subject.trim(),
          body: body,
          peerAddress: recipient,
          isAiDrafted: true,
        );
        await outreach.updateThreadStatus(
            thread.id, ThreadStatus.awaitingReply);
      }
    } on Object catch (error) {
      _bumpSent();
      return CommsSentNotRecorded('$error');
    }
    _bumpSent();
    return const CommsSent();
  }

  void _bumpSent() => ref
      .read(dataRevisionsProvider.notifier)
      .bump({DataDomain.comms, DataDomain.outreach});

  /// Open proposals for the same conversation: the thread, or for an item
  /// with no thread yet, the creator or the brand.
  Future<List<CommsProposal>> _openFor({
    String? threadId,
    String? channelId,
    String? brandId,
    String? except,
  }) async {
    if (threadId == null && channelId == null && brandId == null) {
      return const [];
    }
    final open = await ref.read(commsProposalRepositoryProvider).getOpen();
    return [
      for (final p in open)
        if (p.id != except &&
            ((threadId != null && p.threadId == threadId) ||
                (channelId != null && p.channelId == channelId) ||
                (brandId != null && p.brandId == brandId)))
          p,
    ];
  }
}

final commsQueueProvider =
    AsyncNotifierProvider<CommsQueueController, CommsQueueView>(
  CommsQueueController.new,
);

/// Who a proposal's email goes to, as its card shows it before Send.
class CommsRecipient {
  const CommsRecipient(this.address, {this.unconfirmed = false});

  final String address;

  /// Found by the pipeline on the channel (fix #11) and never confirmed by a
  /// person — the card says so, so nobody sends to it unawares.
  final bool unconfirmed;
}

/// The creator's email: the primary contact, any email contact, or one the
/// pipeline found published (unconfirmed). Null when there is none.
CommsRecipient? creatorRecipient(Influencer creator) {
  final emails = [
    for (final c in creator.contacts)
      if (c.method == ContactMethod.email && c.value.trim().isNotEmpty) c,
  ];
  final primary = emails.where((c) => c.isPrimary);
  if (primary.isNotEmpty) return CommsRecipient(primary.first.value.trim());
  if (emails.isNotEmpty) return CommsRecipient(emails.first.value.trim());
  final found = [
    for (final e in creator.foundEmails)
      if (e.trim().isNotEmpty) e.trim(),
  ];
  return found.isEmpty ? null : CommsRecipient(found.first, unconfirmed: true);
}

typedef CommsRecipientKey = ({
  String? threadId,
  String? channelId,
  String? brandId,
});

/// The address [CommsQueueController.send] will use for a proposal: a brand
/// thread's contact, or the creator's email by [creatorRecipient].
final commsRecipientProvider = FutureProvider.autoDispose
    .family<CommsRecipient?, CommsRecipientKey>((ref, key) async {
  ref.watch(dataRevisionProvider(DataDomain.channels));
  ref.watch(dataRevisionProvider(DataDomain.outreach));
  if (key.brandId != null) {
    final thread = key.threadId == null
        ? null
        : await ref
            .read(outreachRepositoryProvider)
            .getThreadById(key.threadId!);
    final address = thread?.contactEmail?.trim() ?? '';
    return address.isEmpty ? null : CommsRecipient(address);
  }
  if (key.channelId == null) return null;
  final creator =
      await ref.read(influencerRepositoryProvider).getById(key.channelId!);
  return creator == null ? null : creatorRecipient(creator);
});
