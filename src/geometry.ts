import type {
  FixedStructure,
  Furniture,
  HouseholdBrief,
  Point,
  Rect,
  RoutePoint,
  RouteResult,
  ValidationIssue,
  ValidationResult,
} from './types';

const EPSILON = 0.0001;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function rectCorners(
  center: Point,
  width: number,
  height: number,
  rotation = 0,
): Point[] {
  const angle = (normalizeRotation(rotation) * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const local = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];
  return local.map((point) => ({
    x: center.x + point.x * cos - point.y * sin,
    y: center.y + point.x * sin + point.y * cos,
  }));
}

export function polygonBounds(polygon: Point[]): Rect {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function projectPolygon(polygon: Point[], axis: Point): { min: number; max: number } {
  const values = polygon.map((point) => point.x * axis.x + point.y * axis.y);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function axesForPolygon(polygon: Point[]): Point[] {
  return polygon.map((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    const edge = { x: next.x - point.x, y: next.y - point.y };
    const length = Math.hypot(edge.x, edge.y) || 1;
    return { x: -edge.y / length, y: edge.x / length };
  });
}

/** Convex polygon SAT with touching edges treated as a collision. */
export function polygonsIntersect(first: Point[], second: Point[]): boolean {
  const axes = [...axesForPolygon(first), ...axesForPolygon(second)];
  return axes.every((axis) => {
    const a = projectPolygon(first, axis);
    const b = projectPolygon(second, axis);
    return a.max >= b.min - EPSILON && b.max >= a.min - EPSILON;
  });
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; i += 1, j = i - 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y || EPSILON) +
          current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function furniturePolygon(item: Furniture): Point[] {
  return rectCorners(item.position, item.width, item.depth, item.rotation);
}

export function furnitureClearancePolygon(item: Furniture, minimumWalkingWidth: number): Point[] {
  const horizontal = Math.max(item.clearance.left, item.clearance.right) * 2;
  const vertical = Math.max(item.clearance.front, item.clearance.back) * 2;
  return rectCorners(
    item.position,
    item.width + horizontal + minimumWalkingWidth,
    item.depth + vertical + minimumWalkingWidth,
    item.rotation,
  );
}

export function structurePolygon(structure: FixedStructure): Point[] | null {
  if (structure.rect) {
    const center = {
      x: structure.rect.x + structure.rect.width / 2,
      y: structure.rect.y + structure.rect.height / 2,
    };
    return rectCorners(center, structure.rect.width, structure.rect.height, structure.rotation);
  }
  return structure.points ?? null;
}

function isSolidStructure(structure: FixedStructure): boolean {
  return (
    structure.kind === 'outer-wall' ||
    structure.kind === 'partition' ||
    structure.kind === 'counter' ||
    structure.kind === 'plumbing' ||
    structure.kind === 'fixture'
  );
}

function isDoorSwing(structure: FixedStructure): boolean {
  return structure.kind === 'door';
}

type GridNode = { x: number; y: number };

function key(node: GridNode): string {
  return `${node.x}:${node.y}`;
}

function nearestGridNode(point: Point, cellSize: number, width: number, height: number): GridNode {
  return {
    x: clamp(Math.round(point.x / cellSize), 0, Math.floor(width / cellSize)),
    y: clamp(Math.round(point.y / cellSize), 0, Math.floor(height / cellSize)),
  };
}

function nodePoint(node: GridNode, cellSize: number): Point {
  return { x: node.x * cellSize, y: node.y * cellSize };
}

function routeNodes(
  start: Point,
  end: Point,
  obstacles: Point[][],
  width: number,
  height: number,
  cellSize: number,
): { nodes: GridNode[]; blocked: boolean } {
  const maxX = Math.floor(width / cellSize);
  const maxY = Math.floor(height / cellSize);
  const startNode = nearestGridNode(start, cellSize, width, height);
  const endNode = nearestGridNode(end, cellSize, width, height);
  const blocked = (node: GridNode): boolean => {
    if (key(node) === key(startNode) || key(node) === key(endNode)) return false;
    const point = nodePoint(node, cellSize);
    return obstacles.some((polygon) => pointInPolygon(point, polygon));
  };
  const queue: GridNode[] = [startNode];
  const previous = new Map<string, GridNode | null>([[key(startNode), null]]);
  const directions = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor++];
    if (key(current) === key(endNode)) break;
    for (const direction of directions) {
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (
        next.x < 0 ||
        next.y < 0 ||
        next.x > maxX ||
        next.y > maxY ||
        blocked(next) ||
        previous.has(key(next))
      ) {
        continue;
      }
      previous.set(key(next), current);
      queue.push(next);
    }
  }
  if (!previous.has(key(endNode))) return { nodes: [], blocked: true };
  const path: GridNode[] = [];
  let current: GridNode | null = endNode;
  while (current) {
    path.push(current);
    current = previous.get(key(current)) ?? null;
  }
  return { nodes: path.reverse(), blocked: false };
}

function compressRoute(points: Point[]): Point[] {
  if (points.length < 3) return points;
  const compressed: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = compressed[compressed.length - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstDirection = { x: Math.sign(current.x - previous.x), y: Math.sign(current.y - previous.y) };
    const secondDirection = { x: Math.sign(next.x - current.x), y: Math.sign(next.y - current.y) };
    if (firstDirection.x !== secondDirection.x || firstDirection.y !== secondDirection.y) {
      compressed.push(current);
    }
  }
  compressed.push(points[points.length - 1]);
  return compressed;
}

export function calculateRoute(
  layoutFurniture: Furniture[],
  structures: FixedStructure[],
  routePoints: RoutePoint[],
  startId: string,
  endId: string,
  minimumWidth: number,
  apartment: { width: number; height: number },
): RouteResult {
  const start = routePoints.find((point) => point.id === startId);
  const end = routePoints.find((point) => point.id === endId);
  if (!start || !end) {
    return {
      startId,
      endId,
      minimumWidth,
      status: 'blocked',
      points: [],
      blockedSegments: [{ from: start?.position ?? { x: 0, y: 0 }, to: end?.position ?? { x: 0, y: 0 }, reason: 'Unknown route point' }],
      distance: 0,
    };
  }
  const solidObstacles = structures
    .filter((structure) => isSolidStructure(structure) || isDoorSwing(structure))
    .map(structurePolygon)
    .filter((polygon): polygon is Point[] => Boolean(polygon));
  const destinationFurnitureIds = new Set(
    layoutFurniture
      .filter((item) => distance(item.position, start.position) < Math.max(item.width, item.depth) / 2 || distance(item.position, end.position) < Math.max(item.width, item.depth) / 2)
      .map((item) => item.id),
  );
  const furnitureObstacles = layoutFurniture
    .filter((item) => !destinationFurnitureIds.has(item.id))
    .map((item) => furnitureClearancePolygon(item, minimumWidth));
  const search = routeNodes(
    start.position,
    end.position,
    [...solidObstacles, ...furnitureObstacles],
    apartment.width,
    apartment.height,
    20,
  );
  if (search.blocked) {
    return {
      startId,
      endId,
      minimumWidth,
      status: 'blocked',
      points: [start.position, end.position],
      blockedSegments: [{ from: start.position, to: end.position, reason: 'No continuous path at the configured walking width' }],
      distance: distance(start.position, end.position),
    };
  }
  const rawPoints = search.nodes.map((node) => nodePoint(node, 20));
  const points = compressRoute([start.position, ...rawPoints.slice(1, -1), end.position]);
  const blockedSegments: RouteResult['blockedSegments'] = [];
  return {
    startId,
    endId,
    minimumWidth,
    status: blockedSegments.length > 2 ? 'narrow' : 'clear',
    points,
    blockedSegments,
    distance: points.reduce((sum, point, index) => (index ? sum + distance(point, points[index - 1]) : sum), 0),
  };
}

function issue(
  id: string,
  type: ValidationIssue['type'],
  severity: ValidationIssue['severity'],
  message: string,
  affectedIds: string[],
): ValidationIssue {
  return { id, type, severity, message, affectedIds };
}

export function validateLayout(
  furniture: Furniture[],
  structures: FixedStructure[],
  routePoints: RoutePoint[],
  brief: HouseholdBrief,
  routeCheck: { startId: string; endId: string; minimumWidth: number },
  apartment: { width: number; height: number },
): ValidationResult {
  const collisions: ValidationIssue[] = [];
  const doorSwingConflicts: ValidationIssue[] = [];
  const clearanceFailures: ValidationIssue[] = [];
  const solidStructures = structures.filter(isSolidStructure);
  const doors = structures.filter(isDoorSwing);
  const polygons = new Map(furniture.map((item) => [item.id, furniturePolygon(item)]));

  for (let firstIndex = 0; firstIndex < furniture.length; firstIndex += 1) {
    const first = furniture[firstIndex];
    const firstPolygon = polygons.get(first.id);
    if (!firstPolygon) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < furniture.length; secondIndex += 1) {
      const second = furniture[secondIndex];
      if ((first.kind === 'dining-chair' && second.kind === 'dining-table') || (first.kind === 'dining-table' && second.kind === 'dining-chair')) continue;
      const secondPolygon = polygons.get(second.id);
      if (secondPolygon && polygonsIntersect(firstPolygon, secondPolygon)) {
        collisions.push(
          issue(
            `collision-${first.id}-${second.id}`,
            'collision',
            'error',
            `${first.name} overlaps ${second.name}`,
            [first.id, second.id],
          ),
        );
      }
    }
    for (const structure of solidStructures) {
      const structureShape = structurePolygon(structure);
      if (structureShape && polygonsIntersect(firstPolygon, structureShape)) {
        collisions.push(
          issue(
            `collision-${first.id}-${structure.id}`,
            'collision',
            'error',
            `${first.name} overlaps fixed ${structure.name.toLowerCase()}`,
            [first.id, structure.id],
          ),
        );
      }
    }
    for (const door of doors) {
      const doorShape = structurePolygon(door);
      if (doorShape && polygonsIntersect(firstPolygon, doorShape)) {
        doorSwingConflicts.push(
          issue(
            `door-${first.id}-${door.id}`,
            'door-swing',
            'error',
            `${first.name} blocks the ${door.name.toLowerCase()}`,
            [first.id, door.id],
          ),
        );
      }
    }
  }

  for (let index = 0; index < furniture.length; index += 1) {
    const item = furniture[index];
    const clearanceShape = furnitureClearancePolygon(item, brief.minimumWalkingWidth);
    for (let otherIndex = index + 1; otherIndex < furniture.length; otherIndex += 1) {
      const other = furniture[otherIndex];
      if (item.kind === 'dining-chair' || other.kind === 'dining-chair') continue;
      if (polygonsIntersect(clearanceShape, polygons.get(other.id) ?? [])) {
        clearanceFailures.push(
          issue(
            `clearance-${item.id}-${other.id}`,
            'clearance',
            'error',
            `${item.name} leaves less than ${brief.minimumWalkingWidth} cm to ${other.name.toLowerCase()}`,
            [item.id, other.id],
          ),
        );
      }
    }
  }

  const route = calculateRoute(
    furniture,
    structures,
    routePoints,
    routeCheck.startId,
    routeCheck.endId,
    routeCheck.minimumWidth,
    apartment,
  );
  const routeIssues: ValidationIssue[] = [];
  if (route.status !== 'clear') {
    routeIssues.push(
      issue(
        'route-current',
        'route',
        route.status === 'blocked' ? 'error' : 'warning',
        route.status === 'blocked'
          ? `Route from ${routeCheck.startId} to ${routeCheck.endId} is blocked`
          : `Route from ${routeCheck.startId} to ${routeCheck.endId} is narrow`,
        [routeCheck.startId, routeCheck.endId],
      ),
    );
  }
  const spend = furniture.reduce((sum, item) => sum + (item.ownership === 'buy' ? item.cost : 0), 0);
  const budgetIssue =
    spend > brief.budget
      ? [issue('budget-limit', 'budget', 'error', `Planned purchases exceed the ${formatCurrency(brief.budget)} budget`, [])]
      : [];
  const allIssues = [...collisions, ...doorSwingConflicts, ...clearanceFailures, ...routeIssues, ...budgetIssue];
  return {
    valid: allIssues.every((item) => item.severity !== 'error'),
    issues: allIssues,
    collisions,
    doorSwingConflicts,
    clearanceFailures,
    route: {
      ...route,
      blockedSegments: route.blockedSegments,
    },
    budget: {
      spend,
      limit: brief.budget,
      remaining: brief.budget - spend,
      withinBudget: spend <= brief.budget,
    },
    assumptions: [
      'Measurements use the seeded plan in centimetres and are not construction documents.',
      'Fixed walls, openings, counters, plumbing, and door-swing zones are treated as authoritative.',
      'Clearance uses the household minimum walking width; verify on site before purchasing.',
    ],
  };
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function roundToGrid(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}

export function constrainFurniturePosition(
  item: Furniture,
  position: Point,
  apartment: { width: number; height: number },
): Point {
  const bounds = polygonBounds(rectCorners(position, item.width, item.depth, item.rotation));
  const deltaX = bounds.x < 0 ? -bounds.x : bounds.x + bounds.width > apartment.width ? apartment.width - (bounds.x + bounds.width) : 0;
  const deltaY = bounds.y < 0 ? -bounds.y : bounds.y + bounds.height > apartment.height ? apartment.height - (bounds.y + bounds.height) : 0;
  return { x: position.x + deltaX, y: position.y + deltaY };
}
