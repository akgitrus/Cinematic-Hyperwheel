export interface MovieHit {
  item_id: number;
  title: string;
  directedBy: string;
  starring: string;
  avgRating: number | null;
  imdbId: string | null;
  score: number;
}

export interface WheelPoint {
  item_id: number;
  pc_x: number;
  pc_y: number;
  z_x: number;
  z_y: number;
  angle_deg: number;
  radius: number;
  explained_x: number;
  explained_y: number;
}

export async function searchMovies(q: string): Promise<MovieHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("search failed");
  const data = await res.json();
  return data.results;
}

export async function getWheelPoint(itemId: number): Promise<WheelPoint> {
  const res = await fetch(`/api/movie/${itemId}/wheel`);
  if (!res.ok) throw new Error("wheel lookup failed");
  return res.json();
}
