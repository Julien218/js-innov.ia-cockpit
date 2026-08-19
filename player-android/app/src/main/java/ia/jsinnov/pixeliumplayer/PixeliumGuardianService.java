package ia.jsinnov.pixeliumplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

public class PixeliumGuardianService extends Service {
  private static final String TAG = "PixeliumGuardian";
  private static final String CHANNEL_ID = "pixelium_player_runtime";
  private static final int NOTIFICATION_ID = 5102;
  private static final long WATCHDOG_INTERVAL_MS = 45_000L;
  private static final long RELAUNCH_THROTTLE_MS = 30_000L;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private PowerManager.WakeLock wakeLock;
  private ConnectivityManager connectivityManager;
  private ConnectivityManager.NetworkCallback networkCallback;
  private long lastLaunchAttemptAt;

  private final Runnable watchdog = new Runnable() {
    @Override public void run() {
      ensurePlayerRunning("watchdog");
      handler.postDelayed(this, WATCHDOG_INTERVAL_MS);
    }
  };

  public static void start(Context context) {
    Intent intent = new Intent(context, PixeliumGuardianService.class);
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
      else context.startService(intent);
    } catch (Exception error) {
      Log.e(TAG, "Unable to start guardian service", error);
    }
  }

  @Override public void onCreate() {
    super.onCreate();
    createNotificationChannel();
    acquireWakeLock();
    registerNetworkCallback();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    startForeground(NOTIFICATION_ID, buildNotification());
    handler.removeCallbacks(watchdog);
    handler.post(watchdog);
    return START_STICKY;
  }

  @Override public void onTaskRemoved(Intent rootIntent) {
    // Kiosk signage must survive launcher/task cleanup. START_STICKY asks Android
    // to recreate the service; the watchdog will then restore the player activity.
    handler.removeCallbacks(watchdog);
    handler.postDelayed(watchdog, 1_000L);
    super.onTaskRemoved(rootIntent);
  }

  @Override public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (connectivityManager != null && networkCallback != null) {
      try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
    }
    if (wakeLock != null && wakeLock.isHeld()) {
      try { wakeLock.release(); } catch (Exception ignored) {}
    }
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) {
    return null;
  }

  private void ensurePlayerRunning(String reason) {
    SharedPreferences prefs = getSharedPreferences("player", 0);
    String token = prefs.getString("token", "");
    if (token == null || token.trim().isEmpty()) return;

    long now = System.currentTimeMillis();
    if (now - lastLaunchAttemptAt < RELAUNCH_THROTTLE_MS) return;
    lastLaunchAttemptAt = now;

    try {
      Intent launch = new Intent(this, ScheduledMainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      startActivity(launch);
      Log.i(TAG, "Player activity ensured: " + reason);
    } catch (Exception error) {
      // Android TV firmwares differ in their background-activity policy. The
      // foreground service still keeps the process/heartbeat loop high priority;
      // a later boot/network/watchdog event retries the relaunch.
      Log.w(TAG, "Player activity relaunch deferred: " + reason, error);
    }
  }

  private void registerNetworkCallback() {
    try {
      connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      if (connectivityManager == null) return;
      networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
          handler.post(() -> ensurePlayerRunning("network_available"));
        }
      };
      connectivityManager.registerNetworkCallback(new NetworkRequest.Builder().build(), networkCallback);
    } catch (Exception error) {
      Log.w(TAG, "Network callback unavailable", error);
    }
  }

  private void acquireWakeLock() {
    try {
      PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
      if (manager == null) return;
      wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PixeliumPlayer:Guardian");
      wakeLock.setReferenceCounted(false);
      wakeLock.acquire();
    } catch (Exception error) {
      Log.w(TAG, "WakeLock unavailable", error);
    }
  }

  private void createNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    if (manager == null) return;
    NotificationChannel channel = new NotificationChannel(
      CHANNEL_ID,
      "Pixelium Player",
      NotificationManager.IMPORTANCE_LOW
    );
    channel.setDescription("Maintient la diffusion Pixelium active et reconnectée");
    channel.setShowBadge(false);
    manager.createNotificationChannel(channel);
  }

  private Notification buildNotification() {
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      ? new Notification.Builder(this, CHANNEL_ID)
      : new Notification.Builder(this);
    return builder
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Pixelium Player actif")
      .setContentText("Diffusion locale, reconnexion et surveillance actives")
      .setOngoing(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .build();
  }
}
