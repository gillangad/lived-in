import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Expand,
  FileDown,
  Grid3X3,
  Hand,
  Info,
  Lock,
  Maximize2,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCcw,
  Ruler,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { createPlanSvg, downloadPng, downloadSvg, openPrintPreview } from './exports';
import { clamp, constrainFurniturePosition, distance, formatCurrency, furnitureClearancePolygon, polygonBounds, rectCorners } from './geometry';
import { appReducer, compareLayouts, createInitialState, getActiveLayout, listFurniture } from './state';
import { createToolBridge, registerWebMCPTools, TOOL_DEFINITIONS } from './webmcp';
import type { Furniture, FurnitureKind, PlannerAction, PlannerState, Point } from './types';
import './styles.css';

type Theme = 'light' | 'dark';

const VIEWBOX = { width: 1200, height: 700 };
const PLAN_OFFSET = { x: 157, y: 50 };
const PLAN_SCALE = 0.95;

function useInitialTheme(): Theme {
  return useState<Theme>(() => {
    const stored = window.localStorage.getItem('floor-planner-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  })[0];
}

function IconButton({ label, children, onClick, disabled = false, active = false, className = '' }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return <button type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

function FurnitureMini({ kind }: { kind: FurnitureKind }) {
  if (kind === 'sofa') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="9" y="10" width="70" height="28" rx="4"/><rect x="14" y="15" width="60" height="18" rx="2" fill="none"/><line x1="35" y1="15" x2="35" y2="33"/><line x1="54" y1="15" x2="54" y2="33"/></svg>;
  if (kind === 'desk') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="16" y="11" width="56" height="25" rx="2"/><line x1="44" y1="36" x2="44" y2="41"/><path d="M34 42h20"/><line x1="11" y1="8" x2="77" y2="8"/></svg>;
  if (kind === 'dining-table') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="22" y="10" width="44" height="28" rx="3"/><rect x="28" y="16" width="32" height="16" rx="2" fill="none"/><rect x="29" y="3" width="10" height="7" rx="2"/><rect x="49" y="3" width="10" height="7" rx="2"/><rect x="29" y="38" width="10" height="7" rx="2"/><rect x="49" y="38" width="10" height="7" rx="2"/></svg>;
  if (kind === 'queen-bed') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="20" y="4" width="48" height="40" rx="2"/><rect x="24" y="8" width="40" height="10" rx="2"/><path d="M24 19 L44 40 L64 19" fill="none"/></svg>;
  if (kind === 'bookshelf') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="10" y="15" width="68" height="18"/><line x1="23" y1="15" x2="23" y2="33"/><line x1="38" y1="15" x2="38" y2="33"/><line x1="53" y1="15" x2="53" y2="33"/><line x1="68" y1="15" x2="68" y2="33"/></svg>;
  if (kind === 'plant') return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><path d="M44 34V17M44 21C32 14 34 6 44 12M44 24C54 15 61 16 60 7M44 27C36 21 29 24 31 31" fill="none"/><path d="M35 34h18l-3 9H38z"/></svg>;
  return <svg className="mini-svg" viewBox="0 0 88 48" aria-hidden="true"><rect x="18" y="9" width="52" height="30" rx="3"/><line x1="26" y1="17" x2="62" y2="17"/><line x1="26" y1="25" x2="62" y2="25"/><line x1="26" y1="33" x2="62" y2="33"/></svg>;
}

function PlannerCanvas({
  state,
  dispatch,
  onToast,
}: {
  state: PlannerState;
  dispatch: (action: PlannerAction) => void;
  onToast: (message: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; start: Point; initial: Point; pointerId: number } | null>(null);
  const panRef = useRef<{ start: Point; initial: Point; pointerId: number } | null>(null);
  const [dragPosition, setDragPosition] = useState<Point | null>(null);
  const [snap, setSnap] = useState(true);
  const active = getActiveLayout(state);
  const selected = state.selectedIds
    .map((id) => active.furniture.find((item) => item.id === id))
    .filter((item): item is Furniture => Boolean(item));
  const focused = selected[0];

  const rawPoint = useCallback((event: { clientX: number; clientY: number }): Point => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * VIEWBOX.width,
      y: ((event.clientY - rect.top) / rect.height) * VIEWBOX.height,
    };
  }, []);

  const planPoint = useCallback((event: { clientX: number; clientY: number }): Point => {
    const raw = rawPoint(event);
    return {
      x: (raw.x - PLAN_OFFSET.x - state.viewport.pan.x) / (state.viewport.zoom * PLAN_SCALE),
      y: (raw.y - PLAN_OFFSET.y - state.viewport.pan.y) / (state.viewport.zoom * PLAN_SCALE),
    };
  }, [rawPoint, state.viewport.pan.x, state.viewport.pan.y, state.viewport.zoom]);

  const displayPosition = (item: Furniture): Point => dragRef.current?.id === item.id && dragPosition ? dragPosition : item.position;

  const snapPoint = (point: Point): Point => snap ? { x: Math.round(point.x / 10) * 10, y: Math.round(point.y / 10) * 10 } : point;

  const handleItemPointerDown = (event: React.PointerEvent, item: Furniture) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    if (state.overlays.measure.active) {
      const point = planPoint(event);
      const nextPoints = state.overlays.measure.points.length >= 2 ? [point] : [...state.overlays.measure.points, point];
      dispatch({ type: 'set-measure', points: nextPoints, active: nextPoints.length < 2 });
      return;
    }
    const nextIds = event.shiftKey
      ? state.selectedIds.includes(item.id) ? state.selectedIds.filter((id) => id !== item.id) : [...state.selectedIds, item.id]
      : [item.id];
    dispatch({ type: 'select', ids: nextIds });
    if (!item.locked) {
      const point = planPoint(event);
      dragRef.current = { id: item.id, start: point, initial: item.position, pointerId: event.pointerId };
      setDragPosition(item.position);
      svgRef.current?.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (dragRef.current) {
      const drag = dragRef.current;
      const item = active.furniture.find((candidate) => candidate.id === drag.id);
      if (!item) return;
      const point = planPoint(event);
      const next = constrainFurniturePosition(item, snapPoint({ x: drag.initial.x + point.x - drag.start.x, y: drag.initial.y + point.y - drag.start.y }), state.apartment);
      setDragPosition(next);
    } else if (panRef.current) {
      const pan = panRef.current;
      const point = rawPoint(event);
      dispatch({ type: 'set-viewport', viewport: { pan: { x: pan.initial.x + point.x - pan.start.x, y: pan.initial.y + point.y - pan.start.y } } });
    }
  };

  const finishPointer = (event: React.PointerEvent) => {
    if (dragRef.current) {
      const drag = dragRef.current;
      const item = active.furniture.find((candidate) => candidate.id === drag.id);
      if (item && dragPosition && (dragPosition.x !== item.position.x || dragPosition.y !== item.position.y)) {
        dispatch({ type: 'move-furniture', id: item.id, position: dragPosition });
      }
      dragRef.current = null;
      setDragPosition(null);
    }
    if (panRef.current) panRef.current = null;
    try { svgRef.current?.releasePointerCapture(event.pointerId); } catch { /* pointer may already be released */ }
  };

  const handleBackgroundPointerDown = (event: React.PointerEvent) => {
    if (state.overlays.measure.active) {
      const point = planPoint(event);
      const nextPoints = state.overlays.measure.points.length >= 2 ? [point] : [...state.overlays.measure.points, point];
      dispatch({ type: 'set-measure', points: nextPoints, active: nextPoints.length < 2 });
      return;
    }
    if (event.button === 1 || event.altKey || event.shiftKey) {
      const point = rawPoint(event);
      panRef.current = { start: point, initial: state.viewport.pan, pointerId: event.pointerId };
      svgRef.current?.setPointerCapture(event.pointerId);
      return;
    }
    dispatch({ type: 'select', ids: [] });
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const nextZoom = clamp(state.viewport.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.55, 2.2);
    dispatch({ type: 'set-viewport', viewport: { zoom: nextZoom } });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      dispatch({ type: 'select', ids: [] });
      return;
    }
    if (!focused) return;
    const step = event.shiftKey ? 10 : 1;
    const deltas: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    if (deltas[event.key]) {
      event.preventDefault();
      dispatch({ type: 'move-furniture', id: focused.id, position: { x: focused.position.x + deltas[event.key].x, y: focused.position.y + deltas[event.key].y } });
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      dispatch({ type: 'rotate-furniture', id: focused.id });
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const catalogueId = event.dataTransfer.getData('text/floor-planner-catalogue');
    if (!catalogueId) return;
    dispatch({ type: 'add-furniture', templateId: catalogueId, position: snapPoint(planPoint(event)) });
    onToast('Added to the plan');
  };

  const planTransform = `translate(${PLAN_OFFSET.x + state.viewport.pan.x} ${PLAN_OFFSET.y + state.viewport.pan.y}) scale(${state.viewport.zoom * PLAN_SCALE})`;
  const measurePoints = state.overlays.measure.points;
  const measuredDistance = measurePoints.length === 2 ? distance(measurePoints[0], measurePoints[1]) : 0;
  const route = state.validation.route;

  return <div className="canvas-stage" tabIndex={0} onKeyDown={handleKeyDown} onWheel={handleWheel} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
    <div className="canvas-tools" aria-label="Plan tools">
      <button type="button" className={!state.overlays.measure.active ? 'selected' : ''} onClick={() => dispatch({ type: 'set-measure', active: false, points: [] })}><Hand size={15} /> Select</button>
      <button type="button" className={state.overlays.measure.active ? 'selected' : ''} onClick={() => dispatch({ type: 'set-measure', active: !state.overlays.measure.active, points: [] })}><Ruler size={15} /> Measure</button>
      <button type="button" className={snap ? 'selected' : ''} onClick={() => setSnap((value) => !value)} title="Snap furniture to the nearest 10 centimetres"><Grid3X3 size={15} /> Snap</button>
    </div>
    <WallMeasurementControl state={state} dispatch={dispatch} onToast={onToast} />
    <div className="canvas-scale-note"><span className="scale-line" /> 1 cm = 1 cm</div>
    {state.overlays.measure.active && <div className="measure-hint"><Ruler size={14} /> Click two points to measure</div>}
    <svg ref={svgRef} className="plan-svg" viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="application" aria-label="Measured Lived In floor plan. Select furniture to edit it." onPointerDown={handleBackgroundPointerDown} onPointerMove={handlePointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer}>
      <defs>
        <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--grid-line)" strokeWidth=".8" /></pattern>
        <marker id="route-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9" fill="none" stroke="#79ad86" strokeWidth="1.4" /></marker>
      </defs>
      <rect width={VIEWBOX.width} height={VIEWBOX.height} fill="url(#plan-grid)" />
      <g transform={planTransform}>
        {state.rooms.map((room) => <g key={room.id}><rect className={`room-fill room-${room.tone}`} x={room.rect.x} y={room.rect.y} width={room.rect.width} height={room.rect.height} /><text className="room-label" x={room.rect.x + 16} y={room.rect.y + 26}>{room.name.toUpperCase()}</text></g>)}
        <FixedStructureSvg state={state} />
        {state.overlays.showRoute && route?.points.length ? <g className={route.status === 'clear' ? 'route-clear' : 'route-warning'}><polyline className="route-halo" points={route.points.map((point) => `${point.x},${point.y}`).join(' ')} /><polyline className="route-line" markerEnd="url(#route-arrow)" points={route.points.map((point) => `${point.x},${point.y}`).join(' ')} /></g> : null}
        {state.overlays.showClearances && active.furniture.map((item) => <polygon key={`clear-${item.id}`} className="clearance-envelope" points={furnitureClearancePolygon(item, state.brief.minimumWalkingWidth).map((point) => `${point.x},${point.y}`).join(' ')} />)}
        {state.overlays.showLabels && state.routePoints.map((point) => <text key={point.id} className="route-label" x={point.position.x + 8} y={point.position.y - 7}>{point.name}</text>)}
        {active.furniture.map((item) => <FurnitureSvg key={item.id} item={item} position={displayPosition(item)} selected={state.selectedIds.includes(item.id)} pulse={state.lastAction?.changedIds.includes(item.id)} locked={item.locked} onPointerDown={handleItemPointerDown} />)}
        {focused && <SelectionOverlay item={focused} onRotate={() => dispatch({ type: 'rotate-furniture', id: focused.id })} onToggleLock={() => dispatch({ type: 'set-furniture-lock', id: focused.id, locked: !focused.locked })} onDelete={() => { if (!focused.locked && window.confirm(`Remove ${focused.name.toLowerCase()} from this layout?`)) dispatch({ type: 'remove-furniture', id: focused.id }); }} onEditDimensions={() => {
          const dimensions = window.prompt('Dimensions in cm (width × depth)', `${Math.round(focused.width)} × ${Math.round(focused.depth)}`);
          if (!dimensions) return;
          const match = dimensions.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
          if (!match) { onToast('Use the format 120 × 60'); return; }
          const width = Number(match[1]);
          const depth = Number(match[2]);
          if (focused.custom) dispatch({ type: 'resize-furniture', id: focused.id, width, depth });
          else dispatch({ type: 'confirm-dimensions', id: focused.id, width, depth });
        }} />} 
        {measurePoints.length === 2 && <g className="measure-line"><line x1={measurePoints[0].x} y1={measurePoints[0].y} x2={measurePoints[1].x} y2={measurePoints[1].y} /><circle cx={measurePoints[0].x} cy={measurePoints[0].y} r="4" /><circle cx={measurePoints[1].x} cy={measurePoints[1].y} r="4" /><text x={(measurePoints[0].x + measurePoints[1].x) / 2} y={(measurePoints[0].y + measurePoints[1].y) / 2 - 9}>{Math.round(measuredDistance)} cm</text></g>}
      </g>
    </svg>
    <div className="zoom-controls" aria-label="Zoom controls">
      <IconButton label="Zoom out" onClick={() => dispatch({ type: 'set-viewport', viewport: { zoom: state.viewport.zoom - 0.1 } })}><Minus size={17} /></IconButton>
      <button type="button" className="zoom-value" onClick={() => dispatch({ type: 'set-viewport', viewport: { zoom: 1 } })}>{Math.round(state.viewport.zoom * 100)}%</button>
      <IconButton label="Zoom in" onClick={() => dispatch({ type: 'set-viewport', viewport: { zoom: state.viewport.zoom + 0.1 } })}><Plus size={17} /></IconButton>
      <span className="zoom-divider" />
      <IconButton label="Fit plan to viewport" onClick={() => dispatch({ type: 'set-viewport', viewport: { zoom: 1, pan: { x: 0, y: 0 } } })}><Maximize2 size={16} /></IconButton>
    </div>
    {state.overlays.measure.points.length === 2 && <div className="measure-readout"><span>Measured distance</span><strong>{Math.round(measuredDistance)} cm</strong><button type="button" onClick={() => dispatch({ type: 'set-measure', active: false, points: [] })}><X size={14} /></button></div>}
  </div>;
}

function WallMeasurementControl({ state, dispatch, onToast }: { state: PlannerState; dispatch: React.Dispatch<PlannerAction>; onToast: (message: string) => void }) {
  const measurement = state.wallMeasurements.find((item) => item.wallId === 'wall-top');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.round(measurement?.lengthCm ?? state.apartment.width)));
  const length = measurement?.lengthCm ?? state.apartment.width;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = Number(value);
    if (!Number.isFinite(next) || next < 760 || next > 960) { onToast('North wall must be between 760 and 960 cm'); return; }
    dispatch({ type: 'update-wall-measurement', wallId: 'wall-top', lengthCm: next, source: 'human' });
    setEditing(false);
    onToast(`North wall updated to ${Math.round(next)} cm`);
  };
  return <div className="wall-measurement-control" aria-label="North exterior wall measurement">
    {editing ? <form onSubmit={submit}><label>North wall <input type="number" min="760" max="960" value={value} onChange={(event) => setValue(event.target.value)} autoFocus /></label><button type="submit">Apply</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></form> : <><div><Ruler size={14} /><span>North wall <strong>{Math.round(length)} cm</strong></span></div><button type="button" onClick={() => { setValue(String(Math.round(length))); setEditing(true); }}>Correct</button><small>Locked · measured plan</small></>}
  </div>;
}

function FixedStructureSvg({ state }: { state: PlannerState }) {
  return <g className="fixed-structures">
    {state.fixedStructures.map((structure) => {
      if (!structure.rect) return null;
      const r = structure.rect;
      if (structure.kind === 'window') return <g key={structure.id} className="window-mark"><rect x={r.x} y={r.y} width={r.width} height={r.height} /><line x1={r.x + r.width * .18} y1={r.y + r.height / 2} x2={r.x + r.width * .82} y2={r.y + r.height / 2} /></g>;
      if (structure.kind === 'opening') return null;
      if (structure.kind === 'door') {
        const centerX = r.x + r.width;
        const centerY = r.y + r.height;
        return <g key={structure.id} className="door-swing"><path d={`M ${r.x} ${centerY} A ${r.width} ${r.height} 0 0 1 ${centerX} ${r.y}`} /><line x1={r.x} y1={centerY} x2={centerX} y2={centerY} /></g>;
      }
      if (structure.kind === 'outer-wall' || structure.kind === 'partition') return <rect key={structure.id} className="wall" x={r.x} y={r.y} width={r.width} height={r.height} />;
      if (structure.kind === 'counter') return <g key={structure.id} className="counter"><rect x={r.x} y={r.y} width={r.width} height={r.height} /><line x1={r.x + 8} y1={r.y + 70} x2={r.x + r.width - 8} y2={r.y + 70} /></g>;
      if (structure.label === 'shower') return <g key={structure.id} className="fixture"><rect x={r.x} y={r.y} width={r.width} height={r.height} /><line x1={r.x} y1={r.y} x2={r.x + r.width} y2={r.y + r.height} /><line x1={r.x + r.width} y1={r.y} x2={r.x} y2={r.y + r.height} /><circle cx={r.x + r.width / 2} cy={r.y + r.height / 2} r="12" /></g>;
      if (structure.label === 'toilet') return <g key={structure.id} className="fixture"><rect x={r.x} y={r.y} width={r.width} height={r.height} /><path d={`M ${r.x + 10} ${r.y + 24} C ${r.x + 10} ${r.y + 65}, ${r.x + r.width - 10} ${r.y + 65}, ${r.x + r.width - 10} ${r.y + 24}`} /></g>;
      return <g key={structure.id} className="fixture"><rect x={r.x} y={r.y} width={r.width} height={r.height} /><ellipse cx={r.x + r.width / 2} cy={r.y + r.height / 2} rx={r.width / 3} ry={r.height / 4} /></g>;
    })}
    {(() => {
      const wall = state.fixedStructures.find((structure) => structure.id === 'wall-top')?.rect;
      const measurement = state.wallMeasurements.find((item) => item.wallId === 'wall-top');
      if (!wall || !measurement) return null;
      return <g className="wall-measurement" aria-label={`North exterior wall ${Math.round(measurement.lengthCm)} centimetres`}><line x1={wall.x + 20} y1={-18} x2={wall.x + wall.width - 20} y2={-18} /><line x1={wall.x + 20} y1={-24} x2={wall.x + 20} y2={-12} /><line x1={wall.x + wall.width - 20} y1={-24} x2={wall.x + wall.width - 20} y2={-12} /><text x={wall.x + wall.width / 2} y={-25}>{Math.round(measurement.lengthCm)} cm</text></g>;
    })()}
    <g className="kitchen-symbols"><circle cx="206" cy="458" r="12" /><circle cx="238" cy="458" r="12" /><circle cx="206" cy="486" r="12" /><circle cx="238" cy="486" r="12" /><path d="M75 456c0-10 18-10 18 0v20c0 8-18 8-18 0zM84 476v8" /></g>
  </g>;
}

function FurnitureSvg({ item, position, selected, pulse, locked, onPointerDown }: { item: Furniture; position: Point; selected: boolean; pulse?: boolean; locked: boolean; onPointerDown: (event: React.PointerEvent, item: Furniture) => void }) {
  const details: React.ReactNode[] = [];
  if (item.kind === 'sofa') details.push(<g key="sofa-details"><rect x={-item.width / 2 + 8} y={-item.depth / 2 + 8} width={item.width - 16} height={item.depth - 16} rx="6" className="item-inner" /><line x1={-item.width / 2 + item.width * .34} y1={-item.depth / 2 + 8} x2={-item.width / 2 + item.width * .34} y2={item.depth / 2 - 8} /><line x1={-item.width / 2 + item.width * .67} y1={-item.depth / 2 + 8} x2={-item.width / 2 + item.width * .67} y2={item.depth / 2 - 8} /></g>);
  else if (item.kind === 'queen-bed') details.push(<g key="bed-details"><rect x={-item.width / 2 + 8} y={-item.depth / 2 + 8} width={item.width - 16} height="54" rx="5" className="bed-pillows" /><path d={`M ${-item.width / 2 + 8} ${-item.depth / 2 + 62} L 0 ${item.depth / 2 - 8} L ${item.width / 2 - 8} ${-item.depth / 2 + 62}`} /></g>);
  else if (item.kind === 'bookshelf') details.push(<g key="bookshelf-details">{[1, 2, 3, 4].map((index) => <line key={index} x1={-item.width / 2 + 4} y1={-item.depth / 2 + (item.depth / 5) * index} x2={item.width / 2 - 4} y2={-item.depth / 2 + (item.depth / 5) * index} />)}</g>);
  else if (item.kind === 'dining-table') details.push(<ellipse key="table-details" cx="0" cy="0" rx="18" ry="12" />);
  else if (item.kind === 'dining-chair') details.push(<rect key="chair-details" x={-item.width / 2 + 4} y={-item.depth / 2 + 4} width={item.width - 8} height={item.depth - 8} rx="4" />);
  else if (item.kind === 'plant') details.push(<g key="plant-details"><path d="M0 0V-22M0-10C-16-20-14-29-2-34M0-5C12-17 17-20 20-29M0 0C2-14 0-22 8-32" /><path d="M-12 5h24l-3 14H-9z" /></g>);
  else if (item.kind === 'floor-lamp') details.push(<g key="lamp-details"><circle cx="0" cy={-item.depth / 2 + 9} r="7" /><line x1="0" y1={-item.depth / 2 + 16} x2="0" y2={item.depth / 2 - 5} /></g>);
  else details.push(<g key="generic-details"><line x1={-item.width / 2 + 10} y1="0" x2={item.width / 2 - 10} y2="0" /><line x1="0" y1={-item.depth / 2 + 10} x2="0" y2={item.depth / 2 - 10} /></g>);
  const selectionPolygon = rectCorners({ x: 0, y: 0 }, item.width, item.depth, 0);
  return <g className={`furniture-item ${selected ? 'is-selected' : ''} ${pulse ? 'is-pulsing' : ''} ${locked ? 'is-locked' : ''}`} transform={`translate(${position.x} ${position.y}) rotate(${item.rotation})`} onPointerDown={(event) => onPointerDown(event, item)} tabIndex={0} role="button" aria-label={`${item.name}, ${Math.round(item.width)} by ${Math.round(item.depth)} centimetres${locked ? ', locked' : ''}`}>
    <title>{item.name} · {Math.round(item.width)} × {Math.round(item.depth)} cm{item.dimensionStatus === 'estimated' ? ' · estimated' : ''}</title>
    <rect x={-item.width / 2} y={-item.depth / 2} width={item.width} height={item.depth} rx={item.kind === 'rug' ? 2 : 5} className={`item-body ${item.kind === 'rug' ? 'item-rug' : ''}`} style={{ fill: item.color }} />
    <g className="item-details">{details}</g>
    {selected && <polygon className="selection-outline" points={selectionPolygon.map((point) => `${point.x},${point.y}`).join(' ')} />}
  </g>;
}

function SelectionOverlay({ item, onRotate, onToggleLock, onDelete, onEditDimensions }: { item: Furniture; onRotate: () => void; onToggleLock: () => void; onDelete: () => void; onEditDimensions: () => void }) {
  const bounds = polygonBounds(rectCorners(item.position, item.width, item.depth, item.rotation));
  const x = bounds.x - 5;
  const y = bounds.y - 5;
  const width = bounds.width + 10;
  const height = bounds.height + 10;
  const handlePoints = [
    [x, y], [x + width / 2, y], [x + width, y], [x + width, y + height / 2], [x + width, y + height], [x + width / 2, y + height], [x, y + height], [x, y + height / 2],
  ];
  const toolbarWidth = 230;
  const toolbarX = item.position.x - toolbarWidth / 2;
  const toolbarY = Math.min(500, bounds.y + bounds.height + 28);
  return <g className="selection-ui">
    <rect className="selection-box" x={x} y={y} width={width} height={height} />
    {handlePoints.map(([pointX, pointY], index) => <circle key={index} className="selection-handle" cx={pointX} cy={pointY} r="5" />)}
    <g className="floating-toolbar" transform={`translate(${toolbarX} ${toolbarY})`}>
      <rect width={toolbarWidth} height="42" rx="9" />
      <g className="toolbar-button" onClick={onRotate} role="button"><title>Rotate furniture</title><path d="M24 16a8 8 0 1 0 2 7" /><path d="M27 13v5h-5" /></g>
      <line x1="52" y1="8" x2="52" y2="34" className="toolbar-divider" />
      <g className="toolbar-button" onClick={onToggleLock} role="button"><title>{item.locked ? 'Unlock furniture' : 'Lock furniture'}</title>{item.locked ? <><rect x="64" y="18" width="12" height="11" rx="2" /><path d="M67 18v-4a3 3 0 0 1 6 0v4" /></> : <><rect x="64" y="18" width="12" height="11" rx="2" /><path d="M67 18v-4a3 3 0 0 1 6-2" /></>}</g>
      <line x1="90" y1="8" x2="90" y2="34" className="toolbar-divider" />
      <g className="toolbar-dimensions" onClick={onEditDimensions} role="button"><title>Confirm or edit dimensions</title><text x="103" y="26">{Math.round(item.width)} × {Math.round(item.depth)} cm</text>{item.dimensionStatus === 'estimated' && <circle cx="211" cy="14" r="3" className="estimated-dot" />}</g>
      <line x1="213" y1="8" x2="213" y2="34" className="toolbar-divider" />
      <g className={`toolbar-button toolbar-delete ${item.locked ? 'is-disabled' : ''}`} onClick={item.locked ? undefined : onDelete} role="button"><title>{item.locked ? 'Unlock before deleting' : 'Delete furniture'}</title><path d="M219 17h11M222 17v12h7V17M224 14h4" /></g>
    </g>
  </g>;
}

function FurniturePanel({ state, dispatch, tab, setTab, search, setSearch, onCustom }: { state: PlannerState; dispatch: (action: PlannerAction) => void; tab: 'my-furniture' | 'library'; setTab: (tab: 'my-furniture' | 'library') => void; search: string; setSearch: (value: string) => void; onCustom: () => void }) {
  const items = listFurniture(state, tab, search);
  const active = getActiveLayout(state);
  return <aside className="furniture-panel">
    <div className="panel-tabs" role="tablist"><button type="button" className={tab === 'my-furniture' ? 'active' : ''} onClick={() => setTab('my-furniture')} role="tab" aria-selected={tab === 'my-furniture'}>My furniture</button><button type="button" className={tab === 'library' ? 'active' : ''} onClick={() => setTab('library')} role="tab" aria-selected={tab === 'library'}>Library</button></div>
    <div className="panel-search"><Search size={17} /><input aria-label="Search furniture" placeholder="Search furniture" value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>/</kbd></div>
    <div className="furniture-list" aria-label={tab === 'my-furniture' ? 'My furniture' : 'Furniture library'}>
      {items.map((item) => {
        const placed = active.furniture.find((candidate) => candidate.id === item.id);
        const template = state.catalogue.find((candidate) => candidate.id === item.catalogueId);
        const itemKind = placed?.kind ?? template?.kind ?? 'custom';
        return <div key={item.id} className={`furniture-row ${placed && state.selectedIds.includes(placed.id) ? 'selected' : ''}`} draggable={!placed} role="button" tabIndex={0} aria-label={`${item.name} ${Math.round(item.width)} by ${Math.round(item.depth)} centimetres`} onDragStart={(event) => event.dataTransfer.setData('text/floor-planner-catalogue', item.catalogueId)} onClick={() => { if (placed) dispatch({ type: 'select', ids: [placed.id] }); else dispatch({ type: 'add-furniture', templateId: item.catalogueId }); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (placed) dispatch({ type: 'select', ids: [placed.id] }); else dispatch({ type: 'add-furniture', templateId: item.catalogueId }); } }}>
          <FurnitureMini kind={itemKind} /><span className="furniture-row-copy"><span className="furniture-row-name">{item.name}{item.dimensionStatus === 'estimated' && <span className="estimated-tag">Estimated</span>}</span><span className="furniture-row-meta">{Math.round(item.width)} × {Math.round(item.depth)} cm{item.ownership === 'buy' && <span className="row-cost"> · {formatCurrency(item.cost)}</span>}</span></span>{placed?.locked && <Lock size={14} className="row-lock" />}{item.dimensionStatus === 'estimated' && <button type="button" className="confirm-row" title="Confirm dimensions" aria-label={`Confirm ${item.name} dimensions`} onClick={(event) => { event.stopPropagation(); dispatch({ type: 'confirm-dimensions', id: item.id }); }}><Check size={13} /></button>}
        </div>;
      })}
      {!items.length && <div className="empty-list"><Search size={19} /><p>No matching furniture</p><button type="button" onClick={() => setSearch('')}>Clear search</button></div>}
    </div>
    <div className="panel-footer"><button type="button" className="custom-item-button" onClick={onCustom}><Plus size={16} /> Custom item</button><span>{items.length} shown</span></div>
  </aside>;
}

function BriefDrawer({ state, dispatch, onClose, onToast }: { state: PlannerState; dispatch: (action: PlannerAction) => void; onClose: () => void; onToast: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(state.brief);
  const [routeStart, setRouteStart] = useState(getActiveLayout(state).routeCheck.startId);
  const [routeEnd, setRouteEnd] = useState(getActiveLayout(state).routeCheck.endId);
  useEffect(() => setDraft(state.brief), [state.brief]);
  useEffect(() => {
    const route = getActiveLayout(state).routeCheck;
    setRouteStart(route.startId);
    setRouteEnd(route.endId);
  }, [state.activeLayoutId, state.layouts]);
  const updateDraft = (key: keyof typeof draft, value: string | number | string[]) => setDraft((current) => ({ ...current, [key]: value }));
  return <>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="brief-drawer" aria-label="Household brief">
      <div className="drawer-header"><div><span className="eyebrow">Household context</span><h2>Brief</h2></div><IconButton label="Close brief" onClick={onClose}><X size={18} /></IconButton></div>
      <div className="drawer-scroll">
        <div className="brief-agent-note"><Sparkles size={15} /><span>Agent-ready context</span><small>Visible, reviewable, and shared with the plan</small></div>
        {!editing ? <>
          <BriefField label="Residents" value={state.brief.residents} />
          <BriefField label="Routines" value={state.brief.routines} />
          <BriefField label="Hosting" value={state.brief.hosting} />
          <BriefField label="Work from home" value={state.brief.workFromHome} />
          <BriefField label="Accessibility" value={state.brief.accessibility} />
          <div className="brief-section"><span className="brief-label">Must keep</span><div className="brief-pills">{state.brief.mustKeep.map((item) => <span key={item} className="brief-pill"><Check size={12} />{item}</span>)}</div></div>
          <div className="brief-section"><div className="brief-label-row"><span className="brief-label">Minimum walking width</span><strong>{state.brief.minimumWalkingWidth} cm</strong></div><div className="width-meter"><span style={{ width: `${Math.min(100, (state.brief.minimumWalkingWidth / 140) * 100)}%` }} /></div></div>
          <div className="brief-section"><div className="brief-label-row"><span className="brief-label">Budget</span><strong>{formatCurrency(state.brief.budget)}</strong></div><p className="brief-muted">{formatCurrency(state.validation.budget.spend)} planned purchases · {state.validation.budget.withinBudget ? 'within budget' : 'over budget'}</p></div>
          <div className="brief-section"><span className="brief-label">Sources</span><div className="source-list">{state.brief.sources.map((source) => <span key={`${source.type}-${source.label}`} className="source-chip"><span>{source.type}</span>{source.label}</span>)}</div></div>
          <button type="button" className="quiet-button full-width" onClick={() => setEditing(true)}><Settings2 size={15} /> Edit brief</button>
        </> : <BriefEditor draft={draft} updateDraft={updateDraft} onCancel={() => setEditing(false)} onSave={() => { dispatch({ type: 'set-brief', brief: draft }); setEditing(false); onToast('Brief updated'); }} />}
        <div className="drawer-rule" />
        <section className="route-section"><div className="section-heading"><div><span className="eyebrow">Deterministic check</span><h3>Route check</h3></div><span className={`inline-status ${state.validation.route?.status === 'clear' ? 'valid' : 'warning'}`}>{state.validation.route?.status === 'clear' ? 'Clear' : 'Review'}</span></div><div className="route-selects"><label>From<select value={routeStart} onChange={(event) => setRouteStart(event.target.value)}>{state.routePoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label><ChevronRight size={15} className="route-arrow" /><label>To<select value={routeEnd} onChange={(event) => setRouteEnd(event.target.value)}>{state.routePoints.map((point) => <option key={point.id} value={point.id}>{point.name}</option>)}</select></label></div><button type="button" className="primary-button full-width" onClick={() => { dispatch({ type: 'set-route', startId: routeStart, endId: routeEnd }); onToast('Route recomputed'); }}>Check route <ArrowInline /></button>{state.validation.route && <p className="route-summary">{Math.round(state.validation.route.distance)} cm route · {state.validation.route.status === 'clear' ? 'no blocked segments' : `${state.validation.route.blockedSegments.length} segment${state.validation.route.blockedSegments.length === 1 ? '' : 's'} need attention`}</p>}</section>
        <div className="drawer-rule" />
        <section className="overlay-section"><div className="section-heading"><div><span className="eyebrow">View</span><h3>Overlays</h3></div></div><ToggleRow label="Route overlay" checked={state.overlays.showRoute} onChange={() => dispatch({ type: 'toggle-overlay', key: 'showRoute' })} /><ToggleRow label="Clearance envelopes" checked={state.overlays.showClearances} onChange={() => dispatch({ type: 'toggle-overlay', key: 'showClearances' })} /><ToggleRow label="Route labels" checked={state.overlays.showLabels} onChange={() => dispatch({ type: 'toggle-overlay', key: 'showLabels' })} /></section>
      </div>
    </aside>
  </>;
}

function BriefField({ label, value }: { label: string; value: string }) {
  return <div className="brief-section"><span className="brief-label">{label}</span><p className="brief-value">{value}</p></div>;
}

function BriefEditor({ draft, updateDraft, onCancel, onSave }: { draft: PlannerState['brief']; updateDraft: (key: keyof PlannerState['brief'], value: string | number | string[]) => void; onCancel: () => void; onSave: () => void }) {
  return <div className="brief-editor"><label>Residents<input value={draft.residents} onChange={(event) => updateDraft('residents', event.target.value)} /></label><label>Routines<textarea value={draft.routines} onChange={(event) => updateDraft('routines', event.target.value)} rows={2} /></label><label>Hosting<input value={draft.hosting} onChange={(event) => updateDraft('hosting', event.target.value)} /></label><label>Work from home<input value={draft.workFromHome} onChange={(event) => updateDraft('workFromHome', event.target.value)} /></label><label>Accessibility<input value={draft.accessibility} onChange={(event) => updateDraft('accessibility', event.target.value)} /></label><label>Minimum walking width (cm)<input type="number" min="40" max="180" value={draft.minimumWalkingWidth} onChange={(event) => updateDraft('minimumWalkingWidth', Number(event.target.value))} /></label><label>Budget ($)<input type="number" min="0" value={draft.budget} onChange={(event) => updateDraft('budget', Number(event.target.value))} /></label><label>Notes<textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows={2} /></label><div className="editor-actions"><button type="button" className="quiet-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={onSave}>Save brief</button></div></div>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return <button type="button" className="toggle-row" onClick={onChange}><span>{label}</span><span className={`toggle ${checked ? 'on' : ''}`} aria-hidden="true"><span /></span></button>;
}

function ArrowInline() { return <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>; }

function LayoutMenu({ state, dispatch, onClose }: { state: PlannerState; dispatch: (action: PlannerAction) => void; onClose: () => void }) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [newLayoutOpen, setNewLayoutOpen] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState(`Layout ${String.fromCharCode(65 + state.layouts.length)}`);
  const submitNewLayout = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newLayoutName.trim()) return;
    dispatch({ type: 'create-layout', name: newLayoutName.trim() });
    onClose();
  };
  return <div className="popover layout-menu"><div className="popover-heading"><span>Layout versions</span><span className="muted-count">{state.layouts.length}</span></div>{state.layouts.map((layout) => <div className={`layout-menu-row ${layout.id === state.activeLayoutId ? 'active' : ''}`} key={layout.id}>{renameId === layout.id ? <form onSubmit={(event) => { event.preventDefault(); dispatch({ type: 'rename-layout', id: layout.id, name: rename }); setRenameId(null); }}><input autoFocus value={rename} onChange={(event) => setRename(event.target.value)} /><button type="submit"><Check size={14} /></button></form> : <><button type="button" className="layout-choice" onClick={() => { dispatch({ type: 'set-active-layout', id: layout.id }); onClose(); }}><span className="layout-radio">{layout.id === state.activeLayoutId && <span />}</span><span>{layout.name}</span></button><button type="button" className="layout-more" title={`Rename ${layout.name}`} onClick={() => { setRenameId(layout.id); setRename(layout.name); }}><MoreHorizontal size={15} /></button></>}</div>)}<div className="popover-rule" />{newLayoutOpen ? <form className="new-layout-form" onSubmit={submitNewLayout}><label>Name<input autoFocus value={newLayoutName} onChange={(event) => setNewLayoutName(event.target.value)} /></label><div><button type="button" className="quiet-button" onClick={() => setNewLayoutOpen(false)}>Cancel</button><button type="submit" className="primary-button">Create</button></div></form> : <button type="button" className="new-layout-button" onClick={() => setNewLayoutOpen(true)}><Copy size={15} /> Duplicate current layout</button>}</div>;
}

function ExportMenu({ state, onClose }: { state: PlannerState; onClose: () => void }) {
  return <div className="popover export-menu"><div className="popover-heading"><span>Export plan</span><span className="muted-count">{getActiveLayout(state).name}</span></div><button type="button" onClick={() => { downloadSvg(state); onClose(); }}><Download size={16} /><span><strong>SVG</strong><small>Measured vector plan</small></span></button><button type="button" onClick={() => { downloadPng(state); onClose(); }}><FileDown size={16} /><span><strong>PNG</strong><small>High-resolution image</small></span></button><button type="button" onClick={() => { openPrintPreview(state); onClose(); }}><Expand size={16} /><span><strong>Print / PDF</strong><small>Schedule, brief, disclaimer</small></span></button></div>;
}

function CompareModal({ state, dispatch, onClose }: { state: PlannerState; dispatch: (action: PlannerAction) => void; onClose: () => void }) {
  const [firstId, setFirstId] = useState(state.layouts[0]?.id ?? '');
  const [secondId, setSecondId] = useState(state.layouts[1]?.id ?? state.layouts[0]?.id ?? '');
  const comparison = state.layouts.length > 1 && firstId && secondId ? compareLayouts(state, firstId, secondId) : null;
  const planFor = (id: string) => state.layouts.find((layout) => layout.id === id);
  return <div className="modal-backdrop"><section className="compare-modal" aria-label="Compare layouts"><div className="modal-header"><div><span className="eyebrow">Review versions</span><h2>Compare layouts</h2></div><IconButton label="Close compare" onClick={onClose}><X size={18} /></IconButton></div>{state.layouts.length < 2 ? <div className="compare-empty"><Copy size={24} /><h3>Create a second version to compare</h3><p>Keep Layout A intact while you try a new brief-led arrangement.</p><button type="button" className="primary-button" onClick={() => { dispatch({ type: 'create-layout', name: 'Layout B' }); onClose(); }}>Create Layout B <ArrowInline /></button></div> : <><div className="compare-selectors"><label>First layout<select value={firstId} onChange={(event) => setFirstId(event.target.value)}>{state.layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label><span className="compare-vs">vs</span><label>Second layout<select value={secondId} onChange={(event) => setSecondId(event.target.value)}>{state.layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label></div><div className="compare-plans">{[firstId, secondId].map((id, index) => { const layout = planFor(id); if (!layout) return null; const compareState = { ...state, activeLayoutId: id, selectedIds: [], overlays: { ...state.overlays, showRoute: false } }; return <div className="compare-plan" key={`${id}-${index}`}><div className="compare-plan-label"><span>{layout.name}</span><span>{index === 0 ? 'Original' : 'Working version'}</span></div><img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(createPlanSvg(compareState, id))}`} alt={`${layout.name} preview`} /></div>; })}</div>{comparison && <div className="compare-summary"><div className="diff-stat"><strong>{comparison.moved.length}</strong><span>moved</span></div><div className="diff-stat"><strong>{comparison.added.length}</strong><span>added</span></div><div className="diff-stat"><strong>{comparison.removed.length}</strong><span>removed</span></div><div className="diff-stat"><strong>{formatCurrency(comparison.second.spend)}</strong><span>planned spend</span></div><div className="compare-detail"><span className={comparison.first.validation.valid ? 'valid-text' : 'error-text'}>{comparison.first.name}: {comparison.first.validation.valid ? 'passes checks' : 'needs review'}</span><span className={comparison.second.validation.valid ? 'valid-text' : 'error-text'}>{comparison.second.name}: {comparison.second.validation.valid ? 'passes checks' : 'needs review'}</span></div></div>}</>}</section></div>;
}

function CustomItemModal({ onClose, dispatch }: { onClose: () => void; dispatch: (action: PlannerAction) => void }) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState('100');
  const [depth, setDepth] = useState('60');
  const [cost, setCost] = useState('0');
  const [ownership, setOwnership] = useState<'owned' | 'buy'>('buy');
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!name.trim()) return; dispatch({ type: 'add-furniture', item: { name: name.trim(), width: Number(width), depth: Number(depth), cost: Number(cost), ownership } }); onClose(); };
  return <div className="modal-backdrop"><section className="small-modal" aria-label="Add custom furniture"><div className="modal-header"><div><span className="eyebrow">New object</span><h2>Custom furniture</h2></div><IconButton label="Close custom furniture" onClick={onClose}><X size={18} /></IconButton></div><form onSubmit={submit} className="custom-form"><label>Name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Entry bench" required /></label><div className="form-grid"><label>Width (cm)<input type="number" min="10" max="500" value={width} onChange={(event) => setWidth(event.target.value)} required /></label><label>Depth (cm)<input type="number" min="10" max="500" value={depth} onChange={(event) => setDepth(event.target.value)} required /></label></div><div className="form-grid"><label>Cost ($)<input type="number" min="0" value={cost} onChange={(event) => setCost(event.target.value)} /></label><label>State<select value={ownership} onChange={(event) => setOwnership(event.target.value as 'owned' | 'buy')}><option value="buy">To buy</option><option value="owned">Owned</option></select></label></div><p className="form-note"><Info size={14} /> Custom dimensions start as estimated until confirmed.</p><div className="editor-actions"><button type="button" className="quiet-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button">Add to plan <Plus size={15} /></button></div></form></section></div>;
}

function ToolInspector({ state, bridge, onClose }: { state: PlannerState; bridge: ReturnType<typeof createToolBridge>; onClose: () => void }) {
  const [selectedTool, setSelectedTool] = useState(TOOL_DEFINITIONS[0].name);
  const [input, setInput] = useState('{}');
  const [output, setOutput] = useState('');
  return <div className="inspector-popover"><div className="inspector-heading"><div><span className="eyebrow">Development only</span><h3>WebMCP inspector</h3></div><IconButton label="Close tool inspector" onClick={onClose}><X size={15} /></IconButton></div><div className="inspector-status"><span className="status-dot blue" /> Shared action handlers · {TOOL_DEFINITIONS.length} tools</div><label>Tool<select value={selectedTool} onChange={(event) => setSelectedTool(event.target.value)}>{TOOL_DEFINITIONS.map((tool) => <option key={tool.name} value={tool.name}>{tool.name}</option>)}</select></label><label>JSON input<textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} spellCheck={false} /></label><button type="button" className="primary-button" onClick={async () => { try { const result = await bridge.invoke(selectedTool, JSON.parse(input)); setOutput(JSON.stringify(result, null, 2)); } catch (error) { setOutput(error instanceof Error ? error.message : 'Invalid JSON'); } }}>Invoke tool</button>{output && <pre className="inspector-output">{output}</pre>}<p className="inspector-note">Use this fallback when the browser does not expose <code>document.modelContext</code>. It invokes the same handlers as the page UI.</p><span className="sr-only">Active objects: {state.selectedIds.join(', ')}</span></div>;
}

function StatusBar({ state, dispatch, onInspector, webmcpSupported }: { state: PlannerState; dispatch: (action: PlannerAction) => void; onInspector: () => void; webmcpSupported: boolean }) {
  const validation = state.validation;
  const collisionCount = validation.collisions.length + validation.doorSwingConflicts.length;
  const collisionText = collisionCount ? `${collisionCount} collision${collisionCount === 1 ? '' : 's'}` : 'No collisions';
  const clearanceText = validation.clearanceFailures.length ? `${validation.clearanceFailures.length} clearance issue${validation.clearanceFailures.length === 1 ? '' : 's'}` : null;
  const routeText = validation.route?.status === 'clear' ? 'Routes clear' : validation.route?.status === 'narrow' ? 'Route narrow' : 'Route blocked';
  const budgetText = validation.budget.withinBudget ? 'Within budget' : 'Over budget';
  return <footer className="status-bar"><div className="status-left"><span className={`status-check ${validation.valid ? 'valid' : 'error'}`}>{validation.valid ? <Check size={15} /> : <Info size={15} />}</span><span className={collisionCount ? 'status-error' : ''}>{collisionText}</span>{clearanceText && <><span className="status-separator">·</span><span className="status-error">{clearanceText}</span></>}<span className="status-separator">·</span><span className={validation.route?.status !== 'clear' ? 'status-warning' : ''}>{routeText}</span><span className="status-separator">·</span><span className={!validation.budget.withinBudget ? 'status-error' : ''}>{budgetText}</span>{state.lastAction?.source === 'agent' && <span className="agent-status"><Sparkles size={13} /> Agent · {state.lastAction.label}</span>}{import.meta.env.DEV && <button type="button" className="inspector-trigger" onClick={onInspector}><SlidersHorizontal size={13} /> Tools {webmcpSupported ? 'ready' : 'fallback'}</button>}</div><div className="status-right"><button type="button" className="history-button" onClick={() => dispatch({ type: 'undo' })} disabled={!state.history.length}><RotateCcw size={15} /> Undo</button><button type="button" className="history-button redo" onClick={() => dispatch({ type: 'redo' })} disabled={!state.future.length}><Redo2 size={15} /></button></div></footer>;
}

function App() {
  const [state, setState] = useState<PlannerState>(() => createInitialState());
  const stateRef = useRef(state);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<'my-furniture' | 'library'>('my-furniture');
  const [search, setSearch] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [webmcpSupported, setWebmcpSupported] = useState(false);
  const [webmcpRegistered, setWebmcpRegistered] = useState(false);
  const themeFromSystem = useInitialTheme();
  const [theme, setTheme] = useState<Theme>(themeFromSystem);
  const [pulseKey, setPulseKey] = useState<string | null>(null);

  const commit = useCallback((next: PlannerState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const dispatch = useCallback((action: PlannerAction) => {
    try {
      const next = appReducer(stateRef.current, action);
      commit(next);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Action could not be completed');
    }
  }, [commit]);
  const bridge = useMemo(() => createToolBridge(() => stateRef.current, commit), [commit]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('floor-planner-theme', theme);
  }, [theme]);
  useEffect(() => {
    if (!state.lastAction) return;
    const changed = state.lastAction.changedIds[0] ?? null;
    setPulseKey(changed);
    const timer = window.setTimeout(() => setPulseKey(null), 720);
    return () => window.clearTimeout(timer);
  }, [state.lastAction?.id]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    let cleanup: () => void = () => undefined;
    registerWebMCPTools(() => stateRef.current, commit, controller.signal).then((result) => {
      if (cancelled || controller.signal.aborted) return;
      cleanup = result.cleanup;
      setWebmcpSupported(result.supported);
      setWebmcpRegistered(result.registered);
      if (result.error && import.meta.env.DEV) setToast(`WebMCP registration: ${result.error}`);
    });
    return () => { cancelled = true; controller.abort(); cleanup(); };
  }, [commit]);

  const active = getActiveLayout(state);
  const onToast = (message: string) => setToast(message);

  return <div className={`app-shell ${panelOpen ? 'panel-open' : 'panel-closed'}`}>
    <header className="topbar">
      <div className="topbar-left"><IconButton label={panelOpen ? 'Close furniture panel' : 'Open furniture panel'} className="menu-button" onClick={() => setPanelOpen((open) => !open)}><Menu size={22} /></IconButton><button type="button" className="project-title" onClick={() => setBriefOpen(true)}>Lived In</button><button type="button" className={`topbar-link ${briefOpen ? 'active' : ''}`} onClick={() => setBriefOpen(true)}>Brief</button><div className="layout-switch"><button type="button" className={`topbar-link layout-link ${layoutOpen ? 'active' : ''}`} onClick={() => { setLayoutOpen((open) => !open); setExportOpen(false); }}>{active.name}<ChevronDown size={14} /></button>{layoutOpen && <LayoutMenu state={state} dispatch={dispatch} onClose={() => setLayoutOpen(false)} />}</div><button type="button" className={`topbar-link ${compareOpen ? 'active' : ''}`} onClick={() => { setCompareOpen(true); setLayoutOpen(false); }}>Compare</button></div>
      <div className="topbar-right"><span className={`webmcp-indicator ${webmcpRegistered ? 'ready' : ''}`} title={webmcpRegistered ? 'WebMCP tools registered' : 'Human controls available; WebMCP fallback active'}><span />{webmcpRegistered ? 'Agent ready' : 'Local mode'}</span><IconButton label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'} onClick={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}</IconButton><div className="export-wrap"><button type="button" className="export-button" onClick={() => { setExportOpen((open) => !open); setLayoutOpen(false); }}><Download size={16} /> Export</button>{exportOpen && <ExportMenu state={state} onClose={() => setExportOpen(false)} />}</div></div>
    </header>
    <div className="workspace">
      {panelOpen && <FurniturePanel state={state} dispatch={dispatch} tab={tab} setTab={setTab} search={search} setSearch={setSearch} onCustom={() => setCustomOpen(true)} />}
      <main className="canvas-main"><PlannerCanvas state={{ ...state, focusedId: pulseKey ?? state.focusedId }} dispatch={dispatch} onToast={onToast} /><StatusBar state={state} dispatch={dispatch} onInspector={() => setInspectorOpen(true)} webmcpSupported={webmcpSupported} /></main>
    </div>
    {briefOpen && <BriefDrawer state={state} dispatch={dispatch} onClose={() => setBriefOpen(false)} onToast={onToast} />}
    {compareOpen && <CompareModal state={state} dispatch={dispatch} onClose={() => setCompareOpen(false)} />}
    {customOpen && <CustomItemModal dispatch={dispatch} onClose={() => setCustomOpen(false)} />}
    {import.meta.env.DEV && inspectorOpen && <ToolInspector state={state} bridge={bridge} onClose={() => setInspectorOpen(false)} />}
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    <div className="sr-only" aria-live="polite">{state.lastAction ? `${state.lastAction.label}. ${state.validation.valid ? 'Plan checks pass.' : 'Plan needs review.'}` : ''}</div>
  </div>;
}

export default App;
