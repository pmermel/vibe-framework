import { describe, it, expect } from "vitest";
import { capturePreview } from "./capture-preview.js";

// capture-preview launches a real Playwright browser for valid params.
// We test param validation only — invalid params throw before any browser is launched.

describe("capturePreview — param validation", () => {
  it("throws Invalid params when url is missing", async () => {
    await expect(
      capturePreview({ github_repo: "owner/repo", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when url is not a valid URL", async () => {
    await expect(
      capturePreview({ url: "not-a-url", github_repo: "owner/repo", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is missing", async () => {
    await expect(
      capturePreview({ url: "https://example.com", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when github_repo is not in owner/repo format", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "notvalid", pr_number: 1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is missing", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo" })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is negative", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo", pr_number: -1 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when pr_number is zero", async () => {
    await expect(
      capturePreview({ url: "https://example.com", github_repo: "owner/repo", pr_number: 0 })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when viewport.width is negative", async () => {
    await expect(
      capturePreview({
        url: "https://example.com",
        github_repo: "owner/repo",
        pr_number: 1,
        viewport: { width: -1, height: 844 },
      })
    ).rejects.toThrow("Invalid params:");
  });

  it("throws Invalid params when viewport.height is negative", async () => {
    await expect(
      capturePreview({
        url: "https://example.com",
        github_repo: "owner/repo",
        pr_number: 1,
        viewport: { width: 390, height: -1 },
      })
    ).rejects.toThrow("Invalid params:");
  });
});
