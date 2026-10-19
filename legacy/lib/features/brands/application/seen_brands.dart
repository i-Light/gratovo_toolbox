import 'package:gratovo_toolbox/data/models/sponsor_sighting.dart';

/// A brand seen sponsoring one or more creators (fix #6).
class SeenBrand {
  const SeenBrand({
    required this.name,
    required this.channelIds,
    required this.handles,
    this.latestUploadAt,
  });

  /// The spelling most channels used.
  final String name;
  final List<String> channelIds;
  final List<String> handles;

  /// The latest upload among those channels — when the brand was last
  /// possibly on screen there, as close as stored data gets.
  final DateTime? latestUploadAt;
}

/// The brands in [sightings], one entry each, most channels first.
///
/// The pipeline's extraction also catches the code after "use code …", which
/// is as often the creator's own name or a made-up code as a brand. So a
/// one-word ALL-CAPS entry with a digit in it, or of five letters or more, is
/// taken for a code ("JR5", "PRESTON10", "HOUSEOFEL") — short ones like "LG"
/// stay — and a name equal to the creator's own handle or name is dropped.
/// Spellings that differ only in case or punctuation are one brand.
List<SeenBrand> aggregateSeenBrands(List<SponsorSighting> sightings) {
  final spellings = <String, Map<String, int>>{};
  final channels = <String, List<SponsorSighting>>{};
  for (final sighting in sightings) {
    final own = {_key(sighting.handle), _key(sighting.name ?? '')}..remove('');
    final seenHere = <String>{};
    for (final raw in sighting.brands) {
      final name = raw.trim();
      final key = _key(name);
      if (key.isEmpty || own.contains(key) || _looksLikeCode(name)) continue;
      if (!seenHere.add(key)) continue;
      (spellings[key] ??= {})[name] = (spellings[key]![name] ?? 0) + 1;
      (channels[key] ??= []).add(sighting);
    }
  }
  final result = [
    for (final MapEntry(:key, value: seenIn) in channels.entries)
      SeenBrand(
        name: (spellings[key]!.entries.toList()
              ..sort((a, b) => b.value != a.value
                  ? b.value.compareTo(a.value)
                  : a.key.compareTo(b.key)))
            .first
            .key,
        channelIds: [for (final s in seenIn) s.channelId],
        handles: [for (final s in seenIn) s.handle],
        latestUploadAt: seenIn
            .map((s) => s.latestUploadAt)
            .whereType<DateTime>()
            .fold<DateTime?>(
                null,
                (latest, at) =>
                    latest == null || at.isAfter(latest) ? at : latest),
      ),
  ];
  result.sort((a, b) => a.channelIds.length != b.channelIds.length
      ? b.channelIds.length.compareTo(a.channelIds.length)
      : a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return result;
}

String _key(String text) =>
    text.toLowerCase().replaceAll(RegExp('[^a-z0-9]'), '');

bool _looksLikeCode(String name) {
  if (name.contains(' ')) return false;
  if (name != name.toUpperCase()) return false;
  return RegExp('[0-9]').hasMatch(name) || name.length >= 5;
}
