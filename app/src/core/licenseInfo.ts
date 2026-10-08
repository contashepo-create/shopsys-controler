import { DEVELOPER_PUBLIC_KEY_B64U } from './license.ts'

/** Human-readable label for the developer public key (non-secret). */
export const DEV_PUBLIC_KEY_LABEL = `${DEVELOPER_PUBLIC_KEY_B64U.slice(0, 8)}…${DEVELOPER_PUBLIC_KEY_B64U.slice(-4)}`

/** Deep link to the linked app (informational only — the panel never touches its data). */
export const LINKED_APP_URL = 'https://github.com/contashepo-create/shopsys'
