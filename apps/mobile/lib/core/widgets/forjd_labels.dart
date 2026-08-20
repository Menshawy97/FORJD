import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_typography.dart';

/// The small uppercase label above a form field.
///
/// Uppercasing happens here rather than at the call site so the strings stay readable in
/// source and, more importantly, so screen readers announce words rather than letters.
class ForjdFieldLabel extends StatelessWidget {
  const ForjdFieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    label: text,
    excludeSemantics: true,
    child: Text(text.toUpperCase(), style: AppText.label),
  );
}

/// The same treatment used to head a group of rows in a settings list.
class ForjdSectionLabel extends StatelessWidget {
  const ForjdSectionLabel(this.text, {this.padding, super.key});

  final String text;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) => Padding(
    padding: padding ?? const EdgeInsets.fromLTRB(0, 24, 0, 2),
    child: ForjdFieldLabel(text),
  );
}

/// A form-level error message, as on the design's signup screen.
///
/// Rendered as a live region so a screen reader announces the failure instead of leaving
/// it visible only to sighted users.
class ForjdInlineError extends StatelessWidget {
  const ForjdInlineError(this.message, {super.key});

  /// Null renders nothing and takes no vertical space.
  final String? message;

  @override
  Widget build(BuildContext context) {
    final message = this.message;

    return AnimatedSize(
      duration: const Duration(milliseconds: 150),
      alignment: Alignment.topLeft,
      child: message == null
          ? const SizedBox(width: double.infinity)
          : Padding(
              padding: const EdgeInsets.only(top: 10),
              child: Semantics(
                liveRegion: true,
                child: Text(message, style: AppText.inlineError),
              ),
            ),
    );
  }
}
