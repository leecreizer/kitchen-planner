import type { ToolType } from './modelTypes';

/**
 * 새 파라메트릭 모델 형식 — 쿠지알러 editorData 구조를 그대로 따른다.
 *  - 요소·보조 구조 인스턴스의 값은 쿠지알러 저장 문자열 그대로(float3 = '{"x":"0","y":"0","z":"0"}', plankPath JSON …)
 *  - 좌표(mm): X = 폭(오른쪽 +), Y = 깊이(뒤 +, 앞면 -D), Z = 높이(위 +)
 */

/* ───────────── 쿠지알러 원본 형식 (editordata 조회 응답 그대로) ─────────────
 * 이 앱의 파라메트릭 모델은 쿠지알러 editorData 를 그대로 저장·계산·편집한다. 모르는 키도 지우지 않고 보관한다.
 * 이 앱에만 있는 정보(모델 이름·버전·미리보기·에디터 표시 상태 …)는 meta 안에 따로 둔다.
 */

/** 변수 형식(valueType) — 쿠지알러 ParameterValueType */
export type ParamType = 'float' | 'int' | 'string' | 'boolean' | 'booleanlist' | 'material' | 'style' | 'shape'
  | 'float2' | 'float3' | 'fit' | 'plankpath' | 'loftpath';
/** 값 유형(paramTypeId) — 0 무제한 · 1 구간 · 2 선택 · 3 이산 · 4 복합 수식 · 5 수식 · 6 고정값 · 7~9 수식/상품 선택 */
export type ParamTypeId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** 변수 구역 — inputs(groupTypeId 0 기본 · 1 시스템 · 2 사용자) · constants(중간) · reports(보고) */
export type VarScope = 'system' | 'basic' | 'custom' | 'middle' | 'report';

/** 선택지(editorOptions[]) — ignore = 숨김 조건 */
export interface VarOption { name: string; value: string; ignore?: string | null; extAttr?: Record<string, unknown>; priority?: unknown }

/** 변수 (editorData.inputs · constants · reports 의 항목) */
export interface PmVar {
  id: string;
  /** 참조명(引用名) — 수식에서 #paramName */
  paramName: string;
  /** 이름(名称) */
  displayName?: string | null;
  valueType: ParamType;
  /** 값 유형 — 중간·보고 변수에는 없음(항상 수식) */
  paramTypeId?: ParamTypeId;
  /** 0 기본 · 1 시스템 · 2 사용자 정의 (inputs 만) */
  groupTypeId?: number;
  /** 현재값 — 중간·보고 변수는 수식 */
  value: string;
  min?: string;
  max?: string;
  step?: string;
  /** 수식 · 복합 수식 표현식 */
  formula?: string;
  /** 복합 수식 이름 */
  formulaDisplayName?: string;
  /** 복합 수식 상태 — -1 수식 없음 · 0 값 · 1 수식 */
  status?: number;
  /** 시스템 변수 설계 툴 기능 이름(offGround …) */
  scriptName?: string | null;
  /** 숨김 조건(隐藏条件) */
  ignore?: string | null;
  visible?: boolean;
  editorOptions?: VarOption[];
  editorRecommends?: unknown[];
  description?: string | null;
  /** 전역 변수 id (쿠지알러 globalId 숫자 · 이 앱에서 만든 것은 'h…') */
  globalId?: string | number | null;
  /** 확장 속성(diy-immutable 잠금 조건 · diy-ratingLabel 등급 라벨 …) */
  extAttr?: Record<string, unknown>;
  /** 선택지 묶음(옵션 패키지) id — 선택지를 쿠지알러 서버 패키지에서 가져옴 */
  link?: string | null;
  /* 쿠지알러 원본에 있는 그 밖의 키 — 이 앱은 해석하지 않고 그대로 보관 */
  linkForm?: number | null;
  formulaForm?: number | null;
  valueFormat?: number;
  extVariableAttr?: Record<string, unknown>;
  preCalcModelRefNames?: unknown;
  required?: boolean;
  valueRequired?: boolean;
  valueDisplayNames?: unknown[];
  originalValue?: unknown;
  typeId?: number | null;
  generated?: boolean;
  /** 변수 템플릿 범주 — 0 사용자 정의 · 1 중간 · 2 보고 (쿠지알러 input/collection) */
  type?: number | null;
  userId?: number | null;
  creationSource?: number | null;
  libraryId?: number | null;
  /** 예전 형식 전역 변수의 숨김 방식 — 읽을 때 ignoreMode 로 바뀜(src/pm/globals.ts) */
  hideMode?: 'unified' | 'local';
}

/** 요소 변수 (parameters[]) — 값은 저장 문자열 그대로 */
export interface PmParam {
  paramName: string;
  value?: string | null;
  valueType?: string;
  displayName?: string;
  defaultValue?: string | null;
  groupTypeId?: number | null;
  visible?: boolean;
  editable?: boolean;
  status?: number;
  functionName?: string;
  paramTypeId?: number;
  valueFormat?: number;
  simpleName?: string;
  min?: string;
  max?: string;
  step?: string;
  link?: string;
  formulaForm?: number;
  formulaDisplayName?: string;
  editorOptions?: VarOption[];
  editorRecommends?: unknown[];
  valueDisplayNames?: unknown[];
  businessTypeOptions?: unknown[];
  extAttr?: Record<string, unknown>;
}
/** 업무 속성(bizProperties[]) */
export interface PmBiz { key: string; value: string | null; namespace?: string; name?: string; valueType?: string; optionId?: string }

/**
 * 요소 · 보조 구조 · 하위 모델 인스턴스 (modelInstances · frameModels · moldingPaths · adsorbLines … · paramModel).
 * 하위 모델: functionTypeId 1·2 + obsBrandGoodId, functionName 은 '<계정>.paramModel_…'(파라메트릭) · '<계정>.furnitureModel_…'(3D) · '#변수'(변수로 바뀌는 모델).
 * 이 앱에서 넣은 하위 모델은 'ext.paramModel' · 'ext.furnitureModel'.
 */
export interface PmNode {
  instanceId: string;
  name: string;
  functionName: string;
  functionTypeId?: number | null;
  refName?: string | null;
  obsBrandGoodId?: string | null;
  parameters: PmParam[];
  bizProperties?: PmBiz[];
  instanceInheritance?: PmInheritance;
  customParamGroups?: { groupName: string; paramNames: string[] }[];
  /* 쿠지알러 원본에 있는 그 밖의 키 — 그대로 보관 */
  uniqueId?: string;
  versionId?: number;
  depends?: unknown;
  usedBy?: unknown;
  inputFamilyRefs?: unknown[];
  envInputOverrides?: unknown;
  transformType?: unknown;
}

/** 상속 설정 — 묶음: true 상속·false 안 함(없음 = 툴 따름), 변수: 1 상속·2 안 함(없음 = 묶음 따름) */
export interface PmInheritance { paramGroupInheritances: Record<number, boolean>; paramNameInheritances: Record<string, number> }

/** 데이터 인터페이스 출력(Alt+S) — outputConfig.productionParams[] */
export interface PmProductionParam { paramName: string; output: boolean; outputName: string; formulaOutput: string | null; value: string }

/** 단위 — 문 개구부 연결이면 main = 개구부 id, accessory = 문 부품 id */
export interface PmUnit { typeId: number; mainInstanceId: string; accessoryInstanceId: string }

/** 외부 값 가져오기 한 항목 — 값은 변수 참조명(빈칸 = 대응 없음). assignFromCategory -1 은 미지정(모델 유형 기본값으로 보임) */
export interface PmAssign {
  name: string;
  assignFromCategory: number;
  assignFromObject: number;
  size: { x: string; y: string; z: string };
  position: { x: string; y: string; z: string };
  rotate: { x: string; y: string; z: string };
}

/** editorData — 쿠지알러 모델 본체 */
export interface EditorData {
  id?: string;
  versionId?: number;
  inputs: PmVar[];
  /** 중간 변수 */
  constants?: PmVar[];
  /** 보고 변수 */
  reports?: PmVar[];
  /** 사용자 변수 그룹 — 그룹 순서 = 배열 순서 */
  customParamGroups?: { groupName: string; paramNames: string[] }[];
  modelInstances?: PmNode[];
  frameModels?: PmNode[];
  moldingPaths?: PmNode[];
  adsorbLines?: PmNode[];
  innerFrameModels?: PmNode[];
  customDoorHoles?: PmNode[];
  intersectBoxes?: PmNode[];
  connectors?: PmNode[];
  connectorModels?: PmNode[];
  wireLayouts?: PmNode[];
  customAuxiliaries?: PmNode[];
  /** 모델 속성(ParamModel.paramModel) */
  paramModel?: PmNode;
  bizProperties?: PmBiz[];
  outputConfig?: { quotationConfig?: { customSize?: { x: string; y: string; z: string } }; productionParams?: PmProductionParam[]; [k: string]: unknown };
  parameterAssignments?: { parameterAssignments?: PmAssign[]; [k: string]: unknown };
  unitDataList?: PmUnit[];
  [k: string]: unknown;
}

/** 요소가 들어 있는 editorData 배열 (구조 탐색 순서) */
export const NODE_SECTIONS = ['modelInstances', 'moldingPaths', 'adsorbLines', 'innerFrameModels', 'customDoorHoles', 'intersectBoxes',
  'connectors', 'connectorModels', 'wireLayouts', 'customAuxiliaries'] as const;
export type NodeSection = typeof NODE_SECTIONS[number];

/** 배열(阵列) — 쿠지알러는 서버(newArrayApi)가 계산해 저장 형식 미확인 → 앱 정보(meta.arrays)에 둔다 */
export interface PmArray {
  dir: 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-';
  length: string;
  mode: 'step' | 'count';
  value: string;
}
/** 부품 노드 보고 설정 행 — 쿠지알러 저장 위치 미확인 → meta.nodeReports */
export interface PmNodeReport { nodeId: string; report: boolean; toTop: boolean; prefix: string }
/** 모델 버전 — 입고 때 기록 */
export interface PmVersion { version: number; at: number; by: string; desc: string; snapshot: string }

/** 앱 전용 정보 — 쿠지알러 형식 밖 */
export interface ModelMeta {
  id: string;
  name: string;
  tooltype: ToolType;
  lib?: number;
  library: string;
  category: string;
  /** 쿠지알러에서 가져온 모델의 상품 id */
  obs?: string;
  preview?: string;
  markImage?: string;
  version: number;
  versions: PmVersion[];
  createdAt: number;
  updatedAt: number;
  /** 구조 탐색 눈 — 에디터 표시만 */
  viewHidden?: string[];
  arrays?: Record<string, PmArray>;
  nodeReports?: PmNodeReport[];
  /** 변수 앱 확장 — 수정 가능 · 환경 조건 (쿠지알러 저장 위치 미확인) */
  varExt?: Record<string, { editable?: boolean; env?: string }>;
}

/** 이 앱의 파라메트릭 모델 = 쿠지알러 editordata 응답 + meta */
export interface PmModel {
  prodCatId?: number;
  paramCategoryTypePos?: number[];
  editorData: EditorData;
  /** 쿠지알러 응답의 나머지 키(resource · model · paramModelInfo …) — 해석 없이 보관 */
  kjl?: Record<string, unknown>;
  meta: ModelMeta;
}

/** 변수 템플릿 폴더 (자기 정의 변수 템플릿 — 문서 3.1.3) */
/** 변수 템플릿 폴더 — 쿠지알러 분류(category?module=0) 트리: parentId 로 이어진다 */
export interface VarTemplateFolder { id: string; name: string; vars: PmVar[]; parentId?: string | null; isDefault?: boolean }

/* ───────────── 판재 윤곽 경로 (plankPath · loftPath · profile) ───────────── */

/**
 * 꼭짓점 종류: 0 직각 · 1 둥근 모서리(radius) — 쿠지알러 저장값 관찰.
 * 2 모따기(a · b) — 교육 문서(切角 a·b)에 있으나 저장 형식은 미확인 → 앱 확장 필드 chamferA/chamferB.
 */
export interface PathPoint {
  x: string;
  y: string;
  type: 0 | 1 | 2;
  radius?: string;
  chamferA?: string;
  chamferB?: string;
  /** 쿠지알러 저장값 그대로 보관 (nameId · edgeBanding · bizProperties · offset …) */
  extra?: Record<string, unknown>;
}
/**
 * 선 종류: 0 직선 — 관찰. 1 원호 — 교육 문서(线段类型 圆弧, 반지름 수식)에 있으나 저장 형식 미확인 → 앱 확장.
 * 원호: 반지름 + 시계 방향 + 짧은 호(劣弧)
 */
export interface PathLine {
  type: 0 | 1;
  radius?: string;
  clockwise?: boolean;
  minor?: boolean;
  extra?: Record<string, unknown>;
}
export interface PmPath {
  points: PathPoint[];
  /** lines[i] = 점 i → 점 i+1 (닫힌 경로면 마지막 → 첫 점) */
  lines: PathLine[];
  closed: boolean;
  name?: string;
  /** 오프셋(偏移) — 하단 체크 + 오프셋 값 */
  offset?: string;
}
/** 홈(槽) — 판 면에 파는 홈. 깊이 · 면 */
export interface PmSlot { path: PmPath; depth: string; face: 'top' | 'bottom' }
export interface PlankShape {
  outline: PmPath;
  holes: PmPath[];
  slots: PmSlot[];
  /** 쿠지알러 arrays 등 해석하지 않은 값 */
  rest?: Record<string, unknown>;
}
