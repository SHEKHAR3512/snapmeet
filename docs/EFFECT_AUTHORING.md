# Authoring effects and collections

SnapMeet effects are **data** that select one of eight bundled rendering templates and tune
its parameters. A collection ("pack") is a JSON file. Packs cannot contain code, shaders,
HTML, expressions or remote media; new visual capabilities need a packaged extension update.

## Templates and parameters

| Template | Parameters (all optional, bounded) | Notes |
| --- | --- | --- |
| `dust-away` | `particleScale` 0.25–2, `dissolveMs` 1000–2500, `drift` −1…1, `ashTint` 0–1 | Must declare `requires: ["person-mask", "background"]` |
| `cinema` | `title` ≤32 chars, `barSize` 0.05–0.2, `grain` 0–0.4 | Monochrome + letterbox + title |
| `aura` | `label` ≤24, `score` 1–999999, `hue` 0–360 | Mask outline if available, frame glow otherwise |
| `dramatic-zoom` | `caption` ≤40, `punches` 1–3, `tint` bool, `maxZoom` 1.1–1.6 | Zooms toward the head when a mask exists |
| `confused-freeze` | `caption` ≤32, `questionMarks` 1–8 | Freeze frame |
| `impact-caption` | `caption` ≤32, `shake` 0–1, `hue` 0–360 | Shake is removed under reduced motion |
| `illustrated-fire` | `caption` ≤40, `intensity` 0.2–1 | Procedural flames |
| `success-title` | `title` ≤28, `subtitle` ≤28 | |

Captions reject `< > { } \ `` ` `` and control characters. Unknown keys anywhere are rejected.

## Definition fields

`id` (lowercase slug, unique across all collections and built-ins), `schemaVersion: 1`,
`template`, `title`, optional `description`, `regions` (`IN`, `US`, `GLOBAL`),
`languages` (BCP-47-ish, e.g. `hi`, `en`), `tags`, `durationMs` (500–15000),
`requires`, `minExtensionVersion`, `assetIds` (bundled ids only), `parameters`, `addedAt`
(`YYYY-MM-DD`), optional `reviewedAt`, optional `badge` (`new` | `trending`), optional
`sources` (`https` URLs with `checkedAt`), `attributionIds` (must exist in the pack's
`attributions`).

**Trending** is shown only when `badge: "trending"` *and* a source was checked within the
last 30 days. Otherwise recently added effects show **New**. Never invent popularity metrics.

## Workflow

1. Copy [`examples/example-pack.json`](examples/example-pack.json), bump `packVersion`.
2. Write an editorial record for each effect (keep it next to the pack, not in it):
   source links and the date checked, regions and language, why it works as a live camera
   effect, any external assets and their licence (V1 accepts none), review status.
   Research Indian regional and US sources separately.
3. Validate: `npm run catalog:validate -- my-pack.json`.
4. Test in the playground (Settings → Effect collections → Import, then open the playground).
5. Distribute: users import the file in Settings, or host it as static HTTPS JSON and set
   it as the **Remote collection** (checked at most daily; optional SHA-256 pin). Publish
   the SHA-256 (`shasum -a 256 my-pack.json`) alongside it.

Failed imports or refreshes never change the installed collection; the previous version
of each pack is kept for one-click rollback.

## Adding a new template (engine change)

Add the template id to `EFFECT_TEMPLATES` and a strict parameter schema in
`src/catalog/schema.ts`, implement an `EffectRenderer` (`src/effects/types.ts`) — usually
by extending `ShaderEffect` — register it in `src/effects/registry.ts`, add a CSS preview in
`src/ui/dock/EffectPreview.tsx`/`dock.css`, and extend `tests/e2e/renderer.spec.ts`.
Renderers must not allocate GPU resources per frame, must honour `reducedMotion`, and must
never flash luminance more than 3 times per second.
