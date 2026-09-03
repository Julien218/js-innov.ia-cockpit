const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "src", "components", "layout", "Sidebar.jsx"), "utf8");
const topbar = fs.readFileSync(path.join(root, "src", "components", "layout", "TopBar.jsx"), "utf8");
const login = fs.readFileSync(path.join(root, "src", "pages", "Login.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");
const wordmark = fs.readFileSync(path.join(root, "src", "components", "brand", "SignelyaWordmark.jsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src", "index.css"), "utf8");
const elynea = fs.readFileSync(path.join(root, "src", "components", "FloatingAgent.jsx"), "utf8");
const assistantServer = fs.readFileSync(path.join(root, "server-assistant.cjs"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "public", "manifest.json"), "utf8"));
const desktopManifest = JSON.parse(fs.readFileSync(path.join(root, "electron", "package.json"), "utf8"));
const installer = fs.readFileSync(path.join(root, "src", "components", "InstallSignelyaButton.jsx"), "utf8");
const main = fs.readFileSync(path.join(root, "src", "main.jsx"), "utf8");
const serviceWorker = fs.readFileSync(path.join(root, "public", "sw.js"), "utf8");

function readPngDimensions(filename) {
  const image = fs.readFileSync(path.join(root, filename));
  assert.equal(image.toString("ascii", 1, 4), "PNG");
  return [image.readUInt32BE(16), image.readUInt32BE(20)];
}

test("the dedicated SIGNELYA menu only exposes its two services", () => {
  assert.match(sidebar, /Écran géant/);
  assert.match(sidebar, /Vidéosurveillance/);
  for (const legacy of ["Clients", "Leads", "Factures", "Agents IA", "Paramètres"]) {
    assert.doesNotMatch(sidebar, new RegExp(legacy));
  }
});

test("SIGNELYA identity is used across navigation and authentication", () => {
  assert.match(sidebar, /signelya-app-icon-approved\.png/);
  assert.match(sidebar, /Vos écrans prennent vie/);
  assert.match(topbar, /Pilotage <SignelyaWordmark/);
  assert.match(login, /signelya-lockup-approved\.png/);
  assert.match(login, /#00D4FF/);
  assert.match(app, /politique-de-confidentialite/);
});

test("the dedicated cockpit opens on the giant screen service", () => {
  assert.match(app, /path="\/" element={<Navigate to="\/ecran-geant" replace \/>}/);
  assert.match(app, /path="\/login" element={isAuthenticated \? <Navigate to="\/ecran-geant" replace \/>/);
});

test("the SIGNELYA wordmark emits a continuous letter-by-letter light", () => {
  assert.match(sidebar, /SignelyaWordmark/);
  assert.match(wordmark, /signelya-wordmark-letter/);
  assert.match(wordmark, /--signelya-index/);
  assert.match(styles, /@keyframes signelya-letter-glow/);
  assert.match(styles, /animation-delay: calc\(var\(--signelya-index\) \* 0\.24s\)/);
  assert.match(styles, /prefers-reduced-motion/);
});

test("the customer assistant is Elynea and understands its Signelya mission", () => {
  assert.match(elynea, /Bonjour.*je suis Elynea/);
  assert.match(elynea, /Assistante clientèle de JS‑Innov\.IA/);
  assert.match(elynea, /intégrée à Signelya/);
  assert.match(styles, /\.elynea-panel[\s\S]*height: min/);
  assert.doesNotMatch(elynea, />NOVA</);
  assert.match(assistantServer, /SIGNELYA_ASSISTANT_CONTEXT/);
  assert.match(assistantServer, /Tu es Elynea/);
  assert.match(assistantServer, /jamais comme Nova/);
  assert.match(assistantServer, /N’annonce jamais que tu vas vérifier/);
  assert.match(assistantServer, /source: 'signelya-live-context'/);
  assert.match(elynea, /signelya_context: signelyaContext/);
  assert.match(elynea, /Horaires écran/);
  assert.match(styles, /font-size: 16px/);
});

test("the installable app uses the complete SIGNELYA by JS-Innov.IA identity", () => {
  assert.equal(manifest.name, "SIGNELYA by JS-Innov.IA");
  assert.equal(manifest.short_name, "SIGNELYA");
  assert.equal(manifest.orientation, "any");
  assert.match(indexHtml, /name="application-name" content="SIGNELYA by JS-Innov\.IA"/);
  assert.match(indexHtml, /<title>SIGNELYA by JS-Innov\.IA — Vos écrans prennent vie<\/title>/);
  assert.equal(desktopManifest.build.productName, "SIGNELYA by JS-Innov.IA");
  assert.equal(desktopManifest.build.nsis.shortcutName, "SIGNELYA by JS-Innov.IA");
});

test("desktop and mobile icon sizes use the official text-free SIGNELYA symbol", () => {
  const icons = new Map(manifest.icons.map((icon) => [`${icon.src}:${icon.purpose}`, icon]));
  assert.ok(icons.has("/signelya-icon-192.png:any"));
  assert.ok(icons.has("/signelya-icon-512.png:any"));
  assert.ok(icons.has("/signelya-icon-maskable-192.png:maskable"));
  assert.ok(icons.has("/signelya-icon-maskable-512.png:maskable"));
  assert.deepEqual(readPngDimensions("public/signelya-favicon.png"), [64, 64]);
  assert.deepEqual(readPngDimensions("public/signelya-apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(readPngDimensions("public/signelya-icon-192.png"), [192, 192]);
  assert.deepEqual(readPngDimensions("public/signelya-icon-512.png"), [512, 512]);
  assert.deepEqual(readPngDimensions("public/signelya-icon-maskable-192.png"), [192, 192]);
  assert.deepEqual(readPngDimensions("public/signelya-icon-maskable-512.png"), [512, 512]);
  assert.deepEqual(readPngDimensions("public/icon-192.png"), [192, 192]);
  assert.deepEqual(readPngDimensions("public/icon-512.png"), [512, 512]);
  const desktopIcon = readPngDimensions("electron/icon.png");
  assert.equal(desktopIcon[0], desktopIcon[1]);
  assert.ok(desktopIcon[0] >= 512);
  assert.ok(fs.statSync(path.join(root, "electron", "icon.ico")).size > 0);
  assert.match(elynea, /signelya-symbol-approved-512\.png/);
  assert.doesNotMatch(indexHtml, /signelya-symbol-master\.svg/);
  assert.equal(fs.existsSync(path.join(root, "public", "signelya-symbol-master.svg")), false);
});

test("the public landing page offers a proper mobile app installation", () => {
  assert.match(login, /InstallSignelyaButton/);
  assert.match(installer, /Installer SIGNELYA sur ce téléphone/);
  assert.match(installer, /beforeinstallprompt/);
  assert.match(installer, /Sur l’écran d’accueil/);
  assert.match(installer, /appinstalled/);
  assert.match(main, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(serviceWorker, /self\.addEventListener\('fetch'/);
});

test("shared links use the approved SIGNELYA social image", () => {
  assert.match(indexHtml, /property="og:image" content="https:\/\/signelya\.jsinnovia\.com\/signelya-social-share\.jpg"/);
  assert.match(indexHtml, /name="twitter:card" content="summary_large_image"/);
  assert.match(indexHtml, /name="twitter:image" content="https:\/\/signelya\.jsinnovia\.com\/signelya-social-share\.jpg"/);
  assert.ok(fs.statSync(path.join(root, "public", "signelya-social-share.jpg")).size > 0);
});

test("logout is always visible and waits for the server session to close", () => {
  assert.match(topbar, /aria-label="Se déconnecter"/);
  assert.match(topbar, /await logout\(\)/);
  assert.match(sidebar, /await logout\(\)/);
  assert.match(topbar, /navigate\("\/login", \{ replace: true \}\)/);
});
