package ia.jsinnov.pixeliumplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
  private static final String TAG = "PixeliumBoot";
  private static final String ACTION_QUICKBOOT = "android.intent.action.QUICKBOOT_POWERON";
  private static final String ACTION_HTC_QUICKBOOT = "com.htc.intent.action.QUICKBOOT_POWERON";

  @Override public void onReceive(Context context, Intent intent) {
    String action = intent == null ? "" : String.valueOf(intent.getAction());
    boolean supported = Intent.ACTION_BOOT_COMPLETED.equals(action)
      || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
      || Intent.ACTION_USER_UNLOCKED.equals(action)
      || ACTION_QUICKBOOT.equals(action)
      || ACTION_HTC_QUICKBOOT.equals(action);
    if (!supported) return;

    PlayerRuntimeState.markActivityVisible(context, false);
    PixeliumGuardianService.start(context);

    try {
      Intent launch = new Intent(context, ScheduledMainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      context.startActivity(launch);
      Log.i(TAG, "Pixelium Player + guardian launch requested after " + action);
    } catch (Exception error) {
      // Certains firmwares Android TV interdisent les ouvertures d'activité en
      // arrière-plan. Le Guardian reste actif et sa notification ouvre le Player.
      Log.w(TAG, "Player activity launch deferred after " + action, error);
    }
  }
}
