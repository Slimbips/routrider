import { NextRequest } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { sseClients } from '../route';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return new Response('Niet ingelogd.', { status: 401 });

  const { id: routeId } = await params;

  // Controleer toegang
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { collaborators: true },
  });
  if (!route) return new Response('Route niet gevonden.', { status: 404 });

  const hasAccess =
    route.ownerId === user.id ||
    route.collaborators.some((c: { userId: string; accepted: boolean }) => c.userId === user.id && c.accepted);

  if (!hasAccess) return new Response('Geen toegang.', { status: 403 });

  // SSE stream opzetten
  let controller: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(ctrl) {
      controller = ctrl;
      if (!sseClients.has(routeId)) sseClients.set(routeId, new Set());
      sseClients.get(routeId)!.add(ctrl);

      // Stuur een ping zodat de verbinding openblijft
      ctrl.enqueue(new TextEncoder().encode(': ping\n\n'));
    },
    cancel() {
      sseClients.get(routeId)?.delete(controller);
    },
  });

  req.signal.addEventListener('abort', () => {
    sseClients.get(routeId)?.delete(controller);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
