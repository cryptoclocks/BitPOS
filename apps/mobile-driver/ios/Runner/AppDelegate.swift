import Flutter
import UIKit
import FirebaseCore
import FirebaseMessaging
import UserNotifications

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pushChannel: FlutterMethodChannel?
  private var pushConsentRequested = false
  private var pushApnsFailed = false
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let channel = FlutterMethodChannel(name: "bitpos/mobile_push", binaryMessenger: engineBridge.applicationRegistrar.messenger())
    pushChannel = channel
    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else { result(FlutterError(code: "PUSH_NATIVE_UNAVAILABLE", message: nil, details: nil)); return }
      switch call.method {
      case "environment":
        UNUserNotificationCenter.current().getNotificationSettings { settings in
          DispatchQueue.main.async {
            result(["applicationId": Bundle.main.bundleIdentifier ?? "", "notificationsEnabled": settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional, "apnsFailed": self.pushApnsFailed])
          }
        }
      case "requestApnsRegistration":
        guard FirebaseApp.app() != nil, (call.arguments as? [String: Any])?["consent"] as? Bool == true else {
          result(FlutterError(code: "PUSH_CONSENT_REQUIRED", message: nil, details: nil)); return
        }
        self.pushConsentRequested = true
        self.pushApnsFailed = false
        UIApplication.shared.registerForRemoteNotifications()
        result(nil)
      case "stopApnsRegistration":
        self.pushConsentRequested = false
        UIApplication.shared.unregisterForRemoteNotifications()
        result(nil)
      case "openSettings":
        guard let url = URL(string: UIApplication.openNotificationSettingsURLString) else { result(FlutterError(code: "PUSH_SETTINGS_UNAVAILABLE", message: nil, details: nil)); return }
        UIApplication.shared.open(url) { opened in
          result(opened ? nil : FlutterError(code: "PUSH_SETTINGS_UNAVAILABLE", message: nil, details: nil))
        }
      case "clearUpdates":
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        result(nil)
      default: result(FlutterMethodNotImplemented)
      }
    }
  }

  override func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    if pushConsentRequested && FirebaseApp.app() != nil {
      Messaging.messaging().apnsToken = deviceToken
    }
    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)
  }

  override func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    pushApnsFailed = true
    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)
  }
}
