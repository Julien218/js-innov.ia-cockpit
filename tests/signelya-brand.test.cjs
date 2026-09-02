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
});
