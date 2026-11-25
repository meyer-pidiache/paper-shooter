export function errorMessage(error: unknown): string {
  const detail =
    error !== null && typeof error === 'object' && 'message' in error ? error.message : error;
  return String(detail || '');
}
/** Connection feedback is plain text; the screen adapter owns its DOM rendering. */
export function connectionError(error: unknown): string {
  const message = errorMessage(error);
  if (!message) return 'something went wrong';
  if (/networking library/.test(message))
    return 'could not load the networking library · check your connection and reload';
  if (message === 'public lobby search did not finish')
    return 'public lobby search incomplete · try Quick Play again or create a game';
  if (/timed out|signalling/.test(message))
    return 'could not reach the matchmaking server · check your connection';
  if (/no lobby with that code/.test(message))
    return 'no lobby with that code · check it with your friend';
  if (/no answer/.test(message))
    return 'found the lobby but could not connect · one of you may be on a network that blocks it';
  if (/full/.test(message)) return 'that lobby is full · try another code';
  if (/leave the lobby/.test(message)) return 'leave your lobby first';
  return message;
}
