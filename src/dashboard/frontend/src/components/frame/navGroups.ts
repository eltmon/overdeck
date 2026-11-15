/**
 * navGroups — the "More" navigation groups (PAN-5293 F-D11, moved verbatim
 * from Sidebar.tsx). Every route outside the primary nav stays reachable here.
 */

import {
  LayoutGrid, Bot, Server, Terminal, BarChart3, DollarSign, HeartPulse, Cpu, Settings,
  Zap, GitBranch, GitMerge, History, Mic, FileText, BookOpen, Shield, ListOrdered,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Tab } from '../Header';

export interface NavItem {
  id: Tab;
  label: string;
  icon: LucideIcon;
  title?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const MORE_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'backlog' as Tab, label: 'Backlog', icon: ListOrdered },
      { id: 'kanban' as Tab, label: 'Board', icon: LayoutGrid },
      { id: 'pipeline' as Tab, label: 'Pipeline', icon: GitBranch },
      { id: 'awaiting-merge' as Tab, label: 'Awaiting Merge', icon: GitMerge },
      { id: 'agents' as Tab, label: 'Agents', icon: Bot },
      { id: 'autopreso' as Tab, label: 'AutoPreso', icon: Mic },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { id: 'resources' as Tab, label: 'Resources', icon: Server },
    ],
  },
  {
    label: 'Observability',
    items: [
      { id: 'activity' as Tab, label: 'Activity', icon: Terminal },
      { id: 'sessions' as Tab, label: 'Sessions', icon: History },
      { id: 'metrics' as Tab, label: 'Metrics', icon: BarChart3 },
      { id: 'costs' as Tab, label: 'Costs', icon: DollarSign },
      { id: 'health' as Tab, label: 'Health', icon: HeartPulse },
      { id: 'deacon' as Tab, label: 'Deacon', icon: Shield },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'knowledge' as Tab, label: 'Knowledge', icon: BookOpen },
      { id: 'skills' as Tab, label: 'Skills', icon: Cpu },
      { id: 'context' as Tab, label: 'Context', icon: FileText },
      { id: 'settings' as Tab, label: 'Settings', icon: Settings },
      { id: 'god-view' as Tab, label: 'God View', icon: Zap },
    ],
  },
];
