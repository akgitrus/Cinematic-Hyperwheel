export function imdbSearchUrl(title: string): string {
  return `https://www.imdb.com/find/?q=${encodeURIComponent(title)}&s=tt&ttype=ft`;
}