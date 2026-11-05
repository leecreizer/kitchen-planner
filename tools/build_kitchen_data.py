# 부엌 셀프 플래너 데이터 만들기 — 쿠지알러 부엌 파라메트릭 원본(editorData)에서 필요한 것만 뽑는다.
#
#   python -I tools/build_kitchen_data.py
#
# 입력 (이 PC 에만 있음 — 저장소에 넣지 않는다)
#   $KJL_SRC/editordata/*.json.gz      쿠지알러 editordata 원본 [{obs, tool, data}]
#   $KJL_SRC/packages/packages-*.json  제품 패키지(변수 link 선택지) — 도어 그레이드 · 상품 이름·형번
#   $KJL_SRC/packages/cabinet-category-products.json  패키지 분류 → 상품
#   $KJL_SRC/textures/{id}_{이름}_hd.*  재질 텍스처(500px)
# 출력
#   public/kjl/m/{obs}.json   모델 원본(필요한 키만) — 앱이 하위 모델까지 필요할 때 받는다
#   public/kjl/catalog.json   장 모듈(역할·계열·폭) · 도어 그레이드 · 상품(이름·형번·텍스처)
#   public/kjl/tex/{id}.jpg   재질 텍스처 (512px)
import glob
import gzip
import json
import os
import re
import sys

from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
# 원본 위치 — 환경 변수 KJL_SRC (쿠지알러에서 받아 둔 폴더)
SRC = os.environ.get('KJL_SRC') or sys.exit('KJL_SRC 환경 변수에 쿠지알러 원본 폴더를 지정하세요')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'kjl')

# ───────── 장 모듈 — 계열(EO = 유로 몸통 · KB = 키친바흐 리뉴얼 몸통, 둘 다 높이 910 · 도어 = 패키지 변수) ─────────
# role: 배치 규칙이 찾는 역할. 같은 역할에 계열별로 하나씩.
MODULES = [
    # 하부장 (D600 · H910)
    ('sink', 'base', '씽크장', {'EO': '3FO3N0AJTP1C', 'KB': '3FO3PERSVAQY'}),
    ('cook1', 'base', '조리장 1도어', {'EO': '3FO3N0AJ0GUL', 'KB': '3FO3PF0TE6Q8'}),
    ('cook2', 'base', '조리장 2도어', {'EO': '3FO3N0AMBCQ9', 'KB': '3FO3PERSCR3F'}),
    ('cooktop', 'base', '쿡탑장', {'EO': '3FO3N02HPJM9', 'KB': '3FO3OOX8O1AJ'}),
    ('drawer3', 'base', '3단 서랍장', {'EO': '3FO3N036DT9Y', 'KB': '3FO3OJAN9AM6'}),
    ('drawer2', 'base', '2단 서랍장', {'EO': '3FO3NFGE0CI9', 'KB': '3FO3OQOXNSVC'}),
    ('dish', 'base', '식기세척기장', {'EO': '3FO3MKJE8BC1', 'KB': '3FO3OIGGX4XH'}),
    ('oven', 'base', '오븐장', {'EO': '3FO3N09LU3E1', 'KB': '3FO3PGLMHIVB'}),
    ('cornerL', 'base', 'ㄱ자 코너장 L', {'EO': '3FO3N08WJTOQ', 'KB': '3FO3PERT7KBC'}),
    ('cornerR', 'base', 'ㄱ자 코너장 R', {'EO': '3FO3N0AFCGCB', 'KB': '3FO3PERTUOH9'}),
    ('bfill50', 'base', '하부 휠라 50', {'EO': '3FO3N0AFGA3G', 'KB': '3FO3OKMA64D8'}),
    ('bfill75', 'base', '하부 휠라 75', {'EO': '3FO3N0AS1EE3', 'KB': '3FO3OKMCO0JI'}),
    ('islandOpen', 'base', '아일랜드 오픈 서랍장', {'KB': '3FO3O7GP561D'}),
    # 망장(2단 인출 바스켓) — 좁은 틈 수납. 원본 폭별 모델이라 키를 나눈다
    ('basket200', 'base', '망장 200', {'EO': '3FO3N08SGJ6V', 'KB': '3FO4G6MVLA62'}),
    ('basket300', 'base', '망장 300', {'EO': '3FO3N09JHG4B'}),
    # 상부장 (D340 · H720)
    ('wall1', 'wall', '상부장 1도어', {'EO': '3FO3NC5U7F9O', 'KB': '3FO3OOJF47QS'}),
    ('wall2', 'wall', '상부장 2도어', {'EO': '3FO3NC9BGON1', 'KB': '3FO3OOCJOW1B'}),
    ('hood', 'wall', '후드장', {'EO': '3FO3N7N1TI1N', 'KB': '3FO3LAO9GY2J'}),
    ('wallCornerL', 'wall', '상부 코너장 L', {'EO': '3FO3NDFGU169', 'KB': '3FO3OPIKKESC'}),
    ('wallCornerR', 'wall', '상부 코너장 R', {'EO': '3FO3NDFFU5PT', 'KB': '3FO3OQ1K83E7'}),
    ('wallGlass', 'wall', '유리 상부장', {'EO': '3FO3MJXSR5DK', 'KB': '3FO3OSRPIKBK'}),
    ('dishDry', 'wall', '식기건조 상부장', {'EO': '3FO3MJW45OJK', 'KB': '3FO3OOWXDUMT'}),
    ('fridgeTop', 'wall', '냉장고 윗장', {'EO': '3FO3NFEYNNXU', 'KB': '3FO3OPD2189D'}),
    ('wfill50', 'wall', '상부 휠라 50', {'EO': '3FO3NFFXORV3', 'KB': '3FO3OW2MD4EC'}),
    # 키큰장 (D600 · H2227)
    ('tall', 'tall', '키큰장', {'EO': '3FO3NFFPXU82', 'KB': '3FO3OQORTXHD'}),
    ('tall2', 'tall', '키큰장 2도어', {'EO': '3FO3MJ8E41S1', 'KB': '3FO3OJ9X6C9L'}),
    ('fridgeTall', 'tall', '빌트인 냉장고장', {'EO': '3FO3NEBPGAOM', 'KB': '3FO3OKR51WWG'}),
    ('pantryCorner', 'tall', '코너 팬트리장', {'EO': '3FO3MJEVXLL0'}),
    # 카페 스타일 — 접어 여는 가전 · 커피 수납장, 포켓 폴딩장(문을 옆 포켓으로 밀어 넣어 숨김), 접어 여는 상부장
    ('tallBasket', 'tall', '키큰 망장', {'EO': '3FO3NEBPLG96'}),
    ('cafeTall', 'tall', '폴딩 카페장', {'EO': '3FO3MJEOV34Y', 'KB': '3FO499PENE3R'}),
    ('foldTall', 'tall', '포켓 폴딩장', {'EO': '3FO3MJEVXSA2', 'KB': '3FO3NUUD07CO'}),
    ('wallFold', 'wall', '폴딩 상부장', {'EO': '3FO3MJ45TXH4', 'KB': '3FO3OP4K2D9U'}),
    # EP(끝 마감판, W20) — 줄 끝 · 키큰장 옆 · 냉장고 옆(D695 연장용)
    ('epB', 'base', 'EP 하부장용', {'EO': '3FO3N9ETKOEA', 'KB': '3FO3P2ONME67'}),
    ('epT', 'tall', 'EP 키큰장용', {'EO': '3FO3N9D1T6ND', 'KB': '3FO3P1SFYJWT'}),
    ('epTx', 'tall', 'EP 냉장고 옆(D695)', {'EO': '3FO3N9DRYAP2', 'KB': '3FO3P1SJDEGD'}),
    ('epW', 'wall', 'EP 상부장용', {'EO': '3FO3N9GXC3SB', 'KB': '3FO3P2GPG71D'}),
    # FIX 도어 — 아일랜드 뒤
    ('fix', 'base', 'FIX 도어', {'EO': '3FO3MK5RQ4LC', 'KB': '3FO3NTF750P5'}),
    # 오픈 선반 (카페 스타일)
    ('shelfOak', 'shelf', '원목 선반', {'*': '3FO3Q5PO1CW8'}),
    ('shelfWalnut', 'shelf', '월넛 선반', {'*': '3FO3Q70C18WX'}),
    ('shelfWhite', 'shelf', '화이트 오픈선반', {'*': '3FO49VLVMBBU'}),
    ('shelfCob', 'shelf', '조명 선반', {'KB': '3FO3NW61JBDI'}),
]

# ───────── 도어 그레이드 — 패키지 분류(쿠지알러 한샘 원본)를 그대로 묶는다 ─────────
GRADES = [
    ('e300', '유로 300', 'EO', '3FO4K6HF3EBO', ['EO N 도어 › Euro300 CH']),
    ('e500', '유로 500', 'EO', '3FO4K6HF3EBO', ['EO N 도어 › Euro500', 'EO N 도어 › EO500 CH']),
    ('e700', '유로 700', 'EO', '3FO4K6HF3EBO', ['EO N 도어 › Euro700 OB']),
    ('e900', '유로 900', 'EO', '3FO4K6HF3EBO', ['EO N 도어 › Euro900', 'EO N 도어 › Euro900 › CVS/Matt', 'EO N 도어 › Euro900 › CVS/Gloss']),
    ('kb5', '키친바흐 KB5', 'KB', '3FO4K7IVDCJ8', ['KB도어 › KB5 › Bach/Matt', 'KB도어 › KB5 › Bach/Gloss', 'KB도어 › KB5 › MHT/Matt', 'KB도어 › KB5 › MHT/Gloss']),
    ('kb7', '키친바흐 KB7', 'KB', '3FO4K7IVDCJ8', ['KB도어 › KB7']),
]
DOOR_VAR = {'EO': 'EM_DR', 'KB': 'KB_DR'}

# 상판 · 벽 타일 — 장 원본에는 없고(쿠지알러는 설계 도구가 상판을 만든다) 같은 재질 라이브러리에서 고른다. size = 텍스처 1장이 덮는 mm
COUNTERS = [
    ('3FO4670BDNWY', 'HS스톤 코튼화이트', 1400), ('3FO468P1MHBQ', 'HS스톤 오컬트화이트', 1400), ('3FO4BDNOE8VI', 'HS스톤 슈가베이지', 1400),
    ('3FO468PAY7OG', 'HS스톤 뉴미스트', 1400), ('3FO468P1MAMO', 'HS스톤 뉴콘크리트', 1400), ('3FO468PDQGJJ', 'HS스톤 글램다크', 1400),
    ('3FO4EACGB84N', '마블 화이트', 1600), ('3FO4ECC3K4DO', '베네토 마블', 1600), ('3FO4E3XT0GC3', '마블 블랙', 1600),
    ('3FO4EDQCQMON', '테라조', 1000), ('3FO3OUYD7TOQ', '스테인리스', 800),
]
TILES = [
    ('3FO406QMAXD4', '무광 몰드컷팅 300×600', [600, 300]), ('3FO40703JY07', '타이드로드 플래티넘 300×600', [600, 300]),
    ('3FO40703MFWX', '스타로드 플래티넘 600×600', [600, 600]), ('3FO40705SASM', '코어 아일랜드 600×600', [600, 600]),
    ('3FO40RPBT3R8', '프로스트 600', [600, 600]),
]
# 바닥 · 벽지 — 붙박이장 플래너가 쿠지알러 재질 라이브러리에서 받아 둔 것(public/tex/kjl, 실제 크기 포함) 중 일부. 그 플래너의 public 폴더 = 환경 변수 PLANNER_PUBLIC
PLANNER = os.environ.get('PLANNER_PUBLIC') or sys.exit('PLANNER_PUBLIC 환경 변수에 붙박이장 플래너 public 폴더를 지정하세요')
FLOORS = ['HD강-워시오크', 'HD 강마루 와이드 - 내추럴오크']
FLOOR_N, WALL_N = 10, 10
SKIP = re.compile(r'단종|테스트|test|TEST|안씀|Custom|副本|Copy')
# 계산기 사본이 아직 맞게 그리지 못하는 도어 — 액자 테두리 판의 호출 기준점 해석이 원본과 다름(2026-11-04 확인, 쿠지알러 미리보기와 비교)
UNSUPPORTED_DOORS = {'3FO44Q9XIIL3'}
KEEP_KEYS = ('prodCatId', 'paramCategoryTypePos', 'editorData')


def load_all():
    raw = {}
    for f in sorted(glob.glob(f'{SRC}/editordata/*.json.gz')):
        for it in json.load(gzip.open(f)):
            raw[it['obs']] = it
    return raw


def name_of(it):
    return ((it['data'].get('paramModelInfo') or {}).get('name') or '').strip()


def subs(ed):
    for n in ed.get('modelInstances') or []:
        if n.get('obsBrandGoodId'):
            yield n['obsBrandGoodId']


def var_options(ed, name):
    v = next((i for i in ed['inputs'] if i['paramName'] == name), None)
    if not v:
        return None
    opts = [o.get('value') for o in v.get('editorOptions') or [] if o.get('value') not in (None, '')]
    out = {'value': v.get('value'), 'type': v.get('paramTypeId')}
    if opts:
        out['options'] = [float(x) for x in opts if re.fullmatch(r'-?\d+(\.\d+)?', str(x))]
    if v.get('min') not in (None, ''):
        out['min'] = float(v['min'])
    if v.get('max') not in (None, ''):
        out['max'] = float(v['max'])
    return out


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def main():
    raw = load_all()
    print('원본 모델', len(raw))
    pk = json.load(open(sorted(glob.glob(f'{SRC}/packages/packages-*.json'))[0], encoding='utf-8'))
    catprod = json.load(open(f'{SRC}/packages/cabinet-category-products.json', encoding='utf-8'))['catProducts']
    products = dict(pk['products'])

    need, roots = set(), []
    modules = []
    for key, kind, label, by in MODULES:
        for series, obs in by.items():
            it = raw.get(obs)
            if not it:
                print('  없음', key, series, obs)
                continue
            ed = it['data']['editorData']
            ins = {i['paramName']: i.get('value') for i in ed['inputs']}
            modules.append({
                'key': key, 'kind': kind, 'label': label, 'series': series, 'obs': obs, 'name': name_of(it),
                'W': var_options(ed, 'W'), 'D': float(ins.get('D') or 0), 'H': float(ins.get('H') or 0),
                # 비규격 폭 범위 — 원본 W_MIN · W_MAX (STD_YN=true · NSTD_W 로 계산)
                'wmin': num(ins.get('W_MIN')), 'wmax': num(ins.get('W_MAX')), 'nstd': any(i['paramName'] == 'NSTD_W' for i in ed['inputs']),
                'doorVar': DOOR_VAR.get(series) if any(i['paramName'] == DOOR_VAR.get(series) for i in ed['inputs']) else None,
            })
            # 원본 비규격 범위가 자기 규격 폭을 담지 못하면(예: KB 망장 W 200 · W_MIN 300) 잔재로 보고 쓰지 않는다
            m = modules[-1]; wo = [float(x) for x in (m['W'] or {}).get('options', [])]
            if wo and m['wmin'] and m['wmax'] and not any(m['wmin'] <= x <= m['wmax'] for x in wo):
                m['wmin'] = m['wmax'] = None; m['nstd'] = False
            roots.append(obs)

    grades = []
    for gid, label, series, pkg, cats in GRADES:
        p = pk['packages'][pkg]
        doors = []
        for c in p['cats']:
            if c['path'] not in cats:
                continue
            for d in catprod.get(f"{c['pos']}:{c['id']}", []):
                nm = products.get(d, {}).get('name') or (name_of(raw[d]) if d in raw else '')
                if d not in raw or SKIP.search(nm) or d in UNSUPPORTED_DOORS:
                    continue
                doors.append({'obs': d, 'name': nm, 'line': c['path'].split(' › ')[-1], 'img': products.get(d, {}).get('img')})
                roots.append(d)
        grades.append({'id': gid, 'label': label, 'series': series, 'var': DOOR_VAR[series], 'doors': doors})
        print(f'  그레이드 {label}: 도어 {len(doors)}')

    # 하위 모델 닫힘
    miss = set()
    st = list(roots)
    while st:
        x = st.pop()
        if x in need or x in miss:
            continue
        if x not in raw:
            miss.add(x)
            continue
        need.add(x)
        st.extend(subs(raw[x]['data']['editorData']))
    print('필요 모델', len(need), '없는 하위 모델(3D 메시 등)', len(miss))

    os.makedirs(f'{OUT}/m', exist_ok=True)
    total = 0
    ids_in = set()
    for x in need:
        it = raw[x]
        d = {k: it['data'][k] for k in KEEP_KEYS if k in it['data']}
        d['name'] = name_of(it)
        d['tool'] = it['tool']
        s = json.dumps(d, ensure_ascii=False, separators=(',', ':'))
        ids_in.update(re.findall(r'3FO[0-9A-Z]{9}', s))
        open(f'{OUT}/m/{x}.json', 'w', encoding='utf-8').write(s)
        total += len(s.encode('utf-8'))
    print(f'모델 파일 {len(need)}개 {total / 1e6:.1f}MB')

    # 재질 텍스처 — 원본에 등장하는 id 중 텍스처가 있는 것
    os.makedirs(f'{OUT}/tex', exist_ok=True)
    tex = {}
    for f in glob.glob(f'{SRC}/textures/*_hd.*'):
        b = os.path.basename(f)
        tex[b[:12]] = (f, b[13:].rsplit('_hd', 1)[0])
    used = {}
    ids_in.update(i for i, _, _ in COUNTERS + TILES)
    for i in sorted(ids_in):
        if i in tex:
            f, nm = tex[i]
            dst = f'{OUT}/tex/{i}.jpg'
            if not os.path.exists(dst):
                im = Image.open(f).convert('RGB')
                if max(im.size) > 512:
                    im.thumbnail((512, 512), Image.LANCZOS)
                im.save(dst, quality=86)
            used[i] = nm
    print('텍스처', len(used))

    # 상품(재질·도어) — 이름 · 형번(#X.model) · 텍스처
    prod = {}
    for i in ids_in:
        p = products.get(i)
        e = {}
        if p:
            e['name'] = p.get('name')
            if p.get('number'):
                e['model'] = p['number']
        if i in used:
            e['tex'] = 1
            e.setdefault('name', used[i])
        if i in raw and 'name' not in e:
            e['name'] = name_of(raw[i])
        if e:
            prod[i] = e
    # 바닥 · 벽지 사본
    import shutil
    surf = json.load(open(f'{PLANNER}/data/surfaces.json', encoding='utf-8'))
    os.makedirs(f'{OUT}/surf', exist_ok=True)
    picks = {}
    for kind, n in (('floor', FLOOR_N), ('wall', WALL_N)):
        lst = surf[kind]
        first = [s for s in lst if s['name'] in FLOORS] if kind == 'floor' else []
        chosen = (first + [s for s in lst if s not in first])[:n]
        out = []
        for s in chosen:
            for k in ('map', 'thumb'):
                src = f"{PLANNER}/{s[k]}"
                dst = f"{OUT}/surf/{os.path.basename(s[k])}"
                if os.path.exists(src) and not os.path.exists(dst):
                    shutil.copy(src, dst)
            out.append({'id': s['id'], 'name': s['name'], 'size': s['size'], 'map': 'surf/' + os.path.basename(s['map']), 'thumb': 'surf/' + os.path.basename(s['thumb'])})
        picks[kind] = out
    cat = {'source': '쿠지알러 부엌 원본(editordata) — tools/build_kitchen_data.py', 'modules': modules, 'grades': grades, 'products': prod,
           'counters': [{'id': i, 'name': n, 'size': s} for i, n, s in COUNTERS if i in used],
           'tiles': [{'id': i, 'name': n, 'size': s} for i, n, s in TILES if i in used],
           'floors': picks['floor'], 'walls': picks['wall']}
    json.dump(cat, open(f'{OUT}/catalog.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('catalog.json', len(modules), '모듈 · 상품', len(prod))


if __name__ == '__main__':
    main()
