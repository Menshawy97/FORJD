import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:forjd/core/network/api_failure.dart';

DioException _response(int status, dynamic body) {
  final options = RequestOptions(path: '/auth/login');

  return DioException(
    requestOptions: options,
    type: DioExceptionType.badResponse,
    response: Response<dynamic>(
      requestOptions: options,
      statusCode: status,
      data: body,
    ),
  );
}

void main() {
  test('maps the API validation shape onto per-field messages', () {
    final failure = ApiFailure.from(
      _response(400, {
        'message': 'Validation failed',
        'errors': {
          'email': ['Invalid email'],
          'password': ['Password must be at least 8 characters'],
        },
      }),
    );

    expect(failure.message, 'Validation failed');
    expect(failure.forField('email'), 'Invalid email');
    expect(
      failure.forField('password'),
      'Password must be at least 8 characters',
    );
    expect(failure.forField('displayName'), isNull);
  });

  test('surfaces the server message on a 401', () {
    final failure = ApiFailure.from(
      _response(401, {'message': 'Invalid credentials'}),
    );

    expect(failure.message, 'Invalid credentials');
    expect(failure.statusCode, 401);
    expect(failure.fieldErrors, isEmpty);
  });

  test('explains a rate limit rather than showing a bare 429', () {
    final failure = ApiFailure.from(_response(429, {}));

    expect(failure.message, contains('Too many attempts'));
  });

  test('a connection error reads as offline, not as a server error', () {
    final failure = ApiFailure.from(
      DioException(
        requestOptions: RequestOptions(path: '/users/me'),
        type: DioExceptionType.connectionError,
      ),
    );

    expect(failure.message, contains("Can't reach FORJD"));
  });

  test('a non-JSON body never leaks the raw exception to the user', () {
    final failure = ApiFailure.from(
      _response(500, '<html>Gateway error</html>'),
    );

    expect(failure.message, 'Something went wrong. Please try again.');
    expect(failure.message, isNot(contains('DioException')));
  });
}
