import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function canAccess(routeId: string, userId: string, requireEditor = false) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { collaborators: true },
  });
  if (!route) return { route: null, allowed: false };

  if (route.ownerId === userId) return { route, allowed: true };

  const collab = route.collaborators.find((c) => c.userId === userId && c.accepted);
  if (!collab) return { route, allowed: false };
  if (requireEditor && collab.role !== 'EDITOR') return { route, allowed: false };

  return { route, allowed: true };
}

/** Haal één route op */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const { id } = await params;
  const { route, allowed } = await canAccess(id, user.id);
  if (!route) return NextResponse.json({ error: 'Route niet gevonden.' }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 });

  const full = await prisma.route.findUnique({
    where: { id },
    include: { collaborators: { include: { user: { select: { id: true, email: true, name: true } } } }, owner: { select: { id: true, email: true, name: true } } },
  });

  return NextResponse.json(full);
}

/** Update een route (naam, waypoints, etc.) */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const { id } = await params;
  const { route, allowed } = await canAccess(id, user.id, true);
  if (!route) return NextResponse.json({ error: 'Route niet gevonden.' }, { status: 404 });
  if (!allowed) return NextResponse.json({ error: 'Geen bewerkrechten.' }, { status: 403 });

  const body = await req.json();
  const { name, waypoints, preferences, coordinates, distance, duration } = body;

  const updated = await prisma.route.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(waypoints !== undefined && { waypoints }),
      ...(preferences !== undefined && { preferences }),
      ...(coordinates !== undefined && { coordinates }),
      ...(distance !== undefined && { distance }),
      ...(duration !== undefined && { duration }),
    },
  });

  // Broadcast update via SSE
  broadcastRouteUpdate(id, updated);

  return NextResponse.json(updated);
}

/** Verwijder een route (alleen eigenaar) */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const { id } = await params;
  const route = await prisma.route.findUnique({ where: { id } });
  if (!route) return NextResponse.json({ error: 'Route niet gevonden.' }, { status: 404 });
  if (route.ownerId !== user.id) return NextResponse.json({ error: 'Alleen de eigenaar mag verwijderen.' }, { status: 403 });

  await prisma.route.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// --- SSE broadcast helpers (in-memory voor dev) ---
export const sseClients = new Map<string, Set<ReadableStreamDefaultController>>();

export function broadcastRouteUpdate(routeId: string, data: object) {
  const clients = sseClients.get(routeId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const ctrl of clients) {
    try { ctrl.enqueue(new TextEncoder().encode(msg)); } catch { /* client disconnected */ }
  }
}
