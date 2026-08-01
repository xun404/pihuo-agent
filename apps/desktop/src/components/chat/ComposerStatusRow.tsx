/**
 * Status row above the composer:
 * left = workspace pending changes, right = task progress.
 *
 * Always reserves a fixed-height slot when a project (or tasks) is present so
 * git/task data arriving later does not shift the composer (CLS).
 * Empty content stays in-flow but invisible via `.is-empty`.
 */
import { memo } from 'react'
import type { TaskItem } from './TaskListCard'
import { PendingChangesBar } from './PendingChangesBar'
import { TaskStatusBar } from './TaskStatusBar'

type Props = {
  projectId?: string | null
  /** Poll git only when the pane is visible. */
  enabled?: boolean
  tasks?: TaskItem[] | null
  /** Increment after branch switch to refresh dirty list immediately. */
  gitRefreshToken?: number
}

function ComposerStatusRowImpl({
  projectId,
  enabled = true,
  tasks,
  gitRefreshToken = 0,
}: Props) {
  const hasTasks = Boolean(tasks && tasks.length > 0)
  // No project and no tasks: nothing to reserve (home empty without folder).
  if (!projectId && !hasTasks) return null

  return (
    <div className="composer-status-row">
      <div className="composer-status-left">
        {projectId ? (
          <PendingChangesBar
            projectId={projectId}
            enabled={enabled}
            refreshToken={gitRefreshToken}
          />
        ) : null}
      </div>
      <div className="composer-status-right">
        {hasTasks && tasks ? <TaskStatusBar tasks={tasks} /> : null}
      </div>
    </div>
  )
}

export const ComposerStatusRow = memo(ComposerStatusRowImpl)
