import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:gratovo_toolbox/data/providers/entity_providers.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_aggregator.dart';
import 'package:gratovo_toolbox/features/finance/application/finance_models.dart';

/// The full payment ledger rollup. Built on [allDealsProvider], which
/// already watches `DataDomain.deals` and fetches the whole table — the
/// Finance page needs every deal regardless of stage (a `lost` deal that
/// somehow got invoiced is still a ledger row), so there's no narrower query
/// to reach for instead.
final financeStatsProvider = FutureProvider<FinanceStats>((ref) async {
  final deals = await ref.watch(allDealsProvider.future);
  return computeFinanceStats(deals);
});
