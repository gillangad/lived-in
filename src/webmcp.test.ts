import { describe, expect, it } from 'vitest';
import { registerWebMCPTools, TOOL_DEFINITIONS, executeToolCall } from './webmcp';
import { createInitialState } from './state';

const connectorBrief = {
  residents: 'Two people',
  routines: 'Two adults work from home on weekdays.',
  hosting: 'Host dinner for six twice monthly.',
  workFromHome: 'Two dedicated work-from-home seats.',
  accessibility: 'A parent using a walker visits Sundays.',
  mustKeep: ['Kitchen plumbing', 'Owned queen bed'],
  minimumWalkingWidth: 90,
  budget: 1200,
  notes: 'Keep the entry route legible and do not move plumbing.',
  sources: [
    { type: 'Drive', label: 'Household brief · Sep 2' },
    { type: 'Sheets', label: 'Renovation budget · Sep 2' },
    { type: 'Calendar', label: 'Weekly routines · Sep 2' },
    { type: 'Gmail', label: 'Latest request · Sep 2' },
  ],
};

describe('WebMCP contract', () => {
  it('uses bounded strict schemas for every conceptual operation', () => {
    expect(TOOL_DEFINITIONS).toHaveLength(12);
    expect(new Set(TOOL_DEFINITIONS.map((tool) => tool.name)).size).toBe(12);
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name.length).toBeLessThanOrEqual(30);
      expect(tool.description.length).toBeLessThanOrEqual(500);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    expect(TOOL_DEFINITIONS.filter((tool) => tool.annotations?.readOnlyHint)).toHaveLength(4);
  });

  it('runs the connector-context journey through shared handlers', () => {
    let state = createInitialState();
    let call = executeToolCall(state, 'set_household_brief', connectorBrief);
    expect(call.result.ok).toBe(true);
    state = call.next;
    call = executeToolCall(state, 'create_layout_version', { name: 'Layout B' });
    expect(call.result.ok).toBe(true);
    state = call.next;
    const layoutAId = state.layouts[0].id;
    const layoutBId = state.layouts[1].id;
    call = executeToolCall(state, 'list_furniture', { scope: 'my-furniture' });
    expect(call.result.ok).toBe(true);
    call = executeToolCall(state, 'add_furniture', { catalogueId: 'armchair', position: { x: 300, y: 270 } });
    expect(call.result.ok).toBe(true);
    state = call.next;
    const sofaId = 'furn-sofa';
    call = executeToolCall(state, 'update_furniture', { id: sofaId, position: { x: 170, y: 468 } });
    expect(call.result.ok).toBe(true);
    state = call.next;
    call = executeToolCall(state, 'set_route_check', { startId: 'entry', endId: 'bathroom', minimumWidth: 90 });
    expect(call.result.ok).toBe(true);
    state = call.next;
    call = executeToolCall(state, 'validate_layout', {});
    expect(call.result.ok).toBe(true);
    expect((call.result.state as { budget: { limit: number } }).budget.limit).toBe(1200);
    call = executeToolCall(state, 'compare_layouts', { firstLayoutId: layoutAId, secondLayoutId: layoutBId });
    expect(call.result.ok).toBe(true);
    expect((call.result.state as { moved: unknown[]; added: unknown[] }).moved.length).toBeGreaterThan(0);
    expect((call.result.state as { added: unknown[] }).added.length).toBeGreaterThan(0);
    const bad = executeToolCall(state, 'get_plan_state', { extra: true });
    expect(bad.result.ok).toBe(false);
    expect(bad.result.error?.code).toBe('INVALID_INPUT');
  });

  it('re-registers cleanly after an aborted Strict Mode-style remount', async () => {
    const originalDocument = (globalThis as typeof globalThis & { document?: Document }).document;
    const registered: { name: string; signal?: AbortSignal }[] = [];
    const modelContext = {
      registerTool: async (definition: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
        await Promise.resolve();
        if (options?.signal?.aborted) throw new Error('Registration cancelled');
        registered.push({ name: String(definition.name), signal: options?.signal });
      },
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { modelContext } });
    try {
      const firstController = new AbortController();
      const firstRegistration = registerWebMCPTools(() => createInitialState(), () => undefined, firstController.signal);
      firstController.abort();
      const first = await firstRegistration;
      const secondController = new AbortController();
      const second = await registerWebMCPTools(() => createInitialState(), () => undefined, secondController.signal);

      expect(first.registered).toBe(false);
      expect(second.registered).toBe(true);
      expect(registered).toHaveLength(TOOL_DEFINITIONS.length);
      expect(new Set(registered.map((tool) => tool.name)).size).toBe(TOOL_DEFINITIONS.length);
      secondController.abort();
    } finally {
      if (originalDocument === undefined) Reflect.deleteProperty(globalThis, 'document');
      else Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
    }
  });

  it('confirms a revised dimension for an estimated catalogue item', () => {
    const initial = createInitialState();
    const call = executeToolCall(initial, 'update_furniture', { id: 'furn-bookshelf', width: 240, confirmDimensions: true });
    expect(call.result.ok).toBe(true);
    const bookshelf = call.next.layouts[0].furniture.find((item) => item.id === 'furn-bookshelf');
    expect(bookshelf?.width).toBe(240);
    expect(bookshelf?.depth).toBe(30);
    expect(bookshelf?.dimensionStatus).toBe('confirmed');
  });

  it('propagates a corrected north wall through the canonical plan', () => {
    const initial = createInitialState();
    const call = executeToolCall(initial, 'update_wall_measurement', { wallId: 'wall-top', lengthCm: 840 });
    expect(call.result.ok).toBe(true);
    expect(call.next.apartment.width).toBe(840);
    expect(call.next.wallMeasurements[0].lengthCm).toBe(840);
    expect(call.next.fixedStructures.find((structure) => structure.id === 'wall-right')?.rect?.x).toBe(822);
    expect(call.next.rooms.find((room) => room.id === 'bedroom')?.rect.width).toBe(284);
    expect(call.next.layouts[0].furniture.find((item) => item.id === 'furn-queen-bed')?.position.x).toBe(732);
    expect(call.next.validation.valid).toBe(true);
  });

  it('rejects unsupported or out-of-range wall corrections precisely', () => {
    const initial = createInitialState();
    const badId = executeToolCall(initial, 'update_wall_measurement', { wallId: 'wall-left', lengthCm: 840 });
    expect(badId.result.error?.code).toBe('WALL_NOT_SUPPORTED');
    const badRange = executeToolCall(initial, 'update_wall_measurement', { wallId: 'wall-top', lengthCm: 500 });
    expect(badRange.result.error?.code).toBe('INVALID_WALL_MEASUREMENT');
    expect(badRange.result.message).toContain('760 and 960');
  });
});
