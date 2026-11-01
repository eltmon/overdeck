/**
 * Unit tests for the pairing-link parser and the transport policy (PAN-4402 W-1).
 *
 * The DNS lookup is injected, so no test touches the network.
 */

import { describe, expect, it, vi } from "vitest";

import {
  BARE_CREDENTIAL_ERROR,
  NOT_A_LINK_ERROR,
  TRANSPORT_REFUSED_ERROR,
  assessMachineTransport,
  isLoopbackAddress,
  isTailnetAddress,
  parsePairingLink,
} from "../src/machine-url.js";

const noLookup = vi.fn(async (): Promise<string[]> => {
  throw new Error("lookup must not be called");
});

const lookupReturning = (addresses: string[]) => vi.fn(async () => addresses);

describe("parsePairingLink", () => {
  it("parses a Settings → Anywhere link into its origin and credential", () => {
    expect(parsePairingLink("  http://100.101.102.103:3011/#pair=odp_abc123  ")).toEqual({
      ok: true,
      link: { baseUrl: "http://100.101.102.103:3011", credential: "odp_abc123" },
    });
  });

  it("keeps only the origin when the link has a path", () => {
    expect(parsePairingLink("https://desk.tail1234.ts.net/foo/#pair=odp_abc")).toEqual({
      ok: true,
      link: { baseUrl: "https://desk.tail1234.ts.net", credential: "odp_abc" },
    });
  });

  it("refuses a bare credential", () => {
    expect(parsePairingLink("odp_abc")).toEqual({ ok: false, error: BARE_CREDENTIAL_ERROR });
    expect(BARE_CREDENTIAL_ERROR).toBe("Paste the whole pairing link, including the address.");
  });

  it("refuses a link without #pair=", () => {
    expect(parsePairingLink("https://desk.ts.net/")).toEqual({ ok: false, error: NOT_A_LINK_ERROR });
  });

  it("refuses a #pair= value that is not a pairing credential", () => {
    expect(parsePairingLink("https://desk.ts.net/#pair=odk_token")).toEqual({
      ok: false,
      error: NOT_A_LINK_ERROR,
    });
  });

  it("refuses non-links and non-http schemes", () => {
    expect(parsePairingLink("hello there")).toEqual({ ok: false, error: NOT_A_LINK_ERROR });
    expect(parsePairingLink("ftp://desk/#pair=odp_x")).toEqual({ ok: false, error: NOT_A_LINK_ERROR });
  });
});

describe("assessMachineTransport", () => {
  it("refuses a LAN http address with the FR-3 text", async () => {
    const verdict = await assessMachineTransport("http://192.168.1.5:3011", noLookup);
    expect(verdict).toEqual({ ok: false, error: TRANSPORT_REFUSED_ERROR });
    expect(TRANSPORT_REFUSED_ERROR.startsWith(
      "Overdeck sends this computer's credential only over HTTPS, Tailscale or this computer's loopback",
    )).toBe(true);
  });

  it("accepts any https address", async () => {
    expect(await assessMachineTransport("https://anything.example", noLookup)).toEqual({
      ok: true,
      kind: "https",
    });
  });

  it("accepts addresses inside 100.64.0.0/10 and refuses the next one out", async () => {
    expect(await assessMachineTransport("http://100.64.0.1", noLookup)).toEqual({ ok: true, kind: "tailnet" });
    expect(await assessMachineTransport("http://100.127.255.254", noLookup)).toEqual({
      ok: true,
      kind: "tailnet",
    });
    expect(await assessMachineTransport("http://100.128.0.1", noLookup)).toEqual({
      ok: false,
      error: TRANSPORT_REFUSED_ERROR,
    });
  });

  it("accepts a bracketed Tailscale IPv6 literal", async () => {
    expect(await assessMachineTransport("http://[fd7a:115c:a1e0::1]:3011", noLookup)).toEqual({
      ok: true,
      kind: "tailnet",
    });
  });

  it("accepts a *.ts.net name without a lookup", async () => {
    expect(await assessMachineTransport("http://desk.tail1234.ts.net:3011", noLookup)).toEqual({
      ok: true,
      kind: "tailnet",
    });
  });

  it("accepts a MagicDNS short name whose lookup returns only tailnet addresses", async () => {
    const lookup = lookupReturning(["100.90.1.2"]);
    expect(await assessMachineTransport("http://desk:3011", lookup)).toEqual({ ok: true, kind: "tailnet" });
    expect(lookup).toHaveBeenCalledWith("desk");
  });

  it("refuses a name whose lookup returns any non-tailnet address", async () => {
    expect(await assessMachineTransport("http://desk:3011", lookupReturning(["100.90.1.2", "192.168.1.5"]))).toEqual({
      ok: false,
      error: TRANSPORT_REFUSED_ERROR,
    });
  });

  it("refuses a name whose lookup fails or returns nothing", async () => {
    const failing = vi.fn(async (): Promise<string[]> => {
      throw new Error("ENOTFOUND");
    });
    expect(await assessMachineTransport("http://desk:3011", failing)).toEqual({
      ok: false,
      error: TRANSPORT_REFUSED_ERROR,
    });
    expect(await assessMachineTransport("http://desk:3011", lookupReturning([]))).toEqual({
      ok: false,
      error: TRANSPORT_REFUSED_ERROR,
    });
  });

  it("accepts loopback addresses and names", async () => {
    expect(await assessMachineTransport("http://127.0.0.1:3011", noLookup)).toEqual({ ok: true, kind: "loopback" });
    expect(await assessMachineTransport("http://127.0.0.1:3911", noLookup)).toEqual({ ok: true, kind: "loopback" });
    expect(await assessMachineTransport("http://[::1]:3011", noLookup)).toEqual({ ok: true, kind: "loopback" });
    expect(await assessMachineTransport("http://localhost:3011", noLookup)).toEqual({ ok: true, kind: "loopback" });
    expect(await assessMachineTransport("http://dev-box:3011", lookupReturning(["127.0.0.1"]))).toEqual({
      ok: true,
      kind: "loopback",
    });
  });
});

describe("address classifiers", () => {
  it("classifies tailnet addresses", () => {
    expect(isTailnetAddress("100.64.0.0")).toBe(true);
    expect(isTailnetAddress("100.127.255.255")).toBe(true);
    expect(isTailnetAddress("100.63.255.255")).toBe(false);
    expect(isTailnetAddress("fd7a:115c:a1e0:ab12::1")).toBe(true);
    expect(isTailnetAddress("fd7a:115c:a1e1::1")).toBe(false);
    expect(isTailnetAddress("desk")).toBe(false);
  });

  it("classifies loopback addresses", () => {
    expect(isLoopbackAddress("127.255.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("128.0.0.1")).toBe(false);
    expect(isLoopbackAddress("::2")).toBe(false);
  });
});
