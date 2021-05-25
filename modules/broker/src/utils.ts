export function isKnownOS(os: string): boolean {
  return ['linux', 'macos', 'windows'].includes(os.toLowerCase());
}
