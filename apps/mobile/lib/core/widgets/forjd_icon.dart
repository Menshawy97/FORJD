import 'package:flutter/material.dart';
import 'package:path_drawing/path_drawing.dart';

import 'package:forjd/core/theme/app_colors.dart';
import 'package:forjd/core/theme/app_dimens.dart';
import 'package:forjd/core/widgets/forjd_icons.dart';

/// Renders one icon from [kForjdIconPaths] as a stroked outline.
///
/// The design's icons are thin strokes, which Material's filled icon font cannot express,
/// so the path data is stroked directly rather than swapped for a nearby Material glyph.
class ForjdIcon extends StatelessWidget {
  const ForjdIcon(this.name, {this.color, this.size, super.key});

  final String name;
  final Color? color;
  final double? size;

  /// Stroke width the design draws every icon at, in view-box units.
  static const strokeWidth = 1.7;

  @override
  Widget build(BuildContext context) {
    assert(
      kForjdIconPaths.containsKey(name),
      'Unknown FORJD icon "$name". An unknown name would otherwise render nothing at all, '
      'which is easy to miss in a dense layout.',
    );

    final resolved = size ?? AppDimens.iconSize;

    return SizedBox(
      width: resolved,
      height: resolved,
      child: CustomPaint(
        painter: _IconPainter(name: name, color: color ?? AppColors.dim),
      ),
    );
  }
}

class _IconPainter extends CustomPainter {
  const _IconPainter({required this.name, required this.color});

  final String name;
  final Color color;

  /// Parsing is pure and the set is small and fixed, so each icon is parsed once per
  /// process rather than on every repaint.
  static final Map<String, Path> _cache = {};

  static Path _pathFor(String name) => _cache.putIfAbsent(name, () {
    final path = Path();

    for (final data in kForjdIconPaths[name] ?? const <String>[]) {
      path.addPath(parseSvgPathData(data), Offset.zero);
    }

    return path;
  });

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.shortestSide / kForjdIconViewBox;

    canvas.save();
    // Stroke width is applied in view-box units inside the scaled canvas, so the outline
    // stays proportional to the glyph at every size rather than reading heavy when small.
    canvas.scale(scale);
    canvas.drawPath(
      _pathFor(name),
      Paint()
        ..style = PaintingStyle.stroke
        ..color = color
        ..strokeWidth = ForjdIcon.strokeWidth
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..isAntiAlias = true,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_IconPainter oldDelegate) =>
      oldDelegate.name != name || oldDelegate.color != color;
}
