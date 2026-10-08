import { defineConfig } from 'vitest/config'

// اختبارات الوحدات النقية (core/) — بيئة Node без متصفح
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    globals: false,
  },
})
