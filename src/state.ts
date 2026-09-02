import { APARTMENT, DEFAULT_BRIEF, FIXED_STRUCTURES, FURNITURE_CATALOGUE, INITIAL_LAYOUT, INITIAL_WALL_MEASUREMENTS, ROOMS, ROUTE_POINTS, seededValidation } from './data';
import { clamp, constrainFurniturePosition, furniturePolygon, normalizeRotation, polygonBounds, validateLayout } from './geometry';
import type {
  ActionSource,
  Furniture,
  FurnitureKind,
  HouseholdBrief,
  Layout,
  PlannerAction,
  PlannerState,
  Snapshot,
  ToolResult,
} from './types';

export class DomainError extends Error {
  code: string;
  affectedIds: string[];

  constructor(code: string, message: string, affectedIds: string[] = []) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.affectedIds = affectedIds;
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeSnapshot(state: PlannerState): Snapshot {
  return deepClone({
    apartment: state.apartment,
    rooms: state.rooms,
    fixedStructures: state.fixedStructures,
    routePoints: state.routePoints,
    wallMeasurements: state.wallMeasurements,
    layouts: state.layouts,
    activeLayoutId: state.activeLayoutId,
    brief: state.brief,
    overlays: state.overlays,
    viewport: state.viewport,
    selectedIds: state.selectedIds,
    focusedId: state.focusedId,
    lastAction: state.lastAction,
  });
}

const EAST_WING_X = 538;
const EAST_ANCHORED_STRUCTURE_IDS = new Set(['window-north-bed', 'bath-shower', 'bath-toilet']);
const EAST_ANCHORED_ROUTE_POINT_IDS = new Set(['bed', 'bathroom']);

function isEastAnchored(item: Furniture, apartmentWidth: number): boolean {
  const bounds = polygonBounds(furniturePolygon(item));
  return item.id !== 'furn-bookshelf' && bounds.x >= EAST_WING_X && apartmentWidth - (bounds.x + bounds.width) <= apartmentWidth - EAST_WING_X;
}

function propagateWallMeasurement(draft: PlannerState, lengthCm: number): void {
  const oldWidth = draft.apartment.width;
  const delta = lengthCm - oldWidth;
  draft.apartment = { ...draft.apartment, width: lengthCm };
  draft.wallMeasurements = draft.wallMeasurements.map((measurement) => measurement.wallId === 'wall-top' ? { ...measurement, lengthCm } : measurement);
  draft.rooms = draft.rooms.map((room) => room.rect.x >= EAST_WING_X ? { ...room, rect: { ...room.rect, width: lengthCm - 18 - room.rect.x } } : room);
  draft.fixedStructures = draft.fixedStructures.map((structure) => {
    if (!structure.rect) return structure;
    const rect = { ...structure.rect };
    if (structure.id === 'wall-top') rect.width = lengthCm;
    else if (structure.id === 'wall-right') rect.x = lengthCm - 18;
    else if (structure.id === 'wall-bottom-right') rect.width = lengthCm - rect.x;
    else if (structure.id === 'wall-bedroom-bath-right' || structure.id === 'wall-bath-hall-right') rect.width = lengthCm - 18 - rect.x;
    else if (EAST_ANCHORED_STRUCTURE_IDS.has(structure.id)) rect.x += delta;
    return { ...structure, rect };
  });
  draft.routePoints = draft.routePoints.map((point) => EAST_ANCHORED_ROUTE_POINT_IDS.has(point.id) ? { ...point, position: { ...point.position, x: point.position.x + delta } } : point);
  draft.layouts = draft.layouts.map((layout) => ({
    ...layout,
    furniture: layout.furniture.map((item) => {
      const next = isEastAnchored(item, oldWidth)
        ? { ...item, position: { ...item.position, x: item.position.x + delta + (item.kind === 'queen-bed' ? 8 : 0) } }
        : item.id === 'furn-bookshelf'
          ? { ...item, position: { ...item.position, x: item.position.x - 11 } }
          : item;
      return { ...next, position: constrainFurniturePosition(next, next.position, draft.apartment) };
    }),
  }));
}

function activeLayout(state: PlannerState): Layout {
  const layout = state.layouts.find((candidate) => candidate.id === state.activeLayoutId);
  if (!layout) throw new DomainError('LAYOUT_NOT_FOUND', 'The active layout no longer exists.');
  return layout;
}

function getItem(state: PlannerState, id: string): Furniture {
  const item = activeLayout(state).furniture.find((candidate) => candidate.id === id);
  if (!item) throw new DomainError('FURNITURE_NOT_FOUND', `No placed furniture has the ID “${id}”.`, [id]);
  return item;
}

function ensureNumber(value: number, label: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new DomainError('INVALID_VALUE', `${label} must be a finite number at least ${min}.`);
  }
  return value;
}

function nextId(prefix: string, existing: string[]): string {
  let counter = 1;
  let candidate = `${prefix}-${counter}`;
  while (existing.includes(candidate)) {
    counter += 1;
    candidate = `${prefix}-${counter}`;
  }
  return candidate;
}

function layoutFurnitureIds(state: PlannerState): string[] {
  return activeLayout(state).furniture.map((item) => item.id);
}

function recalculate(state: PlannerState): PlannerState {
  const layout = activeLayout(state);
  return {
    ...state,
    validation: validateLayout(
      layout.furniture,
      state.fixedStructures,
      state.routePoints,
      state.brief,
      layout.routeCheck,
      state.apartment,
    ),
  };
}

function withMutation(
  state: PlannerState,
  label: string,
  changedIds: string[],
  source: ActionSource,
  mutate: (draft: PlannerState) => void,
): PlannerState {
  const draft = deepClone(state);
  draft.history = [...state.history, { ...makeSnapshot(state), label }];
  draft.future = [];
  mutate(draft);
  draft.lastAction = {
    id: `${source}-${Date.now()}-${draft.history.length}`,
    label,
    source,
    changedIds,
    at: Date.now(),
  };
  return recalculate(draft);
}

function findTemplate(state: PlannerState, templateId: string) {
  const template = state.catalogue.find((item) => item.id === templateId || item.catalogueId === templateId);
  if (!template) throw new DomainError('CATALOGUE_NOT_FOUND', `No furniture template has the ID “${templateId}”.`, [templateId]);
  return template;
}

function furnitureLabel(item: Furniture): string {
  return item.name.toLowerCase();
}

export function createInitialState(): PlannerState {
  const validation = seededValidation(INITIAL_LAYOUT, DEFAULT_BRIEF);
  return {
    project: {
      id: 'lived-in-project',
      name: 'Lived In',
      unit: 'cm',
      disclaimer: 'Planning aid only — not a construction document or code-compliance approval.',
    },
    apartment: APARTMENT,
    rooms: ROOMS,
    fixedStructures: FIXED_STRUCTURES,
    routePoints: ROUTE_POINTS,
    wallMeasurements: INITIAL_WALL_MEASUREMENTS,
    catalogue: FURNITURE_CATALOGUE,
    layouts: [INITIAL_LAYOUT],
    activeLayoutId: INITIAL_LAYOUT.id,
    brief: DEFAULT_BRIEF,
    overlays: {
      showRoute: true,
      showClearances: false,
      showLabels: true,
      measure: { active: false, points: [] },
    },
    viewport: { zoom: 1, pan: { x: 0, y: 0 } },
    selectedIds: ['furn-sofa'],
    focusedId: 'furn-sofa',
    lastAction: null,
    history: [],
    future: [],
    validation,
  };
}

export function appReducer(state: PlannerState, action: PlannerAction): PlannerState {
  switch (action.type) {
    case 'select': {
      const validIds = action.ids.filter((id) => layoutFurnitureIds(state).includes(id));
      return { ...state, selectedIds: validIds, focusedId: validIds[0] ?? null };
    }
    case 'move-furniture': {
      const item = getItem(state, action.id);
      if (item.locked) throw new DomainError('LOCKED_ITEM', `${item.name} is locked. Unlock it before moving.`, [item.id]);
      const position = {
        x: ensureNumber(action.position.x, 'x'),
        y: ensureNumber(action.position.y, 'y'),
      };
      const constrained = constrainFurniturePosition(item, position, state.apartment);
      return withMutation(state, `Moved ${furnitureLabel(item)}`, [item.id], action.source ?? 'human', (draft) => {
        const target = getItem(draft, item.id);
        target.position = constrained;
      });
    }
    case 'rotate-furniture': {
      const item = getItem(state, action.id);
      if (item.locked) throw new DomainError('LOCKED_ITEM', `${item.name} is locked. Unlock it before rotating.`, [item.id]);
      const rotation = action.rotation === undefined ? item.rotation + 90 : ensureNumber(action.rotation, 'rotation');
      return withMutation(state, `Rotated ${furnitureLabel(item)}`, [item.id], action.source ?? 'human', (draft) => {
        getItem(draft, item.id).rotation = normalizeRotation(rotation);
      });
    }
    case 'resize-furniture': {
      const item = getItem(state, action.id);
      if (item.locked) throw new DomainError('LOCKED_ITEM', `${item.name} is locked. Unlock it before resizing.`, [item.id]);
      if (!item.custom) throw new DomainError('RESIZE_FORBIDDEN', 'Only custom furniture can be resized.', [item.id]);
      const width = ensureNumber(action.width, 'width', 10);
      const depth = ensureNumber(action.depth, 'depth', 10);
      return withMutation(state, `Resized ${furnitureLabel(item)}`, [item.id], action.source ?? 'human', (draft) => {
        const target = getItem(draft, item.id);
        target.width = width;
        target.depth = depth;
      });
    }
    case 'set-furniture-lock': {
      const item = getItem(state, action.id);
      return withMutation(state, `${action.locked ? 'Locked' : 'Unlocked'} ${furnitureLabel(item)}`, [item.id], action.source ?? 'human', (draft) => {
        getItem(draft, item.id).locked = action.locked;
      });
    }
    case 'update-furniture-cost': {
      const item = getItem(state, action.id);
      const cost = ensureNumber(action.cost, 'cost');
      return withMutation(state, `Updated ${furnitureLabel(item)} cost`, [item.id], action.source ?? 'human', (draft) => {
        getItem(draft, item.id).cost = Math.round(cost);
      });
    }
    case 'confirm-dimensions': {
      const item = getItem(state, action.id);
      if (item.locked) throw new DomainError('LOCKED_ITEM', `${item.name} is locked. Unlock it before changing dimensions.`, [item.id]);
      const width = action.width === undefined ? item.width : ensureNumber(action.width, 'width', 10);
      const depth = action.depth === undefined ? item.depth : ensureNumber(action.depth, 'depth', 10);
      return withMutation(state, `Confirmed ${furnitureLabel(item)} dimensions`, [item.id], action.source ?? 'human', (draft) => {
        const target = getItem(draft, item.id);
        target.width = width;
        target.depth = depth;
        target.dimensionStatus = 'confirmed';
      });
    }
    case 'add-furniture': {
      const template = action.templateId ? findTemplate(state, action.templateId) : undefined;
      if (!template && !action.item) throw new DomainError('MISSING_ITEM', 'Choose a library item or provide a custom item.');
      const name = action.item?.name?.trim() || template?.name;
      if (!name) throw new DomainError('INVALID_NAME', 'Custom furniture needs a name.');
      const width = ensureNumber(action.item?.width ?? template?.width ?? 0, 'width', 10);
      const depth = ensureNumber(action.item?.depth ?? template?.depth ?? 0, 'depth', 10);
      const itemId = nextId('furn-item', layoutFurnitureIds(state));
      const position = action.position ?? action.item?.position ?? template?.defaultPosition ?? { x: 300, y: 250 };
      const newItem: Furniture = {
        id: itemId,
        catalogueId: template?.catalogueId ?? itemId,
        name,
        kind: action.item?.kind ?? template?.kind ?? 'custom',
        width,
        depth,
        position: constrainFurniturePosition({
          id: itemId,
          catalogueId: template?.catalogueId ?? itemId,
          name,
          kind: action.item?.kind ?? template?.kind ?? 'custom',
          width,
          depth,
          position,
          rotation: action.item?.rotation ?? template?.defaultRotation ?? 0,
          clearance: template?.clearance ?? { front: 30, back: 10, left: 10, right: 10 },
          cost: action.item?.cost ?? template?.cost ?? 0,
          ownership: action.item?.ownership ?? template?.ownership ?? 'buy',
          locked: false,
          dimensionStatus: template ? 'confirmed' : 'estimated',
          custom: !template,
          color: template?.color ?? '#ebe9e4',
        }, position, state.apartment),
        rotation: normalizeRotation(action.item?.rotation ?? template?.defaultRotation ?? 0),
        clearance: template?.clearance ?? { front: 30, back: 10, left: 10, right: 10 },
        cost: Math.round(action.item?.cost ?? template?.cost ?? 0),
        ownership: action.item?.ownership ?? template?.ownership ?? 'buy',
        locked: false,
        dimensionStatus: template ? 'confirmed' : 'estimated',
        custom: !template,
        color: template?.color ?? '#ebe9e4',
      };
      return withMutation(state, `Added ${furnitureLabel(newItem)}`, [itemId], action.source ?? 'human', (draft) => {
        activeLayout(draft).furniture.push(newItem);
        draft.selectedIds = [itemId];
        draft.focusedId = itemId;
      });
    }
    case 'remove-furniture': {
      const item = getItem(state, action.id);
      if (item.locked) throw new DomainError('LOCKED_ITEM', `${item.name} is locked. Unlock it before removing.`, [item.id]);
      return withMutation(state, `Removed ${furnitureLabel(item)}`, [item.id], action.source ?? 'human', (draft) => {
        const layout = activeLayout(draft);
        layout.furniture = layout.furniture.filter((candidate) => candidate.id !== item.id);
        draft.selectedIds = draft.selectedIds.filter((id) => id !== item.id);
        draft.focusedId = draft.selectedIds[0] ?? null;
      });
    }
    case 'duplicate-furniture': {
      const item = getItem(state, action.id);
      const itemId = nextId('furn-item', layoutFurnitureIds(state));
      const copy: Furniture = {
        ...deepClone(item),
        id: itemId,
        name: `${item.name} copy`,
        position: constrainFurniturePosition(item, { x: item.position.x + 35, y: item.position.y + 35 }, state.apartment),
        locked: false,
      };
      return withMutation(state, `Duplicated ${furnitureLabel(item)}`, [item.id, itemId], action.source ?? 'human', (draft) => {
        activeLayout(draft).furniture.push(copy);
        draft.selectedIds = [itemId];
        draft.focusedId = itemId;
      });
    }
    case 'set-brief': {
      const nextBrief: HouseholdBrief = {
        ...state.brief,
        ...action.brief,
        mustKeep: action.brief.mustKeep ? [...action.brief.mustKeep] : [...state.brief.mustKeep],
        sources: action.brief.sources ? [...action.brief.sources] : [...state.brief.sources],
      };
      ensureNumber(nextBrief.minimumWalkingWidth, 'minimum walking width', 40);
      ensureNumber(nextBrief.budget, 'budget');
      return withMutation(state, 'Updated household brief', [], action.source ?? 'human', (draft) => {
        draft.brief = nextBrief;
        const layout = activeLayout(draft);
        layout.routeCheck.minimumWidth = nextBrief.minimumWalkingWidth;
      });
    }
    case 'update-wall-measurement': {
      if (action.wallId !== 'wall-top') throw new DomainError('WALL_NOT_SUPPORTED', 'Only wallId “wall-top” (North exterior wall) is supported in this demo.', [action.wallId]);
      if (!Number.isFinite(action.lengthCm) || action.lengthCm < 760 || action.lengthCm > 960) {
        throw new DomainError('INVALID_WALL_MEASUREMENT', 'lengthCm must be a finite number between 760 and 960 cm.', [action.wallId]);
      }
      return withMutation(state, `Corrected north exterior wall to ${action.lengthCm} cm`, [action.wallId], action.source ?? 'human', (draft) => {
        propagateWallMeasurement(draft, action.lengthCm);
      });
    }
    case 'create-layout': {
      const source = action.sourceLayoutId ? state.layouts.find((layout) => layout.id === action.sourceLayoutId) : activeLayout(state);
      if (!source) throw new DomainError('LAYOUT_NOT_FOUND', 'The source layout does not exist.');
      const name = action.name.trim();
      if (!name) throw new DomainError('INVALID_NAME', 'A layout needs a name.');
      if (state.layouts.some((layout) => layout.name.toLowerCase() === name.toLowerCase())) {
        throw new DomainError('DUPLICATE_NAME', `A layout named “${name}” already exists.`);
      }
      const id = nextId('layout', state.layouts.map((layout) => layout.id));
      const layout: Layout = {
        ...deepClone(source),
        id,
        name,
        createdAt: new Date().toISOString(),
        sourceLayoutId: source.id,
        furniture: deepClone(source.furniture),
      };
      return withMutation(state, `Created ${name}`, layout.furniture.map((item) => item.id), action.source ?? 'human', (draft) => {
        draft.layouts.push(layout);
        draft.activeLayoutId = id;
        draft.selectedIds = ['furn-sofa'];
        draft.focusedId = 'furn-sofa';
      });
    }
    case 'rename-layout': {
      const name = action.name.trim();
      if (!name) throw new DomainError('INVALID_NAME', 'A layout needs a name.');
      const layout = state.layouts.find((candidate) => candidate.id === action.id);
      if (!layout) throw new DomainError('LAYOUT_NOT_FOUND', 'The layout does not exist.', [action.id]);
      if (state.layouts.some((candidate) => candidate.id !== action.id && candidate.name.toLowerCase() === name.toLowerCase())) {
        throw new DomainError('DUPLICATE_NAME', `A layout named “${name}” already exists.`);
      }
      return withMutation(state, `Renamed layout to ${name}`, [], action.source ?? 'human', (draft) => {
        const target = draft.layouts.find((candidate) => candidate.id === action.id);
        if (target) target.name = name;
      });
    }
    case 'set-active-layout': {
      if (!state.layouts.some((layout) => layout.id === action.id)) throw new DomainError('LAYOUT_NOT_FOUND', 'The layout does not exist.', [action.id]);
      return withMutation(state, `Switched to ${state.layouts.find((layout) => layout.id === action.id)?.name ?? action.id}`, [], action.source ?? 'human', (draft) => {
        draft.activeLayoutId = action.id;
        draft.selectedIds = ['furn-sofa'];
        draft.focusedId = 'furn-sofa';
      });
    }
    case 'set-route': {
      if (!state.routePoints.some((point) => point.id === action.startId) || !state.routePoints.some((point) => point.id === action.endId)) {
        throw new DomainError('ROUTE_POINT_NOT_FOUND', 'Choose two named route points.');
      }
      if (action.startId === action.endId) throw new DomainError('INVALID_ROUTE', 'Route start and end must be different.');
      const minimumWidth = action.minimumWidth === undefined ? state.brief.minimumWalkingWidth : ensureNumber(action.minimumWidth, 'minimum width', 40);
      return withMutation(state, `Checked ${action.startId} to ${action.endId} route`, [], action.source ?? 'human', (draft) => {
        activeLayout(draft).routeCheck = { startId: action.startId, endId: action.endId, minimumWidth };
      });
    }
    case 'toggle-overlay': {
      return { ...state, overlays: { ...state.overlays, [action.key]: !state.overlays[action.key] } };
    }
    case 'set-measure': {
      return {
        ...state,
        overlays: {
          ...state.overlays,
          measure: {
            active: action.active ?? state.overlays.measure.active,
            points: action.points ?? state.overlays.measure.points,
          },
        },
      };
    }
    case 'set-viewport': {
      return {
        ...state,
        viewport: {
          zoom: clamp(action.viewport.zoom ?? state.viewport.zoom, 0.55, 2.2),
          pan: action.viewport.pan ?? state.viewport.pan,
        },
      };
    }
    case 'undo': {
      const entry = state.history[state.history.length - 1];
      if (!entry) return state;
      const current = makeSnapshot(state);
      const restored = deepClone(entry);
      const next: PlannerState = {
        ...state,
        ...restored,
        history: state.history.slice(0, -1),
        future: [{ ...current, label: entry.label }, ...state.future],
      };
      return recalculate(next);
    }
    case 'redo': {
      const entry = state.future[0];
      if (!entry) return state;
      const current = makeSnapshot(state);
      const restored = deepClone(entry);
      const next: PlannerState = {
        ...state,
        ...restored,
        history: [...state.history, { ...current, label: entry.label }],
        future: state.future.slice(1),
      };
      return recalculate(next);
    }
    default:
      return state;
  }
}

export function getActiveLayout(state: PlannerState): Layout {
  return activeLayout(state);
}

export function summarizeValidation(state: PlannerState) {
  const validation = state.validation;
  return {
    valid: validation.valid,
    collisionCount: validation.collisions.length,
    doorSwingConflictCount: validation.doorSwingConflicts.length,
    clearanceFailureCount: validation.clearanceFailures.length,
    route: validation.route
      ? {
          startId: validation.route.startId,
          endId: validation.route.endId,
          status: validation.route.status,
          distance: Math.round(validation.route.distance),
          blockedSegmentCount: validation.route.blockedSegments.length,
        }
      : null,
    budget: validation.budget,
    issues: validation.issues.slice(0, 8),
  };
}

export function summarizeState(state: PlannerState) {
  const layout = activeLayout(state);
  return {
    project: state.project,
    apartment: state.apartment,
    activeLayout: { id: layout.id, name: layout.name },
    layoutIds: state.layouts.map((candidate) => ({ id: candidate.id, name: candidate.name })),
    wallMeasurements: state.wallMeasurements,
    rooms: state.rooms.map((room) => ({ id: room.id, name: room.name, rect: room.rect })),
    fixedStructureCount: state.fixedStructures.length,
    fixedStructures: state.fixedStructures.slice(0, 40).map((structure) => ({ id: structure.id, kind: structure.kind, name: structure.name, rect: structure.rect, locked: structure.locked })),
    placedFurniture: layout.furniture.map((item) => ({
      id: item.id,
      name: item.name,
      width: item.width,
      depth: item.depth,
      rotation: item.rotation,
      position: item.position,
      cost: item.cost,
      ownership: item.ownership,
      locked: item.locked,
      dimensionStatus: item.dimensionStatus,
    })),
    brief: {
      residents: state.brief.residents,
      routines: state.brief.routines,
      hosting: state.brief.hosting,
      workFromHome: state.brief.workFromHome,
      accessibility: state.brief.accessibility,
      mustKeep: state.brief.mustKeep,
      minimumWalkingWidth: state.brief.minimumWalkingWidth,
      budget: state.brief.budget,
      sourceLabels: state.brief.sources.map((source) => source.label),
    },
    routePoints: state.routePoints,
    validation: summarizeValidation(state),
  };
}

export function listFurniture(state: PlannerState, scope: 'all' | 'my-furniture' | 'library' = 'all', query = '') {
  const normalizedQuery = query.trim().toLowerCase();
  const active = activeLayout(state);
  const placedCatalogueIds = new Set(active.furniture.map((item) => item.catalogueId));
  const placed = active.furniture.filter((item) => item.kind !== 'dining-chair').map((item) => ({
    id: item.id,
    catalogueId: item.catalogueId,
    name: item.name,
    width: item.width,
    depth: item.depth,
    cost: item.cost,
    ownership: item.ownership,
    locked: item.locked,
    dimensionStatus: item.dimensionStatus,
    placed: true,
  }));
  const library = state.catalogue
    .filter((item) => !placedCatalogueIds.has(item.catalogueId) || item.ownership === 'buy')
    .map((item) => ({
      id: item.id,
      catalogueId: item.catalogueId,
      name: item.name,
      width: item.width,
      depth: item.depth,
      cost: item.cost,
      ownership: item.ownership,
      locked: false,
      dimensionStatus: 'confirmed' as const,
      placed: false,
    }));
  return [...(scope === 'library' ? library : scope === 'my-furniture' ? placed : [...placed, ...library])].filter((item) => !normalizedQuery || item.name.toLowerCase().includes(normalizedQuery));
}

export function compareLayouts(state: PlannerState, firstId: string, secondId: string) {
  const first = state.layouts.find((layout) => layout.id === firstId);
  const second = state.layouts.find((layout) => layout.id === secondId);
  if (!first || !second) throw new DomainError('LAYOUT_NOT_FOUND', 'Both layouts must exist.');
  const firstById = new Map(first.furniture.map((item) => [item.id, item]));
  const secondById = new Map(second.furniture.map((item) => [item.id, item]));
  const moved = second.furniture
    .filter((item) => {
      const before = firstById.get(item.id);
      return before && (before.position.x !== item.position.x || before.position.y !== item.position.y || before.rotation !== item.rotation || before.width !== item.width || before.depth !== item.depth);
    })
    .map((item) => ({ id: item.id, name: item.name, from: firstById.get(item.id)?.position, to: item.position }));
  const added = second.furniture.filter((item) => !firstById.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
  const removed = first.furniture.filter((item) => !secondById.has(item.id)).map((item) => ({ id: item.id, name: item.name }));
  const validationA = validateLayout(first.furniture, state.fixedStructures, state.routePoints, state.brief, first.routeCheck, state.apartment);
  const validationB = validateLayout(second.furniture, state.fixedStructures, state.routePoints, state.brief, second.routeCheck, state.apartment);
  return {
    first: { id: first.id, name: first.name, spend: validationA.budget.spend, validation: summarizeValidation({ ...state, activeLayoutId: first.id, validation: validationA }) },
    second: { id: second.id, name: second.name, spend: validationB.budget.spend, validation: summarizeValidation({ ...state, activeLayoutId: second.id, validation: validationB }) },
    moved,
    added,
    removed,
  };
}

export function applyToolAction(state: PlannerState, action: PlannerAction): { state: PlannerState; result: ToolResult } {
  try {
    const next = appReducer(state, action);
    return {
      state: next,
      result: {
        ok: true,
        action: action.type,
        changedIds: next.lastAction?.changedIds ?? [],
        message: next.lastAction?.label ?? 'Read-only action completed.',
        state: summarizeValidation(next),
      },
    };
  } catch (error) {
    if (error instanceof DomainError) {
      return { state, result: { ok: false, action: action.type, message: error.message, error: { code: error.code, message: error.message, affectedIds: error.affectedIds } } };
    }
    return { state, result: { ok: false, action: action.type, message: 'The action could not be completed.', error: { code: 'UNKNOWN_ERROR', message: 'The action could not be completed.' } } };
  }
}

export function kindFromName(name: string): FurnitureKind {
  const normalized = name.toLowerCase();
  if (normalized.includes('sofa')) return 'sofa';
  if (normalized.includes('desk')) return 'desk';
  if (normalized.includes('bed')) return 'queen-bed';
  if (normalized.includes('table')) return 'coffee-table';
  if (normalized.includes('chair')) return 'dining-chair';
  if (normalized.includes('shelf')) return 'bookshelf';
  return 'custom';
}
