import { describe, it, expect } from "vitest";
import { bootstrapFramework } from "./bootstrap-framework.js";

describe("bootstrapFramework", () => {
  it("returns status:not_implemented with no params", async () => {
    const result = await bootstrapFramework({});
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("ignores unknown params without throwing", async () => {
    const result = await bootstrapFramework({ foo: "bar", baz: 123 });
    expect(result).toEqual({ status: "not_implemented" });
  });

  it("can be called multiple times without error", async () => {
    await bootstrapFramework({});
    const result = await bootstrapFramework({});
    expect(result).toEqual({ status: "not_implemented" });
  });
});
