let resolveListening!: () => void;
let listening = false;
let listeningPromise = createListeningPromise();

function createListeningPromise(): Promise<void> {
  return new Promise<void>((resolve) => {
    resolveListening = resolve;
  });
}

export function markDashboardListening(): void {
  if (listening) return;
  listening = true;
  resolveListening();
}

export function whenDashboardListening(): Promise<void> {
  return listeningPromise;
}

export function resetDashboardListeningForTests(): void {
  listening = false;
  listeningPromise = createListeningPromise();
}
