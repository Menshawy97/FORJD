import 'package:flutter/material.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/theme/app_typography.dart';
import 'package:forjd/core/widgets/forjd_labels.dart';

/// A labelled text field in the design's style.
///
/// The box itself comes from the app's [InputDecorationTheme], so this widget only adds
/// what the theme cannot express: the label above the field, the password reveal toggle,
/// and the error message beneath.
class ForjdTextField extends StatefulWidget {
  const ForjdTextField({
    required this.label,
    required this.controller,
    this.hintText,
    this.obscure = false,
    this.errorText,
    this.keyboardType,
    this.textInputAction,
    this.onSubmitted,
    this.prefixText,
    this.enabled = true,
    this.autofillHints,
    super.key,
  });

  final String label;
  final TextEditingController controller;
  final String? hintText;

  /// Starts obscured and shows the reveal toggle.
  final bool obscure;
  final String? errorText;
  final TextInputType? keyboardType;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  /// Rendered inside the field, before the value — the `@` on a handle, for example.
  final String? prefixText;
  final bool enabled;
  final Iterable<String>? autofillHints;

  @override
  State<ForjdTextField> createState() => _ForjdTextFieldState();
}

class _ForjdTextFieldState extends State<ForjdTextField> {
  late bool _obscured = widget.obscure;

  static final _errorBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppDimens.fieldRadius),
    borderSide: const BorderSide(color: AppColors.errorBorder),
  );

  @override
  Widget build(BuildContext context) {
    final hasError = widget.errorText != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ForjdFieldLabel(widget.label),
        const SizedBox(height: 7),
        SizedBox(
          height: AppDimens.controlHeight,
          child: TextField(
            controller: widget.controller,
            obscureText: _obscured,
            enabled: widget.enabled,
            keyboardType: widget.keyboardType,
            textInputAction: widget.textInputAction,
            onSubmitted: widget.onSubmitted,
            autofillHints: widget.autofillHints,
            style: AppText.input,
            cursorColor: AppColors.accent,
            decoration: InputDecoration(
              hintText: widget.hintText,
              prefixText: widget.prefixText,
              prefixStyle: AppText.input.copyWith(color: AppColors.dimmer),
              // The message renders below, outside this fixed-height box. Passing errorText
              // to the field as well would make it grow and break the 52pt rhythm that
              // makes stacked forms line up.
              enabledBorder: hasError ? _errorBorder : null,
              focusedBorder: hasError ? _errorBorder : null,
              // The design's icon set has no eye glyph, so the one Material shape in the
              // app is here. It is a control affordance rather than brand iconography.
              suffixIcon: widget.obscure
                  ? IconButton(
                      onPressed: () => setState(() => _obscured = !_obscured),
                      iconSize: 19,
                      color: AppColors.dim,
                      tooltip: _obscured ? 'Show password' : 'Hide password',
                      icon: Icon(
                        _obscured
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined,
                      ),
                    )
                  : null,
            ),
          ),
        ),
        ForjdInlineError(widget.errorText),
      ],
    );
  }
}
