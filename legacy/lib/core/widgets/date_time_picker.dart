import 'package:flutter/material.dart';

/// Asks for a date and then a time, returning the two combined as a *local
/// wall-clock* [DateTime] — the caller is responsible for `.toUtc()` before
/// storing or transporting it.
///
/// The first date/time picker in the app. Deliberately the plain Material
/// pair rather than a bespoke widget: they already localise (including RTL
/// Arabic) through the `GlobalMaterialLocalizations` delegates the app
/// registers, and "pick a day, pick a time" is exactly the interaction a
/// follow-up reminder needs.
///
/// Returns null if the user backs out of either step.
Future<DateTime?> pickDateTime(
  BuildContext context, {
  DateTime? initial,
}) async {
  final base = initial ?? DateTime.now();

  final date = await showDatePicker(
    context: context,
    initialDate: base,
    firstDate: DateTime(base.year - 1),
    lastDate: DateTime(base.year + 3),
  );
  if (date == null) return null;
  if (!context.mounted) return null;

  final time = await showTimePicker(
    context: context,
    initialTime: TimeOfDay.fromDateTime(base),
  );
  if (time == null) return null;

  return DateTime(date.year, date.month, date.day, time.hour, time.minute);
}
