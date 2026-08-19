package ia.jsinnov.pixeliumplayer;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

public class UpdateInstallReceiver extends BroadcastReceiver {
  static final String ACTION_INSTALL_STATUS = "ia.jsinnov.pixeliumplayer.UPDATE_INSTALL_STATUS";
  static final String EXTRA_TARGET_VERSION = "targetVersion";

  @Override public void onReceive(Context context, Intent intent) {
    if (intent == null || !ACTION_INSTALL_STATUS.equals(intent.getAction())) return;
    String version = intent.getStringExtra(EXTRA_TARGET_VERSION);
    int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
    String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);

    if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
      PlayerUpdateManager.setState(context, "waiting_confirmation", version, "Confirmation Android requise");
      Intent confirmation;
      if (Build.VERSION.SDK_INT >= 33) {
        confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
      } else {
        confirmation = intent.getParcelableExtra(Intent.EXTRA_INTENT);
      }
      if (confirmation != null) {
        confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { context.startActivity(confirmation); } catch (Exception ignored) {}
      }
      return;
    }

    if (status == PackageInstaller.STATUS_SUCCESS) {
      PlayerUpdateManager.setState(context, "success", version, "");
      PixeliumGuardianService.start(context);
      return;
    }

    PlayerUpdateManager.setState(context, "failed", version,
      message == null || message.isEmpty() ? "Installation Android refusée" : message);
  }
}
