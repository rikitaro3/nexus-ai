import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path/path.dart' as p;
import 'package:test/test.dart' show TestFailure;

/// Custom integration test binding that captures screenshots when a test fails.
class ScreenshotIntegrationTestBinding
    extends IntegrationTestWidgetsFlutterBinding {
  ScreenshotIntegrationTestBinding._() : super();

  static ScreenshotIntegrationTestBinding? _instance;

  static const String _failureScreenshotDirectory = 'test-results/failures';

  /// Ensures that the [ScreenshotIntegrationTestBinding] is initialized.
  static ScreenshotIntegrationTestBinding ensureInitialized() {
    final currentBinding = IntegrationTestWidgetsFlutterBinding.instance;

    if (currentBinding is ScreenshotIntegrationTestBinding) {
      return currentBinding;
    }

    _instance ??= ScreenshotIntegrationTestBinding._();
    return _instance!;
  }

  /// Captures a screenshot with the given [description] and saves it to disk.
  ///
  /// When screenshots are not supported on the current platform, this method
  /// will log the reason and exit gracefully without throwing.
  Future<void> captureFailureScreenshot(
    String description, {
    Object? error,
    StackTrace? stackTrace,
  }) async {
    try {
      if (!Platform.isAndroid && !Platform.isIOS) {
        debugPrint(
          'Skipping failure screenshot capture (unsupported platform: '
          '${Platform.operatingSystem}).',
        );
        return;
      }

      await convertFlutterSurfaceToImage();

      final sanitizedDescription = _sanitizeDescription(description);
      final timestamp = DateTime.now().toUtc().toIso8601String().replaceAll(
        ':',
        '-',
      );
      final screenshotName = '${timestamp}_$sanitizedDescription';

      final bytes = await takeScreenshot(screenshotName);
      if (bytes.isEmpty) {
        return;
      }

      final directory = Directory(_failureScreenshotDirectory);
      if (!await directory.exists()) {
        await directory.create(recursive: true);
      }

      final filePath = p.join(directory.path, '$screenshotName.png');
      final file = File(filePath);
      await file.writeAsBytes(bytes, flush: true);
      final contextMessage = _buildContextMessage(error, stackTrace);
      debugPrint('📸 Failure screenshot saved: $filePath$contextMessage');
    } catch (error, stackTrace) {
      debugPrint('Failed to capture failure screenshot: $error');
      debugPrint('$stackTrace');
    }
  }

  @override
  void reportException(String testDescription, FlutterErrorDetails details) {
    unawaited(
      captureFailureScreenshot(
        testDescription,
        error: details.exception,
        stackTrace: details.stack,
      ),
    );
    super.reportException(testDescription, details);
  }

  @override
  void reportTestException(
    String testDescription,
    FlutterErrorDetails details,
  ) {
    unawaited(
      captureFailureScreenshot(
        testDescription,
        error: details.exception,
        stackTrace: details.stack,
      ),
    );
    super.reportTestException(testDescription, details);
  }

  @override
  void handleUncaughtAsyncError(Object error, StackTrace stackTrace) {
    unawaited(
      captureFailureScreenshot(
        'uncaught_async_error',
        error: error,
        stackTrace: stackTrace,
      ),
    );
    super.handleUncaughtAsyncError(error, stackTrace);
  }

  static String _buildContextMessage(Object? error, StackTrace? stackTrace) {
    if (error == null && stackTrace == null) {
      return '';
    }

    final buffer = StringBuffer(' | context:');
    if (error != null) {
      buffer.write(' error=$error');
    }
    if (stackTrace != null) {
      buffer.write(' stack=${stackTrace.toString().split('\n').first}');
    }
    return buffer.toString();
  }

  static String _sanitizeDescription(String description) {
    final sanitized = description
        .toLowerCase()
        .replaceAll(RegExp('[^a-z0-9]+'), '_')
        .replaceAll(RegExp('_+'), '_')
        .replaceAll(RegExp(r'^_|_$'), '');

    if (sanitized.isEmpty) {
      return 'test_failure';
    }

    return sanitized;
  }
}

/// Capture a screenshot (when possible) and throw a [TestFailure] with [message].
Future<void> failTestWithScreenshot(String message) async {
  final binding = IntegrationTestWidgetsFlutterBinding.instance;
  if (binding is ScreenshotIntegrationTestBinding) {
    await binding.captureFailureScreenshot(message);
  }

  throw TestFailure(message);
}
