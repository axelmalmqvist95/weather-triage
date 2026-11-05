/**
 * Hjälp för koddelar som laddas vid behov (React.lazy). Ren logik utan React – testbar i Node.
 */

/** Känner igen fel när en dynamiskt importerad fil inte kunde hämtas (Safari, Chrome, Firefox, Vite). */
export function isChunkLoadError(e: unknown): boolean {
  const msg = `${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? String(e)}`;
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|Load failed/i.test(msg);
}

/** Försöker importen igen vid nätverks-/filfel, med stigande väntetid. Andra fel kastas direkt. */
export async function importWithRetry<T>(
  factory: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const delay = opts.delayMs ?? 400;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await factory();
    } catch (e) {
      if (attempt >= retries || !isChunkLoadError(e)) throw e;
      await sleep(delay * (attempt + 1));
    }
  }
}

/**
 * Användarvänligt felmeddelande och hur "Försök igen" ska fungera.
 * Webbläsare cachar ett misslyckat import() för samma fil, så ett chunk-fel kräver omladdning av sidan
 * (hash-adressen behålls). Övriga fel försöks genom att vyn monteras om.
 */
export function describeLoadError(e: unknown): { title: string; detail: string; retry: 'reload' | 'remount' } {
  if (isChunkLoadError(e)) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return {
      title: 'Intelligence kunde inte laddas',
      detail: offline
        ? 'Du verkar sakna internet och vyn finns inte sparad offline ännu. Anslut och tryck Försök igen.'
        : 'Appen har troligen uppdaterats sedan den öppnades, eller så bröts anslutningen. Tryck Försök igen för att hämta den senaste versionen.',
      retry: 'reload',
    };
  }
  return {
    title: 'Ett fel uppstod i Intelligence',
    detail: (e as Error)?.message || 'Okänt fel.',
    retry: 'remount',
  };
}
