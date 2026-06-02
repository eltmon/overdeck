import { useMemo } from 'react'
import { useIssueCostsQuery } from '../../CommandDeck/ZoneCOverviewTabs/queries'
import { CockpitCard } from './CockpitCard'

function tokensShort(n: number | undefined): string {
  if (!n || n <= 0) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}

interface Row {
  label: string
  cost: number
}

function Bars({ rows, max }: { rows: Row[]; max: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-[110px] shrink-0 truncate text-foreground/90" title={r.label}>{r.label}</span>
          <span
            className="h-1.5 rounded-full bg-signal-cost/80"
            style={{ width: `${Math.max(3, max > 0 ? (r.cost / max) * 120 : 0)}px` }}
          />
          <span className="ml-auto font-mono tabular-nums text-muted-foreground">${r.cost.toFixed(2)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * CostCard — the cost breakdown (by-model + by-stage + token split). The
 * headline total also appears in the band metric strip; this card is the
 * "where did it go" detail. (Command Deck remodel S3.)
 */
export function CostCard({ issueId }: { issueId: string }) {
  const costsQuery = useIssueCostsQuery(issueId)
  const data = costsQuery.data

  const { byModel, byStage, total, maxModel, maxStage } = useMemo(() => {
    const models: Row[] = Object.entries(data?.byModel ?? {})
      .map(([label, v]) => ({ label, cost: v.cost }))
      .sort((a, b) => b.cost - a.cost)
    const stages: Row[] = Object.entries(data?.byStage ?? {})
      .map(([label, v]) => ({ label, cost: v.cost }))
      .sort((a, b) => b.cost - a.cost)
    return {
      byModel: models,
      byStage: stages,
      total: data?.resolvedTotalCost ?? data?.totalCost ?? 0,
      maxModel: Math.max(0, ...models.map((m) => m.cost)),
      maxStage: Math.max(0, ...stages.map((s) => s.cost)),
    }
  }, [data])

  return (
    <CockpitCard tone="cost" title="Cost">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[22px] font-semibold tabular-nums text-signal-cost-foreground">
          ${total.toFixed(2)}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {tokensShort(data?.inputTokens)} in · {tokensShort(data?.outputTokens)} out
        </div>
      </div>

      {byModel.length > 0 && (
        <div className="mt-3">
          <Bars rows={byModel} max={maxModel} />
        </div>
      )}

      {byStage.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">by stage</div>
          <Bars rows={byStage} max={maxStage} />
        </div>
      )}
    </CockpitCard>
  )
}
