import { Hono } from 'hono';
import type { Env } from '../types';

const route = new Hono<{ Bindings: Env }>();

// Proxy to public Valhalla (returns speed_limit per maneuver + encoded shape)
route.post('/', async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid json' }, 400); }

  const resp = await fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) return c.json({ error: 'routing failed', detail: data }, 502);
  return c.json(data);
});

export default route;
