import { formatCurrency } from './geometry';
import { getActiveLayout } from './state';
import type { Furniture, PlannerState } from './types';

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}

function furnitureSvg(item: Furniture, selected = false): string {
  const stroke = selected ? '#3b82f6' : '#6a6a68';
  const strokeWidth = selected ? 2.4 : 1.1;
  const fill = item.kind === 'rug' ? '#f3f0ea' : item.color;
  const details: string[] = [];
  if (item.kind === 'sofa') {
    details.push(`<rect x="${-item.width / 2 + 8}" y="${-item.depth / 2 + 8}" width="${item.width - 16}" height="${item.depth - 16}" rx="6" fill="none" stroke="#8b8984" stroke-width="1"/>`);
    details.push(`<line x1="${-item.width / 2 + item.width * 0.34}" y1="${-item.depth / 2 + 8}" x2="${-item.width / 2 + item.width * 0.34}" y2="${item.depth / 2 - 8}" stroke="#9b9993" stroke-width="1"/>`);
    details.push(`<line x1="${-item.width / 2 + item.width * 0.67}" y1="${-item.depth / 2 + 8}" x2="${-item.width / 2 + item.width * 0.67}" y2="${item.depth / 2 - 8}" stroke="#9b9993" stroke-width="1"/>`);
  } else if (item.kind === 'queen-bed') {
    details.push(`<rect x="${-item.width / 2 + 8}" y="${-item.depth / 2 + 8}" width="${item.width - 16}" height="54" rx="4" fill="#f8f7f3" stroke="#a3a19b" stroke-width="1"/>`);
    details.push(`<path d="M ${-item.width / 2 + 8} ${-item.depth / 2 + 62} L 0 ${item.depth / 2 - 8} L ${item.width / 2 - 8} ${-item.depth / 2 + 62}" fill="none" stroke="#b2b0aa" stroke-width="1"/>`);
  } else if (item.kind === 'bookshelf') {
    for (let index = 1; index < 5; index += 1) {
      const y = -item.depth / 2 + (item.depth / 5) * index;
      details.push(`<line x1="${-item.width / 2 + 4}" y1="${y}" x2="${item.width / 2 - 4}" y2="${y}" stroke="#a4a29c" stroke-width="1"/>`);
    }
  } else if (item.kind === 'dining-table') {
    details.push(`<ellipse cx="0" cy="0" rx="18" ry="12" fill="none" stroke="#aaa8a1" stroke-width="1"/>`);
  } else if (item.kind === 'dining-chair') {
    details.push(`<rect x="${-item.width / 2 + 4}" y="${-item.depth / 2 + 4}" width="${item.width - 8}" height="${item.depth - 8}" rx="4" fill="none" stroke="#9e9c96" stroke-width="1"/>`);
  } else if (item.kind === 'plant') {
    details.push(`<circle cx="0" cy="0" r="${Math.min(item.width, item.depth) / 4}" fill="none" stroke="#879786" stroke-width="1.2"/>`);
    details.push(`<path d="M 0 0 C -16 -16 -14 -24 -2 -30 M 0 0 C 12 -18 17 -20 20 -28 M 0 0 C 2 -15 0 -24 8 -32" fill="none" stroke="#79907d" stroke-width="1.2"/>`);
  } else if (item.kind === 'floor-lamp') {
    details.push(`<circle cx="0" cy="${-item.depth / 2 + 9}" r="7" fill="none" stroke="#9a9891" stroke-width="1"/>`);
    details.push(`<line x1="0" y1="${-item.depth / 2 + 16}" x2="0" y2="${item.depth / 2 - 5}" stroke="#98968f" stroke-width="1"/>`);
  }
  return `<g transform="translate(${item.position.x} ${item.position.y}) rotate(${item.rotation})">
    <rect x="${-item.width / 2}" y="${-item.depth / 2}" width="${item.width}" height="${item.depth}" rx="${item.kind === 'rug' ? 2 : 5}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" ${item.kind === 'rug' ? 'stroke-dasharray="5 4"' : ''}/>
    ${details.join('')}
  </g>`;
}

function structureSvg(state: PlannerState): string {
  return state.fixedStructures
    .map((structure) => {
      const rect = structure.rect;
      if (!rect) return '';
      if (structure.kind === 'window') {
        return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#fff" stroke="#454545" stroke-width="2"/><line x1="${rect.x + rect.width * 0.18}" y1="${rect.y + rect.height / 2}" x2="${rect.x + rect.width * 0.82}" y2="${rect.y + rect.height / 2}" stroke="#969696" stroke-width="1"/>`;
      }
      if (structure.kind === 'opening') return '';
      if (structure.kind === 'door') {
        const centerX = rect.x + rect.width;
        const centerY = rect.y + rect.height;
        return `<path d="M ${rect.x} ${centerY} A ${rect.width} ${rect.height} 0 0 1 ${centerX} ${rect.y}" fill="none" stroke="#9c9c98" stroke-width="1.4" stroke-dasharray="4 4" opacity=".65"/>`;
      }
      const isWall = structure.kind === 'outer-wall' || structure.kind === 'partition';
      if (isWall) return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#292929"/>`;
      if (structure.kind === 'counter') return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#ecece8" stroke="#5e5e5b" stroke-width="1.3"/>`;
      if (structure.kind === 'plumbing') return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="3" fill="#f3f3ef" stroke="#72726e" stroke-width="1.2"/><ellipse cx="${rect.x + rect.width / 2}" cy="${rect.y + rect.height / 2}" rx="${rect.width / 3}" ry="${rect.height / 4}" fill="none" stroke="#9e9e99" stroke-width="1"/>`;
      if (structure.label === 'shower') return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#f5f5f2" stroke="#777773" stroke-width="1.3"/><line x1="${rect.x}" y1="${rect.y}" x2="${rect.x + rect.width}" y2="${rect.y + rect.height}" stroke="#a0a09c" stroke-width="1"/><line x1="${rect.x + rect.width}" y1="${rect.y}" x2="${rect.x}" y2="${rect.y + rect.height}" stroke="#a0a09c" stroke-width="1"/>`;
      if (structure.label === 'toilet') return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#f5f5f2" stroke="#777773" stroke-width="1.2"/><path d="M ${rect.x + 10} ${rect.y + 24} C ${rect.x + 10} ${rect.y + 65}, ${rect.x + rect.width - 10} ${rect.y + 65}, ${rect.x + rect.width - 10} ${rect.y + 24}" fill="none" stroke="#989894" stroke-width="1"/>`;
      return `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="#f4f4f0" stroke="#777773" stroke-width="1"/>`;
    })
    .join('');
}

export function createPlanSvg(state: PlannerState, layoutId = state.activeLayoutId): string {
  const layout = state.layouts.find((candidate) => candidate.id === layoutId) ?? getActiveLayout(state);
  const selected = new Set(layoutId === state.activeLayoutId ? state.selectedIds : []);
  const route = layout.routeCheck;
  const routeResult = layoutId === state.activeLayoutId ? state.validation.route : null;
  const routeMarkup = state.overlays.showRoute && routeResult?.points.length
    ? `<polyline points="${routeResult.points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#cfe6d2" stroke-width="22" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/><polyline points="${routeResult.points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="#8fc79b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="2 0"/>`
    : '';
  const roomMarkup = state.rooms.map((room) => `<rect x="${room.rect.x}" y="${room.rect.y}" width="${room.rect.width}" height="${room.rect.height}" fill="${room.tone === 'bedroom' ? '#fcfcfb' : '#fff'}"/><text x="${room.rect.x + 16}" y="${room.rect.y + 25}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#b2b2ae" letter-spacing=".6">${escapeXml(room.name.toUpperCase())}</text>`).join('');
  const furnitureMarkup = layout.furniture.map((item) => furnitureSvg(item, selected.has(item.id))).join('');
  const labels = state.overlays.showLabels
    ? state.routePoints.map((point) => `<text x="${point.position.x + 8}" y="${point.position.y - 8}" font-family="Inter, Arial, sans-serif" font-size="10" fill="#9a9a95">${escapeXml(point.name)}</text>`).join('')
    : '';
  const dimension = state.overlays.measure.points.length === 2
    ? `<line x1="${state.overlays.measure.points[0].x}" y1="${state.overlays.measure.points[0].y}" x2="${state.overlays.measure.points[1].x}" y2="${state.overlays.measure.points[1].y}" stroke="#3b82f6" stroke-width="2" stroke-dasharray="5 4"/><text x="${(state.overlays.measure.points[0].x + state.overlays.measure.points[1].x) / 2}" y="${(state.overlays.measure.points[0].y + state.overlays.measure.points[1].y) / 2 - 8}" font-family="Inter, Arial, sans-serif" font-size="12" fill="#3b82f6" text-anchor="middle">${Math.round(Math.hypot(state.overlays.measure.points[0].x - state.overlays.measure.points[1].x, state.overlays.measure.points[0].y - state.overlays.measure.points[1].y))} cm</text>`
    : '';
  const northWall = state.fixedStructures.find((structure) => structure.id === 'wall-top')?.rect;
  const northMeasurement = state.wallMeasurements.find((measurement) => measurement.wallId === 'wall-top');
  const wallDimension = northWall && northMeasurement
    ? `<line x1="${northWall.x + 20}" y1="-18" x2="${northWall.x + northWall.width - 20}" y2="-18" stroke="#777773" stroke-width="1.2"/><line x1="${northWall.x + 20}" y1="-24" x2="${northWall.x + 20}" y2="-12" stroke="#777773" stroke-width="1.2"/><line x1="${northWall.x + northWall.width - 20}" y1="-24" x2="${northWall.x + northWall.width - 20}" y2="-12" stroke="#777773" stroke-width="1.2"/><text x="${northWall.x + northWall.width / 2}" y="-25" font-family="Inter, Arial, sans-serif" font-size="13" font-weight="600" fill="#777773" text-anchor="middle">${Math.round(northMeasurement.lengthCm)} cm</text>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1680" height="1080" viewBox="-40 -40 940 630" role="img" aria-label="Measured ${escapeXml(layout.name)} Lived In floor plan">
    <defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#eeeeec" stroke-width=".8"/></pattern></defs>
    <rect x="-40" y="-40" width="940" height="630" fill="#fff"/><rect x="-40" y="-40" width="940" height="630" fill="url(#grid)"/>
    ${roomMarkup}${structureSvg(state)}${wallDimension}${routeMarkup}${dimension}${furnitureMarkup}${labels}
    <text x="0" y="580" font-family="Inter, Arial, sans-serif" font-size="11" fill="#8c8c87">${escapeXml(layout.name)} · ${state.apartment.width} × ${state.apartment.height} cm · ${escapeXml(route.startId)} → ${escapeXml(route.endId)}</text>
  </svg>`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(state: PlannerState): void {
  downloadBlob(new Blob([createPlanSvg(state)], { type: 'image/svg+xml;charset=utf-8' }), `${state.project.name.toLowerCase().replace(/\s+/g, '-')}-${getActiveLayout(state).name.toLowerCase().replace(/\s+/g, '-')}.svg`);
}

export function downloadPng(state: PlannerState): void {
  const svgBlob = new Blob([createPlanSvg(state)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1680;
    canvas.height = 1080;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, `${state.project.name.toLowerCase().replace(/\s+/g, '-')}-${getActiveLayout(state).name.toLowerCase().replace(/\s+/g, '-')}.png`);
    }, 'image/png');
    URL.revokeObjectURL(url);
  };
  image.src = url;
}

function scheduleRows(state: PlannerState): string {
  return getActiveLayout(state).furniture.map((item) => `<tr><td>${escapeXml(item.name)}</td><td>${item.width} × ${item.depth} cm</td><td>${item.rotation}°</td><td>${item.ownership === 'owned' ? 'Owned' : formatCurrency(item.cost)}</td></tr>`).join('');
}

export function openPrintPreview(state: PlannerState): void {
  const preview = window.open('', '_blank', 'noopener,noreferrer,width=1100,height=850');
  if (!preview) return;
  const validation = state.validation;
  preview.document.title = `${state.project.name} · ${getActiveLayout(state).name}`;
  preview.document.body.innerHTML = `<main style="font-family:Inter,Arial,sans-serif;color:#171717;max-width:1100px;margin:36px auto;line-height:1.45"><header style="display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid #dededb;padding-bottom:18px"><div><div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#757570">Measured space plan</div><h1 style="font-weight:500;margin:6px 0 0">${escapeXml(state.project.name)} · ${escapeXml(getActiveLayout(state).name)}</h1></div><div style="font-size:13px;color:#6b6b6b;text-align:right">${state.apartment.width} × ${state.apartment.height} cm<br/>Scale ${escapeXml(state.apartment.scale)}</div></header><section style="margin:24px 0">${createPlanSvg(state).replace('<svg ', '<svg style="width:100%;height:auto;border:1px solid #e5e5e2" ')}</section><section style="display:grid;grid-template-columns:1fr 1fr;gap:24px"><div><h2 style="font-size:16px;font-weight:500">Furniture schedule</h2><table style="width:100%;font-size:13px;border-collapse:collapse"><thead><tr><th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 0">Item</th><th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 0">Dimensions</th><th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 0">Rotation</th><th style="text-align:left;border-bottom:1px solid #ddd;padding:6px 0">Cost</th></tr></thead><tbody>${scheduleRows(state)}</tbody></table></div><div><h2 style="font-size:16px;font-weight:500">Household brief</h2><p style="font-size:13px"><b>Residents</b> ${escapeXml(state.brief.residents)}<br/><b>Routines</b> ${escapeXml(state.brief.routines)}<br/><b>Hosting</b> ${escapeXml(state.brief.hosting)}<br/><b>Accessibility</b> ${escapeXml(state.brief.accessibility)}<br/><b>Minimum walking width</b> ${state.brief.minimumWalkingWidth} cm<br/><b>Budget</b> ${formatCurrency(state.brief.budget)} · <b>Planned spend</b> ${formatCurrency(validation.budget.spend)}</p><p style="font-size:13px"><b>Must keep</b><br/>${state.brief.mustKeep.map((item) => `• ${escapeXml(item)}`).join('<br/>')}</p></div></section><footer style="margin-top:28px;border-top:1px solid #dededb;padding-top:12px;color:#6b6b6b;font-size:12px">${escapeXml(state.project.disclaimer)} Checks are deterministic plan checks only; verify all measurements, clearances, utilities, and conditions with a qualified professional before purchase or construction.</footer></main><script>window.onload=()=>setTimeout(()=>window.print(),250)</script>`;
  preview.document.head.innerHTML = '<style>@page{size:A4 landscape;margin:14mm}body{margin:0}@media print{main{max-width:none!important;margin:0!important}}</style>';
  preview.focus();
}
