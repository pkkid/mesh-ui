import { describe, expect, it } from "vitest";

import { caretAfterDigits, digitsBefore, formatPhone, phoneDisplay, phoneLogin, phonePlaceholder } from "./phoneFormat";

describe("formatPhone", () => {
  it("groups a US number as it is typed", () => {
    expect(formatPhone("+1", "5")).toBe("5");
    expect(formatPhone("+1", "555")).toBe("555");
    expect(formatPhone("+1", "5550")).toBe("555 0");
    expect(formatPhone("+1", "555010")).toBe("555 010");
    expect(formatPhone("+1", "5550100142")).toBe("555 010 0142");
  });

  it("regroups whatever spacing and punctuation was typed or pasted", () => {
    expect(formatPhone("+1", "(555) 010-0142")).toBe("555 010 0142");
    expect(formatPhone("+1", "555 0 1 00142")).toBe("555 010 0142");
  });

  it("uses each country's grouping", () => {
    expect(formatPhone("+44", "7700900123")).toBe("7700 900123");
    expect(formatPhone("+33", "612345678")).toBe("6 12 34 56 78");
    expect(formatPhone("+91", "9876543210")).toBe("98765 43210");
  });

  it("keeps a trunk 0 on the first group where it is dialled at home", () => {
    expect(formatPhone("+44", "07700900123")).toBe("07700 900123");
    expect(formatPhone("+33", "0612345678")).toBe("06 12 34 56 78");
  });

  it("puts extra digits on the last group and stops at 15", () => {
    expect(formatPhone("+1", "55501001429")).toBe("555 010 01429");
    expect(formatPhone("+1", "1234567890123456789").replace(/\D/g, "")).toHaveLength(15);
  });

  it("leaves a number typed with its own country code alone", () => {
    expect(formatPhone("+1", "+44 7700 900123")).toBe("+44 7700 900123");
    expect(formatPhone("+1", "0044")).toBe("0044");
  });
});

describe("phoneLogin and phoneDisplay", () => {
  it("joins the country code and digits", () => {
    expect(phoneLogin("+1", "555 010 0142")).toBe("+15550100142");
    expect(phoneDisplay("+1", "555 010 0142")).toBe("+1 555 010 0142");
  });

  it("drops a trunk 0", () => {
    expect(phoneLogin("+44", "07700 900123")).toBe("+447700900123");
    expect(phoneDisplay("+44", "07700 900123")).toBe("+44 7700 900123");
  });

  it("keeps a 0 where it is part of the number", () => {
    expect(phoneLogin("+39", "0612345678")).toBe("+390612345678");
  });

  it("passes an international number through", () => {
    expect(phoneLogin("+1", " +44 7700 900123 ")).toBe("+44 7700 900123");
  });
});

describe("phonePlaceholder", () => {
  it("shows the example in the country's grouping", () => {
    expect(phonePlaceholder("+1")).toBe("555 010 0142");
    expect(phonePlaceholder("+44")).toBe("7700 900123");
  });
});

describe("caret helpers", () => {
  it("finds the spot after a number of digits", () => {
    expect(caretAfterDigits("555 010 0142", 0)).toBe(0);
    expect(caretAfterDigits("555 010 0142", 3)).toBe(3);
    expect(caretAfterDigits("555 010 0142", 4)).toBe(5);
    expect(caretAfterDigits("555 010 0142", 99)).toBe(12);
  });

  it("counts digits before a position", () => {
    expect(digitsBefore("555 010 0142", 5)).toBe(4);
    expect(digitsBefore("555 0", 4)).toBe(3);
  });
});
