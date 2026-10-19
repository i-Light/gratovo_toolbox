/// One channel and the sponsors the pipeline saw in its stored videos
/// (`channels.seen_brands`). What "Brands seen sponsoring" is built from.
class SponsorSighting {
  const SponsorSighting({
    required this.channelId,
    required this.handle,
    required this.brands,
    this.name,
    this.latestUploadAt,
  });

  final String channelId;
  final String handle;
  final String? name;
  final DateTime? latestUploadAt;
  final List<String> brands;
}
