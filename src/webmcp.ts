import { compareLayouts, DomainError, getActiveLayout, listFurniture, applyToolAction, summarizeState, summarizeValidation } from './state';
import type { PlannerAction, PlannerState, ToolResult } from './types';

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
};

type SourceInput = { type: string; label: string };
type ToolCall = { next: PlannerState; result: ToolResult };

declare global {
  interface Document {
    modelContext?: {
      registerTool: (definition: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<void> | void;
    };
  }
}

const emptySchema = (): Record<string, unknown> => ({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_plan_state',
    title: 'Read plan state',
    description: 'Read the bounded measured apartment plan, active layout, brief summary, route points, budget, and validation.',
    inputSchema: emptySchema(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_furniture',
    title: 'List furniture',
    description: 'List placed or library furniture with stable IDs, centimetre dimensions, cost, ownership, lock, and estimate status.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all', 'my-furniture', 'library'], description: 'Which furniture collection to list.' },
        query: { type: 'string', maxLength: 80, description: 'Optional name filter.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'set_household_brief',
    title: 'Set household brief',
    description: 'Apply distilled household and connector context to the visible brief and recompute walking and budget checks.',
    inputSchema: {
      type: 'object',
      properties: {
        residents: { type: 'string', maxLength: 240, description: 'Who lives in or regularly uses the home.' },
        routines: { type: 'string', maxLength: 320, description: 'Typical weekly routines that affect placement.' },
        hosting: { type: 'string', maxLength: 240, description: 'Hosting frequency and party size.' },
        workFromHome: { type: 'string', maxLength: 240, description: 'Work-from-home needs.' },
        accessibility: { type: 'string', maxLength: 240, description: 'Accessibility needs and visitors.' },
        mustKeep: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 8, description: 'Items or locations to preserve.' },
        minimumWalkingWidth: { type: 'number', minimum: 40, maximum: 180, description: 'Minimum walking width in centimetres.' },
        budget: { type: 'number', minimum: 0, maximum: 100000, description: 'Maximum planned purchase spend in dollars.' },
        notes: { type: 'string', maxLength: 500, description: 'Other concise planning notes.' },
        sources: { type: 'array', maxItems: 8, items: { type: 'object', properties: { type: { type: 'string', maxLength: 40 }, label: { type: 'string', maxLength: 100 } }, required: ['type', 'label'], additionalProperties: false }, description: 'Small source labels from connector context.' },
      },
      required: ['residents', 'routines', 'hosting', 'workFromHome', 'accessibility', 'mustKeep', 'minimumWalkingWidth', 'budget', 'notes', 'sources'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_wall_measurement',
    title: 'Update wall measurement',
    description: 'Correct the north exterior wall measurement and adapt the shared plan. Prompt: "Wait, I remeasured the north exterior wall. It is 840 centimetres, not 860. Correct the plan and adapt anything that no longer fits."',
    inputSchema: {
      type: 'object',
      properties: {
        wallId: { type: 'string', enum: ['wall-top'], maxLength: 40, description: 'Stable wall ID; wall-top is the north exterior wall.' },
        lengthCm: { type: 'number', minimum: 760, maximum: 960, description: 'Corrected wall length in centimetres.' },
      },
      required: ['wallId', 'lengthCm'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_layout_version',
    title: 'Create layout version',
    description: 'Duplicate a named source layout into a new editable version and switch the visible plan to it.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60, description: 'New layout name.' },
        sourceLayoutId: { type: 'string', maxLength: 80, description: 'Optional stable source layout ID; defaults to the active layout.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_furniture',
    title: 'Add furniture',
    description: 'Place a library item or explicit custom furniture in the measured plan using the shared visible action layer.',
    inputSchema: {
      type: 'object',
      properties: {
        catalogueId: { type: 'string', maxLength: 80, description: 'Stable library item ID.' },
        custom: { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, width: { type: 'number', minimum: 10, maximum: 500 }, depth: { type: 'number', minimum: 10, maximum: 500 }, cost: { type: 'number', minimum: 0, maximum: 100000 }, ownership: { type: 'string', enum: ['owned', 'buy'] } }, required: ['name', 'width', 'depth'], additionalProperties: false, description: 'Explicit custom item when no catalogue ID is supplied.' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false, description: 'Centre position in centimetres.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'update_furniture',
    title: 'Update furniture',
    description: 'Move, rotate, resize custom furniture, confirm estimated dimensions, lock or unlock, or adjust cost by stable ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', maxLength: 80, description: 'Stable placed furniture ID.' },
        position: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'], additionalProperties: false, description: 'New centre position in centimetres.' },
        rotation: { type: 'number', minimum: 0, maximum: 359, description: 'New rotation in degrees.' },
        width: { type: 'number', minimum: 10, maximum: 500, description: 'New width; confirmDimensions is required for catalogue items.' },
        depth: { type: 'number', minimum: 10, maximum: 500, description: 'New depth; confirmDimensions is required for catalogue items.' },
        locked: { type: 'boolean', description: 'Whether the item should be locked.' },
        cost: { type: 'number', minimum: 0, maximum: 100000, description: 'Purchase cost in dollars.' },
        confirmDimensions: { type: 'boolean', description: 'Mark the current or supplied dimensions as confirmed.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_furniture',
    title: 'Remove furniture',
    description: 'Remove one unlocked placed furniture item by stable ID; the visible plan keeps the change undoable.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', maxLength: 80, description: 'Stable placed furniture ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_route_check',
    title: 'Check a route',
    description: 'Set named start and end points plus a minimum width, then display and recompute the route overlay.',
    inputSchema: {
      type: 'object',
      properties: {
        startId: { type: 'string', maxLength: 40, description: 'Stable named route point ID.' },
        endId: { type: 'string', maxLength: 40, description: 'Stable named route point ID.' },
        minimumWidth: { type: 'number', minimum: 40, maximum: 180, description: 'Walking width in centimetres.' },
      },
      required: ['startId', 'endId'],
      additionalProperties: false,
    },
  },
  {
    name: 'validate_layout',
    title: 'Validate layout',
    description: 'Return deterministic collisions, door-swing conflicts, clearance failures, route result, assumptions, budget, and affected IDs.',
    inputSchema: emptySchema(),
    annotations: { readOnlyHint: true },
  },
  {
    name: 'compare_layouts',
    title: 'Compare layouts',
    description: 'Compare two layout versions by moved, added, and removed items plus validation and budget summaries.',
    inputSchema: {
      type: 'object',
      properties: {
        firstLayoutId: { type: 'string', maxLength: 80, description: 'First layout ID.' },
        secondLayoutId: { type: 'string', maxLength: 80, description: 'Second layout ID.' },
      },
      required: ['firstLayoutId', 'secondLayoutId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'set_active_layout',
    title: 'Switch active layout',
    description: 'Switch the visible plan to an existing layout version by stable ID.',
    inputSchema: {
      type: 'object',
      properties: { layoutId: { type: 'string', maxLength: 80, description: 'Layout ID to show.' } },
      required: ['layoutId'],
      additionalProperties: false,
    },
  },
];

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertKeys(input: unknown, allowed: string[]): Record<string, any> {
  if (!isRecord(input)) throw new DomainError('INVALID_INPUT', 'Tool input must be a JSON object.');
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new DomainError('INVALID_INPUT', `Unexpected input field “${unknown[0]}”.`);
  return input;
}

function requiredString(input: Record<string, any>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new DomainError('INVALID_INPUT', `“${key}” is required.`);
  return value.trim();
}

function optionalString(input: Record<string, any>, key: string, max = 500): string | undefined {
  if (input[key] === undefined) return undefined;
  if (typeof input[key] !== 'string' || input[key].length > max) throw new DomainError('INVALID_INPUT', `“${key}” must be a short string.`);
  return input[key];
}

function requiredFiniteNumber(input: Record<string, any>, key: string, min?: number, max?: number): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max)) {
    throw new DomainError('INVALID_INPUT', `“${key}” must be a finite number in range.`);
  }
  return value;
}

function optionalFiniteNumber(input: Record<string, any>, key: string, min?: number, max?: number): number | undefined {
  if (input[key] === undefined) return undefined;
  return requiredFiniteNumber(input, key, min, max);
}

function sourceList(value: unknown): SourceInput[] {
  if (!Array.isArray(value) || value.length > 8) throw new DomainError('INVALID_INPUT', '“sources” must be a short list.');
  return value.map((source) => {
    if (!isRecord(source) || typeof source.type !== 'string' || typeof source.label !== 'string') throw new DomainError('INVALID_INPUT', 'Each source needs a type and label.');
    return { type: source.type.slice(0, 40), label: source.label.slice(0, 100) };
  });
}

function mutationResult(next: PlannerState, message: string, changedIds: string[] = []): ToolResult {
  return {
    ok: true,
    action: 'mutation',
    changedIds,
    message,
    state: {
      activeLayout: { id: getActiveLayout(next).id, name: getActiveLayout(next).name },
      wallMeasurements: next.wallMeasurements,
      validation: summarizeValidation(next),
    },
  };
}

function executeToolCallInternal(state: PlannerState, name: string, rawInput: unknown): ToolCall {
  switch (name) {
    case 'get_plan_state': {
      assertKeys(rawInput, []);
      return { next: state, result: { ok: true, action: name, message: 'Plan state read.', state: summarizeState(state) } };
    }
    case 'list_furniture': {
      const input = assertKeys(rawInput, ['scope', 'query']);
      const scope = input.scope ?? 'all';
      if (!['all', 'my-furniture', 'library'].includes(scope)) throw new DomainError('INVALID_INPUT', '“scope” is not supported.');
      const query = optionalString(input, 'query', 80) ?? '';
      const items = listFurniture(state, scope, query);
      return { next: state, result: { ok: true, action: name, message: `${items.length} furniture items found.`, state: { resultCount: items.length, items: items.slice(0, 30) } } };
    }
    case 'set_household_brief': {
      const input = assertKeys(rawInput, ['residents', 'routines', 'hosting', 'workFromHome', 'accessibility', 'mustKeep', 'minimumWalkingWidth', 'budget', 'notes', 'sources']);
      if (!Array.isArray(input.mustKeep) || input.mustKeep.length > 8 || input.mustKeep.some((item: unknown) => typeof item !== 'string')) throw new DomainError('INVALID_INPUT', '“mustKeep” must be a short string list.');
      const brief = {
        residents: requiredString(input, 'residents'),
        routines: requiredString(input, 'routines'),
        hosting: requiredString(input, 'hosting'),
        workFromHome: requiredString(input, 'workFromHome'),
        accessibility: requiredString(input, 'accessibility'),
        mustKeep: input.mustKeep.map((item: string) => item.slice(0, 120)),
        minimumWalkingWidth: requiredFiniteNumber(input, 'minimumWalkingWidth', 40, 180),
        budget: requiredFiniteNumber(input, 'budget', 0, 100000),
        notes: requiredString(input, 'notes'),
        sources: sourceList(input.sources),
      };
      const action: PlannerAction = { type: 'set-brief', brief, source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, 'Updated household brief from connector context.') : outcome.result };
    }
    case 'update_wall_measurement': {
      const input = assertKeys(rawInput, ['wallId', 'lengthCm']);
      const wallId = requiredString(input, 'wallId');
      if (wallId !== 'wall-top') throw new DomainError('WALL_NOT_SUPPORTED', 'Only wallId “wall-top” (North exterior wall) is supported in this demo.', [wallId]);
      const lengthCm = input.lengthCm;
      if (typeof lengthCm !== 'number' || !Number.isFinite(lengthCm) || lengthCm < 760 || lengthCm > 960) {
        throw new DomainError('INVALID_WALL_MEASUREMENT', 'lengthCm must be a finite number between 760 and 960 cm.', [wallId]);
      }
      const outcome = applyToolAction(state, { type: 'update-wall-measurement', wallId, lengthCm, source: 'agent' });
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, outcome.state.lastAction?.label ?? 'Updated wall measurement.', outcome.state.lastAction?.changedIds) : outcome.result };
    }
    case 'create_layout_version': {
      const input = assertKeys(rawInput, ['name', 'sourceLayoutId']);
      const action: PlannerAction = { type: 'create-layout', name: requiredString(input, 'name'), sourceLayoutId: optionalString(input, 'sourceLayoutId', 80), source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, `Created ${requiredString(input, 'name')} layout version.`, outcome.state.lastAction?.changedIds) : outcome.result };
    }
    case 'add_furniture': {
      const input = assertKeys(rawInput, ['catalogueId', 'custom', 'position']);
      const catalogueId = optionalString(input, 'catalogueId', 80);
      const custom = input.custom;
      if (!catalogueId && !isRecord(custom)) throw new DomainError('INVALID_INPUT', 'Provide either “catalogueId” or “custom”.');
      if (catalogueId && custom) throw new DomainError('INVALID_INPUT', 'Provide only one of “catalogueId” or “custom”.');
      let item: Extract<PlannerAction, { type: 'add-furniture' }>['item'];
      if (custom) {
        const customInput = assertKeys(custom, ['name', 'width', 'depth', 'cost', 'ownership']);
        item = {
          name: requiredString(customInput, 'name'),
          width: requiredFiniteNumber(customInput, 'width', 10, 500),
          depth: requiredFiniteNumber(customInput, 'depth', 10, 500),
          cost: optionalFiniteNumber(customInput, 'cost', 0, 100000) ?? 0,
          ownership: customInput.ownership === undefined ? 'buy' : customInput.ownership,
        };
        if (item.ownership !== 'owned' && item.ownership !== 'buy') throw new DomainError('INVALID_INPUT', '“ownership” must be owned or buy.');
      }
      let position: { x: number; y: number } | undefined;
      if (input.position !== undefined) {
        const positionInput = assertKeys(input.position, ['x', 'y']);
        position = { x: requiredFiniteNumber(positionInput, 'x'), y: requiredFiniteNumber(positionInput, 'y') };
      }
      const action: PlannerAction = { type: 'add-furniture', templateId: catalogueId, item, position, source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, outcome.state.lastAction?.label ?? 'Added furniture.', outcome.state.lastAction?.changedIds) : outcome.result };
    }
    case 'update_furniture': {
      const input = assertKeys(rawInput, ['id', 'position', 'rotation', 'width', 'depth', 'locked', 'cost', 'confirmDimensions']);
      const id = requiredString(input, 'id');
      const actions: PlannerAction[] = [];
      if (input.position !== undefined) {
        const positionInput = assertKeys(input.position, ['x', 'y']);
        actions.push({ type: 'move-furniture', id, position: { x: requiredFiniteNumber(positionInput, 'x'), y: requiredFiniteNumber(positionInput, 'y') }, source: 'agent' });
      }
      const rotation = optionalFiniteNumber(input, 'rotation', 0, 359);
      if (rotation !== undefined) actions.push({ type: 'rotate-furniture', id, rotation, source: 'agent' });
      if (input.confirmDimensions !== undefined && typeof input.confirmDimensions !== 'boolean') throw new DomainError('INVALID_INPUT', '“confirmDimensions” must be a boolean.');
      const confirmDimensions = input.confirmDimensions === true;
      if (input.width !== undefined || input.depth !== undefined) {
        const current = getActiveLayout(state).furniture.find((item) => item.id === id);
        if (!current) throw new DomainError('FURNITURE_NOT_FOUND', `No placed furniture has the ID “${id}”.`, [id]);
        const width = optionalFiniteNumber(input, 'width', 10, 500) ?? current.width;
        const depth = optionalFiniteNumber(input, 'depth', 10, 500) ?? current.depth;
        actions.push(confirmDimensions
          ? { type: 'confirm-dimensions', id, width, depth, source: 'agent' }
          : { type: 'resize-furniture', id, width, depth, source: 'agent' });
      }
      if (input.locked !== undefined) {
        if (typeof input.locked !== 'boolean') throw new DomainError('INVALID_INPUT', '“locked” must be a boolean.');
        actions.push({ type: 'set-furniture-lock', id, locked: input.locked, source: 'agent' });
      }
      const cost = optionalFiniteNumber(input, 'cost', 0, 100000);
      if (cost !== undefined) actions.push({ type: 'update-furniture-cost', id, cost, source: 'agent' });
      if (confirmDimensions && input.width === undefined && input.depth === undefined) {
        actions.push({ type: 'confirm-dimensions', id, source: 'agent' });
      }
      if (!actions.length) throw new DomainError('INVALID_INPUT', 'Provide one furniture change.');
      let currentState = state;
      for (const action of actions) {
        const outcome = applyToolAction(currentState, action);
        if (!outcome.result.ok) return { next: currentState, result: outcome.result };
        currentState = outcome.state;
      }
      return { next: currentState, result: mutationResult(currentState, currentState.lastAction?.label ?? 'Updated furniture.', currentState.lastAction?.changedIds) };
    }
    case 'remove_furniture': {
      const input = assertKeys(rawInput, ['id']);
      const action: PlannerAction = { type: 'remove-furniture', id: requiredString(input, 'id'), source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, outcome.state.lastAction?.label ?? 'Removed furniture.', outcome.state.lastAction?.changedIds) : outcome.result };
    }
    case 'set_route_check': {
      const input = assertKeys(rawInput, ['startId', 'endId', 'minimumWidth']);
      const action: PlannerAction = { type: 'set-route', startId: requiredString(input, 'startId'), endId: requiredString(input, 'endId'), minimumWidth: optionalFiniteNumber(input, 'minimumWidth', 40, 180), source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, outcome.state.lastAction?.label ?? 'Checked route.', []) : outcome.result };
    }
    case 'validate_layout': {
      assertKeys(rawInput, []);
      return { next: state, result: { ok: true, action: name, message: state.validation.valid ? 'Layout passes deterministic checks.' : 'Layout needs attention.', state: { ...summarizeValidation(state), collisions: state.validation.collisions.slice(0, 12), doorSwingConflicts: state.validation.doorSwingConflicts.slice(0, 12), clearanceFailures: state.validation.clearanceFailures.slice(0, 12), route: state.validation.route, assumptions: state.validation.assumptions } } };
    }
    case 'compare_layouts': {
      const input = assertKeys(rawInput, ['firstLayoutId', 'secondLayoutId']);
      const result = compareLayouts(state, requiredString(input, 'firstLayoutId'), requiredString(input, 'secondLayoutId'));
      return { next: state, result: { ok: true, action: name, message: `Compared ${result.first.name} with ${result.second.name}.`, state: result } };
    }
    case 'set_active_layout': {
      const input = assertKeys(rawInput, ['layoutId']);
      const action: PlannerAction = { type: 'set-active-layout', id: requiredString(input, 'layoutId'), source: 'agent' };
      const outcome = applyToolAction(state, action);
      return { next: outcome.state, result: outcome.result.ok ? mutationResult(outcome.state, outcome.state.lastAction?.label ?? 'Switched layout.', []) : outcome.result };
    }
    default:
      return { next: state, result: { ok: false, message: `Unknown tool “${name}”.`, error: { code: 'UNKNOWN_TOOL', message: `Unknown tool “${name}”.` } } };
  }
}

export function executeToolCall(state: PlannerState, name: string, rawInput: unknown): ToolCall {
  try {
    return executeToolCallInternal(state, name, rawInput);
  } catch (error) {
    if (error instanceof DomainError) {
      return { next: state, result: { ok: false, message: error.message, error: { code: error.code, message: error.message, affectedIds: error.affectedIds } } };
    }
    return { next: state, result: { ok: false, message: 'Tool input could not be processed.', error: { code: 'INVALID_INPUT', message: 'Tool input could not be processed.' } } };
  }
}

export function createToolBridge(getState: () => PlannerState, commit: (state: PlannerState) => void) {
  const invoke = async (name: string, input: unknown): Promise<ToolResult> => {
    try {
      const call = executeToolCall(getState(), name, input);
      if (call.next !== getState()) commit(call.next);
      return call.result;
    } catch (error) {
      if (error instanceof DomainError) return { ok: false, message: error.message, error: { code: error.code, message: error.message, affectedIds: error.affectedIds } };
      return { ok: false, message: 'Tool input could not be processed.', error: { code: 'INVALID_INPUT', message: 'Tool input could not be processed.' } };
    }
  };
  return { invoke, definitions: TOOL_DEFINITIONS };
}

export async function registerWebMCPTools(
  getState: () => PlannerState,
  commit: (state: PlannerState) => void,
  signal?: AbortSignal,
): Promise<{ supported: boolean; registered: boolean; error?: string; cleanup: () => void }> {
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return { supported: false, registered: false, cleanup: () => undefined };
  const controller = signal ? undefined : new AbortController();
  const registrationSignal = signal ?? controller!.signal;
  const bridge = createToolBridge(getState, commit);
  try {
    for (const definition of TOOL_DEFINITIONS) {
      if (registrationSignal.aborted) throw new Error('Registration cancelled');
      await modelContext.registerTool(
        {
          ...definition,
          execute: async (input: unknown) => bridge.invoke(definition.name, input),
        },
        { signal: registrationSignal },
      );
    }
    if (registrationSignal.aborted) throw new Error('Registration cancelled');
    return { supported: true, registered: true, cleanup: () => { controller?.abort(); } };
  } catch (error) {
    controller?.abort();
    return { supported: true, registered: false, error: error instanceof Error ? error.message : 'Registration failed', cleanup: () => undefined };
  }
}
