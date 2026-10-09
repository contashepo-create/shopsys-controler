import { defineConfig } from 'vitest/config'

// اختبارات الوحدات (core/ و data/) في Node، واختبارات الواجهة (tests/ui/*.test.tsx) في jsdom عبر تعليق @vitest-environment
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    globals: false,
  },
})
