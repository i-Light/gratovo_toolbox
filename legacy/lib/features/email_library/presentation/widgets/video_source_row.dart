import 'package:flutter/material.dart';
import 'package:gratovo_toolbox/core/toast/app_toast.dart';
import 'package:gratovo_toolbox/core/utils/timecode.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/email_form_fields.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/timecode_field.dart';
import 'package:gratovo_toolbox/features/email_library/presentation/widgets/video_date_field.dart';
import 'package:gratovo_toolbox/l10n/gen/app_localizations.dart';
import 'package:url_launcher/url_launcher.dart';

/// Where this email came from: the training video's date, its URL, and the
/// point inside it.
///
/// Grouped into one widget because they are one thought — provenance — and
/// because all three carry over to the next record together. Splitting them
/// across the form would leave the editor with three separate places that all
/// mean "which video".
///
/// All three arrive pre-filled from the previous record (see
/// `EmailDraftDefaults`). The timecode is the one that is then always edited
/// rather than kept: the next email is a little further into the same video,
/// so the previous position is where the spinning starts, not the answer.
class VideoSourceRow extends StatelessWidget {
  const VideoSourceRow({
    super.key,
    required this.date,
    required this.onDateChanged,
    required this.urlController,
    required this.timecodeController,
    this.timecodeIsValid = true,
  });

  final DateTime? date;
  final ValueChanged<DateTime?> onDateChanged;
  final TextEditingController urlController;
  final TextEditingController timecodeController;

  /// False while the typed timecode cannot be parsed — the field says so
  /// rather than silently storing null, which would look like it saved.
  final bool timecodeIsValid;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        // Stacks below roughly a tablet's width. The three controls have very
        // different natural widths and squeezing a URL field into a third of a
        // phone screen makes it unusable.
        final stacked = constraints.maxWidth < 560;

        final dateField = _Field(
          label: l10n.emailLibraryFieldVideoDate,
          child: VideoDateField(value: date, onChanged: onDateChanged),
        );

        final urlField = _Field(
          label: l10n.emailLibraryFieldVideoUrl,
          child: TextField(
            controller: urlController,
            keyboardType: TextInputType.url,
            decoration: InputDecoration(
              isDense: true,
              hintText: l10n.emailLibraryVideoUrlHint,
              border: const OutlineInputBorder(),
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
            ),
          ),
        );

        final timecodeField = _Field(
          label: l10n.emailLibraryFieldTimecode,
          trailing: _OpenAtTimecodeButton(
            url: urlController.text,
            timecode: timecodeController.text,
          ),
          child: TimecodeField(
            controller: timecodeController,
            isValid: timecodeIsValid,
          ),
        );

        if (stacked) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              dateField,
              const SizedBox(height: 12),
              urlField,
              const SizedBox(height: 12),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: SizedBox(width: 184, child: timecodeField),
              ),
            ],
          );
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Wider than the other two: the month box carries a spelled-out
            // name ("9-September"), not just digits.
            SizedBox(width: 232, child: dateField),
            const SizedBox(width: 12),
            Expanded(child: urlField),
            const SizedBox(width: 12),
            SizedBox(width: 184, child: timecodeField),
          ],
        );
      },
    );
  }
}

/// A labelled control, in the column shape the whole editor uses.
class _Field extends StatelessWidget {
  const _Field({required this.label, required this.child, this.trailing});

  final String label;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FieldLabel(label, trailing: trailing),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

/// Opens the video at the recorded moment — the payoff for typing a timecode
/// at all.
///
/// Rebuilt from the two controllers' live text rather than the saved record,
/// so it works while the record is still being typed. Disabled (rather than
/// hidden) when the URL is blank or the timecode does not parse: a control
/// that appears and disappears as you type is harder to aim at than one that
/// greys out.
class _OpenAtTimecodeButton extends StatelessWidget {
  const _OpenAtTimecodeButton({required this.url, required this.timecode});

  final String url;
  final String timecode;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final seconds = parseTimecode(timecode);
    final target = timecodedVideoUrl(url, seconds);
    final enabled =
        target != null && (Uri.tryParse(target)?.hasScheme ?? false);

    return IconButton(
      onPressed: enabled ? () => _open(context, target) : null,
      tooltip: l10n.emailLibraryOpenAtTimecode,
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints.tightFor(width: 24, height: 24),
      padding: EdgeInsets.zero,
      iconSize: 16,
      icon: const Icon(Icons.open_in_new),
    );
  }

  Future<void> _open(BuildContext context, String target) async {
    final l10n = AppLocalizations.of(context);
    final uri = Uri.parse(target);
    // Guarded like every other launch in this app: a URL that came from a
    // text field is not one to hand to the OS unchecked, and a refusal must
    // say so rather than doing nothing.
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched) {
      if (!context.mounted) return;
      AppToast.error(context, l10n.emailLibraryOpenFailed);
    }
  }
}
