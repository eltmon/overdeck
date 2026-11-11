// Disk alert snapshot (PAN-5093): Needs-you item and phone push when free
// disk on the filesystem holding the Overdeck home drops below a threshold.
//
// Shared by the server (the disk alert service and its GET /api/disk-alert
// route) and the frontend (the desktop Needs-you card and the phone line).

export type DiskAlertLevel = "ok" | "warning" | "critical"

export interface DiskSpaceHolder {
  readonly label: string // e.g. "~/.overdeck/transcript-preservation", "Docker reclaimable"
  readonly path: string | null // null for Docker
  readonly bytes: number
}

export interface DiskAlertHolders {
  readonly measuredAt: string // ISO
  readonly incomplete: boolean // at least one path timed out or failed
  readonly holders: readonly DiskSpaceHolder[]
}

export interface DiskAlertSnapshot {
  readonly level: DiskAlertLevel
  readonly path: string // the watched directory (Overdeck home)
  readonly availableBytes: number | null
  readonly totalBytes: number | null
  readonly warningBytes: number
  readonly criticalBytes: number
  readonly since: string | null // ISO time the current non-ok level began
  readonly checkedAt: string | null // ISO time of the last successful statfs; null on a peer
  readonly measuring: boolean // holders measurement in flight
  readonly holders: DiskAlertHolders | null
}
