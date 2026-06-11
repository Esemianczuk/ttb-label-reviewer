export type ApiFetchOptions = RequestInit & {
  url: string;
};

export async function apiFetch<T>(options: ApiFetchOptions): Promise<T> {
  const response = await fetch(options.url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(`API request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
