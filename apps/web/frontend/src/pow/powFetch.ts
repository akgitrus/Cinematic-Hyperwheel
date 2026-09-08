import { getTicket, invalidateTicket } from "./ticketManager";

/**
 * fetch() wrapper for endpoints gated by proof-of-work (see
 * apps/web/backend/app/pow.py). Attaches a valid ticket, and retries once
 * - minting a fresh ticket - if the server reports it exhausted/expired
 * (429), which can happen if a ticket's remaining budget was consumed by
 * another concurrent call between the local check and this request
 * actually reaching the server.
 */
export async function powFetch(scope: string, input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  const attempt = async () => {
    const ticket = await getTicket(scope);
    const headers = new Headers(init.headers);
    headers.set("X-Pow-Ticket", ticket);
    return fetch(input, { ...init, headers });
  };

  let res = await attempt();
  if (res.status === 429) {
    invalidateTicket(scope);
    res = await attempt();
  }
  return res;
}