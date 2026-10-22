/**
 * Host half of the Garmin health dashboard.
 *
 * Reads the OAuth token store written by python-garminconnect / garmin_mcp
 * (`~/.garminconnect/garmin_tokens.json`), talks to the Garmin Connect REST
 * API directly, normalizes the payloads for the Client charts, and serves the
 * result on an authenticated `/api/dsh-garmin/*` route.
 *
 * The token never leaves this process: routes only return derived metrics.
 */

import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const NATIVE_UA = 'GCM-Android-5.23'
const NATIVE_X_UA =
  'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0'

const DEFAULT_SETTINGS = {
  pollMinutes: 5,
  chinaRegion: false,
  defaultDays: 7,
  accent: 'auto',
  tokenPath: '',
  cards: {
    heartRate: true,
    hrv: true,
    bodyBattery: true,
    sleep: true,
    steps: true,
    training: true,
    activities: true,
  },
}

class AuthError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

class GarminHttpError extends Error {
  constructor(status, path) {
    super(`Garmin API ${status} for ${String(path).split('?')[0]}`)
    this.name = 'GarminHttpError'
    this.status = status
  }
}

/* ------------------------------------------------------------------ paths */

/**
 * Expand the path forms a portable config needs: `~`, `%LOCALAPPDATA%` on
 * Windows, and `${VAR}` anywhere. Unknown variables are left untouched so a
 * missing one surfaces as a clear "file not found" instead of a silent path.
 */
function expandHome(input) {
  if (typeof input !== 'string' || input.length === 0) return ''
  let value = input
  if (process.platform === 'win32') {
    value = value.replace(/%([^%]+)%/g, (match, name) =>
      process.env[name] ? process.env[name] : match,
    )
  }
  value = value.replace(/\$\{([^}]+)\}/g, (match, name) =>
    process.env[name] ? process.env[name] : match,
  )
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

function dshHome() {
  return expandHome(process.env.DSH_HOME) || path.join(os.homedir(), '.dsh')
}

function resolveTokenFile(configured) {
  const base =
    expandHome(configured) ||
    expandHome(process.env.GARMINTOKENS) ||
    path.join(os.homedir(), '.garminconnect')
  return path.extname(base).toLowerCase() === '.json'
    ? base
    : path.join(base, 'garmin_tokens.json')
}

/**
 * Resolve one candidate location to a token file, or null when it holds none.
 * A directory may hold the garmin_mcp store (`garmin_tokens.json`) or another
 * plugin's account sessions (`*.session.json`); the most recently written
 * session wins so that plugin's own refresh is always picked up.
 */
async function findTokenIn(base) {
  const stat = await fsp.stat(base).catch(() => null)
  if (!stat) return null
  if (stat.isFile()) return base
  if (!stat.isDirectory()) return null
  const direct = path.join(base, 'garmin_tokens.json')
  if (await fsp.stat(direct).then((info) => info.isFile()).catch(() => false)) return direct
  const entries = await fsp.readdir(base).catch(() => [])
  const candidates = []
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue
    const full = path.join(base, name)
    const info = await fsp.stat(full).catch(() => null)
    if (info && info.isFile()) candidates.push({ file: full, mtime: info.mtimeMs })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].file
}

/**
 * Find the token file, in order: the configured path, `$GARMINTOKENS`, then the
 * standard `~/.garminconnect`. The fallbacks keep the panel working when the
 * configured store disappears (an uninstalled companion plugin, a reset).
 */
async function locateTokenFile(configured) {
  const bases = []
  const add = (value) => {
    if (value && !bases.some((base) => base.toLowerCase() === value.toLowerCase())) bases.push(value)
  }
  add(expandHome(configured))
  add(expandHome(process.env.GARMINTOKENS))
  add(path.join(os.homedir(), '.garminconnect'))
  for (const base of bases) {
    const file = await findTokenIn(base)
    if (file) return { file, base, tried: bases }
  }
  return { file: null, base: null, tried: bases }
}

function resolveCacheDir(configured) {
  return expandHome(configured) || path.join(dshHome(), 'garmin-cache')
}

/* ------------------------------------------------------------------- time */

function pad(n) {
  return n < 10 ? `0${n}` : String(n)
}

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function today() {
  return ymd(new Date())
}

function addDays(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + delta)
  return ymd(date)
}

function lastDays(days) {
  const end = today()
  const list = []
  for (let i = days - 1; i >= 0; i -= 1) list.push(addDays(end, -i))
  return list
}

/* ---------------------------------------------------------------- storage */

async function readJsonFile(file, fallback = undefined) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fsp.rename(tmp, file)
}

/* ------------------------------------------------------------- garmin api */

function decodeJwt(token) {
  const parts = String(token || '').split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function tokenExpiryMs(token) {
  const payload = decodeJwt(token)
  const exp = Number(payload && payload.exp)
  return Number.isFinite(exp) ? exp * 1000 : 0
}

/**
 * Accept the token stores this plugin may be pointed at:
 *  - python-garminconnect / garmin_mcp: { di_token, di_refresh_token, di_client_id }
 *  - dsh-plugin-garmin-connect: { kind, clientId, tokens: { accessToken, refreshToken, accessExpiresAtMs } }
 *  - garth legacy: { oauth2_token: { access_token, refresh_token, expires_at } }
 */
function readTokenPayload(raw) {
  const nested = raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : null
  const legacy = raw.oauth2_token && typeof raw.oauth2_token === 'object' ? raw.oauth2_token : null
  const token =
    raw.di_token || raw.access_token || (nested && nested.accessToken) || (legacy && legacy.access_token) || ''
  const refresh =
    raw.di_refresh_token ||
    raw.refresh_token ||
    (nested && nested.refreshToken) ||
    (legacy && legacy.refresh_token) ||
    ''
  const clientId = raw.di_client_id || raw.clientId || (nested && nested.clientId) || ''
  let expiresAt = Number((nested && nested.accessExpiresAtMs) || 0)
  if (!expiresAt && legacy && legacy.expires_at) expiresAt = Number(legacy.expires_at) * 1000
  return { token, refresh, clientId, expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 }
}

function nativeHeaders(extra) {  return {
    'User-Agent': NATIVE_UA,
    'X-Garmin-User-Agent': NATIVE_X_UA,
    'X-Garmin-Paired-App-Version': '10861',
    'X-Garmin-Client-Platform': 'Android',
    'X-App-Ver': '10861',
    'X-Lang': 'en',
    'X-GCExperience': 'GC5',
    'Accept-Language': 'en-US,en;q=0.9',
    ...extra,
  }
}

function createGarmin(getSettings) {
  const state = {
    token: '',
    refresh: '',
    clientId: '',
    expiresAt: 0,
    fileMtime: 0,
    state: 'unknown',
    message: 'Token store has not been read yet.',
    switchedToChina: false,
    file: '',
    fallback: false,
  }

  // Read the settings lazily: the service replaces its settings object when the
  // user saves the settings page, so a captured reference would go stale.
  const currentDomain = () =>
    state.switchedToChina || getSettings().chinaRegion ? 'garmin.cn' : 'garmin.com'

  let refreshing = null

  async function postRefresh(domain) {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: state.clientId,
      refresh_token: state.refresh,
    })
    const response = await fetch(`https://diauth.${domain}/di-oauth2-service/oauth/token`, {
      method: 'POST',
      headers: nativeHeaders({
        Authorization: `Basic ${Buffer.from(`${state.clientId}:`).toString('base64')}`,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      }),
      body,
      signal: AbortSignal.timeout(20000),
    })
    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
    return { ok: response.ok, status: response.status, data, text }
  }

  async function loadTokens(force) {
    const located = await locateTokenFile(getSettings().tokenPath)
    if (!located.file) {
      state.state = 'missing'
      state.fallback = false
      state.message = `找不到 Garmin token 文件。试过：${located.tried.join('；')}。请先运行 garmin-mcp-auth 登录，或在设置里指定 token 文件。`
      throw new AuthError('missing', state.message)
    }
    const file = located.file
    const primaryBase =
      expandHome(getSettings().tokenPath) ||
      expandHome(process.env.GARMINTOKENS) ||
      path.join(os.homedir(), '.garminconnect')
    state.fallback = located.base.toLowerCase() !== primaryBase.toLowerCase()
    let stat
    try {
      stat = await fsp.stat(file)
    } catch {
      state.state = 'missing'
      state.message = `找不到 Garmin token 文件：${file}。请先运行 garmin-mcp-auth 登录，或在设置里指定 token 文件。`
      throw new AuthError('missing', state.message)
    }
    // A different file wins immediately: the configured store may have
    // appeared since the last read (a companion plugin just signed in), in
    // which case the fallback token must stop being used.
    if (!force && state.token && state.file === file && stat.mtimeMs === state.fileMtime) {
      return state
    }
    state.file = file

    const raw = await readJsonFile(file, null)
    if (!raw || typeof raw !== 'object') {
      state.state = 'invalid'
      state.message = `Token 文件无法解析：${file}。请运行 garmin-mcp-auth --force-reauth。`
      throw new AuthError('invalid', state.message)
    }

    const parsed = readTokenPayload(raw)
    if (!parsed.token) {
      state.state = 'invalid'
      state.message = `Token 文件里没有可用的 access token（支持 garmin_mcp 的 di_token 和 dsh-plugin-garmin-connect 的 tokens.accessToken）：${file}。`
      throw new AuthError('invalid', state.message)
    }

    state.token = parsed.token
    state.refresh = parsed.refresh
    state.clientId =
      parsed.clientId ||
      (decodeJwt(parsed.token) && decodeJwt(parsed.token).client_id) ||
      'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2'
    state.expiresAt = tokenExpiryMs(parsed.token) || parsed.expiresAt || 0
    state.fileMtime = stat.mtimeMs
    state.state = 'ok'
    state.message = ''
    return state
  }

  async function refreshToken() {
    if (refreshing) return refreshing
    refreshing = (async () => {
      if (!state.refresh || !state.clientId) {
        state.state = 'expired'
        state.message = 'Garmin token 已过期，且 token 文件里没有可用的 refresh token。请重新运行 garmin-mcp-auth。'
        throw new AuthError('expired', state.message)
      }

      let attempt
      try {
        attempt = await postRefresh(currentDomain())
      } catch (error) {
        state.state = 'expired'
        state.message = `刷新 Garmin token 时网络请求失败：${error && error.message ? error.message : error}`
        throw new AuthError('expired', state.message)
      }

      // A China-region account does not exist in the .com user database: Garmin
      // answers `invalid_grant ... doesn't exist in DB`. Retry the same refresh
      // against the .cn auth host and keep using garmin.cn from then on.
      const looksChinese =
        !attempt.ok &&
        /doesn.t exist in DB|invalid_grant|GarminGUID/i.test(String(attempt.text || ''))
      if (looksChinese && currentDomain() === 'garmin.com') {
        try {
          const retry = await postRefresh('garmin.cn')
          if (retry.ok) {
            attempt = retry
            state.switchedToChina = true
          }
        } catch {
          /* keep the original failure below */
        }
      }

      if (!attempt.ok) {
        state.state = 'expired'
        state.message =
          attempt.status === 400 && looksChinese && currentDomain() === 'garmin.com'
            ? '这个 Garmin 账号属于中国区，请打开设置里的「Garmin 中国区账号」，或重新运行 garmin-mcp-auth。'
            : `Garmin 拒绝了刷新请求（HTTP ${attempt.status}）。请重新运行 garmin-mcp-auth --force-reauth。`
        throw new AuthError('expired', state.message)
      }

      const data = attempt.data
      if (!data || !data.access_token) {
        state.state = 'expired'
        state.message = 'Garmin 刷新响应里没有 access_token。请重新运行 garmin-mcp-auth。'
        throw new AuthError('expired', state.message)
      }
      state.token = data.access_token
      if (data.refresh_token) state.refresh = data.refresh_token
      const payload = decodeJwt(state.token)
      if (payload && payload.client_id) state.clientId = String(payload.client_id)
      state.expiresAt = tokenExpiryMs(state.token)
      state.state = 'ok'
      state.message = ''
      return state
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  async function ensureToken() {
    if (!state.token) await loadTokens(false)
    if (state.expiresAt && Date.now() > state.expiresAt - 15 * 60 * 1000) {
      // Another tool (garmin_mcp, dsh-plugin-garmin-connect) may already have
      // rotated the token on disk; take its fresher copy before refreshing.
      await loadTokens(true).catch(() => {})
      if (state.expiresAt && Date.now() > state.expiresAt - 15 * 60 * 1000) await refreshToken()
    }
    return state.token
  }

  async function request(apiPath, params) {
    const attempt = async (retried) => {
      const token = await ensureToken()
      const url = new URL(
        `https://connectapi.${currentDomain()}${apiPath.startsWith('/') ? apiPath : `/${apiPath}`}`,
      )
      if (params) {
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
        }
      }
      let response
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: nativeHeaders({
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          }),
          signal: AbortSignal.timeout(25000),
        })
      } catch (error) {
        throw new Error(`无法连接 Garmin（${currentDomain()}）：${error && error.message ? error.message : error}`)
      }
      if (response.status === 401 && !retried) {
        await refreshToken()
        return attempt(true)
      }
      if (response.status === 429) throw new GarminHttpError(429, url.pathname)
      if (!response.ok) throw new GarminHttpError(response.status, url.pathname)
      if (response.status === 204) return null
      return response.json().catch(() => null)
    }

    return attempt(false)
  }

  return {
    state,
    get domain() {
      return currentDomain()
    },
    request,
    loadTokens,
    async status() {
      return {
        state: state.state,
        message: state.message,
        expiresAt: state.expiresAt || null,
        domain: null,
        switchedToChina: state.switchedToChina,
      }
    },
  }
}

/* ------------------------------------------------------------ normalizers */

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function round(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

function hrPoints(payload) {
  const values = Array.isArray(payload && payload.heartRateValues) ? payload.heartRateValues : []
  const points = []
  for (const entry of values) {
    if (!Array.isArray(entry)) continue
    const ts = num(entry[0])
    const bpm = num(entry[1])
    if (ts && bpm && bpm > 0) points.push([ts, Math.round(bpm)])
  }
  return points
}

function stressPoints(payload) {
  const values = Array.isArray(payload && payload.stressValuesArray) ? payload.stressValuesArray : []
  const points = []
  for (const entry of values) {
    if (!Array.isArray(entry)) continue
    const ts = num(entry[0])
    const value = num(entry[1])
    if (ts && value !== null && value >= 0) points.push([ts, Math.round(value)])
  }
  return points
}

function bodyBatteryPoints(report) {
  const rows = Array.isArray(report) ? report : report ? [report] : []
  const points = []
  for (const day of rows) {
    const values = Array.isArray(day && day.bodyBatteryValuesArray) ? day.bodyBatteryValuesArray : []
    for (const entry of values) {
      if (!Array.isArray(entry)) continue
      const ts = num(entry[0])
      const value = num(entry[1])
      if (ts && value !== null && value >= 0) points.push([ts, Math.round(value)])
    }
  }
  points.sort((a, b) => a[0] - b[0])
  return points
}

function hrvReadings(payload) {
  const rows = Array.isArray(payload && payload.hrvReadings) ? payload.hrvReadings : []
  const points = []
  for (const row of rows) {
    const ts = num(row.startTimestampGMT) || num(row.readingTimeLocal ? Date.parse(row.readingTimeLocal) : null)
    const value = num(row.hrvValue)
    if (ts && value !== null) points.push([ts, Math.round(value)])
  }
  points.sort((a, b) => a[0] - b[0])
  return points
}

function hrvPayload(payload) {
  const summary = (payload && payload.hrvSummary) || {}
  return {
    lastNightAvg: num(summary.lastNightAvg),
    weeklyAvg: num(summary.weeklyAvg),
    status: summary.status || null,
    feedback: summary.feedbackPhrase || null,
  }
}

function sleepDay(payload) {
  const dto = (payload && payload.dailySleepDTO) || null
  if (!dto) return null
  const scale = 1 / 60
  return {
    date: dto.calendarDate || null,
    deep: round((num(dto.deepSleepSeconds) || 0) * scale, 0),
    light: round((num(dto.lightSleepSeconds) || 0) * scale, 0),
    rem: round((num(dto.remSleepSeconds) || 0) * scale, 0),
    awake: round((num(dto.awakeSleepSeconds) || 0) * scale, 0),
    total: round((num(dto.sleepTimeSeconds) || 0) * scale, 0),
    score: num(dto.sleepScores && dto.sleepScores.overall && dto.sleepScores.overall.value),
    qualifier:
      (dto.sleepScores && dto.sleepScores.overall && dto.sleepScores.overall.qualifierKey) || null,
  }
}

function pickTrainingStatus(payload) {
  const latest =
    payload &&
    payload.mostRecentTrainingStatus &&
    payload.mostRecentTrainingStatus.latestTrainingStatusData
  if (!latest || typeof latest !== 'object') return null
  const rows = Object.values(latest)
  const device = rows.find((row) => row && row.primaryTrainingDevice) || rows[0]
  if (!device) return null
  const acute = device.acuteTrainingLoadDTO || {}
  // The aggregated endpoint reports a numeric enum plus a stable phrase such as
  // "DETRAINING" or "MAINTAINING_1"; the phrase is the human-readable one.
  const phrase = typeof device.trainingStatusFeedbackPhrase === 'string'
    ? device.trainingStatusFeedbackPhrase.replace(/_\d+$/, '')
    : ''

  // Load focus: the trailing four weeks per intensity band, with Garmin's own
  // target range so the card can draw where the athlete actually sits.
  const balanceMap =
    payload &&
    payload.mostRecentTrainingLoadBalance &&
    payload.mostRecentTrainingLoadBalance.metricsTrainingLoadBalanceDTOMap
  const balanceRows = balanceMap && typeof balanceMap === 'object' ? Object.values(balanceMap) : []
  const balanceRow =
    balanceRows.find((row) => row && row.primaryTrainingDevice) || balanceRows[0] || null

  return {
    status: phrase || (device.trainingStatus === null || device.trainingStatus === undefined ? null : String(device.trainingStatus)),
    feedback: device.trainingStatusFeedbackPhrase || null,
    acuteLoad: num(acute.dailyTrainingLoadAcute) ?? num(acute.acuteTrainingLoad),
    chronicLoad: num(acute.dailyTrainingLoadChronic) ?? num(acute.chronicTrainingLoad),
    ratio: num(acute.dailyAcuteChronicWorkloadRatio),
    acwrStatus: acute.acwrStatus || null,
    vo2Max: num(payload.mostRecentVO2Max && payload.mostRecentVO2Max.generic && payload.mostRecentVO2Max.generic.vo2MaxValue),
    balance: balanceRow
      ? {
          feedback: balanceRow.trainingBalanceFeedbackPhrase || null,
          aerobicLow: num(balanceRow.monthlyLoadAerobicLow),
          aerobicHigh: num(balanceRow.monthlyLoadAerobicHigh),
          anaerobic: num(balanceRow.monthlyLoadAnaerobic),
          aerobicLowTarget: [num(balanceRow.monthlyLoadAerobicLowTargetMin), num(balanceRow.monthlyLoadAerobicLowTargetMax)],
          aerobicHighTarget: [num(balanceRow.monthlyLoadAerobicHighTargetMin), num(balanceRow.monthlyLoadAerobicHighTargetMax)],
          anaerobicTarget: [num(balanceRow.monthlyLoadAnaerobicTargetMin), num(balanceRow.monthlyLoadAnaerobicTargetMax)],
        }
      : null,
  }
}

function weeklyLoadRows(payload) {
  const report = payload && payload.reportData
  let rows = []
  if (Array.isArray(payload)) rows = payload
  else if (Array.isArray(payload && payload.weeklyTrainingStatus)) rows = payload.weeklyTrainingStatus
  else if (Array.isArray(report && report.weeklyTrainingStatus)) rows = report.weeklyTrainingStatus
  else if (Array.isArray(report && report.dates)) {
    rows = report.dates.map((date, index) => ({
      calendarDate: date,
      acuteTrainingLoad: Array.isArray(report.acuteTrainingLoad) ? report.acuteTrainingLoad[index] : undefined,
      chronicTrainingLoad: Array.isArray(report.chronicTrainingLoad) ? report.chronicTrainingLoad[index] : undefined,
    }))
  } else if (report && typeof report === 'object') {
    // Weekly series are keyed by device id: reportData[deviceId] = [ day, ... ].
    const perDevice = Object.values(report).find((value) => Array.isArray(value))
    if (perDevice) rows = perDevice
  }
  return rows
    .map((row) => {
      const acute = row.acuteTrainingLoadDTO || {}
      return {
        date: row.calendarDate || row.startDate || null,
        acute:
          num(row.acuteTrainingLoad) ??
          num(row.acuteLoad) ??
          num(acute.dailyTrainingLoadAcute) ??
          num(acute.acuteTrainingLoad),
        chronic:
          num(row.chronicTrainingLoad) ??
          num(row.chronicLoad) ??
          num(acute.dailyTrainingLoadChronic) ??
          num(acute.chronicTrainingLoad),
        status: row.trainingStatus || null,
      }
    })
    .filter((row) => row.date)
}

function activityRow(row) {
  const speed = num(row.averageSpeed)
  const distance = num(row.distance)
  return {
    id: row.activityId,
    name: row.activityName || 'Untitled',
    type: (row.activityType && row.activityType.typeKey) || 'activity',
    date: row.startTimeLocal || null,
    distanceM: distance,
    durationS: num(row.duration),
    paceSecPerKm: speed && speed > 0.3 ? Math.round(1000 / speed) : null,
    avgHr: num(row.averageHR) || num(row.averageHeartRate),
  }
}

/* ---------------------------------------------------------------- fetchers */

function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  })
  return Promise.all(workers).then(() => results)
}

function createCache(cacheDir) {
  async function read(key) {
    const file = path.join(cacheDir, `${key}.json`)
    const value = await readJsonFile(file, null)
    return value && typeof value === 'object' && 'data' in value ? value : null
  }

  async function write(key, data) {
    try {
      await writeJsonFile(path.join(cacheDir, `${key}.json`), { at: Date.now(), data })
    } catch {
      /* cache is best effort */
    }
  }

  async function use(key, ttlMs, loader, force) {
    const hit = await read(key)
    if (!force && hit && Date.now() - Number(hit.at || 0) < ttlMs) {
      return { value: hit.data, stale: false }
    }
    try {
      const value = await loader()
      await write(key, value)
      return { value, stale: false }
    } catch (error) {
      if (error instanceof AuthError) throw error
      if (hit) return { value: hit.data, stale: true, error }
      throw error
    }
  }

  return { read, write, use }
}

/* --------------------------------------------------------------- snapshot */

function createService(config, ctx) {
  const warnings = []
  let settings = { ...DEFAULT_SETTINGS, ...(config || {}) }
  let settingsFile = ''
  let cache = null
  const garmin = createGarmin(() => settings)
  let inflight = null

  function recomputePaths() {
    settingsFile = path.join(resolveCacheDir(settings.cacheDir), 'settings.json')
    cache = createCache(resolveCacheDir(settings.cacheDir))
  }

  // Resolve the store before the first read: `loadSettings` otherwise looks at
  // an empty path, silently falls back to defaults, and ignores a saved
  // `tokenPath`/interval until the second call.
  recomputePaths()

  async function loadSettings() {
    const stored = await readJsonFile(settingsFile, null)
    if (stored && typeof stored === 'object') {
      settings = {
        ...settings,
        ...stored,
        cards: { ...settings.cards, ...(stored.cards || {}) },
      }
    }
    settings.pollMinutes = Math.min(240, Math.max(1, Number(settings.pollMinutes) || 5))
    settings.defaultDays = [1, 7, 30].includes(Number(settings.defaultDays))
      ? Number(settings.defaultDays)
      : 7
    settings.chinaRegion = Boolean(settings.chinaRegion)
    recomputePaths()
    return settings
  }

  async function saveSettings(patch) {
    const next = { ...settings }
    if (patch && typeof patch === 'object') {
      if (patch.pollMinutes !== undefined) {
        next.pollMinutes = Math.min(240, Math.max(1, Number(patch.pollMinutes) || 5))
      }
      if (patch.chinaRegion !== undefined) next.chinaRegion = Boolean(patch.chinaRegion)
      if (patch.defaultDays !== undefined && [1, 7, 30].includes(Number(patch.defaultDays))) {
        next.defaultDays = Number(patch.defaultDays)
      }
      if (typeof patch.accent === 'string' && patch.accent.length < 32) next.accent = patch.accent
      if (typeof patch.tokenPath === 'string') {
        const trimmed = patch.tokenPath.trim().slice(0, 500)
        next.tokenPath = trimmed
        garmin.state.fileMtime = 0
        garmin.state.token = ''
      }
      if (patch.cards && typeof patch.cards === 'object') {
        next.cards = { ...next.cards }
        for (const [key, value] of Object.entries(patch.cards)) {
          if (key in next.cards) next.cards[key] = Boolean(value)
        }
      }
    }
    settings = next
    recomputePaths()
    await writeJsonFile(settingsFile, settings)
    garmin.state.fileMtime = 0
    return settings
  }

  async function displayName(force) {
    const key = `profile-${garmin.domain}`
    const { value } = await cache.use(
      key,
      12 * 60 * 60 * 1000,
      async () => {
        const profile = await garmin.request('/userprofile-service/socialProfile')
        return {
          displayName: (profile && (profile.displayName || profile.fullName)) || 'garmin-user',
          fullName: profile && profile.fullName,
        }
      },
      force,
    )
    return value
  }

  async function collect(days, force) {
    warnings.length = 0
    const range = lastDays(days)
    const start = range[0]
    const end = range[range.length - 1]
    const todayIso = today()

    await garmin.loadTokens(false).catch(() => {})
    const tokenState = await garmin.status()

    if (tokenState.state !== 'ok') {
      return {
        ok: false,
        auth: { state: tokenState.state, message: tokenState.message },
        settings: publicSettings(),
        generatedAt: new Date().toISOString(),
        range: { days, start, end },
      }
    }

    const profile = await displayName(force).catch((error) => {
      if (error instanceof AuthError) throw error
      warnings.push(`个人资料：${error.message}`)
      return { displayName: 'garmin-user' }
    })
    const dn = profile.displayName

    const safe = async (label, loader, fallback) => {
      try {
        return await loader()
      } catch (error) {
        if (error instanceof AuthError) throw error
        warnings.push(`${label}：${error.message}`)
        return fallback
      }
    }

    const dayKey = (kind, date) => `${kind}-${garmin.domain}-${date}`
    const minutes = Math.max(2, Number(settings.pollMinutes) || 5)
    const todayTtl = minutes * 60 * 1000
    const historyTtl = 6 * 60 * 60 * 1000

    const [heartRateToday, stressToday, batteryToday, hrvToday, trainingStatus, activities] =
      await Promise.all([
        safe(
          '今日心率',
          () =>
            cache
              .use(
                dayKey('hr', todayIso),
                todayTtl,
                () => garmin.request(`/wellness-service/wellness/dailyHeartRate/${encodeURIComponent(dn)}`, { date: todayIso }),
                force,
              )
              .then((hit) => hit.value),
          null,
        ),
        safe(
          '今日压力',
          () =>
            cache
              .use(
                dayKey('stress', todayIso),
                todayTtl,
                () => garmin.request(`/wellness-service/wellness/dailyStress/${todayIso}`),
                force,
              )
              .then((hit) => hit.value),
          null,
        ),
        safe(
          'Body Battery',
          () =>
            cache
              .use(
                dayKey('battery', todayIso),
                todayTtl,
                () =>
                  garmin.request('/wellness-service/wellness/bodyBattery/reports/daily', {
                    startDate: todayIso,
                    endDate: todayIso,
                  }),
                force,
              )
              .then((hit) => hit.value),
          null,
        ),
        safe(
          'HRV',
          () =>
            cache
              .use(
                dayKey('hrv', todayIso),
                todayTtl,
                () => garmin.request(`/hrv-service/hrv/${todayIso}`),
                force,
              )
              .then((hit) => hit.value),
          null,
        ),
        safe(
          '训练状态',
          () =>
            cache
              .use(
                dayKey('training', todayIso),
                todayTtl,
                async () => {
                  try {
                    return await garmin.request(`/metrics-service/metrics/trainingstatus/aggregated/${todayIso}`)
                  } catch (error) {
                    if (error instanceof AuthError) throw error
                    return garmin.request(`/metrics-service/metrics/trainingstatus/daily/${todayIso}`)
                  }
                },
                force,
              )
              .then((hit) => hit.value),
          null,
        ),
        safe(
          '最近运动',
          () =>
            cache
              .use(
                `activities-${garmin.domain}`,
                todayTtl,
                async () => {
                  const rows = await garmin.request('/activitylist-service/activities/search/activities', {
                    start: 0,
                    limit: 8,
                  })
                  return Array.isArray(rows) ? rows.map(activityRow) : []
                },
                force,
              )
              .then((hit) => hit.value),
          [],
        ),
      ])

    const hrvRange = await safe(
      'HRV 趋势',
      () =>
        cache
          .use(
            `hrv-range-${garmin.domain}-${start}-${end}`,
            historyTtl,
            async () => {
              const payload = await garmin.request(`/hrv-service/hrv/daily/${start}/${end}`)
              const rows = Array.isArray(payload && payload.hrvSummaries) ? payload.hrvSummaries : []
              return rows
                .map((row) => ({
                  date: row.date || row.calendarDate || null,
                  value: num(row.lastNightAvg),
                  status: row.status || null,
                }))
                .filter((row) => row.date)
            },
            force,
          )
          .then((hit) => hit.value),
      [],
    )

    const stepsRange = await safe(
      '步数',
      () =>
        cache
          .use(
            `steps-${garmin.domain}-${start}-${end}`,
            days === 1 ? todayTtl : historyTtl,
            async () => {
              const rows = await garmin.request(`/usersummary-service/stats/steps/daily/${start}/${end}`)
              return (Array.isArray(rows) ? rows : []).map((row) => ({
                date: row.calendarDate || null,
                steps: num(row.totalSteps),
                goal: num(row.stepGoal),
                distanceM: num(row.totalDistance),
              }))
            },
            force,
          )
          .then((hit) => hit.value),
      [],
    )

    const summaries = await safe(
      '每日摘要',
      () =>
        cache
          .use(
            `summaries-${garmin.domain}-${start}-${end}`,
            days === 1 ? todayTtl : historyTtl,
            async () => {
              const rows = await garmin.request('/usersummary-service/v2/dailysummaries', {
                startDate: start,
                endDate: end,
              })
              const list = Array.isArray(rows) ? rows : Array.isArray(rows && rows.data) ? rows.data : []
              return list.map((row) => ({
                date: row.calendarDate || null,
                restingHr: num(row.restingHeartRate),
                steps: num(row.totalSteps),
                goal: num(row.stepGoal),
                bbHigh: num(row.bodyBatteryHighestValue),
                bbLow: num(row.bodyBatteryLowestValue),
              }))
            },
            force,
          )
          .then((hit) => hit.value),
      [],
    )

    const sleepDays = await mapLimit(range, 2, (date) =>
      safe(
        `睡眠 ${date}`,
        () =>
          cache
            .use(
              dayKey('sleep', date),
              date === todayIso ? todayTtl : historyTtl,
              async () => {
                const payload = await garmin.request('/wellness-service/wellness/dailySleepData', {
                  date,
                  nonSleepBufferMinutes: 60,
                })
                return sleepDay(payload)
              },
              force,
            )
            .then((hit) => hit.value),
        null,
      ),
    )

    const weeklyLoad = await safe(
      '训练负荷',
      () =>
        cache
          .use(
            `load-${garmin.domain}-${start}-${end}`,
            historyTtl,
            async () => {
              const payload = await garmin.request(
                `/metrics-service/metrics/trainingstatus/weekly/${encodeURIComponent(dn)}`,
                { fromCalendarDate: start, toCalendarDate: end },
              )
              const rows = weeklyLoadRows(payload)
              if (rows.length > 0) return rows
              const latest = await garmin
                .request('/metrics-service/metrics/trainingloadbalance/latest')
                .catch(() => null)
              const acute = (latest && latest.acuteTrainingLoadDTO) || {}
              return [
                {
                  date: todayIso,
                  acute: num(acute.acuteTrainingLoad),
                  chronic: num(acute.chronicTrainingLoad),
                  status: null,
                },
              ]
            },
            force,
          )
          .then((hit) => hit.value),
      [],
    )

    const sleep = sleepDays.filter(Boolean)
    const steps = stepsRange.length > 0 ? stepsRange : summaries.map((row) => ({ date: row.date, steps: row.steps, goal: row.goal, distanceM: null }))
    const resting = summaries.filter((row) => row.restingHr !== null)

    const todaySummary = summaries.find((row) => row.date === todayIso) || null
    const todaySleep = sleep.find((row) => row.date === todayIso) || sleep[sleep.length - 1] || null
    const training = pickTrainingStatus(trainingStatus)
    const batteryPointsToday = bodyBatteryPoints(batteryToday)

    const hasData =
      (heartRateToday ? hrPoints(heartRateToday).length > 1 : false) ||
      sleep.some((row) => (row.total || 0) > 0) ||
      steps.some((row) => (row.steps || 0) > 0) ||
      batteryPointsToday.length > 0 ||
      activities.length > 0 ||
      hrvRange.length > 0

    const badges = {
      steps: {
        value: (todaySummary && todaySummary.steps) ?? (steps.find((row) => row.date === todayIso)?.steps ?? null),
        goal: (todaySummary && todaySummary.goal) ?? (steps.find((row) => row.date === todayIso)?.goal ?? null),
      },
      restingHr:
        (heartRateToday && num(heartRateToday.restingHeartRate)) ??
        (todaySummary && todaySummary.restingHr) ??
        (resting.length > 0 ? resting[resting.length - 1].restingHr : null),
      sleepScore: todaySleep ? todaySleep.score : null,
      bodyBattery:
        batteryPointsToday.length > 0
          ? batteryPointsToday[batteryPointsToday.length - 1][1]
          : ((todaySummary && todaySummary.bbHigh) ?? null),
      hrv: hrvToday ? hrvPayload(hrvToday).lastNightAvg : null,
      trainingStatus: training ? training.status : null,
      vo2Max: training ? training.vo2Max : null,
    }

    return {
      ok: true,
      auth: { state: 'ok', message: '' },
      tokenFallback: Boolean(garmin.state.fallback),
      region: garmin.domain,
      generatedAt: new Date().toISOString(),
      range: { days, start, end },
      profile: { displayName: dn, fullName: profile.fullName || null },
      settings: publicSettings(),
      hasData,
      badges,
      heartRate: {
        resting: badges.restingHr,
        points: heartRateToday ? hrPoints(heartRateToday) : [],
        byDay: resting.map((row) => ({ date: row.date, value: row.restingHr })),
        max: heartRateToday ? num(heartRateToday.maxHeartRate) : null,
        min: heartRateToday ? num(heartRateToday.minHeartRate) : null,
      },
      hrv: {
        today: hrvToday ? hrvPayload(hrvToday) : null,
        readings: hrvToday ? hrvReadings(hrvToday) : [],
        days: hrvRange,
      },
      stress: {
        today: stressToday ? num(stressToday.avgStressLevel) : null,
        points: stressToday ? stressPoints(stressToday) : [],
      },
      bodyBattery: {
        points: batteryPointsToday,
        days: summaries
          .filter((row) => row.bbHigh !== null || row.bbLow !== null)
          .map((row) => ({ date: row.date, high: row.bbHigh, low: row.bbLow })),
      },
      sleep,
      steps,
      training: {
        status: training ? training.status : null,
        feedback: training ? training.feedback : null,
        acuteLoad: training ? training.acuteLoad : null,
        chronicLoad: training ? training.chronicLoad : null,
        ratio: training ? training.ratio : null,
        acwrStatus: training ? training.acwrStatus : null,
        balance: training ? training.balance : null,
        load: weeklyLoad,
      },
      activities,
      warnings,
      stale: false,
    }
  }

  function publicSettings() {
    return {
      pollMinutes: settings.pollMinutes,
      chinaRegion: settings.chinaRegion,
      defaultDays: settings.defaultDays,
      accent: settings.accent,
      tokenPath: settings.tokenPath || '',
      tokenFile: garmin.state.file || resolveTokenFile(settings.tokenPath),
      cards: { ...settings.cards },
    }
  }

  async function snapshot(days, options = {}) {
    if (inflight) return inflight
    const requested = [1, 7, 30].includes(Number(days)) ? Number(days) : settings.defaultDays
    inflight = (async () => {
      try {
        return await collect(requested, Boolean(options.force))
      } catch (error) {
        if (error instanceof AuthError) {
          return {
            ok: false,
            auth: { state: error.code, message: error.message },
            tokenFallback: Boolean(garmin.state.fallback),
            settings: publicSettings(),
            generatedAt: new Date().toISOString(),
            range: { days: requested, start: addDays(today(), -(requested - 1)), end: today() },
          }
        }
        throw error
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    get settings() {
      return settings
    },
    loadSettings,
    saveSettings,
    snapshot,
    publicSettings,
    garmin,
    get cacheDir() {
      return resolveCacheDir(settings.cacheDir)
    },
  }
}

/* ------------------------------------------------------------------ routes */

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function readDays(url) {
  const raw = Number(url.searchParams.get('days'))
  return [1, 7, 30].includes(raw) ? raw : null
}

/* ------------------------------------------------------------------ plugin */

export const name = 'dsh-garmin-health'

/**
 * The plugin only makes sense where the Host connection service exists: its
 * HTTP routes hang off it. Declaring it as an injection makes Cordis wait for
 * the service instead of silently skipping route registration when the plugin
 * happens to mount first.
 */
export const inject = ['connection']

/**
 * Build the data service without a Cordis context.
 * Exported so the plugin can be smoke-tested from Node against a real token.
 */
export function createGarminService(config = {}) {
  return createService(config, null)
}

export function apply(ctx, config = {}) {
  const service = createService(config, ctx)
  const disposers = []

  ctx.effect(() => {
    void service.loadSettings().catch(() => {
      /* keep built-in defaults when the settings file is unreadable */
    })

    const logFile = path.join(service.cacheDir, 'route.log')
    const trace = (line) => {
      void fsp
        .stat(logFile)
        .then((info) => (info.size < 256 * 1024 ? true : fsp.rm(logFile, { force: true })))
        .catch(() => true)
        .then(() => fsp.appendFile(logFile, `${new Date().toISOString()} ${line}\n`))
        .catch(() => {})
    }

    const connection = ctx.get('connection')
    if (!connection || !connection.fetch) {
      trace('apply: connection.fetch unavailable; routes NOT mounted')
      ctx.logger?.warn?.('dsh-garmin-health: ctx.connection.fetch is unavailable; HTTP routes are not mounted.')
      return
    }

    const routes = [
      {
        suffix: '/data',
        methods: ['GET'],
        fetch: async (request) => {
          const url = new URL(request.url)
          const force = url.searchParams.get('force') === '1'
          await service.loadSettings()
          const days = readDays(url) || service.settings.defaultDays
          const body = await service.snapshot(days, { force })
          return jsonResponse(body)
        },
      },
      {
        suffix: '/settings',
        methods: ['GET', 'POST'],
        fetch: async (request) => {
          await service.loadSettings()
          if (request.method === 'POST') {
            let patch = {}
            try {
              patch = (await request.json()) || {}
            } catch {
              return jsonResponse({ ok: false, error: 'invalid JSON body' }, 400)
            }
            const saved = await service.saveSettings(patch)
            return jsonResponse({ ok: true, settings: saved })
          }
          return jsonResponse({ ok: true, settings: service.publicSettings(), cacheDir: service.cacheDir })
        },
      },
    ]

    trace(`apply: connection.fetch present, registering ${routes.length} routes`)
    for (const route of routes) {
      const dispose = connection.fetch.register({
        path: `/api/dsh-garmin${route.suffix}`,
        methods: route.methods,
        requestBody: 'buffered',
        fetch: async (request) => {
          const started = Date.now()
          try {
            const response = await route.fetch(request)
            trace(`req ${request.method} ${route.suffix} -> ${response.status} (${Date.now() - started}ms)`)
            return response
          } catch (error) {
            trace(`req ${request.method} ${route.suffix} -> 500 ${error && error.message ? error.message : error}`)
            ctx.logger?.warn?.(`dsh-garmin-health: ${error && error.message ? error.message : error}`)
            return jsonResponse(
              {
                ok: false,
                auth: { state: 'error', message: error && error.message ? error.message : String(error) },
                settings: service.publicSettings(),
              },
              500,
            )
          }
        },
      })
      disposers.push(dispose)
    }
    trace('apply: routes registered')
  }, 'garmin-health: http routes')

  ctx.effect(() => {
    let stopped = false
    let timer = null

    const warm = async () => {
      if (stopped) return
      await service.loadSettings().catch(() => {})
      try {
        await service.snapshot(service.settings.defaultDays, { force: false })
      } catch {
        /* the route reports the real error on demand */
      }
      if (stopped) return
      const minutes = Math.max(1, Number(service.settings.pollMinutes) || 5)
      timer = setTimeout(warm, minutes * 60 * 1000)
      if (timer && typeof timer.unref === 'function') timer.unref()
    }

    const first = setTimeout(warm, 4000)
    if (first && typeof first.unref === 'function') first.unref()

    return () => {
      stopped = true
      if (first) clearTimeout(first)
      if (timer) clearTimeout(timer)
      for (const dispose of disposers) {
        try {
          void dispose()
        } catch {
          /* already released */
        }
      }
    }
  }, 'garmin-health: poll')
}
