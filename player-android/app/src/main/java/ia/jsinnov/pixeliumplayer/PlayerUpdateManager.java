package ia.jsinnov.pixeliumplayer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicBoolean;

final class PlayerUpdateManager {
  static final String PREF_STATUS = "updaterStatus";
  static final String PREF_VERSION = "updaterVersion";
  static final String PREF_ERROR = "updaterError";
  static final String PREF_LAST_CHECK = "updaterLastCheck";
  static final String PREF_IN_PROGRESS_AT = "updaterInProgressAt";
  static final long CHECK_INTERVAL_MS = 10 * 60 * 1000L;
  static final long FAILURE_RETRY_MS = 2 * 60 * 1000L;
  static final long IN_PROGRESS_TIMEOUT_MS = 15 * 60 * 1000L;
  static final String PINNED_CERT_SHA256 = "8fed74014024629caa1d253264e894e627dc1b96ce1add75d4ee8dad87f89cf9";

  private static final AtomicBoolean CHECK_IN_PROGRESS = new AtomicBoolean(false);

  private PlayerUpdateManager() {}

  static JSONObject telemetry(Context context) {
    SharedPreferences prefs = context.getSharedPreferences("player", 0);
    JSONObject result = new JSONObject();
    try {
      result.put("status", prefs.getString(PREF_STATUS, "idle"));
      result.put("targetVersion", prefs.getString(PREF_VERSION, ""));
      result.put("error", prefs.getString(PREF_ERROR, ""));
      result.put("lastCheckAt", prefs.getLong(PREF_LAST_CHECK, 0L));
      result.put("inProgressAt", prefs.getLong(PREF_IN_PROGRESS_AT, 0L));
      result.put("canRequestPackageInstalls", Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls());
    } catch (Exception ignored) {}
    return result;
  }

  static void checkForUpdate(Context context, String server, String currentVersion) {
    if (context == null || server == null || server.trim().isEmpty()) return;
    Context appContext = context.getApplicationContext() == null ? context : context.getApplicationContext();
    SharedPreferences prefs = appContext.getSharedPreferences("player", 0);
    long now = System.currentTimeMillis();
    long inProgressAt = prefs.getLong(PREF_IN_PROGRESS_AT, 0L);
    String status = prefs.getString(PREF_STATUS, "idle");

    if (("installing".equals(status) || "waiting_confirmation".equals(status))
        && now - inProgressAt < IN_PROGRESS_TIMEOUT_MS) return;

    boolean interactivePermissionRetry = "waiting_permission".equals(status) && context instanceof Activity;
    long retryInterval = "failed".equals(status) ? FAILURE_RETRY_MS : CHECK_INTERVAL_MS;
    long last = prefs.getLong(PREF_LAST_CHECK, 0L);
    if (!interactivePermissionRetry && now - last < retryInterval) return;
    if (!CHECK_IN_PROGRESS.compareAndSet(false, true)) return;

    try {
      prefs.edit().putLong(PREF_LAST_CHECK, now).apply();
      setState(appContext, "checking", prefs.getString(PREF_VERSION, ""), "");
      JSONObject release = getJson(server.replaceAll("/$", "") + "/api/player-download/status");
      if (!release.optBoolean("available", false)) {
        setState(appContext, "idle", "", "release unavailable");
        return;
      }

      String targetVersion = release.optString("version", "");
      String apkSha256 = normalizeDigest(release.optString("apkSha256", ""));
      String certificateSha256 = normalizeDigest(release.optString("certificateSha256", ""));
      if (targetVersion.isEmpty() || compareVersions(targetVersion, currentVersion) <= 0) {
        setState(appContext, "up_to_date", currentVersion, "");
        clearInProgress(appContext);
        return;
      }
      if (apkSha256.length() != 64) throw new IOException("SHA-256 de release absent ou invalide");
      if (!PINNED_CERT_SHA256.equals(certificateSha256)) throw new IOException("Certificat de release non approuvé");

      if (Build.VERSION.SDK_INT >= 26 && !appContext.getPackageManager().canRequestPackageInstalls()) {
        setState(appContext, "waiting_permission", targetVersion, "Autorisation d’installation requise une seule fois");
        if (context instanceof Activity) {
          Activity activity = (Activity) context;
          Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + appContext.getPackageName()))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
          activity.runOnUiThread(() -> {
            try { activity.startActivity(settings); }
            catch (Exception error) {
              setState(appContext, "waiting_permission", targetVersion,
                "Ouvrez les réglages Pixelium et autorisez l’installation d’applications");
            }
          });
        }
        return;
      }

      File updateDir = new File(appContext.getFilesDir(), "updates");
      if (!updateDir.exists() && !updateDir.mkdirs()) throw new IOException("Dossier de mise à jour indisponible");
      File apk = new File(updateDir, "Pixelium-Player-" + targetVersion + ".apk");
      File part = new File(updateDir, "Pixelium-Player-" + targetVersion + ".part");
      if (part.exists() && !part.delete()) throw new IOException("Ancien téléchargement partiel impossible à supprimer");

      setState(appContext, "downloading", targetVersion, "");
      download(server.replaceAll("/$", "") + "/api/player-download/latest", part);
      if (!apkSha256.equals(normalizeDigest(sha256(part)))) {
        part.delete();
        throw new IOException("SHA-256 APK incorrect");
      }
      if (!PINNED_CERT_SHA256.equals(apkCertificateSha256(appContext, part))) {
        part.delete();
        throw new IOException("Signature APK Pixelium incorrecte");
      }
      if (apk.exists() && !apk.delete()) throw new IOException("Ancienne mise à jour impossible à remplacer");
      if (!part.renameTo(apk)) throw new IOException("Impossible de préparer l’APK vérifié");

      setState(appContext, "verified", targetVersion, "");
      install(appContext, apk, targetVersion);
    } catch (Exception error) {
      setState(appContext, "failed", prefs.getString(PREF_VERSION, ""), String.valueOf(error.getMessage()));
      clearInProgress(appContext);
    } finally {
      CHECK_IN_PROGRESS.set(false);
    }
  }

  private static int compareVersions(String left, String right) {
    String[] a = numericVersion(left).split("\\.");
    String[] b = numericVersion(right).split("\\.");
    int length = Math.max(a.length, b.length);
    for (int index = 0; index < length; index++) {
      int av = index < a.length ? safeInt(a[index]) : 0;
      int bv = index < b.length ? safeInt(b[index]) : 0;
      if (av != bv) return av < bv ? -1 : 1;
    }
    return 0;
  }

  private static String numericVersion(String value) {
    String clean = String.valueOf(value == null ? "" : value).trim();
    int dash = clean.indexOf('-');
    if (dash >= 0) clean = clean.substring(0, dash);
    return clean.matches("[0-9]+(\\.[0-9]+)*") ? clean : "0";
  }

  private static int safeInt(String value) {
    try { return Integer.parseInt(value); } catch (Exception ignored) { return 0; }
  }

  private static void install(Context context, File apk, String targetVersion) throws Exception {
    PackageInstaller installer = context.getPackageManager().getPackageInstaller();
    PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
    params.setAppPackageName(context.getPackageName());
    if (Build.VERSION.SDK_INT >= 31) {
      params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
    }

    int sessionId = installer.createSession(params);
    try (PackageInstaller.Session session = installer.openSession(sessionId);
         InputStream input = new FileInputStream(apk);
         OutputStream output = session.openWrite("base.apk", 0, apk.length())) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
      session.fsync(output);

      Intent result = new Intent(context, UpdateInstallReceiver.class)
        .setAction(UpdateInstallReceiver.ACTION_INSTALL_STATUS)
        .putExtra(UpdateInstallReceiver.EXTRA_TARGET_VERSION, targetVersion);
      int flags = PendingIntent.FLAG_UPDATE_CURRENT;
      if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE;
      PendingIntent pending = PendingIntent.getBroadcast(context, sessionId, result, flags);
      setState(context, "installing", targetVersion, "");
      context.getSharedPreferences("player", 0).edit().putLong(PREF_IN_PROGRESS_AT, System.currentTimeMillis()).apply();
      session.commit(pending.getIntentSender());
    }
  }

  static void setState(Context context, String status, String version, String error) {
    context.getSharedPreferences("player", 0).edit()
      .putString(PREF_STATUS, status == null ? "" : status)
      .putString(PREF_VERSION, version == null ? "" : version)
      .putString(PREF_ERROR, error == null ? "" : error)
      .apply();
  }

  static void clearInProgress(Context context) {
    context.getSharedPreferences("player", 0).edit().remove(PREF_IN_PROGRESS_AT).apply();
  }

  private static JSONObject getJson(String target) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
    try {
      connection.setRequestMethod("GET");
      connection.setConnectTimeout(10000);
      connection.setReadTimeout(30000);
      connection.setRequestProperty("Accept", "application/json");
      int responseCode = connection.getResponseCode();
      InputStream input = responseCode < 400 ? connection.getInputStream() : connection.getErrorStream();
      String text = new String(readAll(input), StandardCharsets.UTF_8);
      if (responseCode >= 400) throw new IOException("Update status HTTP " + responseCode);
      return new JSONObject(text);
    } finally {
      connection.disconnect();
    }
  }

  private static void download(String source, File target) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
    try {
      connection.setConnectTimeout(15000);
      connection.setReadTimeout(90000);
      int responseCode = connection.getResponseCode();
      if (responseCode < 200 || responseCode >= 300) {
        throw new IOException("Téléchargement APK refusé (HTTP " + responseCode + ")");
      }
      try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
        byte[] buffer = new byte[65536];
        int count;
        while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
      }
    } finally {
      connection.disconnect();
    }
  }

  private static String apkCertificateSha256(Context context, File apk) throws Exception {
    PackageManager pm = context.getPackageManager();
    byte[] cert;
    if (Build.VERSION.SDK_INT >= 28) {
      PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNING_CERTIFICATES);
      if (info == null || info.signingInfo == null || info.signingInfo.getApkContentsSigners().length == 0) {
        throw new IOException("Signature APK illisible");
      }
      cert = info.signingInfo.getApkContentsSigners()[0].toByteArray();
    } else {
      PackageInfo info = pm.getPackageArchiveInfo(apk.getAbsolutePath(), PackageManager.GET_SIGNATURES);
      if (info == null || info.signatures == null || info.signatures.length == 0) throw new IOException("Signature APK illisible");
      cert = info.signatures[0].toByteArray();
    }
    return normalizeDigest(sha256(cert));
  }

  private static String sha256(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = new FileInputStream(file)) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = input.read(buffer)) > 0) digest.update(buffer, 0, count);
    }
    return hex(digest.digest());
  }

  private static String sha256(byte[] input) throws Exception {
    return hex(MessageDigest.getInstance("SHA-256").digest(input));
  }

  private static String hex(byte[] bytes) {
    StringBuilder result = new StringBuilder();
    for (byte value : bytes) result.append(String.format("%02x", value));
    return result.toString();
  }

  private static String normalizeDigest(String value) {
    return String.valueOf(value == null ? "" : value).replace(":", "").trim().toLowerCase();
  }

  private static byte[] readAll(InputStream input) throws IOException {
    if (input == null) return new byte[0];
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    return output.toByteArray();
  }
}
