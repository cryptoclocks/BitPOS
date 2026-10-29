import 'package:geolocator/geolocator.dart';

enum CustomerLocationStatus {
  initial,
  granted,
  denied,
  permanentlyDenied,
  servicesOff,
  error,
}

/// Foreground OS permission only. Does not collect coordinates, subscribe to
/// location, upload data, or opt an account/device into notifications.
abstract interface class CustomerLocationAccess {
  Future<CustomerLocationStatus> request();
  Future<bool> openAppSettings();
  Future<bool> openLocationSettings();
}

class NativeCustomerLocationAccess implements CustomerLocationAccess {
  const NativeCustomerLocationAccess();

  @override
  Future<CustomerLocationStatus> request() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return CustomerLocationStatus.servicesOff;
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    return switch (permission) {
      LocationPermission.always || LocationPermission.whileInUse =>
        CustomerLocationStatus.granted,
      LocationPermission.deniedForever => CustomerLocationStatus.permanentlyDenied,
      _ => CustomerLocationStatus.denied,
    };
  }

  @override
  Future<bool> openAppSettings() => Geolocator.openAppSettings();

  @override
  Future<bool> openLocationSettings() => Geolocator.openLocationSettings();
}
