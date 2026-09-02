# Lived In

Lived In is a measured 2D planning coworker for homeowners and interior professionals. It lets a person inspect and edit a seeded one-bedroom apartment while an agent distills household context, proposes a layout version, and makes reversible changes in the same visible plan. The app checks geometry deterministically; it does not claim to be a CAD tool, construction document, accessibility certification, or code-compliance system.

**Live app:** [lived-in.vercel.app](https://lived-in.vercel.app)

## Run it

From this directory:

```bash
npm install
npm run dev
```

The development server uses port `4174` when available. Open the printed local URL. The production check is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run preview` serves the production build locally.

## Product surface

- A 52px application bar with the functional furniture-panel toggle, household brief, layout versions, comparison, theme toggle, and export menu.
- A canvas-first measured apartment plan in centimetres. Walls, windows, openings, counters, plumbing fixtures, and door swing zones are fixed and visibly subordinate to movable furniture.
- Owned seeded inventory: sofa `200 × 90`, desk `120 × 60`, dining table `140 × 80` with four chairs, locked queen bed `160 × 200`, and estimated bookshelf `120 × 30`.
- Library inventory with armchair, coffee table, side table, dresser, wardrobe, floor lamp, plant, and rug. Library objects can be clicked or dragged onto the plan.
- Select, shift-select, drag, 10cm snap, rotate, lock/unlock, duplicate through the keyboard/action layer, custom items, estimated-dimension confirmation, measured distance tool, pan with Alt/Shift or middle drag, wheel/button zoom, fit-to-viewport, keyboard nudges, and undo/redo.
- Brief drawer with residents, routines, hosting, work-from-home, accessibility, must-keep rules, walking width, budget, source labels, route selection, and overlay controls.
- Deterministic SAT collisions, door-swing conflicts, clearance envelopes, grid route checks, budget validation, layout versions, comparison diffs, and visible bottom status feedback.
- SVG and PNG export plus a print/PDF preview containing the measured plan, furniture schedule, brief summary, assumptions, and non-construction disclaimer.
- Light and dark themes persisted in local storage. First visit follows the browser color preference when no selection exists; the light theme is the reference presentation.

## Architecture

`src/types.ts` contains the serializable canonical state and typed actions. `src/data.ts` is the deterministic seeded apartment, catalogue, fixed structures, named route points, and Layout A. `src/geometry.ts` contains pure polygon/SAT geometry, clearance envelopes, grid route search, budget and validation derivation. `src/state.ts` is the shared reducer/action layer with history snapshots and bounded state summaries. `src/App.tsx` is the human UI and SVG renderer. `src/exports.ts` produces measured export output. `src/webmcp.ts` defines and registers the page tools.

The UI and WebMCP calls both dispatch the same `PlannerAction` variants. A write updates canonical state, recomputes validation, focuses the affected stable ID for a short pulse, writes a bottom status message, and adds an undo snapshot. Invalid tool input and locked/fixed mutations return recoverable structured errors rather than guessing an ID.

## WebMCP tools

When the browser exposes the imperative API, the top-level page feature-detects `document.modelContext.registerTool(...)`, registers each tool with a strict JSON Schema, and unregisters all tools with an effect-owned `AbortController` on teardown. This keeps development remounts deterministic under React Strict Mode without suppressing the second registration. Unsupported browsers retain the complete human UI and show a development-only fallback inspector.

Registered operations:

| Tool | Purpose |
| --- | --- |
| `get_plan_state` | Bounded rooms, fixed-structure summary, active layout, placed items, brief, route points, budget, and validation. |
| `list_furniture` | Filter placed or library items by scope/query. |
| `set_household_brief` | Apply distilled context and compact `sources[{type,label}]`. |
| `update_wall_measurement` | Correct the north exterior wall (`wall-top`, 760–960 cm) and propagate shared geometry across layouts. |
| `create_layout_version` | Duplicate a source layout into a named working version and switch to it. |
| `add_furniture` | Add a library item or explicit custom item at a measured position. |
| `update_furniture` | Move, rotate, resize a custom item, lock/unlock, update cost, or confirm dimensions. |
| `remove_furniture` | Remove one unlocked item, with the change remaining undoable. |
| `set_route_check` | Select named start/end points and a minimum walking width. |
| `validate_layout` | Return collisions, door-swing conflicts, clearance failures, route details, assumptions, budget, and affected IDs. |
| `compare_layouts` | Compare moved/added/removed objects and validation/budget summaries. |
| `set_active_layout` | Switch the visible layout version. |

Read tools are marked with `readOnlyHint`. Inputs reject unknown fields both at the schema boundary and in runtime validation. Outputs are bounded and redact no external connector secrets because the site never pretends to access connector accounts.

## Synthetic connector-context demo

The intended winning angle is Codex orchestration: Codex reads a household brief from Drive, a budget from Sheets, routines from Calendar, and the latest request from Gmail or Slack, distills them, and calls this page's tools. There are no fake connector clients in the website. For a local rehearsal, use this bounded fixture as the distilled call input:

```json
{
  "residents": "Two people",
  "routines": "Two adults work from home on weekdays.",
  "hosting": "Host dinner for six twice monthly.",
  "workFromHome": "Two dedicated work-from-home seats.",
  "accessibility": "A parent using a walker visits Sundays.",
  "mustKeep": ["Kitchen plumbing", "Owned queen bed"],
  "minimumWalkingWidth": 90,
  "budget": 1200,
  "notes": "Keep the entry route legible and do not move plumbing.",
  "sources": [
    { "type": "Drive", "label": "Household brief · Sep 2" },
    { "type": "Sheets", "label": "Renovation budget · Sep 2" },
    { "type": "Calendar", "label": "Weekly routines · Sep 2" },
    { "type": "Gmail", "label": "Latest request · Sep 2" }
  ]
}
```

## Under-three-minute demo flow

1. Start on Layout A and show the plan, five owned items, `No collisions · Routes clear · Within budget`, and the selected sofa.
2. Call `set_household_brief` with the fixture above. Open Brief so the person sees the synthesized constraints and source labels.
3. Call `create_layout_version` with `Layout B`; the visible header switches and Layout A remains intact.
4. Call `list_furniture`, then `add_furniture` for `armchair` and `update_furniture` for the sofa. The changed object pulses blue and the bottom status says `Agent · ...`.
5. Call `set_route_check` from `entry` to `bathroom` at `90cm`, then `validate_layout`. Move the sofa into the counter zone for a deliberate collision/narrow-route review; the red status appears immediately.
6. Call `update_furniture` to restore the sofa, or use Undo, validate again, then `compare_layouts` between Layout A and Layout B. End on the side-by-side comparison and Export menu.

For the measured-plan correction demo, call `update_wall_measurement` with `{ "wallId": "wall-top", "lengthCm": 840 }` after the prompt: `Wait, I remeasured the north exterior wall. It is 840 centimetres, not 860. Correct the plan and adapt anything that no longer fits.` The correction updates the visible wall label, rooms, fixed right-side geometry, anchored route points, furniture across every layout, validation, and undo history.

The browser's WebMCP Site tools UI is the intended visible agent-call surface. In an ordinary browser, the dev-only `Tools fallback` button invokes the exact same handlers and is useful for recording a deterministic local demo.

## Deployment

This is a static Vite build. Run `npm run build` and publish `dist/` to any static host. Configure the host to serve `index.html` for the root route and to preserve these headers when the platform permits them:

```text
Origin-Agent-Cluster: ?1
Permissions-Policy: tools=(self)
```

WebMCP support is progressive and browser-dependent. The human app remains usable without the API. Because the plan is page-local, a browser agent must visit the page before discovering its tools.

## Tests and limitations

The Vitest suite covers rotated SAT overlap, seeded validity, blocked routes, structure collisions, state mutations, locked-item errors, Layout A preservation, custom resize/budgeting, strict schemas, runtime unknown-field rejection, and the complete connector-context tool journey. The app deliberately uses the seeded measured plan and manual input; arbitrary photo/PDF floor-plan recognition, 3D, structural editing, purchasing, AR, collaboration, and code-compliance claims are outside v1.

## License

MIT. The source code, seeded floor plan, furniture catalogue, and bundled visual materials are original materials created specifically for this project and are released under the repository's MIT license. Third-party packages remain subject to their respective licenses. See [`LICENSE`](./LICENSE).
