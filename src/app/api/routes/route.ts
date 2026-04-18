import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** Haal alle routes op van de ingelogde user (eigenaar + medewerker) */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const owned = await prisma.route.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: 'desc' },
    include: { collaborators: { include: { user: { select: { id: true, email: true, name: true } } } } },
  });

  const collaborated = await prisma.route.findMany({
    where: {
      collaborators: { some: { userId: user.id, accepted: true } },
    },
    orderBy: { updatedAt: 'desc' },
    include: { collaborators: { include: { user: { select: { id: true, email: true, name: true } } } } },
  });

  return NextResponse.json({ owned, collaborated });
}

/** Maak een nieuwe route aan */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const body = await req.json();
  const { name, waypoints, preferences, coordinates, distance, duration } = body;

  if (!name || !waypoints || !preferences) {
    return NextResponse.json({ error: 'name, waypoints en preferences zijn verplicht.' }, { status: 400 });
  }

  const route = await prisma.route.create({
    data: {
      name,
      ownerId: user.id,
      waypoints,
      preferences,
      coordinates: coordinates ?? null,
      distance: distance ?? null,
      duration: duration ?? null,
    },
  });

  return NextResponse.json(route, { status: 201 });
}
