import 'package:gratovo_toolbox/data/models/comms_proposal.dart';

/// The Comms queue's items, shared with the team (`comms_proposals`).
abstract class CommsProposalRepository {
  /// What still waits for a person — proposed, blocked, failed — newest first.
  Future<List<CommsProposal>> getOpen();

  Future<CommsProposal?> getById(String id);

  /// How many items were drafted from [since] on, whatever became of them —
  /// Home's "Drafted today".
  Future<int> countCreatedSince(DateTime since);

  /// Saves [proposal] whole; an empty id gets a fresh one. The saved item
  /// comes back.
  Future<CommsProposal> save(CommsProposal proposal);

  /// Records what a person did: the new status, who, when — and, when they
  /// edited it, the text that actually went.
  Future<void> decide(
    String id,
    CommsQueueStatus status, {
    String? decidedBy,
    String? subject,
    String? body,
    String? error,
  });
}
