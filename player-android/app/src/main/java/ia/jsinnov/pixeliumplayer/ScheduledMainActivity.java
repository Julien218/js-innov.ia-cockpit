package ia.jsinnov.pixeliumplayer;

import android.content.SharedPreferences;
import android.os.Build;
import android.view.View;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public class ScheduledMainActivity extends MainActivity {
  static final String SCHEDULED_APP_VERSION = "0.5.1-pilot";
  static final String PREF_ADS_BLOCKED = "adsBlocked";
  static final String PREF_BLOCK_REASON = "adsBlockReason";
  static final String PREF_NEXT_CHANGE_AT = "adsNextChangeAt";

  boolean adsBlocked;

  @Override void showPlayer() {
    super.showPlayer();
    adsBlocked = cachedBlockStillActive();
    if (adsBlocked) blockAdvertising(cachedBlockReason(), cachedNextChangeAt());
  }

  JSONObject playbackTelemetry() {
    JSONObject playback = new JSONObject();
    try {
      boolean videoPlaying = video != null && video.isPlaying();
      boolean imageVisible = image != null && image.getVisibility() == View.VISIBLE;
      playback.put("videoPlaying", videoPlaying);
      playback.put("imageVisible", imageVisible);
      playback.put("contentPlaying", videoPlaying || imageVisible);
      playback.put("cachedItems", items == null ? 0 : items.length());
      playback.put("preparingPublication", preparingCandidate);
      playback.put("candidatePublicationId", candidatePublicationId == null ? JSONObject.NULL : candidatePublicationId);
      playback.put("scheduleBlocked", adsBlocked || cachedBlockStillActive());
    } catch (Exception ignored) {}
    return playback;
  }

  @Override void heartbeat() {
    new Thread(() -> {
      boolean retry = true;
      try {
        JSONObject diagnostics = new JSONObject()
          .put("android", Build.VERSION.RELEASE)
          .put("model", Build.MODEL)
          .put("freeBytes", mediaCache.getFreeSpace())
          .put("scheduleAware", true)
          .put("displayTelemetryVersion", 1)
          .put("device", DisplayTelemetry.device())
          .put("display", DisplayTelemetry.display(this))
          .put("playback", playbackTelemetry())
          .put("updater", PlayerUpdateManager.telemetry(this));
        JSONObject request = new JSONObject()
          .put("appVersion", SCHEDULED_APP_VERSION)
          .put("diagnostics", diagnostics);

        JSONObject response = jsonRequest(server + "/api/signage/player/heartbeat", "POST", request);
        PlayerUpdateManager.checkForUpdate(this, server, SCHEDULED_APP_VERSION);

        boolean allowed = response.optBoolean("adsAllowed", true);
        String reason = response.optString("reason", allowed ? "allowed" : "blocked");
        String nextChangeAt = response.optString("nextChangeAt", "");
        boolean wasBlocked = adsBlocked || cachedBlockStillActive();

        if (!allowed) {
          blockAdvertising(reason, nextChangeAt);
        } else {
          clearScheduleBlock();
          JSONObject publication = response.optJSONObject("publication");
          if (publication != null) {
            try {
              syncPublication(publication);
            } catch (Exception error) {
              acknowledge(publication.optString("id"), "failed", error.getMessage());
              throw error;
            }
          } else if (wasBlocked) {
            ui("Plage publicitaire autorisée — reprise du contenu local");
            super.playCached();
          } else {
            ui("Player connecté — lecture du contenu actif");
          }
        }
      } catch (Exception error) {
        if (String.valueOf(error.getMessage()).contains("HTTP 401")) {
          retry = false;
          getSharedPreferences("player", 0).edit().remove("token").apply();
          token = "";
          ui("Jeton refusé — retour à l’association");
          handler.postDelayed(this::showSetup, 2000);
        } else if (cachedBlockStillActive()) {
          adsBlocked = true;
          blockAdvertising(cachedBlockReason(), cachedNextChangeAt());
          ui("Hors connexion — publicité suspendue selon le dernier calendrier reçu");
        } else {
          adsBlocked = false;
          ui("Hors connexion — lecture du dernier contenu valide");
          super.playCached();
        }
      } finally {
        if (retry) handler.postDelayed(this::heartbeat, 30000);
      }
    }).start();
  }

  @Override void playCached() {
    if (cachedBlockStillActive()) {
      adsBlocked = true;
      blockAdvertising(cachedBlockReason(), cachedNextChangeAt());
      return;
    }
    adsBlocked = false;
    super.playCached();
  }

  @Override void playNext() {
    if (adsBlocked || cachedBlockStillActive()) {
      blockAdvertising(cachedBlockReason(), cachedNextChangeAt());
      return;
    }
    super.playNext();
  }

  void blockAdvertising(String reason, String nextChangeAt) {
    adsBlocked = true;
    persistScheduleBlock(reason, nextChangeAt);
    handler.post(() -> {
      if (imageAdvance != null) {
        handler.removeCallbacks(imageAdvance);
        imageAdvance = null;
      }
      preparingCandidate = false;
      candidateItems = null;
      candidatePublicationId = null;
      try { if (video != null) video.stopPlayback(); } catch (Exception ignored) {}
      if (video != null) video.setVisibility(View.GONE);
      if (image != null) {
        image.setImageDrawable(null);
        image.setVisibility(View.GONE);
      }
      if (status != null) {
        String label = friendlyReason(reason);
        status.setText(nextChangeAt == null || nextChangeAt.isEmpty()
          ? "Publicités suspendues — " + label
          : "Publicités suspendues — " + label + " — reprise prévue automatiquement");
      }
    });
  }

  void persistScheduleBlock(String reason, String nextChangeAt) {
    getSharedPreferences("player", 0).edit()
      .putBoolean(PREF_ADS_BLOCKED, true)
      .putString(PREF_BLOCK_REASON, reason == null ? "blocked" : reason)
      .putString(PREF_NEXT_CHANGE_AT, nextChangeAt == null ? "" : nextChangeAt)
      .apply();
  }

  void clearScheduleBlock() {
    adsBlocked = false;
    getSharedPreferences("player", 0).edit()
      .putBoolean(PREF_ADS_BLOCKED, false)
      .remove(PREF_BLOCK_REASON)
      .remove(PREF_NEXT_CHANGE_AT)
      .apply();
  }

  boolean cachedBlockStillActive() {
    SharedPreferences prefs = getSharedPreferences("player", 0);
    if (!prefs.getBoolean(PREF_ADS_BLOCKED, false)) return false;
    String next = prefs.getString(PREF_NEXT_CHANGE_AT, "");
    if (next == null || next.isEmpty()) return true;
    try {
      SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSX", Locale.US);
      parser.setTimeZone(TimeZone.getTimeZone("UTC"));
      Date parsed = parser.parse(next);
      return parsed == null || parsed.getTime() > System.currentTimeMillis();
    } catch (Exception ignored) {
      return true;
    }
  }

  String cachedBlockReason() {
    return getSharedPreferences("player", 0).getString(PREF_BLOCK_REASON, "blocked");
  }

  String cachedNextChangeAt() {
    return getSharedPreferences("player", 0).getString(PREF_NEXT_CHANGE_AT, "");
  }

  String friendlyReason(String reason) {
    if (reason == null) return "calendrier";
    if (reason.startsWith("belgian_holiday:")) return "jour férié belge";
    if (reason.equals("date_exception_closed")) return "fermeture exceptionnelle";
    if (reason.equals("outside_date_exception_hours")) return "hors horaires exceptionnels";
    if (reason.equals("outside_weekly_schedule")) return "hors horaires programmés";
    if (reason.equals("schedule_error")) return "sécurité calendrier";
    return "calendrier";
  }
}
