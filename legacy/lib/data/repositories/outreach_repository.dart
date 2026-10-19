import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';

/// How the UI reads and writes outreach threads and their messages. See
/// influencer_repository.dart's doc comment for the mock/Supabase swap
/// pattern this follows.
abstract class OutreachRepository {
  /// Every thread with a channel — the Outreach page's list. Brand threads
  /// are not in it; see [getThreadsForBrand].
  Future<List<OutreachThread>> getAllThreads();

  Future<OutreachThread?> getThreadById(String id);

  Future<OutreachThread?> getThreadByInfluencer(String influencerId);

  /// Creates a thread for this influencer if one doesn't already exist,
  /// otherwise returns the existing one — every influencer gets at most
  /// one thread.
  Future<OutreachThread> getOrCreateThreadForInfluencer(String influencerId);

  /// The thread with this brand contact, created if there is none yet —
  /// one per brand and address (compared without case).
  Future<OutreachThread> getOrCreateThreadForBrand(
    String brandId,
    String contactEmail,
  );

  /// Every thread with this brand's contacts, newest first.
  Future<List<OutreachThread>> getThreadsForBrand(String brandId);

  Future<void> updateThreadStatus(String threadId, ThreadStatus status);

  /// Assigns or unassigns who on the team owns this conversation. Null
  /// clears it.
  Future<void> updateThreadOwner(String threadId, String? ownerId);

  /// Messages in a thread, oldest first.
  Future<List<OutreachMessage>> getMessages(String threadId);

  /// How many outbound messages were sent at or after [since], across every
  /// thread — the Dashboard's "emails sent today" stat. Covers both the
  /// manual "record as sent" path and the Gmail auto-send path, since both
  /// land as an outbound row via [recordMessage]. Returns 0 for a caller
  /// without full authority (the messages table is full-authority-only).
  Future<int> countOutboundSince(DateTime since);

  /// Records a message that was actually sent/received (no real email
  /// integration — see outreach_message.dart) and returns the stored
  /// record, id included. The repository owns id generation so callers
  /// never have to fabricate one themselves.
  ///
  /// [method] is how it went out or came in (email, a WhatsApp message, an
  /// IG DM). [peerAddress] is the counterparty address/handle used. [at]
  /// defaults to now — passed only when logging a reply that arrived earlier.
  Future<OutreachMessage> recordMessage({
    required String threadId,
    required MessageDirection direction,
    required String subject,
    required String body,
    ContactMethod method = ContactMethod.email,
    String? peerAddress,
    DateTime? at,
    bool isAiDrafted = false,
    String? templateId,
  });

  /// Removes one recorded message. Used by the "this should not be here"
  /// case — a reply logged against the wrong thread, a draft marked sent
  /// twice — not as an edit mechanism: an outbound message that really went
  /// out cannot be unsent, and deleting the record only stops the CRM
  /// claiming otherwise.
  Future<void> deleteMessage(String messageId);

  /// Sets or clears an inbound message's [MessageClassification]. A no-op
  /// on an outbound message is left to the caller to avoid — the interface
  /// does not reject it, since the field exists on every message row.
  Future<void> updateMessageClassification(
    String messageId,
    MessageClassification? classification,
  );

  /// Removes a whole conversation and every message in it.
  ///
  /// The thread row is the conversation key the mailbox sweep matches replies
  /// against, so deleting one means later replies to that email arrive with
  /// nothing to attach to. That is the intended outcome for a conversation
  /// somebody has decided should not exist; it is not a way to tidy up an
  /// active one.
  Future<void> deleteThread(String threadId);
}
