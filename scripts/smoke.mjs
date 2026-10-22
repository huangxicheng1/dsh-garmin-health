/**
 * Live smoke test for the Host half.
 *
 * Run with: node garmin-health/scripts/smoke.mjs
 * It reads the real token store, refreshes it when expired, and prints a
 * summary of what the panel would receive. No token value is printed.
 */

import { createGarminService } from '../lib/index.js'

const service = createGarminService({ pollMinutes: 5, chinaRegion: true, defaultDays: 7 })
await service.loadSettings()
const started = Date.now()
const snap = await service.snapshot(7, { force: true })

console.log(
  JSON.stringify(
    {
      elapsedMs: Date.now() - started,
      ok: snap.ok,
      auth: snap.auth,
      region: snap.region,
      hasData: snap.hasData,
      badges: snap.badges,
      counts: {
        hrPoints: snap.heartRate?.points?.length ?? 0,
        hrvDays: snap.hrv?.days?.length ?? 0,
        hrvReadings: snap.hrv?.readings?.length ?? 0,
        stressPoints: snap.stress?.points?.length ?? 0,
        batteryPoints: snap.bodyBattery?.points?.length ?? 0,
        sleepDays: (snap.sleep ?? []).filter((row) => row.total > 0).length,
        stepDays: (snap.steps ?? []).filter((row) => row.steps > 0).length,
        loadPoints: (snap.training?.load ?? []).filter((row) => row.acute !== null || row.chronic !== null).length,
        activities: snap.activities?.length ?? 0,
      },
      warnings: snap.warnings,
    },
    null,
    2,
  ),
)
