package ia.jsinnov.pixeliumplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {
  private static final String TAG = "PixeliumBoot";

  @Override public void onReceive(Context context, Intent intent) {
    String action = intent == null ? "" : String.valueOf(intent.getAction());
    if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
        && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
        && !Intent.ACTION_USER_UNLOCKED.equals(action)) {
      return;
    }

    PixeliumGuardianService.start(context);

    try {
      Intent launch = new Intent(context, ScheduledMainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
          | Intent.FLAG_ACTIVITY_CLEAR_TOP
          | Intent.FLAG_ACTIVITY_SINGLE_TOP);
      context.startActivity(launch);
      Log.i(TAG, "Pixelium Player + guardian launch requested after " + action);
    } catch (Exception error) {
      Log.e(TAG, "Unable to launch Pixelium Player after " + action, error);
    }
  }
}
