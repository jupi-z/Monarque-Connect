// Safe default: a bare `vitest run` executes only database-free unit tests.
// Integration and HTTP E2E suites require their explicit configs and guarded test URLs.
export { default } from './vitest.unit.config.ts';
