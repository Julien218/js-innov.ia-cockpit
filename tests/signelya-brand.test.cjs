const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sidebar = fs.readFileSync(path.join(root, "src", "components", "layout", "Sidebar.jsx"), "utf8");
const topbar = fs.readFileSync(path.join(root, "src", "components", "layout", "TopBar.jsx"), "utf8");
const login = fs.readFileSync(path.join(root, "src", "pages", "Login.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src", "App.jsx"), "utf8");

test("the dedicated SIGNELYA menu only exposes its two services", () => {
  assert.match(sidebar, /Écran géant/);
  assert.match(sidebar, /Vidéosurveillance/);
  for (const legacy of ["Clients", "Leads", "Factures", "Agents IA", "Paramètres"]) {
    assert.doesNotMatch(sidebar, new RegExp(legacy));
  }
});

test("SIGNELYA identity is used across navigation and authentication", () => {
  assert.match(sidebar, /signelya-symbol-master\.svg/);
  assert.match(sidebar, /Vos écrans prennent vie/);
  assert.match(topbar, /Pilotage SIGNELYA/);
  assert.match(login, /signelya-lockup-horizontal\.svg/);
  assert.match(login, /#00D4FF/);
  assert.match(app, /politique-de-confidentialite/);
});

test("the dedicated cockpit opens on the giant screen service", () => {
  assert.match(app, /path="\/" element={<Navigate to="\/ecran-geant" replace \/>}/);
  assert.match(app, /path="\/login" element={isAuthenticated \? <Navigate to="\/ecran-geant" replace \/>/);
});
