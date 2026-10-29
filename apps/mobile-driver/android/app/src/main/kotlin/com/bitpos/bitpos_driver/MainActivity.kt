package com.bitpos.bitpos_driver

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import com.google.android.gms.common.GoogleApiAvailabilityLight
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.content.Intent
import android.provider.Settings

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bitpos/mobile_push").setMethodCallHandler { call, result ->
            val notifications = getSystemService(NotificationManager::class.java)
            when (call.method) {
                "environment" -> result.success(mapOf("applicationId" to packageName,
                    "playServicesStatus" to GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(this),
                    "channelEnabled" to (android.os.Build.VERSION.SDK_INT < 26 || notifications.getNotificationChannel("bitpos_updates_v1")?.importance != NotificationManager.IMPORTANCE_NONE),
                    "notificationsEnabled" to notifications.areNotificationsEnabled()))
                "ensureUpdateChannel" -> {
                    if (android.os.Build.VERSION.SDK_INT >= 26) {
                        val channel = NotificationChannel("bitpos_updates_v1", call.argument<String>("name") ?: "BitPOS updates", NotificationManager.IMPORTANCE_DEFAULT)
                        channel.lockscreenVisibility = Notification.VISIBILITY_PRIVATE
                        notifications.createNotificationChannel(channel)
                    }
                    result.success(null)
                }
                "openSettings" -> {
                    val intent = if (android.os.Build.VERSION.SDK_INT >= 26) Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
                        else Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))
                    startActivity(intent)
                    result.success(null)
                }
                "clearUpdates" -> {
                    notifications.activeNotifications.filter { it.tag == "bitpos-push" }.forEach { notifications.cancel(it.tag, it.id) }
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }
}
