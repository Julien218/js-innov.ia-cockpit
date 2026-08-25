import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Loader2, Maximize2, Rotate3D } from 'lucide-react';

export default function Avatar3DViewer({ src, title = 'Candidat 3D' }) {
  const mountRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !src) return undefined;

    setStatus('loading');
    setError('');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07111f);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(0, 1.3, 3.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;
    controls.target.set(0, 1, 0);

    const hemi = new THREE.HemisphereLight(0xbfe7ff, 0x111827, 2.4);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6d5dfc, 2.6);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    const fill = new THREE.PointLight(0x16d9ff, 2.2, 8);
    fill.position.set(-2, 1.5, 2);
    scene.add(fill);

    const grid = new THREE.GridHelper(8, 24, 0x24445f, 0x13293d);
    grid.position.y = 0;
    scene.add(grid);

    let mixer = null;
    let model = null;
    let frame = 0;
    const clock = new THREE.Clock();

    const fitCamera = object => {
      const box = new THREE.Box3().setFromObject(object);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.25);
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(sphere.center.x + distance * 0.15, sphere.center.y + radius * 0.25, sphere.center.z + distance * 1.05);
      camera.near = Math.max(distance / 100, 0.01);
      camera.far = distance * 10;
      camera.updateProjectionMatrix();
      controls.target.copy(sphere.center);
      controls.update();
    };

    const loader = new GLTFLoader();
    loader.load(
      src,
      gltf => {
        model = gltf.scene;
        scene.add(model);
        fitCamera(model);
        if (gltf.animations?.length) {
          mixer = new THREE.AnimationMixer(model);
          const idle = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
          mixer.clipAction(idle).play();
        }
        setStatus('ready');
      },
      undefined,
      err => {
        setStatus('error');
        setError(err?.message || 'Impossible de charger le candidat 3D.');
      },
    );

    const resize = () => {
      const width = Math.max(mount.clientWidth, 1);
      const height = Math.max(mount.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const render = () => {
      frame = requestAnimationFrame(render);
      const delta = clock.getDelta();
      if (mixer) mixer.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (mixer) mixer.stopAllAction();
      scene.traverse(object => {
        if (object.geometry) object.geometry.dispose?.();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach(material => {
            Object.values(material).forEach(value => value?.isTexture && value.dispose?.());
            material.dispose?.();
          });
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [src]);

  const requestFullscreen = () => mountRef.current?.requestFullscreen?.();

  return (
    <div className="rounded-2xl border border-white/10 overflow-hidden bg-[#07111f] shadow-2xl shadow-primary/10">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.04] text-white">
        <div>
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-[10px] text-white/50">Rotation, zoom et animation directement dans le Cockpit</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-flex items-center gap-1 text-[10px] text-cyan-300"><Rotate3D className="w-3 h-3" /> 360°</span>
          <button type="button" onClick={requestFullscreen} className="p-2 rounded-lg hover:bg-white/10" aria-label="Plein écran"><Maximize2 className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="relative h-[360px] sm:h-[440px]" ref={mountRef}>
        {status === 'loading' && <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#07111f]/80 text-white"><Loader2 className="w-6 h-6 animate-spin" /></div>}
        {status === 'error' && <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center bg-[#07111f] text-sm text-red-300">{error}</div>}
      </div>
    </div>
  );
}
