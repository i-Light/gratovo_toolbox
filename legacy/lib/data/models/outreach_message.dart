import 'package:gratovo_toolbox/data/models/influencer_contact.dart';

/// Which side of the conversation sent a message.
enum MessageDirection {
  outbound,
  inbound;
}

/// What an inbound reply actually said, as a fixed vocabulary — the outreach
/// inbox's "what came back" filter and the reply-classification stats depend
/// on everyone picking from the same short list rather than free text.
/// Mirrors the `outreach_messages.classification` check constraint in
/// `backend/schema.sql` exactly; null means nobody has classified it yet.
enum MessageClassification {
  interested,
  askingRate,
  notNow,
  decline,
  wrongContact,
  autoReply;

  String get wire => name;

  static MessageClassification? fromWire(String? value) {
    if (value == null) return null;
    for (final c in MessageClassification.values) {
      if (c.wire == value) return c;
    }
    return null;
  }
}

/// One message in an [OutreachThread]. There's no real email/inbox
/// integration — outbound messages are recorded when the owner/team actually
/// sends something themselves (via the OS mail client or a social DM), and
/// inbound ones are recorded by hand when a reply comes in. This is a CRM log
/// of the conversation, not a mail client.
class OutreachMessage {
  const OutreachMessage({
    required this.id,
    required this.threadId,
    required this.direction,
    required this.subject,
    required this.body,
    required this.at,
    this.method = ContactMethod.email,
    this.peerAddress,
    this.isAiDrafted = false,
    this.templateId,
    this.classification,
  });

  final String id;
  final String threadId;
  final MessageDirection direction;

  /// What this reply actually said, once someone has classified it. Only
  /// meaningful on an inbound message; never set on an outbound one.
  final MessageClassification? classification;

  /// How this message went out (or came in) — email, a WhatsApp message, an
  /// Instagram DM, etc. Named [method] rather than "channel" because
  /// `channel_id` / `channels` already mean the YouTube channel throughout
  /// this app; this reuses [ContactMethod] from `influencer_contact.dart`.
  final ContactMethod method;

  /// The counterparty address/handle actually used (the email address, the
  /// WhatsApp number, the IG handle). Null for a `basic` reader — the server
  /// withholds it — and for older rows recorded before this was captured.
  final String? peerAddress;

  final String subject;
  final String body;
  final DateTime at;

  /// Whether an AI provider (see `lib/core/ai/`) generated this message's
  /// starting draft. Kept even if the draft was then hand-edited — it's
  /// still useful to know which messages started from an AI draft.
  final bool isAiDrafted;

  final String? templateId;
}
