// GLB 압축 — 정점 용접 · 중복 정리 · 텍스처 WebP(1024px 상한) · Draco(KHR_draco_mesh_compression). 홈플래너 FBX→GLB 변환과 같은 단계(93% 감소 검증)
//   node tools/compress_glb.mjs public/props            폴더 안 GLB 전부(하위 폴더 포함) — 제자리에 덮어쓴다(원본은 git 이력)
//   node tools/compress_glb.mjs public/props --dry      줄어들 크기만 본다
// 이미 Draco 로 압축된 파일은 건너뛴다. 의존: @gltf-transform 4.x · draco3d · sharp — 이 저장소 node_modules 는 다른 프로젝트와 같이 쓰므로
// 거기에 깔지 않고 GLTF_NODE_MODULES(그 셋이 깔린 node_modules 경로)에서 불러온다
//   GLTF_NODE_MODULES=<node_modules 경로> npm run glb
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const NM = process.env.GLTF_NODE_MODULES;
if (!NM) { console.error('GLTF_NODE_MODULES 에 @gltf-transform 4.x · draco3d · sharp 가 깔린 node_modules 경로를 주세요'); process.exit(1); }
const req = createRequire(join(NM, '_.js'));
const load = async (id) => import(pathToFileURL(req.resolve(id)).href);
const { NodeIO } = await load('@gltf-transform/core');
const { ALL_EXTENSIONS } = await load('@gltf-transform/extensions');
const { dedup, prune, weld, textureCompress, draco } = await load('@gltf-transform/functions');
const draco3d = (await load('draco3d')).default ?? (await load('draco3d'));
const sharp = (await load('sharp')).default;

const args = process.argv.slice(2), dry = args.includes('--dry');
const root = args.find((a) => !a.startsWith('--'));
if (!root) { console.error('사용법: node tools/compress_glb.mjs <폴더|파일> [--dry]'); process.exit(1); }
const files = statSync(root).isDirectory()
  ? (function walk(d) { return readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.glb$/i.test(f) ? [p] : []; }); })(root)
  : [root];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
});
const stat = (doc) => {
  let verts = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) verts += p.getAttribute('POSITION')?.getCount() ?? 0;
  const tex = doc.getRoot().listTextures().map((t) => { const s = t.getSize(); return s ? `${s[0]}×${s[1]} ${t.getMimeType().split('/')[1]}` : t.getMimeType(); });
  return { verts, tex };
};

let before = 0, after = 0, skipped = 0;
for (const f of files) {
  const size0 = statSync(f).size;
  const doc = await io.read(f);
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_draco_mesh_compression')) { skipped++; continue; }
  const s0 = stat(doc);
  await doc.transform(
    dedup(), prune(),
    // FBX 에서 넘어온 상품 모델은 면마다 정점이 따로라(인덱스 없음) 용접하면 정점이 크게 준다
    weld(),
    // 텍스처 — WebP · 긴 변 1024 상한(가구 한 점이 화면 일부라 그 이상은 화소로 보이지 않는다)
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 80 }),
    draco({ method: 'edgebreaker' }),
  );
  const glb = await io.writeBinary(doc);
  const s1 = stat(await io.readBinary(glb));
  before += size0; after += glb.byteLength;
  console.log(`${f}  ${(size0 / 1e6).toFixed(2)} → ${(glb.byteLength / 1e6).toFixed(2)}MB · 정점 ${s0.verts} → ${s1.verts} · 텍스처 [${s0.tex.join(', ')}] → [${s1.tex.join(', ')}]`);
  if (!dry) writeFileSync(f, glb);
}
console.log(`합계 ${files.length - skipped}개 ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)}MB (${before ? Math.round((1 - after / before) * 100) : 0}% 감소)${skipped ? ` · 이미 압축 ${skipped}개 건너뜀` : ''}${dry ? ' · 시험(저장 안 함)' : ''}`);
