import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** Nodig iemand uit voor een route */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const { id: routeId } = await params;
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) return NextResponse.json({ error: 'Route niet gevonden.' }, { status: 404 });
  if (route.ownerId !== user.id) return NextResponse.json({ error: 'Alleen de eigenaar mag uitnodigen.' }, { status: 403 });

  const { email, role } = await req.json();
  if (!email || !['VIEWER', 'EDITOR'].includes(role)) {
    return NextResponse.json({ error: 'email en role (VIEWER of EDITOR) zijn verplicht.' }, { status: 400 });
  }

  const invitee = await prisma.user.findUnique({ where: { email } });
  if (!invitee) return NextResponse.json({ error: 'Geen gebruiker gevonden met dit e-mailadres.' }, { status: 404 });
  if (invitee.id === user.id) return NextResponse.json({ error: 'Je kunt jezelf niet uitnodigen.' }, { status: 400 });

  const collab = await prisma.routeCollaborator.upsert({
    where: { routeId_userId: { routeId, userId: invitee.id } },
    update: { role },
    create: { routeId, userId: invitee.id, role, accepted: true },
  });

  return NextResponse.json(collab, { status: 201 });
}

/** Verwijder een medewerker */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Niet ingelogd.' }, { status: 401 });

  const { id: routeId } = await params;
  const route = await prisma.route.findUnique({ where: { id: routeId } });
  if (!route) return NextResponse.json({ error: 'Route niet gevonden.' }, { status: 404 });

  const { userId: targetUserId } = await req.json();

  // Eigenaar mag iedereen verwijderen; gebruiker mag zichzelf verwijderen
  if (route.ownerId !== user.id && targetUserId !== user.id) {
    return NextResponse.json({ error: 'Geen rechten.' }, { status: 403 });
  }

  await prisma.routeCollaborator.deleteMany({
    where: { routeId, userId: targetUserId },
  });

  return NextResponse.json({ ok: true });
}
