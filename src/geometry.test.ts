import { describe, expect, it } from 'vitest';
import { APARTMENT, DEFAULT_BRIEF, FIXED_STRUCTURES, INITIAL_FURNITURE, ROUTE_POINTS, seededValidation } from './data';
import { calculateRoute, furniturePolygon, polygonsIntersect, rectCorners, validateLayout } from './geometry';

describe('deterministic floor geometry', () => {
  it('detects rotated polygon overlap with SAT', () => {
    const first = rectCorners({ x: 100, y: 100 }, 120, 40, 45);
    const second = rectCorners({ x: 145, y: 100 }, 80, 40, -20);
    expect(polygonsIntersect(first, second)).toBe(true);
    expect(polygonsIntersect(first, rectCorners({ x: 400, y: 400 }, 50, 50, 35))).toBe(false);
  });

  it('keeps the seeded apartment valid on first load', () => {
    const validation = seededValidation({ id: 'test', name: 'Layout A', createdAt: '', furniture: INITIAL_FURNITURE, routeCheck: { startId: 'entry', endId: 'sofa', minimumWidth: DEFAULT_BRIEF.minimumWalkingWidth } });
    expect(validation.collisions).toHaveLength(0);
    expect(validation.doorSwingConflicts).toHaveLength(0);
    expect(validation.clearanceFailures).toHaveLength(0);
    expect(validation.route?.status).toBe('clear');
    expect(validation.budget.withinBudget).toBe(true);
    expect(validation.valid).toBe(true);
  });

  it('treats a clearance failure as a visible validation failure', () => {
    const bed = INITIAL_FURNITURE.find((item) => item.id === 'furn-queen-bed')!;
    const bookshelf = INITIAL_FURNITURE.find((item) => item.id === 'furn-bookshelf')!;
    const result = validateLayout(
      [
        { ...bed, position: { x: 720, y: 140 } },
        bookshelf,
      ],
      FIXED_STRUCTURES,
      ROUTE_POINTS,
      DEFAULT_BRIEF,
      { startId: 'entry', endId: 'sofa', minimumWidth: DEFAULT_BRIEF.minimumWalkingWidth },
      APARTMENT,
    );
    expect(result.collisions).toHaveLength(0);
    expect(result.doorSwingConflicts).toHaveLength(0);
    expect(result.clearanceFailures.length).toBeGreaterThan(0);
    expect(result.clearanceFailures[0].severity).toBe('error');
    expect(result.valid).toBe(false);
  });

  it('reports a blocked route when the corridor is filled', () => {
    const blocker = {
      ...INITIAL_FURNITURE[0],
      id: 'corridor-blocker',
      name: 'Corridor blocker',
      kind: 'custom' as const,
      width: 840,
      depth: 520,
      position: { x: 430, y: 275 },
      rotation: 0,
      custom: true,
    };
    const result = calculateRoute(
      [...INITIAL_FURNITURE, blocker],
      FIXED_STRUCTURES,
      ROUTE_POINTS,
      'entry',
      'bathroom',
      72,
      APARTMENT,
    );
    expect(result.status).toBe('blocked');
    expect(result.blockedSegments.length).toBeGreaterThan(0);
  });

  it('separates direct structural collisions from clearances', () => {
    const item = { ...INITIAL_FURNITURE[0], id: 'counter-test', position: { x: 150, y: 465 } };
    const validation = validateLayout([item], FIXED_STRUCTURES, ROUTE_POINTS, DEFAULT_BRIEF, { startId: 'entry', endId: 'sofa', minimumWidth: 72 }, APARTMENT);
    expect(validation.collisions.some((issue) => issue.affectedIds.includes('counter'))).toBe(true);
    expect(validation.issues.every((issue) => issue.affectedIds.length > 0 || issue.type === 'budget')).toBe(true);
    expect(furniturePolygon(item)).toHaveLength(4);
  });
});
