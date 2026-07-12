import { afterEach, describe, expect, it, vi } from "vitest";
import { api, request } from "./api";

describe("stream request timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the timeout active while an SSE body is still open", async () => {
    const neverEnding = new ReadableStream<Uint8Array>({ start() {} });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(neverEnding, { status: 200 })));

    await expect(request("/slow", { stream: true, timeout: 20 })).rejects.toThrow(/超时|timeout/i);
  }, 500);
});

describe("authentication API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks authentication state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ required: true, authenticated: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));

    await expect(api.getAuthStatus()).resolves.toEqual({ required: true, authenticated: false });
  });

  it("submits the access password to the login endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, authenticated: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.login("secret password");

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ password: "secret password" }),
    }));
  });
});

describe("reference image API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the current listing candidate URLs for server-side dimension classification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true, sku: "SKU-1", market: "UK", images: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await api.fetchImages(
      "SKU-1",
      "UK",
      ["https://cdn.example/main.jpg", "https://cdn.example/detail.jpg"],
      ["https://cdn.example/main.jpg"],
    );

    expect(fetchMock).toHaveBeenCalledWith("/api/fetch-images", expect.objectContaining({
      body: JSON.stringify({
        sku: "SKU-1",
        market: "UK",
        image_urls: ["https://cdn.example/main.jpg", "https://cdn.example/detail.jpg"],
        declared_main_urls: ["https://cdn.example/main.jpg"],
      }),
    }));
  });
});
