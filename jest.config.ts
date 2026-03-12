/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src/__test__"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  restoreMocks: true,
  testPathIgnorePatterns: ["/node_modules/"],
  testTimeout: 30000,
  forceExit: true,
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2020",
          module: "CommonJS",
          moduleResolution: "node",
          esModuleInterop: true,
          strict: false,
          skipLibCheck: true,
        },
        diagnostics: {
          ignoreCodes: [2305, 7006, 2307, 2339, 2345],
        },
      },
    ],
  },
  moduleNameMapper: {
    "^uuid$": "<rootDir>/src/__test__/__mocks__/uuid.js",
  },
};

module.exports = config;