import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface Notification {
  id: number;
  type: NotificationType;
  message: string;
  title?: string;
}

interface NotificationContextValue {
  notify: (options: { type: NotificationType; message: string; title?: string; duration?: number }) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function useNotification(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}

const TYPE_STYLES: Record<NotificationType, { icon: typeof Info; iconColor: string; borderColor: string; bgColor: string }> = {
  success: {
    icon: CheckCircle2,
    iconColor: 'text-green-400',
    borderColor: 'border-green-500/30',
    bgColor: 'bg-green-500/5',
  },
  error: {
    icon: XCircle,
    iconColor: 'text-red-400',
    borderColor: 'border-red-500/30',
    bgColor: 'bg-red-500/5',
  },
  warning: {
    icon: AlertTriangle,
    iconColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
    bgColor: 'bg-orange-500/5',
  },
  info: {
    icon: Info,
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    bgColor: 'bg-blue-500/5',
  },
};

const DEFAULT_DURATION: Record<NotificationType, number> = {
  success: 3000,
  error: 6000,
  warning: 5000,
  info: 4000,
};

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const notify = useCallback(({ type, message, title, duration }: { type: NotificationType; message: string; title?: string; duration?: number }) => {
    const id = nextId.current++;
    const notification: Notification = { id, type, message, title };

    setNotifications((prev) => [...prev, notification]);

    const timeout = duration ?? DEFAULT_DURATION[type];
    const timer = setTimeout(() => {
      dismiss(id);
    }, timeout);
    timers.current.set(id, timer);
  }, [dismiss]);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}

      {/* Notification container — top-right */}
      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
          {notifications.map((notification) => {
            const styles = TYPE_STYLES[notification.type];
            const Icon = styles.icon;
            return (
              <div
                key={notification.id}
                className={`pointer-events-auto bg-surface-raised border ${styles.borderColor} ${styles.bgColor} rounded-lg shadow-lg p-3 animate-fade-in`}
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 ${styles.iconColor} flex-shrink-0 mt-0.5`} />
                  <div className="flex-1 min-w-0">
                    {notification.title && (
                      <p className="text-sm font-medium text-content mb-0.5">{notification.title}</p>
                    )}
                    <p className="text-sm text-content-body whitespace-pre-wrap break-words">{notification.message}</p>
                  </div>
                  <button
                    onClick={() => dismiss(notification.id)}
                    className="text-content-muted hover:text-content-subtle transition-colors flex-shrink-0"
                    aria-label="Dismiss"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </NotificationContext.Provider>
  );
}
