// GLB 불러오기 — 모든 상품 모델은 Draco(형상) + WebP(텍스처)로 압축해 둔다(tools/compress_glb.mjs, 104.7 → 9.7MB).
// Draco 해독기는 public/draco(three examples/jsm/libs/draco/gltf 사본) — 처음 한 번 받아 작업자(Web Worker)에서 푼다
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
export const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
