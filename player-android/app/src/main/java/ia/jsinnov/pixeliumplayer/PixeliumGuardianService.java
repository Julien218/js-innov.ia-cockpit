package ia.jsinnov.pixeliumplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class PixeliumGuardianService extends Service {
  private static final String TAG = "PixeliumGuardian";
  private static final String CHANNEL_ID = "pixelium_player_runtime";
  private static final int NOTIFICATION_ID = 5102;
  private static final String RUNTIME_VERSION = "2";
  private static final String PLAYER_VERSION = "0.5.3-pilot";
  private static final long RUNTIME_HEARTBEAT_INTERVAL_MS = 30_000L;
  private static final long WATCHDOG_INTERVAL_MS = 45_000L;
  private static final long PLAYBACK_STALE_MS = 90_000L;
  private static final long RELAUNCH_THROTTLE_MS = 60_000L;

  private final Handler handler = new Handler(Looper.getMainLooper());
  private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
  private final AtomicBoolean runtimeHeartbeatInFlight = new AtomicBoolean(false);
  private ConnectivityManager connectivityManager;
  private ConnectivityManager.NetworkCallback networkCallback;
  private volatile boolean networkAvailable;
  private long serviceStartedAtElapsed;

  private final Runnable runtimeHeartbeat = new Runnable() {
    @Override public void run() {
      sendRuntimeHeartbeat();
      handler.postDelayed(this, RUNTIME_HEARTBEAT_INTERVAL_MS);
    }
  };

  private final Runnable watchdog = new Runnable() {
    @Override public void run() {
      long lastPlayback = PlayerRuntimeState.playbackHeartbeatAt(PixeliumGuardianService.this);
      boolean stale = lastPlayback <= 0L || System.currentTimeMillis() - lastPlayback > PLAYBACK_STALE_MS;
      if (stale) ensurePlayerRunning("playback_stale");
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
      PlayerRuntimeState.markRuntimeError(context, error.getClass().getSimpleName() + ": " + error.getMessage());
    }
  }

  @Override public void onCreate() {
    super.onCreate();
    serviceStartedAtElapsed = SystemClock.elapsedRealtime();
    createNotificationChannel();
    startForeground(NOTIFICATION_ID, buildNotification("Surveillance et reconnexion actives"));
    registerNetworkCallback();
  }

  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    startForeground(NOTIFICATION_ID, buildNotification("Surveillance et reconnexion actives"));
    handler.removeCallbacks(runtimeHeartbeat);
    handler.removeCallbacks(watchdog);
    handler.post(runtimeHeartbeat);
    handler.post(watchdog);
    return START_STICKY;
  }

  @Override public void onTaskRemoved(Intent rootIntent) {
    handler.removeCallbacks(runtimeHeartbeat);
    handler.removeCallbacks(watchdog);
    handler.postDelayed(runtimeHeartbeat, 1_000L);
    handler.postDelayed(watchdog, 2_000L);
    super.onTaskRemoved(rootIntent);
  }

  @Override public void onDestroy() {
    handler.removeCallbacksAndMessages(null);
    if (connectivityManager != null && networkCallback != null) {
      try { connectivityManager.unregisterNetworkCallback(networkCallback); } catch (Exception ignored) {}
    }
    networkExecutor.shutdownNow();
    super.onDestroy();
  }

  @Override public IBinder onBind(Intent intent) {
    return null;
  }

  private void sendRuntimeHeartbeat() {
    SharedPreferences prefs = getSharedPreferences(PlayerRuntimeState.PREFS, 0);
    String token = String.valueOf(prefs.getString("token", "")).trim();
    String server = String.valueOf(prefs.getString("server", MainActivity.DEFAULT_SERVER)).trim().replaceAll("/$", "");
    if (token.isEmpty() || server.isEmpty()) return;
    if (!runtimeHeartbeatInFlight.compareAndSet(false, true)) return;

    networkExecutor.execute(() -> {
      PowerManager.WakeLock wakeLock = null;
      try {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power != null) {
          wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PixeliumPlayer:RuntimeHeartbeat");
          wakeLock.acquire(60_000L);
        }

        JSONObject runtime = PlayerRuntimeState.snapshot(this);
        runtime.put("runtimeVersion", RUNTIME_VERSION);
        runtime.put("playerVersion", PLAYER_VERSION);
        runtime.put("serviceUptimeMs", Math.max(0L, SystemClock.elapsedRealtime() - serviceStartedAtElapsed));
        runtime.put("processId", Process.myPid());
        runtime.put("networkAvailable", isNetworkAvailable());
        runtime.put("device", DisplayTelemetry.device());

        JSONObject request = new JSONObject()
          .put("runtimeVersion", RUNTIME_VERSION)
          .put("appVersion", PLAYER_VERSION)
          .put("diagnostics", runtime);

        JSONObject response = jsonRequest(
          server + "/api/signage/player/runtime-heartbeat",
          token,
          request
        );
        PlayerRuntimeState.markRuntimeHeartbeat(this);
        networkAvailable = true;

        if (response.optBoolean("launchRequested", false)) {
          handler.post(() -> ensurePlayerRunning("server_playback_offline"));
          updateNotification("TVBOX connecté — relance du Player demandée");
        } else {
          updateNotification("TVBOX et Player connectés");
        }
      } catch (Exception error) {
        PlayerRuntimeState.markRuntimeError(this, error.getClass().getSimpleName() + ": " + error.getMessage());
        updateNotification("Cloud momentanément indisponible — cache local conservé");
        Log.w(TAG, "Runtime heartbeat failed", error);
      } finally {
        if (wakeLock != null && wakeLock.isHeld()) {
          try { wakeLock.release(); } catch (Exception ignored) {}
        }
        runtimeHeartbeatInFlight.set(false);
      }
    });
  }

  private void ensurePlayerRunning(String reason) {
    SharedPreferences prefs = getSharedPreferences(PlayerRuntimeState.PREFS, 0);
    String token = String.valueOf(prefs.getString("token", "")).trim();
    if (token.isEmpty()) return;

    long now = System.currentTimeMillis();
    long lastAttempt = prefs.getLong(PlayerRuntimeState.PREF_LAST_LAUNCH_ATTEMPT_AT, 0L);
    if (now - lastAttempt < RELAUNCH_THROTTLE_MS) return;
    prefs.edit().putLong(PlayerRuntimeState.PREF_LAST_LAUNCH_ATTEMPT_AT, now).apply();

    try {
      Intent launch = new Intent(this, ScheduledMainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      startActivity(launch);
      Log.i(TAG, "Player activity launch requested: " + reason);
      updateNotification("Relance du Player demandée — toucher pour ouvrir");
    } catch (Exception error) {
      Log.w(TAG, "Player activity relaunch deferred: " + reason, error);
      PlayerRuntimeState.markPlaybackError(this, "Background launch blocked: " + error.getClass().getSimpleName());
      updateNotification("TVBOX connecté — toucher pour ouvrir Pixelium");
    }
  }

  private void registerNetworkCallback() {
    try {
      connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      if (connectivityManager == null) return;
      networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
          networkAvailable = true;
          handler.post(runtimeHeartbeat);
          handler.post(() -> ensurePlayerRunning("network_available"));
        }

        @Override public void onLost(Network network) {
          networkAvailable = isNetworkAvailable();
          updateNotification("Réseau interrompu — diffusion locale conservée");
        }
      };
      NetworkRequest request = new NetworkRequest.Builder()
        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build();
      connectivityManager.registerNetworkCallback(request, networkCallback);
      networkAvailable = isNetworkAvailable();
    } catch (Exception error) {
      Log.w(TAG, "Network callback unavailable", error);
    }
  }

  private boolean isNetworkAvailable() {
    try {
      if (connectivityManager == null) {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
      }
      if (connectivityManager == null) return networkAvailable;
      Network network = connectivityManager.getActiveNetwork();
      if (network == null) return false;
      NetworkCapabilities capabilities = connectivityManager.getNetworkCapabilities(network);
      return capabilities != null && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    } catch (Exception ignored) {
      return networkAvailable;
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
    channel.setDescription("Maintient le TVBOX supervisé et permet de rouvrir la diffusion");
    channel.setShowBadge(false);
    manager.createNotificationChannel(channel);
  }

  private Notification buildNotification(String message) {
    Intent launch = new Intent(this, ScheduledMainActivity.class)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    int pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pendingFlags |= PendingIntent.FLAG_IMMUTABLE;
    PendingIntent pendingIntent = PendingIntent.getActivity(this, 5102, launch, pendingFlags);

    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
      ? new Notification.Builder(this, CHANNEL_ID)
      : new Notification.Builder(this);
    return builder
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("Pixelium Player actif")
      .setContentText(message)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .build();
  }

  private void updateNotification(String message) {
    handler.post(() -> {
      NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
      if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(message));
    });
  }

  private JSONObject jsonRequest(String target, String token, JSONObject body) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
    try {
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(10_000);
      connection.setReadTimeout(30_000);
      connection.setRequestProperty("Authorization", "Bearer " + token);
      connection.setRequestProperty("Content-Type", "application/json");
      connection.setRequestProperty("Accept", "application/json");
      connection.setDoOutput(true);
      try (OutputStream output = connection.getOutputStream()) {
        output.write(body.toString().getBytes(StandardCharsets.UTF_8));
      }
      int responseCode = connection.getResponseCode();
      InputStream input = responseCode < 400 ? connection.getInputStream() : connection.getErrorStream();
      String text = new String(readAll(input), StandardCharsets.UTF_8);
      if (responseCode >= 400) throw new IOException("HTTP " + responseCode + " " + text);
      return text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
    } finally {
      connection.disconnect();
    }
  }

  private byte[] readAll(InputStream input) throws IOException {
    if (input == null) return new byte[0];
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    return output.toByteArray();
  }
}
