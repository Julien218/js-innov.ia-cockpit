import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Templates from '../../src/pages/Templates';
import VideoStudio from '../../src/pages/VideoStudio';
import ExportsLibrary from '../../src/pages/ExportsLibrary';
import '../../src/index.css';
// Isolated real pages: no auth session, queue bridge, business backend or worker.
createRoot(document.getElementById('root')).render(<BrowserRouter><nav><Link to="/templates">Modèles test</Link> · <Link to="/exports">Exports test</Link><button onClick={() => fetch('/__fixture/fail', {method:'POST'})}>Simuler une erreur serveur</button></nav><Routes><Route path="/templates" element={<Templates/>}/><Route path="/video-studio/:id" element={<VideoStudio/>}/><Route path="/exports" element={<ExportsLibrary/>}/></Routes></BrowserRouter>);
