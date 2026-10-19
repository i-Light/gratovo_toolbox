/// Positions *inside a video*, as `h:mm:ss` — not clock times.
///
/// Kept apart from `core/time/` on purpose: everything in there is about
/// instants on a timeline, in a timezone, formatted for a locale. A timecode
/// is none of those. It is an offset from the start of a recording, it has no
/// zone, and `1:05:30` means the same thing to every reader in every language,
/// so it is deliberately not localised.
///
/// Stored as whole seconds, which is as precise as anyone scrubbing a training
/// video is ever going to be.
library;

/// `3930` -> `1:05:30`. `330` -> `5:30`. `null` -> null.
///
/// The hour is dropped below an hour rather than written as `0:05:30`, because
/// that is how every video player in existence writes it and a timecode is
/// read at a glance or not at all.
String? formatTimecode(int? seconds) {
  if (seconds == null || seconds < 0) return null;
  final hours = seconds ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  final secs = seconds % 60;
  final twoDigitSecs = secs.toString().padLeft(2, '0');
  if (hours == 0) return '$minutes:$twoDigitSecs';
  return '$hours:${minutes.toString().padLeft(2, '0')}:$twoDigitSecs';
}

/// The inverse, forgiving about how it is typed.
///
/// Accepts `1:05:30`, `5:30`, `90` (bare seconds), and tolerates surrounding
/// whitespace. Returns null for anything else — including an empty string,
/// which is the normal "not recorded" case and not an error.
///
/// Deliberately does NOT normalise `5:90` to `6:30`: a field with 90 in the
/// seconds slot is a typo, and quietly accepting it means the number stored is
/// not the number that was read off the player.
int? parseTimecode(String? input) {
  final text = input?.trim();
  if (text == null || text.isEmpty) return null;

  final parts = text.split(':');
  if (parts.length > 3) return null;

  final values = <int>[];
  for (final part in parts) {
    final value = int.tryParse(part.trim());
    if (value == null || value < 0) return null;
    values.add(value);
  }

  switch (values.length) {
    case 1:
      return values[0];
    case 2:
      return values[1] > 59 ? null : values[0] * 60 + values[1];
    case 3:
      if (values[1] > 59 || values[2] > 59) return null;
      return values[0] * 3600 + values[1] * 60 + values[2];
  }
  return null;
}

/// The same video URL, pointing at [seconds] into it.
///
/// YouTube's `t=` parameter is the one link format that survives being pasted
/// anywhere, so "where in the training video did I find this" becomes a click
/// rather than a manual scrub. Any other host is returned untouched — a
/// timecode appended to a URL that does not understand it is worse than no
/// timecode, because it looks like it should work.
String? timecodedVideoUrl(String? url, int? seconds) {
  final trimmed = url?.trim();
  if (trimmed == null || trimmed.isEmpty) return null;
  if (seconds == null || seconds <= 0) return trimmed;

  final uri = Uri.tryParse(trimmed);
  if (uri == null) return trimmed;
  final host = uri.host.toLowerCase();
  final isYouTube = host.endsWith('youtube.com') ||
      host.endsWith('youtu.be') ||
      host.endsWith('youtube-nocookie.com');
  if (!isYouTube) return trimmed;

  return uri.replace(
    queryParameters: {...uri.queryParameters, 't': '${seconds}s'},
  ).toString();
}
