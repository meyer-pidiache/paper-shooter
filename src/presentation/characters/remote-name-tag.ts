import * as THREE from 'three';
import { INK } from '../../shared/ink.js';
import { makeInkMaterial } from '../ink/materials.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
void main() {
  vUv = uv;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Write the same shade, ink and normal channels as the scene's other ink materials.
const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalV;
uniform sampler2D uNameMask;
uniform float uInk;
void main() {
  float glyph = step(0.5, texture2D(uNameMask, vUv).r);
  gl_FragColor = vec4(mix(1.0, -1.0, glyph), uInk, normalize(vNormalV).xy);
}`;

export function buildRemoteNameTag() {
  const canvas =
    typeof CanvasRenderingContext2D === 'undefined' ? null : document.createElement('canvas');
  if (canvas) {
    canvas.width = 512;
    canvas.height = 106;
  }
  const context = canvas?.getContext('2d');
  const texture = canvas && context ? new THREE.CanvasTexture(canvas) : null;
  const material = makeInkMaterial({ ink: INK.RED });
  material.vertexShader = vertexShader;
  material.fragmentShader = fragmentShader;
  material.uniforms.uNameMask = { value: texture };
  if (texture) material.addEventListener('dispose', () => texture.dispose());
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.65, 0.34), material);
  return {
    mesh,
    setName(name: string) {
      if (!canvas || !context || !texture) return;
      context.fillStyle = '#000';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = '#fff';
      context.lineWidth = 4;
      context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
      context.fillStyle = '#fff';
      context.font = 'bold 64px system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 28);
      texture.needsUpdate = true;
    },
  };
}
