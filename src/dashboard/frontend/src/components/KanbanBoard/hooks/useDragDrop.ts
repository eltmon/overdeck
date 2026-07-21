import { useCallback, useState } from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  defaultDropAnimationSideEffects,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from '@dnd-kit/core';
import { STATUS_LABELS, type CanonicalState, type Issue } from '../../../types';

export function useDragDrop(issues: Issue[]) {
  const [activeDragIssue, setActiveDragIssue] = useState<Issue | null>(null);
  const [activeDragStatus, setActiveDragStatus] = useState<CanonicalState | null>(null);
  const [activeOverId, setActiveOverId] = useState<string | null>(null);
  const [columnOrderOverrides, setColumnOrderOverrides] = useState<Record<string, string[]>>({});

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    const issueId = active.id as string;
    const issue = issues?.find(i => i.id === issueId);
    if (issue) {
      setActiveDragIssue(issue);
      setActiveDragStatus(STATUS_LABELS[issue.status] as CanonicalState);
    }
  }, [issues]);

  // Handle drag over
  const handleDragOver = useCallback((event: DragOverEvent) => {
    setActiveOverId((event.over?.id as string) ?? null);
  }, []);

  // Handle drag end
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const activeIssue = active.data.current?.issue as Issue | undefined;
    const overIssue = issues.find((issue) => issue.id === over?.id || issue.identifier === over?.id);

    if (activeIssue && overIssue && activeIssue.id !== overIssue.id) {
      const activeStatus = STATUS_LABELS[activeIssue.status] as CanonicalState | undefined;
      const overStatus = STATUS_LABELS[overIssue.status] as CanonicalState | undefined;
      if (activeStatus && activeStatus === overStatus) {
        setColumnOrderOverrides((prev) => {
          const sourceOrder = prev[activeStatus] ?? issues
            .filter((issue) => STATUS_LABELS[issue.status] === activeStatus)
            .map((issue) => issue.identifier);
          const nextOrder = sourceOrder.filter((id) => id !== activeIssue.identifier);
          const overIndex = nextOrder.indexOf(overIssue.identifier);
          if (overIndex === -1) return prev;
          nextOrder.splice(overIndex, 0, activeIssue.identifier);
          return { ...prev, [activeStatus]: nextOrder };
        });
      }
    }

    setActiveDragIssue(null);
    setActiveDragStatus(null);
    setActiveOverId(null);
  }, [issues]);

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: '0.5',
        },
      },
    }),
  };

  return {
    activeDragIssue,
    activeDragStatus,
    activeOverId,
    columnOrderOverrides,
    dropAnimation,
    handleDragEnd,
    handleDragOver,
    handleDragStart,
    sensors,
  };
}
