import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';
import 'package:gratovo_toolbox/features/outreach/application/gmail_gateway.dart';

/// A [GmailGateway] that sends nothing: it records each request and answers
/// with a receipt, or with [failWith] when set.
class FakeGmailGateway implements GmailGateway {
  final sent = <GmailSendRequest>[];
  GmailError? failWith;

  @override
  Future<GmailOutcome<GmailSendReceipt>> send(GmailSendRequest request) async {
    sent.add(request);
    if (failWith != null) return GmailOutcome.failure(failWith);
    return GmailOutcome.success(GmailSendReceipt(
      account: 'outreach@gratovo.test',
      conversationKey: request.conversationKey,
      messageId: 'm${sent.length}',
      threadId: 'gt${sent.length}',
      sentAt: DateTime.utc(2026, 10, 18, 12),
      queuedFollowUps: const [],
    ));
  }

  @override
  Future<GmailOutcome<GmailStatus>> status() async =>
      const GmailOutcome.success(GmailStatus.unconfigured);

  @override
  Future<GmailOutcome<String>> connect() async =>
      const GmailOutcome.success('outreach@gratovo.test');

  @override
  Future<GmailOutcome<bool>> disconnect({String? account}) async =>
      const GmailOutcome.success(true);

  @override
  Future<GmailOutcome<GmailSweep>> runDue({
    bool checkOnly = false,
    String? conversationKey,
    int? limit,
    String? account,
  }) async =>
      const GmailOutcome.success(GmailSweep.empty);

  @override
  Future<GmailOutcome<int>> acknowledge(List<String> messageIds) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<int>> cancelFollowUps(String conversationKey) async =>
      const GmailOutcome.success(0);

  @override
  Future<GmailOutcome<String>> sendTest({String? to, String? account}) async =>
      const GmailOutcome.success('');
}
