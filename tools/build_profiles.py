"""단면(프로파일) 자료 — 스윕 · 로프트로 만드는 부품(액자 도어 테두리 · 찬넬 · 몰딩)이 쓰는 쿠지알러 단면.

  KJL_SRC=<쿠지알러 원본 폴더> python -I tools/build_profiles.py       # public/kjl/profiles.json 의 profiles · info
  npx vite-node tools/probe-profiles.ts                               # 같은 파일의 needs (도어마다 실제로 빠진 단면)

계산기는 단면을 못 찾으면 18×18 네모로 대신 그린다(src/kjl/geometry.ts) — 키친바흐 KB5 MHT · 유로 900 Artisan · 유로 500 Chelsea ·
유로 700 Grace · EOClassic 같은 도어 앞면이 깨져 보인 원인(2026-11-06 확인). 단면 좌표는 쿠지알러 단면 항목(유형 14)에 있고
지금 받아 둔 원본(editordata)에는 없다 — 받으면 $KJL_SRC/profiles/<id>.json ({"name", "w", "h", "points": [[x, y], ...]}, mm)
으로 두고 이 도구를 다시 돌린다.

산출 public/kjl/profiles.json (needs 는 그대로 둔다)
  profiles  단면 id → {name, w, h, points}   받아 둔 것만
  info      단면 id → {name, img}             이름(「도어」가 들어가면 도어 앞면 모양 단면) · 쿠지알러 미리보기
"""
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'kjl', 'profiles.json')
SRC = os.environ.get('KJL_SRC') or sys.exit('KJL_SRC(쿠지알러 원본 폴더)를 지정해 주세요')
ID = re.compile(r'3FO[0-9A-Z]{9}')


def walk(o, f):
    if isinstance(o, dict):
        f(o)
        for v in o.values():
            walk(v, f)
    elif isinstance(o, list):
        for v in o:
            walk(v, f)


# 모델들이 쓰는 단면 id 전부
used = set()
for path in glob.glob(os.path.join(ROOT, 'public', 'kjl', 'm', '*.json')):
    walk(json.load(open(path, encoding='utf-8')), lambda o: used.update(ID.findall(str(o.get('value', '')))) if o.get('paramName') == 'profileData' else None)

index = {i['obs']: i for i in json.load(open(os.path.join(SRC, 'param-model-index.json'), encoding='utf-8'))['items']}
info = {p: {'name': index[p]['name'], 'img': index[p].get('img', '')} for p in sorted(used) if p in index}
profiles = {}
for p in sorted(used):
    f = os.path.join(SRC, 'profiles', f'{p}.json')
    if os.path.exists(f):
        d = json.load(open(f, encoding='utf-8'))
        profiles[p] = {'name': d.get('name', info.get(p, {}).get('name', p)), 'w': d['w'], 'h': d['h'], 'points': d['points']}

prev = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
json.dump({'source': 'tools/build_profiles.py (profiles · info) · tools/probe-profiles.ts (needs)', 'profiles': profiles, 'info': info, 'needs': prev.get('needs', {})},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'단면 {len(used)}종 · 이름 {len(info)} · 좌표 받아 둔 것 {len(profiles)} → {OUT}', file=sys.stderr)
for p in sorted(used):
    print(f'  {p} {info.get(p, {}).get("name", "?")}{" (좌표 있음)" if p in profiles else ""}', file=sys.stderr)
