/**
 * Unit tests for StandaloneTerminal component (PAN-486).
 *
 * Tests the standalone terminal view with always-on-top toggle,
 * verifying bridge calls and UI state changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StandaloneTerminal } from "../StandaloneTerminal";
import React from "react";

// Mock XTerminal to avoid WebSocket/pty complexity
vi.mock("../XTerminal", () => ({
  XTerminal: function MockXTerminal({ sessionName }: { sessionName: string }) {
    return <div data-testid="xterm">terminal-{sessionName}</div>;
  },
}));

// Mock lucide icons
vi.mock("lucide-react", () => ({
  Pin: () => <span data-testid="pin-icon" />,
  PinOff: () => <span data-testid="pin-off-icon" />,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderComponent(sessionName = "test-session") {
  return render(<StandaloneTerminal sessionName={sessionName} />);
}

describe("StandaloneTerminal", () => {
  beforeEach(() => {
    // Reset document.title before each test
    Object.defineProperty(document, "title", {
      value: "",
      writable: true,
      configurable: true,
    });
  });

  it("renders the terminal with the given session name", () => {
    renderComponent("agent-PAN-486");

    expect(screen.getByTestId("xterm")).toHaveTextContent("terminal-agent-PAN-486");
  });

  it("displays the session name in the header when no document title is set", () => {
    renderComponent("my-session");

    // Header should show session name as fallback
    expect(screen.getByText("my-session")).toBeInTheDocument();
  });

  it("displays document title in header when available", () => {
    document.title = "Agent · PAN-486";

    renderComponent("my-session");

    expect(screen.getByText("Agent · PAN-486")).toBeInTheDocument();
  });

  it("shows Pin icon when always-on-top is disabled", () => {
    renderComponent();

    expect(screen.getByTestId("pin-icon")).toBeInTheDocument();
  });

  it("shows PinOff icon when always-on-top is enabled (Electron)", async () => {
    const user = userEvent.setup();

    // Mock Electron bridge with always-on-top support
    const setAlwaysOnTop = vi.fn();
    window.panopticonBridge = {
      isDesktopApp: () => true,
      setAlwaysOnTop,
    } as unknown as typeof window.panopticonBridge;

    renderComponent();

    const button = screen.getByRole("button", { name: /enable always on top/i });
    await user.click(button);

    expect(setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(screen.getByTestId("pin-off-icon")).toBeInTheDocument();
  });

  it("toggles always-on-top off after enabling it", async () => {
    const user = userEvent.setup();

    const setAlwaysOnTop = vi.fn();
    window.panopticonBridge = {
      isDesktopApp: () => true,
      setAlwaysOnTop,
    } as unknown as typeof window.panopticonBridge;

    renderComponent();

    // Enable
    await user.click(screen.getByRole("button", { name: /enable always on top/i }));
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(true);

    // Disable
    await user.click(screen.getByRole("button", { name: /disable always on top/i }));
    expect(setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it("falls back to window.focus() in browser mode", async () => {
    const user = userEvent.setup();

    // Mock browser bridge (no isDesktopApp)
    const focusSpy = vi.spyOn(window, "focus");
    window.panopticonBridge = {} as unknown as typeof window.panopticonBridge;

    renderComponent();

    await user.click(screen.getByRole("button", { name: /enable always on top/i }));

    expect(focusSpy).toHaveBeenCalled();
  });

  it("has accessible button labels", () => {
    renderComponent();

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("title", "Enable always on top");
  });
});
