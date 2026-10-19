import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/core/events/data_change_bus.dart';
import 'package:gratovo_toolbox/data/models/campaign.dart';
import 'package:gratovo_toolbox/data/repositories/repository_providers.dart';

/// Every edit the campaign detail screen can make to one [Campaign]: name,
/// status, notes, the two optional dates, and delete.
///
/// Every mutation reconstructs the [Campaign] explicitly rather than going
/// through [Campaign.copyWith] — `copyWith`'s "null means keep the current
/// value" convention can't express *clearing* a nullable field (notes, or
/// either date once set), and this screen needs to do both. Same reasoning
/// as `DealDeliverablesController._rebuild`.
class CampaignDetailController {
  CampaignDetailController(this._ref);

  final Ref _ref;

  Future<void> updateName(Campaign current, String name) =>
      _write(_rebuild(current, name: name));

  Future<void> updateStatus(Campaign current, CampaignStatus status) =>
      _write(_rebuild(current, status: status));

  /// [notes] empty or null clears the field.
  Future<void> updateNotes(Campaign current, String? notes) => _write(
        _rebuild(
          current,
          notes: () => (notes == null || notes.isEmpty) ? null : notes,
        ),
      );

  Future<void> setStartDate(Campaign current, DateTime? value) =>
      _write(_rebuild(current, startDate: () => value));

  Future<void> setLiveDate(Campaign current, DateTime? value) =>
      _write(_rebuild(current, liveDate: () => value));

  Future<void> delete(String id) async {
    await _ref.read(campaignRepositoryProvider).delete(id);
    _ref.bumpData(const {DataDomain.campaigns});
  }

  Future<void> _write(Campaign next) async {
    await _ref.read(campaignRepositoryProvider).update(next);
    _ref.bumpData(const {DataDomain.campaigns});
  }

  static Campaign _rebuild(
    Campaign current, {
    String? name,
    CampaignStatus? status,
    String? Function()? notes,
    DateTime? Function()? startDate,
    DateTime? Function()? liveDate,
  }) {
    return Campaign(
      id: current.id,
      brandId: current.brandId,
      name: name ?? current.name,
      notes: notes != null ? notes() : current.notes,
      status: status ?? current.status,
      startDate: startDate != null ? startDate() : current.startDate,
      liveDate: liveDate != null ? liveDate() : current.liveDate,
      createdAt: current.createdAt,
      updatedAt: DateTime.now(),
    );
  }
}

final campaignDetailControllerProvider =
    Provider<CampaignDetailController>((ref) {
  return CampaignDetailController(ref);
});
