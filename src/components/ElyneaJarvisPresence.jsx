import { useEffect, useRef } from 'react';
import { createJarvisPresence } from '@/lib/jarvisPresence';
import { getJarvisPresenceState } from '@/lib/jarvisPresenceState';
import './ElyneaJarvisPresence.css';

const labels = { idle: 'En veille', listening: 'Je vous écoute', thinking: 'Je réfléchis…', speaking: 'Je vous réponds' };
export default function ElyneaJarvisPresence(props) {
  const canvas = useRef(null);
  const logo = useRef(null);
  const mode = props.mode || getJarvisPresenceState(props);


  useEffect(() => createJarvisPresence(canvas.current, logo.current, () => mode), [mode]);
  return (
    <section className="elynea-jarvis-presence" data-mode={mode} aria-label="Présence d’Elynea">
      <div className="elynea-jarvis-stage">
        <canvas ref={canvas} aria-hidden="true" />
        <img ref={logo} src="/elynea-jarvis-js.png" alt="Phénix JS" />
      </div>
      <p role="status">{labels[mode]}</p>
    </section>
  );
}
