import 'package:dio/dio.dart';

/// A network or API error in a shape the UI can render.
///
/// Everything that leaves the data layer goes through here, so no screen ever has to
/// interpret a [DioException] and none can leak `DioException [bad response]: ...` into a
/// user's face.
class ApiFailure implements Exception {
  const ApiFailure(
    this.message, {
    this.fieldErrors = const {},
    this.statusCode,
  });

  /// Safe to show a person as-is.
  final String message;

  /// Field name to its messages, from the API's Zod validation shape. Empty unless the
  /// server rejected specific fields, which is what lets a form put the message under the
  /// input that caused it.
  final Map<String, List<String>> fieldErrors;

  final int? statusCode;

  static const _offline =
      "Can't reach FORJD. Check your connection and try again.";
  static const _unexpected = 'Something went wrong. Please try again.';

  factory ApiFailure.from(DioException error) {
    switch (error.type) {
      case DioExceptionType.connectionError:
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiFailure(_offline);
      case DioExceptionType.cancel:
      case DioExceptionType.badCertificate:
      case DioExceptionType.transformTimeout:
      case DioExceptionType.unknown:
        return const ApiFailure(_unexpected);
      case DioExceptionType.badResponse:
        break;
    }

    final status = error.response?.statusCode;
    final body = error.response?.data;

    if (body is! Map) {
      return ApiFailure(_defaultFor(status), statusCode: status);
    }

    return ApiFailure(
      _messageFrom(body) ?? _defaultFor(status),
      fieldErrors: _fieldErrorsFrom(body['errors']),
      statusCode: status,
    );
  }

  /// Nest sends `message` as either a string or, for some built-in pipes, a list of them.
  static String? _messageFrom(Map<dynamic, dynamic> body) {
    final message = body['message'];

    if (message is String && message.isNotEmpty) {
      return message;
    }

    if (message is List && message.isNotEmpty) {
      return message.first.toString();
    }

    return null;
  }

  static String _defaultFor(int? status) => switch (status) {
    401 => 'Invalid credentials.',
    429 => 'Too many attempts. Wait a minute and try again.',
    _ => _unexpected,
  };

  static Map<String, List<String>> _fieldErrorsFrom(Object? errors) {
    if (errors is! Map) {
      return const {};
    }

    return {
      for (final entry in errors.entries)
        if (entry.value is List && (entry.value as List).isNotEmpty)
          entry.key.toString(): [
            for (final message in entry.value as List) message.toString(),
          ],
    };
  }

  /// The first message for [field], or null — what a form field's `errorText` wants.
  String? forField(String field) => fieldErrors[field]?.firstOrNull;

  @override
  String toString() => 'ApiFailure($statusCode): $message';
}
