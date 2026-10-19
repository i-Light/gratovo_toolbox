import 'package:gratovo_toolbox/data/models/brand.dart';

/// How the UI reads brand/client records. See influencer_repository.dart's
/// doc comment for the mock/Supabase swap pattern this follows.
abstract class BrandRepository {
  Future<List<Brand>> getAll();

  Future<Brand?> getById(String id);

  /// Saves a new brand. An empty [Brand.id] gets a fresh one; the saved
  /// brand, with its id, comes back.
  Future<Brand> create(Brand brand);

  /// Replaces a brand's details as one unit — the edit form saves them
  /// whole. Last write wins, as for the rest of the brand record.
  Future<void> update(Brand brand);

  Future<void> updateNotes(String id, String notes);
}
