import { describe, expect, it } from "vitest";

import { errorCode, withErrorCode } from "./errorCode";

describe("errorCode", () => {
  it("names the eero code and HTTP status", () => {
    const error = { message: "Your eero session has ended. Sign in again.", detail: { status: 401, eeroError: "error.session.invalid" } };
    expect(errorCode(error)).toBe("error.session.invalid, HTTP 401");
    expect(withErrorCode(error.message, error)).toBe("Your eero session has ended. Sign in again. (error.session.invalid, HTTP 401)");
  });

  it("shows the status alone when eero sent no code", () => {
    expect(errorCode({ message: "Your eero session has ended. Sign in again.", detail: { status: 401 } })).toBe("HTTP 401");
  });

  it("does not repeat what the message already says", () => {
    expect(errorCode({ message: "eero answered 500 (error.x) for POST /2.2/login.", detail: { status: 500, eeroError: "error.x" } })).toBeNull();
  });

  it("is null without detail", () => {
    expect(errorCode({ message: "Could not reach eero." })).toBeNull();
    expect(withErrorCode("Could not reach eero.", { message: "Could not reach eero." })).toBe("Could not reach eero.");
  });
});
