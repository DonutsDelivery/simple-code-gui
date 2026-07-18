# Canvas 2.0 Interaction & Visual Specification

Status: implementation reference

## Product idea

Canvas is a second view of an existing workspace, not a replacement for Tiles. Workspaces continue to own sessions and PTYs. Tiles and Canvas render the same sessions while preserving independent layouts.

The memorable quality is **quiet orchestration**: a dark spatial field where ordinary work recedes and the few sessions requiring attention become obvious. The surface should feel closer to an instrument panel or architectural drafting table than a whiteboard.

## Composition

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Workspace rail                       Tiles  Canvas          Search      72% │
├──────────────┬──────────────────────────────────────────────────────────────┤
│              │  PROJECT / WORKTREE                                        │
│  Projects    │  ┌───────────────────────────┐      ┌────────────────────┐  │
│  and agents  │  │ agent · implementation    │      │ review             │  │
│              │  │ ───────────────────────── │      │ waiting for input  │  │
│  collapsible │  │                           │      └────────────────────┘  │
│              │  │        terminal           │                             │
│              │  │                           │        · · · · · · · ·      │
│              │  └───────────────────────────┘                             │
│              │                       ┌──────────────────────────┐          │
│              │                       │ tests · completed        │          │
│              │                       └──────────────────────────┘          │
│              │                                                ┌─────────┐ │
│              │                                                │ minimap │ │
└──────────────┴────────────────────────────────────────────────┴─────────┴─┘
```

- The existing title bar remains the outer shell.
- The workspace switcher becomes a low-chrome rail above the content surface.
- A compact segmented control switches Tiles/Canvas per workspace.
- The sidebar remains available but can collapse to an icon rail so Canvas receives most of the viewport.
- Camera controls float in screen space. They never scale with the world.
- The minimap occupies the lower-right corner and fades when idle.

## Aesthetic direction: nocturnal drafting table

The Canvas is near-black blue-charcoal rather than pure black. Fine major/minor dots establish scale without becoming texture noise. Nodes use dense graphite surfaces, hairline borders, and narrow highlights rather than large glow effects. Warm copper remains the application accent; cool project colors appear only in identity marks.

### Typography

- UI/display: retain Plus Jakarta Sans initially for product consistency, but tighten weights and tracking. Evaluate **Instrument Sans** as the 2.0 UI face only if bundling/license review succeeds.
- Terminal: existing user-selected terminal font.
- Project and group labels: 11px, 600 weight, uppercase, 0.11em tracking.
- Node title: 12px, 600 weight, tight tracking.
- Status/meta: 10–11px, tabular numerals where appropriate.

### Semantic tokens

```css
--canvas-base: #090b0f;
--canvas-atmosphere: #0d1117;
--canvas-grid-minor: rgba(205, 214, 225, 0.055);
--canvas-grid-major: rgba(205, 214, 225, 0.095);
--canvas-node: rgba(18, 21, 28, 0.96);
--canvas-node-raised: rgba(23, 27, 35, 0.98);
--canvas-node-border: rgba(226, 232, 240, 0.11);
--canvas-node-border-hover: rgba(226, 232, 240, 0.20);
--canvas-selection: #e88953;
--canvas-selection-soft: rgba(232, 137, 83, 0.16);
--canvas-focus-ring: rgba(255, 211, 177, 0.9);
--canvas-group-fill: rgba(255, 255, 255, 0.018);
--canvas-group-border: rgba(255, 255, 255, 0.075);
--canvas-depth: 0 18px 56px rgba(0, 0, 0, 0.46);
--canvas-depth-focus: 0 24px 72px rgba(0, 0, 0, 0.60);
```

Theme application may derive these from existing background/accent values, but contrast between surface layers must remain stable.

## Terminal nodes

### Geometry

- Default size: 680 × 420 world pixels.
- Minimum interactive size: 360 × 220 world pixels.
- Radius: 10px; groups use 14px.
- Header: 34px at detail scale.
- Terminal content padding: 6–8px.
- Selected node receives a 1px copper outline and four quiet corner handles.
- Keyboard focus uses a separate high-contrast outer ring; selection and focus must not be conflated.

### Header anatomy

```text
[project mark] Title                         status · backend  [•••]
               project / worktree
```

Secondary actions appear only on hover, selection, or keyboard focus. A header never shows a permanent row of close/add/maximize buttons.

### Attention states

| State | Treatment |
|---|---|
| Running | low-amplitude activity stroke; no glow |
| Waiting | copper edge marker and concise “needs input” label |
| Completed | desaturated green check; node settles visually |
| Failed/exited | red edge notch and readable error label |
| Restoring | skeleton terminal lines and replay progress |
| Suspended preview | dim terminal texture with “preview” status |
| Unread output | small count/pulse on identity mark; pulse stops under reduced motion |

Status color is never the sole signal; icon and label accompany important states.

## Semantic zoom

| Zoom | Node rendering |
|---|---|
| 85–200% | Full interactive terminal and detailed header |
| 55–85% | Terminal preview remains; controls collapse; metadata shortens |
| 30–55% | Summary card: title, project/worktree, state, recent activity line |
| 20–30% | Identity tile: title, status glyph, project color mark |

Crossing thresholds uses a 100–140ms opacity transition. Do not continuously scale terminal fonts or refit PTYs while zooming.

Group labels become more prominent as nodes simplify. At overview scale the user sees the topology of work, not microscopic terminal text.

## Camera and navigation

- Middle drag or Space + primary drag: pan freely in both axes.
- Wheel/trackpad: pan.
- Ctrl/Cmd + wheel: cursor-anchored zoom.
- `0`: fit all; `Shift+0`: reset to 100%; `F`: fit selection.
- Arrow keys on Canvas: spatially focus nearest node.
- Enter: activate focused terminal; Escape: return focus to Canvas.
- Search/jump (`Ctrl/Cmd+K`) finds sessions, projects, worktrees, and groups.
- Minimap click/drag changes camera; viewport is rendered as a thin copper rectangle.
- Camera controls: minus, percentage, plus, fit-all. They collapse to percentage when idle.

The world has no hard positional bounds. Zoom is limited initially to 20–200%.

## Selection and manipulation

- Primary click selects one node and raises it.
- Shift/Ctrl/Cmd click toggles membership.
- Empty-space drag creates a marquee.
- Dragging any selected node moves the full selection.
- Resize handles appear only for a single selection initially.
- Dragging a sidebar project/session onto empty Canvas places it at that world point.
- Alignment guides appear within an 8-world-pixel snap threshold.
- `G`: group selection; `Shift+G`: ungroup.
- Arrangement menu: row, column, grid, compact stack, tidy selection.
- Moving a node after automatic arrangement detaches that node; it does not scramble the remaining arrangement.

Every pointer action has a keyboard-accessible command counterpart through shortcuts and the command palette.

## Project/worktree frames

Frames are quiet regions, not heavy cards:

- 1px dashed or hairline boundary.
- Very low-opacity fill.
- Label sits above the upper-left corner and remains legible at overview scale.
- Collapsed frame becomes a compact summary card with session counts by state.
- Project color appears as a 2px label rule, not a full colored background.
- Frames may be user-created for tasks, but the product does not expose arbitrary shapes or connector drawing in the initial release.

## View coexistence

- Tiles/Canvas selection is persisted per workspace.
- Switching views never changes session identity or process lifetime.
- Each view remembers its geometry independently.
- A newly opened session is placed in the active view immediately and receives a deterministic placement in the inactive view.
- “Arrange as Tiles” operates inside Canvas and does not overwrite the tile tree.
- The Tiles view remains unchanged as a trusted fallback during preview rollout.

## Empty state

The empty Canvas should teach the spatial model without becoming a landing page:

```text
Drop a project or start a session

N  New session     Space-drag  Pan     Ctrl-scroll  Zoom
```

A faint crosshair marks the camera origin. No illustration or oversized marketing copy.

## Compact desktop

Below approximately 900px usable Canvas width:

- Sidebar defaults collapsed.
- Minimap collapses to an overview button.
- Camera control becomes one compact pill.
- Node control menus remain contextual.
- Workspace rail horizontally scrolls.
- Canvas remains two-dimensional; the app does not silently reorder nodes.

## Mobile projection

Mobile retains focused full-screen terminal slides and an ordered session list. Canvas groups may appear as section labels, but coordinates, z-order, and camera never drive mobile navigation. Mobile changes to session membership reconcile both desktop layouts without changing surviving Canvas geometry.

## Motion and performance rules

- Camera and node gestures use transforms only; no blur changes during movement.
- Shadows reduce to a cheap preset while panning/resizing.
- Grid is a CSS background or single lightweight layer, never thousands of DOM marks.
- Terminal semantic transitions do not animate dimensions.
- Default motion durations: 110ms direct manipulation feedback, 160ms chrome, 220ms group collapse.
- `prefers-reduced-motion` removes zoom crossfades, pulses, and interpolated camera travel.
- No animated ambient gradients, backdrop-filter on node collections, or per-node continuous glow.

## Accessibility

- Canvas surface, nodes, groups, minimap, and view selector have explicit roles and labels.
- A screen-reader outline mirrors the scene as an ordered tree of groups and nodes.
- Focus remains visible at every zoom level.
- Important status changes use polite announcements; failures and required input are assertive only when user action is blocked.
- Resize handles have enlarged invisible hit targets.
- Contrast targets: 4.5:1 text, 3:1 meaningful non-text boundaries and focus.
- Terminal activation and Escape behavior prevent keyboard traps.

## Implementation acceptance snapshots

Capture and compare these states in the isolated Electron test instance:

1. Empty Canvas, sidebar expanded.
2. Three terminal nodes across two project frames.
3. One selected node and one waiting node.
4. Multi-selection with alignment guides.
5. Overview scale with semantic cards and minimap.
6. Collapsed group plus failed session.
7. Restoring/suspended previews.
8. Compact desktop with collapsed sidebar.
9. Reduced-motion mode.
10. Customized theme proving semantic token derivation.
