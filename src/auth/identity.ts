export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error('Password must be between 12 and 256 characters');
  }
}
