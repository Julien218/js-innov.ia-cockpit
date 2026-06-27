import { useState, useRef, useEffect } from "react";
import { Download, Play, Film, Loader2, CheckCircle, AlertCircle, X } from "lucide-react";

// ─── Palette ────────────────────────────────────────────────────────────────
const C = {
  bg:      "#0a0a1a",
  accent:  "#f5c842",
  accent2: "#ff3366",
  white:   "#ffffff",
  muted:   "#aaaacc",
  dour:    "#1a3a6e",
  grad1:   "#1a3a6e",
  grad2:   "#0f1f40",
};

const W = 1080;
const H = 1920;
const FPS = 30;

// ─── Helpers ────────────────────────────────────────────────────────────────
function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawQRPlaceholder(ctx, cx, cy, size) {
  const s = size;
  const x = cx - s / 2;
  const y = cy - s / 2;
  const cell = s / 21;

  ctx.fillStyle = "#ffffff";
  drawRoundRect(ctx, x - 12, y - 12, s + 24, s + 24, 16);
  ctx.fill();

  ctx.fillStyle = "#111111";
  // Outer frame
  for (let i = 0; i < 21; i++) {
    for (let j = 0; j < 21; j++) {
      const isEdgeBlock =
        (i < 7 && j < 7) ||
        (i < 7 && j > 13) ||
        (i > 13 && j < 7);
      if (isEdgeBlock) {
        const inInner =
          (i >= 2 && i <= 4 && j >= 2 && j <= 4) ||
          (i >= 2 && i <= 4 && j >= 15 && j <= 17) ||
          (i >= 15 && i <= 17 && j >= 2 && j <= 4);
        if (
          i === 0 || i === 6 || j === 0 || j === 6 ||
          i === 14 || i === 20 || j === 14 || j === 20 ||
          inInner
        ) {
          ctx.fillRect(x + j * cell, y + i * cell, cell - 1, cell - 1);
        }
      } else if (Math.random() > 0.55) {
        ctx.fillRect(x + j * cell, y + i * cell, cell - 1, cell - 1);
      }
    }
  }
}

// ─── Scene renderers ────────────────────────────────────────────────────────

function drawBackground(ctx, t, variant = 0) {
  // Animated gradient background
  const phase = t * 0.3;
  const grd = ctx.createLinearGradient(0, 0, W * Math.sin(phase) * 0.4 + W * 0.5, H);
  if (variant === 0) {
    grd.addColorStop(0, "#0a0a1a");
    grd.addColorStop(0.5, "#0f1f40");
    grd.addColorStop(1, "#1a0a2e");
  } else if (variant === 1) {
    grd.addColorStop(0, "#1a3a6e");
    grd.addColorStop(1, "#0a0a1a");
  } else {
    grd.addColorStop(0, "#0a0a1a");
    grd.addColorStop(0.6, "#1a1a2e");
    grd.addColorStop(1, "#0f1f40");
  }
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

function drawParticles(ctx, t, count = 30, color = C.accent) {
  for (let i = 0; i < count; i++) {
    const seed = i * 137.5;
    const x = (Math.sin(seed) * 0.5 + 0.5) * W;
    const y = ((Math.cos(seed * 0.7 + t * 0.5) * 0.5 + 0.5) * H + t * 40 * (i % 3 + 1)) % H;
    const size = 2 + (i % 4);
    const alpha = (Math.sin(t * 2 + seed) * 0.3 + 0.4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = i % 3 === 0 ? C.accent : i % 3 === 1 ? C.accent2 : "#88aaff";
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawGrid(ctx, t) {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 1;
  const spacing = 80;
  const offsetY = (t * 30) % spacing;
  for (let y = -spacing + offsetY; y < H + spacing; y += spacing) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let x = 0; x < W; x += spacing) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.restore();
}

function drawGlitchBars(ctx, t) {
  if (Math.sin(t * 7) > 0.85) {
    const n = Math.floor(Math.random() * 4) + 1;
    for (let i = 0; i < n; i++) {
      const y = Math.random() * H;
      const h = 2 + Math.random() * 8;
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = C.accent2;
      ctx.fillRect(0, y, W, h);
      ctx.restore();
    }
  }
}

function drawBoldText(ctx, text, x, y, size, color, alpha = 1, shadow = true) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = `900 ${size}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.9)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 3;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawAccentText(ctx, text, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = `800 ${size}px 'Arial Black', Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Stroke
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 3;
  ctx.fillStyle = C.white;
  ctx.shadowColor = C.accent;
  ctx.shadowBlur = 30;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawSubtitle(ctx, text, y, alpha = 1) {
  if (!text) return;
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  // Background pill
  ctx.font = `bold 42px Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const pad = 30;
  ctx.fillStyle = "rgba(0,0,0,0.7)";
  drawRoundRect(ctx, W / 2 - tw / 2 - pad, y - 30, tw + pad * 2, 64, 12);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, y + 2);
  ctx.restore();
}

function drawPill(ctx, text, cx, cy, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.font = `bold 36px Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  const pad = 28;
  const h = 56;
  ctx.fillStyle = C.accent;
  drawRoundRect(ctx, cx - tw / 2 - pad, cy - h / 2, tw + pad * 2, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function drawLogo(ctx, cx, cy, scale = 1, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha, 0, 1);
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);

  // Circle backdrop
  ctx.beginPath();
  ctx.arc(0, 0, 120, 0, Math.PI * 2);
  ctx.fillStyle = C.dour;
  ctx.fill();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Tower icon
  ctx.fillStyle = C.white;
  ctx.fillRect(-20, -50, 40, 80);
  ctx.fillRect(-40, 20, 80, 12);
  ctx.fillRect(-10, -80, 20, 32);

  // Windows
  ctx.fillStyle = C.accent;
  ctx.fillRect(-10, -40, 8, 10);
  ctx.fillRect(3, -40, 8, 10);
  ctx.fillRect(-10, -20, 8, 10);
  ctx.fillRect(3, -20, 8, 10);

  // Text below
  ctx.fillStyle = C.white;
  ctx.font = `bold 28px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("TOUR DE DOUR", 0, 110);

  ctx.restore();
}

function drawCityBg(ctx, t, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = clamp(alpha * 0.3, 0, 1);
  // Stylized buildings silhouette
  const buildings = [
    { x: 0,   w: 120, h: 400 },
    { x: 110, w: 80,  h: 300 },
    { x: 180, w: 140, h: 500 },
    { x: 310, w: 100, h: 350 },
    { x: 400, w: 160, h: 450 },
    { x: 550, w: 90,  h: 380 },
    { x: 630, w: 130, h: 420 },
    { x: 750, w: 110, h: 320 },
    { x: 850, w: 150, h: 480 },
    { x: 990, w: 90,  h: 360 },
  ];
  ctx.fillStyle = "#1a2a4a";
  for (const b of buildings) {
    ctx.fillRect(b.x, H - b.h, b.w, b.h);
    // windows
    ctx.fillStyle = C.accent;
    for (let wy = H - b.h + 20; wy < H - 20; wy += 40) {
      for (let wx = b.x + 10; wx < b.x + b.w - 10; wx += 25) {
        if (Math.sin(wx * 3.7 + wy * 1.3 + t) > 0) {
          ctx.fillRect(wx, wy, 10, 14);
        }
      }
    }
    ctx.fillStyle = "#1a2a4a";
  }
  ctx.restore();
}

// ─── Scene-by-scene frame renderer ──────────────────────────────────────────

function renderFrame(ctx, t) {
  // t = seconds
  const p = (a, b) => clamp((t - a) / (b - a), 0, 1); // local progress
  const pe = (a, b) => ease(p(a, b));

  // Clear
  ctx.clearRect(0, 0, W, H);

  // ── SCENE 1: HOOK (0–3s) ────────────────────────────────────────────────
  if (t < 3) {
    const lp = p(0, 3);
    drawBackground(ctx, t, 0);
    drawGrid(ctx, t);
    drawCityBg(ctx, t, 1);
    drawParticles(ctx, t, 25);
    drawGlitchBars(ctx, t);

    // Flash cuts every 0.5s
    const flashCycle = (t % 0.5) / 0.5;
    if (flashCycle < 0.1) {
      ctx.save();
      ctx.globalAlpha = 0.3 * (1 - flashCycle / 0.1);
      ctx.fillStyle = C.accent;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Main text — bouncing in
    const textScale = lp < 0.15 ? ease(lp / 0.15) : 1;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 60);
    ctx.scale(textScale, textScale);
    drawBoldText(ctx, "Et si la mascotte", 0, -110, 88, C.white);
    drawBoldText(ctx, "de Dour venait", 0, 0, 88, C.white);
    drawBoldText(ctx, "de", 0, 110, 88, C.white);
    drawAccentText(ctx, "VOUS ?", 0, 210, 110);
    ctx.restore();

    // Bottom pill
    drawPill(ctx, "🎭 DOUR", W / 2, H - 200, pe(0.3, 0.8));
    drawSubtitle(ctx, "Et si la mascotte de Dour venait de VOUS ?", H - 120, pe(0.3, 0.8));
  }

  // ── SCENE 2: LOGO INTRO (3–5s) ──────────────────────────────────────────
  else if (t < 5) {
    const lp = p(3, 5);
    drawBackground(ctx, t, 1);
    drawParticles(ctx, t, 15);

    // Logo spinning in
    const logoScale = ease(clamp(lp * 3, 0, 1));
    const logoAlpha = clamp(lp * 4, 0, 1) * (lp > 0.9 ? (1 - lp) * 10 : 1);
    drawLogo(ctx, W / 2, H / 2, logoScale * 1.5, logoAlpha);

    // Rotating ring
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(lp * Math.PI * 3);
    ctx.globalAlpha = 0.5 * logoAlpha;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.setLineDash([30, 20]);
    ctx.beginPath();
    ctx.arc(0, 0, 200, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    drawSubtitle(ctx, "Tour de Dour", H - 120, logoAlpha);
  }

  // ── SCENE 3: MAIN CONTENT (5–20s) ────────────────────────────────────────
  else if (t < 20) {
    const lp = p(5, 20);
    drawBackground(ctx, t, 2);
    drawGrid(ctx, t * 0.5);
    drawCityBg(ctx, t, 0.8);
    drawParticles(ctx, t, 20);

    // Fast-cut effect every 1.5s
    const cutPhase = t % 1.5;
    const cutIn = cutPhase < 0.08 ? (1 - cutPhase / 0.08) : 0;
    if (cutIn > 0) {
      ctx.save();
      ctx.globalAlpha = cutIn * 0.4;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // 3 text messages cycling
    const msgDur = 5;
    const msgs = [
      { text: "On crée une mascotte\npour Dour.", sub: "On crée une mascotte pour Dour.", start: 5 },
      { text: "Et ton avis\ncompte vraiment.", sub: "Et ton avis compte vraiment.", start: 10 },
      { text: "Réponds au\nquestionnaire\nen 1 minute.", sub: "Réponds au questionnaire en 1 minute.", start: 15 },
    ];

    const cur = msgs.find((m, i) => {
      const next = msgs[i + 1];
      return t >= m.start && (next ? t < next.start : t < 20);
    });

    if (cur) {
      const msgP = p(cur.start, cur.start + msgDur);
      const slideIn = ease(clamp(msgP * 5, 0, 1));
      const alpha = msgP < 0.15 ? msgP / 0.15 : msgP > 0.85 ? (1 - msgP) / 0.15 : 1;

      ctx.save();
      ctx.translate(W / 2 + (1 - slideIn) * 120, H / 2 - 100);
      const lines = cur.text.split("\n");
      lines.forEach((line, i) => {
        const isLast = i === lines.length - 1;
        if (isLast && cur.text.includes("1 minute")) {
          drawAccentText(ctx, line, 0, (i - (lines.length - 1) / 2) * 120, 80, alpha);
        } else {
          drawBoldText(ctx, line, 0, (i - (lines.length - 1) / 2) * 120, 80, C.white, alpha);
        }
      });
      ctx.restore();

      drawSubtitle(ctx, cur.sub, H - 120, alpha);

      // Animated underline
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = C.accent;
      const lineW = slideIn * 400;
      ctx.fillRect(W / 2 - lineW / 2, H / 2 + 80, lineW, 4);
      ctx.restore();
    }

    // Smartphone icon animation
    const phoneAlpha = clamp(lp * 3, 0, 1);
    ctx.save();
    ctx.globalAlpha = phoneAlpha * 0.25;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    const ph = { x: W / 2 - 45, y: H - 420, w: 90, h: 150, r: 12 };
    drawRoundRect(ctx, ph.x, ph.y, ph.w, ph.h, ph.r);
    ctx.stroke();
    // Screen
    ctx.fillStyle = C.accent;
    ctx.globalAlpha = phoneAlpha * 0.12;
    drawRoundRect(ctx, ph.x + 5, ph.y + 10, ph.w - 10, ph.h - 25, 8);
    ctx.fill();
    // Home button dot
    ctx.globalAlpha = phoneAlpha * 0.2;
    ctx.beginPath();
    ctx.arc(W / 2, ph.y + ph.h - 10, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── SCENE 4: EMOTIONAL VALUE (20–25s) ────────────────────────────────────
  else if (t < 25) {
    const lp = p(20, 25);
    drawBackground(ctx, t, 0);
    drawParticles(ctx, t, 35, C.accent);

    // Pulse ring
    const pulse = (Math.sin(t * 3) * 0.5 + 0.5);
    ctx.save();
    ctx.globalAlpha = 0.2 * pulse;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 250 + pulse * 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const alpha = lp < 0.1 ? lp / 0.1 : lp > 0.9 ? (1 - lp) / 0.1 : 1;

    // Center star/mascot placeholder
    ctx.save();
    ctx.globalAlpha = alpha * 0.15;
    ctx.font = "200px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🎭", W / 2, H / 2 - 80);
    ctx.restore();

    const slideIn = ease(clamp(lp * 4, 0, 1));
    ctx.save();
    ctx.translate(W / 2, H / 2 + 100 + (1 - slideIn) * 80);
    drawBoldText(ctx, "Ta réponse va", 0, -70, 78, C.white, alpha);
    drawBoldText(ctx, "influencer la", 0, 20, 78, C.white, alpha);
    drawAccentText(ctx, "mascotte officielle.", 0, 120, 72, alpha);
    ctx.restore();

    drawSubtitle(ctx, "Ta réponse va influencer la mascotte officielle.", H - 120, alpha);
  }

  // ── SCENE 5: CALL TO ACTION (25–30s) ─────────────────────────────────────
  else if (t < 30) {
    const lp = p(25, 30);
    drawBackground(ctx, t, 1);
    drawGrid(ctx, t);
    drawParticles(ctx, t, 20);
    drawGlitchBars(ctx, t);

    const alpha = lp < 0.1 ? lp / 0.1 : 1;
    const pulse = (Math.sin(t * 4) * 0.5 + 0.5);

    // CTA text
    ctx.save();
    ctx.translate(W / 2, H / 2 - 300);
    drawBoldText(ctx, "Scanne et", 0, -60, 90, C.white, alpha);
    drawBoldText(ctx, "participe", 0, 50, 90, C.white, alpha);
    drawAccentText(ctx, "maintenant !", 0, 160, 90, alpha);
    ctx.restore();

    // QR Code
    const qrScale = ease(clamp(lp * 3, 0, 1));
    ctx.save();
    ctx.translate(W / 2, H / 2 + 130);
    ctx.scale(qrScale, qrScale);
    drawQRPlaceholder(ctx, 0, 0, 280);
    // Pulsing border around QR
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 4 + pulse * 3;
    ctx.globalAlpha = 0.6 + pulse * 0.4;
    drawRoundRect(ctx, -154, -154, 308, 308, 20);
    ctx.stroke();
    ctx.restore();

    // Arrow pointing to QR
    ctx.save();
    ctx.globalAlpha = alpha * (0.6 + pulse * 0.4);
    ctx.fillStyle = C.accent;
    ctx.font = "bold 48px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("👆 QR code", W / 2, H / 2 + 320);
    ctx.restore();

    drawSubtitle(ctx, "Scanne et participe maintenant !", H - 120, alpha);
  }

  // ── SCENE 6: OUTRO TOUR DE DOUR (30–33s) ─────────────────────────────────
  else if (t < 33) {
    const lp = p(30, 33);
    drawBackground(ctx, t, 1);
    drawParticles(ctx, t, 20);

    // Confetti-like burst at start
    if (lp < 0.3) {
      const burst = lp / 0.3;
      for (let i = 0; i < 30; i++) {
        const angle = (i / 30) * Math.PI * 2;
        const r = burst * 400;
        const cx = W / 2 + Math.cos(angle) * r;
        const cy = H / 2 + Math.sin(angle) * r;
        ctx.save();
        ctx.globalAlpha = (1 - burst) * 0.7;
        ctx.fillStyle = i % 2 === 0 ? C.accent : C.accent2;
        ctx.fillRect(cx - 5, cy - 5, 10, 10);
        ctx.restore();
      }
    }

    const alpha = lp < 0.15 ? lp / 0.15 : lp > 0.85 ? (1 - lp) / 0.15 : 1;
    drawLogo(ctx, W / 2, H / 2 - 50, 1.8, alpha);

    drawBoldText(ctx, "tourdedrour.be", W / 2, H / 2 + 250, 52, C.accent, alpha * 0.9);
    drawSubtitle(ctx, "Tour de Dour — Ensemble, créons la mascotte !", H - 120, alpha);
  }

  // ── SCENE 7: BRAND SCREEN (33–40s) ───────────────────────────────────────
  else {
    const lp = p(33, 40);
    drawBackground(ctx, t, 0);
    drawGrid(ctx, t * 0.3);
    drawParticles(ctx, t, 12, "#4488ff");

    const alpha = lp < 0.08 ? lp / 0.08 : lp > 0.92 ? (1 - lp) / 0.08 : 1;

    // Central divider line (animated)
    const lineW = ease(clamp(lp * 5, 0, 1)) * 500;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.accent;
    ctx.fillRect(W / 2 - lineW / 2, H / 2 - 180, lineW, 2);
    ctx.fillRect(W / 2 - lineW / 2, H / 2 + 100, lineW, 2);
    ctx.restore();

    // Brand text stack
    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Tech Ecosystem
    ctx.font = "600 42px Arial, sans-serif";
    ctx.fillStyle = C.muted;
    ctx.fillText("Tech Ecosystem", W / 2, H / 2 - 280);

    // JS-Innov.IA
    ctx.font = `900 110px 'Arial Black', Arial, sans-serif`;
    ctx.fillStyle = C.white;
    ctx.shadowColor = C.accent;
    ctx.shadowBlur = 30;
    ctx.fillText("JS-Innov", W / 2, H / 2 - 130);
    ctx.fillStyle = C.accent;
    ctx.fillText(".IA®", W / 2, H / 2 - 10);
    ctx.shadowBlur = 0;

    // Tagline
    ctx.font = "italic 36px Georgia, serif";
    ctx.fillStyle = C.muted;
    ctx.fillText("When Vision meets Intelligence.", W / 2, H / 2 + 60);

    // Services line
    ctx.font = "500 28px Arial, sans-serif";
    ctx.fillStyle = "#6677aa";
    ctx.fillText("AI Creative Direction | Automation Systems", W / 2, H / 2 + 150);
    ctx.fillText("Digital Cinema Engine", W / 2, H / 2 + 190);

    // Contact
    ctx.font = "bold 40px Arial, sans-serif";
    ctx.fillStyle = C.white;
    ctx.fillText("0494 / 11.90.90", W / 2, H / 2 + 290);

    ctx.font = "500 36px Arial, sans-serif";
    ctx.fillStyle = C.accent;
    ctx.fillText("www.jsinnovia.com", W / 2, H / 2 + 360);

    ctx.restore();
  }

  // Global vignette
  const vgrd = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
  vgrd.addColorStop(0, "transparent");
  vgrd.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vgrd;
  ctx.fillRect(0, 0, W, H);
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function DourCampaignVideo() {
  const canvasRef = useRef(null);
  const previewRef = useRef(null);
  const stopRef = useRef(false);
  const blobUrlRef = useRef(null);
  const animRef = useRef(null);
  const startTimeRef = useRef(null);

  const TOTAL_DURATION = 40;

  const [status, setStatus] = useState("idle"); // idle | preview | rendering | done | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [previewT, setPreviewT] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Live preview animation
  useEffect(() => {
    if (status !== "preview" || !isPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    startTimeRef.current = performance.now() - previewT * 1000;

    function frame() {
      const t = (performance.now() - startTimeRef.current) / 1000;
      if (t >= TOTAL_DURATION) {
        setIsPlaying(false);
        setPreviewT(0);
        return;
      }
      setPreviewT(t);
      renderFrame(ctx, t);
      animRef.current = requestAnimationFrame(frame);
    }
    animRef.current = requestAnimationFrame(frame);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [status, isPlaying]);

  // Preview scrub (when not playing)
  useEffect(() => {
    if (status !== "preview" || isPlaying) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    renderFrame(ctx, previewT);
  }, [previewT, status, isPlaying]);

  const handlePreview = () => {
    setStatus("preview");
    setPreviewT(0);
    setIsPlaying(false);
    setTimeout(() => {
      const canvas = previewRef.current;
      if (canvas) renderFrame(canvas.getContext("2d"), 0);
    }, 50);
  };

  const handleExport = async () => {
    stopRef.current = false;
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setStatus("rendering");
    setProgress(0);
    setMessage("Initialisation du rendu…");

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    let stream, recorder, chunks = [];
    try {
      stream = canvas.captureStream(FPS);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9" : "video/webm";
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    } catch {
      setStatus("error");
      setMessage("MediaRecorder non supporté. Utilisez Chrome ou Edge.");
      return;
    }

    recorder.start(200);
    const totalFrames = Math.ceil(TOTAL_DURATION * FPS);
    setMessage(`Rendu ${TOTAL_DURATION}s · ${FPS}fps · 1080×1920…`);

    let lastYield = 0;
    for (let frame = 0; frame < totalFrames; frame++) {
      if (stopRef.current) break;
      renderFrame(ctx, frame / FPS);
      if (frame - lastYield >= FPS) {
        lastYield = frame;
        setProgress(Math.round((frame / totalFrames) * 100));
        await new Promise(r => setTimeout(r, 0));
      }
    }

    recorder.stop();
    await new Promise(r => { recorder.onstop = r; });

    const blob = new Blob(chunks, { type: "video/webm" });
    blobUrlRef.current = URL.createObjectURL(blob);
    setProgress(100);
    setStatus("done");
    setMessage(`Vidéo prête — ${(blob.size / 1024 / 1024).toFixed(1)} MB · 40s`);
  };

  const handleDownload = () => {
    if (!blobUrlRef.current) return;
    const a = document.createElement("a");
    a.href = blobUrlRef.current;
    a.download = "DOUR_MASCOTTE_CAMPAIGN_9x16.webm";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  useEffect(() => () => {
    stopRef.current = true;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <div className="min-h-screen bg-background px-6 py-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Film size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Dour Mascotte — Vidéo Promo</h1>
          <p className="text-sm text-muted-foreground">Vidéo verticale 9:16 · 40 secondes · TikTok / Reels / Shorts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* LEFT: Controls */}
        <div className="space-y-5">
          {/* Scene overview */}
          <div className="card-premium rounded-2xl p-5 space-y-3">
            <h2 className="font-semibold text-foreground text-sm">Structure de la vidéo</h2>
            {[
              { time: "0–3s",   icon: "⚡", label: "Hook", desc: "\"Et si la mascotte de Dour venait de VOUS ?\"" },
              { time: "3–5s",   icon: "🏛️", label: "Logo Tour de Dour", desc: "Animation d'entrée du logo" },
              { time: "5–20s",  icon: "🎭", label: "Contenu principal", desc: "3 messages + visuels ville + smartphone" },
              { time: "20–25s", icon: "💡", label: "Valeur émotionnelle", desc: "\"Ta réponse va influencer la mascotte officielle.\"" },
              { time: "25–30s", icon: "📱", label: "Call to Action", desc: "QR code + \"Scanne et participe maintenant !\"" },
              { time: "30–33s", icon: "🏆", label: "Outro Tour de Dour", desc: "Logo finale + tourdedrour.be" },
              { time: "33–40s", icon: "🤖", label: "Brand JS-Innov.IA", desc: "Écran marque complet avec contact" },
            ].map(s => (
              <div key={s.time} className="flex items-start gap-3">
                <span className="text-lg shrink-0">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{s.label}</span>
                    <span className="text-xs text-muted-foreground">{s.time}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Specs */}
          <div className="card-premium rounded-2xl p-5 space-y-2">
            <h2 className="font-semibold text-foreground text-sm mb-3">Specs techniques</h2>
            {[
              ["Format", "9:16 vertical (1080 × 1920)"],
              ["Durée", "40 secondes"],
              ["FPS", "30 fps"],
              ["Bitrate", "12 Mbps VP9"],
              ["Platforms", "TikTok · Reels · Shorts"],
              ["Rendu", "Canvas navigateur (Chrome/Edge)"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-foreground font-medium">{v}</span>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={handlePreview}
              disabled={status === "rendering"}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-all disabled:opacity-40"
            >
              <Play size={15} /> Prévisualiser en temps réel
            </button>
            <button
              onClick={handleExport}
              disabled={status === "rendering"}
              className="btn-gold w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {status === "rendering" ? <Loader2 size={16} className="animate-spin" /> : <Film size={16} />}
              {status === "rendering" ? `Rendu en cours… ${progress}%` : "Exporter la vidéo WebM"}
            </button>
            {status === "done" && (
              <button onClick={handleDownload} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-medium hover:bg-green-500/20 transition-all">
                <Download size={15} /> {message}
              </button>
            )}
          </div>

          {/* Progress */}
          {status === "rendering" && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{message}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-center text-muted-foreground animate-pulse">🎬 Rendu frame par frame — ne pas fermer l'onglet</p>
              <button onClick={() => { stopRef.current = true; setStatus("idle"); setProgress(0); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded border border-border">
                Annuler
              </button>
            </div>
          )}

          {status === "error" && (
            <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-xl px-4 py-3">
              <AlertCircle size={14} /> {message}
            </div>
          )}

          {status === "done" && (
            <div className="flex items-center gap-2 text-green-400 text-sm bg-green-500/10 rounded-xl px-4 py-3">
              <CheckCircle size={14} /> Export terminé avec succès !
            </div>
          )}
        </div>

        {/* RIGHT: Preview */}
        <div className="space-y-4">
          {status === "preview" ? (
            <div className="flex flex-col items-center gap-4">
              <p className="text-xs text-muted-foreground">Prévisualisation · {previewT.toFixed(1)}s / {TOTAL_DURATION}s</p>
              <div className="rounded-2xl overflow-hidden border border-border shadow-2xl" style={{ width: 270, height: 480 }}>
                <canvas
                  ref={previewRef}
                  width={W}
                  height={H}
                  style={{ width: 270, height: 480, display: "block" }}
                />
              </div>
              {/* Playback controls */}
              <div className="w-full space-y-2">
                <input
                  type="range"
                  min={0}
                  max={TOTAL_DURATION}
                  step={0.1}
                  value={previewT}
                  onChange={e => { setIsPlaying(false); setPreviewT(Number(e.target.value)); }}
                  className="w-full accent-yellow-500"
                />
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setIsPlaying(p => !p)}
                    className="btn-gold px-6 py-2 rounded-xl text-sm flex items-center gap-2"
                  >
                    {isPlaying ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button onClick={() => { setIsPlaying(false); setPreviewT(0); }}
                    className="px-4 py-2 rounded-xl border border-border text-xs text-muted-foreground hover:text-foreground">
                    ↩ Reset
                  </button>
                </div>
                {/* Scene markers */}
                <div className="flex gap-1 flex-wrap justify-center mt-1">
                  {[
                    [0, "Hook"], [3, "Logo"], [5, "Content"], [20, "Émotion"],
                    [25, "CTA"], [30, "Outro"], [33, "Brand"]
                  ].map(([ts, lbl]) => (
                    <button key={ts} onClick={() => { setIsPlaying(false); setPreviewT(ts); }}
                      className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary transition-colors">
                      {ts}s {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-96 gap-4 card-premium rounded-2xl">
              <div className="text-6xl">🎬</div>
              <p className="text-sm text-muted-foreground">Cliquez sur "Prévisualiser" pour voir la vidéo</p>
              <p className="text-xs text-muted-foreground/60">ou exportez directement en WebM</p>
            </div>
          )}
        </div>
      </div>

      {/* Hidden export canvas */}
      <canvas ref={canvasRef} width={W} height={H} className="hidden" />
    </div>
  );
}
