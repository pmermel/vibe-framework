import { describe, it, expect } from "vitest";
import { deriveBaseUrl } from "../router.js";

describe("deriveBaseUrl", () => {
  it("returns http URL for plain http", () => {
    expect(deriveBaseUrl("http", "localhost:8080")).toBe("http://localhost:8080");
  });

  it("returns https URL when forwarded proto is https", () => {
    expect(deriveBaseUrl("https", "my-tunnel.loca.lt")).toBe("https://my-tunnel.loca.lt");
  });

  it("handles hostname without port", () => {
    expect(deriveBaseUrl("https", "example.com")).toBe("https://example.com");
  });
});
