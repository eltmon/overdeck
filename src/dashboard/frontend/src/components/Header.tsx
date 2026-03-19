import { Eye, LayoutGrid, Users, Terminal, BarChart3, DollarSign, ArrowRightLeft, Settings, Sun, Moon, Compass, Search, Cpu, Activity, Server, Zap } from 'lucide-react';
import { CloisterStatusBar } from './CloisterStatusBar';
import { useTheme } from '../hooks/useTheme';

export type Tab = 'mission-control' | 'kanban' | 'agents' | 'resources' | 'skills' | 'health' | 'activity' | 'convoys' | 'metrics' | 'costs' | 'handoffs' | 'settings' | 'god-view';

const NAV_ITEMS = [
  { id: 'mission-control' as Tab, label: 'Mission Control', icon: Compass },
  { id: 'kanban' as Tab, label: 'Board', icon: LayoutGrid },
  { id: 'agents' as Tab, label: 'Agents', icon: Users },
  { id: 'resources' as Tab, label: 'Resources', icon: Server },
  { id: 'convoys' as Tab, label: 'Convoys', icon: Users },
  { id: 'handoffs' as Tab, label: 'Handoffs', icon: ArrowRightLeft },
  { id: 'activity' as Tab, label: 'Activity', icon: Terminal },
  { id: 'metrics' as Tab, label: 'Metrics', icon: BarChart3 },
  { id: 'costs' as Tab, label: 'Costs', icon: DollarSign },
  { id: 'skills' as Tab, label: 'Skills', icon: Cpu },
  { id: 'health' as Tab, label: 'Health', icon: Activity },
  { id: 'settings' as Tab, label: 'Settings', icon: Settings },
  { id: 'god-view' as Tab, label: 'God View', icon: Zap },
] as const;

interface HeaderProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onSearchOpen: () => void;
}

export function Header({ activeTab, onTabChange, onSearchOpen }: HeaderProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header
      className="h-[60px] shrink-0 flex items-center gap-3 px-4 border-b"
      style={{ backgroundColor: '#161b26', borderColor: '#232f48' }}
    >
      {/* Logo + Title */}
      <button
        onClick={() => onTabChange('mission-control')}
        className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
        title="Go to Mission Control"
      >
        <Eye className="w-5 h-5" style={{ color: '#2769ec' }} />
        <span
          className="text-lg font-semibold whitespace-nowrap text-white"
          style={{ fontFamily: '"Space Grotesk", sans-serif' }}
        >
          Panopticon
        </span>
      </button>

      {/* Cloister status pill */}
      <div className="shrink-0">
        <CloisterStatusBar />
      </div>

      {/* Nav items */}
      <nav className="flex gap-0.5 overflow-x-auto min-w-0 scrollbar-hide flex-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors font-medium ${
              activeTab === id
                ? 'text-white'
                : 'hover:text-white hover:bg-white/5'
            }`}
            style={activeTab === id ? { backgroundColor: '#2769ec', color: '#fff' } : { color: '#92a4c9' }}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </nav>

      {/* Right controls */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onSearchOpen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors hover:bg-white/5"
          style={{ color: '#92a4c9' }}
          title="Search (press /)"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd
            className="hidden sm:inline-block text-[10px] px-1 py-0.5 rounded"
            style={{ backgroundColor: '#232f48', color: '#92a4c9' }}
          >
            /
          </kbd>
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-md transition-colors hover:bg-white/5"
          style={{ color: '#92a4c9' }}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
