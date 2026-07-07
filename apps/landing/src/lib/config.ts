// Single source of truth for the "Go to App" destination. Falls back to the local app dev server
// so the landing works end-to-end in local development without extra env setup.
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
