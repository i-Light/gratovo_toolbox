import 'package:gratovo_toolbox/data/models/influencer_contact.dart';
import 'package:gratovo_toolbox/data/models/outreach_message.dart';
import 'package:gratovo_toolbox/data/models/outreach_thread.dart';
import 'package:gratovo_toolbox/data/repositories/outreach_repository.dart';

/// In-memory [OutreachRepository], seeded with 3 threads across 3 different
/// [ThreadStatus] values so the Outreach page has realistic variety to
/// show on first load: one already replied (and its deal is signed), one
/// awaiting a reply mid-negotiation, and one that's gone quiet and needs a
/// follow-up nudge.
class MockOutreachRepository implements OutreachRepository {
  final List<OutreachThread> _threads = [
    OutreachThread(
      id: 'thread_001',
      influencerId: 'inf_001',
      dealId: 'deal_001',
      status: ThreadStatus.replied,
      updatedAt: DateTime.now().subtract(const Duration(days: 2)),
    ),
    OutreachThread(
      id: 'thread_002',
      influencerId: 'inf_007',
      dealId: 'deal_003',
      status: ThreadStatus.awaitingReply,
      updatedAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
    OutreachThread(
      id: 'thread_003',
      influencerId: 'inf_006',
      dealId: 'deal_005',
      status: ThreadStatus.needsFollowUp,
      updatedAt: DateTime.now().subtract(const Duration(days: 12)),
    ),
  ];

  final List<OutreachMessage> _messages = [
    OutreachMessage(
      id: 'msg_001',
      threadId: 'thread_001',
      direction: MessageDirection.outbound,
      subject: 'Quick collab idea for @TechWithTaha',
      body: 'Hi TechWithTaha team, reaching out from Gratovo about a '
          'possible NordVPN collab...',
      at: DateTime.now().subtract(const Duration(days: 18)),
      isAiDrafted: true,
      templateId: 'tmpl_001',
    ),
    OutreachMessage(
      id: 'msg_002',
      threadId: 'thread_001',
      direction: MessageDirection.inbound,
      subject: 'Re: Quick collab idea for @TechWithTaha',
      body: "Sounds interesting, send over the details and let's talk "
          'numbers.',
      at: DateTime.now().subtract(const Duration(days: 16)),
    ),
    OutreachMessage(
      id: 'msg_003',
      threadId: 'thread_001',
      direction: MessageDirection.outbound,
      subject: 'Contract + next steps',
      body: 'Great news — contract is signed on our end, sending over the '
          'brief now.',
      at: DateTime.now().subtract(const Duration(days: 2)),
    ),
    OutreachMessage(
      id: 'msg_004',
      threadId: 'thread_002',
      direction: MessageDirection.outbound,
      subject: "Let's find a number that works",
      body: 'Following up on the NordVPN rate — proposed \$2,800, let us '
          'know if that works.',
      at: DateTime.now().subtract(const Duration(days: 1)),
      isAiDrafted: true,
      templateId: 'tmpl_003',
    ),
    OutreachMessage(
      id: 'msg_005',
      threadId: 'thread_003',
      direction: MessageDirection.outbound,
      subject: 'Quick collab idea for @WanderlustWithSara',
      body: 'Hi Sara, reaching out from Gratovo about a possible NordVPN '
          'collab tied to your travel content...',
      at: DateTime.now().subtract(const Duration(days: 12)),
      isAiDrafted: true,
      templateId: 'tmpl_001',
    ),
  ];

  int _threadCounter = 4;
  int _messageCounter = 6;

  @override
  Future<List<OutreachThread>> getAllThreads() async {
    final threads = [
      for (final thread in _threads)
        if (!thread.isBrandThread) thread,
    ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return threads;
  }

  @override
  Future<OutreachThread> getOrCreateThreadForBrand(
    String brandId,
    String contactEmail,
  ) async {
    final email = contactEmail.trim().toLowerCase();
    for (final thread in _threads) {
      if (thread.brandId == brandId && thread.contactEmail == email) {
        return thread;
      }
    }
    final created = OutreachThread(
      id: 'thread_${_threadCounter++}',
      influencerId: '',
      brandId: brandId,
      contactEmail: email,
      status: ThreadStatus.notContactedYet,
      updatedAt: DateTime.now(),
    );
    _threads.add(created);
    return created;
  }

  @override
  Future<List<OutreachThread>> getThreadsForBrand(String brandId) async => [
        for (final thread in _threads)
          if (thread.brandId == brandId) thread,
      ]..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

  @override
  Future<OutreachThread?> getThreadById(String id) async {
    for (final thread in _threads) {
      if (thread.id == id) return thread;
    }
    return null;
  }

  @override
  Future<OutreachThread?> getThreadByInfluencer(String influencerId) async {
    for (final thread in _threads) {
      if (thread.influencerId == influencerId) return thread;
    }
    return null;
  }

  @override
  Future<OutreachThread> getOrCreateThreadForInfluencer(
    String influencerId,
  ) async {
    final existing = await getThreadByInfluencer(influencerId);
    if (existing != null) return existing;

    final created = OutreachThread(
      id: 'thread_${_threadCounter++}',
      influencerId: influencerId,
      status: ThreadStatus.notContactedYet,
      updatedAt: DateTime.now(),
    );
    _threads.add(created);
    return created;
  }

  @override
  Future<void> updateThreadStatus(String threadId, ThreadStatus status) async {
    final index = _threads.indexWhere((t) => t.id == threadId);
    if (index == -1) return;
    _threads[index] = _threads[index].copyWith(status: status);
  }

  @override
  Future<void> updateThreadOwner(String threadId, String? ownerId) async {
    final index = _threads.indexWhere((t) => t.id == threadId);
    if (index == -1) return;
    final t = _threads[index];
    _threads[index] = OutreachThread(
      id: t.id,
      influencerId: t.influencerId,
      dealId: t.dealId,
      ownerId: ownerId,
      status: t.status,
      updatedAt: DateTime.now(),
    );
  }

  @override
  Future<List<OutreachMessage>> getMessages(String threadId) async {
    final messages = _messages.where((m) => m.threadId == threadId).toList()
      ..sort((a, b) => a.at.compareTo(b.at));
    return messages;
  }

  @override
  Future<int> countOutboundSince(DateTime since) async {
    return _messages
        .where((m) =>
            m.direction == MessageDirection.outbound && m.at.isAfter(since))
        .length;
  }

  @override
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
  }) async {
    final message = OutreachMessage(
      id: 'msg_${_messageCounter++}',
      threadId: threadId,
      direction: direction,
      subject: subject,
      body: body,
      method: method,
      peerAddress: peerAddress,
      at: at ?? DateTime.now(),
      isAiDrafted: isAiDrafted,
      templateId: templateId,
    );
    _messages.add(message);
    return message;
  }

  @override
  Future<void> deleteMessage(String messageId) async {
    _messages.removeWhere((m) => m.id == messageId);
  }

  @override
  Future<void> updateMessageClassification(
    String messageId,
    MessageClassification? classification,
  ) async {
    final index = _messages.indexWhere((m) => m.id == messageId);
    if (index == -1) return;
    final m = _messages[index];
    _messages[index] = OutreachMessage(
      id: m.id,
      threadId: m.threadId,
      direction: m.direction,
      method: m.method,
      peerAddress: m.peerAddress,
      subject: m.subject,
      body: m.body,
      at: m.at,
      isAiDrafted: m.isAiDrafted,
      templateId: m.templateId,
      classification: classification,
    );
  }

  @override
  Future<void> deleteThread(String threadId) async {
    _threads.removeWhere((t) => t.id == threadId);
    _messages.removeWhere((m) => m.threadId == threadId);
  }
}
