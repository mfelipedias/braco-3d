// Constantes do simulador: juntas, poses, teclado e gestos.

// Ângulos em graus, mesma convenção do Blender. Eixos Y do Blender viram -Z no three.js.
export const JOINTS = [
  { node: 'J1_Base',     label: 'Base',     sub: 'giro',     min: -180, max: 180, apply: (o, r) => o.rotation.y = r },
  { node: 'J2_Ombro',    label: 'Ombro',    sub: '',         min: -90,  max: 90,  apply: (o, r) => o.rotation.z = -r },
  { node: 'J3_Cotovelo', label: 'Cotovelo', sub: '',         min: -150, max: 150, apply: (o, r) => o.rotation.z = -r },
  { node: 'J4_Punho',    label: 'Punho',    sub: 'flexão',   min: -120, max: 120, apply: (o, r) => o.rotation.z = -r },
  { node: 'J5_Rotacao',  label: 'Punho',    sub: 'rotação',  min: -180, max: 180, apply: (o, r) => o.rotation.y = r },
  { node: 'Garra',       label: 'Garra',    sub: 'abertura', min: -5,   max: 40,
    apply: (o, r) => { o.d.rotation.z = -r; o.e.rotation.z = r; } },
];
export const jointName = (j) => (j.sub ? `${j.label} (${j.sub})` : j.label);

export const POSE_REF = [0, -25, 85, 95, 0, 18];
export const SAFE = [-10, 70, 60];  // ombro, cotovelo, punho: braço recolhido no alto

export const MODELS = ['models/braco_robotico.glb', 'models/vidrarias.glb', 'models/mesa.glb'];

// ---------------------------------------------------------------- teclado
export const KEY_STORE = 'braco3d.teclas.v1';
export const DEFAULT_KEYS = [
  { dec: 'KeyA', inc: 'KeyD', step: 2 },   // base
  { dec: 'KeyS', inc: 'KeyW', step: 1 },   // ombro
  { dec: 'KeyF', inc: 'KeyR', step: 1 },   // cotovelo
  { dec: 'KeyG', inc: 'KeyT', step: 2 },   // punho (flexão)
  { dec: 'KeyQ', inc: 'KeyE', step: 3 },   // punho (rotação)
  { dec: 'KeyZ', inc: 'KeyX', step: 1 },   // garra: diminuir = fechar, aumentar = abrir
];
export const HOLD_DELAY = 300, HOLD_INTERVAL = 50;  // ms até começar a repetir / entre repetições

// ---------------------------------------------------------------- gestos
export const GESTURE_STORE = 'braco3d.gestos.v1';
export const GESTURE_STABLE = 300, GESTURE_INTERVAL = 100, PREDICT_EVERY = 80, GESTURE_SMOOTH = 0.5;
export const TM_SCRIPTS = ['https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js',
                           'https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.5/dist/teachablemachine-image.min.js'];
export const CART = { up: 'Garra: subir', down: 'Garra: descer', fwd: 'Garra: avançar', back: 'Garra: recuar' };
export const DEFAULT_GESTURES = { Parado: '', Abrir: 'j5+', Fechar: 'j5-', Esquerda: 'j0+', Direita: 'j0-', Subir: 'up', Descer: 'down' };
// Desenho e dica de como fazer cada gesto (classes com outros nomes aparecem com "?")
export const GESTURE_HINTS = {
  Parado:   { icon: '<svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><rect x="3" y="5" width="26" height="22" rx="4" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3"/><path d="M10 22 L22 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>', how: 'Mão fora da câmera' },
  Abrir:    { icon: '✋', how: 'Mão aberta, palma à frente' },
  Fechar:   { icon: '👍', how: 'Polegar para cima' },
  Esquerda: { icon: '👈', how: 'Aponte para a sua esquerda' },
  Direita:  { icon: '👉', how: 'Aponte para a sua direita' },
  Subir:    { icon: '☝️', how: 'Indicador para cima' },
  Descer:   { icon: '👎', how: 'Polegar para baixo' },
};
export const hintFor = (label) => GESTURE_HINTS[label] ?? { icon: '❔', how: 'Gesto treinado no Teachable Machine' };
