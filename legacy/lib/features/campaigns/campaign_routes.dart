/// Path helper for the campaign detail route, kept next to this feature
/// rather than in `routing/app_routes.dart` — that file is a hotspot this
/// wave doesn't edit directly. Mirrors [AppRoutes]'s own naming
/// (`AppRoutes.dealDetail`, `AppRoutes.brandDetail`) so it can be folded
/// straight into that file once its owner applies this wave's routing
/// snippet (see the handoff notes): a nested route under `/brands/:id`,
/// the same shape `/deals/:id` nests under `/deals`.
String campaignDetailPath(String brandId, String campaignId) =>
    '/brands/$brandId/campaigns/$campaignId';
