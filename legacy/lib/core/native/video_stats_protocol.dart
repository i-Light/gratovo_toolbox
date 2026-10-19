import 'dart:convert';

import 'package:gratovo_toolbox/core/native/gmail_protocol.dart';

/// Why `tools/video_stats.py` gave no number: its own code (`not_a_video`,
/// `not_found`, `no_key`, `youtube_error`) or `unavailable` when the tool
/// could not be run or printed no answer.
class VideoStatsError {
  const VideoStatsError({required this.code, required this.message});

  final String code;
  final String message;
}

/// One answer from `tools/video_stats.py`: the video's views when it was
/// asked, or why there are none.
class VideoStatsResult {
  const VideoStatsResult({
    this.videoId,
    this.views,
    this.fetchedAt,
    this.error,
  });

  const VideoStatsResult.failure(VideoStatsError this.error)
      : videoId = null,
        views = null,
        fetchedAt = null;

  final String? videoId;
  final int? views;
  final DateTime? fetchedAt;
  final VideoStatsError? error;
}

/// Reads the tool's output: its last JSON line, as every pipeline tool's.
VideoStatsResult parseVideoStats(String output) {
  final json = decodeToolOutput(output);
  if (json == null) {
    return VideoStatsResult.failure(
      VideoStatsError(code: 'unavailable', message: _lastLine(output)),
    );
  }
  if (json['ok'] != true) {
    final error = json['error'];
    return VideoStatsResult.failure(VideoStatsError(
      code: error is Map ? '${error['code'] ?? 'unavailable'}' : 'unavailable',
      message: error is Map ? '${error['message'] ?? ''}' : _lastLine(output),
    ));
  }
  final views = json['views'];
  final fetchedAt = json['fetchedAt'];
  return VideoStatsResult(
    videoId: json['videoId'] as String?,
    views: views is num ? views.toInt() : null,
    fetchedAt: fetchedAt is String ? DateTime.tryParse(fetchedAt) : null,
  );
}

String _lastLine(String output) {
  for (final line in const LineSplitter().convert(output).reversed) {
    if (line.trim().isNotEmpty) return line.trim();
  }
  return '';
}
