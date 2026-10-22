/**
 * Client half of the Garmin health dashboard.
 *
 * Provides:
 *  - a right-sidebar tab type (`garmin-health`) with body, title and guide entry
 *  - a header action that opens the panel
 *  - a Settings page section
 *
 * Charts are hand-drawn SVG so the plugin ships without ECharts or a CDN:
 * the desktop app must render offline, and the host theme tokens drive colour.
 */

window.__ModuleLoader__.load({
  id: 'dsh-garmin-health',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const PANEL_ID = 'garmin-health'
    const NS = 'garminHealth'
    const RANGES = [
      { days: 1, zh: '今天', en: 'Today' },
      { days: 7, zh: '近 7 天', en: '7 days' },
      { days: 30, zh: '近 30 天', en: '30 days' },
    ]
    const CARD_KEYS = [
      { key: 'heartRate', zh: '24 小时心率', en: '24h heart rate' },
      { key: 'hrv', zh: 'HRV', en: 'HRV' },
      { key: 'bodyBattery', zh: 'Body Battery / 压力', en: 'Body Battery / stress' },
      { key: 'sleep', zh: '睡眠结构', en: 'Sleep stages' },
      { key: 'steps', zh: '步数', en: 'Steps' },
      { key: 'training', zh: '训练负荷', en: 'Training load' },
      { key: 'activities', zh: '最近运动', en: 'Recent activities' },
    ]
    const ACCENTS = [
      { value: 'auto', zh: '跟随主题', en: 'Theme' },
      { value: '#e08a3c', zh: '琥珀', en: 'Amber' },
      { value: '#4f9cf0', zh: '湖蓝', en: 'Blue' },
      { value: '#3fbf7f', zh: '青绿', en: 'Green' },
      { value: '#a06cf0', zh: '紫罗兰', en: 'Violet' },
    ]
    const STAGE_COLORS = {
      deep: '#4a5fd0',
      light: '#8b9af0',
      rem: '#2fb6a8',
      awake: '#c9a227',
    }
    const TYPE_COLORS = {
      cycling: '#4f9cf0',
      running: '#e0713f',
      hiking: '#3fbf7f',
      walking: '#3fbf7f',
      strength_training: '#c9a227',
      swimming: '#2fb6a8',
    }

    const zhDict = {
      panelTitle: 'Garmin 健康',
      refresh: '刷新',
      refreshing: '刷新中…',
      loading: '正在读取 Garmin 数据…',
      updated: '更新于',
      autoRefresh: '自动刷新 每 {n} 分钟',
      updating: '更新中…',
      empty: '暂无数据',
      noHrvData: '这台设备不上报 HRV',
      noSleepData: '这段时间没有睡眠记录',
      noStepData: '这段时间没有步数记录',
      steps: '今日步数',
      restingHr: '静息心率',
      sleepScore: '睡眠评分',
      bodyBattery: 'Body Battery',
      trainingStatus: '训练状态',
      hrvAvg: 'HRV 均值',
      bpm: 'bpm',
      min: '分',
      hours: '小时',
      signInTitle: '需要重新登录 Garmin',
      signInHint: 'token 已过期或缺失，请在终端运行 garmin-mcp-auth --force-reauth 后点击刷新。',
      routeMissing: '服务端路由未就绪',
      routeMissingHint: '插件已加载，但 /api/dsh-garmin 路由不可用。请重启 DSH 后重试。',
      retry: '重试',
      source: '数据源 Garmin Connect',
      sleepDeep: '深睡',
      sleepLight: '浅睡',
      sleepRem: 'REM',
      sleepAwake: '清醒',
      acuteLoad: '短期负荷',
      chronicLoad: '长期负荷',
      stress: '压力',
      pace: '配速',
      distance: '距离',
      duration: '时长',
      noActivities: '还没有运动记录',
      settingsTitle: 'Garmin 健康',
      settingsDesc: '连接本机 garmin_mcp 保存的 token，读取 Garmin Connect 数据。',
      pollMinutes: '轮询间隔（分钟）',
      pollHint: '服务端按此间隔刷新缓存，1–240 分钟。',
      tokenFileLabel: 'Token 文件',
      tokenFileHint:
        '留空则用 ~/.garminconnect/garmin_tokens.json；也可指向 dsh-plugin-garmin-connect 的 *.session.json。保存后最多 5 分钟自动生效，点面板「刷新」立即生效。',
      chinaRegion: 'Garmin 中国区账号',
      chinaHint: '使用 garmin.cn 域名请求数据。',
      defaultRange: '默认时间范围',
      cards: '显示图表卡片',
      accent: '主题色',
      save: '保存',
      saved: '已保存',
      saveFailed: '保存失败',
      tokenNote: 'token 只在服务端读取，不会发送到浏览器。',
      emptyAccountTitle: '已连接，但账号里还没有数据',
      emptyAccountHint: 'Garmin 返回的是空数据（没有已同步的设备）。在手机 Garmin Connect 同步一次后点「刷新」。',
      fallbackTitle: '正在用备用 token',
      fallbackHint:
        '设置里的 token 路径里没有文件，已回退到 ~/.garminconnect 里的账号。要恢复原来的账号，重新登录那个插件，或在这里改「Token 文件」。',
    }

    const enDict = {
      panelTitle: 'Garmin Health',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      loading: 'Loading Garmin data…',
      updated: 'Updated',
      autoRefresh: 'auto-refresh every {n} min',
      updating: 'updating…',
      empty: 'No data',
      noHrvData: 'This device does not report HRV',
      noSleepData: 'No sleep recorded in this range',
      noStepData: 'No steps recorded in this range',
      steps: 'Steps today',
      restingHr: 'Resting HR',
      sleepScore: 'Sleep score',
      bodyBattery: 'Body Battery',
      trainingStatus: 'Training status',
      hrvAvg: 'HRV average',
      bpm: 'bpm',
      min: 'min',
      hours: 'h',
      signInTitle: 'Garmin sign-in needed',
      signInHint: 'The token expired or is missing. Run garmin-mcp-auth --force-reauth, then press Refresh.',
      routeMissing: 'Server route not ready',
      routeMissingHint: 'The plugin loaded but /api/dsh-garmin is unavailable. Restart DSH and retry.',
      retry: 'Retry',
      source: 'Source: Garmin Connect',
      sleepDeep: 'Deep',
      sleepLight: 'Light',
      sleepRem: 'REM',
      sleepAwake: 'Awake',
      acuteLoad: 'Acute load',
      chronicLoad: 'Chronic load',
      stress: 'Stress',
      pace: 'Pace',
      distance: 'Distance',
      duration: 'Duration',
      noActivities: 'No activities yet',
      settingsTitle: 'Garmin Health',
      settingsDesc: 'Reads the token store written by garmin_mcp and talks to Garmin Connect directly.',
      pollMinutes: 'Poll interval (minutes)',
      pollHint: 'The server refreshes its cache at this interval, 1–240 minutes.',
      tokenFileLabel: 'Token file',
      tokenFileHint:
        'Empty uses ~/.garminconnect/garmin_tokens.json; a dsh-plugin-garmin-connect *.session.json works too. Press Refresh after saving.',
      chinaRegion: 'Garmin China account',
      chinaHint: 'Requests garmin.cn instead of garmin.com.',
      defaultRange: 'Default range',
      cards: 'Visible chart cards',
      accent: 'Accent colour',
      save: 'Save',
      saved: 'Saved',
      saveFailed: 'Save failed',
      tokenNote: 'The token is read on the server only and never sent to the browser.',
      emptyAccountTitle: 'Connected, but the account has no data yet',
      emptyAccountHint: 'Garmin returned empty payloads (no synced device). Sync the watch in Garmin Connect, then press Refresh.',
      fallbackTitle: 'Using a fallback token',
      fallbackHint:
        'The configured token path holds no file, so the panel fell back to ~/.garminconnect. Sign in through that plugin again, or set Token file here.',
    }

    const isZh = (() => {
      try {
        return String(navigator.language || '').toLowerCase().startsWith('zh')
      } catch {
        return true
      }
    })()
    const L = isZh ? zhDict : enDict
    const rangeLabel = (days) => {
      const found = RANGES.find((row) => row.days === days) || RANGES[1]
      return isZh ? found.zh : found.en
    }

    /* ------------------------------------------------------------- helpers */

    let apiBase = '/api/dsh-garmin'

    async function apiFetch(path, init) {
      let response = await fetch(`${apiBase}${path}`, {
        credentials: 'same-origin',
        ...(init || {}),
      })
      if (response.status === 404 && apiBase === '/api/dsh-garmin') {
        apiBase = '/dsh-garmin'
        response = await fetch(`${apiBase}${path}`, { credentials: 'same-origin', ...(init || {}) })
      }
      return response
    }

    function pad2(n) {
      return n < 10 ? `0${n}` : String(n)
    }

    function clockLabel(ts) {
      const date = new Date(ts)
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function dayLabel(iso) {
      if (!iso) return ''
      const [, m, d] = String(iso).split('-')
      return `${Number(m)}/${Number(d)}`
    }

    function minuteLabel(total) {
      if (!Number.isFinite(total)) return '—'
      const hours = Math.floor(total / 60)
      const minutes = Math.round(total % 60)
      return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
    }

    function durationLabel(seconds) {
      if (!Number.isFinite(seconds)) return '—'
      const total = Math.round(seconds)
      const hours = Math.floor(total / 3600)
      const minutes = Math.floor((total % 3600) / 60)
      const secs = total % 60
      return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`
    }

    function paceLabel(secPerKm) {
      if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '—'
      const minutes = Math.floor(secPerKm / 60)
      const seconds = Math.round(secPerKm % 60)
      return `${minutes}'${pad2(seconds)}"`
    }

    function distanceLabel(meters) {
      if (!Number.isFinite(meters)) return '—'
      return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`
    }

    function numberLabel(value) {
      if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—'
      return Math.round(Number(value)).toLocaleString(isZh ? 'zh-CN' : 'en-US')
    }

    function accentOf(settings) {
      const value = settings && settings.accent
      return !value || value === 'auto' ? 'var(--dsw-alias-brand-primary)' : value
    }

    function safeArray(value) {
      return Array.isArray(value) ? value : []
    }

    function seriesExtent(values) {
      let min = Infinity
      let max = -Infinity
      for (const value of values) {
        if (!Number.isFinite(value)) continue
        if (value < min) min = value
        if (value > max) max = value
      }
      if (min === Infinity) return [0, 1]
      if (min === max) return [min - 1, max + 1]
      return [min, max]
    }

    /* -------------------------------------------------------------- charts */

    const SVG_W = 320
    const SVG_H = 104
    const PAD_L = 6
    const PAD_R = 6
    const PAD_T = 8
    const PAD_B = 16

    function Frame(props) {
      return h(
        'svg',
        {
          viewBox: `0 0 ${SVG_W} ${SVG_H}`,
          width: '100%',
          role: 'img',
          'aria-label': props.label || '',
          style: { display: 'block', height: 'auto', overflow: 'visible' },
        },
        props.children,
      )
    }

    function GridLines(props) {
      const rows = [0, 0.5, 1]
      return h(
        'g',
        null,
        rows.map((row) => {
          const y = PAD_T + (SVG_H - PAD_T - PAD_B) * row
          return h('line', {
            key: `grid-${row}`,
            x1: PAD_L,
            x2: SVG_W - PAD_R,
            y1: y,
            y2: y,
            stroke: 'var(--dsw-alias-separator-primary)',
            strokeWidth: 1,
            opacity: row === 1 ? 0.9 : 0.45,
          })
        }),
        props.yLabels || null,
      )
    }

    function AxisLabels(props) {
      const rows = props.rows || []
      return h(
        'g',
        null,
        rows.map((row, index) =>
          h(
            'text',
            {
              key: `axis-${index}`,
              x: row.anchor === 'end' ? SVG_W - PAD_R : PAD_L,
              y: SVG_H - 4,
              textAnchor: row.anchor || 'start',
              fontSize: 9,
              fill: 'var(--dsw-alias-label-tertiary)',
            },
            row.text,
          ),
        ),
      )
    }

    function LinePath(props) {
      const points = props.points.filter((point) => Number.isFinite(point[1]))
      if (points.length < 2) return null
      const xs = points.map((point) => point[0])
      const ys = points.map((point) => point[1])
      const [xMin, xMax] = props.xDomain || seriesExtent(xs)
      const [yMin, yMax] = props.yDomain || seriesExtent(ys)
      const innerW = SVG_W - PAD_L - PAD_R
      const innerH = SVG_H - PAD_T - PAD_B
      const xOf = (value) => PAD_L + (xMax === xMin ? 0 : ((value - xMin) / (xMax - xMin)) * innerW)
      const yOf = (value) => PAD_T + innerH - (yMax === yMin ? 0 : ((value - yMin) / (yMax - yMin)) * innerH)
      const line = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${xOf(point[0]).toFixed(1)},${yOf(point[1]).toFixed(1)}`)
        .join(' ')
      const area = `${line} L${xOf(points[points.length - 1][0]).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${xOf(
        points[0][0],
      ).toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`
      return h(
        'g',
        null,
        props.area
          ? h('path', { d: area, fill: props.color, opacity: 0.14, stroke: 'none' })
          : null,
        h('path', {
          d: line,
          fill: 'none',
          stroke: props.color,
          strokeWidth: 1.8,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }),
      )
    }

    function ValueBadge(props) {
      return h(
        'span',
        {
          style: {
            fontVariantNumeric: 'tabular-nums',
            fontSize: 11,
            color: props.color || 'var(--dsw-alias-label-secondary)',
          },
        },
        props.text,
      )
    }

    function ChartCard(props) {
      return h(
        'section',
        { className: `dgh-card${props.wide ? ' dgh-card-wide' : ''}` },
        h(
          'header',
          { className: 'dgh-card-head' },
          h('span', { className: 'dgh-card-title' }, props.title),
          props.right ? h('span', { className: 'dgh-card-right' }, props.right) : null,
        ),
        props.children,
      )
    }

    function Legend(props) {
      return h(
        'div',
        { className: 'dgh-legend' },
        props.items.map((item) =>
          h(
            'span',
            { key: item.label, className: 'dgh-legend-item' },
            h('i', { className: 'dgh-dot', style: { background: item.color } }),
            item.label,
          ),
        ),
      )
    }

    function Empty(props) {
      return h(
        'div',
        { className: `dgh-empty${props.compact ? ' is-compact' : ''}` },
        props.text || L.empty,
      )
    }

    /* --------------------------------------------------------------- panel */

    function Badge(props) {
      return h(
        'div',
        { className: 'dgh-badge' },
        h('span', { className: 'dgh-badge-label' }, props.label),
        h(
          'span',
          { className: 'dgh-badge-value' },
          props.value,
          props.unit ? h('em', { className: 'dgh-badge-unit' }, props.unit) : null,
        ),
        props.sub ? h('span', { className: 'dgh-badge-sub' }, props.sub) : null,
        typeof props.progress === 'number'
          ? h(
              'span',
              { className: 'dgh-badge-bar' },
              h('i', { style: { width: `${Math.max(0, Math.min(1, props.progress)) * 100}%` } }),
            )
          : null,
      )
    }

    function TrainingStatusChip(props) {
      const map = {
        PRODUCTIVE: 'var(--dsw-alias-state-success-primary)',
        PEAKING: 'var(--dsw-alias-state-business-primary)',
        MAINTAINING: 'var(--dsw-alias-state-success-primary)',
        RECOVERY: 'var(--dsw-alias-state-warn-primary)',
        UNPRODUCTIVE: 'var(--dsw-alias-state-warn-primary)',
        OVERREACHING: 'var(--dsw-alias-state-error-primary)',
        DETRAINING: 'var(--dsw-alias-state-error-primary)',
      }
      const color = map[props.status] || 'var(--dsw-alias-label-secondary)'
      return h(
        'span',
        {
          className: 'dgh-chip',
          style: { color, borderColor: 'currentColor' },
          title: props.feedback || '',
        },
        props.status ? String(props.status).replace(/_/g, ' ') : '—',
      )
    }

    function HeartRateCard(props) {
      const data = props.data
      const points = safeArray(data.points)
      return h(
        ChartCard,
        {
          title: isZh ? '24 小时心率' : '24h heart rate',
          right: h(ValueBadge, {
            text: `${L.restingHr} ${numberLabel(data.resting)} ${L.bpm}`,
            color: accentOf(props.settings),
          }),
        },
        points.length > 1
          ? h(
              Frame,
              { label: 'heart rate' },
              h(GridLines),
              h(LinePath, {
                points,
                color: accentOf(props.settings),
                area: true,
              }),
              h(AxisLabels, {
                rows: [
                  { text: clockLabel(points[0][0]) },
                  { text: clockLabel(points[points.length - 1][0]), anchor: 'end' },
                ],
              }),
            )
          : h(Empty, { compact: true }),
        h(Legend, {
          items: [
            { label: `${L.min} ${numberLabel(data.min)}`, color: 'var(--dsw-alias-label-tertiary)' },
            { label: `${L.bpm} max ${numberLabel(data.max)}`, color: 'var(--dsw-alias-label-tertiary)' },
          ],
        }),
      )
    }

    function HrvCard(props) {
      const data = props.data
      const days = safeArray(data.days)
        .filter((row) => Number.isFinite(row.value))
        .map((row) => [Date.parse(`${row.date}T00:00:00`), row.value])
      const today = data.today || {}
      return h(
        ChartCard,
        {
          title: 'HRV',
          right: h(ValueBadge, {
            text: `${numberLabel(today.lastNightAvg)} ms`,
            color: '#5aa9e6',
          }),
        },
        days.length > 1
          ? h(
              Frame,
              { label: 'hrv' },
              h(GridLines),
              h(LinePath, { points: days, color: '#5aa9e6', area: true }),
              h(AxisLabels, {
                rows: [
                  { text: dayLabel(new Date(days[0][0]).toISOString().slice(0, 10)) },
                  {
                    text: dayLabel(new Date(days[days.length - 1][0]).toISOString().slice(0, 10)),
                    anchor: 'end',
                  },
                ],
              }),
            )
          : h(Empty, { compact: true, text: L.noHrvData }),
        h(Legend, {
          items: [
            { label: `7d ${numberLabel(today.weeklyAvg)} ms`, color: '#5aa9e6' },
            { label: today.status || '—', color: 'var(--dsw-alias-label-tertiary)' },
          ],
        }),
      )
    }

    function BodyBatteryCard(props) {
      const battery = safeArray(props.data.bodyBattery && props.data.bodyBattery.points)
      const stress = safeArray(props.data.stress && props.data.stress.points)
      const hasBattery = battery.length > 1
      const hasStress = stress.length > 1
      const xDomain = hasBattery ? seriesExtent(battery.map((point) => point[0])) : undefined
      return h(
        ChartCard,
        {
          title: isZh ? 'Body Battery / 压力' : 'Body Battery / stress',
          right: h(ValueBadge, {
            text: `${numberLabel(props.data.badges && props.data.badges.bodyBattery)}`,
            color: '#3fbf7f',
          }),
        },
        hasBattery || hasStress
          ? h(
              Frame,
              { label: 'body battery' },
              h(GridLines),
              hasStress
                ? h(LinePath, {
                    points: stress,
                    color: '#e0a458',
                    area: true,
                    xDomain,
                    yDomain: [0, 100],
                  })
                : null,
              hasBattery
                ? h(LinePath, {
                    points: battery,
                    color: '#3fbf7f',
                    xDomain,
                    yDomain: [0, 100],
                  })
                : null,
            )
          : h(Empty, { compact: true }),
        h(Legend, {
          items: [
            { label: 'Body Battery', color: '#3fbf7f' },
            { label: L.stress, color: '#e0a458' },
          ],
        }),
      )
    }

    function SleepCard(props) {
      const days = safeArray(props.data.sleep).filter((row) => row && (row.total || row.deep || row.light))
      if (days.length === 0) {
        return h(ChartCard, { title: isZh ? '睡眠结构' : 'Sleep stages' }, h(Empty, { compact: true, text: L.noSleepData }))
      }
      const stages = ['deep', 'light', 'rem', 'awake']
      const totals = days.map((row) => stages.reduce((sum, stage) => sum + (Number(row[stage]) || 0), 0))
      const max = Math.max(60, ...totals)
      const innerW = SVG_W - PAD_L - PAD_R
      const innerH = SVG_H - PAD_T - PAD_B
      const slot = innerW / days.length
      const barW = Math.max(3, Math.min(18, slot * 0.62))
      return h(
        ChartCard,
        {
          title: isZh ? '睡眠结构' : 'Sleep stages',
          right: h(ValueBadge, {
            text: `${numberLabel(props.data.badges && props.data.badges.sleepScore)} / 100`,
            color: STAGE_COLORS.light,
          }),
        },
        h(
          Frame,
          { label: 'sleep stages' },
          h(GridLines),
          days.map((row, index) => {
            let y = PAD_T + innerH
            const x = PAD_L + slot * index + (slot - barW) / 2
            return h(
              'g',
              { key: `sleep-${row.date || index}` },
              stages.map((stage) => {
                const value = Number(row[stage]) || 0
                const height = (value / max) * innerH
                y -= height
                return h('rect', {
                  key: stage,
                  x,
                  y,
                  width: barW,
                  height: Math.max(0, height),
                  fill: STAGE_COLORS[stage],
                  rx: 1.5,
                })
              }),
            )
          }),
          h(AxisLabels, {
            rows: [
              { text: dayLabel(days[0].date) },
              { text: dayLabel(days[days.length - 1].date), anchor: 'end' },
            ],
          }),
        ),
        h(Legend, {
          items: [
            { label: L.sleepDeep, color: STAGE_COLORS.deep },
            { label: L.sleepLight, color: STAGE_COLORS.light },
            { label: L.sleepRem, color: STAGE_COLORS.rem },
            { label: L.sleepAwake, color: STAGE_COLORS.awake },
          ],
        }),
      )
    }

    function StepsCard(props) {
      const rows = safeArray(props.data.steps).filter((row) => row && Number.isFinite(row.steps))
      if (rows.length === 0) {
        return h(ChartCard, { title: isZh ? '步数' : 'Steps' }, h(Empty, { compact: true, text: L.noStepData }))
      }
      const goal = rows.find((row) => Number.isFinite(row.goal))
      const max = Math.max(1000, ...rows.map((row) => row.steps), goal ? goal.goal : 0)
      const innerW = SVG_W - PAD_L - PAD_R
      const innerH = SVG_H - PAD_T - PAD_B
      const slot = innerW / rows.length
      const barW = Math.max(3, Math.min(18, slot * 0.62))
      const goalY = goal ? PAD_T + innerH - (goal.goal / max) * innerH : null
      return h(
        ChartCard,
        {
          title: isZh ? '步数' : 'Steps',
          right: h(ValueBadge, {
            text: `${numberLabel(props.data.badges && props.data.badges.steps && props.data.badges.steps.value)}`,
            color: accentOf(props.settings),
          }),
        },
        h(
          Frame,
          { label: 'steps' },
          h(GridLines),
          goalY !== null
            ? h('line', {
                x1: PAD_L,
                x2: SVG_W - PAD_R,
                y1: goalY,
                y2: goalY,
                stroke: 'var(--dsw-alias-state-success-primary)',
                strokeWidth: 1,
                strokeDasharray: '3 3',
                opacity: 0.8,
              })
            : null,
          rows.map((row, index) => {
            const height = (row.steps / max) * innerH
            return h('rect', {
              key: `step-${row.date || index}`,
              x: PAD_L + slot * index + (slot - barW) / 2,
              y: PAD_T + innerH - height,
              width: barW,
              height,
              rx: 1.5,
              fill: accentOf(props.settings),
              opacity: 0.85,
            })
          }),
          h(AxisLabels, {
            rows: [
              { text: dayLabel(rows[0].date) },
              { text: dayLabel(rows[rows.length - 1].date), anchor: 'end' },
            ],
          }),
        ),
        h(Legend, {
          items: [
            { label: `${L.steps} ${numberLabel(props.data.badges && props.data.badges.steps && props.data.badges.steps.value)}`, color: accentOf(props.settings) },
            goal ? { label: `Goal ${numberLabel(goal.goal)}`, color: 'var(--dsw-alias-state-success-primary)' } : null,
          ].filter(Boolean),
        }),
      )
    }

    function TrainingCard(props) {
      const load = safeArray(props.data.training && props.data.training.load).filter(
        (row) => Number.isFinite(row.acute) || Number.isFinite(row.chronic),
      )
      const acute = load
        .filter((row) => Number.isFinite(row.acute))
        .map((row, index) => [index, row.acute])
      const chronic = load
        .filter((row) => Number.isFinite(row.chronic))
        .map((row, index) => [index, row.chronic])
      const yMax = Math.max(
        1,
        ...load.map((row) => Math.max(Number(row.acute) || 0, Number(row.chronic) || 0)),
      )
      const training = props.data.training || {}
      const balance = training.balance || null
      const balanceMax = balance
        ? Math.max(
            1,
            balance.aerobicLow || 0,
            balance.aerobicHigh || 0,
            balance.anaerobic || 0,
            ...(balance.aerobicLowTarget || []),
            ...(balance.aerobicHighTarget || []),
            ...(balance.anaerobicTarget || []),
          )
        : 1
      const ratioText =
        training.ratio === null || training.ratio === undefined
          ? null
          : `ACWR ${Number(training.ratio).toFixed(2)}${training.acwrStatus ? ` · ${training.acwrStatus}` : ''}`

      const balanceRow = (label, value, target, color) =>
        h(
          'div',
          { className: 'dgh-focus-row', key: label },
          h('span', { className: 'dgh-focus-label' }, label),
          h(
            'span',
            { className: 'dgh-focus-track' },
            target && Number.isFinite(target[0]) && Number.isFinite(target[1])
              ? h('i', {
                  className: 'dgh-focus-target',
                  style: {
                    left: `${(Math.max(0, target[0]) / balanceMax) * 100}%`,
                    width: `${Math.max(1, ((target[1] - target[0]) / balanceMax) * 100)}%`,
                  },
                })
              : null,
            h('i', {
              className: 'dgh-focus-fill',
              style: { width: `${(Math.max(0, Number(value) || 0) / balanceMax) * 100}%`, background: color },
            }),
          ),
          h('span', { className: 'dgh-focus-value' }, numberLabel(value)),
        )

      return h(
        ChartCard,
        {
          title: isZh ? '训练负荷' : 'Training load',
          right: h(TrainingStatusChip, {
            status: training.status,
            feedback: training.feedback,
          }),
        },
        load.length > 1
          ? h(
              Frame,
              { label: 'training load' },
              h(GridLines),
              h(LinePath, { points: chronic, color: '#9a6cf0', area: true, yDomain: [0, yMax] }),
              h(LinePath, { points: acute, color: '#e0713f', yDomain: [0, yMax] }),
            )
          : h(Empty, { compact: true }),
        h(Legend, {
          items: [
            { label: `${L.acuteLoad} ${numberLabel(training.acuteLoad)}`, color: '#e0713f' },
            { label: `${L.chronicLoad} ${numberLabel(training.chronicLoad)}`, color: '#9a6cf0' },
            ratioText ? { label: ratioText, color: 'var(--dsw-alias-label-tertiary)' } : null,
          ].filter(Boolean),
        }),
        balance
          ? h(
              'div',
              { className: 'dgh-focus' },
              h(
                'div',
                { className: 'dgh-focus-head' },
                h('span', null, isZh ? '四周负荷分布' : '4-week load focus'),
                balance.feedback
                  ? h('span', { className: 'dgh-focus-phrase' }, String(balance.feedback).replace(/_/g, ' '))
                  : null,
              ),
              balanceRow(isZh ? '有氧低' : 'Aerobic low', balance.aerobicLow, balance.aerobicLowTarget, '#e08a3c'),
              balanceRow(isZh ? '有氧高' : 'Aerobic high', balance.aerobicHigh, balance.aerobicHighTarget, '#e0713f'),
              balanceRow(isZh ? '无氧' : 'Anaerobic', balance.anaerobic, balance.anaerobicTarget, '#c94f4f'),
            )
          : null,
      )
    }

    function ActivitiesCard(props) {
      const rows = safeArray(props.data.activities)
      if (rows.length === 0) {
        return h(ChartCard, { title: isZh ? '最近运动' : 'Recent activities', wide: true }, h(Empty, { compact: true, text: L.noActivities }))
      }
      return h(
        ChartCard,
        { title: isZh ? '最近运动' : 'Recent activities', wide: true, right: h(ValueBadge, { text: `${rows.length}` }) },
        h(
          'ul',
          { className: 'dgh-activities' },
          rows.map((row) =>
            h(
              'li',
              { key: row.id, className: 'dgh-activity' },
              h(
                'div',
                { className: 'dgh-activity-main' },
                h(
                  'span',
                  { className: 'dgh-activity-name' },
                  h('i', {
                    className: 'dgh-activity-dot',
                    style: { background: TYPE_COLORS[row.type] || 'var(--dsw-alias-label-tertiary)' },
                  }),
                  row.name || row.type,
                ),
                h(
                  'span',
                  { className: 'dgh-activity-meta' },
                  `${row.date ? String(row.date).slice(0, 10) : ''} · ${row.type}`,
                ),
              ),
              h(
                'div',
                { className: 'dgh-activity-stats' },
                h('span', null, distanceLabel(row.distanceM)),
                h('span', null, durationLabel(row.durationS)),
                row.paceSecPerKm ? h('span', null, `${paceLabel(row.paceSecPerKm)}/km`) : null,
                row.avgHr ? h('span', { className: 'dgh-activity-hr' }, `${row.avgHr} bpm`) : null,
              ),
            ),
          ),
        ),
      )
    }

    function Callout(props) {
      return h(
        'div',
        { className: `dgh-callout dgh-callout-${props.tone || 'warn'}` },
        h('strong', null, props.title),
        h('p', null, props.message),
        props.hint ? h('p', { className: 'dgh-callout-hint' }, props.hint) : null,
      )
    }

    function useGarminData(defaultDays) {
      const [days, setDays] = useState(defaultDays || 7)
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [busy, setBusy] = useState(false)
      const mounted = useRef(true)

      useEffect(() => {
        mounted.current = true
        return () => {
          mounted.current = false
        }
      }, [])

      const load = useCallback(
        async (nextDays, options) => {
          const force = Boolean(options && options.force)
          if (force) setRefreshing(true)
          setBusy(true)
          try {
            const response = await apiFetch(
              `/data?days=${nextDays}${force ? '&force=1' : ''}`,
              { headers: { Accept: 'application/json' } },
            )
            if (response.status === 404) {
              if (mounted.current) setError({ kind: 'route' })
              return
            }
            const payload = await response.json().catch(() => null)
            if (!mounted.current) return
            if (!payload) {
              setError({ kind: 'http', message: `HTTP ${response.status}` })
              return
            }
            setData(payload)
            setError(payload.ok === false && payload.auth ? { kind: 'auth', auth: payload.auth } : null)
          } catch (cause) {
            if (mounted.current) {
              setError({ kind: 'http', message: cause && cause.message ? cause.message : String(cause) })
            }
          } finally {
            if (mounted.current) {
              setLoading(false)
              setRefreshing(false)
              setBusy(false)
            }
          }
        },
        [],
      )

      useEffect(() => {
        setLoading(true)
        void load(days, {})
      }, [days, load])

      useEffect(() => {
        const minutes = Math.max(1, Number(data && data.settings && data.settings.pollMinutes) || 5)
        const timer = setInterval(() => {
          void load(days, {})
        }, minutes * 60 * 1000)
        return () => clearInterval(timer)
      }, [days, load, data && data.settings && data.settings.pollMinutes])

      return {
        data,
        days,
        setDays,
        loading,
        refreshing,
        busy,
        error,
        refresh: () => load(days, { force: true }),
        retry: () => load(days, {}),
      }
    }

    function HealthPanel() {
      const [bootstrap, setBootstrap] = useState(null)
      useEffect(() => {
        let alive = true
        apiFetch('/settings', { headers: { Accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (alive && payload && payload.ok) setBootstrap(payload.settings)
          })
          .catch(() => {})
        return () => {
          alive = false
        }
      }, [])

      const state = useGarminData(bootstrap ? bootstrap.defaultDays : 7)
      const preferredDays = bootstrap ? bootstrap.defaultDays : null
      const appliedDefault = useRef(false)
      useEffect(() => {
        if (!preferredDays || appliedDefault.current) return
        appliedDefault.current = true
        if (preferredDays !== state.days) state.setDays(preferredDays)
      }, [preferredDays])
      const data = state.data
      const settings = (data && data.settings) || bootstrap || {}
      const cards = settings.cards || {}
      const badges = (data && data.badges) || {}
      const auth = (data && data.auth) || { state: 'ok' }
      const range = state.days

      const badgeGrid = h(
        'div',
        { className: 'dgh-badges' },
        h(Badge, {
          label: L.steps,
          value: numberLabel(badges.steps && badges.steps.value),
          sub: badges.steps && badges.steps.goal ? `/ ${numberLabel(badges.steps.goal)}` : null,
          progress:
            badges.steps && badges.steps.goal && badges.steps.value !== null
              ? Number(badges.steps.value) / Number(badges.steps.goal)
              : null,
        }),
        h(Badge, {
          label: L.restingHr,
          value: numberLabel(badges.restingHr),
          unit: badges.restingHr ? L.bpm : null,
        }),
        h(Badge, { label: L.sleepScore, value: numberLabel(badges.sleepScore), sub: '/ 100' }),
        h(Badge, { label: L.bodyBattery, value: numberLabel(badges.bodyBattery), sub: '/ 100' }),
        h(Badge, {
          label: L.trainingStatus,
          value: h(TrainingStatusChip, {
            status: badges.trainingStatus,
            feedback: data && data.training ? data.training.feedback : null,
          }),
        }),
        h(Badge, { label: L.hrvAvg, value: numberLabel(badges.hrv), unit: badges.hrv ? 'ms' : null }),
      )

      const cardViews = []
      if (data && data.ok) {
        if (cards.heartRate !== false) cardViews.push(h(HeartRateCard, { key: 'hr', data: data.heartRate || {}, settings }))
        if (cards.hrv !== false) cardViews.push(h(HrvCard, { key: 'hrv', data: data.hrv || {} }))
        if (cards.bodyBattery !== false) cardViews.push(h(BodyBatteryCard, { key: 'bb', data, settings }))
        if (cards.sleep !== false) cardViews.push(h(SleepCard, { key: 'sleep', data }))
        if (cards.steps !== false) cardViews.push(h(StepsCard, { key: 'steps', data, settings }))
        if (cards.training !== false) cardViews.push(h(TrainingCard, { key: 'training', data }))
        if (cards.activities !== false) cardViews.push(h(ActivitiesCard, { key: 'activities', data }))
      }

      return h(
        'div',
        { className: 'dgh-root' },
        h('style', null, STYLE_TEXT),
        h(
          'div',
          { className: 'dgh-page-head' },
          h(
            'div',
            { className: 'dgh-heading' },
            h('span', { className: 'dgh-dotmark' }),
            h('h1', { className: 'dgh-title' }, L.panelTitle),
            data && data.region
              ? h('span', { className: 'dgh-region' }, data.region === 'garmin.cn' ? 'CN' : 'Global')
              : null,
            data && data.profile && data.profile.fullName
              ? h('span', { className: 'dgh-account', title: data.profile.fullName }, data.profile.fullName)
              : null,
          ),
          h(
            'div',
            { className: 'dgh-head-actions' },
            h(
              'div',
              { className: 'dgh-ranges', role: 'tablist' },
              RANGES.map((row) =>
                h(
                  'button',
                  {
                    key: row.days,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': range === row.days,
                    className: `dgh-chipbtn${range === row.days ? ' is-active' : ''}`,
                    onClick: () => state.setDays(row.days),
                  },
                  rangeLabel(row.days),
                ),
              ),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dgh-btn dgh-btn-primary',
                onClick: state.refresh,
                disabled: state.refreshing,
                title: L.refresh,
              },
              state.refreshing ? L.refreshing : L.refresh,
            ),
          ),
        ),
        h(
          'div',
          { className: 'dgh-meta' },
          data && data.generatedAt
            ? `${L.updated} ${new Date(data.generatedAt).toLocaleTimeString(isZh ? 'zh-CN' : 'en-US', {
                hour: '2-digit',
                minute: '2-digit',
              })} · ${L.source}`
            : L.source,
          ` · ${L.autoRefresh.replace('{n}', String(settings.pollMinutes || 5))}`,
          state.busy ? ` · ${L.updating}` : '',
        ),
        errorView(),
        state.loading && !data ? h('div', { className: 'dgh-loading' }, L.loading) : null,
        data && data.tokenFallback
          ? h(Callout, { tone: 'warn', title: L.fallbackTitle, message: L.fallbackHint })
          : null,
        data && data.ok && data.hasData === false
          ? h(Callout, { tone: 'info', title: L.emptyAccountTitle, message: L.emptyAccountHint })
          : null,
        data && data.ok ? badgeGrid : null,
        cardViews.length > 0 ? h('div', { className: 'dgh-cards' }, cardViews) : null,
      )

      function errorView() {
        if (!state.error) return null
        if (state.error.kind === 'route') {
          return h(Callout, {
            tone: 'error',
            title: L.routeMissing,
            message: L.routeMissingHint,
          })
        }
        if (state.error.kind === 'auth') {
          return h(Callout, {
            tone: 'warn',
            title: L.signInTitle,
            message: (state.error.auth && state.error.auth.message) || '',
            hint: L.signInHint,
          })
        }
        return h('div', { className: 'dgh-callout dgh-callout-error' }, state.error.message || '')
      }
    }

    /**
     * The left sidebar list's icon cell. The sidebar owns the row, the label and
     * the active state; this only draws the glyph, inheriting the row's colour.
     */
    function PanelIcon(props) {
      const size = props && Number(props.size) > 0 ? props.size : 22
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          'aria-hidden': true,
          fill: 'none',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M3 12h4l2.2-5.5L13 18l2.4-6H21',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ------------------------------------------------------------ settings */

    function SettingsRow(props) {
      return h(
        'div',
        { className: 'dgh-row' },
        h(
          'div',
          { className: 'dgh-row-text' },
          h('span', { className: 'dgh-row-label' }, props.label),
          props.hint ? h('span', { className: 'dgh-row-hint' }, props.hint) : null,
        ),
        h('div', { className: 'dgh-row-control' }, props.children),
      )
    }

    function Toggle(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': Boolean(props.value),
          className: `dgh-switch${props.value ? ' is-on' : ''}`,
          onClick: () => props.onChange(!props.value),
        },
        h('span', { className: 'dgh-switch-thumb' }),
      )
    }

    function SettingsPage() {
      const [settings, setSettings] = useState(null)
      const [status, setStatus] = useState('')
      const [error, setError] = useState('')

      useEffect(() => {
        let alive = true
        apiFetch('/settings', { headers: { Accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : null))
          .then((payload) => {
            if (alive && payload && payload.ok) setSettings(payload.settings)
          })
          .catch(() => {
            if (alive) setError(L.saveFailed)
          })
        return () => {
          alive = false
        }
      }, [])

      const patch = (next) => setSettings((current) => ({ ...current, ...next }))

      const save = async () => {
        setStatus('')
        setError('')
        try {
          const response = await apiFetch('/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(settings),
          })
          const payload = await response.json().catch(() => null)
          if (!response.ok || !payload || !payload.ok) throw new Error(L.saveFailed)
          setSettings(payload.settings)
          setStatus(L.saved)
        } catch (cause) {
          setError(cause && cause.message ? cause.message : L.saveFailed)
        }
      }

      if (!settings) {
        return h('div', { className: 'dgh-root dgh-settings' }, h('style', null, STYLE_TEXT), h('div', { className: 'dgh-loading' }, L.loading))
      }

      const cards = settings.cards || {}

      return h(
        'div',
        { className: 'dgh-root dgh-settings' },
        h('style', null, STYLE_TEXT),
        h('h2', { className: 'dgh-h2' }, L.settingsTitle),
        h('p', { className: 'dgh-p' }, L.settingsDesc),
        h(
          'section',
          { className: 'dgh-card' },
          h(
            SettingsRow,
            { label: L.tokenFileLabel, hint: L.tokenFileHint },
            h('input', {
              className: 'dgh-input dgh-input-wide',
              type: 'text',
              value: settings.tokenPath || '',
              placeholder: settings.tokenFile || '',
              onChange: (event) => patch({ tokenPath: event.target.value }),
            }),
          ),
          h(
            SettingsRow,
            { label: L.pollMinutes, hint: L.pollHint },
            h('input', {
              className: 'dgh-input',
              type: 'number',
              min: 1,
              max: 240,
              value: settings.pollMinutes,
              onChange: (event) => patch({ pollMinutes: Number(event.target.value) || 5 }),
            }),
          ),
          h(
            SettingsRow,
            { label: L.chinaRegion, hint: L.chinaHint },
            h(Toggle, {
              value: settings.chinaRegion,
              onChange: (value) => patch({ chinaRegion: value }),
            }),
          ),
          h(
            SettingsRow,
            { label: L.defaultRange },
            h(
              'div',
              { className: 'dgh-ranges dgh-ranges-inline' },
              RANGES.map((row) =>
                h(
                  'button',
                  {
                    key: row.days,
                    type: 'button',
                    className: `dgh-chipbtn${settings.defaultDays === row.days ? ' is-active' : ''}`,
                    onClick: () => patch({ defaultDays: row.days }),
                  },
                  rangeLabel(row.days),
                ),
              ),
            ),
          ),
        ),
        h(
          'section',
          { className: 'dgh-card' },
          h('span', { className: 'dgh-card-title' }, L.cards),
          h(
            'div',
            { className: 'dgh-checklist' },
            CARD_KEYS.map((row) =>
              h(
                'label',
                { key: row.key, className: 'dgh-check' },
                h('input', {
                  type: 'checkbox',
                  checked: cards[row.key] !== false,
                  onChange: (event) =>
                    patch({ cards: { ...cards, [row.key]: event.target.checked } }),
                }),
                h('span', null, isZh ? row.zh : row.en),
              ),
            ),
          ),
        ),
        h(
          'section',
          { className: 'dgh-card' },
          h('span', { className: 'dgh-card-title' }, L.accent),
          h(
            'div',
            { className: 'dgh-swatches' },
            ACCENTS.map((row) =>
              h(
                'button',
                {
                  key: row.value,
                  type: 'button',
                  className: `dgh-swatch${settings.accent === row.value ? ' is-active' : ''}`,
                  style: {
                    background:
                      row.value === 'auto' ? 'var(--dsw-alias-brand-primary)' : row.value,
                  },
                  title: isZh ? row.zh : row.en,
                  onClick: () => patch({ accent: row.value }),
                },
                null,
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dgh-savebar' },
          h(
            'button',
            { type: 'button', className: 'dgh-btn dgh-btn-primary', onClick: save },
            L.save,
          ),
          status ? h('span', { className: 'dgh-saved' }, status) : null,
          error ? h('span', { className: 'dgh-error' }, error) : null,
          h('span', { className: 'dgh-note' }, L.tokenNote),
        ),
      )
    }

    /* --------------------------------------------------------------- styles */

    const STYLE_TEXT = `
.dgh-root { display:flex; flex-direction:column; gap:12px; padding:22px 28px 44px; box-sizing:border-box;
  color:var(--dsw-alias-label-primary); font-size:13px; min-height:100%; width:100%; max-width:1240px; margin:0 auto; }
.dgh-page-head { display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.dgh-head-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.dgh-meta { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.dgh-heading { display:flex; align-items:center; gap:8px; min-width:0; }
.dgh-title { font-size:19px; font-weight:700; letter-spacing:.2px; margin:0; }
.dgh-region { font-size:10px; padding:1px 5px; border-radius:6px; color:var(--dsw-alias-label-secondary);
  border:1px solid var(--dsw-alias-border-l1); }
.dgh-dotmark { width:10px; height:10px; border-radius:50%; background:var(--dsw-alias-brand-primary);
  box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent); flex:none; }
.dgh-settings { max-width:900px; }
.dgh-btn { border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary); border-radius:8px; padding:5px 10px; font-size:12px;
  cursor:pointer; transition:background .15s ease; }
.dgh-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dgh-btn:disabled { opacity:.55; cursor:default; }
.dgh-btn-primary { background:var(--dsw-alias-button-primary-fill); color:var(--dsw-alias-label-primary-inverted);
  border-color:transparent; font-weight:600; }
.dgh-btn-primary:hover { background:var(--dsw-alias-button-primary-hover); }
.dgh-ranges { display:flex; gap:6px; }
.dgh-ranges-inline { justify-content:flex-end; }
.dgh-chipbtn { border:1px solid var(--dsw-alias-border-l1); background:transparent; color:var(--dsw-alias-label-secondary);
  border-radius:7px; padding:4px 9px; font-size:12px; cursor:pointer; }
.dgh-chipbtn:hover { background:var(--dsw-alias-interactive-bg-hover); }
.dgh-chipbtn.is-active { background:var(--dsw-alias-interactive-bg-active); color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2); font-weight:600; }
.dgh-badges { display:grid; grid-template-columns:repeat(auto-fit, minmax(136px, 1fr)); gap:10px; }
.dgh-badge { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px; padding:10px 12px; display:flex; flex-direction:column; gap:3px; min-width:0; }
.dgh-badge-label { font-size:11px; color:var(--dsw-alias-label-tertiary); white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.dgh-badge-value { font-size:19px; font-weight:650; font-variant-numeric:tabular-nums; line-height:1.15; }
.dgh-badge-unit { font-size:10px; font-style:normal; font-weight:500; color:var(--dsw-alias-label-tertiary); margin-left:3px; }
.dgh-badge-sub { font-size:10px; color:var(--dsw-alias-label-tertiary); }
.dgh-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:12px; align-items:start; }
.dgh-card-wide { grid-column:1 / -1; }
.dgh-card { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px; padding:11px 13px 9px; display:flex; flex-direction:column; gap:6px; min-width:0; }
.dgh-card-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.dgh-card-title { font-size:12px; font-weight:600; color:var(--dsw-alias-label-secondary); }
.dgh-card-right { font-variant-numeric:tabular-nums; }
.dgh-legend { display:flex; flex-wrap:wrap; gap:8px; font-size:10px; color:var(--dsw-alias-label-tertiary); }
.dgh-legend-item { display:inline-flex; align-items:center; gap:4px; }
.dgh-dot { width:6px; height:6px; border-radius:2px; display:inline-block; }
.dgh-empty { font-size:11px; color:var(--dsw-alias-label-tertiary); padding:10px 0; text-align:center; }
.dgh-empty.is-compact { padding:2px 0 4px; text-align:left; }
.dgh-badge-bar { height:3px; border-radius:2px; background:var(--dsw-alias-bg-layer-3); overflow:hidden; margin-top:2px; }
.dgh-badge-bar i { display:block; height:100%; border-radius:2px; background:var(--dsw-alias-brand-primary); }
.dgh-focus { display:flex; flex-direction:column; gap:5px; margin-top:2px;
  padding-top:8px; border-top:1px solid var(--dsw-alias-separator-primary); }
.dgh-focus-head { display:flex; align-items:center; justify-content:space-between; gap:8px;
  font-size:10.5px; color:var(--dsw-alias-label-tertiary); }
.dgh-focus-phrase { font-size:10px; color:var(--dsw-alias-label-secondary); }
.dgh-focus-row { display:flex; align-items:center; gap:8px; font-size:10.5px;
  color:var(--dsw-alias-label-secondary); }
.dgh-focus-label { width:52px; flex:none; color:var(--dsw-alias-label-tertiary); }
.dgh-focus-track { position:relative; flex:1; height:6px; border-radius:3px;
  background:var(--dsw-alias-bg-layer-3); overflow:hidden; }
.dgh-focus-target { position:absolute; top:0; bottom:0; background:var(--dsw-alias-border-l2); opacity:.8; }
.dgh-focus-fill { position:absolute; left:0; top:0; bottom:0; border-radius:3px; }
.dgh-focus-value { width:34px; text-align:right; font-variant-numeric:tabular-nums; flex:none; }
.dgh-loading { font-size:12px; color:var(--dsw-alias-label-tertiary); padding:18px 0; text-align:center; }
.dgh-chip { font-size:11px; border:1px solid currentColor; border-radius:6px; padding:1px 6px;
  font-weight:600; letter-spacing:.3px; white-space:nowrap; }
.dgh-activities { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:6px; }
.dgh-activity { display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:6px 0; border-bottom:1px solid var(--dsw-alias-separator-primary); }
.dgh-activity:last-child { border-bottom:none; padding-bottom:0; }
.dgh-activity-main { display:flex; flex-direction:column; min-width:0; gap:1px; }
.dgh-activity-name { font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  display:flex; align-items:center; gap:6px; }
.dgh-activity-dot { width:7px; height:7px; border-radius:50%; flex:none; }
.dgh-activity-hr { color:var(--dsw-alias-label-tertiary); }
.dgh-activity-meta { font-size:10px; color:var(--dsw-alias-label-tertiary); }
.dgh-activity-stats { display:flex; gap:8px; font-size:10.5px; color:var(--dsw-alias-label-secondary);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.dgh-callout { border-radius:10px; padding:9px 10px; font-size:11.5px; line-height:1.5; display:flex;
  flex-direction:column; gap:3px; border:1px solid transparent; }
.dgh-callout p { margin:0; color:var(--dsw-alias-label-secondary); }
.dgh-callout-hint { color:var(--dsw-alias-label-tertiary) !important; }
.dgh-callout-warn { background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); }
.dgh-callout-error { background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
  border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); }
.dgh-callout-info { background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1); }
.dgh-tab-title { display:inline-flex; align-items:center; gap:6px; font-size:12px; }
.dgh-h2 { margin:2px 0 0; font-size:15px; font-weight:650; }
.dgh-p { margin:0 0 4px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.dgh-settings .dgh-card { gap:2px; padding:6px 12px; }
.dgh-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0;
  border-bottom:1px solid var(--dsw-alias-separator-primary); }
.dgh-row:last-child { border-bottom:none; }
.dgh-row-text { display:flex; flex-direction:column; gap:2px; min-width:0; }
.dgh-row-label { font-size:12.5px; }
.dgh-row-hint { font-size:10.5px; color:var(--dsw-alias-label-tertiary); }
.dgh-row-control { flex:none; display:flex; align-items:center; gap:6px; }
.dgh-input { width:64px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary);
  border:1px solid var(--dsw-alias-border-l1); border-radius:7px; padding:4px 7px; font-size:12px; }
.dgh-input-wide { width:230px; font-size:11px; }
.dgh-account { font-size:10.5px; color:var(--dsw-alias-label-tertiary); max-width:96px;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dgh-switch { width:34px; height:20px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-layer-3); position:relative; cursor:pointer; padding:0; }
.dgh-switch.is-on { background:var(--dsw-alias-brand-primary); border-color:transparent; }
.dgh-switch-thumb { position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%;
  background:var(--dsw-alias-switch-thumb); transition:transform .16s ease; }
.dgh-switch.is-on .dgh-switch-thumb { transform:translateX(14px); }
.dgh-checklist { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:6px 10px; padding:8px 0 4px; }
.dgh-check { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.dgh-check input { accent-color:var(--dsw-alias-brand-primary); }
.dgh-swatches { display:flex; gap:8px; padding:10px 0 6px; }
.dgh-swatch { width:22px; height:22px; border-radius:50%; border:2px solid transparent; cursor:pointer; padding:0; }
.dgh-swatch.is-active { border-color:var(--dsw-alias-label-primary); }
.dgh-savebar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding-top:2px; }
.dgh-saved { font-size:11px; color:var(--dsw-alias-state-success-primary); }
.dgh-error { font-size:11px; color:var(--dsw-alias-state-error-primary); }
.dgh-note { font-size:10.5px; color:var(--dsw-alias-label-tertiary); }
`

    /* --------------------------------------------------------------- apply */

    function apply(ctx) {
      // The left sidebar's panel list addresses a main-column page by id: the
      // list entry draws one icon, the `main` cell draws the page.
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID }, HealthPanel),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 35,
            label: () => (isZh ? 'Garmin 健康' : 'Garmin Health'),
          },
          PanelIcon,
        ),
      )

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'garmin-health',
            order: 60,
            label: isZh ? 'Garmin 健康' : 'Garmin Health',
          },
          SettingsPage,
        ),
      )
    }

    return { inject: ['slots'], apply }
  },
})
