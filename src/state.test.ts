import { describe, expect, it } from 'vitest';
import { appReducer, createInitialState, DomainError, getActiveLayout, summarizeState } from './state';

describe('canonical planner actions', () => {
  it('moves into an obstacle, exposes the collision, and undoes cleanly', () => {
    const initial = createInitialState();
    const moved = appReducer(initial, { type: 'move-furniture', id: 'furn-sofa', position: { x: 170, y: 468 } });
    expect(moved.validation.collisions.some((issue) => issue.affectedIds.includes('furn-sofa'))).toBe(true);
    expect(moved.history).toHaveLength(1);
    const restored = appReducer(moved, { type: 'undo' });
    expect(restored.validation.valid).toBe(true);
    expect(getActiveLayout(restored).furniture.find((item) => item.id === 'furn-sofa')?.position).toEqual({ x: 350, y: 190 });
    expect(restored.future).toHaveLength(1);
  });

  it('rejects movement of fixed/locked furniture precisely', () => {
    expect(() => appReducer(createInitialState(), { type: 'move-furniture', id: 'furn-queen-bed', position: { x: 650, y: 140 } })).toThrowError(DomainError);
    try {
      appReducer(createInitialState(), { type: 'move-furniture', id: 'furn-queen-bed', position: { x: 650, y: 140 } });
    } catch (error) {
      expect((error as DomainError).code).toBe('LOCKED_ITEM');
    }
  });

  it('preserves Layout A while creating, editing, and comparing Layout B', () => {
    const initial = createInitialState();
    const withB = appReducer(initial, { type: 'create-layout', name: 'Layout B' });
    const edited = appReducer(withB, { type: 'move-furniture', id: 'furn-sofa', position: { x: 350, y: 185 } });
    const b = getActiveLayout(edited);
    expect(edited.layouts).toHaveLength(2);
    expect(edited.layouts[0].name).toBe('Layout A');
    expect(edited.layouts[0].furniture.find((item) => item.id === 'furn-sofa')?.position).toEqual({ x: 350, y: 190 });
    expect(b.furniture.find((item) => item.id === 'furn-sofa')?.position).toEqual({ x: 350, y: 185 });
    const summary = summarizeState(edited);
    expect(summary.activeLayout.name).toBe('Layout B');
  });

  it('adds and resizes custom furniture and updates the budget', () => {
    const initial = createInitialState();
    const added = appReducer(initial, { type: 'add-furniture', item: { name: 'Entry bench', width: 90, depth: 35, position: { x: 460, y: 470 }, cost: 220, ownership: 'buy' } });
    const item = getActiveLayout(added).furniture.find((candidate) => candidate.name === 'Entry bench');
    expect(item?.dimensionStatus).toBe('estimated');
    expect(added.validation.budget.spend).toBe(220);
    const resized = appReducer(added, { type: 'resize-furniture', id: item!.id, width: 100, depth: 40 });
    expect(getActiveLayout(resized).furniture.find((candidate) => candidate.id === item!.id)?.width).toBe(100);
  });
});
