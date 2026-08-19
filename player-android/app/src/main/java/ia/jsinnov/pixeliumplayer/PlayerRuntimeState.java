package ia.jsinnov.pixeliumplayer;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;

import org.json.JSONObject;

final class PlayerRuntimeState {
  static final String PREFS = "player";
  static final String PREF_ACTIVITY_VISIBLE = "runtimeActivityVisible";
  static final String PREF_ACTIVITY_CHANGED_AT = "runtimeActivityChangedAt";
  static final String PREF_PLAYBACK_HEARTBEAT_AT = "runtimePlaybackHeartbeatAt";
  static final String PREF_PLAYBACK_ERROR = "runtimePlaybackError";
  static final String PREF_RUNTIME_HEARTBEAT_AT = "runtimeServiceHeartbeatAt";
  static final String PREF_RUNTIME_ERROR = "runtimeServiceError";
  static final String PREF_LAST_LAUNCH_ATTEMPT_AT = "runtimeLastLaunchAttemptAt";

  private PlayerRuntimeState() {}

  static SharedPreferences preferences(Context context) {
    return context.getSharedPreferences(PREFS, 0);
  }

  static void markActivityVisible(Context context, boolean visible) {
    preferences(context).edit()
      .putBoolean(PREF_ACTIVITY_VISIBLE, visible)
      .putLong(PREF_ACTIVITY_CHANGED_AT, System.currentTimeMillis())
      .apply();
  }

  static void markPlaybackHeartbeat(Context context) {
    preferences(context).edit()
      .putLong(PREF_PLAYBACK_HEARTBEAT_AT, System.currentTimeMillis())
      .remove(PREF_PLAYBACK_ERROR)
      .apply();
  }

  static void markPlaybackError(Context context, String error) {
    preferences(context).edit()
      .putString(PREF_PLAYBACK_ERROR, clean(error, 500))
      .apply();
  }

  static void markRuntimeHeartbeat(Context context) {
    preferences(context).edit()
      .putLong(PREF_RUNTIME_HEARTBEAT_AT, System.currentTimeMillis())
      .remove(PREF_RUNTIME_ERROR)
      .apply();
  }

  static void markRuntimeError(Context context, String error) {
    preferences(context).edit()
      .putString(PREF_RUNTIME_ERROR, clean(error, 500))
      .apply();
  }

  static long playbackHeartbeatAt(Context context) {
    return preferences(context).getLong(PREF_PLAYBACK_HEARTBEAT_AT, 0L);
  }

  static boolean activityVisible(Context context) {
    return preferences(context).getBoolean(PREF_ACTIVITY_VISIBLE, false);
  }

  static JSONObject snapshot(Context context) {
    SharedPreferences prefs = preferences(context);
    JSONObject value = new JSONObject();
    try {
      value.put("activityVisible", prefs.getBoolean(PREF_ACTIVITY_VISIBLE, false));
      value.put("activityChangedAt", nullableTimestamp(prefs.getLong(PREF_ACTIVITY_CHANGED_AT, 0L)));
      value.put("playbackHeartbeatAt", nullableTimestamp(prefs.getLong(PREF_PLAYBACK_HEARTBEAT_AT, 0L)));
      value.put("playbackError", nullableText(prefs.getString(PREF_PLAYBACK_ERROR, "")));
      value.put("runtimeHeartbeatAt", nullableTimestamp(prefs.getLong(PREF_RUNTIME_HEARTBEAT_AT, 0L)));
      value.put("runtimeError", nullableText(prefs.getString(PREF_RUNTIME_ERROR, "")));
      value.put("lastLaunchAttemptAt", nullableTimestamp(prefs.getLong(PREF_LAST_LAUNCH_ATTEMPT_AT, 0L)));

      Intent homeIntent = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
      ResolveInfo resolved = context.getPackageManager().resolveActivity(homeIntent, PackageManager.MATCH_DEFAULT_ONLY);
      String homePackage = resolved != null && resolved.activityInfo != null ? resolved.activityInfo.packageName : "";
      value.put("homePackage", nullableText(homePackage));
      value.put("defaultHome", !homePackage.isEmpty() && context.getPackageName().equals(homePackage));
    } catch (Exception ignored) {}
    return value;
  }

  private static Object nullableTimestamp(long value) {
    return value > 0L ? value : JSONObject.NULL;
  }

  private static Object nullableText(String value) {
    String clean = String.valueOf(value == null ? "" : value).trim();
    return clean.isEmpty() ? JSONObject.NULL : clean;
  }

  private static String clean(String value, int max) {
    String clean = String.valueOf(value == null ? "" : value).trim();
    return clean.length() <= max ? clean : clean.substring(0, max);
  }
}
