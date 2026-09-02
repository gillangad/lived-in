export type Point = { x: number; y: number };

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FurnitureKind =
  | 'sofa'
  | 'desk'
  | 'dining-table'
  | 'dining-chair'
  | 'queen-bed'
  | 'bookshelf'
  | 'armchair'
  | 'coffee-table'
  | 'side-table'
  | 'dresser'
  | 'wardrobe'
  | 'floor-lamp'
  | 'plant'
  | 'rug'
  | 'custom';

export type Ownership = 'owned' | 'buy';
export type DimensionStatus = 'confirmed' | 'estimated';
export type FixedStructureKind =
  | 'outer-wall'
  | 'partition'
  | 'window'
  | 'opening'
  | 'door'
  | 'counter'
  | 'plumbing'
  | 'fixture';

export type Furniture = {
  id: string;
  catalogueId: string;
  name: string;
  kind: FurnitureKind;
  width: number;
  depth: number;
  position: Point;
  rotation: number;
  clearance: {
    front: number;
    back: number;
    left: number;
    right: number;
  };
  cost: number;
  ownership: Ownership;
  locked: boolean;
  dimensionStatus: DimensionStatus;
  custom?: boolean;
  color: string;
};

export type FurnitureTemplate = Omit<
  Furniture,
  'id' | 'position' | 'rotation' | 'locked' | 'dimensionStatus'
> & {
  id: string;
  defaultPosition: Point;
  defaultRotation?: number;
  description: string;
};

export type FixedStructure = {
  id: string;
  kind: FixedStructureKind;
  name: string;
  rect?: Rect;
  points?: Point[];
  rotation?: number;
  label?: string;
  locked: true;
};

export type Room = {
  id: string;
  name: string;
  rect: Rect;
  tone: 'living' | 'bedroom' | 'bathroom' | 'service';
};

export type RoutePoint = {
  id: string;
  name: string;
  position: Point;
  room: string;
};

export type WallMeasurement = {
  wallId: string;
  name: string;
  lengthCm: number;
};

export type HouseholdBrief = {
  residents: string;
  routines: string;
  hosting: string;
  workFromHome: string;
  accessibility: string;
  mustKeep: string[];
  minimumWalkingWidth: number;
  budget: number;
  notes: string;
  sources: { type: string; label: string }[];
};

export type ValidationIssue = {
  id: string;
  type: 'collision' | 'door-swing' | 'clearance' | 'route' | 'budget';
  severity: 'error' | 'warning';
  message: string;
  affectedIds: string[];
};

export type RouteResult = {
  startId: string;
  endId: string;
  minimumWidth: number;
  status: 'clear' | 'narrow' | 'blocked';
  points: Point[];
  blockedSegments: { from: Point; to: Point; reason: string }[];
  distance: number;
};

export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  collisions: ValidationIssue[];
  doorSwingConflicts: ValidationIssue[];
  clearanceFailures: ValidationIssue[];
  route: RouteResult | null;
  budget: {
    spend: number;
    limit: number;
    remaining: number;
    withinBudget: boolean;
  };
  assumptions: string[];
};

export type Layout = {
  id: string;
  name: string;
  createdAt: string;
  sourceLayoutId?: string;
  furniture: Furniture[];
  routeCheck: {
    startId: string;
    endId: string;
    minimumWidth: number;
  };
};

export type Overlays = {
  showRoute: boolean;
  showClearances: boolean;
  showLabels: boolean;
  measure: {
    active: boolean;
    points: Point[];
  };
};

export type Viewport = {
  zoom: number;
  pan: Point;
};

export type LastAction = {
  id: string;
  label: string;
  source: 'human' | 'agent';
  changedIds: string[];
  at: number;
};

export type Snapshot = Pick<
  PlannerState,
  | 'layouts'
  | 'apartment'
  | 'rooms'
  | 'fixedStructures'
  | 'routePoints'
  | 'wallMeasurements'
  | 'activeLayoutId'
  | 'brief'
  | 'overlays'
  | 'viewport'
  | 'selectedIds'
  | 'focusedId'
  | 'lastAction'
>;

export type HistoryEntry = Snapshot & { label: string };

export type PlannerState = {
  project: {
    id: string;
    name: string;
    unit: 'cm';
    disclaimer: string;
  };
  apartment: {
    width: number;
    height: number;
    scale: string;
  };
  rooms: Room[];
  fixedStructures: FixedStructure[];
  routePoints: RoutePoint[];
  wallMeasurements: WallMeasurement[];
  catalogue: FurnitureTemplate[];
  layouts: Layout[];
  activeLayoutId: string;
  brief: HouseholdBrief;
  overlays: Overlays;
  viewport: Viewport;
  selectedIds: string[];
  focusedId: string | null;
  lastAction: LastAction | null;
  history: HistoryEntry[];
  future: HistoryEntry[];
  validation: ValidationResult;
};

export type ActionSource = 'human' | 'agent';

export type PlannerAction =
  | {
      type: 'select';
      ids: string[];
      source?: ActionSource;
    }
  | {
      type: 'move-furniture';
      id: string;
      position: Point;
      source?: ActionSource;
    }
  | {
      type: 'rotate-furniture';
      id: string;
      rotation?: number;
      source?: ActionSource;
    }
  | {
      type: 'resize-furniture';
      id: string;
      width: number;
      depth: number;
      source?: ActionSource;
    }
  | {
      type: 'set-furniture-lock';
      id: string;
      locked: boolean;
      source?: ActionSource;
    }
  | {
      type: 'update-furniture-cost';
      id: string;
      cost: number;
      source?: ActionSource;
    }
  | {
      type: 'confirm-dimensions';
      id: string;
      width?: number;
      depth?: number;
      source?: ActionSource;
    }
  | {
      type: 'add-furniture';
      templateId?: string;
      item?: {
        name: string;
        kind?: FurnitureKind;
        width: number;
        depth: number;
        position?: Point;
        rotation?: number;
        cost?: number;
        ownership?: Ownership;
      };
      position?: Point;
      source?: ActionSource;
    }
  | {
      type: 'remove-furniture';
      id: string;
      source?: ActionSource;
    }
  | {
      type: 'duplicate-furniture';
      id: string;
      source?: ActionSource;
    }
  | {
      type: 'set-brief';
      brief: Partial<HouseholdBrief>;
      source?: ActionSource;
    }
  | {
      type: 'update-wall-measurement';
      wallId: string;
      lengthCm: number;
      source?: ActionSource;
    }
  | {
      type: 'create-layout';
      name: string;
      sourceLayoutId?: string;
      source?: ActionSource;
    }
  | {
      type: 'rename-layout';
      id: string;
      name: string;
      source?: ActionSource;
    }
  | {
      type: 'set-active-layout';
      id: string;
      source?: ActionSource;
    }
  | {
      type: 'set-route';
      startId: string;
      endId: string;
      minimumWidth?: number;
      source?: ActionSource;
    }
  | {
      type: 'toggle-overlay';
      key: 'showRoute' | 'showClearances' | 'showLabels';
      source?: ActionSource;
    }
  | {
      type: 'set-measure';
      active?: boolean;
      points?: Point[];
      source?: ActionSource;
    }
  | {
      type: 'set-viewport';
      viewport: Partial<Viewport>;
      source?: ActionSource;
    }
  | {
      type: 'undo';
    }
  | {
      type: 'redo';
    };

export type ToolResult = {
  ok: boolean;
  action?: string;
  changedIds?: string[];
  message: string;
  state?: unknown;
  error?: { code: string; message: string; affectedIds?: string[] };
};
