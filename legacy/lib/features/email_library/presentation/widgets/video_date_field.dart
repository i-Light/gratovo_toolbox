import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:gratovo_toolbox/core/time/calendar_date_format.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';

/// The video-date control: day, month and year as three spin boxes — the same
/// pointing task [TimecodeField] makes of its `h:mm:ss`.
///
/// A training video's publication day is copied off a page while looking at
/// something else, so the cost that matters is the same one the timecode field
/// is built around: the glance away to find a key, not the keystrokes. Three
/// segments with a wheel over each turns "set the date" into three flicks.
///
/// Unlike the timecode field this is a view onto a [DateTime?] rather than a
/// text controller — the record stores a real calendar date and there is no
/// string form in between. The widget splits the date into segments on the way
/// in and rebuilds it on every change, so the parent only ever sees a date.
class VideoDateField extends StatefulWidget {
  const VideoDateField({
    super.key,
    required this.value,
    required this.onChanged,
    this.firstDate,
    this.lastDate,
  });

  final DateTime? value;

  /// Optional stops for the wheel, inclusive and either one alone allowed.
  ///
  /// Without them a spin runs the segment ranges — every day of every month
  /// from 2024 to 2050 — which is right for the editor, where the date being
  /// typed is whatever the video says. Where the field is picking out of
  /// something that already exists (the copy dialog's range, bounded by the
  /// oldest and newest video date in the tab), a wheel that scrolls into years
  /// the library has nothing in reads as an empty result rather than as the
  /// end of the corpus.
  ///
  /// Enforced on the assembled date, not per segment, and only when the field
  /// settles: a spin, or a segment losing focus. A half-typed year has to be
  /// allowed to land before it is judged — the same rule the segment ranges
  /// are held to on the way out.
  final DateTime? firstDate;
  final DateTime? lastDate;

  /// Fired with the whole date whenever a segment changes, or null while the
  /// three boxes do not yet form one.
  final ValueChanged<DateTime?> onChanged;

  @override
  State<VideoDateField> createState() => _VideoDateFieldState();
}

/// Where the year segment starts on a record with nothing carried over from the
/// last one. A carried date overrides it (the parent passes that in as
/// [VideoDateField.value]); this is only the from-nothing default.
const int kVideoDateDefaultYear = 2026;

const int _day = 0;
const int _month = 1;
const int _year = 2;

/// Inclusive range per segment. Days stop at 31 and are pulled back to the
/// length of the chosen month when the date is assembled; years run in
/// two-digit form from 2024 to 2050, which covers every video this library is
/// realistically going to catalogue.
const List<int> _min = [1, 1, 24];
const List<int> _max = [31, 12, 50];

/// Home value a blank segment jumps to on its first spin — the 1st, January,
/// and 2026 (not the 2024 floor).
const List<int> _home = [1, 1, kVideoDateDefaultYear % 100];

class _VideoDateFieldState extends State<VideoDateField> {
  /// One per segment. The month box is not typed into, but keeping all three
  /// uniform keeps [_setBoxes] and disposal simple; its controller is really
  /// just a notifier holding the `4-April` label.
  final _controllers = List.generate(3, (_) => TextEditingController());
  final _focusNodes = List.generate(3, (_) => FocusNode());

  /// Cached so the month label can be rebuilt from callbacks without a context
  /// lookup, and so a locale switch at runtime can re-render it.
  String? _locale;

  @override
  void initState() {
    super.initState();
    for (final node in _focusNodes) {
      node.addListener(_onFocusChanged);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final locale = Localizations.localeOf(context).toString();
    final first = _locale == null;
    final changed = !first && _locale != locale;
    _locale = locale;
    if (first) {
      _readFromValue(widget.value);
    } else if (changed) {
      final month = _segment(_month);
      if (month != null) _controllers[_month].text = _monthText(month);
    }
  }

  @override
  void didUpdateWidget(VideoDateField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value) _readFromValue(widget.value);
  }

  @override
  void dispose() {
    for (final node in _focusNodes) {
      node.removeListener(_onFocusChanged);
      node.dispose();
    }
    for (final controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  String _monthText(int month) => formatMonthLabel(month, _locale ?? 'en');

  /// The number in one box, or null while it is blank. The month box holds a
  /// `4-April` label, so its leading digits are what count.
  int? _segment(int index) {
    final text = _controllers[index].text.trim();
    if (text.isEmpty) return null;
    if (index == _month) {
      final match = RegExp(r'^\d+').firstMatch(text);
      return match == null ? null : int.parse(match.group(0)!);
    }
    return int.tryParse(text);
  }

  /// The date the three boxes currently spell, or null if any is still blank.
  DateTime? _assembleDate() {
    final day = _segment(_day);
    final month = _segment(_month);
    final year = _segment(_year);
    if (day == null || month == null || year == null) return null;
    final fullYear = 2000 + year;
    // February never has 31 days: a day that outruns the chosen month is
    // pulled back to that month's last, not rolled silently into the next.
    final lastDay = DateTime(fullYear, month + 1, 0).day;
    return DateTime(fullYear, month, day > lastDay ? lastDay : day);
  }

  /// Splits an incoming date into the boxes, or blanks them for null.
  ///
  /// Runs on the outside-in changes the editor makes: the dialog opening on a
  /// row, and "save and add another" carrying the previous date forward. A
  /// half-typed date the user is still working on is left alone — see the
  /// guard.
  void _readFromValue(DateTime? date) {
    final current = _assembleDate();
    if (_sameDay(date, current)) return;
    if (date == null) {
      // The parent echoes back whatever we hand it, and we hand it null while
      // the boxes are incomplete — that must not wipe digits mid-edit. Only a
      // whole date being dropped from the outside blanks the field.
      if (current != null) _setBoxes(const ['', '', '']);
      return;
    }
    _setBoxes([
      _pad(date.day),
      _monthText(date.month),
      _pad(date.year % 100),
    ]);
  }

  void _setBoxes(List<String> next) {
    for (var i = 0; i < 3; i++) {
      if (_controllers[i].text != next[i]) _controllers[i].text = next[i];
    }
  }

  /// [date] pulled inside [VideoDateField.firstDate] and
  /// [VideoDateField.lastDate], or returned as it came when it is already
  /// between them.
  ///
  /// Lands on the bound itself rather than refusing the change: a wheel that
  /// stops dead one notch short of the newest video date is a wheel that looks
  /// broken, and the boundary date is the one the user was reaching for.
  DateTime _withinBounds(DateTime date) {
    final first = _dayOnly(widget.firstDate);
    final last = _dayOnly(widget.lastDate);
    if (first != null && date.isBefore(first)) return first;
    if (last != null && date.isAfter(last)) return last;
    return date;
  }

  /// Composes the boxes into a date and pushes it up, snapping the day box
  /// down first when the chosen month is too short for it.
  ///
  /// [settled] marks the changes the field is done with — a spin, a segment
  /// losing focus — which are the only ones the bounds are applied to. Every
  /// keystroke would rewrite a year mid-typing.
  void _writeBack({bool settled = false}) {
    var date = _assembleDate();
    if (date != null && settled) {
      final bounded = _withinBounds(date);
      if (bounded != date) {
        date = bounded;
        _setBoxes([
          _pad(date.day),
          _monthText(date.month),
          _pad(date.year % 100),
        ]);
      }
    }
    if (date != null && _controllers[_day].text != _pad(date.day)) {
      _controllers[_day].text = _pad(date.day);
    }
    widget.onChanged(date);
  }

  void _onSegmentChanged(int index, String value) => _writeBack();

  /// A segment left mid-typed ("3" in the day box) is padded and clamped into
  /// range on the way out, so the field never rests on a shape it would not
  /// accept.
  void _onFocusChanged() {
    for (var i = 0; i < 3; i++) {
      if (i == _month || _focusNodes[i].hasFocus) continue;
      final text = _controllers[i].text.trim();
      if (text.isEmpty) continue;
      final value = int.tryParse(text) ?? _min[i];
      final fixed = _pad(value.clamp(_min[i], _max[i]));
      if (_controllers[i].text != fixed) _controllers[i].text = fixed;
    }
    // Unconditionally, not only when a segment was rewritten: this is where a
    // typed date is judged against the bounds, and typing one inside the
    // segment ranges but outside them leaves nothing for the loop above to fix.
    _writeBack(settled: true);
  }

  /// Moves one segment by [delta] notches, wrapping at both ends — and then,
  /// where the field has bounds, no further than those.
  void _bump(int index, int delta) {
    if (_controllers[index].text.trim().isEmpty) {
      // First spin of an untouched segment lands on its home value rather than
      // one notch off it.
      _controllers[index].text = _segText(index, _home[index]);
    } else {
      final span = _max[index] - _min[index] + 1;
      final raw = _segment(index)! - _min[index] + delta;
      _controllers[index].text =
          _segText(index, (raw % span + span) % span + _min[index]);
    }
    // Spinning one box of an otherwise blank field means a date is being
    // entered, so the other two stop being blank and take their home values —
    // a half date is never stored.
    for (var i = 0; i < 3; i++) {
      if (_controllers[i].text.trim().isEmpty) {
        _controllers[i].text = _segText(i, _home[i]);
      }
    }
    _writeBack(settled: true);
  }

  String _segText(int index, int value) =>
      index == _month ? _monthText(value) : _pad(value);

  static String _pad(int value) => value.toString().padLeft(2, '0');

  static DateTime? _dayOnly(DateTime? date) =>
      date == null ? null : DateTime(date.year, date.month, date.day);

  static bool _sameDay(DateTime? a, DateTime? b) {
    if (a == null || b == null) return a == b;
    return a.year == b.year && a.month == b.month && a.day == b.day;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Tooltip(
      message: l10n.emailLibraryTimecodeScrollHint,
      waitDuration: const Duration(milliseconds: 700),
      child: Row(
        children: [
          SizedBox(
            width: 46,
            child: _NumberSegment(
              key: const ValueKey('videoDate.day'),
              controller: _controllers[_day],
              focusNode: _focusNodes[_day],
              max: _max[_day],
              semanticsLabel: l10n.emailLibraryVideoDateDay,
              onChanged: (value) => _onSegmentChanged(_day, value),
              onBump: (delta) => _bump(_day, delta),
            ),
          ),
          const _DateSlash(),
          Expanded(
            child: _MonthSegment(
              key: const ValueKey('videoDate.month'),
              controller: _controllers[_month],
              focusNode: _focusNodes[_month],
              semanticsLabel: l10n.emailLibraryVideoDateMonth,
              onBump: (delta) => _bump(_month, delta),
            ),
          ),
          const _DateSlash(),
          SizedBox(
            width: 46,
            child: _NumberSegment(
              key: const ValueKey('videoDate.year'),
              controller: _controllers[_year],
              focusNode: _focusNodes[_year],
              max: _max[_year],
              semanticsLabel: l10n.emailLibraryVideoDateYear,
              onChanged: (value) => _onSegmentChanged(_year, value),
              onBump: (delta) => _bump(_year, delta),
            ),
          ),
        ],
      ),
    );
  }
}

class _DateSlash extends StatelessWidget {
  const _DateSlash();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Text(
        '/',
        style: theme.textTheme.titleMedium
            ?.copyWith(color: theme.colorScheme.outline),
      ),
    );
  }
}

/// One number box: typed like a text field, spun like a wheel. Day and year.
class _NumberSegment extends StatelessWidget {
  const _NumberSegment({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.max,
    required this.semanticsLabel,
    required this.onChanged,
    required this.onBump,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final int max;
  final String semanticsLabel;
  final ValueChanged<String> onChanged;
  final ValueChanged<int> onBump;

  /// Claims the wheel event for this box so a spin does not also scroll the
  /// form out from under the pointer — see [TimecodeField]'s segment for the
  /// same move and why the resolver is the right tool.
  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    final dy = event.scrollDelta.dy;
    if (dy == 0) return;
    GestureBinding.instance.pointerSignalResolver.register(
      event,
      (_) => onBump(dy < 0 ? 1 : -1),
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      onBump(1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      onBump(-1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerSignal: _onPointerSignal,
      child: Focus(
        onKeyEvent: _onKey,
        canRequestFocus: false,
        skipTraversal: true,
        child: Semantics(
          label: semanticsLabel,
          child: TextField(
            controller: controller,
            focusNode: focusNode,
            textAlign: TextAlign.center,
            keyboardType: TextInputType.number,
            inputFormatters: [_MaxValueFormatter(max)],
            onChanged: onChanged,
            onTap: () => controller.selection = TextSelection(
              baseOffset: 0,
              extentOffset: controller.text.length,
            ),
            decoration: const InputDecoration(
              isDense: true,
              hintText: '00',
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 12),
            ),
          ),
        ),
      ),
    );
  }
}

/// The month box: shows `4-April`, spun with the wheel or the arrow keys.
///
/// Not a text field — a month is picked, not typed, and `4-April` is not
/// something anyone keys in. It still takes focus so the arrow keys reach it,
/// and a tap moves focus there so a following key press lands.
class _MonthSegment extends StatelessWidget {
  const _MonthSegment({
    super.key,
    required this.controller,
    required this.focusNode,
    required this.semanticsLabel,
    required this.onBump,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final String semanticsLabel;
  final ValueChanged<int> onBump;

  void _onPointerSignal(PointerSignalEvent event) {
    if (event is! PointerScrollEvent) return;
    final dy = event.scrollDelta.dy;
    if (dy == 0) return;
    GestureBinding.instance.pointerSignalResolver.register(
      event,
      (_) => onBump(dy < 0 ? 1 : -1),
    );
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) {
      return KeyEventResult.ignored;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      onBump(1);
      return KeyEventResult.handled;
    }
    if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      onBump(-1);
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Listener(
      onPointerSignal: _onPointerSignal,
      child: Focus(
        focusNode: focusNode,
        onKeyEvent: _onKey,
        child: ListenableBuilder(
          listenable: Listenable.merge([focusNode, controller]),
          builder: (context, _) {
            final focused = focusNode.hasFocus;
            final text = controller.text;
            return GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: focusNode.requestFocus,
              child: Container(
                height: 48,
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(4),
                  border: Border.all(
                    color: focused
                        ? theme.colorScheme.primary
                        : theme.colorScheme.outline,
                    width: focused ? 2 : 1,
                  ),
                ),
                child: Semantics(
                  label: semanticsLabel,
                  child: Text(
                    text.isEmpty ? '—' : text,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

/// Keeps a number segment to at most two digits and at or below its limit.
///
/// Rejecting the keystroke rather than clamping the result is the difference
/// between "45 is not a day" and a field that silently rewrites what was
/// typed. Values below the segment's floor are left for the focus-out pass to
/// fix, since a "2" on the way to "24" has to be allowed to land.
class _MaxValueFormatter extends TextInputFormatter {
  const _MaxValueFormatter(this.max);

  final int max;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final text = newValue.text;
    if (text.isEmpty) return newValue;
    if (text.length > 2) return oldValue;
    if (!RegExp(r'^\d+$').hasMatch(text)) return oldValue;
    return int.parse(text) > max ? oldValue : newValue;
  }
}
