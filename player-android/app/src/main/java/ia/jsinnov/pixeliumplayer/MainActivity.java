package ia.jsinnov.pixeliumplayer;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.MediaPlayer;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Display;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import org.json.JSONArray;
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

public class MainActivity extends Activity {
  static final String DEFAULT_SERVER = "https://olivier-signage-cockpit-production.up.railway.app";
  static final String APP_VERSION = "0.3.0-pilot";
  static final float SAFE_HORIZONTAL_INSET_RATIO = 0.015f;

  final Handler handler = new Handler(Looper.getMainLooper());
  VideoView video;
  ImageView image;
  TextView status;
  String token;
  String server;
  File mediaCache;
  JSONArray items = new JSONArray();
  JSONArray candidateItems;
  String candidatePublicationId;
  boolean preparingCandidate;
  volatile String currentMediaId = "";
  volatile String currentMediaName = "";
  volatile String currentMediaMimeType = "";
  volatile String currentMediaUploadedAt = "";
  volatile long currentMediaStartedAt;
  JSONObject pendingVideoMedia;
  int itemIndex;
  Runnable imageAdvance;
  boolean remotePaused;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    hideSystemUi();
    mediaCache = new File(getFilesDir(), "media");
    mediaCache.mkdirs();
    loadConfig();
  }

  void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(5894 | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
  }

  void loadConfig() {
    SharedPreferences preferences = getSharedPreferences("player", 0);
    token = preferences.getString("token", "");
    server = preferences.getString("server", DEFAULT_SERVER);
    if (token.isEmpty()) showSetup(); else showPlayer();
  }

  TextView label(String text) {
    TextView view = new TextView(this);
    view.setText(text);
    view.setTextColor(Color.WHITE);
    view.setTextSize(18);
    view.setPadding(12, 12, 12, 12);
    return view;
  }

  void showSetup() {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(60, 40, 60, 40);
    box.setBackgroundColor(Color.rgb(10, 10, 20));
    box.addView(label("Pixelium Player — association sécurisée"));
    EditText url = new EditText(this);
    url.setText(server);
    url.setTextColor(Color.WHITE);
    url.setHint("Adresse du cockpit");
    box.addView(url);
    EditText key = new EditText(this);
    key.setTextColor(Color.WHITE);
    key.setHintTextColor(Color.GRAY);
    key.setHint("Jeton Player affiché dans le cockpit");
    box.addView(key);
    Button save = new Button(this);
    save.setText("Vérifier et associer ce Player");
    box.addView(save);
    save.setOnClickListener(view -> {
      String candidateToken = key.getText().toString().trim();
      String candidateServer = url.getText().toString().trim().replaceAll("/$", "");
      if (candidateToken.length() < 20) {
        Toast.makeText(this, "Jeton invalide", Toast.LENGTH_LONG).show();
        return;
      }
      save.setEnabled(false);
      save.setText("Vérification…");
      token = candidateToken;
      server = candidateServer;
      new Thread(() -> {
        try {
          jsonRequest(server + "/api/signage/player/verify", "POST", new JSONObject());
          getSharedPreferences("player", 0).edit().putString("token", token).putString("server", server).apply();
          handler.post(this::showPlayer);
        } catch (Exception error) {
          token = "";
          handler.post(() -> {
            save.setEnabled(true);
            save.setText("Vérifier et associer ce Player");
            Toast.makeText(this, "Jeton refusé — générez un nouveau jeton dans le cockpit", Toast.LENGTH_LONG).show();
          });
        }
      }).start();
    });
    setContentView(box);
  }

  void showPlayer() {
    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.BLACK);
    FrameLayout mediaSurface = new FrameLayout(this);
    mediaSurface.setBackgroundColor(Color.BLACK);
    image = new ImageView(this);
    image.setBackgroundColor(Color.BLACK);
    image.setScaleType(ImageView.ScaleType.FIT_CENTER);
    image.setVisibility(View.GONE);
    mediaSurface.addView(image, new FrameLayout.LayoutParams(-1, -1));
    video = new VideoView(this);
    video.setVisibility(View.GONE);
    mediaSurface.addView(video, new FrameLayout.LayoutParams(-1, -1));
    root.addView(mediaSurface, new FrameLayout.LayoutParams(-1, -1));
    root.post(() -> {
      int horizontalInset = Math.max(8, Math.round(root.getWidth() * SAFE_HORIZONTAL_INSET_RATIO));
      FrameLayout.LayoutParams mediaLayout = (FrameLayout.LayoutParams) mediaSurface.getLayoutParams();
      mediaLayout.setMargins(horizontalInset, 0, horizontalInset, 0);
      mediaSurface.setLayoutParams(mediaLayout);
    });
    status = label("Pixelium Player — connexion…");
    status.setBackgroundColor(0xAA000000);
    status.setVisibility(View.GONE);
    root.addView(status, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
    setContentView(root);
    remotePaused = getSharedPreferences("player", 0).getBoolean("remotePaused", false);

    video.setOnPreparedListener(this::onVideoPrepared);
    video.setOnCompletionListener(player -> playNext());
    video.setOnErrorListener((player, what, extra) -> {
      pendingVideoMedia = null;
      String detail = "Décodage vidéo impossible (" + what + "/" + extra + ")";
      if (preparingCandidate && candidatePublicationId != null) failCandidate(detail);
      else {
        ui(detail + " — conservation du dernier contenu valide");
        handler.postDelayed(this::playNext, 5000);
      }
      return true;
    });

    playCached();
    heartbeat();
  }

  void onVideoPrepared(MediaPlayer player) {
    int count = preparingCandidate && candidateItems != null ? candidateItems.length() : items.length();
    player.setLooping(count == 1);
    markCurrentMedia(pendingVideoMedia);
    pendingVideoMedia = null;
    if (!remotePaused) video.start();
    if (preparingCandidate) activateCandidate();
    ui("Lecture Pixelium — vidéo compatible active");
  }

  void heartbeat() {
    new Thread(() -> {
      boolean retry = true;
      try {
        JSONObject request = new JSONObject()
          .put("appVersion", APP_VERSION)
          .put("diagnostics", new JSONObject()
            .put("android", Build.VERSION.RELEASE)
            .put("model", Build.MODEL)
            .put("freeBytes", mediaCache.getFreeSpace()));
        JSONObject response = jsonRequest(server + "/api/signage/player/heartbeat", "POST", request);
        JSONObject publication = response.optJSONObject("publication");
        if (publication != null) {
          try {
            syncPublication(publication);
          } catch (Exception error) {
            acknowledge(publication.optString("id"), "failed", error.getMessage());
            throw error;
          }
        } else {
          ui("Player connecté — lecture du contenu actif");
        }
      } catch (Exception error) {
        if (String.valueOf(error.getMessage()).contains("HTTP 401")) {
          retry = false;
          getSharedPreferences("player", 0).edit().remove("token").apply();
          token = "";
          ui("Jeton refusé — retour à l’association");
          handler.postDelayed(this::showSetup, 2000);
        } else {
          ui("Hors connexion — lecture du dernier contenu valide");
          playCached();
        }
      } finally {
        if (retry) handler.postDelayed(this::heartbeat, 30000);
      }
    }).start();
  }

  void syncPublication(JSONObject publication) throws Exception {
    JSONObject manifest = publication.getJSONObject("manifest");
    JSONArray incoming = manifest.optJSONArray("items");
    if (incoming == null || incoming.length() == 0) throw new IOException("Playlist vide");
    ui("Téléchargement et vérification du nouveau contenu…");
    JSONArray ready = new JSONArray();
    for (int index = 0; index < incoming.length(); index++) {
      JSONObject item = incoming.getJSONObject(index);
      JSONObject media = item.optJSONObject("media");
      if (media == null) throw new IOException("Média absent du manifeste");
      String id = media.getString("id");
      String url = media.optString("url");
      String name = media.optString("name", id + ".mp4");
      String extension = name.contains(".") ? name.substring(name.lastIndexOf('.')) : ".mp4";
      File target = new File(mediaCache, id + extension);
      String expectedChecksum = media.optString("checksum_sha256");
      if (!target.exists() || (!expectedChecksum.isEmpty() && !expectedChecksum.equalsIgnoreCase(sha256(target)))) {
        File temporary = new File(mediaCache, id + ".part");
        download(url, temporary);
        if (!expectedChecksum.isEmpty() && !expectedChecksum.equalsIgnoreCase(sha256(temporary))) {
          temporary.delete();
          throw new IOException("Contrôle d’intégrité du média échoué");
        }
        if (target.exists()) target.delete();
        if (!temporary.renameTo(target)) throw new IOException("Activation du cache impossible");
      }
      item.put("localPath", target.getAbsolutePath());
      ready.put(item);
    }
    candidateItems = ready;
    candidatePublicationId = publication.getString("id");
    handler.post(this::playCandidate);
  }

  void playCandidate() {
    if (candidateItems == null || candidateItems.length() == 0) {
      failCandidate("Playlist préparée vide");
      return;
    }
    try {
      preparingCandidate = true;
      displayItem(candidateItems.getJSONObject(0), true);
    } catch (Exception error) {
      failCandidate(error.getMessage());
    }
  }

  void activateCandidate() {
    if (candidateItems == null || candidatePublicationId == null) return;
    String publicationId = candidatePublicationId;
    items = candidateItems;
    itemIndex = items.length() > 1 ? 1 : 0;
    getSharedPreferences("player", 0).edit().putString("playlist", items.toString()).apply();
    candidateItems = null;
    candidatePublicationId = null;
    preparingCandidate = false;
    new Thread(() -> acknowledge(publicationId, "active", "")).start();
  }

  void failCandidate(String reason) {
    String publicationId = candidatePublicationId;
    candidateItems = null;
    candidatePublicationId = null;
    preparingCandidate = false;
    ui("Diffusion refusée — " + String.valueOf(reason));
    if (publicationId != null) new Thread(() -> acknowledge(publicationId, "failed", reason)).start();
    handler.postDelayed(this::playCached, 1500);
  }

  void acknowledge(String publicationId, String state, String error) {
    if (publicationId == null || publicationId.isEmpty()) return;
    try {
      jsonRequest(server + "/api/signage/player/publications/" + publicationId + "/ack", "POST",
        new JSONObject().put("status", state).put("error", error == null ? "" : error));
    } catch (Exception ignored) {}
  }

  void download(String source, File target) throws Exception {
    if (source == null || source.isEmpty()) throw new IOException("Lien de téléchargement absent");
    HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
    connection.setConnectTimeout(15000);
    connection.setReadTimeout(90000);
    int responseCode = connection.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      connection.disconnect();
      throw new IOException("Téléchargement refusé (HTTP " + responseCode + ")");
    }
    try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    } finally {
      connection.disconnect();
    }
  }

  String sha256(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream input = new FileInputStream(file)) {
      byte[] buffer = new byte[65536];
      int count;
      while ((count = input.read(buffer)) > 0) digest.update(buffer, 0, count);
    }
    StringBuilder result = new StringBuilder();
    for (byte value : digest.digest()) result.append(String.format("%02x", value));
    return result.toString();
  }

  void playCached() {
    if (remotePaused) {
      ui("Lecture suspendue à distance");
      return;
    }
    try {
      String raw = getSharedPreferences("player", 0).getString("playlist", "[]");
      JSONArray cached = new JSONArray(raw);
      if (cached.length() == 0) return;
      items = cached;
      itemIndex = 0;
      preparingCandidate = false;
      handler.post(this::playNext);
    } catch (Exception ignored) {}
  }

  void playNext() {
    if (remotePaused) {
      ui("Lecture suspendue à distance");
      return;
    }
    if (items.length() == 0) return;
    try {
      JSONObject item = items.getJSONObject(itemIndex++ % items.length());
      displayItem(item, false);
    } catch (Exception error) {
      ui("Contenu local invalide — passage au suivant");
      handler.postDelayed(this::playNext, 3000);
    }
  }

  void displayItem(JSONObject item, boolean candidate) throws Exception {
    if (imageAdvance != null) handler.removeCallbacks(imageAdvance);
    JSONObject media = item.optJSONObject("media");
    String mimeType = media == null ? "" : media.optString("mime_type");
    String localPath = item.optString("localPath");
    if (localPath.isEmpty()) throw new IOException("Chemin local absent");
    File file = new File(localPath);
    boolean imageMedia = mimeType.startsWith("image/") || localPath.matches("(?i).*\\.(png|jpe?g|webp|bmp)$");
    if (imageMedia) {
      Bitmap bitmap = BitmapFactory.decodeFile(file.getAbsolutePath());
      if (bitmap == null) throw new IOException("Image impossible à décoder");
      video.stopPlayback();
      pendingVideoMedia = null;
      video.setVisibility(View.GONE);
      image.setImageBitmap(bitmap);
      image.setVisibility(View.VISIBLE);
      markCurrentMedia(media);
      if (candidate) activateCandidate();
      ui("Lecture Pixelium — image locale active");
      int duration = Math.max(3, item.optInt("durationSeconds", 15));
      imageAdvance = this::playNext;
      handler.postDelayed(imageAdvance, duration * 1000L);
      return;
    }
    image.setVisibility(View.GONE);
    video.setVisibility(View.VISIBLE);
    preparingCandidate = candidate;
    pendingVideoMedia = media;
    video.setVideoURI(Uri.fromFile(file));
    video.requestFocus();
    video.start();
  }

  void markCurrentMedia(JSONObject media) {
    if (media == null) return;
    currentMediaId = media.optString("id", "");
    currentMediaName = media.optString("name", "");
    currentMediaMimeType = media.optString("mime_type", "");
    currentMediaUploadedAt = media.optString("created_at", media.optString("uploaded_at", ""));
    currentMediaStartedAt = System.currentTimeMillis();
  }

  void clearCurrentMedia() {
    pendingVideoMedia = null;
    currentMediaId = "";
    currentMediaName = "";
    currentMediaMimeType = "";
    currentMediaUploadedAt = "";
    currentMediaStartedAt = 0L;
  }

  void ui(String text) {
    handler.post(() -> {
      if (status != null) status.setText(text);
    });
  }

  void processRemoteCommand() {
    try {
      JSONObject response = jsonRequest(server + "/api/signage/player/commands/next", "POST", new JSONObject());
      JSONObject command = response.optJSONObject("command");
      if (command == null) return;
      String commandId = command.optString("id", "");
      JSONObject result;
      try {
        result = applyRemoteCommand(command.optString("command", ""), command.optJSONObject("payload"));
        acknowledgeRemoteCommand(commandId, "succeeded", result);
      } catch (Exception error) {
        acknowledgeRemoteCommand(commandId, "failed", new JSONObject().put("error", error.getMessage()));
      }
    } catch (Exception ignored) {}
  }

  JSONObject applyRemoteCommand(String command, JSONObject payload) throws Exception {
    JSONObject input = payload == null ? new JSONObject() : payload;
    JSONObject result = new JSONObject().put("command", command).put("acceptedAt", System.currentTimeMillis());
    switch (command) {
      case "pause_playback":
        remotePaused = true;
        getSharedPreferences("player", 0).edit().putBoolean("remotePaused", true).apply();
        handler.post(() -> {
          if (imageAdvance != null) handler.removeCallbacks(imageAdvance);
          try { if (video != null) video.pause(); } catch (Exception ignored) {}
          ui("Lecture suspendue depuis le cockpit");
        });
        return result.put("paused", true);
      case "resume_playback":
        remotePaused = false;
        getSharedPreferences("player", 0).edit().putBoolean("remotePaused", false).apply();
        handler.post(this::playCached);
        return result.put("paused", false);
      case "reload_content":
        handler.post(this::playCached);
        return result.put("reloaded", true);
      case "restart_player":
        acknowledgeRestartScheduled(result);
        return result.put("restartScheduled", true);
      case "set_volume": {
        int percent = Math.max(0, Math.min(100, input.optInt("percent", 50)));
        AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        if (audio == null) throw new IOException("Contrôle audio indisponible");
        int maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, Math.round(maximum * percent / 100f), 0);
        return result.put("volumePercent", percent);
      }
      case "set_brightness": {
        int percent = Math.max(5, Math.min(100, input.optInt("percent", 100)));
        handler.post(() -> {
          WindowManager.LayoutParams attributes = getWindow().getAttributes();
          attributes.screenBrightness = percent / 100f;
          getWindow().setAttributes(attributes);
        });
        return result.put("brightnessPercent", percent).put("scope", "player_window");
      }
      case "set_orientation": {
        String orientation = input.optString("orientation", "landscape");
        int requested = orientation.equals("portrait") ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
          : orientation.equals("sensor") ? ActivityInfo.SCREEN_ORIENTATION_SENSOR
          : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        handler.post(() -> setRequestedOrientation(requested));
        return result.put("orientation", orientation);
      }
      case "set_display_mode":
        return applyDisplayMode(input, result);
      case "update_now":
        PlayerUpdateManager.checkForUpdate(this, server, ScheduledMainActivity.SCHEDULED_APP_VERSION);
        return result.put("updateCheckStarted", true);
      default:
        throw new IOException("Commande non prise en charge par cette version du Player");
    }
  }

  JSONObject applyDisplayMode(JSONObject input, JSONObject result) throws Exception {
    if (Build.VERSION.SDK_INT < 23) throw new IOException("Changement de mode HDMI non pris en charge par Android");
    int width = input.optInt("width", 0), height = input.optInt("height", 0);
    double refresh = input.optDouble("refreshRate", 0);
    Display display = getWindowManager().getDefaultDisplay();
    Display.Mode selected = null;
    for (Display.Mode mode : display.getSupportedModes()) {
      if (mode.getPhysicalWidth() == width && mode.getPhysicalHeight() == height
        && Math.abs(mode.getRefreshRate() - refresh) < 0.6) { selected = mode; break; }
    }
    if (selected == null) throw new IOException("Mode HDMI non annoncé par le matériel");
    final int modeId = selected.getModeId();
    handler.post(() -> {
      WindowManager.LayoutParams attributes = getWindow().getAttributes();
      attributes.preferredDisplayModeId = modeId;
      getWindow().setAttributes(attributes);
    });
    return result.put("modeId", modeId).put("width", width).put("height", height).put("refreshRate", refresh);
  }

  void acknowledgeRestartScheduled(JSONObject result) {
    handler.postDelayed(() -> {
      Intent launch = new Intent(this, ScheduledMainActivity.class)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_CLEAR_TASK);
      startActivity(launch);
      finish();
    }, 1500L);
  }

  void acknowledgeRemoteCommand(String commandId, String state, JSONObject result) {
    if (commandId == null || commandId.isEmpty()) return;
    try {
      jsonRequest(server + "/api/signage/player/commands/" + commandId + "/ack", "POST",
        new JSONObject().put("status", state).put("result", result == null ? new JSONObject() : result));
    } catch (Exception ignored) {}
  }

  JSONObject jsonRequest(String target, String method, JSONObject body) throws Exception {
    HttpURLConnection connection = (HttpURLConnection) new URL(target).openConnection();
    connection.setRequestMethod(method);
    connection.setConnectTimeout(10000);
    connection.setReadTimeout(30000);
    connection.setRequestProperty("Authorization", "Bearer " + token);
    connection.setRequestProperty("Content-Type", "application/json");
    connection.setDoOutput(true);
    try (OutputStream output = connection.getOutputStream()) {
      output.write(body.toString().getBytes(StandardCharsets.UTF_8));
    }
    int responseCode = connection.getResponseCode();
    InputStream input = responseCode < 400 ? connection.getInputStream() : connection.getErrorStream();
    String text = new String(readAll(input), StandardCharsets.UTF_8);
    connection.disconnect();
    if (responseCode >= 400) throw new IOException("HTTP " + responseCode + " " + text);
    return new JSONObject(text);
  }

  byte[] readAll(InputStream input) throws IOException {
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int count;
    while ((count = input.read(buffer)) > 0) output.write(buffer, 0, count);
    return output.toByteArray();
  }
}
