/// One recurring local job — what the `scheduled_jobs` table backs for the
/// generic job scheduler another part of 1.3 builds on top of this
/// foundation. Per-machine only: `scheduled_jobs` is declared in
/// `mirror_schema.dart` alongside the synced tables but is never pulled
/// from or pushed to Supabase (see that file's doc comment), because a
/// schedule — "run the auto-clean sweep every night" — is a fact about one
/// installation, not something the team shares.
///
/// [kind] and [cadence] are free text owned by whichever feature registers
/// a job (e.g. `kind: 'auto_clean'`, `cadence: 'daily'`); this table only
/// knows when it last/next ran and whether it is switched on. [config] is
/// that job's own parameters, opaque to this model.
class ScheduledJob {
  const ScheduledJob({
    required this.id,
    required this.kind,
    required this.cadence,
    required this.createdAt,
    required this.updatedAt,
    this.lastRunAt,
    this.nextRunAt,
    this.enabled = true,
    this.config,
  });

  final String id;
  final String kind;
  final String cadence;
  final DateTime? lastRunAt;
  final DateTime? nextRunAt;
  final bool enabled;

  /// Whatever parameters [kind]'s own runner needs, e.g.
  /// `{"keepDays": 7}`.
  final Map<String, dynamic>? config;

  final DateTime createdAt;
  final DateTime updatedAt;

  /// Whether the scheduler should run this job right now.
  bool get isDue =>
      enabled && nextRunAt != null && !nextRunAt!.isAfter(DateTime.now());

  /// [id], [kind] and [createdAt] are identity and never change through
  /// [copyWith] — a job's kind is what it is; retiring one means disabling
  /// or deleting it, not repurposing its row. [updatedAt] defaults to now —
  /// the same opt-out rule as [Deal.copyWith].
  ScheduledJob copyWith({
    String? cadence,
    DateTime? lastRunAt,
    DateTime? nextRunAt,
    bool? enabled,
    Map<String, dynamic>? config,
    DateTime? updatedAt,
  }) {
    return ScheduledJob(
      id: id,
      kind: kind,
      cadence: cadence ?? this.cadence,
      lastRunAt: lastRunAt ?? this.lastRunAt,
      nextRunAt: nextRunAt ?? this.nextRunAt,
      enabled: enabled ?? this.enabled,
      config: config ?? this.config,
      createdAt: createdAt,
      updatedAt: updatedAt ?? DateTime.now(),
    );
  }
}
