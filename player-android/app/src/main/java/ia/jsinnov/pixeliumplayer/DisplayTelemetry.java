package ia.jsinnov.pixeliumplayer;

import android.app.Activity;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.WindowManager;

import org.json.JSONArray;
import org.json.JSONObject;

final class DisplayTelemetry {
  private DisplayTelemetry() {}

  static JSONObject device() {
    JSONObject value = new JSONObject();
    put(value, "manufacturer", Build.MANUFACTURER);
    put(value, "brand", Build.BRAND);
    put(value, "model", Build.MODEL);
    put(value, "device", Build.DEVICE);
    put(value, "product", Build.PRODUCT);
    put(value, "hardware", Build.HARDWARE);
    put(value, "board", Build.BOARD);
    put(value, "androidVersion", Build.VERSION.RELEASE);
    put(value, "apiLevel", Build.VERSION.SDK_INT);
    if (Build.VERSION.SDK_INT >= 31) {
      put(value, "socManufacturer", Build.SOC_MANUFACTURER);
      put(value, "socModel", Build.SOC_MODEL);
    } else {
      put(value, "socManufacturer", JSONObject.NULL);
      put(value, "socModel", JSONObject.NULL);
    }
    return value;
  }

  static JSONObject display(Activity activity) {
    JSONObject value = new JSONObject();
    try {
      WindowManager windowManager = activity.getWindowManager();
      Display display = windowManager == null ? null : windowManager.getDefaultDisplay();
      if (display == null) return unavailable(value, "display_unavailable");

      put(value, "connected", display.isValid());
      put(value, "displayId", display.getDisplayId());
      put(value, "name", display.getName());
      put(value, "state", display.getState());
      put(value, "physicalConnector", "unknown");
      put(value, "edidAvailable", false);
      put(value, "edidStatus", "unavailable_public_sdk");
      put(value, "modeControl", "request_only_unverified");

      DisplayMetrics metrics = new DisplayMetrics();
      display.getRealMetrics(metrics);
      put(value, "logicalDensityDpi", metrics.densityDpi);

      if (Build.VERSION.SDK_INT >= 23) {
        Display.Mode active = display.getMode();
        if (active != null) {
          put(value, "width", active.getPhysicalWidth());
          put(value, "height", active.getPhysicalHeight());
          put(value, "refreshRate", active.getRefreshRate());
          put(value, "modeId", active.getModeId());
        } else {
          put(value, "width", metrics.widthPixels);
          put(value, "height", metrics.heightPixels);
          put(value, "refreshRate", display.getRefreshRate());
          put(value, "modeId", JSONObject.NULL);
        }

        JSONArray modes = new JSONArray();
        Display.Mode[] supported = display.getSupportedModes();
        if (supported != null) {
          for (Display.Mode mode : supported) {
            if (mode == null) continue;
            JSONObject item = new JSONObject();
            put(item, "id", mode.getModeId());
            put(item, "width", mode.getPhysicalWidth());
            put(item, "height", mode.getPhysicalHeight());
            put(item, "refreshRate", mode.getRefreshRate());
            modes.put(item);
          }
        }
        put(value, "supportedModes", modes);
      } else {
        put(value, "width", metrics.widthPixels);
        put(value, "height", metrics.heightPixels);
        put(value, "refreshRate", display.getRefreshRate());
        put(value, "modeId", JSONObject.NULL);
        put(value, "supportedModes", new JSONArray());
      }

      if (Build.VERSION.SDK_INT >= 24) {
        put(value, "hdr", display.isHdr());
        Display.HdrCapabilities capabilities = display.getHdrCapabilities();
        JSONArray hdrTypes = new JSONArray();
        if (capabilities != null) {
          int[] types = capabilities.getSupportedHdrTypes();
          if (types != null) for (int type : types) hdrTypes.put(type);
        }
        put(value, "hdrTypes", hdrTypes);
      } else {
        put(value, "hdr", JSONObject.NULL);
        put(value, "hdrTypes", new JSONArray());
      }
    } catch (Throwable error) {
      unavailable(value, "telemetry_error");
      put(value, "error", error.getClass().getSimpleName());
    }
    return value;
  }

  private static JSONObject unavailable(JSONObject value, String reason) {
    put(value, "connected", JSONObject.NULL);
    put(value, "width", JSONObject.NULL);
    put(value, "height", JSONObject.NULL);
    put(value, "refreshRate", JSONObject.NULL);
    put(value, "supportedModes", new JSONArray());
    put(value, "hdr", JSONObject.NULL);
    put(value, "edidAvailable", false);
    put(value, "edidStatus", "unavailable_public_sdk");
    put(value, "physicalConnector", "unknown");
    put(value, "status", reason);
    return value;
  }

  private static void put(JSONObject target, String key, Object value) {
    try { target.put(key, value == null ? JSONObject.NULL : value); } catch (Exception ignored) {}
  }
}
