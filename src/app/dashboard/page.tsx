'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface RouteItem {
  id: string;
  name: string;
  distance: number | null;
  duration: number | null;
  updatedAt: string;
  owner: { id: string; email: string; name: string | null };
  collaborators: { role: string; user: { id: string; email: string; name: string | null } }[];
}

interface AuthUser { id: string; email: string; name: string | null; }

function formatDistance(m: number | null) {
  if (!m) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

function formatDuration(s: number | null) {
  if (!s) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}u`;
  return `${h}u ${m}min`;
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [owned, setOwned] = useState<RouteItem[]>([]);
  const [collaborated, setCollaborated] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(u => {
      if (!u) { router.push('/login'); return; }
      setUser(u);
      fetch('/api/routes').then(r => r.json()).then(data => {
        setOwned(data.owned ?? []);
        setCollaborated(data.collaborated ?? []);
        setLoading(false);
      });
    });
  }, [router]);

  const handleDelete = async (id: string) => {
    if (!confirm('Route verwijderen?')) return;
    await fetch(`/api/routes/${id}`, { method: 'DELETE' });
    setOwned(owned.filter(r => r.id !== id));
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">Laden…</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-brand-500 text-white px-6 py-4 flex items-center gap-3 shadow">
        <span className="text-xl">🏍️</span>
        <span className="font-bold text-lg tracking-wide flex-1">RoutRider</span>
        <span className="text-sm text-white/80">{user?.name || user?.email}</span>
        <button onClick={handleLogout} className="text-sm text-white/70 hover:text-white ml-4 transition-colors">
          Uitloggen
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-800">Mijn routes</h1>
          <Link
            href="/"
            className="bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            + Nieuwe route
          </Link>
        </div>

        {owned.length === 0 && (
          <p className="text-gray-400 text-sm italic mb-8">Nog geen routes. Maak er een aan!</p>
        )}

        <div className="space-y-3 mb-10">
          {owned.map(route => (
            <div key={route.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 truncate">{route.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDistance(route.distance)} · {formatDuration(route.duration)} · {new Date(route.updatedAt).toLocaleDateString('nl-NL')}
                </p>
                {route.collaborators.length > 0 && (
                  <p className="text-xs text-brand-600 mt-1">
                    👥 {route.collaborators.map(c => c.user.name || c.user.email).join(', ')}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Link
                  href={`/?routeId=${route.id}`}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 hover:bg-brand-50 transition-colors"
                >
                  Bewerken
                </Link>
                <button
                  onClick={() => handleDelete(route.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 transition-colors"
                >
                  Verwijderen
                </button>
              </div>
            </div>
          ))}
        </div>

        {collaborated.length > 0 && (
          <>
            <h2 className="text-lg font-bold text-gray-700 mb-3">Gedeeld met mij</h2>
            <div className="space-y-3">
              {collaborated.map(route => (
                <div key={route.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-800 truncate">{route.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDistance(route.distance)} · {formatDuration(route.duration)}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Van: {route.owner.name || route.owner.email}
                    </p>
                  </div>
                  <Link
                    href={`/?routeId=${route.id}`}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-brand-200 text-brand-600 hover:bg-brand-50 transition-colors shrink-0"
                  >
                    Openen
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
