import 'dart:convert';
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final destination = Platform.environment['BITPOS_UI_CAPTURE_DIR'];
  if (destination == null || destination.isEmpty) {
    throw StateError('BITPOS_UI_CAPTURE_DIR must name a host output directory.');
  }

  final directory = Directory(destination);
  await directory.create(recursive: true);
  final receipt = <Map<String, String>>[];

  await integrationDriver(
    onScreenshot: (name, image, [args]) async {
      if (!RegExp(
        r'^customer-address-U(?:12-(?:selection|saved)|13|14-(?:unconfigured|native-input))-native-(?:th|en)-light-scale1\.0$',
      ).hasMatch(name)) {
        throw StateError('Unexpected screenshot name: $name');
      }
      final imageFile = File('${directory.path}/$name.png');
      await imageFile.writeAsBytes(image, flush: true);
      final checksum = await Process.run('shasum', ['-a', '256', imageFile.path]);
      if (checksum.exitCode != 0) {
        throw ProcessException(
          'shasum',
          ['-a', '256', imageFile.path],
          checksum.stderr.toString(),
          checksum.exitCode,
        );
      }
      receipt.add(<String, String>{
        'name': name,
        'path': imageFile.path,
        'sha256': checksum.stdout.toString().split(RegExp(r'\s+')).first,
        'captureStatus': 'captured',
        'testStatus': 'not determined by screenshot callback',
      });
      await File('${directory.path}/screenshots.json').writeAsString(
        const JsonEncoder.withIndent('  ').convert(<String, Object>{
          'screenshots': receipt,
        }),
        flush: true,
      );
      return true;
    },
    responseDataCallback: (_) {},
    writeResponseOnFailure: true,
  );
}
