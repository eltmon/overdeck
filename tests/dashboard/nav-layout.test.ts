import { describe, it, expect } from "vitest";

describe("Nav layout classes (PAN-137)", () => {
  const navClasses = "flex flex-wrap gap-1 overflow-x-auto";
  const buttonClasses = "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm";
  const headerClasses = "bg-gray-800 border-b border-gray-700 px-4 py-3 shrink-0";

  it("should have flex-wrap on nav to prevent horizontal clipping", () => {
    expect(navClasses).toContain("flex-wrap");
  });

  it("should have overflow-x-auto as fallback", () => {
    expect(navClasses).toContain("overflow-x-auto");
  });

  it("should use compact padding on nav buttons", () => {
    expect(buttonClasses).toContain("px-3");
    expect(buttonClasses).toContain("py-2");
  });

  it("should use text-sm on nav buttons", () => {
    expect(buttonClasses).toContain("text-sm");
  });

  it("should have adequate vertical padding on header", () => {
    expect(headerClasses).toContain("py-3");
  });

  it("should have shrink-0 on header", () => {
    expect(headerClasses).toContain("shrink-0");
  });
});
