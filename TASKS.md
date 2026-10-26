# SnapMeet tasks

Status key: ✅ implemented + tested · 🧪 implemented, automated stand-in tests only ·
⏳ pending (needs a person, device or real Meet) · ⬜ not started

## M0 — Foundation and real Meet proof
- ✅ TypeScript/Vite/React scaffold, pinned deps, lockfile, unpacked build, ZIP packaging
- ✅ MAIN-world `getUserMedia` wrapper at `document_start`, isolated controller, port handshake
- ✅ Proof mode (grayscale + time-varying watermark)
- 🧪 Processed video received by a WebRTC peer; mic preserved; camera release on stop/toggle
- ⏳ **Second participant in a real Meet call sees processed video** (steps in docs/FEASIBILITY.md)
- ✅ Playground (extension page + `npm run dev`) with WebRTC loopback

## M1 — Reliable media engine
- ✅ Renderer lifecycle, stream/consumer registry, clone/stop ownership, quality presets + adaptive quality
- ✅ Recovery state + neutral safe frame, diagnostics panel
- ✅ Vision in a worker under Meet CSP + Trusted Types (main-thread fallback)
- 🧪 Repeated acquisitions/toggles, applyConstraints, enabled=false
- ⏳ Device switch / unplug on real hardware; Meet's own device-switch flow

## M2 — Dust Away
- ✅ Person mask, empty-room capture (countdown, person check, drift/stale warnings), virtual + custom backgrounds
- ✅ GPU dissolve + stateless particles, vanish/reappear, timer or stay vanished, manual triggers
- ✅ Hidden state transmits background only (renderer fixture + receiver test)
- ⏳ Real person, real room, lighting conditions

## M3 — Gesture activation
- ✅ Snap heuristic (palm-normalized, per-hand tracks, release window, curl check, cooldown, hysteresis)
- ✅ Calibration (5 attempts, suggestion), tracking feedback, palms rule, gesture trial lab
- ⏳ Consented trials: ≥80 % of 30 snaps, ≤1 false trigger / 10 min, >1 person and lighting. Ships **experimental, off by default** until measured.

## M4 — Product interface and eight effects
- ✅ Dock (effects/setup/gestures/diagnostics), search, region filters, favorites, New/Trending rules
- ✅ Eight templates + reduced-motion variants, readable remote captions (visual review done on synthetic scenes)
- ✅ Popup, options page, keyboard shortcuts (commands + in-page fallback, ignored in text fields)
- ⏳ Screen-reader pass in real Meet; Meet layout overlap check

## M5 — Hardening and beta package
- ✅ Unit + e2e suites, network audit, lifecycle stress, 30-min soak (headless)
- ✅ README, ARCHITECTURE, FEASIBILITY, TEST_RESULTS, PRIVACY, EFFECT_AUTHORING, THIRD_PARTY_NOTICES
- ⏳ Performance on i5-9300H/GTX 1650 and an integrated-GPU laptop
- ⏳ Hidden/minimised window behaviour in real Chrome; Meet built-in background effects combination
- ⏳ Re-confirm model licence terms before any store submission (no publishing done)

## M6 — Data-driven updates
- ✅ Pack schema, CLI validator, example pack, import, rollback, disable/remove
- ✅ Optional HTTPS remote collection (daily, size/type/SHA-256 checks, per-site permission, keeps last good)
- ⬜ Curated IN/US collections with editorial records (needs human research)

## Next concrete step
Run the manual two-device Meet test (docs/FEASIBILITY.md, "Manual Meet validation") with
Proof mode on, and record the result in docs/TEST_RESULTS.md.
