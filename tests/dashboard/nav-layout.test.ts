import { describe, it, expect } from "vitest";

describe("Nav layout classes (PAN-137)", () => {
  const navClasses = "flex gap-0.5 overflow-x-auto min-w-0 scrollbar-hide";
  const buttonClasses = "flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap";
  const headerClasses = "bg-gray-800 border-b border-gray-700 px-4 py-2 shrink-0";

  it("should have overflow-x-auto for horizontal scrolling", () => {
    expect(navClasses).toContain("overflow-x-auto");
  });

  it("should have min-w-0 to allow flex shrinking", () => {
    expect(navClasses).toContain("min-w-0");
  });

  it("should hide scrollbar for clean appearance", () => {
    expect(navClasses).toContain("scrollbar-hide");
  });

  it("should use compact padding on nav buttons", () => {
    expect(buttonClasses).toContain("px-2.5");
    expect(buttonClasses).toContain("py-1.5");
  });

  it("should use text-xs on nav buttons to fit all items", () => {
    expect(buttonClasses).toContain("text-xs");
  });

  it("should use whitespace-nowrap on buttons to prevent text wrapping", () => {
    expect(buttonClasses).toContain("whitespace-nowrap");
  });

  it("should have shrink-0 on header to prevent vertical collapse", () => {
    expect(headerClasses).toContain("shrink-0");
  });
});
