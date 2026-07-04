/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { dataScheme as vchartDefaultDataScheme } from '@visactor/vchart/esm/theme/color-scheme/builtin/default'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatChartTime, type TimeGranularity } from '@/lib/time'
import { MAX_CHART_TREND_POINTS } from '@/features/dashboard/constants'
import type {
  QuotaDataItem,
  ProcessedChartData,
  ProcessedUserChartData,
  ProcessedTokenChartData,
} from '@/features/dashboard/types'

type TFunction = (key: string) => string
type TooltipLineItem = {
  key: string
  value: string | number
  datum?: Record<string, unknown>
  hasShape?: boolean
  shapeType?: string
  shapeFill?: string
  shapeStroke?: string
  shapeSize?: number
}

export function getDashboardChartColors(domainLength: number): string[] {
  const scheme =
    vchartDefaultDataScheme.find(
      (item) => !item.maxDomainLength || domainLength <= item.maxDomainLength
    ) ?? vchartDefaultDataScheme[vchartDefaultDataScheme.length - 1]

  return scheme.scheme.filter(
    (color): color is string => typeof color === 'string'
  )
}

function renderQuotaCompat(rawQuota: number, digits = 4): string {
  const { config, meta } = getCurrencyDisplay()
  if (meta.kind === 'tokens') return rawQuota.toLocaleString()
  const usd = rawQuota / config.quotaPerUnit
  const rate = 'exchangeRate' in meta ? meta.exchangeRate : 1
  const symbol = 'symbol' in meta ? meta.symbol : '$'
  const value = usd * rate
  const fixed = value.toFixed(digits)
  if (parseFloat(fixed) === 0 && rawQuota > 0 && value > 0) {
    return symbol + Math.pow(10, -digits).toFixed(digits)
  }
  return symbol + fixed
}

/**
 * Process and aggregate chart data
 */
export function processChartData(
  data: QuotaDataItem[],
  timeGranularity: TimeGranularity = 'day',
  t?: TFunction,
  chartCornerRadius?: number
): ProcessedChartData {
  const tt: TFunction = t ?? ((x) => x)
  const otherLabel = tt('Other')

  const formatInt = (value: number) =>
    Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
  const formatQuotaValue = (value: number) => renderQuotaCompat(value, 4)
  const formatQuotaTotal = (value: number) => renderQuotaCompat(value, 2)

  const MAX_TOOLTIP_MODELS = 15
  const isOtherTooltipKey = (key: string) =>
    key === 'Other' || key === otherLabel

  const makeTooltipDimensionUpdateContent = (options?: {
    collapseOverflow?: boolean
  }) => {
    const collapseOverflow = options?.collapseOverflow ?? true

    return (array: TooltipLineItem[]) => {
      const modelItems = array.filter((item) => !isOtherTooltipKey(item.key))
      const otherItems = array.filter((item) => isOtherTooltipKey(item.key))
      modelItems.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
      array = [...modelItems, ...otherItems]

      let sum = 0
      for (let i = 0; i < array.length; i++) {
        const v = Number(array[i].value) || 0
        if (
          array[i].datum &&
          (array[i].datum as Record<string, unknown>)?.TimeSum
        ) {
          sum =
            Number((array[i].datum as Record<string, unknown>)?.TimeSum) || sum
        }
        array[i].value = formatQuotaValue(v)
      }

      if (collapseOverflow && array.length > MAX_TOOLTIP_MODELS) {
        const visible = modelItems.slice(0, MAX_TOOLTIP_MODELS)
        const otherSum = [
          ...modelItems.slice(MAX_TOOLTIP_MODELS),
          ...otherItems,
        ].reduce((sum, item) => {
          const raw = item.datum
            ? Number((item.datum as Record<string, unknown>)?.rawQuota) || 0
            : 0
          return sum + raw
        }, 0)
        array = [
          ...visible,
          {
            key: otherLabel,
            value: formatQuotaValue(otherSum),
            hasShape: true,
            shapeType: 'square',
            shapeFill: otherTooltipColor,
            shapeStroke: otherTooltipColor,
            shapeSize: 8,
          },
        ]
      }

      array.unshift({
        key: tt('Total:'),
        value: formatQuotaValue(sum),
      })
      return array
    }
  }

  if (!data || data.length === 0) {
    return {
      spec_pie: {
        type: 'pie',
        data: [{ id: 'id0', values: [] }],
        outerRadius: 0.8,
        innerRadius: 0.5,
        padAngle: 0.6,
        valueField: 'value',
        categoryField: 'type',
        title: {
          visible: true,
          text: tt('Call Count Distribution'),
          subtext: tt('No data available'),
        },
        legends: { visible: false },
        label: { visible: false },
        tooltip: {
          mark: {
            content: [],
          },
        },
      },
      spec_line: {
        type: 'bar',
        data: [{ id: 'barData', values: [] }],
        xField: 'Time',
        yField: 'Usage',
        seriesField: 'Model',
        stack: true,
        legends: { visible: true, selectMode: 'single' },
      },
      spec_area: {
        type: 'area',
        data: [{ id: 'areaData', values: [] }],
        xField: 'Time',
        yField: 'Usage',
        seriesField: 'Model',
        stack: true,
        legends: { visible: true, selectMode: 'single' },
      },
      spec_model_line: {
        type: 'area',
        data: [{ id: 'lineData', values: [] }],
        xField: 'Time',
        yField: 'Count',
        seriesField: 'Model',
        legends: { visible: true, selectMode: 'single' },
        title: {
          visible: true,
          text: tt('Call Trend'),
        },
      },
      spec_rank_bar: {
        type: 'bar',
        data: [{ id: 'rankData', values: [] }],
        xField: 'Model',
        yField: 'Count',
        seriesField: 'Model',
        legends: { visible: true, selectMode: 'single' },
        title: {
          visible: true,
          text: tt('Call Count Ranking'),
        },
      },
      totalQuotaDisplay: formatQuotaTotal(0),
      totalCountDisplay: formatInt(0),
    }
  }

  const { config } = getCurrencyDisplay()
  const quotaPerUnit = config.quotaPerUnit

  // Aggregate all metrics by time and model
  const timeModelMap = new Map<
    string,
    Map<string, { quota: number; count: number; tokens: number }>
  >()
  const modelTotalsMap = new Map<
    string,
    { quota: number; count: number; tokens: number }
  >()

  data.forEach((item) => {
    const timestamp = Number(item.created_at)
    const timeKey = formatChartTime(timestamp, timeGranularity)
    const model = item.model_name || 'Unknown'
    const quota = Number(item.quota) || 0
    const count = Number(item.count) || 0
    const tokens = Number(item.token_used) || 0

    // Aggregate by time and model
    if (!timeModelMap.has(timeKey)) {
      timeModelMap.set(timeKey, new Map())
    }
    const modelMap = timeModelMap.get(timeKey)!
    const existing = modelMap.get(model) || { quota: 0, count: 0, tokens: 0 }
    modelMap.set(model, {
      quota: existing.quota + quota,
      count: existing.count + count,
      tokens: existing.tokens + tokens,
    })

    // Calculate totals
    const totalExisting = modelTotalsMap.get(model) || {
      quota: 0,
      count: 0,
      tokens: 0,
    }
    modelTotalsMap.set(model, {
      quota: totalExisting.quota + quota,
      count: totalExisting.count + count,
      tokens: totalExisting.tokens + tokens,
    })
  })

  const allModels = Array.from(modelTotalsMap.keys())
  const sortedTimes = Array.from(timeModelMap.keys()).sort()
  const sortedModels = [...allModels].sort()
  const modelColorDomain = Array.from(new Set([...sortedModels, otherLabel]))
  const modelColorRange = getDashboardChartColors(modelColorDomain.length)
  const otherColor = modelColorRange[modelColorDomain.indexOf(otherLabel)]
  const otherTooltipColor =
    typeof otherColor === 'string' ? otherColor : '#FF8A00'
  const modelColor = {
    type: 'ordinal',
    domain: modelColorDomain,
    range: modelColorRange,
  }

  // Pad time points if too few (default 7 points)
  const MAX_TREND_POINTS = MAX_CHART_TREND_POINTS
  const fillTimePoints = (times: string[]) => {
    if (times.length >= MAX_TREND_POINTS) return times
    const lastTime = Math.max(
      ...data.map((item) => Number(item.created_at) || 0)
    )
    const intervalSec =
      timeGranularity === 'week'
        ? 604800
        : timeGranularity === 'day'
          ? 86400
          : 3600
    const padded = Array.from({ length: MAX_TREND_POINTS }, (_, i) =>
      formatChartTime(
        lastTime - (MAX_TREND_POINTS - 1 - i) * intervalSec,
        timeGranularity
      )
    )
    return padded
  }
  const chartTimes = fillTimePoints(sortedTimes)

  const totalTimes = Array.from(modelTotalsMap.values()).reduce(
    (sum, x) => sum + (Number(x.count) || 0),
    0
  )
  const totalQuotaRaw = Array.from(modelTotalsMap.values()).reduce(
    (sum, x) => sum + (Number(x.quota) || 0),
    0
  )

  // Pie chart (model call count proportion)
  const pieValues = Array.from(modelTotalsMap.entries())
    .map(([model, stats]) => ({
      type: model,
      value: Number(stats.count) || 0,
    }))
    .sort((a, b) => b.value - a.value)

  // Stacked bar: model quota distribution (quota -> USD)
  const lineValues: Array<{
    Time: string
    Model: string
    rawQuota: number
    Usage: number
    TimeSum: number
  }> = []

  chartTimes.forEach((time) => {
    let timeData = sortedModels.map((model) => {
      const stats = timeModelMap.get(time)?.get(model)
      const rawQuota = Number(stats?.quota) || 0
      const usd = rawQuota ? rawQuota / quotaPerUnit : 0
      // Match legacy frontend getQuotaWithUnit(..., 4)
      const usage = usd ? Number(usd.toFixed(4)) : 0
      return {
        Time: time,
        Model: model,
        rawQuota,
        Usage: usage,
        TimeSum: 0,
      }
    })

    const timeSum = timeData.reduce((sum, item) => sum + item.rawQuota, 0)
    timeData.sort((a, b) => b.rawQuota - a.rawQuota)
    timeData = timeData.map((item) => ({ ...item, TimeSum: timeSum }))
    lineValues.push(...timeData)
  })
  lineValues.sort((a, b) => a.Time.localeCompare(b.Time))

  // Area chart: top models by quota + "Other" bucket (too many series = unreadable)
  const MAX_AREA_MODELS = 15
  const rankedQuotaModels = Array.from(modelTotalsMap.entries())
    .map(([model, stats]) => ({
      Model: model,
      Quota: Number(stats.quota) || 0,
    }))
    .sort((a, b) => b.Quota - a.Quota)
  const topAreaModels = new Set(
    rankedQuotaModels.slice(0, MAX_AREA_MODELS).map((m) => m.Model)
  )

  const areaValues: typeof lineValues = []
  chartTimes.forEach((time) => {
    const buckets = new Map<string, { rawQuota: number; usage: number }>()
    const modelMap = timeModelMap.get(time)
    let timeSum = 0
    sortedModels.forEach((model) => {
      const stats = modelMap?.get(model)
      const rawQuota = Number(stats?.quota) || 0
      const usd = rawQuota ? rawQuota / quotaPerUnit : 0
      const usage = usd ? Number(usd.toFixed(4)) : 0
      timeSum += rawQuota
      const key = topAreaModels.has(model) ? model : otherLabel
      const prev = buckets.get(key) || { rawQuota: 0, usage: 0 }
      buckets.set(key, {
        rawQuota: prev.rawQuota + rawQuota,
        usage: Number((prev.usage + usage).toFixed(4)),
      })
    })
    for (const [model, vals] of buckets) {
      areaValues.push({
        Time: time,
        Model: model,
        rawQuota: vals.rawQuota,
        Usage: vals.usage,
        TimeSum: timeSum,
      })
    }
  })
  areaValues.sort((a, b) => a.Time.localeCompare(b.Time))

  // Line chart: model call trend (top models + "Other" bucket)
  const MAX_TREND_MODELS = 20
  const rankedTrendModels = Array.from(modelTotalsMap.entries())
    .map(([model, stats]) => ({
      Model: model,
      Count: Number(stats.count) || 0,
    }))
    .sort((a, b) => b.Count - a.Count)
  const topTrendModels = rankedTrendModels
    .slice(0, MAX_TREND_MODELS)
    .map((item) => item.Model)
  const otherTrendModels = rankedTrendModels
    .slice(MAX_TREND_MODELS)
    .map((item) => item.Model)

  const modelLineValues: Array<{
    Time: string
    Model: string
    Count: number
  }> = []
  chartTimes.forEach((time) => {
    const timeData = topTrendModels.map((model) => {
      const stats = timeModelMap.get(time)?.get(model)
      return {
        Time: time,
        Model: model,
        Count: Number(stats?.count) || 0,
      }
    })
    if (otherTrendModels.length > 0) {
      const otherCount = otherTrendModels.reduce((sum, model) => {
        const stats = timeModelMap.get(time)?.get(model)
        return sum + (Number(stats?.count) || 0)
      }, 0)
      timeData.push({
        Time: time,
        Model: otherLabel,
        Count: otherCount,
      })
    }
    modelLineValues.push(...timeData)
  })
  modelLineValues.sort((a, b) => a.Time.localeCompare(b.Time))

  // Rank bar: model call count ranking (top 20 + "Other" bucket)
  const MAX_RANK_MODELS = 20
  const allRankValues = Array.from(modelTotalsMap.entries())
    .map(([model, stats]) => ({
      Model: model,
      Count: Number(stats.count) || 0,
    }))
    .sort((a, b) => b.Count - a.Count)

  let rankValues: typeof allRankValues
  if (allRankValues.length > MAX_RANK_MODELS) {
    const topModels = allRankValues.slice(0, MAX_RANK_MODELS)
    const otherCount = allRankValues
      .slice(MAX_RANK_MODELS)
      .reduce((sum, item) => sum + item.Count, 0)
    rankValues = [...topModels, { Model: otherLabel, Count: otherCount }]
  } else {
    rankValues = allRankValues
  }

  return {
    spec_pie: {
      type: 'pie',
      data: [{ id: 'id0', values: pieValues }],
      outerRadius: 0.8,
      innerRadius: 0.5,
      padAngle: 0.6,
      valueField: 'value',
      categoryField: 'type',
      pie: {
        style:
          chartCornerRadius == null ? {} : { cornerRadius: chartCornerRadius },
        state: {
          hover: { outerRadius: 0.85, stroke: '#000', lineWidth: 1 },
          selected: { outerRadius: 0.85, stroke: '#000', lineWidth: 1 },
        },
      },
      title: {
        visible: true,
        text: tt('Call Count Distribution'),
      },
      legends: { visible: true, orient: 'left' },
      label: { visible: true },
      color: modelColor,
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.type,
              value: (datum: Record<string, unknown>) =>
                formatInt(Number(datum?.value) || 0),
            },
          ],
        },
      },
      background: { fill: 'transparent' },
      animation: true,
    },
    spec_line: {
      type: 'bar',
      data: [{ id: 'barData', values: lineValues }],
      xField: 'Time',
      yField: 'Usage',
      seriesField: 'Model',
      stack: true,
      legends: { visible: true, selectMode: 'single' },
      color: modelColor,
      bar: {
        state: {
          hover: { stroke: '#000', lineWidth: 1 },
        },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                formatQuotaValue(Number(datum?.rawQuota) || 0),
            },
          ],
        },
        dimension: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                Number(datum?.rawQuota) || 0,
            },
          ],
          updateContent: makeTooltipDimensionUpdateContent(),
        },
      },
      background: { fill: 'transparent' },
      animation: true,
    },
    spec_area: {
      type: 'area',
      data: [{ id: 'areaData', values: areaValues }],
      xField: 'Time',
      yField: 'Usage',
      seriesField: 'Model',
      stack: false,
      legends: { visible: true, selectMode: 'single' },
      color: modelColor,
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                formatQuotaValue(Number(datum?.rawQuota) || 0),
            },
          ],
        },
        dimension: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                Number(datum?.rawQuota) || 0,
            },
          ],
          updateContent: makeTooltipDimensionUpdateContent({
            collapseOverflow: false,
          }),
        },
      },
      area: {
        style: {
          fillOpacity: 0.08,
          curveType: 'monotone',
        },
      },
      line: {
        style: {
          lineWidth: 2,
          curveType: 'monotone',
        },
      },
      point: { visible: false },
      background: { fill: 'transparent' },
      animation: true,
    },
    spec_model_line: {
      type: 'area',
      data: [{ id: 'lineData', values: modelLineValues }],
      xField: 'Time',
      yField: 'Count',
      seriesField: 'Model',
      stack: false,
      legends: { visible: true, selectMode: 'single' },
      color: modelColor,
      title: {
        visible: true,
        text: tt('Call Trend'),
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                formatInt(Number(datum?.Count) || 0),
            },
          ],
        },
        dimension: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                Number(datum?.Count) || 0,
            },
          ],
          updateContent: (
            array: Array<{
              key: string
              value: string | number
            }>
          ) => {
            const modelItems = array.filter(
              (item) => !isOtherTooltipKey(item.key)
            )
            const otherItems = array.filter((item) =>
              isOtherTooltipKey(item.key)
            )
            modelItems.sort(
              (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
            )
            array = [...modelItems, ...otherItems]

            let sum = 0
            for (let i = 0; i < array.length; i++) {
              const v = Number(array[i].value) || 0
              sum += v
              array[i].value = formatInt(v)
            }
            array.unshift({
              key: tt('Total:'),
              value: formatInt(sum),
            })
            return array
          },
        },
      },
      area: {
        style: {
          fillOpacity: 0.08,
          curveType: 'monotone',
        },
      },
      line: {
        style: {
          lineWidth: 2,
          curveType: 'monotone',
        },
      },
      point: { visible: false },
      background: { fill: 'transparent' },
      animation: true,
    },
    spec_rank_bar: {
      type: 'bar',
      data: [{ id: 'rankData', values: rankValues }],
      xField: 'Model',
      yField: 'Count',
      seriesField: 'Model',
      legends: { visible: true, selectMode: 'single' },
      color: modelColor,
      title: {
        visible: true,
        text: tt('Call Count Ranking'),
      },
      bar: {
        state: {
          hover: { stroke: '#000', lineWidth: 1 },
        },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.Model,
              value: (datum: Record<string, unknown>) =>
                formatInt(Number(datum?.Count) || 0),
            },
          ],
        },
      },
      background: { fill: 'transparent' },
      animation: true,
    },
    totalQuotaDisplay: formatQuotaTotal(totalQuotaRaw),
    totalCountDisplay: formatInt(totalTimes),
  }
}

const USER_COLORS = [
  '#5B8FF9',
  '#5AD8A6',
  '#F6BD16',
  '#E8684A',
  '#6DC8EC',
  '#9270CA',
  '#FF9D4D',
  '#269A99',
  '#FF99C3',
  '#5D7092',
]

export function processUserChartData(
  data: QuotaDataItem[],
  timeGranularity: TimeGranularity = 'day',
  t?: TFunction,
  limit = 10
): ProcessedUserChartData {
  const tt: TFunction = t ?? ((x) => x)
  const { config } = getCurrencyDisplay()
  const quotaPerUnit = config.quotaPerUnit

  const formatVal = (raw: number) => renderQuotaCompat(raw, 2)

  const emptyResult: ProcessedUserChartData = {
    spec_user_rank: {
      type: 'bar',
      data: [{ id: 'userRankData', values: [] }],
      xField: 'rawQuota',
      yField: 'User',
      seriesField: 'User',
      direction: 'horizontal',
      title: {
        visible: true,
        text: tt('User Consumption Ranking'),
        subtext: tt('No data available'),
      },
      legends: { visible: false },
      color: { type: 'ordinal', range: USER_COLORS },
      background: { fill: 'transparent' },
    },
    spec_user_trend: {
      type: 'area',
      data: [{ id: 'userTrendData', values: [] }],
      xField: 'Time',
      yField: 'rawQuota',
      seriesField: 'User',
      title: {
        visible: true,
        text: tt('User Consumption Trend'),
        subtext: tt('No data available'),
      },
      legends: { visible: true, selectMode: 'single' },
      color: { type: 'ordinal', range: USER_COLORS },
      point: { visible: false },
      background: { fill: 'transparent' },
    },
  }

  if (!data || data.length === 0) return emptyResult

  const userQuotaTotal = new Map<string, number>()
  data.forEach((item) => {
    const username = item.username || 'unknown'
    const prev = userQuotaTotal.get(username) || 0
    userQuotaTotal.set(username, prev + (Number(item.quota) || 0))
  })

  const sorted = Array.from(userQuotaTotal.entries()).sort(
    (a, b) => b[1] - a[1]
  )
  const topUsers = sorted.slice(0, limit).map(([u]) => u)
  const topUserSet = new Set(topUsers)
  const totalQuota = sorted.slice(0, limit).reduce((s, [, q]) => s + q, 0)

  const rankValues = sorted.slice(0, limit).map(([username, quota]) => ({
    User: username,
    rawQuota: quota,
    Usage: Number((quota / quotaPerUnit).toFixed(4)),
  }))

  const userColorMap = topUsers.reduce<Record<string, string>>(
    (acc, user, i) => {
      acc[user] = USER_COLORS[i % USER_COLORS.length]
      return acc
    },
    {}
  )

  const timeUserMap = new Map<string, Map<string, number>>()
  const allTimePoints = new Set<string>()

  data.forEach((item) => {
    const ts = Number(item.created_at)
    const timeKey = formatChartTime(ts, timeGranularity)
    allTimePoints.add(timeKey)
    const user = item.username || 'unknown'
    if (!topUserSet.has(user)) return
    if (!timeUserMap.has(timeKey)) timeUserMap.set(timeKey, new Map())
    const map = timeUserMap.get(timeKey)!
    map.set(user, (map.get(user) || 0) + (Number(item.quota) || 0))
  })

  const sortedTimePoints = Array.from(allTimePoints).sort()
  const trendValues: Array<{
    Time: string
    User: string
    rawQuota: number
    Usage: number
  }> = []

  sortedTimePoints.forEach((time) => {
    topUsers.forEach((user) => {
      const q = timeUserMap.get(time)?.get(user) || 0
      trendValues.push({
        Time: time,
        User: user,
        rawQuota: q,
        Usage: Number((q / quotaPerUnit).toFixed(4)),
      })
    })
  })

  return {
    spec_user_rank: {
      type: 'bar',
      data: [{ id: 'userRankData', values: rankValues }],
      xField: 'rawQuota',
      yField: 'User',
      seriesField: 'User',
      direction: 'horizontal',
      title: {
        visible: true,
        text: tt('User Consumption Ranking'),
        subtext: `${tt('Total:')} ${formatVal(totalQuota)}`,
      },
      legends: { visible: false },
      bar: {
        state: { hover: { stroke: '#000', lineWidth: 1 } },
      },
      label: {
        visible: true,
        position: 'outside',
        formatMethod: (value: number) => formatVal(value),
        style: { fontSize: 11 },
      },
      axes: [
        { orient: 'left', type: 'band' },
        { orient: 'bottom', type: 'linear', visible: false },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.User,
              value: (datum: Record<string, unknown>) =>
                formatVal(Number(datum?.rawQuota) || 0),
            },
          ],
          updateContent: (
            array: Array<{
              key: string
              value: string | number
              datum?: Record<string, unknown>
            }>
          ) => {
            for (let i = 0; i < array.length; i++) {
              const rawQuota = array[i].datum?.rawQuota
              const value =
                rawQuota === undefined ? array[i].value : Number(rawQuota)
              array[i].value = formatVal(Number(value) || 0)
            }
            return array
          },
        },
      },
      color: { specified: userColorMap },
      background: { fill: 'transparent' },
      animation: true,
    },
    spec_user_trend: {
      type: 'area',
      data: [{ id: 'userTrendData', values: trendValues }],
      xField: 'Time',
      yField: 'rawQuota',
      seriesField: 'User',
      stack: false,
      title: {
        visible: true,
        text: tt('User Consumption Trend'),
        subtext: `${tt('Total:')} ${formatVal(totalQuota)}`,
      },
      legends: { visible: true, selectMode: 'single' },
      axes: [
        { orient: 'bottom', type: 'band' },
        {
          orient: 'left',
          type: 'linear',
          label: {
            formatMethod: (value: number) => formatVal(value),
          },
        },
      ],
      tooltip: {
        mark: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.User,
              value: (datum: Record<string, unknown>) =>
                formatVal(Number(datum?.rawQuota) || 0),
            },
          ],
        },
        dimension: {
          content: [
            {
              key: (datum: Record<string, unknown>) => datum?.User,
              value: (datum: Record<string, unknown>) =>
                Number(datum?.rawQuota) || 0,
            },
          ],
          updateContent: (
            array: Array<{
              key: string
              value: string | number
            }>
          ) => {
            array.sort(
              (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
            )
            let sum = 0
            for (let i = 0; i < array.length; i++) {
              const v = Number(array[i].value) || 0
              sum += v
              array[i].value = formatVal(v)
            }
            array.unshift({
              key: tt('Total:'),
              value: formatVal(sum),
            })
            return array
          },
        },
      },
      area: {
        style: {
          fillOpacity: 0.15,
          curveType: 'monotone',
        },
      },
      line: {
        style: {
          lineWidth: 2,
          curveType: 'monotone',
        },
      },
      point: { visible: false },
      color: { specified: userColorMap },
      background: { fill: 'transparent' },
      animation: true,
    },
  }
}

export function processTokenChartData(
  data: QuotaDataItem[],
  timeGranularity: TimeGranularity = 'day',
  t?: TFunction,
  limit = 10
): ProcessedTokenChartData {
  const tt: TFunction = t ?? ((x) => x)
  const { config } = getCurrencyDisplay()
  const quotaPerUnit = config.quotaPerUnit

  const formatVal = (raw: number) => renderQuotaCompat(raw, 2)
  const formatInt = (value: number) =>
    Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)

  const emptyResult: ProcessedTokenChartData = {
    spec_token_rank: {
      type: 'bar',
      data: [{ id: 'tokenRankData', values: [] }],
      xField: 'rawQuota',
      yField: 'Token',
      seriesField: 'Token',
      direction: 'horizontal',
      title: { visible: true, text: tt('API Key Consumption Ranking'), subtext: tt('No data available') },
      legends: { visible: false },
      color: { type: 'ordinal', range: USER_COLORS },
      background: { fill: 'transparent' },
    },
    spec_token_trend: {
      type: 'area',
      data: [{ id: 'tokenTrendData', values: [] }],
      xField: 'Time',
      yField: 'rawQuota',
      seriesField: 'Token',
      title: { visible: true, text: tt('API Key Consumption Trend'), subtext: tt('No data available') },
      legends: { visible: true, selectMode: 'single' },
      color: { type: 'ordinal', range: USER_COLORS },
      point: { visible: false },
      background: { fill: 'transparent' },
    },
    spec_token_count_rank: {
      type: 'bar',
      data: [{ id: 'tokenCountRankData', values: [] }],
      xField: 'Count',
      yField: 'Token',
      seriesField: 'Token',
      direction: 'horizontal',
      title: { visible: true, text: tt('API Key Request Count Ranking'), subtext: tt('No data available') },
      legends: { visible: false },
      color: { type: 'ordinal', range: USER_COLORS },
      background: { fill: 'transparent' },
    },
    spec_token_count_trend: {
      type: 'area',
      data: [{ id: 'tokenCountTrendData', values: [] }],
      xField: 'Time',
      yField: 'Count',
      seriesField: 'Token',
      title: { visible: true, text: tt('API Key Request Count Trend'), subtext: tt('No data available') },
      legends: { visible: true, selectMode: 'single' },
      color: { type: 'ordinal', range: USER_COLORS },
      point: { visible: false },
      background: { fill: 'transparent' },
    },
    spec_token_token_rank: {
      type: 'bar',
      data: [{ id: 'tokenTokenRankData', values: [] }],
      xField: 'Tokens',
      yField: 'Token',
      seriesField: 'Token',
      direction: 'horizontal',
      title: { visible: true, text: tt('API Key Token Usage Ranking'), subtext: tt('No data available') },
      legends: { visible: false },
      color: { type: 'ordinal', range: USER_COLORS },
      background: { fill: 'transparent' },
    },
    spec_token_token_trend: {
      type: 'area',
      data: [{ id: 'tokenTokenTrendData', values: [] }],
      xField: 'Time',
      yField: 'Tokens',
      seriesField: 'Token',
      title: { visible: true, text: tt('API Key Token Usage Trend'), subtext: tt('No data available') },
      legends: { visible: true, selectMode: 'single' },
      color: { type: 'ordinal', range: USER_COLORS },
      point: { visible: false },
      background: { fill: 'transparent' },
    },
  }

  if (!data || data.length === 0) return emptyResult

  // Resolve token label: prefer token_name from backend, fall back to token_id
  const getTokenLabel = (item: QuotaDataItem) =>
    item.token_name || `Key-${item.token_id || 'unknown'}`

  // Aggregate totals per token for all three metrics
  const tokenQuotaTotal = new Map<string, number>()
  const tokenCountTotal = new Map<string, number>()
  const tokenTokenTotal = new Map<string, number>()
  data.forEach((item) => {
    const tokenLabel = getTokenLabel(item)
    tokenQuotaTotal.set(tokenLabel, (tokenQuotaTotal.get(tokenLabel) || 0) + (Number(item.quota) || 0))
    tokenCountTotal.set(tokenLabel, (tokenCountTotal.get(tokenLabel) || 0) + (Number(item.count) || 0))
    tokenTokenTotal.set(tokenLabel, (tokenTokenTotal.get(tokenLabel) || 0) + (Number(item.token_used) || 0))
  })

  // Select top N tokens by quota (primary ranking dimension)
  const sortedByQuota = Array.from(tokenQuotaTotal.entries()).sort((a, b) => b[1] - a[1])
  const topTokens = sortedByQuota.slice(0, limit).map(([t]) => t)
  const topTokenSet = new Set(topTokens)
  const totalQuota = sortedByQuota.slice(0, limit).reduce((s, [, q]) => s + q, 0)
  const totalCount = topTokens.reduce((s, t) => s + (tokenCountTotal.get(t) || 0), 0)
  const totalTokens = topTokens.reduce((s, t) => s + (tokenTokenTotal.get(t) || 0), 0)

  const tokenColorMap = topTokens.reduce<Record<string, string>>(
    (acc, token, i) => {
      acc[token] = USER_COLORS[i % USER_COLORS.length]
      return acc
    },
    {}
  )

  // ---- Quota rank ----
  const quotaRankValues = sortedByQuota.slice(0, limit).map(([tokenLabel, quota]) => ({
    Token: tokenLabel,
    rawQuota: quota,
    Usage: Number((quota / quotaPerUnit).toFixed(4)),
  }))

  // ---- Count rank ----
  const sortedByCount = topTokens
    .map((t) => [t, tokenCountTotal.get(t) || 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const countRankValues = sortedByCount.map(([tokenLabel, count]) => ({
    Token: tokenLabel,
    Count: count,
  }))

  // ---- Token used rank ----
  const sortedByToken = topTokens
    .map((t) => [t, tokenTokenTotal.get(t) || 0] as [string, number])
    .sort((a, b) => b[1] - a[1])
  const tokenRankValues = sortedByToken.map(([tokenLabel, tokens]) => ({
    Token: tokenLabel,
    Tokens: tokens,
  }))

  // ---- Time-based trend data for all three metrics ----
  const timeTokenQuotaMap = new Map<string, Map<string, number>>()
  const timeTokenCountMap = new Map<string, Map<string, number>>()
  const timeTokenTokenMap = new Map<string, Map<string, number>>()
  const allTimePoints = new Set<string>()

  data.forEach((item) => {
    const ts = Number(item.created_at)
    const timeKey = formatChartTime(ts, timeGranularity)
    allTimePoints.add(timeKey)
    const tokenLabel = getTokenLabel(item)
    if (!topTokenSet.has(tokenLabel)) return

    if (!timeTokenQuotaMap.has(timeKey)) timeTokenQuotaMap.set(timeKey, new Map())
    if (!timeTokenCountMap.has(timeKey)) timeTokenCountMap.set(timeKey, new Map())
    if (!timeTokenTokenMap.has(timeKey)) timeTokenTokenMap.set(timeKey, new Map())

    const qm = timeTokenQuotaMap.get(timeKey)!
    qm.set(tokenLabel, (qm.get(tokenLabel) || 0) + (Number(item.quota) || 0))
    const cm = timeTokenCountMap.get(timeKey)!
    cm.set(tokenLabel, (cm.get(tokenLabel) || 0) + (Number(item.count) || 0))
    const tm = timeTokenTokenMap.get(timeKey)!
    tm.set(tokenLabel, (tm.get(tokenLabel) || 0) + (Number(item.token_used) || 0))
  })

  const sortedTimePoints = Array.from(allTimePoints).sort()

  // Quota trend
  const quotaTrendValues: Array<{ Time: string; Token: string; rawQuota: number; Usage: number }> = []
  // Count trend
  const countTrendValues: Array<{ Time: string; Token: string; Count: number }> = []
  // Token trend
  const tokenTrendValues: Array<{ Time: string; Token: string; Tokens: number }> = []

  sortedTimePoints.forEach((time) => {
    topTokens.forEach((token) => {
      const q = timeTokenQuotaMap.get(time)?.get(token) || 0
      quotaTrendValues.push({ Time: time, Token: token, rawQuota: q, Usage: Number((q / quotaPerUnit).toFixed(4)) })
      const c = timeTokenCountMap.get(time)?.get(token) || 0
      countTrendValues.push({ Time: time, Token: token, Count: c })
      const tk = timeTokenTokenMap.get(time)?.get(token) || 0
      tokenTrendValues.push({ Time: time, Token: token, Tokens: tk })
    })
  })

  // ---- Shared chart building blocks ----
  const rankBarBase = {
    direction: 'horizontal' as const,
    legends: { visible: false },
    bar: { state: { hover: { stroke: '#000', lineWidth: 1 } } },
    axes: [
      { orient: 'left' as const, type: 'band' as const },
      { orient: 'bottom' as const, type: 'linear' as const, visible: false },
    ],
    color: { specified: tokenColorMap },
    background: { fill: 'transparent' },
    animation: true,
  }

  const trendAreaBase = {
    stack: false,
    legends: { visible: true, selectMode: 'single' as const },
    axes: [
      { orient: 'bottom' as const, type: 'band' as const },
      { orient: 'left' as const, type: 'linear' as const },
    ],
    area: { style: { fillOpacity: 0.15, curveType: 'monotone' as const } },
    line: { style: { lineWidth: 2, curveType: 'monotone' as const } },
    point: { visible: false },
    color: { specified: tokenColorMap },
    background: { fill: 'transparent' },
    animation: true,
  }

  const makeNumberTooltipUpdateContent = (formatFn: (v: number) => string) =>
    (array: Array<{ key: string; value: string | number }>) => {
      array.sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
      let sum = 0
      for (let i = 0; i < array.length; i++) {
        const v = Number(array[i].value) || 0
        sum += v
        array[i].value = formatFn(v)
      }
      array.unshift({ key: tt('Total:'), value: formatFn(sum) })
      return array
    }

  return {
    spec_token_rank: {
      type: 'bar',
      data: [{ id: 'tokenRankData', values: quotaRankValues }],
      xField: 'rawQuota',
      yField: 'Token',
      seriesField: 'Token',
      ...rankBarBase,
      title: { visible: true, text: tt('API Key Consumption Ranking'), subtext: `${tt('Total:')} ${formatVal(totalQuota)}` },
      label: { visible: true, position: 'outside', formatMethod: (value: number) => formatVal(value), style: { fontSize: 11 } },
      tooltip: {
        mark: {
          content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatVal(Number(datum?.rawQuota) || 0) }],
          updateContent: (array: Array<{ key: string; value: string | number; datum?: Record<string, unknown> }>) => {
            for (let i = 0; i < array.length; i++) {
              const rawQuota = array[i].datum?.rawQuota
              const value = rawQuota === undefined ? array[i].value : Number(rawQuota)
              array[i].value = formatVal(Number(value) || 0)
            }
            return array
          },
        },
      },
    },
    spec_token_trend: {
      type: 'area',
      data: [{ id: 'tokenTrendData', values: quotaTrendValues }],
      xField: 'Time',
      yField: 'rawQuota',
      seriesField: 'Token',
      ...trendAreaBase,
      title: { visible: true, text: tt('API Key Consumption Trend'), subtext: `${tt('Total:')} ${formatVal(totalQuota)}` },
      axes: [
        { orient: 'bottom' as const, type: 'band' as const },
        { orient: 'left' as const, type: 'linear' as const, label: { formatMethod: (value: number) => formatVal(value) } },
      ],
      tooltip: {
        mark: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatVal(Number(datum?.rawQuota) || 0) }] },
        dimension: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => Number(datum?.rawQuota) || 0 }], updateContent: makeNumberTooltipUpdateContent(formatVal) },
      },
    },
    spec_token_count_rank: {
      type: 'bar',
      data: [{ id: 'tokenCountRankData', values: countRankValues }],
      xField: 'Count',
      yField: 'Token',
      seriesField: 'Token',
      ...rankBarBase,
      title: { visible: true, text: tt('API Key Request Count Ranking'), subtext: `${tt('Total:')} ${formatInt(totalCount)}` },
      label: { visible: true, position: 'outside', formatMethod: (value: number) => formatInt(value), style: { fontSize: 11 } },
      tooltip: {
        mark: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatInt(Number(datum?.Count) || 0) }] },
      },
    },
    spec_token_count_trend: {
      type: 'area',
      data: [{ id: 'tokenCountTrendData', values: countTrendValues }],
      xField: 'Time',
      yField: 'Count',
      seriesField: 'Token',
      ...trendAreaBase,
      title: { visible: true, text: tt('API Key Request Count Trend'), subtext: `${tt('Total:')} ${formatInt(totalCount)}` },
      tooltip: {
        mark: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatInt(Number(datum?.Count) || 0) }] },
        dimension: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => Number(datum?.Count) || 0 }], updateContent: makeNumberTooltipUpdateContent(formatInt) },
      },
    },
    spec_token_token_rank: {
      type: 'bar',
      data: [{ id: 'tokenTokenRankData', values: tokenRankValues }],
      xField: 'Tokens',
      yField: 'Token',
      seriesField: 'Token',
      ...rankBarBase,
      title: { visible: true, text: tt('API Key Token Usage Ranking'), subtext: `${tt('Total:')} ${formatInt(totalTokens)}` },
      label: { visible: true, position: 'outside', formatMethod: (value: number) => formatInt(value), style: { fontSize: 11 } },
      tooltip: {
        mark: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatInt(Number(datum?.Tokens) || 0) }] },
      },
    },
    spec_token_token_trend: {
      type: 'area',
      data: [{ id: 'tokenTokenTrendData', values: tokenTrendValues }],
      xField: 'Time',
      yField: 'Tokens',
      seriesField: 'Token',
      ...trendAreaBase,
      title: { visible: true, text: tt('API Key Token Usage Trend'), subtext: `${tt('Total:')} ${formatInt(totalTokens)}` },
      tooltip: {
        mark: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => formatInt(Number(datum?.Tokens) || 0) }] },
        dimension: { content: [{ key: (datum: Record<string, unknown>) => datum?.Token, value: (datum: Record<string, unknown>) => Number(datum?.Tokens) || 0 }], updateContent: makeNumberTooltipUpdateContent(formatInt) },
      },
    },
  }
}
