export interface MovieHit {
  item_id: number;
  title: string;
  directedBy: string;
  starring: string;
  avgRating: number | null;
  imdbId: string | null;
  score: number;
}

export interface AxisLabels {
  axis: string;
  negative: string;
  positive: string;
}

export interface AxisConfig {
  pc: number;
  colors: { negative: string; positive: string };
  labels: Record<string, AxisLabels>; // keyed by language code, e.g. "en"/"ru"
  explained: number;
}

export interface WheelCircle {
  primary: boolean;
  axis_x: AxisConfig;
  axis_y: AxisConfig;
  z_x: number;
  z_y: number;
  angle_deg: number;
  radius: number;
}

export interface WheelResponse {
  item_id: number;
  circles: WheelCircle[];
}

export async function searchMovies(q: string): Promise<MovieHit[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error("search failed");
  const data = await res.json();
  return data.results;
}

export async function getWheelCircles(itemId: number): Promise<WheelResponse> {
  const res = await fetch(`/api/movie/${itemId}/wheel`);
  if (!res.ok) throw new Error("wheel lookup failed");
  return res.json();
}
